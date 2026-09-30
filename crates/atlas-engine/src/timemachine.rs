//! Time machine: hourly network snapshots (keyframes) plus event replay.
//!
//! [`state_at`] reconstructs the node set at any time `t`: the nearest snapshot at or before
//! `t`, then every persisted event in `(snapshot_ts, t]` replayed on top. It only reads the
//! store, so the server can call it directly (from a blocking context).

use std::collections::BTreeMap;

use atlas_core::codec::nodes_bin::{NodeBinInput, encode_nodes_bin};
use atlas_core::event::Event;
use atlas_core::node::Geo;
use atlas_core::{NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier};
use atlas_store::{EventKey, Order, Store, StoreError};
use serde::{Deserialize, Serialize};

/// One node in a keyframe: what the globe needs to place and color it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapNode {
    pub id: NodeId,
    pub outpoint: Outpoint,
    pub tier: Tier,
    pub status: NodeStatus,
    pub endpoint: Option<NodeEndpoint>,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub country_code: String,
    pub country: String,
    pub org: String,
}

impl SnapNode {
    pub fn from_record(r: &NodeRecord) -> Self {
        let geo = r.geo.as_ref().filter(|g| g.has_coords());
        Self {
            id: r.id,
            outpoint: r.outpoint,
            tier: r.tier,
            status: r.status,
            endpoint: r.endpoint,
            lat: geo.map(|g| g.lat),
            lon: geo.map(|g| g.lon),
            country_code: r
                .geo
                .as_ref()
                .map(|g| g.country_code.to_string())
                .unwrap_or_default(),
            country: r
                .geo
                .as_ref()
                .map(|g| g.country.to_string())
                .unwrap_or_default(),
            org: r
                .geo
                .as_ref()
                .map(|g| g.org.to_string())
                .unwrap_or_default(),
        }
    }

    fn located(&mut self, g: &Geo) {
        if g.has_coords() {
            self.lat = Some(g.lat);
            self.lon = Some(g.lon);
        }
        self.country_code = g.country_code.to_string();
        self.country = g.country.to_string();
        self.org = g.org.to_string();
    }
}

/// A persisted keyframe (stored zstd-compressed in `snapshots`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NetworkSnapshot {
    pub ts_ms: u64,
    pub tip_height: u32,
    /// Listed nodes, id order.
    pub nodes: Vec<SnapNode>,
}

/// Reconstructed state at a time.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeMachineState {
    pub t_ms: u64,
    /// Keyframe the reconstruction started from (0 when none existed).
    pub snapshot_ms: u64,
    pub tip_height: u32,
    /// Listed nodes at `t`, id order.
    pub nodes: Vec<SnapNode>,
    /// Events replayed on top of the keyframe.
    pub replayed: usize,
}

impl TimeMachineState {
    /// Encodes the state in the `nodes.bin` format (section 7) for `/timeline/state?t=`.
    pub fn to_nodes_bin(&self, seq: u64) -> Vec<u8> {
        let rows: Vec<NodeBinInput> = self
            .nodes
            .iter()
            .map(|n| NodeBinInput {
                id: n.id,
                lat: n.lat,
                lon: n.lon,
                tier: n.tier,
                status: n.status,
                country_code: n.country_code.clone(),
                country_name: n.country.clone(),
                org: n.org.clone(),
                endpoint: n.endpoint.map(|e| e.to_string()).unwrap_or_default(),
                ..NodeBinInput::default()
            })
            .collect();
        encode_nodes_bin(seq, self.t_ms, &rows)
    }
}

/// Upper bound on replayed events when no keyframe exists before `t`.
const MAX_REPLAY_WITHOUT_KEYFRAME: usize = 2_000_000;

/// Reconstructs the node set at `t_ms`.
pub fn state_at(store: &Store, t_ms: u64) -> Result<TimeMachineState, StoreError> {
    let snap: Option<(u64, NetworkSnapshot)> = store.snapshot_at_or_before(t_ms)?;
    let (snapshot_ms, tip_height, base) = match snap {
        Some((ts, s)) => (ts, s.tip_height, s.nodes),
        None => (0, 0, Vec::new()),
    };
    let mut nodes: BTreeMap<NodeId, SnapNode> = base.into_iter().map(|n| (n.id, n)).collect();
    let from = if snapshot_ms == 0 {
        EventKey::first_at(0)
    } else {
        EventKey::first_at(snapshot_ms + 1)
    };
    let events = store.events(
        from..=EventKey::last_at(t_ms),
        Order::Asc,
        MAX_REPLAY_WITHOUT_KEYFRAME,
    )?;
    let mut tip = tip_height;
    let replayed = events.len();
    for (_, env) in events {
        apply_event(&mut nodes, &mut tip, &env.event);
    }
    Ok(TimeMachineState {
        t_ms,
        snapshot_ms,
        tip_height: tip,
        nodes: nodes
            .into_values()
            .filter(|n| !matches!(n.status, NodeStatus::Departed | NodeStatus::Unknown))
            .collect(),
        replayed,
    })
}

fn entry(nodes: &mut BTreeMap<NodeId, SnapNode>, id: NodeId) -> Option<&mut SnapNode> {
    nodes.get_mut(&id)
}

/// Applies one event to a reconstructed node set.
pub fn apply_event(nodes: &mut BTreeMap<NodeId, SnapNode>, tip: &mut u32, e: &Event) {
    match e {
        Event::BlockAdded(b) => *tip = (*tip).max(b.height),
        Event::NodeAdded {
            node,
            outpoint,
            tier,
            endpoint,
        } => {
            let n = nodes.entry(*node).or_insert_with(|| SnapNode {
                id: *node,
                outpoint: *outpoint,
                tier: *tier,
                status: NodeStatus::Confirmed,
                endpoint: *endpoint,
                lat: None,
                lon: None,
                country_code: String::new(),
                country: String::new(),
                org: String::new(),
            });
            if *tier != Tier::Unknown {
                n.tier = *tier;
            }
            if endpoint.is_some() {
                n.endpoint = *endpoint;
            }
            if matches!(n.status, NodeStatus::Departed | NodeStatus::Unknown) {
                n.status = NodeStatus::Confirmed;
            }
        }
        Event::NodeStarted { node, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = NodeStatus::Started;
            }
        }
        Event::NodeConfirmed { node, .. } | Event::NodeHeartbeat { node, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = NodeStatus::Confirmed;
            }
        }
        Event::NodeStatusChanged { node, to, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = *to;
            }
        }
        Event::NodeExpired { node, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = NodeStatus::Expired;
            }
        }
        Event::NodeDosed { node, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = NodeStatus::Dos;
            }
        }
        Event::NodeRemoved { node, .. } | Event::NodeCollateralSpent { node, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.status = NodeStatus::Departed;
            }
        }
        Event::NodeIpChanged { node, new, .. } => {
            if let Some(n) = entry(nodes, *node) {
                n.endpoint = *new;
            }
        }
        Event::NodeLocated { node, geo } => {
            if let Some(n) = entry(nodes, *node) {
                n.located(geo);
            }
        }
        _ => {}
    }
}

/// Geo helper for tests.
#[cfg(test)]
pub(crate) fn test_geo(lat: f32, lon: f32, cc: &str) -> Geo {
    Geo {
        lat,
        lon,
        country_code: cc.into(),
        source: atlas_core::node::GeoSource::StatsLookup,
        ..Geo::default()
    }
}

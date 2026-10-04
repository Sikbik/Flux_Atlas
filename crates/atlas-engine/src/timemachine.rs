//! Time machine: hourly network snapshots (keyframes) plus event replay.
//!
//! [`state_at`] reconstructs the node set at any time `t`: the nearest snapshot at or before
//! `t`, then every persisted event in `(snapshot_ts, t]` replayed on top. It only reads the
//! store, so the server can call it directly (from a blocking context).
//!
//! **What a reconstruction knows.** Tier, status, endpoint and geo (with city) always. From a
//! format-2 keyframe also the FluxOS version, hardware, last payment, app count, ArcaneOS and
//! first-seen time, replayed through `NodeVersionChanged`, `NodeHardwareChanged`, `NodePaid`
//! and `AppInstance*` events. Payment-queue ranks are not recorded (the queue moves every block
//! and is not replayable from the persisted events exactly), so the `rank` column is left out of
//! [`TimeMachineState::to_nodes_bin`]; so are the columns a format-1 keyframe did not record.
//! A missing column means "not recorded" (ARCHITECTURE section 7), never 0.
//!
//! **Honest bounds (L14).** A `t` before the first keyframe has no whole network state (the
//! events alone would build a partial globe): [`state_at`] answers
//! [`TimeMachineError::BeforeHistory`] with the first keyframe's time. A reconstruction
//! replays at most [`MAX_REPLAY_EVENTS`] events after its keyframe; a `t` needing more (keyframes
//! missing for many hours) answers [`TimeMachineError::TooManyEvents`].

use std::collections::BTreeMap;

use atlas_core::codec::Origin;
use atlas_core::codec::nodes_bin::{
    NodeBinInput, RECENT_PAID_BLOCKS, encode_nodes_bin_from, flags, kind,
};
use atlas_core::event::Event;
use atlas_core::node::{Geo, Hardware};
use atlas_core::{NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier};
use atlas_store::{EventKey, Order, SNAPSHOT_FORMAT_VERSION, Store, StoreError};
use serde::{Deserialize, Serialize};

/// Hardware columns of a keyframe node (rounded like `nodes.bin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SnapHw {
    pub cores: u16,
    pub ram_gb: u16,
    pub ssd_gb: u32,
}

impl SnapHw {
    pub fn from_hardware(h: &Hardware) -> Self {
        Self {
            cores: h.cores,
            ram_gb: h.ram_gb.round().clamp(0.0, 65_535.0) as u16,
            ssd_gb: h.ssd_gb.round().max(0.0) as u32,
        }
    }
}

/// One node in a keyframe: what the globe and the time machine need.
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
    // Format 2.
    pub city: String,
    /// FluxOS version (`None` = unknown).
    pub flux_os: Option<String>,
    /// Benchmarked hardware (`None` = unknown).
    pub hw: Option<SnapHw>,
    /// Height of the last payment (`None` = never paid, as far as the engine knows).
    pub last_paid: Option<u32>,
    /// Running app instances.
    pub app_count: u16,
    pub arcane: Option<bool>,
    pub first_seen_ms: u64,
}

impl SnapNode {
    pub fn from_record(r: &NodeRecord) -> Self {
        let geo = r.geo.as_ref().filter(|g| g.has_coords());
        let text = |f: fn(&Geo) -> String| r.geo.as_ref().map(f).unwrap_or_default();
        Self {
            id: r.id,
            outpoint: r.outpoint,
            tier: r.tier,
            status: r.status,
            endpoint: r.endpoint,
            lat: geo.map(|g| g.lat),
            lon: geo.map(|g| g.lon),
            country_code: text(|g| g.country_code.to_string()),
            country: text(|g| g.country.to_string()),
            org: text(|g| g.org.to_string()),
            city: text(|g| g.city.to_string()),
            flux_os: r.versions.flux_os.as_ref().map(ToString::to_string),
            hw: r.hw.as_ref().map(SnapHw::from_hardware),
            last_paid: r.last_paid_height.filter(|h| *h > 0),
            app_count: r.app_count,
            arcane: r.arcane,
            first_seen_ms: r.first_seen_ms,
        }
    }

    /// A node first seen through a `NodeAdded` event during replay.
    fn added(
        id: NodeId,
        outpoint: Outpoint,
        tier: Tier,
        endpoint: Option<NodeEndpoint>,
        ts: u64,
    ) -> Self {
        Self {
            id,
            outpoint,
            tier,
            status: NodeStatus::Confirmed,
            endpoint,
            lat: None,
            lon: None,
            country_code: String::new(),
            country: String::new(),
            org: String::new(),
            city: String::new(),
            flux_os: None,
            hw: None,
            last_paid: None,
            app_count: 0,
            arcane: None,
            first_seen_ms: ts,
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
        self.city = g.city.to_string();
    }
}

/// A persisted keyframe (stored zstd-compressed in `snapshots`, format
/// [`SNAPSHOT_FORMAT_VERSION`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NetworkSnapshot {
    pub ts_ms: u64,
    pub tip_height: u32,
    /// Listed nodes, id order.
    pub nodes: Vec<SnapNode>,
}

/// Format-1 keyframe node (before city, versions, hardware, payments and apps were recorded).
#[derive(Debug, Clone, Deserialize)]
struct SnapNodeV1 {
    id: NodeId,
    outpoint: Outpoint,
    tier: Tier,
    status: NodeStatus,
    endpoint: Option<NodeEndpoint>,
    lat: Option<f32>,
    lon: Option<f32>,
    country_code: String,
    country: String,
    org: String,
}

#[derive(Debug, Clone, Deserialize)]
struct NetworkSnapshotV1 {
    /// Positional in postcard; the key carries the time.
    _ts_ms: u64,
    tip_height: u32,
    nodes: Vec<SnapNodeV1>,
}

impl SnapNodeV1 {
    /// The format-2 shape with the columns format 1 did not record left unknown.
    fn upgrade(self) -> SnapNode {
        let mut n = SnapNode::added(self.id, self.outpoint, self.tier, self.endpoint, 0);
        n.status = self.status;
        n.lat = self.lat;
        n.lon = self.lon;
        n.country_code = self.country_code;
        n.country = self.country;
        n.org = self.org;
        n
    }
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
    /// True when the keyframe recorded the format-2 columns (versions, hardware, payments,
    /// apps); false for a format-1 keyframe or a reconstruction from events only.
    pub detail: bool,
}

/// Columns `/timeline/state` never carries: ranks are not recorded.
pub const NOT_RECORDED: &[u16] = &[kind::RANK];

/// Further columns left out when the keyframe did not record them (see
/// [`TimeMachineState::detail`]).
pub const NEEDS_DETAIL: &[u16] = &[kind::LAST_PAID, kind::APP_COUNT, kind::FLAGS];

impl TimeMachineState {
    /// Encodes the state in the `nodes.bin` format (section 7) for `/timeline/state?t=`.
    /// Columns the reconstruction does not know are left out, never zero-filled: always
    /// [`NOT_RECORDED`], and [`NEEDS_DETAIL`] without a format-2 keyframe. Per row, the
    /// usual "unknown" encodings apply (0 cores, version index 0, empty city).
    pub fn to_nodes_bin(&self, seq: u64) -> Vec<u8> {
        self.to_nodes_bin_from(seq, None)
    }

    /// [`Self::to_nodes_bin`] stamped with the server that reconstructed it: its node ids are
    /// that instance's (ARCHITECTURE 8.1).
    pub fn to_nodes_bin_from(&self, seq: u64, origin: Option<Origin>) -> Vec<u8> {
        let rows: Vec<NodeBinInput> = self.nodes.iter().map(|n| self.row(n)).collect();
        encode_nodes_bin_from(seq, self.t_ms, &rows, &self.omitted_columns(), origin)
    }

    /// Column kinds left out of [`Self::to_nodes_bin`].
    pub fn omitted_columns(&self) -> Vec<u16> {
        let mut omit = NOT_RECORDED.to_vec();
        if !self.detail {
            omit.extend_from_slice(NEEDS_DETAIL);
        }
        omit
    }

    fn row(&self, n: &SnapNode) -> NodeBinInput {
        let mut f = 0u8;
        if n.app_count > 0 {
            f |= flags::HAS_APPS;
        }
        if let Some(ep) = &n.endpoint {
            if ep.ip.is_ipv6() {
                f |= flags::IPV6;
            }
            if !ep.is_default_port() {
                f |= flags::NON_DEFAULT_PORT;
            }
        }
        if n.arcane == Some(true) {
            f |= flags::ARCANE;
        }
        if n.last_paid
            .is_some_and(|h| self.tip_height.saturating_sub(h) < RECENT_PAID_BLOCKS)
        {
            f |= flags::RECENTLY_PAID;
        }
        if n.first_seen_ms > 0
            && n.first_seen_ms <= self.t_ms
            && self.t_ms - n.first_seen_ms < 86_400_000
        {
            f |= flags::NEW_24H;
        }
        let hw = n.hw.unwrap_or_default();
        NodeBinInput {
            id: n.id,
            lat: n.lat,
            lon: n.lon,
            tier: n.tier,
            status: n.status,
            flags: f,
            country_code: n.country_code.clone(),
            country_name: n.country.clone(),
            city: n.city.clone(),
            org: n.org.clone(),
            app_count: n.app_count,
            rank: None,
            last_paid: n.last_paid,
            cores: hw.cores,
            ram_gb: hw.ram_gb,
            ssd_gb: hw.ssd_gb,
            version: n.flux_os.clone().unwrap_or_default(),
            endpoint: n.endpoint.map(|e| e.to_string()).unwrap_or_default(),
            outpoint: Some(n.outpoint),
        }
    }
}

/// Most events one reconstruction replays after its keyframe (about 17 hours at the measured
/// 70,000 events a day; keyframes are hourly).
pub const MAX_REPLAY_EVENTS: usize = 50_000;

/// Why there is no state at a time.
#[derive(Debug, thiserror::Error)]
pub enum TimeMachineError {
    #[error(transparent)]
    Store(#[from] StoreError),
    /// `t` is before the first keyframe (`first_ms`; `None` while there is none at all).
    #[error("no data before {}", first_ms.map_or_else(|| "the first keyframe".to_owned(), iso_utc))]
    BeforeHistory { first_ms: Option<u64> },
    /// More than [`MAX_REPLAY_EVENTS`] events lie between the keyframe and `t`.
    #[error("no reconstructable state: more than {limit} events after the nearest keyframe ({})", iso_utc(*keyframe_ms))]
    TooManyEvents { keyframe_ms: u64, limit: usize },
}

/// `YYYY-MM-DDTHH:MM:SSZ` for unix ms.
pub fn iso_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem / 60) % 60,
        rem % 60
    )
}

/// A decoded keyframe of any format.
#[derive(Debug, Default)]
struct Keyframe {
    ts_ms: u64,
    tip_height: u32,
    nodes: Vec<SnapNode>,
    /// The format-2 columns were recorded.
    detail: bool,
}

/// The keyframe at or before `t_ms`, any format.
fn keyframe(store: &Store, t_ms: u64) -> Result<Option<Keyframe>, StoreError> {
    let Some((ts_ms, version, raw)) = store.snapshot_blob_at_or_before(t_ms)? else {
        return Ok(None);
    };
    let bad = |source| StoreError::Decode {
        what: "snapshot",
        source,
    };
    Ok(Some(match version {
        SNAPSHOT_FORMAT_VERSION => {
            let s: NetworkSnapshot = postcard::from_bytes(&raw).map_err(bad)?;
            Keyframe {
                ts_ms,
                tip_height: s.tip_height,
                nodes: s.nodes,
                detail: true,
            }
        }
        1 => {
            let s: NetworkSnapshotV1 = postcard::from_bytes(&raw).map_err(bad)?;
            Keyframe {
                ts_ms,
                tip_height: s.tip_height,
                nodes: s.nodes.into_iter().map(SnapNodeV1::upgrade).collect(),
                detail: false,
            }
        }
        found => {
            return Err(StoreError::VersionMismatch {
                what: "snapshot",
                expected: SNAPSHOT_FORMAT_VERSION,
                found,
            });
        }
    }))
}

/// The nodes of the keyframe at or before `t_ms` (any format) with its time, without
/// replaying events: what a daily rollup over the stored keyframes reads.
pub fn keyframe_nodes(
    store: &Store,
    t_ms: u64,
) -> Result<Option<(u64, Vec<SnapNode>)>, StoreError> {
    Ok(keyframe(store, t_ms)?.map(|k| (k.ts_ms, k.nodes)))
}

/// Reconstructs the node set at `t_ms`: the keyframe at or before it plus the events after.
pub fn state_at(store: &Store, t_ms: u64) -> Result<TimeMachineState, TimeMachineError> {
    let Some(k) = keyframe(store, t_ms)? else {
        return Err(TimeMachineError::BeforeHistory {
            first_ms: store.snapshot_times()?.first().copied(),
        });
    };
    let snapshot_ms = k.ts_ms;
    let mut nodes: BTreeMap<NodeId, SnapNode> = k.nodes.into_iter().map(|n| (n.id, n)).collect();
    let from = EventKey::first_at(snapshot_ms.saturating_add(1));
    let events = store.events(
        from..=EventKey::last_at(t_ms),
        Order::Asc,
        MAX_REPLAY_EVENTS + 1,
    )?;
    if events.len() > MAX_REPLAY_EVENTS {
        return Err(TimeMachineError::TooManyEvents {
            keyframe_ms: snapshot_ms,
            limit: MAX_REPLAY_EVENTS,
        });
    }
    let mut tip = k.tip_height;
    let replayed = events.len();
    for (key, env) in events {
        apply_event_at(&mut nodes, &mut tip, &env.event, key.ts_ms);
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
        detail: k.detail,
    })
}

fn entry(nodes: &mut BTreeMap<NodeId, SnapNode>, id: NodeId) -> Option<&mut SnapNode> {
    nodes.get_mut(&id)
}

/// Applies one event to a reconstructed node set (event time unknown: 0).
pub fn apply_event(nodes: &mut BTreeMap<NodeId, SnapNode>, tip: &mut u32, e: &Event) {
    apply_event_at(nodes, tip, e, 0);
}

/// Applies one event observed at `ts_ms` to a reconstructed node set.
pub fn apply_event_at(
    nodes: &mut BTreeMap<NodeId, SnapNode>,
    tip: &mut u32,
    e: &Event,
    ts_ms: u64,
) {
    match e {
        Event::BlockAdded(b) => *tip = (*tip).max(b.height),
        Event::NodeAdded {
            node,
            outpoint,
            tier,
            endpoint,
        } => {
            let n = nodes
                .entry(*node)
                .or_insert_with(|| SnapNode::added(*node, *outpoint, *tier, *endpoint, ts_ms));
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
        Event::NodeVersionChanged { node, versions } => {
            if let Some(n) = entry(nodes, *node)
                && let Some(v) = &versions.flux_os
            {
                n.flux_os = Some(v.to_string());
            }
        }
        Event::NodeHardwareChanged { node, hardware } => {
            if let Some(n) = entry(nodes, *node) {
                n.hw = Some(SnapHw::from_hardware(hardware));
            }
        }
        Event::NodePaid {
            node: Some(node),
            height,
            ..
        } => {
            if let Some(n) = entry(nodes, *node) {
                n.last_paid = Some(*height);
            }
        }
        Event::AppInstanceStarted { node, endpoint, .. } => {
            if let Some(n) = instance_node(nodes, *node, endpoint) {
                n.app_count = n.app_count.saturating_add(1);
            }
        }
        Event::AppInstanceRemoved { node, endpoint, .. } => {
            if let Some(n) = instance_node(nodes, *node, endpoint) {
                n.app_count = n.app_count.saturating_sub(1);
            }
        }
        _ => {}
    }
}

/// The node an app instance event concerns: by id, else by endpoint.
fn instance_node<'a>(
    nodes: &'a mut BTreeMap<NodeId, SnapNode>,
    node: Option<NodeId>,
    endpoint: &NodeEndpoint,
) -> Option<&'a mut SnapNode> {
    let id = match node {
        Some(id) => id,
        None => {
            nodes
                .values()
                .find(|n| n.endpoint.as_ref() == Some(endpoint))?
                .id
        }
    };
    nodes.get_mut(&id)
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

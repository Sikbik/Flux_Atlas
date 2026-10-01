//! Views derived from one [`Published`] state, built once per publish and shared by every
//! request that reads that publish.
//!
//! The cache key is the identity of the published `Arc` (strictly finer than `published.seq`,
//! since two publishes without an intervening live message share a seq). Building the node
//! index takes a few milliseconds for the full network; analytics bodies are computed lazily on
//! first use and then served from memory until the next publish.

pub mod analytics;
pub mod feed;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex, OnceLock};

use arc_swap::ArcSwapOption;
use atlas_core::api::{
    AppIndexEntry, AppsIndexDto, BlockLite, BootstrapDto, NodeDto, NodeRef, NodeRow, PaymentEta,
    PayoutDto, TierStats,
};
use atlas_core::chain::BlockSummary;
use atlas_core::codec::nodes_bin::{NodeBinInput, encode_nodes_bin};
use atlas_core::emission::{PON_TARGET_SPACING_S, tier_payout};
use atlas_core::ids::{Collateral, Hash32, NodeId, Outpoint};
use atlas_core::net::NodeEndpoint;
use atlas_core::node::windows::expiry_height;
use atlas_core::{Amount, NodeRecord, Tier, now_ms};
use atlas_engine::{EngineHandle, Published};
use compact_str::CompactString;

use crate::body::CachedBody;
use crate::error::ApiError;

/// Milliseconds per block (PoN target spacing).
pub const BLOCK_MS: u64 = PON_TARGET_SPACING_S as u64 * 1000;

/// Lookup tables over the published node list. Values are indices into `published.nodes`.
#[derive(Debug, Default)]
pub struct NodeIndex {
    by_id: HashMap<u32, u32>,
    by_outpoint: HashMap<Outpoint, u32>,
    by_txid: HashMap<Hash32, Vec<u32>>,
    by_endpoint: HashMap<NodeEndpoint, u32>,
    by_ip: HashMap<IpAddr, Vec<u32>>,
    by_address: HashMap<CompactString, Vec<u32>>,
    by_zelid: HashMap<CompactString, Vec<u32>>,
    /// Active nodes of each tier ordered by queue rank (index 0 is paid next).
    queues: [Vec<u32>; 3],
    /// Active nodes.
    pub active: u32,
    /// Distinct host IPs of active nodes.
    pub hosts: u32,
}

impl NodeIndex {
    pub fn build(nodes: &[NodeRecord]) -> Self {
        let mut ix = Self {
            by_id: HashMap::with_capacity(nodes.len()),
            by_outpoint: HashMap::with_capacity(nodes.len()),
            by_txid: HashMap::with_capacity(nodes.len()),
            by_endpoint: HashMap::with_capacity(nodes.len()),
            ..Self::default()
        };
        let mut active_ips = std::collections::HashSet::new();
        for (i, n) in nodes.iter().enumerate() {
            let i = i as u32;
            let active = n.status.is_active();
            ix.by_id.insert(n.id.0, i);
            ix.by_outpoint.insert(n.outpoint, i);
            ix.by_txid.entry(n.outpoint.txid).or_default().push(i);
            if let Some(ep) = n.endpoint {
                // Prefer the active node when a departed one advertised the same endpoint.
                match ix.by_endpoint.get(&ep) {
                    Some(&prev) if nodes[prev as usize].status.is_active() && !active => {}
                    _ => {
                        ix.by_endpoint.insert(ep, i);
                    }
                }
                ix.by_ip.entry(ep.ip).or_default().push(i);
                if active {
                    active_ips.insert(ep.ip);
                }
            }
            if !n.payment_address.is_empty() {
                ix.by_address
                    .entry(n.payment_address.clone())
                    .or_default()
                    .push(i);
            }
            if let Some(z) = n.zelid.as_ref().filter(|z| !z.is_empty()) {
                ix.by_zelid.entry(z.clone()).or_default().push(i);
            }
            if active {
                ix.active += 1;
                if let (Some(t), Some(_)) = (n.tier.index(), n.rank) {
                    ix.queues[t].push(i);
                }
            }
        }
        for q in &mut ix.queues {
            q.sort_by_key(|&i| (nodes[i as usize].rank, nodes[i as usize].id));
        }
        ix.hosts = active_ips.len() as u32;
        ix
    }

    pub fn position(&self, id: NodeId) -> Option<usize> {
        self.by_id.get(&id.0).map(|&i| i as usize)
    }

    pub fn by_outpoint(&self, o: &Outpoint) -> Option<usize> {
        self.by_outpoint.get(o).map(|&i| i as usize)
    }

    pub fn by_txid(&self, txid: &Hash32) -> &[u32] {
        self.by_txid.get(txid).map_or(&[], Vec::as_slice)
    }

    pub fn by_endpoint(&self, ep: &NodeEndpoint) -> Option<usize> {
        self.by_endpoint.get(ep).map(|&i| i as usize)
    }

    pub fn by_ip(&self, ip: &IpAddr) -> &[u32] {
        self.by_ip.get(ip).map_or(&[], Vec::as_slice)
    }

    pub fn by_address(&self, addr: &str) -> &[u32] {
        self.by_address.get(addr).map_or(&[], Vec::as_slice)
    }

    pub fn by_zelid(&self, zelid: &str) -> &[u32] {
        self.by_zelid.get(zelid).map_or(&[], Vec::as_slice)
    }

    /// Queue of a tier, head first.
    pub fn queue(&self, tier: Tier) -> &[u32] {
        tier.index().map_or(&[], |t| self.queues[t].as_slice())
    }

    /// Every endpoint-bearing node position (for IP prefix search).
    pub fn endpoints(&self) -> impl Iterator<Item = (&NodeEndpoint, usize)> {
        self.by_endpoint.iter().map(|(e, &i)| (e, i as usize))
    }
}

/// Mesh adjacency decoded from the published `mesh.bin`.
#[derive(Debug, Default)]
pub struct Adjacency {
    pub peers: HashMap<u32, Vec<(u32, u8)>>,
}

/// Everything derived from one publish.
#[derive(Debug)]
pub struct Views {
    pub published: Arc<Published>,
    pub index: NodeIndex,
    pub built_ms: u64,
    pub(crate) summary: OnceLock<Arc<CachedBody>>,
    pub(crate) geo: OnceLock<Arc<CachedBody>>,
    pub(crate) providers: OnceLock<Arc<CachedBody>>,
    pub(crate) versions: OnceLock<Arc<CachedBody>>,
    pub(crate) capacity: OnceLock<Arc<CachedBody>>,
    pub(crate) decentralization: OnceLock<Arc<CachedBody>>,
    pub(crate) bootstrap: OnceLock<Arc<CachedBody>>,
    pub(crate) nodes_bin: OnceLock<Arc<CachedBody>>,
    pub(crate) apps_index: OnceLock<Arc<CachedBody>>,
    pub(crate) mesh: OnceLock<Arc<Adjacency>>,
    pub(crate) search: OnceLock<Arc<analytics::SearchCatalog>>,
}

impl Views {
    pub fn build(published: Arc<Published>) -> Self {
        let index = NodeIndex::build(&published.nodes);
        Self {
            published,
            index,
            built_ms: now_ms(),
            summary: OnceLock::new(),
            geo: OnceLock::new(),
            providers: OnceLock::new(),
            versions: OnceLock::new(),
            capacity: OnceLock::new(),
            decentralization: OnceLock::new(),
            bootstrap: OnceLock::new(),
            nodes_bin: OnceLock::new(),
            apps_index: OnceLock::new(),
            mesh: OnceLock::new(),
            search: OnceLock::new(),
        }
    }

    pub fn nodes(&self) -> &[NodeRecord] {
        &self.published.nodes
    }

    pub fn at(&self, pos: usize) -> &NodeRecord {
        &self.published.nodes[pos]
    }

    pub fn node(&self, id: NodeId) -> Option<&NodeRecord> {
        self.index.position(id).map(|i| self.at(i))
    }

    pub fn tip_height(&self) -> Option<u32> {
        self.published.network.tip.as_ref().map(|t| t.height)
    }

    pub fn tip_time_ms(&self) -> Option<u64> {
        self.published.network.tip.as_ref().map(|t| t.time_ms)
    }

    /// Confirmations of a block at `height` against the published tip.
    pub fn confirmations(&self, height: u32) -> Option<u32> {
        self.tip_height()
            .filter(|&t| t >= height)
            .map(|t| t - height + 1)
    }

    /// Resolves a node key: numeric id, `ip[:port]`, or a collateral outpoint in any form
    /// (`txid:n`, `txid-n`, `COutPoint(txid, n)`, or a bare txid when unambiguous).
    pub fn resolve(&self, key: &str) -> Result<&NodeRecord, ApiError> {
        let key = key.trim();
        if key.is_empty() || key.len() > 160 {
            return Err(ApiError::bad_request("invalid node key"));
        }
        if key.bytes().all(|b| b.is_ascii_digit()) {
            let id: u32 = key
                .parse()
                .map_err(|_| ApiError::bad_request("node id out of range"))?;
            return self
                .node(NodeId(id))
                .ok_or_else(|| ApiError::not_found(format!("no node with id {id}")));
        }
        if key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            let txid = Hash32::from_hex(key).map_err(|_| ApiError::bad_request("invalid txid"))?;
            return match self.index.by_txid(&txid) {
                [] => Err(ApiError::not_found("no node with this collateral txid")),
                [one] => Ok(self.at(*one as usize)),
                many => Err(ApiError::bad_request(format!(
                    "{} nodes use this collateral txid; specify the output index (txid:n)",
                    many.len()
                ))),
            };
        }
        if key.len() > 64
            && let Ok(c) = Collateral::parse(key)
        {
            let Some(o) = c.as_full() else {
                return Err(ApiError::bad_request(
                    "collateral txid must be 64 hex characters",
                ));
            };
            return self
                .index
                .by_outpoint(o)
                .map(|i| self.at(i))
                .ok_or_else(|| ApiError::not_found("no node with this collateral"));
        }
        let ep: NodeEndpoint = key
            .parse()
            .map_err(|_| ApiError::bad_request("expected a node id, ip[:port] or collateral"))?;
        let has_port = key.starts_with('[') && key.contains("]:")
            || (!key.starts_with('[') && key.matches(':').count() == 1);
        if let Some(i) = self.index.by_endpoint(&ep) {
            return Ok(self.at(i));
        }
        if !has_port {
            match self.index.by_ip(&ep.ip) {
                [] => {}
                [one] => return Ok(self.at(*one as usize)),
                many => {
                    return Err(ApiError::bad_request(format!(
                        "{} nodes run on {}; specify the port",
                        many.len(),
                        ep.ip
                    )));
                }
            }
        }
        Err(ApiError::not_found(format!("no node at {key}")))
    }

    /// Queue ETA of an active, ranked node.
    pub fn payment_eta(&self, n: &NodeRecord) -> Option<PaymentEta> {
        if !n.status.is_active() {
            return None;
        }
        let rank = n.rank?;
        let tier_size = self.index.queue(n.tier).len() as u32;
        let eta_blocks = rank + 1;
        let tip = self.tip_height()?;
        let amount = tier_payout(tip + eta_blocks, n.tier).unwrap_or(Amount::ZERO);
        Some(PaymentEta {
            rank,
            tier_size,
            eta_blocks,
            eta_ms: self.eta_ms(eta_blocks),
            amount,
        })
    }

    /// Estimated unix ms at which the block `blocks` ahead of the tip lands.
    pub fn eta_ms(&self, blocks: u32) -> u64 {
        let now = now_ms();
        let base = self.tip_time_ms().unwrap_or(now);
        (base + u64::from(blocks) * BLOCK_MS).max(now)
    }

    /// Blocks until the block that drops the node if no confirm arrives first (1 = the next
    /// block; fluxd drops it at `last_confirmed + 641`, see `windows::expiry_height`).
    pub fn expires_in(&self, n: &NodeRecord) -> Option<u32> {
        let tip = self.tip_height()?;
        let last = n.last_confirmed_height.or(n.confirmed_height)?;
        Some(expiry_height(last).saturating_sub(tip))
    }

    pub fn node_ref(&self, id: NodeId) -> Option<NodeRef> {
        self.node(id).map(node_ref)
    }

    pub fn app_entry(&self, name: &str) -> Option<&AppIndexEntry> {
        let key = name.to_ascii_lowercase();
        self.published.apps.iter().find(|a| a.name == key)
    }
}

/// Caches the [`Views`] of the latest publish.
#[derive(Debug, Default)]
pub struct ViewCache {
    cur: ArcSwapOption<Views>,
    build: Mutex<()>,
}

impl ViewCache {
    /// Views of the currently published state, building them on first use after a publish.
    pub fn get(&self, engine: &EngineHandle) -> Arc<Views> {
        let p = engine.published();
        if let Some(v) = self.cur.load_full()
            && Arc::ptr_eq(&v.published, &p)
        {
            return v;
        }
        let _guard = self
            .build
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(v) = self.cur.load_full()
            && Arc::ptr_eq(&v.published, &p)
        {
            return v;
        }
        let v = Arc::new(Views::build(p));
        self.cur.store(Some(Arc::clone(&v)));
        v
    }
}

// ---------------------------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------------------------

fn located(n: &NodeRecord) -> Option<&atlas_core::node::Geo> {
    n.geo.as_ref().filter(|g| g.has_coords())
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

pub fn node_ref(n: &NodeRecord) -> NodeRef {
    let g = located(n);
    NodeRef {
        id: n.id,
        outpoint: n.outpoint,
        tier: n.tier,
        endpoint: n.endpoint.map(|e| e.to_string()),
        lat: g.map(|g| g.lat),
        lon: g.map(|g| g.lon),
        country_code: n.geo.as_ref().and_then(|g| non_empty(&g.country_code)),
        city: n.geo.as_ref().and_then(|g| non_empty(g.city.trim())),
    }
}

pub fn node_row(n: &NodeRecord) -> NodeRow {
    let g = n.geo.as_ref();
    let loc = located(n);
    NodeRow {
        id: n.id,
        outpoint: n.outpoint,
        endpoint: n.endpoint.map(|e| e.to_string()),
        tier: n.tier,
        status: n.status,
        rank: n.rank,
        payment_address: n.payment_address.to_string(),
        country_code: g.and_then(|g| non_empty(&g.country_code)),
        country: g.and_then(|g| non_empty(&g.country)),
        city: g.and_then(|g| non_empty(&g.city)),
        region: g.and_then(|g| non_empty(&g.region)),
        org: g.and_then(|g| non_empty(&g.org)),
        lat: loc.map(|g| g.lat),
        lon: loc.map(|g| g.lon),
        app_count: n.app_count,
        added_height: n.added_height,
        last_paid_height: n.last_paid_height,
        last_confirmed_height: n.last_confirmed_height,
        flux_os: n.versions.flux_os.as_ref().map(ToString::to_string),
        arcane: n.arcane,
        reachable: n.reachable,
    }
}

pub fn node_dto(n: &NodeRecord) -> NodeDto {
    NodeDto {
        id: n.id,
        outpoint: n.outpoint,
        endpoint: n.endpoint.map(|e| e.to_string()),
        ui_url: n.endpoint.map(|e| {
            let base = NodeEndpoint::new(e.ip, e.ui_port());
            base.api_base_url()
        }),
        tier: n.tier,
        status: n.status,
        payment_address: n.payment_address.to_string(),
        pubkey: n.pubkey.to_string(),
        rank: n.rank,
        added_height: n.added_height,
        confirmed_height: n.confirmed_height,
        last_confirmed_height: n.last_confirmed_height,
        last_paid_height: n.last_paid_height,
        active_since_ms: n.active_since_ms,
        geo: n.geo.clone(),
        hardware: n.hw.clone(),
        versions: n.versions.clone(),
        arcane: n.arcane,
        zelid: n.zelid.as_ref().map(ToString::to_string),
        upnp: n.upnp,
        static_ip: n.static_ip,
        reachable: n.reachable,
        app_count: n.app_count,
        peers_out: n.peers_out,
        peers_in: n.peers_in,
        first_seen_ms: n.first_seen_ms,
        last_seen_ms: n.last_seen_ms,
        last_swept_ms: n.last_swept_ms,
        departed_ms: n.departed_ms,
    }
}

pub fn block_lite(b: &BlockSummary) -> BlockLite {
    BlockLite {
        height: b.height,
        hash: b.hash,
        time_ms: b.time_ms,
        size: b.size,
        tx_count: b.tx_count,
        kind: b.kind,
        producer: b.producer,
        payouts: b
            .payouts
            .iter()
            .map(|p| PayoutDto {
                tier: p.tier,
                node: p.node,
                address: p.address.to_string(),
                amount: p.amount,
            })
            .collect(),
        reward: b.reward,
        fees: b.fees,
        confirm_count: b.confirm_count,
        start_count: b.start_count,
        transfer_count: b.transfer_count,
    }
}

/// `/bootstrap` built from the published state (used when the engine has not prebuilt one).
pub fn bootstrap_dto(v: &Views) -> BootstrapDto {
    let p = &v.published;
    let tip = v.tip_height();
    let tiers = Tier::ALL
        .iter()
        .map(|&tier| {
            let q = v.index.queue(tier);
            TierStats {
                tier,
                count: p.network.tiers.get(tier),
                collateral: tier.collateral().unwrap_or(Amount::ZERO),
                payout: tip
                    .and_then(|t| tier_payout(t + 1, tier))
                    .unwrap_or(Amount::ZERO),
                cycle_blocks: q.len() as u32,
                next: q.first().map(|&i| node_ref(v.at(i as usize))),
            }
        })
        .collect();
    BootstrapDto {
        server: p.server.clone(),
        seq: p.seq,
        generated_ms: p.generated_ms,
        stale: p.stale,
        network: p.network.clone(),
        tiers,
        blocks: p.blocks.iter().take(30).cloned().collect(),
        apps: p.apps.to_vec(),
        freshness: Vec::new(),
        attributions: Some(p.attributions.to_vec()),
    }
}

/// `/apps` built from the published state.
pub fn apps_index_dto(p: &Published) -> AppsIndexDto {
    AppsIndexDto {
        seq: p.seq,
        generated_ms: p.generated_ms,
        apps: p.apps.to_vec(),
    }
}

/// `nodes.bin` built from the published state.
pub fn nodes_bin(p: &Published) -> Vec<u8> {
    let tip = p.network.tip.as_ref().map_or(0, |t| t.height);
    let now = now_ms();
    let rows: Vec<NodeBinInput> = p
        .nodes
        .iter()
        .map(|n| NodeBinInput::from_record(n, tip, now, false))
        .collect();
    encode_nodes_bin(p.seq, p.generated_ms, &rows)
}

#[cfg(test)]
mod tests {
    use atlas_core::node::NodeStatus;

    use super::*;

    fn rec(id: u32, ep: &str, tier: Tier, rank: Option<u32>) -> NodeRecord {
        NodeRecord {
            id: NodeId(id),
            outpoint: Outpoint::new(Hash32([id as u8; 32]), id),
            endpoint: NodeEndpoint::parse_opt(ep).unwrap(),
            tier,
            status: NodeStatus::Confirmed,
            payment_address: format!("t1addr{}", id % 2).into(),
            rank,
            ..NodeRecord::default()
        }
    }

    #[test]
    fn index_lookups_and_queues() {
        let nodes = vec![
            rec(0, "1.2.3.4", Tier::Cumulus, Some(1)),
            rec(1, "1.2.3.4:16137", Tier::Cumulus, Some(0)),
            rec(2, "5.6.7.8", Tier::Stratus, None),
        ];
        let ix = NodeIndex::build(&nodes);
        assert_eq!(ix.queue(Tier::Cumulus), &[1, 0]);
        assert_eq!(ix.by_ip(&"1.2.3.4".parse().unwrap()).len(), 2);
        assert_eq!(ix.by_address("t1addr0"), &[0, 2]);
        assert_eq!(ix.hosts, 2);
        assert_eq!(ix.active, 3);
    }
}

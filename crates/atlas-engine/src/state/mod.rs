//! `NetworkState`: the reducer-owned mutable model, and [`Tick`], the change collector one
//! reducer step fills (events, live deltas, feed items, store writes).

pub mod apps;
pub mod mesh;
pub mod queue;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::net::IpAddr;

use atlas_core::api::{NodeRef, PriceInfo, SupplyInfo, TipInfo, TxLite};
use atlas_core::chain::{BlockSummary, TxKind};
use atlas_core::codec::nodes_bin::NodeBinInput;
use atlas_core::event::{Event, NextPayee};
use atlas_core::live::{
    DeltaCause, FeedItem, FeedKind, FeedRef, LiveBody, NodeChange, NodeLite, NodesDelta,
};
use atlas_core::{Amount, NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier, Txid};
use atlas_store::WriteBatch;

use self::apps::AppTable;
use self::mesh::Mesh;
use self::queue::PaymentQueue;

/// Change mask bits for [`NodeChange`] fields.
pub mod mask {
    pub const STATUS: u16 = 1;
    pub const TIER: u16 = 1 << 1;
    pub const ENDPOINT: u16 = 1 << 2;
    pub const GEO: u16 = 1 << 3;
    pub const RANK: u16 = 1 << 4;
    pub const PAID: u16 = 1 << 5;
    pub const CONFIRMED: u16 = 1 << 6;
    pub const APPS: u16 = 1 << 7;
    pub const FLUX_OS: u16 = 1 << 8;
    pub const REACHABLE: u16 = 1 << 9;
    pub const FLAGS: u16 = 1 << 10;
}

/// One node plus reducer bookkeeping.
#[derive(Debug, Clone)]
pub struct NodeEntry {
    pub rec: NodeRecord,
    /// `NodeAtRisk` was emitted since the last confirm.
    pub at_risk: bool,
    /// Height of the last block-derived change. A reconcile against a list older than this
    /// leaves the node alone (the list has not seen the change yet).
    pub touched: u32,
    /// App resources locked on the node (cores, RAM GB, storage GB), from the stats round.
    pub locked: Option<[f64; 3]>,
    /// Consecutive failed direct probes (WatchProbe).
    pub probe_failures: u8,
}

impl NodeEntry {
    fn new(rec: NodeRecord) -> Self {
        Self {
            rec,
            at_risk: false,
            touched: 0,
            locked: None,
            probe_failures: 0,
        }
    }
}

/// True for statuses published as part of the live network view.
pub const fn is_listed(s: NodeStatus) -> bool {
    !matches!(s, NodeStatus::Departed | NodeStatus::Unknown)
}

/// All nodes ever seen, indexed by interned id, with lookup indices.
#[derive(Debug, Default)]
pub struct NodeTable {
    slots: Vec<Option<NodeEntry>>,
    by_outpoint: HashMap<Outpoint, NodeId>,
    by_endpoint: HashMap<NodeEndpoint, NodeId>,
    next_id: u32,
    /// Ids interned since the last drain (persist `node_ids`).
    pub new_interns: Vec<(Outpoint, NodeId)>,
    /// Records to persist at the end of the tick.
    pub persist: HashSet<NodeId>,
    /// Anything visible in `Published.nodes` changed.
    pub dirty: bool,
}

impl NodeTable {
    /// Restores from persisted interning and records.
    pub fn restore(ids: &[(Outpoint, NodeId)], records: Vec<NodeRecord>, next_id: u32) -> Self {
        let mut t = Self {
            next_id,
            ..Self::default()
        };
        for (op, id) in ids {
            t.by_outpoint.insert(*op, *id);
            t.next_id = t.next_id.max(id.0 + 1);
        }
        for rec in records {
            let id = rec.id;
            t.by_outpoint.insert(rec.outpoint, id);
            t.next_id = t.next_id.max(id.0 + 1);
            t.ensure_slot(id);
            if is_listed(rec.status)
                && let Some(ep) = rec.endpoint
            {
                t.by_endpoint.insert(ep, id);
            }
            t.slots[id.0 as usize] = Some(NodeEntry::new(rec));
        }
        t.dirty = true;
        t
    }

    fn ensure_slot(&mut self, id: NodeId) {
        let i = id.0 as usize;
        if self.slots.len() <= i {
            self.slots.resize_with(i + 1, || None);
        }
    }

    pub fn get(&self, id: NodeId) -> Option<&NodeEntry> {
        self.slots.get(id.0 as usize).and_then(Option::as_ref)
    }

    pub fn get_mut(&mut self, id: NodeId) -> Option<&mut NodeEntry> {
        self.slots.get_mut(id.0 as usize).and_then(Option::as_mut)
    }

    pub fn rec(&self, id: NodeId) -> Option<&NodeRecord> {
        self.get(id).map(|e| &e.rec)
    }

    pub fn id_of(&self, op: &Outpoint) -> Option<NodeId> {
        self.by_outpoint.get(op).copied()
    }

    pub fn by_endpoint(&self, ep: &NodeEndpoint) -> Option<NodeId> {
        self.by_endpoint.get(ep).copied()
    }

    /// Resolves an endpoint, falling back to the only listed node on that IP.
    pub fn resolve_endpoint(&self, ep: &NodeEndpoint) -> Option<NodeId> {
        if let Some(id) = self.by_endpoint(ep) {
            return Some(id);
        }
        let mut found = None;
        for (e, id) in &self.by_endpoint {
            if e.ip == ep.ip {
                if found.is_some() {
                    return None;
                }
                found = Some(*id);
            }
        }
        found
    }

    /// Returns the node for `op`, creating an empty record (status `Unknown`) on first sight.
    /// The second value is true when the node was created.
    pub fn intern(&mut self, op: Outpoint, now_ms: u64) -> (NodeId, bool) {
        if let Some(id) = self.by_outpoint.get(&op).copied() {
            if self.get(id).is_some() {
                return (id, false);
            }
            self.ensure_slot(id);
            self.slots[id.0 as usize] = Some(NodeEntry::new(blank(id, op, now_ms)));
            return (id, true);
        }
        let id = NodeId(self.next_id);
        self.next_id += 1;
        self.by_outpoint.insert(op, id);
        self.new_interns.push((op, id));
        self.ensure_slot(id);
        self.slots[id.0 as usize] = Some(NodeEntry::new(blank(id, op, now_ms)));
        (id, true)
    }

    /// Sets the endpoint and keeps the endpoint index in sync. Returns the old endpoint when
    /// it changed.
    pub fn set_endpoint(
        &mut self,
        id: NodeId,
        ep: Option<NodeEndpoint>,
    ) -> Option<Option<NodeEndpoint>> {
        let listed;
        let old = {
            let e = self.get_mut(id)?;
            if e.rec.endpoint == ep {
                return None;
            }
            listed = is_listed(e.rec.status);
            std::mem::replace(&mut e.rec.endpoint, ep)
        };
        if let Some(o) = old
            && self.by_endpoint.get(&o) == Some(&id)
        {
            self.by_endpoint.remove(&o);
        }
        if listed && let Some(n) = ep {
            self.by_endpoint.insert(n, id);
        }
        self.touch_persist(id);
        Some(old)
    }

    /// Sets the status and keeps the endpoint index in sync. Returns the old status if changed.
    pub fn set_status(
        &mut self,
        id: NodeId,
        status: NodeStatus,
        now_ms: u64,
    ) -> Option<NodeStatus> {
        let (old, ep) = {
            let e = self.get_mut(id)?;
            if e.rec.status == status {
                return None;
            }
            let old = std::mem::replace(&mut e.rec.status, status);
            if status == NodeStatus::Departed {
                e.rec.departed_ms = Some(now_ms);
                e.rec.rank = None;
            } else {
                e.rec.departed_ms = None;
            }
            (old, e.rec.endpoint)
        };
        if let Some(ep) = ep {
            if is_listed(status) {
                self.by_endpoint.insert(ep, id);
            } else if self.by_endpoint.get(&ep) == Some(&id) {
                self.by_endpoint.remove(&ep);
            }
        }
        self.touch_persist(id);
        Some(old)
    }

    pub fn touch_persist(&mut self, id: NodeId) {
        self.persist.insert(id);
        self.dirty = true;
    }

    /// Every entry (including departed).
    pub fn iter(&self) -> impl Iterator<Item = &NodeEntry> {
        self.slots.iter().filter_map(Option::as_ref)
    }

    /// Listed (non-departed) entries in id order.
    pub fn listed(&self) -> impl Iterator<Item = &NodeEntry> {
        self.iter().filter(|e| is_listed(e.rec.status))
    }

    pub fn ids(&self) -> Vec<NodeId> {
        self.iter().map(|e| e.rec.id).collect()
    }

    /// Listed nodes on an IP.
    pub fn on_ip(&self, ip: IpAddr) -> Vec<NodeId> {
        self.by_endpoint
            .iter()
            .filter(|(e, _)| e.ip == ip)
            .map(|(_, id)| *id)
            .collect()
    }

    pub fn endpoint_count(&self) -> usize {
        self.by_endpoint.len()
    }
}

fn blank(id: NodeId, op: Outpoint, now_ms: u64) -> NodeRecord {
    NodeRecord {
        id,
        outpoint: op,
        first_seen_ms: now_ms,
        last_seen_ms: now_ms,
        ..NodeRecord::default()
    }
}

/// A transaction currently in the mempool.
#[derive(Debug, Clone)]
pub struct MempoolEntry {
    pub kind: TxKind,
    pub value: Amount,
    pub size: u32,
    pub first_seen_ms: u64,
}

/// Activity counters since the last metrics row.
#[derive(Debug, Clone, Default)]
pub struct IntervalCounters {
    pub blocks: u32,
    pub txs: u32,
    pub node_txs: u32,
    pub fees: Amount,
    pub payouts: Amount,
    pub block_interval_sum_ms: u64,
    pub block_intervals: u32,
}

/// The reducer-owned network model.
#[derive(Debug, Default)]
pub struct NetworkState {
    pub nodes: NodeTable,
    pub queue: PaymentQueue,
    pub apps: AppTable,
    pub mesh: Mesh,
    /// Recent blocks, ascending height (bounded).
    pub recent: VecDeque<BlockSummary>,
    pub tip: Option<TipInfo>,
    pub mempool: HashMap<Txid, MempoolEntry>,
    pub price: Option<PriceInfo>,
    pub supply: Option<SupplyInfo>,
    /// Exact payees of a coming block from `fluxnodecurrentwinner`: height -> (tier, node, address).
    pub expected_payees: BTreeMap<u32, Vec<(Tier, Option<NodeId>, String)>>,
    /// Queue heads published after the last tip.
    pub next_payees: Vec<NextPayee>,
    /// Expiry predictions run only after a reconcile made the confirm heights trustworthy.
    pub expiry_armed: bool,
    /// Stats round last applied.
    pub round_ms: Option<u64>,
    /// Union of all clients' watched nodes.
    pub watched: HashSet<NodeId>,
    pub interval: IntervalCounters,
    /// Transfers at or above this value are `LargeTransfer`s.
    pub large_transfer: Amount,
    /// Lowest height applied live in this database (the backfill fills below it).
    pub live_floor: Option<u32>,
    /// Upstream node counts from the last `getfluxnodecount`.
    pub upstream_counts: Option<[u32; 3]>,
    pub blocks_dirty: bool,
    pub summary_dirty: bool,
}

/// Max blocks kept in memory.
pub const RECENT_BLOCKS: usize = 64;

impl NetworkState {
    pub fn tip_height(&self) -> u32 {
        self.tip.as_ref().map_or(0, |t| t.height)
    }

    /// Recomputes `rank` on every queued record (and clears it elsewhere). Returns the nodes
    /// whose rank changed.
    pub fn apply_ranks(&mut self) -> usize {
        let ranks: HashMap<NodeId, u32> = self.queue.ranks().collect();
        let mut changed = 0;
        let ids = self.nodes.ids();
        for id in ids {
            if let Some(e) = self.nodes.get_mut(id) {
                let r = ranks.get(&id).copied();
                if e.rec.rank != r {
                    e.rec.rank = r;
                    changed += 1;
                }
            }
        }
        if changed > 0 {
            self.nodes.dirty = true;
        }
        changed
    }

    pub fn node_ref(&self, id: NodeId) -> Option<NodeRef> {
        let r = self.nodes.rec(id)?;
        Some(node_ref(r))
    }

    pub fn push_recent(&mut self, b: BlockSummary) {
        while self.recent.back().is_some_and(|x| x.height >= b.height) {
            self.recent.pop_back();
        }
        self.recent.push_back(b);
        while self.recent.len() > RECENT_BLOCKS {
            self.recent.pop_front();
        }
        self.blocks_dirty = true;
    }
}

pub fn node_ref(r: &NodeRecord) -> NodeRef {
    let geo = r.geo.as_ref().filter(|g| g.has_coords());
    NodeRef {
        id: r.id,
        outpoint: r.outpoint,
        tier: r.tier,
        endpoint: r.endpoint.map(|e| e.to_string()),
        lat: geo.map(|g| g.lat),
        lon: geo.map(|g| g.lon),
        country_code: r
            .geo
            .as_ref()
            .map(|g| g.country_code.to_string())
            .filter(|s| !s.is_empty()),
    }
}

/// `NodeLite` of a record (mirrors one `nodes.bin` row).
pub fn node_lite(r: &NodeRecord, tip: u32, now_ms: u64) -> NodeLite {
    let b = NodeBinInput::from_record(r, tip, now_ms, false);
    NodeLite {
        id: r.id,
        outpoint: r.outpoint,
        endpoint: r.endpoint.map(|e| e.to_string()),
        tier: r.tier,
        status: r.status,
        lat: b.lat,
        lon: b.lon,
        country_code: Some(b.country_code).filter(|s| !s.is_empty()),
        org: Some(b.org).filter(|s| !s.is_empty()),
        rank: r.rank,
        last_paid_height: r.last_paid_height,
        app_count: r.app_count,
        flags: b.flags,
    }
}

/// `NodeChange` of a record for the fields in `m`.
pub fn node_change(r: &NodeRecord, m: u16, tip: u32, now_ms: u64) -> NodeChange {
    let b = NodeBinInput::from_record(r, tip, now_ms, false);
    let mut c = NodeChange::new(r.id);
    if m & mask::STATUS != 0 {
        c.status = Some(r.status);
    }
    if m & mask::TIER != 0 {
        c.tier = Some(r.tier);
    }
    if m & mask::ENDPOINT != 0 {
        c.endpoint = r.endpoint.map(|e| e.to_string());
    }
    if m & mask::GEO != 0 {
        c.lat = b.lat;
        c.lon = b.lon;
        c.country_code = Some(b.country_code).filter(|s| !s.is_empty());
        c.org = Some(b.org).filter(|s| !s.is_empty());
    }
    if m & mask::RANK != 0 {
        c.rank = r.rank;
    }
    if m & mask::PAID != 0 {
        c.last_paid_height = r.last_paid_height;
    }
    if m & mask::CONFIRMED != 0 {
        c.last_confirmed_height = r.last_confirmed_height;
    }
    if m & mask::APPS != 0 {
        c.app_count = Some(r.app_count);
    }
    if m & mask::FLUX_OS != 0 {
        c.flux_os = r.versions.flux_os.as_ref().map(ToString::to_string);
    }
    if m & mask::REACHABLE != 0 {
        c.reachable = r.reachable;
    }
    c.flags = Some(b.flags);
    c
}

const fn cause_index(c: DeltaCause) -> u8 {
    match c {
        DeltaCause::Reconcile => 0,
        DeltaCause::Block => 1,
        DeltaCause::Sweep => 2,
        DeltaCause::Geo => 3,
    }
}

const fn cause_from(i: u8) -> DeltaCause {
    match i {
        0 => DeltaCause::Reconcile,
        1 => DeltaCause::Block,
        3 => DeltaCause::Geo,
        _ => DeltaCause::Sweep,
    }
}

/// Node delta under construction (ids and field masks; values are read at flush time).
#[derive(Debug, Default, Clone)]
pub struct NodesDeltaBuilder {
    pub added: BTreeSet<NodeId>,
    pub removed: BTreeSet<NodeId>,
    pub changed: BTreeMap<NodeId, u16>,
}

impl NodesDeltaBuilder {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

/// App delta under construction.
#[derive(Debug, Default, Clone)]
pub struct AppsDeltaBuilder {
    pub upserted: BTreeSet<String>,
    pub removed: BTreeSet<String>,
    /// app -> (started, removed, updated)
    pub instances: BTreeMap<String, [BTreeSet<NodeId>; 3]>,
}

impl AppsDeltaBuilder {
    pub fn is_empty(&self) -> bool {
        self.upserted.is_empty() && self.removed.is_empty() && self.instances.is_empty()
    }
}

/// What one reducer step produced.
#[derive(Debug, Default)]
pub struct Tick {
    pub now_ms: u64,
    /// Domain events with their upstream time.
    pub events: Vec<(Event, Option<u64>)>,
    /// Messages emitted first (for example the `block` message), in order.
    pub primary: Vec<(LiveBody, Option<u64>)>,
    nodes: BTreeMap<u8, NodesDeltaBuilder>,
    apps: BTreeMap<u8, AppsDeltaBuilder>,
    /// Messages emitted after the deltas (next payees, pending apps, ...).
    pub after: Vec<(LiveBody, Option<u64>)>,
    pub feed: Vec<FeedItem>,
    pub batch: WriteBatch,
    /// Publish right after this tick (a block landed).
    pub publish_now: bool,
    /// Something changed that should be published (coalesced).
    pub publish: bool,
}

impl Tick {
    pub fn new(now_ms: u64) -> Self {
        Self {
            now_ms,
            ..Self::default()
        }
    }

    pub fn event(&mut self, e: Event, event_ms: Option<u64>) {
        self.events.push((e, event_ms));
    }

    pub fn node_added(&mut self, cause: DeltaCause, id: NodeId) {
        let b = self.nodes.entry(cause_index(cause)).or_default();
        b.removed.remove(&id);
        b.added.insert(id);
        self.publish = true;
    }

    pub fn node_removed(&mut self, cause: DeltaCause, id: NodeId) {
        let b = self.nodes.entry(cause_index(cause)).or_default();
        b.added.remove(&id);
        b.changed.remove(&id);
        b.removed.insert(id);
        self.publish = true;
    }

    pub fn node_changed(&mut self, cause: DeltaCause, id: NodeId, m: u16) {
        let b = self.nodes.entry(cause_index(cause)).or_default();
        if b.added.contains(&id) || b.removed.contains(&id) {
            return;
        }
        *b.changed.entry(id).or_default() |= m;
        self.publish = true;
    }

    pub fn app_upserted(&mut self, cause: DeltaCause, name: &str) {
        let b = self.apps.entry(cause_index(cause)).or_default();
        b.removed.remove(name);
        b.upserted.insert(name.to_owned());
        self.publish = true;
    }

    pub fn app_removed(&mut self, cause: DeltaCause, name: &str) {
        let b = self.apps.entry(cause_index(cause)).or_default();
        b.upserted.remove(name);
        b.removed.insert(name.to_owned());
        self.publish = true;
    }

    /// Records an instance move: `which` 0 = started, 1 = removed, 2 = updated.
    pub fn app_instance(&mut self, cause: DeltaCause, app: &str, node: NodeId, which: usize) {
        let b = self.apps.entry(cause_index(cause)).or_default();
        b.instances.entry(app.to_owned()).or_default()[which.min(2)].insert(node);
        self.publish = true;
    }

    pub fn feed(
        &mut self,
        kind: FeedKind,
        refs: Vec<FeedRef>,
        params: &[(&str, String)],
        ts_ms: u64,
    ) {
        let key = serde_json::to_value(kind)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        self.feed.push(FeedItem {
            kind,
            ts_ms,
            text_key: format!("feed.{key}"),
            refs,
            params: params
                .iter()
                .map(|(k, v)| ((*k).to_owned(), v.clone()))
                .collect(),
        });
    }

    /// Takes the node deltas: `(cause, builder)`.
    pub fn take_node_deltas(&mut self) -> Vec<(DeltaCause, NodesDeltaBuilder)> {
        std::mem::take(&mut self.nodes)
            .into_iter()
            .filter(|(_, b)| !b.is_empty())
            .map(|(i, b)| (cause_from(i), b))
            .collect()
    }

    pub fn take_app_deltas(&mut self) -> Vec<(DeltaCause, AppsDeltaBuilder)> {
        std::mem::take(&mut self.apps)
            .into_iter()
            .filter(|(_, b)| !b.is_empty())
            .map(|(i, b)| (cause_from(i), b))
            .collect()
    }

    /// Nodes removed in this tick (any cause).
    pub fn removed_nodes(&self) -> Vec<NodeId> {
        self.nodes
            .values()
            .flat_map(|b| b.removed.iter().copied())
            .collect()
    }

    /// Nodes added or whose endpoint changed in this tick (any cause).
    pub fn new_endpoints(&self) -> Vec<NodeId> {
        self.nodes
            .values()
            .flat_map(|b| {
                b.added.iter().copied().chain(
                    b.changed
                        .iter()
                        .filter(|(_, m)| **m & mask::ENDPOINT != 0)
                        .map(|(id, _)| *id),
                )
            })
            .collect()
    }

    /// Node delta builders without taking them (tests).
    pub fn node_delta(&self, cause: DeltaCause) -> Option<&NodesDeltaBuilder> {
        self.nodes.get(&cause_index(cause))
    }

    pub fn app_delta(&self, cause: DeltaCause) -> Option<&AppsDeltaBuilder> {
        self.apps.get(&cause_index(cause))
    }

    /// Events of a kind (tests and counters).
    pub fn count(&self, kind: &str) -> usize {
        self.events.iter().filter(|(e, _)| e.kind() == kind).count()
    }
}

/// Builds the live `nodes` message body for a delta.
pub fn nodes_body(
    nodes: &NodeTable,
    cause: DeltaCause,
    b: &NodesDeltaBuilder,
    prev_seq: u64,
    tip: u32,
    now_ms: u64,
) -> LiveBody {
    LiveBody::Nodes(NodesDelta {
        prev_seq,
        added: b
            .added
            .iter()
            .filter_map(|id| nodes.rec(*id))
            .map(|r| node_lite(r, tip, now_ms))
            .collect(),
        removed: b.removed.iter().copied().collect(),
        changed: b
            .changed
            .iter()
            .filter_map(|(id, m)| nodes.rec(*id).map(|r| node_change(r, *m, tip, now_ms)))
            .collect(),
        cause,
    })
}

/// `TxLite` for a mempool/transfer row.
pub fn tx_lite(txid: Txid, value: Amount, kind: TxKind, size: u32) -> TxLite {
    TxLite {
        txid,
        value,
        kind,
        size,
    }
}

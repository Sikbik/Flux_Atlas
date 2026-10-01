//! Flux Atlas ingest engine (ARCHITECTURE section 3).
//!
//! `Engine::start` restores the last known state from the store and publishes it at once
//! (`stale: true`), then runs the live-first ingest jobs of section 3.2. Every job sends typed
//! observations to one reducer task that owns the mutable [`state::NetworkState`]. The
//! reducer derives fine-grained domain events, persists them with one `WriteBatch` per tick
//! (through a dedicated store-writer thread), emits live messages (one `block` message per block
//! carrying its child events), and rebuilds the immutable [`Published`] state plus its prebuilt
//! bodies off-thread, coalesced to about one per second and immediately after each block.
//!
//! Readers never block: [`EngineHandle::published`] is an `ArcSwap` load, live messages come
//! from a broadcast channel with a replay ring for `since_seq` resumes.
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod body;
pub mod derive;
pub mod freshness;
mod jobs;
pub mod obs;
pub mod publish;
pub mod reducer;
mod replay;
pub mod state;
pub mod stats;
pub mod timemachine;

#[cfg(test)]
mod engine_tests;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use arc_swap::ArcSwap;
use atlas_core::api::{
    AppIndexEntry, BlockLite, JobFreshness, NetworkSummary, ServerInfo, TierStats, TxLite,
};
use atlas_core::live::{LiveBody, LiveMsg, NextPayeeDto};
use atlas_core::{Amount, NodeId, NodeRecord, now_ms};
use atlas_flux::Clients;
use atlas_flux::insight_socket::SocketConfig;
use atlas_store::{RetentionPolicy, Store};
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

pub use body::{Encoding, PrebuiltBodies, PrebuiltBody};
pub use replay::Resync;
pub use stats::{CallCount, EngineStats, Upstream};

use crate::obs::Obs;
use crate::state::NetworkState;

/// `meta` keys owned by the engine.
pub mod meta {
    /// Lowest height applied live (the block backfill fills below it).
    pub const LIVE_FLOOR: &str = "engine.live_floor_height";
    /// Next height the block backfill fetches (it walks downward).
    pub const BACKFILL_BLOCKS_CURSOR: &str = "engine.backfill.blocks_cursor";
    /// Lowest height the block backfill must reach.
    pub const BACKFILL_BLOCKS_TARGET: &str = "engine.backfill.blocks_target";
    /// Unix ms when the tier-count history backfill completed.
    pub const BACKFILL_HISTORY_DONE: &str = "engine.backfill.history_done_ms";
    /// Unix ms when the permanent app-message backfill completed.
    pub const BACKFILL_APP_MESSAGES_DONE: &str = "engine.backfill.app_messages_done_ms";
    /// Unix ms of the last store compaction.
    pub const LAST_COMPACT_MS: &str = "engine.last_compact_ms";
}

/// Bootstrap backfills (background, resumable, polite).
#[derive(Debug, Clone)]
pub struct BackfillConfig {
    /// 30 days of tier counts from `fluxhistorystats` into metrics.
    pub history_stats: bool,
    /// The full permanent app-message history (about 24.5 MB), once.
    pub app_messages: bool,
    /// Days of blocks to backfill through `getblock` (0 disables).
    pub block_days: u32,
    /// Request rate of the block backfill.
    pub blocks_per_second: f64,
}

impl Default for BackfillConfig {
    fn default() -> Self {
        Self {
            history_stats: true,
            app_messages: true,
            block_days: 7,
            blocks_per_second: 1.5,
        }
    }
}

/// Ingest job settings (section 3.2 cadences).
#[derive(Debug, Clone)]
pub struct IngestConfig {
    /// Run the ingest jobs. Defaults to on unless `ATLAS_INGEST` is `0`, `off` or `false`.
    pub enabled: bool,
    pub socket: SocketConfig,
    pub pending_interval: Duration,
    pub installing_interval: Duration,
    /// `/apps/locations` diff interval (60 to 120 s).
    pub placement_interval: Duration,
    /// `/apps/location/<name>` interval for watched (hot) apps.
    pub hot_app_interval: Duration,
    pub catalog_interval: Duration,
    pub install_errors_interval: Duration,
    pub reconcile_interval: Duration,
    /// Minimum spacing of reconciles triggered by count mismatches or reorgs.
    pub reconcile_min_spacing: Duration,
    pub count_interval: Duration,
    pub lists_interval: Duration,
    pub mempool_reconcile_interval: Duration,
    pub price_interval: Duration,
    pub supply_interval: Duration,
    /// How often the stats `roundTime` is checked.
    pub round_check_interval: Duration,
    /// One `/flux/topology` call per this interval.
    pub topology_interval: Duration,
    pub watch_probe_interval: Duration,
    /// Background per-IP geo lookups (new IPs are looked up immediately).
    pub geo_background_interval: Duration,
    /// Gaps up to this many blocks are filled live; larger gaps jump (the backfill fills them).
    pub max_live_gap: u32,
    /// Transfers at or above this value become `LargeTransfer` events.
    pub large_transfer: Amount,
    pub backfill: BackfillConfig,
    pub retention: RetentionPolicy,
    /// Keep global events this long.
    pub events_retention: Duration,
    /// Keep per-node events this long.
    pub node_events_retention: Duration,
    /// Keep mesh change rows this long.
    pub mesh_events_retention: Duration,
    /// Compact the database this often.
    pub compaction_interval: Duration,
}

impl IngestConfig {
    /// Ingest off: the engine only restores, publishes and serves synthetic emits (tests).
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::default()
        }
    }
}

impl Default for IngestConfig {
    fn default() -> Self {
        let enabled = !matches!(
            std::env::var("ATLAS_INGEST")
                .unwrap_or_default()
                .to_ascii_lowercase()
                .as_str(),
            "0" | "off" | "false" | "no"
        );
        Self {
            enabled,
            socket: SocketConfig::default(),
            pending_interval: Duration::from_secs(10),
            installing_interval: Duration::from_secs(10),
            placement_interval: Duration::from_secs(90),
            hot_app_interval: Duration::from_secs(7),
            catalog_interval: Duration::from_secs(600),
            install_errors_interval: Duration::from_secs(900),
            reconcile_interval: Duration::from_secs(600),
            reconcile_min_spacing: Duration::from_secs(120),
            count_interval: Duration::from_secs(60),
            lists_interval: Duration::from_secs(60),
            mempool_reconcile_interval: Duration::from_secs(60),
            price_interval: Duration::from_secs(60),
            supply_interval: Duration::from_secs(600),
            round_check_interval: Duration::from_secs(300),
            topology_interval: Duration::from_secs(12),
            watch_probe_interval: Duration::from_secs(60),
            geo_background_interval: Duration::from_secs(2),
            max_live_gap: 30,
            large_transfer: Amount::from_flux(10_000),
            backfill: BackfillConfig::default(),
            retention: RetentionPolicy::default(),
            events_retention: Duration::from_secs(30 * 86_400),
            node_events_retention: Duration::from_secs(90 * 86_400),
            mesh_events_retention: Duration::from_secs(7 * 86_400),
            compaction_interval: Duration::from_secs(7 * 86_400),
        }
    }
}

/// Engine settings.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Server name reported in `hello` and bootstrap.
    pub server_name: String,
    /// Build version reported in `hello` and bootstrap.
    pub version: String,
    /// Live messages kept for `since_seq` replay.
    pub replay_capacity: usize,
    /// Broadcast channel depth; a subscriber lagging further must resync.
    pub broadcast_capacity: usize,
    /// Keepalive `ping` interval.
    pub ping_interval: Duration,
    /// Ingest jobs.
    pub ingest: IngestConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            server_name: "flux-atlas".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            replay_capacity: 4096,
            broadcast_capacity: 1024,
            ping_interval: Duration::from_secs(20),
            ingest: IngestConfig::default(),
        }
    }
}

/// One immutable published state. Handlers read it through [`EngineHandle::published`].
///
/// `seq` is the live sequence the state was captured at: every live message with a higher
/// seq happened after it (clients subscribe with `since_seq = seq`).
#[derive(Debug, Clone)]
pub struct Published {
    pub seq: u64,
    pub generated_ms: u64,
    /// True while serving state restored from the store before fresh ingest completed.
    pub stale: bool,
    pub server: ServerInfo,
    pub network: NetworkSummary,
    /// Node view (every non-departed node), sorted by node id.
    pub nodes: Arc<[NodeRecord]>,
    /// App index view.
    pub apps: Arc<[AppIndexEntry]>,
    /// Latest blocks, newest first.
    pub blocks: Arc<[BlockLite]>,
    pub bodies: PrebuiltBodies,
    /// Per-tier economics and queue heads.
    pub tiers: Arc<[TierStats]>,
    /// Freshness of every ingest job.
    pub freshness: Arc<[JobFreshness]>,
    /// Predicted payees of the next block.
    pub next_payees: Arc<[NextPayeeDto]>,
    pub mesh_edge_count: u32,
    /// The engine mempool, classified, as `(tx, first_seen_ms)`, newest first.
    pub mempool: Arc<[(TxLite, u64)]>,
}

impl Published {
    fn from_state(server: ServerInfo, st: &NetworkState) -> Self {
        let nodes: Vec<NodeRecord> = st.nodes.listed().map(|e| e.rec.clone()).collect();
        let network = reducer::summarize(st);
        let tiers = reducer::tier_stats(st, &network);
        Self {
            seq: 0,
            generated_ms: now_ms(),
            stale: true,
            server,
            network,
            nodes: nodes.into(),
            apps: st.apps.index().into(),
            blocks: st
                .recent
                .iter()
                .rev()
                .map(publish::block_lite)
                .collect::<Vec<_>>()
                .into(),
            bodies: PrebuiltBodies::default(),
            tiers: tiers.into(),
            freshness: Arc::from(Vec::new()),
            next_payees: Arc::from(Vec::new()),
            mesh_edge_count: st.mesh.edge_count() as u32,
            mempool: st.mempool_list().into(),
        }
    }
}

/// Union of every connection's watches.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WatchSet {
    pub nodes: HashSet<NodeId>,
    /// Lowercase app names.
    pub apps: HashSet<String>,
}

/// Per-connection watches: `conn_id -> (nodes, apps)`.
type Watches = HashMap<u64, (Vec<NodeId>, Vec<String>)>;

struct Inner {
    config: EngineConfig,
    server: ServerInfo,
    store: Store,
    clients: Clients,
    published: ArcSwap<Published>,
    seq: AtomicU64,
    tx: broadcast::Sender<Arc<LiveMsg>>,
    /// Publishing is serialized: seq assignment, ring push and broadcast happen under this lock so
    /// the ring and the channel see the same order.
    ring: std::sync::Mutex<replay::ReplayRing>,
    tasks: std::sync::Mutex<Vec<JoinHandle<()>>>,
    stats: stats::StatsCell,
    freshness: freshness::Freshness,
    watches: std::sync::Mutex<Watches>,
    watch_tx: watch::Sender<WatchSet>,
    shutdown_tx: watch::Sender<bool>,
    obs_tx: std::sync::Mutex<Option<mpsc::Sender<Obs>>>,
}

/// The engine. Construct with [`Engine::start`].
pub struct Engine;

impl Engine {
    /// Starts the engine on the current tokio runtime and returns its handle.
    ///
    /// Restores the last known state from the store and publishes it immediately as `stale`,
    /// then starts the reducer, the store writer and (unless disabled) the ingest jobs.
    pub fn start(config: EngineConfig, store: Store, clients: Clients) -> EngineHandle {
        let server = ServerInfo {
            name: config.server_name.clone(),
            version: config.version.clone(),
            api_version: atlas_core::API_VERSION,
            started_ms: now_ms(),
        };
        let mut st = restore(&store);
        st.large_transfer = config.ingest.large_transfer;
        let first_ingest = store
            .meta_u64(atlas_store::meta_keys::FIRST_INGEST_MS)
            .ok()
            .flatten();
        let last_snapshot = store.snapshot_times().ok().and_then(|v| v.last().copied());
        let (tx, _) = broadcast::channel(config.broadcast_capacity.max(16));
        let (watch_tx, watch_rx) = watch::channel(WatchSet::default());
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (obs_tx, obs_rx) = mpsc::channel::<Obs>(8192);
        let inner = Arc::new(Inner {
            published: ArcSwap::from_pointee(Published::from_state(server.clone(), &st)),
            seq: AtomicU64::new(0),
            ring: std::sync::Mutex::new(replay::ReplayRing::new(config.replay_capacity)),
            tasks: std::sync::Mutex::new(Vec::new()),
            stats: stats::StatsCell::default(),
            freshness: freshness::Freshness::default(),
            watches: std::sync::Mutex::new(HashMap::new()),
            watch_tx,
            shutdown_tx,
            obs_tx: std::sync::Mutex::new(Some(obs_tx.clone())),
            server,
            store: store.clone(),
            clients: clients.clone(),
            config,
            tx,
        });
        let handle = EngineHandle { inner };
        let writer = reducer::spawn_writer(store, handle.clone());
        let ingest = handle.inner.config.ingest.clone();
        let (cmds, cmd_rx) = if ingest.enabled {
            let (c, r) = jobs::commands();
            (Some(c), Some(r))
        } else {
            (None, None)
        };
        let recent: Vec<(u32, atlas_core::BlockHash)> =
            st.recent.iter().map(|b| (b.height, b.hash)).collect();
        let red = reducer::Reducer::new(
            st,
            handle.clone(),
            writer,
            cmds,
            obs_tx.clone(),
            watch_rx.clone(),
            first_ingest,
            last_snapshot,
        );
        // The reducer runs on its own thread (a current-thread runtime): it owns the state and
        // its allocations then stay in one allocator heap instead of migrating across the
        // worker pool, which keeps RSS flat. It stops after the shutdown flush.
        let spawned = std::thread::Builder::new()
            .name("atlas-reducer".to_owned())
            .spawn(move || {
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt.block_on(red.run(obs_rx)),
                    Err(e) => tracing::error!(error = %e, "reducer runtime failed to start"),
                }
            });
        if let Err(e) = spawned {
            tracing::error!(error = %e, "could not spawn the reducer thread");
        }
        let mut tasks = vec![tokio::spawn(ping_loop(handle.clone()))];
        if let Some(rx) = cmd_rx {
            let ctx = jobs::JobCtx::new(
                clients,
                obs_tx,
                handle.clone(),
                Arc::new(ingest),
                shutdown_rx,
                watch_rx,
            );
            tasks.extend(jobs::spawn_all(&ctx, rx, recent));
        }
        handle
            .inner
            .tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .extend(tasks);
        handle
    }
}

/// Restores the reducer state from the store (errors degrade to an empty state).
fn restore(store: &Store) -> NetworkState {
    fn ok<T: Default>(what: &str, r: atlas_store::Result<T>) -> T {
        r.unwrap_or_else(|e| {
            tracing::warn!(error = %e, what, "restore failed; starting without it");
            T::default()
        })
    }
    let ids = ok("node ids", store.node_ids());
    let records = ok("nodes", store.nodes());
    let next = ok("next node id", store.next_node_id().map(|n| n.0));
    let mut st = NetworkState {
        nodes: state::NodeTable::restore(&ids, records, next),
        ..NetworkState::default()
    };
    st.queue.rebuild(
        st.nodes
            .listed()
            .map(|e| &e.rec)
            .filter(|r| r.rank.is_some()),
    );
    // Queue members without a stored rank go by their heights.
    let extra: Vec<(NodeId, atlas_core::Tier, state::queue::QKey)> = st
        .nodes
        .listed()
        .filter(|e| e.rec.status == atlas_core::NodeStatus::Confirmed && e.rec.rank.is_none())
        .map(|e| (e.rec.id, e.rec.tier, state::queue::key_of(&e.rec, u32::MAX)))
        .collect();
    for (id, tier, key) in extra {
        st.queue.upsert(id, tier, key);
    }
    st.apply_ranks();
    st.apps = state::apps::AppTable::restore(
        ok("apps", store.apps()),
        ok("pending app messages", store.pending_app_messages()),
    );
    st.mesh = state::mesh::Mesh::restore(
        ok("mesh edges", store.mesh_edges())
            .into_iter()
            .map(|(a, b, e)| (a, b, e.flags, e.first_seen_ms))
            .collect(),
        atlas_core::now_ms(),
    );
    let mut recent = ok(
        "recent blocks",
        store.blocks_before(u32::MAX, state::RECENT_BLOCKS),
    );
    recent.reverse();
    if let Some(b) = recent.last() {
        st.tip = Some(atlas_core::api::TipInfo {
            height: b.height,
            hash: b.hash,
            time_ms: b.time_ms,
            producer: b.producer,
        });
    }
    st.recent = recent.into();
    st.live_floor = ok("live floor", store.meta_u64(meta::LIVE_FLOOR)).map(|v| v as u32);
    st.blocks_dirty = true;
    st.summary_dirty = true;
    tracing::info!(
        nodes = st.nodes.listed().count(),
        apps = st.apps.records.len(),
        tip = st.tip_height(),
        mesh_edges = st.mesh.edge_count(),
        "engine state restored"
    );
    st
}

async fn ping_loop(h: EngineHandle) {
    let mut iv = tokio::time::interval(h.inner.config.ping_interval);
    iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    iv.tick().await;
    loop {
        iv.tick().await;
        h.emit(None, LiveBody::Ping { now_ms: now_ms() });
    }
}

/// Cheap, cloneable handle to a running engine.
#[derive(Clone)]
pub struct EngineHandle {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for EngineHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineHandle")
            .field("seq", &self.seq())
            .finish_non_exhaustive()
    }
}

impl EngineHandle {
    /// Current published state. Lock-free; hold the `Arc` for as long as a request needs it.
    pub fn published(&self) -> Arc<Published> {
        self.inner.published.load_full()
    }

    /// Subscribes to live messages published from now on.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<LiveMsg>> {
        self.inner.tx.subscribe()
    }

    /// Live messages with `seq > since`, oldest first, or [`Resync`] if the ring no longer holds
    /// them. Callers resuming a connection should `subscribe` first, then replay, then drop
    /// duplicates from the subscription by seq.
    pub fn replay_since(&self, since: u64) -> Result<Vec<Arc<LiveMsg>>, Resync> {
        let ring = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ring.since(since, self.seq())
    }

    /// Latest assigned sequence number.
    pub fn seq(&self) -> u64 {
        self.inner.seq.load(Ordering::Acquire)
    }

    /// Server information (name, version, API version, start time).
    pub fn server_info(&self) -> &ServerInfo {
        &self.inner.server
    }

    /// The `hello` message for a new connection, stamped with the current seq.
    pub fn hello(&self) -> LiveMsg {
        let p = self.published();
        let now = now_ms();
        LiveMsg::new(
            self.seq(),
            now,
            None,
            LiveBody::Hello {
                server: self.inner.server.clone(),
                tip: p.network.tip.clone(),
                now_ms: now,
            },
        )
    }

    /// Store access for read paths the published views do not cover (history, lookups).
    pub fn store(&self) -> &Store {
        &self.inner.store
    }

    /// Upstream clients (for on-demand lookups such as tx or address detail).
    pub fn clients(&self) -> &Clients {
        &self.inner.clients
    }

    /// Assigns the next seq to a live message, records it for replay and broadcasts it.
    /// Used by ingest jobs; public so the server can be tested against a synthetic stream.
    pub fn emit(&self, event_ms: Option<u64>, body: LiveBody) -> Arc<LiveMsg> {
        let mut ring = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let seq = self.inner.seq.load(Ordering::Acquire) + 1;
        let msg = Arc::new(LiveMsg::new(seq, now_ms(), event_ms, body));
        ring.push(Arc::clone(&msg));
        self.inner.seq.store(seq, Ordering::Release);
        // No receivers is fine.
        let _ = self.inner.tx.send(Arc::clone(&msg));
        msg
    }

    /// Replaces the published state. The new state's `seq` is set to the current seq.
    pub fn publish(&self, mut next: Published) {
        let _guard = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        next.seq = self.inner.seq.load(Ordering::Acquire);
        self.inner.published.store(Arc::new(next));
    }

    /// Installs a state built by the reducer, keeping the seq it was captured at (its bodies
    /// were built from that seq, so `since_seq = seq` replays exactly what happened after).
    pub(crate) fn install(&self, next: Published) {
        self.inner.published.store(Arc::new(next));
    }

    /// Replaces the watches of one connection. The union over all connections drives
    /// WatchProbe (direct `/flux/version` every 60 s per watched host) and hot-app polling
    /// (`/apps/location/<name>` every few seconds); watched nodes' events are never coalesced.
    pub fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        let mut w = self
            .inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let apps = apps
            .into_iter()
            .map(|a| a.trim().to_ascii_lowercase())
            .filter(|a| !a.is_empty())
            .collect();
        if nodes.is_empty() && Vec::<String>::is_empty(&apps) {
            w.remove(&conn_id);
        } else {
            w.insert(conn_id, (nodes, apps));
        }
        self.update_watch(&w);
    }

    /// Drops the watches of a closed connection.
    pub fn clear_watch(&self, conn_id: u64) {
        let mut w = self
            .inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if w.remove(&conn_id).is_some() {
            self.update_watch(&w);
        }
    }

    fn update_watch(&self, w: &Watches) {
        let mut set = WatchSet::default();
        for (nodes, apps) in w.values() {
            set.nodes.extend(nodes.iter().copied());
            set.apps.extend(apps.iter().cloned());
        }
        self.inner.watch_tx.send_if_modified(|cur| {
            if *cur == set {
                false
            } else {
                *cur = set;
                true
            }
        });
    }

    /// The current union of watches.
    pub fn watch_set(&self) -> WatchSet {
        self.inner.watch_tx.borrow().clone()
    }

    /// Engine counters (upstream calls, events, latency, reconcile diffs, ...).
    pub fn stats(&self) -> EngineStats {
        self.inner.stats.snapshot()
    }

    /// Current freshness of every ingest job.
    pub fn freshness(&self) -> Vec<JobFreshness> {
        self.inner.freshness.snapshot()
    }

    /// Run counters and freshness of every ingest job (metrics).
    pub fn job_counters(&self) -> Vec<freshness::JobCounters> {
        self.inner.freshness.counters()
    }

    /// Messages held by the engine's replay ring, and its capacity.
    pub fn replay_ring(&self) -> (usize, usize) {
        self.inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len_cap()
    }

    /// Stops the ingest jobs, flushes the store durably, then stops the reducer. The handle
    /// stays readable.
    pub async fn shutdown(&self) {
        let _ = self.inner.shutdown_tx.send(true);
        let obs = self
            .inner
            .obs_tx
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(tx) = obs {
            let (ack, done) = oneshot::channel();
            if tx.send(Obs::Flush(ack)).await.is_ok() {
                let _ = tokio::time::timeout(Duration::from_secs(10), done).await;
            }
        }
        let tasks: Vec<JoinHandle<()>> = self
            .inner
            .tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .drain(..)
            .collect();
        for t in tasks {
            t.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use atlas_flux::ClientsConfig;

    use super::*;

    fn engine() -> (tempfile::TempDir, EngineHandle) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("atlas.redb")).unwrap();
        let clients = Clients::new(ClientsConfig::default()).unwrap();
        let cfg = EngineConfig {
            replay_capacity: 4,
            ping_interval: Duration::from_secs(3600),
            ingest: IngestConfig::disabled(),
            ..EngineConfig::default()
        };
        (dir, Engine::start(cfg, store, clients))
    }

    #[tokio::test]
    async fn starts_stale_and_empty() {
        let (_d, h) = engine();
        let p = h.published();
        assert!(p.stale);
        assert_eq!(p.seq, 0);
        assert_eq!(p.network.node_count, 0);
        assert!(h.replay_since(0).unwrap().is_empty());
        let hello = h.hello().to_json();
        assert!(hello.contains(r#""t":"hello""#), "{hello}");
        h.shutdown().await;
    }

    #[tokio::test]
    async fn emit_broadcasts_and_replays() {
        let (_d, h) = engine();
        let mut rx = h.subscribe();
        for i in 0..6 {
            h.emit(Some(i), LiveBody::Ping { now_ms: i });
        }
        assert_eq!(h.seq(), 6);
        assert_eq!(rx.recv().await.unwrap().seq, 1);
        let r: Vec<u64> = h.replay_since(3).unwrap().iter().map(|m| m.seq).collect();
        assert_eq!(r, vec![4, 5, 6]);
        let e = h.replay_since(1).unwrap_err();
        assert_eq!((e.oldest, e.latest), (3, 6));

        let mut next = (*h.published()).clone();
        next.stale = false;
        h.publish(next);
        assert_eq!(h.published().seq, 6);
        assert!(!h.published().stale);
        h.shutdown().await;
    }

    #[tokio::test]
    async fn watch_union() {
        let (_d, h) = engine();
        h.set_watch(1, vec![NodeId(1), NodeId(2)], vec!["Demo".into()]);
        h.set_watch(2, vec![NodeId(2), NodeId(3)], vec![]);
        let w = h.watch_set();
        assert_eq!(w.nodes.len(), 3);
        assert!(w.apps.contains("demo"));
        h.clear_watch(1);
        let w = h.watch_set();
        assert_eq!(w.nodes.len(), 2);
        assert!(w.apps.is_empty());
        h.set_watch(2, vec![], vec![]);
        assert!(h.watch_set().nodes.is_empty());
        h.shutdown().await;
    }
}

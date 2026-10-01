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
pub mod geoip;
mod jobs;
pub mod liveness;
pub mod obs;
pub mod publish;
pub mod reducer;
pub mod replay;
pub mod state;
pub mod stats;
pub mod timemachine;
pub mod watchset;

#[cfg(test)]
mod engine_tests;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use arc_swap::ArcSwap;
use atlas_core::api::{
    AppIndexEntry, BlockLite, JobFreshness, NetworkSummary, ServerInfo, TierStats, TxLite,
};
use atlas_core::live::{LiveBody, LiveMsg, NextPayeeDto};
use atlas_core::{Amount, Hash32, NodeId, NodeRecord, now_ms};
use atlas_flux::Clients;
use atlas_flux::insight_socket::SocketConfig;
use atlas_flux::models::daemon::DaemonBlock;
use atlas_store::{DiskBudget, HistoryRetention, RetentionPolicy, Store};
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::{AbortHandle, JoinHandle};

pub use body::{Encoding, PrebuiltBodies, PrebuiltBody};
pub use liveness::LivenessReport;
pub use replay::Resync;
pub use stats::{CallCount, EngineStats, StorageStatus, Upstream};

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
    /// Random id of this data directory (u64; `ServerInfo.instance` is its hex form). Node ids
    /// are assigned per data directory, so this names the id space.
    pub const INSTANCE_ID: &str = "engine.instance_id";
    /// Unix ms when the stored blocks were copied into `chain_points` (once, after an upgrade).
    pub const CHAIN_SEEDED_MS: &str = "engine.chain.seeded_ms";
    /// Unix ms of the last daily-difficulty fetch.
    pub const CHAIN_DAILY_MS: &str = "engine.chain.daily_ms";
    /// Unix ms when the chain sampler first found every grid height sampled.
    pub const CHAIN_SAMPLED_MS: &str = "engine.chain.sampled_ms";
    /// Samples the chain sampler stored, over the life of the data directory.
    pub const CHAIN_SAMPLES: &str = "engine.chain.samples";
    /// Upstream requests the chain sampler made (answers and failures), over the life of the
    /// data directory.
    pub const CHAIN_REQUESTS: &str = "engine.chain.requests";
}

/// The data directory's instance id: read from the store, or created (random) and stored on
/// first start. A store that cannot be written still gets a random id for this process.
fn instance_id(store: &Store) -> u64 {
    if let Ok(Some(id)) = store.meta_u64(meta::INSTANCE_ID)
        && id != 0
    {
        return id;
    }
    use std::hash::BuildHasher;
    // `RandomState` is seeded from the OS random source; mix in the time and the pid.
    let id = std::collections::hash_map::RandomState::new()
        .hash_one((now_ms(), std::process::id(), std::thread::current().id()))
        .max(1);
    let mut b = atlas_store::WriteBatch::new();
    b.set_meta_u64(meta::INSTANCE_ID, id);
    if let Err(e) = store.commit_durable(b) {
        tracing::warn!(error = %e, "could not store the instance id");
    }
    id
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

/// The chain sampler: fetches the time and difficulty of every
/// [`atlas_store::CHAIN_SAMPLE_GRID`] height of the chain on the bulk upstream lane, coarse
/// heights first, so the year and all-time chain history fill within minutes and refine over
/// about an hour. Resumable (the stored rows are the progress) and on by default.
#[derive(Debug, Clone)]
pub struct ChainSamplerConfig {
    pub enabled: bool,
    /// Pause between two sample requests.
    pub pause: Duration,
    /// Samples stay this many blocks below the tip (reorgs stay above).
    pub depth: u32,
    /// Fetch Insight's daily difficulty series this often.
    pub daily_interval: Duration,
    /// Look for new grid heights this often once every height is sampled.
    pub idle_interval: Duration,
}

impl Default for ChainSamplerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            pause: Duration::from_secs(1),
            depth: 100,
            daily_interval: Duration::from_secs(86_400),
            idle_interval: Duration::from_secs(1800),
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
    /// The first sync after a restart replays up to this many missed blocks (about 12 h at the
    /// default) instead of jumping, so every payout of the downtime rotates the restored queue
    /// exactly as it rotated upstream. Longer downtime jumps like any large gap.
    pub max_catchup_gap: u32,
    /// Transfers at or above this value become `LargeTransfer` events.
    pub large_transfer: Amount,
    pub backfill: BackfillConfig,
    pub chain_sampler: ChainSamplerConfig,
    pub retention: RetentionPolicy,
    /// Keep global events this long.
    pub events_retention: Duration,
    /// Keep per-node events this long.
    pub node_events_retention: Duration,
    /// Keep mesh change rows this long.
    pub mesh_events_retention: Duration,
    /// Compact the database this often.
    pub compaction_interval: Duration,
    /// Age limits of the history tables (ARCHITECTURE section 5).
    pub history: HistoryRetention,
    /// Disk budget of the database file (`ATLAS_DISK_BUDGET_MB`).
    pub disk_budget: DiskBudget,
    /// Refresh the per-table size report (a full page walk) this often.
    pub table_stats_interval: Duration,
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
            mempool_reconcile_interval: Duration::from_secs(20),
            price_interval: Duration::from_secs(60),
            supply_interval: Duration::from_secs(600),
            round_check_interval: Duration::from_secs(300),
            topology_interval: Duration::from_secs(12),
            watch_probe_interval: Duration::from_secs(60),
            geo_background_interval: Duration::from_secs(2),
            max_live_gap: 30,
            max_catchup_gap: 1_440,
            large_transfer: Amount::from_flux(10_000),
            backfill: BackfillConfig::default(),
            chain_sampler: ChainSamplerConfig::default(),
            retention: RetentionPolicy::default(),
            events_retention: Duration::from_secs(30 * 86_400),
            node_events_retention: Duration::from_secs(90 * 86_400),
            mesh_events_retention: Duration::from_secs(7 * 86_400),
            compaction_interval: Duration::from_secs(7 * 86_400),
            history: HistoryRetention::default(),
            disk_budget: DiskBudget::default(),
            table_stats_interval: Duration::from_secs(6 * 3600),
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
    /// Live messages kept for `since_seq` replay (also bounded to
    /// [`replay::REPLAY_MAX_BYTES`] of serialized messages).
    pub replay_capacity: usize,
    /// Broadcast channel depth; a subscriber lagging further must resync.
    pub broadcast_capacity: usize,
    /// Keepalive `ping` interval.
    pub ping_interval: Duration,
    /// Ingest jobs.
    pub ingest: IngestConfig,
    /// Local GeoIP (DB-IP City Lite).
    pub geoip: geoip::GeoIpConfig,
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
            geoip: geoip::GeoIpConfig::default(),
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
    /// Third-party data credits to show (bootstrap `attributions`).
    pub attributions: Arc<[atlas_core::api::DataAttribution]>,
}

impl Published {
    fn from_state(server: ServerInfo, st: &NetworkState) -> Self {
        let nodes: Vec<NodeRecord> = st.nodes.listed().map(|e| e.rec.clone()).collect();
        // The restored mesh is served from the first request on (M8): without this body,
        // `mesh.bin` answered an empty mesh until the first publish, and a client that booted
        // in that window never received the restored edges (they are not live deltas).
        let generated_ms = now_ms();
        let mut bodies = PrebuiltBodies::default();
        if st.mesh.edge_count() > 0 {
            let edges = st.mesh.edge_list();
            match publish::mesh_body(0, generated_ms, Some(origin_of(&server)), &edges).0 {
                Ok(b) => bodies.mesh_bin = Some(b),
                Err(e) => tracing::error!(error = %e, "initial mesh.bin build failed"),
            }
        }
        let network = reducer::summarize(st);
        let tiers = reducer::tier_stats(st, &network);
        Self {
            seq: 0,
            generated_ms,
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
            bodies,
            tiers: tiers.into(),
            freshness: Arc::from(Vec::new()),
            next_payees: st
                .next_payees
                .iter()
                .map(derive::block::payee_dto)
                .collect::<Vec<_>>()
                .into(),
            mesh_edge_count: st.mesh.edge_count() as u32,
            mempool: st.mempool_list().into(),
            attributions: geoip::attributions(st).into(),
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

struct Inner {
    config: EngineConfig,
    server: ServerInfo,
    store: Store,
    clients: Clients,
    /// The bulk lane of `clients` (background history work).
    bulk: Clients,
    published: ArcSwap<Published>,
    seq: AtomicU64,
    tx: broadcast::Sender<Arc<LiveMsg>>,
    /// Publishing is serialized: seq assignment, ring push and broadcast happen under this lock so
    /// the ring and the channel see the same order.
    ring: std::sync::Mutex<replay::ReplayRing>,
    /// Supervised tasks (aborted on shutdown).
    tasks: std::sync::Mutex<Vec<AbortHandle>>,
    /// Liveness of the supervised parts (section 3.4).
    live: Arc<liveness::Liveness>,
    stats: stats::StatsCell,
    freshness: freshness::Freshness,
    /// Every connection's watches; the union in `watch_tx` changes under this lock.
    watches: std::sync::Mutex<watchset::WatchIndex>,
    watch_tx: watch::Sender<WatchSet>,
    shutdown_tx: watch::Sender<bool>,
    obs_tx: std::sync::Mutex<Option<mpsc::Sender<Obs>>>,
    /// The newest blocks as the BlockDecoder fetched them (`getblock` verbosity 2), so the block
    /// detail of a recent block is served without a second upstream call.
    raw_blocks: std::sync::Mutex<VecDeque<Arc<DaemonBlock>>>,
    /// Hosts whose last topology call was discarded as an outlier, until when TopologySweep
    /// skips them.
    outlier_hosts: std::sync::Mutex<HashMap<std::net::IpAddr, u64>>,
}

/// How long TopologySweep skips a host after one of its calls was discarded as an outlier.
pub const OUTLIER_HOST_SKIP_MS: u64 = 6 * 3_600_000;

/// Raw blocks kept for [`EngineHandle::recent_raw_block`] (about 16 minutes of chain).
const RAW_BLOCKS: usize = 32;

/// The engine. Construct with [`Engine::start`].
pub struct Engine;

impl Engine {
    /// Starts the engine on the current tokio runtime and returns its handle.
    ///
    /// Restores the last known state from the store and publishes it immediately as `stale`,
    /// then starts the reducer, the store writer and (unless disabled) the ingest jobs.
    pub fn start(config: EngineConfig, store: Store, clients: Clients) -> EngineHandle {
        let instance = instance_id(&store);
        let server = ServerInfo {
            name: config.server_name.clone(),
            version: config.version.clone(),
            api_version: atlas_core::API_VERSION,
            started_ms: now_ms(),
            instance: format!("{instance:016x}"),
        };
        tracing::info!(instance = %server.instance, started_ms = server.started_ms, "server identity");
        let mut st = restore(&store);
        st.large_transfer = config.ingest.large_transfer;
        // Local GeoIP: an installed database is mapped right away (microseconds), so the first
        // publish already carries cities. Downloads happen later, in the background.
        if let Some(path) = config.geoip.db_path.as_ref().filter(|p| p.exists()) {
            match geoip::LoadedGeoIp::open_in(path, config.geoip.copy_dir.as_deref()) {
                Ok(g) => {
                    tracing::info!(
                        path = %path.display(),
                        version = ?g.version,
                        bytes = g.db.info().bytes,
                        "geoip: database mapped"
                    );
                    st.geoip = Some(g);
                    let n = geoip::enrich_all(&mut st, None);
                    if n > 0 {
                        tracing::info!(nodes = n, "geoip: restored nodes enriched");
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, path = %path.display(), "geoip: cannot open the database");
                }
            }
        }
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
            live: Arc::new(liveness::Liveness::default()),
            stats: stats::StatsCell::default(),
            freshness: freshness::Freshness::default(),
            watches: std::sync::Mutex::new(watchset::WatchIndex::default()),
            watch_tx,
            shutdown_tx,
            obs_tx: std::sync::Mutex::new(Some(obs_tx.clone())),
            raw_blocks: std::sync::Mutex::new(VecDeque::with_capacity(RAW_BLOCKS)),
            outlier_hosts: std::sync::Mutex::new(HashMap::new()),
            server,
            store: store.clone(),
            bulk: clients.bulk(),
            clients: clients.clone(),
            config,
            tx,
        });
        let handle = EngineHandle { inner };
        let writer = reducer::spawn_writer(store, &handle);
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
        // worker pool, which keeps RSS flat. It stops after the shutdown flush. It is
        // supervised: a panic or an unexpected stop marks the engine dead (section 3.4).
        let live = Arc::clone(&handle.inner.live);
        let spawned = std::thread::Builder::new()
            .name("atlas-reducer".to_owned())
            .spawn(move || {
                liveness::supervise_thread(&live, "reducer", || {
                    match tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                    {
                        Ok(rt) => rt.block_on(red.run(obs_rx)),
                        Err(e) => tracing::error!(error = %e, "reducer runtime failed to start"),
                    }
                });
            });
        if let Err(e) = spawned {
            handle
                .inner
                .live
                .fatal(format!("could not spawn the reducer thread: {e}"));
        }
        let mut tasks = vec![
            handle.supervise("ping", ping_loop(handle.clone())),
            handle.supervise("watchdog", watchdog(handle.clone())),
        ];
        if let Some(rx) = cmd_rx {
            let ctx = jobs::JobCtx::new(
                clients,
                obs_tx,
                handle.clone(),
                Arc::new(ingest),
                shutdown_rx,
                watch_rx,
            );
            for (name, job) in jobs::spawn_all(&ctx, rx, recent) {
                tasks.push(handle.watch_task(name, job));
            }
            let geo = handle.inner.config.geoip.clone();
            tasks
                .push(handle.supervise("geoip_db", jobs::geoip::run(ctx.for_job("geoip_db"), geo)));
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

/// How often the watchdog checks the supervised parts.
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(5);

/// Marks the engine dead when the reducer, the store writer or the publisher stalls.
async fn watchdog(h: EngineHandle) {
    let mut iv = tokio::time::interval(WATCHDOG_INTERVAL);
    iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        iv.tick().await;
        if h.inner.live.stopping() {
            return;
        }
        h.inner.live.check(now_ms());
    }
}

/// A fault to inject (tests of the supervision, section 3.4).
#[cfg(any(test, feature = "fault-injection"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    /// The reducer panics while applying an observation.
    ReducerPanic,
    /// The store writer panics on its next command.
    WriterPanic,
    /// A supervised job task panics.
    JobPanic,
    /// The reducer thread blocks for this long (a stall).
    ReducerStall(Duration),
}

/// The binary-snapshot origin of a server.
pub fn origin_of(s: &ServerInfo) -> atlas_core::codec::Origin {
    atlas_core::codec::Origin {
        started_ms: s.started_ms,
        instance: atlas_core::codec::Origin::parse_instance(&s.instance).unwrap_or(0),
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
    // The queue key is a function of the record (fluxd's order), so the restored queue is exact.
    st.queue.rebuild(st.nodes.listed().map(|e| &e.rec));
    st.apply_ranks();
    // The restored queue heads are the next block's payees: the first bootstrap carries them.
    st.next_payees = derive::block::next_payees(&st);
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
    // A store that has been reconciled before holds a block-exact model at its tip: the blocks
    // replayed after a restart derive expiry and DOS like live blocks, so nodes that expired
    // during the downtime leave the queue at their real height instead of at the first
    // reconcile (which would shift every rank behind them for clients).
    let reconciled = ok(
        "first ingest",
        store.meta_u64(atlas_store::meta_keys::FIRST_INGEST_MS),
    )
    .is_some();
    st.expiry_armed = reconciled
        && st.tip.is_some()
        && st
            .nodes
            .listed()
            .any(|e| e.rec.status == atlas_core::NodeStatus::Confirmed);
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

    /// A recent block exactly as the BlockDecoder fetched it, by hash (the newest
    /// [`RAW_BLOCKS`]). The block detail endpoint uses it instead of a second upstream call.
    pub fn recent_raw_block(&self, hash: &Hash32) -> Option<Arc<DaemonBlock>> {
        let want = hash.to_hex();
        self.inner
            .raw_blocks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .rev()
            .find(|b| b.hash.eq_ignore_ascii_case(&want))
            .cloned()
    }

    /// Keeps a fetched block for [`Self::recent_raw_block`].
    pub(crate) fn keep_raw_block(&self, b: Arc<DaemonBlock>) {
        let mut q = self
            .inner
            .raw_blocks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if q.iter().any(|x| x.hash == b.hash) {
            return;
        }
        if q.len() >= RAW_BLOCKS {
            q.pop_front();
        }
        q.push_back(b);
    }

    /// Records the outlier verdict of a topology call to `ip`: a discarded call makes
    /// TopologySweep skip the host for [`OUTLIER_HOST_SKIP_MS`]; an accepted one clears it.
    pub(crate) fn note_topology_host(&self, ip: std::net::IpAddr, outlier: bool, now: u64) {
        let mut m = self
            .inner
            .outlier_hosts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if outlier {
            m.insert(ip, now + OUTLIER_HOST_SKIP_MS);
        } else {
            m.remove(&ip);
        }
        if m.len() > 4096 {
            m.retain(|_, until| *until > now);
        }
    }

    /// True while TopologySweep should skip `ip` (its last call was an outlier).
    pub fn topology_host_skipped(&self, ip: &std::net::IpAddr, now: u64) -> bool {
        self.inner
            .outlier_hosts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(ip)
            .is_some_and(|until| *until > now)
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

    /// Serialized bytes held by the replay ring.
    pub fn replay_bytes(&self) -> usize {
        self.inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .bytes()
    }

    /// Latest assigned sequence number.
    pub fn seq(&self) -> u64 {
        self.inner.seq.load(Ordering::Acquire)
    }

    /// Server information (name, version, API version, start time, instance).
    pub fn server_info(&self) -> &ServerInfo {
        &self.inner.server
    }

    /// The origin stamped into this server's binary snapshots (section ORIGIN).
    pub fn origin(&self) -> atlas_core::codec::Origin {
        origin_of(&self.inner.server)
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

    /// Bulk-lane clients (the chain sampler's): own gates and breakers, the smallest budget.
    pub fn bulk_clients(&self) -> &Clients {
        &self.inner.bulk
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

    /// Replaces the watches of one connection, in the client's order (its selection first).
    /// The connections' watches drive WatchProbe (direct `/flux/version` every 60 s per
    /// watched host) and hot-app polling (`/apps/location/<name>` every few seconds), both
    /// picked by fair share ([`Self::hot_apps`], [`Self::probe_nodes`]); watched nodes' events
    /// are never coalesced. Costs O(this connection's lists), not O(every connection).
    pub fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        let mut w = self
            .inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let delta = w.set(conn_id, nodes, apps);
        self.update_watch(&delta);
    }

    /// Drops the watches of a closed connection.
    pub fn clear_watch(&self, conn_id: u64) {
        let mut w = self
            .inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let delta = w.clear(conn_id);
        self.update_watch(&delta);
    }

    /// Applies a union change. Called with the index lock held, so deltas reach the channel in
    /// the order the index produced them.
    fn update_watch(&self, delta: &watchset::WatchDelta) {
        if delta.is_empty() {
            return;
        }
        self.inner.watch_tx.send_if_modified(|cur| delta.apply(cur));
    }

    /// Up to `n` watched apps to poll, by fair share across connections (most-watched first;
    /// one connection votes for a few of its apps only).
    pub fn hot_apps(&self, n: usize) -> Vec<String> {
        self.inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .hot_apps(n)
    }

    /// Up to `n` watched nodes to probe, by fair share across connections.
    pub fn probe_nodes(&self, n: usize) -> Vec<NodeId> {
        self.inner
            .watches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .probe_nodes(n)
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

    /// Spawns a supervised task: a panic marks the engine dead (section 3.4).
    fn supervise(
        &self,
        name: &'static str,
        fut: impl std::future::Future<Output = ()> + Send + 'static,
    ) -> AbortHandle {
        self.watch_task(name, tokio::spawn(fut))
    }

    /// Supervises a spawned task: a panic marks the engine dead; a normal end is logged (some
    /// jobs finish on purpose, for example a completed backfill or a disabled download).
    fn watch_task(&self, name: &'static str, task: JoinHandle<()>) -> AbortHandle {
        let abort = task.abort_handle();
        let live = Arc::clone(&self.inner.live);
        tokio::spawn(async move {
            match task.await {
                Ok(()) => {
                    if !live.stopping() {
                        tracing::info!(task = name, "engine task finished");
                    }
                }
                Err(e) if e.is_panic() => {
                    let msg = liveness::panic_message(e.into_panic().as_ref());
                    live.fatal(format!("task {name} panicked: {msg}"));
                }
                Err(_) => {}
            }
        });
        abort
    }

    /// Liveness of the engine's supervised parts (health endpoints, metrics).
    pub fn liveness(&self) -> LivenessReport {
        self.inner.live.report()
    }

    /// Resolves with the reason once the engine is dead (a supervised part panicked, stopped
    /// or stalled). The server then shuts down and exits non-zero, so it is restarted.
    pub async fn died(&self) -> String {
        self.inner.live.died().await
    }

    pub(crate) fn live(&self) -> &liveness::Liveness {
        &self.inner.live
    }

    /// Injects a fault (tests of the supervision).
    #[cfg(any(test, feature = "fault-injection"))]
    pub async fn inject_fault(&self, fault: Fault) {
        if fault == Fault::JobPanic {
            let a = self.supervise("fault_injection", async {
                panic!("injected job panic");
            });
            self.inner
                .tasks
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(a);
            return;
        }
        let tx = self
            .inner
            .obs_tx
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(tx) = tx {
            let _ = tx.send(Obs::Fault(fault)).await;
        }
    }

    /// Stops the ingest jobs, flushes the store durably, then stops the reducer. The handle
    /// stays readable.
    pub async fn shutdown(&self) {
        self.inner.live.begin_stop();
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
        let tasks: Vec<AbortHandle> = self
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
        // Fair-share picks read the same index.
        h.set_watch(3, vec![NodeId(7)], vec!["b".into(), "a".into()]);
        h.set_watch(4, vec![NodeId(8)], vec!["a".into()]);
        assert_eq!(h.hot_apps(1), vec!["a".to_owned()]);
        assert_eq!(h.probe_nodes(8).len(), 2);
        h.shutdown().await;
    }
}

//! Shared request state.

use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::AppRef;
use atlas_engine::EngineHandle;
use atlas_store::Store;

use crate::body::CachedBody;
use crate::config::ServerConfig;
use crate::derived::DerivedGuard;
use crate::error::ApiError;
use crate::explorer::Explorer;
use crate::keep::KeepGood;
use crate::ledger::{AppLedger, PayoutLedger, Slot};
use crate::live::hub::Hub;
use crate::metrics::Metrics;
use crate::net::ForwardStats;
use crate::net::listener::Listener;
use crate::proxy::TtlCache;
use crate::sources::{FusionMeta, FusionWallet, LiveSources, MarketSources, Spot};
use crate::views::{ViewCache, Views};
use crate::wallet::fleet::FleetLedger;
use crate::watch::WatchHooks;

/// Cheap, cloneable application state.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

/// Everything handlers share.
pub struct Inner {
    pub engine: EngineHandle,
    pub hooks: Arc<dyn WatchHooks>,
    pub cfg: ServerConfig,
    pub started: Instant,
    pub views: ViewCache,
    pub explorer: Explorer,
    pub metrics: Metrics,
    pub hub: Arc<Hub>,
    /// Connection caps and counters of the HTTP listener.
    pub listener: Arc<Listener>,
    /// How client addresses were derived (anonymised counters).
    pub forward: ForwardStats,
    /// Per-client and global limits of the per-request compute routes.
    pub derived: DerivedGuard,
    /// Bounds the store reads running at once (each holds a blocking thread).
    store_reads: Arc<tokio::sync::Semaphore>,
    /// `/nodes` pages keyed by the normalized query and the publish they were built from.
    pub nodes_cache: moka::future::Cache<String, Arc<CachedBody>>,
    /// `/metrics` series responses, keyed by the normalized request (15 s).
    pub metrics_cache: moka::future::Cache<String, Arc<CachedBody>>,
    /// `/timeline/state` reconstructions keyed by `t` (60 s).
    pub timeline_cache: moka::future::Cache<u64, Arc<CachedBody>>,
    /// `/blocks` pages wholly below the finality window, keyed by `(before, limit)` (10 min).
    pub blocks_cache: moka::future::Cache<(u32, u32), Arc<CachedBody>>,
    /// Other `/blocks` pages keyed by `(before, limit, tip hash prefix)` (10 s).
    pub recent_blocks_cache: moka::future::Cache<(u32, u32, u64), Arc<CachedBody>>,
    /// `/network/app-economy` bodies keyed by `(tip, days, top)` (60 s).
    pub economy_cache: moka::future::Cache<(u32, u32, u32), Arc<CachedBody>>,
    /// `/network/chain-history` bodies keyed by `(window, period)`: one computation per window
    /// per reuse period (30 s to 10 min, see [`crate::chain_history::cache_policy`]).
    pub chain_cache: moka::future::Cache<(atlas_core::api::ChainWindow, u64), Arc<CachedBody>>,
    /// Payouts of the last 30 days by address (operator earnings).
    pub payouts: Arc<Slot<PayoutLedger>>,
    /// Every permanent app message, compact (app economy).
    pub app_messages: Arc<Slot<AppLedger>>,
    hosted: tokio::sync::Mutex<HostedSlot>,
    /// Fusion and CoinGecko (live, or fixed answers in the demo server and tests).
    pub sources: Arc<dyn MarketSources>,
    /// `/wallet/{addr}` bodies by address (30 s).
    pub wallet_cache: moka::future::Cache<String, Arc<CachedBody>>,
    /// Fusion's answers by address (10 min), single-flight and charged like explorer lookups.
    pub fusion_wallets: TtlCache<String, FusionWallet>,
    /// Fusion's fee table and active chains (12 h, last good copy).
    pub fusion_meta: Arc<KeepGood<FusionMeta>>,
    /// CoinGecko spot prices (5 min) and daily history (12 h), last good copies.
    pub spot: Arc<KeepGood<Spot>>,
    pub price_history: Arc<KeepGood<Vec<atlas_core::api::PricePoint>>>,
    /// Daily fleet sizes by address from the stored keyframes (rebuilt every 3 hours).
    pub fleet: Arc<KeepGood<FleetLedger>>,
}

/// Node id to the apps with an instance on it.
pub type HostedApps = Arc<HashMap<u32, Vec<AppRef>>>;

/// The hosted-apps map and whether a rebuild is running.
#[derive(Default)]
pub struct HostedSlot {
    map: Option<(Instant, HostedApps)>,
    refreshing: bool,
}

/// How long the hosted-apps map (built from stored app locations) is reused.
const HOSTED_TTL: Duration = Duration::from_secs(30);

/// Byte bound of the `/metrics` series response cache.
pub const METRICS_CACHE_BYTES: u64 = 16 << 20;
/// Byte bound of the `/timeline/state` cache (a reconstruction is about one `nodes.bin`).
pub const TIMELINE_CACHE_BYTES: u64 = 24 << 20;
/// Byte bound of the `/nodes` page cache.
pub const NODES_CACHE_BYTES: u64 = 16 << 20;
/// Byte bound of the `/wallet` body cache (a 210-node wallet is about 350 KB).
pub const WALLET_CACHE_BYTES: u64 = 24 << 20;
/// Byte bound of the Fusion answers (a few KB per address).
pub const FUSION_CACHE_BYTES: u64 = 4 << 20;

/// Store reads running at once. Each holds a blocking-pool thread; during a compaction they all
/// wait on the database lock, so the bound keeps a compaction from piling up threads.
pub const STORE_READ_CONCURRENCY: usize = 32;
/// Longest a request waits for a store read (including its turn) before a 503.
pub const STORE_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Cache weight of a body: the raw bytes plus room for the compressed variants it builds
/// lazily once cached.
fn body_weight(key_len: usize, b: &CachedBody) -> u32 {
    u32::try_from(b.raw().len() * 2 + key_len + 256).unwrap_or(u32::MAX)
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("engine", &self.engine)
            .field("ws_connections", &self.hub.connections())
            .finish_non_exhaustive()
    }
}

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}

impl AppState {
    /// State whose watch hooks forward to the engine. Must run inside a tokio runtime (it spawns
    /// the live hub and a maintenance task).
    pub fn new(engine: EngineHandle, cfg: ServerConfig) -> Self {
        let hooks: Arc<dyn WatchHooks> = Arc::new(engine.clone());
        Self::with_hooks(engine, cfg, hooks)
    }

    /// State with explicit watch hooks (tests record the calls).
    pub fn with_hooks(engine: EngineHandle, cfg: ServerConfig, hooks: Arc<dyn WatchHooks>) -> Self {
        Self::with_parts(engine, cfg, hooks, None)
    }

    /// State with explicit market sources (the demo server's and tests' fixed answers); `None`
    /// asks Fusion on the explorer's interactive lane and CoinGecko on the bulk lane.
    pub fn with_parts(
        engine: EngineHandle,
        cfg: ServerConfig,
        hooks: Arc<dyn WatchHooks>,
        sources: Option<Arc<dyn MarketSources>>,
    ) -> Self {
        let ring = 4096;
        let hub = Hub::start(&engine, cfg.ws.clone(), ring);
        // User lookups draw from their own upstream lane (gates and breakers), never from the
        // ingest's budget (X1 M2).
        let explorer = Explorer::new(engine.clients().interactive(), cfg.proxy, cfg.limits);
        let sources = sources.unwrap_or_else(|| {
            Arc::new(LiveSources {
                fusion: explorer.clients().fusion.clone(),
                coingecko: engine.bulk_clients().coingecko.clone(),
            })
        });
        let listener = Listener::new(cfg.http.clone(), cfg.proxies.clone());
        let derived = DerivedGuard::new(cfg.derived);
        let state = Self {
            inner: Arc::new(Inner {
                hooks,
                listener,
                forward: ForwardStats::default(),
                derived,
                store_reads: Arc::new(tokio::sync::Semaphore::new(STORE_READ_CONCURRENCY)),
                nodes_cache: moka::future::Cache::builder()
                    .max_capacity(NODES_CACHE_BYTES)
                    .weigher(|k: &String, v: &Arc<CachedBody>| body_weight(k.len(), v))
                    .time_to_live(Duration::from_secs(30))
                    .build(),
                started: Instant::now(),
                views: ViewCache::default(),
                explorer,
                metrics: Metrics::default(),
                hub,
                cfg,
                engine,
                hosted: tokio::sync::Mutex::new(HostedSlot::default()),
                metrics_cache: moka::future::Cache::builder()
                    .max_capacity(METRICS_CACHE_BYTES)
                    .weigher(|k: &String, v: &Arc<CachedBody>| body_weight(k.len(), v))
                    .time_to_live(Duration::from_secs(15))
                    .build(),
                timeline_cache: moka::future::Cache::builder()
                    .max_capacity(TIMELINE_CACHE_BYTES)
                    .weigher(|_: &u64, v: &Arc<CachedBody>| body_weight(8, v))
                    .time_to_live(Duration::from_secs(60))
                    .build(),
                blocks_cache: moka::future::Cache::builder()
                    .max_capacity(128)
                    .time_to_live(Duration::from_secs(600))
                    .build(),
                recent_blocks_cache: moka::future::Cache::builder()
                    .max_capacity(64)
                    .time_to_live(Duration::from_secs(10))
                    .build(),
                economy_cache: moka::future::Cache::builder()
                    .max_capacity(32)
                    .time_to_live(Duration::from_secs(60))
                    .build(),
                chain_cache: moka::future::Cache::builder()
                    .max_capacity(16)
                    .time_to_live(Duration::from_secs(600))
                    .build(),
                payouts: Arc::default(),
                app_messages: Arc::default(),
                sources,
                wallet_cache: moka::future::Cache::builder()
                    .max_capacity(WALLET_CACHE_BYTES)
                    .weigher(|k: &String, v: &Arc<CachedBody>| body_weight(k.len(), v))
                    .time_to_live(crate::wallet::WALLET_TTL)
                    .build(),
                fusion_wallets: TtlCache::new("parallel assets", FUSION_CACHE_BYTES),
                fusion_meta: Arc::new(KeepGood::new(
                    crate::wallet::FUSION_META_TTL,
                    Duration::from_secs(60),
                )),
                spot: Arc::new(KeepGood::new(
                    crate::wallet::SPOT_TTL,
                    Duration::from_secs(60),
                )),
                price_history: Arc::new(KeepGood::new(
                    crate::wallet::HISTORY_TTL,
                    Duration::from_secs(300),
                )),
                fleet: Arc::new(KeepGood::new(
                    crate::wallet::FLEET_TTL,
                    Duration::from_secs(600),
                )),
            }),
        };
        let weak = Arc::downgrade(&state.inner);
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(60));
            iv.tick().await;
            loop {
                iv.tick().await;
                let Some(inner) = weak.upgrade() else { break };
                inner.explorer.guard.prune();
                inner.derived.prune();
                inner.hub.prune();
            }
        });
        // Build the ledgers once in the background, so the first request after a start does
        // not wait for them (the app-message ledger reads every stored message: about 1 s on a
        // cold page cache).
        let weak = Arc::downgrade(&state.inner);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let Some(inner) = weak.upgrade() else { return };
            let s = Self { inner };
            if let Err(e) = s.payout_ledger().await {
                tracing::debug!(error = %e.message, "payout ledger warm-up failed");
            }
            if let Err(e) = s.app_ledger().await {
                tracing::debug!(error = %e.message, "app ledger warm-up failed");
            }
            // Starts the fleet ledger build (it reads a keyframe per stored day).
            let _ = s.fleet_ledger().await;
        });
        state
    }

    /// Views of the current publish.
    pub fn views(&self) -> Arc<Views> {
        self.views.get(&self.engine)
    }

    /// Runs a store read on the blocking pool, at most [`STORE_READ_CONCURRENCY`] at once and
    /// within [`STORE_READ_TIMEOUT`] (503 with `Retry-After` otherwise, for example while a
    /// compaction holds the database). A read that times out finishes in the background and
    /// keeps its slot until then.
    pub async fn store_read<T, F>(&self, f: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&Store) -> Result<T, ApiError> + Send + 'static,
    {
        self.store_read_within(STORE_READ_TIMEOUT, f).await
    }

    /// [`Self::store_read`] with an explicit deadline.
    pub async fn store_read_within<T, F>(&self, limit: Duration, f: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&Store) -> Result<T, ApiError> + Send + 'static,
    {
        let engine = self.engine.clone();
        let reads = Arc::clone(&self.store_reads);
        let run = async move {
            let permit = reads
                .acquire_owned()
                .await
                .map_err(|_| ApiError::unavailable("shutting down"))?;
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                f(engine.store())
            })
            .await?
        };
        if let Ok(r) = tokio::time::timeout(limit, run).await {
            r
        } else {
            self.metrics
                .store_timeouts
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Err(
                ApiError::unavailable("the database is busy; try again shortly")
                    .with_retry_after(5),
            )
        }
    }

    /// Store reads waiting for or holding a slot right now.
    pub fn store_reads_in_use(&self) -> usize {
        STORE_READ_CONCURRENCY - self.store_reads.available_permits()
    }

    /// Apps hosted per node, rebuilt from the store at most every 30 s. Only the first request
    /// waits for the build (reading every app record takes tens of ms); after that a stale map is
    /// served while one background task rebuilds it, so node detail stays a memory read.
    pub async fn hosted_apps(&self) -> Result<HostedApps, ApiError> {
        let mut slot = self.hosted.lock().await;
        if let Some((at, map)) = slot.map.as_ref() {
            let map = Arc::clone(map);
            if at.elapsed() >= HOSTED_TTL && !slot.refreshing {
                slot.refreshing = true;
                let s = self.clone();
                tokio::spawn(async move {
                    let built = s.build_hosted().await;
                    let mut slot = s.hosted.lock().await;
                    slot.refreshing = false;
                    if let Ok(m) = built {
                        slot.map = Some((Instant::now(), m));
                    }
                });
            }
            return Ok(map);
        }
        let map = self.build_hosted().await?;
        slot.map = Some((Instant::now(), Arc::clone(&map)));
        Ok(map)
    }

    async fn build_hosted(&self) -> Result<HostedApps, ApiError> {
        self.store_read(|st| Ok(Arc::new(crate::routes::nodes::hosted_map(&st.apps()?))))
            .await
    }

    /// The payout ledger, rebuilt in the background when the tip moves (at most every 20 s).
    pub async fn payout_ledger(&self) -> Result<Arc<PayoutLedger>, ApiError> {
        let key = u64::from(self.views().tip_height().unwrap_or(0));
        let s = self.clone();
        self.payouts
            .get(
                key,
                Duration::from_secs(20),
                Duration::from_secs(600),
                move || async move { s.store_read(PayoutLedger::build).await },
            )
            .await
    }

    /// The app-message ledger, rebuilt in the background when an app record moves to a newer
    /// message or the history backfill completes (at most every 60 s).
    pub async fn app_ledger(&self) -> Result<Arc<AppLedger>, ApiError> {
        let newest = self
            .engine
            .published()
            .apps
            .iter()
            .map(|a| a.height)
            .max()
            .unwrap_or(0);
        let complete = self.history_complete();
        let key = u64::from(newest) << 1 | u64::from(complete);
        let s = self.clone();
        self.app_messages
            .get(
                key,
                Duration::from_secs(60),
                Duration::from_secs(1800),
                move || async move { s.store_read(move |st| AppLedger::build(st, complete)).await },
            )
            .await
    }

    /// The fleet ledger when it is built; never waits (the first call starts the build, which
    /// reads one keyframe per stored day on the blocking pool).
    pub async fn fleet_ledger(&self) -> Option<Arc<FleetLedger>> {
        let s = self.clone();
        self.fleet
            .peek(move || async move {
                s.store_read_within(Duration::from_secs(120), |st| {
                    let t = Instant::now();
                    let l = FleetLedger::build(st)?;
                    tracing::info!(
                        days = l.day_count(),
                        ms = t.elapsed().as_millis() as u64,
                        "fleet ledger built"
                    );
                    Ok(l)
                })
                .await
            })
            .await
            .map(|(_, l)| l)
    }

    /// The one-time permanent app-message backfill has finished.
    pub fn history_complete(&self) -> bool {
        self.engine
            .store()
            .meta_u64(atlas_engine::meta::BACKFILL_APP_MESSAGES_DONE)
            .ok()
            .flatten()
            .is_some()
    }

    /// Closes live connections and refuses new ones.
    pub fn begin_shutdown(&self) {
        self.hub.begin_shutdown();
    }
}

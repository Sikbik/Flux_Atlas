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
use crate::error::ApiError;
use crate::explorer::Explorer;
use crate::live::hub::Hub;
use crate::metrics::Metrics;
use crate::views::{ViewCache, Views};
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
    /// `/metrics` series responses, keyed by the normalized request (15 s).
    pub metrics_cache: moka::future::Cache<String, Arc<CachedBody>>,
    /// `/timeline/state` reconstructions keyed by `t` (60 s).
    pub timeline_cache: moka::future::Cache<u64, Arc<CachedBody>>,
    hosted: tokio::sync::Mutex<Option<(Instant, HostedApps)>>,
}

/// Node id to the apps with an instance on it.
pub type HostedApps = Arc<HashMap<u32, Vec<AppRef>>>;

/// How long the hosted-apps map (built from stored app locations) is reused.
const HOSTED_TTL: Duration = Duration::from_secs(30);

/// Byte bound of the `/metrics` series response cache.
pub const METRICS_CACHE_BYTES: u64 = 16 << 20;
/// Byte bound of the `/timeline/state` cache (a reconstruction is about one `nodes.bin`).
pub const TIMELINE_CACHE_BYTES: u64 = 24 << 20;

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
        let ring = 4096;
        let hub = Hub::start(&engine, cfg.ws.clone(), ring);
        let explorer = Explorer::new(engine.clients().clone(), cfg.proxy, cfg.limits);
        let state = Self {
            inner: Arc::new(Inner {
                hooks,
                started: Instant::now(),
                views: ViewCache::default(),
                explorer,
                metrics: Metrics::default(),
                hub,
                cfg,
                engine,
                hosted: tokio::sync::Mutex::new(None),
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
            }
        });
        state
    }

    /// Views of the current publish.
    pub fn views(&self) -> Arc<Views> {
        self.views.get(&self.engine)
    }

    /// Runs a store read on the blocking pool.
    pub async fn store_read<T, F>(&self, f: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&Store) -> Result<T, ApiError> + Send + 'static,
    {
        let engine = self.engine.clone();
        tokio::task::spawn_blocking(move || f(engine.store())).await?
    }

    /// Apps hosted per node, rebuilt from the store at most every 30 s.
    pub async fn hosted_apps(&self) -> Result<HostedApps, ApiError> {
        let mut slot = self.hosted.lock().await;
        if let Some((at, map)) = slot.as_ref()
            && at.elapsed() < HOSTED_TTL
        {
            return Ok(Arc::clone(map));
        }
        let map: HostedApps = self
            .store_read(|st| Ok(Arc::new(crate::routes::nodes::hosted_map(&st.apps()?))))
            .await?;
        *slot = Some((Instant::now(), Arc::clone(&map)));
        Ok(map)
    }

    /// Closes live connections and refuses new ones.
    pub fn begin_shutdown(&self) {
        self.hub.begin_shutdown();
    }
}

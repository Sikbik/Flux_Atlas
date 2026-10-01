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
    hosted: tokio::sync::Mutex<HostedSlot>,
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
                hosted: tokio::sync::Mutex::new(HostedSlot::default()),
                metrics_cache: moka::future::Cache::builder()
                    .max_capacity(256)
                    .time_to_live(Duration::from_secs(15))
                    .build(),
                timeline_cache: moka::future::Cache::builder()
                    .max_capacity(32)
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

    /// Closes live connections and refuses new ones.
    pub fn begin_shutdown(&self) {
        self.hub.begin_shutdown();
    }
}

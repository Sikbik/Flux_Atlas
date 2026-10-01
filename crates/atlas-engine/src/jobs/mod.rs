//! Ingest jobs (ARCHITECTURE section 3.2). Each job polls or listens to one upstream, parses,
//! and sends typed observations to the reducer. Jobs never touch the state.

mod apps;
mod backfill;
pub(crate) mod chain;
pub(crate) mod geoip;
mod maintenance;
mod market;
mod registry;
mod stats_round;
mod topology;
mod watch_probe;

#[cfg(test)]
pub use chain::Cursor as chain_cursor_for_tests;

use std::future::Future;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use atlas_core::{BlockHash, Hash32, now_ms};
use atlas_flux::Clients;
use tokio::sync::{Notify, mpsc, watch};
use tokio::task::JoinHandle;

use crate::obs::Obs;
use crate::reducer::JobCmds;
use crate::stats::Upstream;
use crate::{EngineHandle, IngestConfig, WatchSet};

/// Receiving ends of the reducer's job commands.
pub struct JobRx {
    pub payees: mpsc::Receiver<u32>,
    pub chain_feed: mpsc::Receiver<(Hash32, u32)>,
    pub geo: mpsc::Receiver<(IpAddr, bool)>,
    pub reconcile: Arc<Notify>,
    pub catalog: Arc<Notify>,
    pub lists: Arc<Notify>,
}

/// Creates the reducer-to-job command channels.
pub fn commands() -> (JobCmds, JobRx) {
    let (payees_tx, payees) = mpsc::channel(16);
    let (feed_tx, chain_feed) = mpsc::channel(1024);
    let (geo_tx, geo) = mpsc::channel(16_384);
    let reconcile = Arc::new(Notify::new());
    let catalog = Arc::new(Notify::new());
    let lists = Arc::new(Notify::new());
    (
        JobCmds {
            payees: payees_tx,
            chain_feed: feed_tx,
            geo: geo_tx,
            reconcile: Arc::clone(&reconcile),
            catalog: Arc::clone(&catalog),
            lists: Arc::clone(&lists),
        },
        JobRx {
            payees,
            chain_feed,
            geo,
            reconcile,
            catalog,
            lists,
        },
    )
}

/// What every job gets.
#[derive(Clone)]
pub struct JobCtx {
    pub clients: Clients,
    obs: mpsc::Sender<Obs>,
    pub handle: EngineHandle,
    pub cfg: Arc<IngestConfig>,
    shutdown: watch::Receiver<bool>,
    pub watch: watch::Receiver<WatchSet>,
    /// Task label for per-job metrics (set by [`spawn_all`]).
    pub job: &'static str,
}

impl JobCtx {
    pub fn new(
        clients: Clients,
        obs: mpsc::Sender<Obs>,
        handle: EngineHandle,
        cfg: Arc<IngestConfig>,
        shutdown: watch::Receiver<bool>,
        watch: watch::Receiver<WatchSet>,
    ) -> Self {
        Self {
            clients,
            obs,
            handle,
            cfg,
            shutdown,
            watch,
            job: "engine",
        }
    }

    /// A copy labelled `job` for per-job metrics.
    pub fn for_job(&self, job: &'static str) -> Self {
        let mut c = self.clone();
        c.job = job;
        c
    }

    /// Sends an observation; false once the reducer is gone.
    pub async fn send(&self, o: Obs) -> bool {
        self.obs.send(o).await.is_ok()
    }

    pub fn stopping(&self) -> bool {
        *self.shutdown.borrow()
    }

    /// Sleeps; false when shutting down.
    pub async fn sleep(&self, d: Duration) -> bool {
        if self.stopping() {
            return false;
        }
        let mut s = self.shutdown.clone();
        tokio::select! {
            () = tokio::time::sleep(d) => !self.stopping(),
            () = stopped(&mut s) => false,
        }
    }

    /// Waits for a notification or a timeout; false when shutting down.
    pub async fn wait(&self, n: &Notify, d: Duration) -> bool {
        let mut s = self.shutdown.clone();
        tokio::select! {
            () = n.notified() => !self.stopping(),
            () = tokio::time::sleep(d) => !self.stopping(),
            () = stopped(&mut s) => false,
        }
    }

    /// Like [`Self::wait`], and tells which ended it: `Some(true)` for the notification,
    /// `Some(false)` for the timeout, `None` when shutting down.
    pub async fn wait_poked(&self, n: &Notify, d: Duration) -> Option<bool> {
        let mut s = self.shutdown.clone();
        let poked = tokio::select! {
            () = n.notified() => true,
            () = tokio::time::sleep(d) => false,
            () = stopped(&mut s) => return None,
        };
        (!self.stopping()).then_some(poked)
    }

    /// Runs an upstream call and counts it by host.
    pub async fn call<T>(
        &self,
        up: Upstream,
        what: &'static str,
        f: impl Future<Output = atlas_flux::Result<T>>,
    ) -> atlas_flux::Result<T> {
        let started = std::time::Instant::now();
        let r = f.await;
        self.handle
            .inner
            .stats
            .call_timed(self.job, up, what, r.is_ok(), started.elapsed());
        r
    }

    pub fn ok(&self, job: &'static str) {
        self.handle.inner.freshness.ok(job);
    }

    pub fn next(&self, job: &'static str, d: Duration) {
        self.handle
            .inner
            .freshness
            .next(job, now_ms() + d.as_millis() as u64);
    }

    /// Records a job failure (upstream errors are expected; they are counted and retried).
    pub fn fail(&self, job: &'static str, e: &dyn std::fmt::Display) {
        tracing::debug!(job, error = %e, "job attempt failed");
        self.handle.inner.freshness.err(job, e);
        self.handle.inner.stats.job_error(job);
    }
}

/// Spawns every job.
pub fn spawn_all(ctx: &JobCtx, rx: JobRx, recent: Vec<(u32, BlockHash)>) -> Vec<JoinHandle<()>> {
    let JobRx {
        payees,
        chain_feed,
        geo,
        reconcile,
        catalog,
        lists,
    } = rx;
    vec![
        tokio::spawn(chain::run(ctx.for_job("chain"), recent)),
        tokio::spawn(chain::payees(ctx.for_job("next_payees"), payees)),
        tokio::spawn(chain::failover_pool(ctx.for_job("failover_pool"))),
        tokio::spawn(apps::pending(ctx.for_job("app_pending"))),
        tokio::spawn(apps::installing(ctx.for_job("app_installing"))),
        tokio::spawn(apps::placement(ctx.for_job("app_placement"))),
        tokio::spawn(apps::hot(ctx.for_job("hot_apps"))),
        tokio::spawn(apps::catalog(ctx.for_job("app_catalog"), catalog)),
        tokio::spawn(apps::install_errors(ctx.for_job("install_errors"))),
        tokio::spawn(apps::chain_feed(ctx.for_job("app_chain_feed"), chain_feed)),
        tokio::spawn(registry::reconcile(ctx.for_job("node_registry"), reconcile)),
        tokio::spawn(registry::counts(ctx.for_job("node_count"))),
        tokio::spawn(registry::lists(ctx.for_job("start_dos_lists"), lists)),
        tokio::spawn(market::price(ctx.for_job("price"))),
        tokio::spawn(market::supply(ctx.for_job("supply"))),
        tokio::spawn(stats_round::run(ctx.for_job("stats_round"))),
        tokio::spawn(stats_round::geo(ctx.for_job("geo_resolve"), geo)),
        tokio::spawn(topology::run(ctx.for_job("topology_sweep"))),
        tokio::spawn(watch_probe::run(ctx.for_job("watch_probe"))),
        tokio::spawn(backfill::run(ctx.for_job("backfill"))),
        tokio::spawn(maintenance::run(ctx.for_job("maintenance"))),
    ]
}

/// Resolves once shutdown is signalled (holds no watch guard across awaits).
pub async fn stopped(s: &mut watch::Receiver<bool>) {
    let _ = s.wait_for(|v| *v).await;
}

/// Small deterministic jitter (0..max_ms) without a RNG dependency.
pub fn jitter_ms(max_ms: u64) -> u64 {
    if max_ms == 0 {
        return 0;
    }
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::from(d.subsec_nanos()));
    n % max_ms
}

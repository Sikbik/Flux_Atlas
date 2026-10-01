//! Ingest jobs (ARCHITECTURE section 3.2). Each job polls or listens to one upstream, parses,
//! and sends typed observations to the reducer. Jobs never touch the state.

mod apps;
mod backfill;
pub(crate) mod chain;
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
}

/// Creates the reducer-to-job command channels.
pub fn commands() -> (JobCmds, JobRx) {
    let (payees_tx, payees) = mpsc::channel(16);
    let (feed_tx, chain_feed) = mpsc::channel(1024);
    let (geo_tx, geo) = mpsc::channel(16_384);
    let reconcile = Arc::new(Notify::new());
    let catalog = Arc::new(Notify::new());
    (
        JobCmds {
            payees: payees_tx,
            chain_feed: feed_tx,
            geo: geo_tx,
            reconcile: Arc::clone(&reconcile),
            catalog: Arc::clone(&catalog),
        },
        JobRx {
            payees,
            chain_feed,
            geo,
            reconcile,
            catalog,
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
        }
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

    /// Runs an upstream call and counts it by host.
    pub async fn call<T>(
        &self,
        up: Upstream,
        what: &'static str,
        f: impl Future<Output = atlas_flux::Result<T>>,
    ) -> atlas_flux::Result<T> {
        let r = f.await;
        self.handle.inner.stats.call(up, what, r.is_ok());
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
    } = rx;
    vec![
        tokio::spawn(chain::run(ctx.clone(), recent)),
        tokio::spawn(chain::payees(ctx.clone(), payees)),
        tokio::spawn(chain::failover_pool(ctx.clone())),
        tokio::spawn(apps::pending(ctx.clone())),
        tokio::spawn(apps::installing(ctx.clone())),
        tokio::spawn(apps::placement(ctx.clone())),
        tokio::spawn(apps::hot(ctx.clone())),
        tokio::spawn(apps::catalog(ctx.clone(), catalog)),
        tokio::spawn(apps::install_errors(ctx.clone())),
        tokio::spawn(apps::chain_feed(ctx.clone(), chain_feed)),
        tokio::spawn(registry::reconcile(ctx.clone(), reconcile)),
        tokio::spawn(registry::counts(ctx.clone())),
        tokio::spawn(registry::lists(ctx.clone())),
        tokio::spawn(market::price(ctx.clone())),
        tokio::spawn(market::supply(ctx.clone())),
        tokio::spawn(stats_round::run(ctx.clone())),
        tokio::spawn(stats_round::geo(ctx.clone(), geo)),
        tokio::spawn(topology::run(ctx.clone())),
        tokio::spawn(watch_probe::run(ctx.clone())),
        tokio::spawn(backfill::run(ctx.clone())),
        tokio::spawn(maintenance::run(ctx.clone())),
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

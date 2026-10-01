//! Engine self-observation: upstream calls per host, events per kind, block latency,
//! reconcile diffs, store commits. Cheap counters behind one mutex; read by the soak test and
//! logged periodically.

use std::collections::BTreeMap;
use std::sync::Mutex;

/// Logical upstream a call went to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Upstream {
    /// FluxOS gateway `api.runonflux.io` (and its direct-node failover pool).
    FluxOs,
    /// Insight explorer (`explorer.runonflux.io` and mirrors).
    Insight,
    /// `stats.runonflux.io`.
    Stats,
    /// Direct per-node FluxOS APIs (SSRF-guarded).
    Node,
    /// CoinGecko price fallback.
    CoinGecko,
}

impl Upstream {
    pub const fn host(self) -> &'static str {
        match self {
            Self::FluxOs => "api.runonflux.io",
            Self::Insight => "explorer.runonflux.io",
            Self::Stats => "stats.runonflux.io",
            Self::Node => "direct-node",
            Self::CoinGecko => "api.coingecko.com",
        }
    }
}

/// Call counters of one upstream.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CallCount {
    pub ok: u64,
    pub err: u64,
}

/// Bucket bounds (seconds) of upstream call durations.
pub const UPSTREAM_BUCKETS: &[f64] = &[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0];
/// Bucket bounds (seconds) of store commits and body publishes.
pub const LOCAL_BUCKETS: &[f64] = &[0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1.0, 5.0];

/// A fixed-bucket histogram (Prometheus style; `counts[i]` holds the observations in bucket
/// `i` only, the exposition accumulates them). Bounds are set by the first observation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Histogram {
    pub bounds: &'static [f64],
    pub counts: Vec<u64>,
    pub sum: f64,
    pub count: u64,
}

impl Histogram {
    pub fn observe(&mut self, bounds: &'static [f64], secs: f64) {
        if self.counts.is_empty() {
            self.bounds = bounds;
            self.counts = vec![0; bounds.len()];
        }
        if let Some(i) = self.bounds.iter().position(|b| secs <= *b) {
            self.counts[i] += 1;
        }
        self.sum += secs;
        self.count += 1;
    }
}

/// Upstream work of one ingest job (task): calls, failures and time spent waiting.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct JobTiming {
    pub calls: u64,
    pub errors: u64,
    pub seconds: f64,
}

/// Snapshot of the engine counters.
#[derive(Debug, Clone, Default)]
pub struct EngineStats {
    /// Upstream calls by host label.
    pub upstream: BTreeMap<&'static str, CallCount>,
    /// Upstream calls by `host endpoint` (for example `api.runonflux.io getblock`).
    pub upstream_by_call: BTreeMap<String, u64>,
    /// Domain events derived, by kind.
    pub events: BTreeMap<&'static str, u64>,
    /// Live messages emitted, by type.
    pub live: BTreeMap<&'static str, u64>,
    /// Blocks applied live (not backfilled).
    pub blocks: u64,
    /// Blocks written by the backfill.
    pub backfilled_blocks: u64,
    /// Block time to `block` emit latencies (ms), most recent first is not guaranteed.
    pub block_latency_ms: Vec<i64>,
    /// Socket `block` push time minus block time (ms).
    pub tip_latency_ms: Vec<i64>,
    /// Tip push received to `block` message emitted (ms): fetch, decode and reduce.
    pub pipeline_latency_ms: Vec<i64>,
    /// Reconciles run and total field diffs found (bug signals).
    pub reconciles: u64,
    pub reconcile_diffs: u64,
    pub reconcile_diff_fields: BTreeMap<String, u64>,
    /// Payouts attributed exactly vs via fallback vs unattributed.
    pub payouts_exact: u64,
    pub payouts_fallback: u64,
    pub payouts_unattributed: u64,
    /// `fluxnodecurrentwinner` disagreeing with the local queue head.
    pub winner_mismatches: u64,
    /// currentwinner answers that still named the tip block's winners (re-asked).
    pub winner_stale: u64,
    /// Authoritative rank corrections sent (nodes, messages) under the rank contract.
    pub rank_corrections: u64,
    pub rank_correction_msgs: u64,
    pub winner_checks: u64,
    /// Reorgs handled.
    pub reorgs: u64,
    /// Store commits and failures.
    pub commits: u64,
    pub commit_errors: u64,
    pub commit_ops: u64,
    /// Body rebuilds and the slowest one (ms).
    pub publishes: u64,
    pub publish_max_ms: u64,
    pub publish_last_ms: u64,
    /// Errors that jobs logged (upstream failures are expected and counted separately).
    pub job_errors: BTreeMap<&'static str, u64>,
    /// Upstream call durations by host label.
    pub upstream_seconds: BTreeMap<&'static str, Histogram>,
    /// Upstream work by ingest job (task label, see `jobs::spawn_all`).
    pub job_upstream: BTreeMap<&'static str, JobTiming>,
    /// Store commit durations (encode, write, commit).
    pub commit_seconds: Histogram,
    /// Body rebuild (publish) durations.
    pub publish_seconds: Histogram,
    /// Unexpected internal errors (should stay 0).
    pub internal_errors: u64,
    /// Retention, disk budget and compaction (maintenance job).
    pub storage: StorageStatus,
}

/// What the maintenance job last did to the database.
#[derive(Debug, Clone, Default)]
pub struct StorageStatus {
    pub budget_bytes: u64,
    /// Maintenance passes completed, and the last one's end (unix ms) and duration.
    pub maintenance_runs: u64,
    pub maintenance_at_ms: u64,
    pub maintenance_ms: u64,
    /// Rows removed by the age-based retention tiers (all tables, cumulative).
    pub retention_rows: u64,
    /// Disk budget guard verdicts (`ok`, `compacted`, `pruned`), cumulative.
    pub guard_actions: BTreeMap<&'static str, u64>,
    /// Rows the guard removed, cumulative.
    pub guard_rows: u64,
    pub compactions: u64,
    /// Duration of the last compaction (ms): the store is exclusively locked meanwhile.
    pub compaction_ms: u64,
    /// `(table, rows, bytes)` from the last full size report, largest first.
    pub tables: Vec<(String, u64, u64)>,
    /// When that report was taken (unix ms) and how long the page walk took (ms).
    pub tables_at_ms: u64,
    pub tables_walk_ms: u64,
}

const LATENCY_KEEP: usize = 4096;

/// Shared counters.
#[derive(Debug, Default)]
pub struct StatsCell {
    inner: Mutex<EngineStats>,
}

impl StatsCell {
    pub fn with<R>(&self, f: impl FnOnce(&mut EngineStats) -> R) -> R {
        let mut g = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut g)
    }

    pub fn snapshot(&self) -> EngineStats {
        self.with(|s| s.clone())
    }

    /// Records an upstream call made by `job` that took `elapsed`.
    pub fn call_timed(
        &self,
        job: &'static str,
        up: Upstream,
        what: &str,
        ok: bool,
        elapsed: std::time::Duration,
    ) {
        let secs = elapsed.as_secs_f64();
        self.call(up, what, ok);
        self.with(|s| {
            s.upstream_seconds
                .entry(up.host())
                .or_default()
                .observe(UPSTREAM_BUCKETS, secs);
            let j = s.job_upstream.entry(job).or_default();
            j.calls += 1;
            if !ok {
                j.errors += 1;
            }
            j.seconds += secs;
        });
    }

    pub fn call(&self, up: Upstream, what: &str, ok: bool) {
        self.with(|s| {
            let c = s.upstream.entry(up.host()).or_default();
            if ok {
                c.ok += 1;
            } else {
                c.err += 1;
            }
            *s.upstream_by_call
                .entry(format!("{} {what}", up.host()))
                .or_default() += 1;
        });
    }

    pub fn event(&self, kind: &'static str) {
        self.with(|s| *s.events.entry(kind).or_default() += 1);
    }

    pub fn live(&self, kind: &'static str) {
        self.with(|s| *s.live.entry(kind).or_default() += 1);
    }

    pub fn block_latency(&self, ms: i64) {
        self.with(|s| {
            s.blocks += 1;
            push_bounded(&mut s.block_latency_ms, ms);
        });
    }

    pub fn tip_latency(&self, ms: i64) {
        self.with(|s| push_bounded(&mut s.tip_latency_ms, ms));
    }

    pub fn pipeline_latency(&self, ms: i64) {
        self.with(|s| push_bounded(&mut s.pipeline_latency_ms, ms));
    }

    pub fn job_error(&self, job: &'static str) {
        self.with(|s| *s.job_errors.entry(job).or_default() += 1);
    }
}

fn push_bounded(v: &mut Vec<i64>, x: i64) {
    if v.len() >= LATENCY_KEEP {
        v.drain(..LATENCY_KEEP / 2);
    }
    v.push(x);
}

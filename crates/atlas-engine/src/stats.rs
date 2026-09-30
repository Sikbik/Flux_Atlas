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
    /// Unexpected internal errors (should stay 0).
    pub internal_errors: u64,
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

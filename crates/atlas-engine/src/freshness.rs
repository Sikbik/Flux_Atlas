//! Per-job freshness (last success, last error, next run), exposed in bootstrap.

use std::collections::BTreeMap;
use std::sync::Mutex;

use atlas_core::api::JobFreshness;
use atlas_core::now_ms;

/// Every job with the age after which its data counts as stale (ms). Push-driven jobs use the
/// budget of their tier.
pub const JOBS: &[(&str, u64)] = &[
    ("chain_stream", 120_000),
    ("block_decoder", 120_000),
    ("mempool_stream", 300_000),
    ("next_payees", 180_000),
    // Event-driven: runs only when a block carries an app payment.
    ("app_chain_feed", u64::MAX),
    ("app_pending", 60_000),
    ("app_installing", 60_000),
    ("app_placement", 300_000),
    ("app_catalog", 1_800_000),
    ("node_registry", 1_800_000),
    ("node_count", 300_000),
    ("start_dos_lists", 300_000),
    ("price", 600_000),
    ("supply", 1_800_000),
    ("stats_round", 2_700_000),
    ("geo_resolve", 3_600_000),
    ("topology_sweep", 600_000),
    // Runs only while clients watch nodes.
    ("watch_probe", u64::MAX),
    ("backfill", u64::MAX),
    ("maintenance", 7_200_000),
];

#[derive(Debug, Clone, Default)]
struct Entry {
    last_ok_ms: Option<u64>,
    last_error: Option<String>,
    last_error_ms: Option<u64>,
    next_run_ms: Option<u64>,
}

/// Shared freshness registry.
#[derive(Debug)]
pub struct Freshness {
    inner: Mutex<BTreeMap<&'static str, Entry>>,
    started_ms: u64,
}

impl Default for Freshness {
    fn default() -> Self {
        Self {
            inner: Mutex::new(BTreeMap::new()),
            started_ms: now_ms(),
        }
    }
}

impl Freshness {
    fn with<R>(&self, f: impl FnOnce(&mut BTreeMap<&'static str, Entry>) -> R) -> R {
        let mut g = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut g)
    }

    pub fn ok(&self, job: &'static str) {
        let now = now_ms();
        self.with(|m| m.entry(job).or_default().last_ok_ms = Some(now));
    }

    pub fn err(&self, job: &'static str, error: impl std::fmt::Display) {
        let now = now_ms();
        let mut msg = error.to_string();
        msg.truncate(300);
        self.with(|m| {
            let e = m.entry(job).or_default();
            e.last_error = Some(msg);
            e.last_error_ms = Some(now);
        });
    }

    /// True once `job` succeeded at least once since startup.
    pub fn has_succeeded(&self, job: &str) -> bool {
        self.with(|m| m.get(job).is_some_and(|e| e.last_ok_ms.is_some()))
    }

    pub fn next(&self, job: &'static str, at_ms: u64) {
        self.with(|m| m.entry(job).or_default().next_run_ms = Some(at_ms));
    }

    /// Current freshness of every known job, in [`JOBS`] order.
    pub fn snapshot(&self) -> Vec<JobFreshness> {
        let now = now_ms();
        self.with(|m| {
            JOBS.iter()
                .map(|(job, max_age)| {
                    let e = m.get(job).cloned().unwrap_or_default();
                    // A job that has not succeeded yet only counts as stale once it had its
                    // full window since startup to do so.
                    let since = e.last_ok_ms.unwrap_or(self.started_ms);
                    let stale = *max_age != u64::MAX && now.saturating_sub(since) > *max_age;
                    JobFreshness {
                        job: (*job).to_owned(),
                        last_ok_ms: e.last_ok_ms,
                        last_error: e.last_error,
                        last_error_ms: e.last_error_ms,
                        stale,
                        next_run_ms: e.next_run_ms,
                    }
                })
                .collect()
        })
    }
}

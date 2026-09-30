//! Upstream endpoints, health tracking with a circuit breaker, and failover sets.
//!
//! - Insight explorer: main plus two mirrors (identical APIs).
//! - FluxOS: the `api.runonflux.io` gateway plus a pluggable pool of direct node endpoints that
//!   the engine feeds with healthy nodes. Direct entries are [`GuardedEndpoint`]s, so they passed
//!   the SSRF guard.
//! - stats.runonflux.io: single source.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use url::Url;

use crate::error::{FluxError, Result};
use crate::ssrf::GuardedEndpoint;

/// Insight explorer bases, primary first.
pub const INSIGHT_BASES: [&str; 3] = [
    "https://explorer.runonflux.io",
    "https://explorer2.runonflux.io",
    "https://explorer.flux.zelcore.io",
];
/// FluxOS public gateway.
pub const FLUXOS_GATEWAY: &str = "https://api.runonflux.io";
/// Flux stats service.
pub const STATS_BASE: &str = "https://stats.runonflux.io";
/// CoinGecko public API (price fallback).
pub const COINGECKO_BASE: &str = "https://api.coingecko.com";

/// Consecutive faults that open the circuit.
pub const BREAKER_THRESHOLD: u32 = 5;
/// How long an open circuit stays open before a trial request.
pub const BREAKER_COOLDOWN: Duration = Duration::from_secs(30);

/// A direct node's reported height is accepted only within this distance of the best tip.
pub const MAX_HEIGHT_LAG: u32 = 2;

/// True if a height reported by a failover node is close enough to the best known tip.
pub fn height_acceptable(reported: u32, best_known: u32) -> bool {
    reported.abs_diff(best_known) <= MAX_HEIGHT_LAG
}

/// Health counters of one upstream base.
#[derive(Debug, Default)]
pub struct Health {
    consecutive_failures: AtomicU32,
    open_until_ms: AtomicU64,
    last_ok_ms: AtomicU64,
    last_latency_ms: AtomicU32,
    ok_total: AtomicU64,
    err_total: AtomicU64,
}

/// Point-in-time view of [`Health`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealthSnapshot {
    pub consecutive_failures: u32,
    pub circuit_open: bool,
    pub last_ok_ms: Option<u64>,
    pub last_latency_ms: u32,
    pub ok_total: u64,
    pub err_total: u64,
}

impl Health {
    pub fn record_ok(&self, latency: Duration) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.open_until_ms.store(0, Ordering::Relaxed);
        self.last_ok_ms
            .store(atlas_core::now_ms(), Ordering::Relaxed);
        self.last_latency_ms.store(
            latency.as_millis().min(u128::from(u32::MAX)) as u32,
            Ordering::Relaxed,
        );
        self.ok_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_fault(&self) {
        self.err_total.fetch_add(1, Ordering::Relaxed);
        let n = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
        if n >= BREAKER_THRESHOLD {
            let until = atlas_core::now_ms() + BREAKER_COOLDOWN.as_millis() as u64;
            self.open_until_ms.store(until, Ordering::Relaxed);
        }
    }

    /// False while the circuit is open.
    pub fn available(&self, now_ms: u64) -> bool {
        self.open_until_ms.load(Ordering::Relaxed) <= now_ms
    }

    pub fn snapshot(&self, now_ms: u64) -> HealthSnapshot {
        let last_ok = self.last_ok_ms.load(Ordering::Relaxed);
        HealthSnapshot {
            consecutive_failures: self.consecutive_failures.load(Ordering::Relaxed),
            circuit_open: !self.available(now_ms),
            last_ok_ms: (last_ok > 0).then_some(last_ok),
            last_latency_ms: self.last_latency_ms.load(Ordering::Relaxed),
            ok_total: self.ok_total.load(Ordering::Relaxed),
            err_total: self.err_total.load(Ordering::Relaxed),
        }
    }
}

/// One upstream base URL with its health.
#[derive(Debug)]
pub struct Upstream {
    pub label: String,
    pub base: Url,
    pub health: Health,
    /// Set for direct node entries.
    pub node: Option<GuardedEndpoint>,
}

impl Upstream {
    pub fn new(base: &str) -> Result<Self> {
        let url = Url::parse(base).map_err(|e| FluxError::BadUrl(format!("{base}: {e}")))?;
        let label = url.host_str().unwrap_or(base).to_owned();
        Ok(Self {
            label,
            base: url,
            health: Health::default(),
            node: None,
        })
    }

    pub fn from_node(ep: GuardedEndpoint) -> Result<Self> {
        let url = Url::parse(&ep.base_url()).map_err(|e| FluxError::BadUrl(e.to_string()))?;
        Ok(Self {
            label: ep.to_string(),
            base: url,
            health: Health::default(),
            node: Some(ep),
        })
    }
}

/// An ordered failover set.
#[derive(Debug)]
pub struct FailoverSet {
    pub name: &'static str,
    primary: Vec<Arc<Upstream>>,
    /// Dynamic secondaries (direct nodes for FluxOS).
    dynamic: RwLock<Vec<Arc<Upstream>>>,
    /// Maximum dynamic entries tried per request.
    pub max_dynamic_tries: usize,
}

impl FailoverSet {
    pub fn new(name: &'static str, bases: &[&str]) -> Result<Self> {
        let primary = bases
            .iter()
            .map(|b| Upstream::new(b).map(Arc::new))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            name,
            primary,
            dynamic: RwLock::new(Vec::new()),
            max_dynamic_tries: 3,
        })
    }

    /// Replaces the dynamic pool, keeping health state of entries that remain.
    pub fn set_nodes(&self, nodes: &[GuardedEndpoint]) {
        let mut dynamic = self
            .dynamic
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut next = Vec::with_capacity(nodes.len());
        for ep in nodes {
            if let Some(existing) = dynamic.iter().find(|u| u.node.as_ref() == Some(ep)) {
                next.push(existing.clone());
            } else if let Ok(u) = Upstream::from_node(*ep) {
                next.push(Arc::new(u));
            }
        }
        *dynamic = next;
    }

    pub fn nodes(&self) -> Vec<Arc<Upstream>> {
        self.dynamic
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn primaries(&self) -> &[Arc<Upstream>] {
        &self.primary
    }

    /// Candidates in try order: available primaries, then the healthiest available dynamic
    /// entries; if nothing is available, every entry (a trial beats a hard failure).
    pub fn candidates(&self) -> Vec<Arc<Upstream>> {
        let now = atlas_core::now_ms();
        let mut out: Vec<Arc<Upstream>> = self
            .primary
            .iter()
            .filter(|u| u.health.available(now))
            .cloned()
            .collect();
        let mut dynamic: Vec<Arc<Upstream>> = self
            .nodes()
            .into_iter()
            .filter(|u| u.health.available(now))
            .collect();
        dynamic.sort_by_key(|u| {
            let s = u.health.snapshot(now);
            (s.consecutive_failures, s.last_latency_ms)
        });
        out.extend(dynamic.into_iter().take(self.max_dynamic_tries));
        if out.is_empty() {
            out.extend(self.primary.iter().cloned());
            out.extend(self.nodes().into_iter().take(self.max_dynamic_tries));
        }
        out
    }

    /// Runs `f` against candidates until one succeeds. Upstream faults (transport, 5xx,
    /// timeouts, bad bodies) fail over; answers such as FluxOS daemon errors return at once.
    pub async fn run<T, F, Fut>(&self, mut f: F) -> Result<T>
    where
        F: FnMut(Arc<Upstream>) -> Fut,
        Fut: Future<Output = Result<(T, Duration)>>,
    {
        let mut last = None;
        for u in self.candidates() {
            match f(u.clone()).await {
                Ok((v, latency)) => {
                    u.health.record_ok(latency);
                    return Ok(v);
                }
                Err(e) if e.is_upstream_fault() => {
                    tracing::debug!(set = self.name, upstream = %u.label, error = %e, "upstream fault, failing over");
                    u.health.record_fault();
                    last = Some(e);
                }
                Err(e) => {
                    // A definitive answer: the upstream is healthy.
                    u.health.record_ok(Duration::ZERO);
                    return Err(e);
                }
            }
        }
        Err(last.unwrap_or(FluxError::NoHealthyUpstream(self.name)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaker_opens_and_resets() {
        let h = Health::default();
        let now = atlas_core::now_ms();
        for _ in 0..BREAKER_THRESHOLD - 1 {
            h.record_fault();
        }
        assert!(h.available(now));
        h.record_fault();
        assert!(!h.available(now));
        assert!(h.available(now + BREAKER_COOLDOWN.as_millis() as u64 + 1));
        h.record_ok(Duration::from_millis(12));
        assert!(h.available(now));
        assert_eq!(h.snapshot(now).consecutive_failures, 0);
    }

    #[test]
    fn candidates_and_pool() {
        let set = FailoverSet::new("fluxos", &[FLUXOS_GATEWAY]).unwrap();
        assert_eq!(set.candidates().len(), 1);
        let a = GuardedEndpoint::new("94.130.137.2:16127".parse().unwrap()).unwrap();
        let b = GuardedEndpoint::new("65.109.63.147:16147".parse().unwrap()).unwrap();
        set.set_nodes(&[a, b]);
        assert_eq!(set.candidates().len(), 3);
        // Health survives a pool refresh.
        set.nodes()[0].health.record_fault();
        set.set_nodes(&[a]);
        assert_eq!(set.nodes()[0].health.snapshot(0).consecutive_failures, 1);
        // An open gateway circuit moves nodes first.
        for _ in 0..BREAKER_THRESHOLD {
            set.primaries()[0].health.record_fault();
        }
        let c = set.candidates();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].node, Some(a));
    }

    #[tokio::test]
    async fn run_fails_over_on_faults_only() {
        let set = FailoverSet::new("insight", &INSIGHT_BASES).unwrap();
        let mut seen = Vec::new();
        let r: Result<u32> = set
            .run(|u| {
                seen.push(u.label.clone());
                let first = seen.len() == 1;
                async move {
                    if first {
                        Err(FluxError::Timeout(Duration::from_secs(1)))
                    } else {
                        Ok((7, Duration::from_millis(5)))
                    }
                }
            })
            .await;
        assert_eq!(r.unwrap(), 7);
        assert_eq!(
            seen,
            vec!["explorer.runonflux.io", "explorer2.runonflux.io"]
        );
        let r: Result<u32> = set
            .run(|_| async {
                Err(FluxError::Upstream {
                    code: Some(-5),
                    name: None,
                    message: String::new(),
                })
            })
            .await;
        assert!(r.unwrap_err().is_not_found());
    }

    #[test]
    fn height_window() {
        assert!(height_acceptable(100, 102));
        assert!(height_acceptable(103, 101));
        assert!(!height_acceptable(97, 100));
    }
}

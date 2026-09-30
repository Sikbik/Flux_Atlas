//! Upstream protection for on-demand explorer lookups:
//!
//! - [`TtlCache`]: a moka cache with a per-entry lifetime chosen from the upstream answer
//!   (explorer research section 7.2), negative caching of "not found", and single-flight
//!   coalescing (concurrent misses for one key share one upstream call).
//! - [`UpstreamGuard`]: a per-client-IP token bucket charged only on cache misses (429 with
//!   `Retry-After`), plus a global cap on concurrent upstream fetches (503 when saturated).

use std::collections::HashSet;
use std::future::Future;
use std::hash::Hash;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use governor::clock::{Clock as _, DefaultClock};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use moka::Expiry;
use moka::future::Cache;
use tokio::sync::{Semaphore, SemaphorePermit};

use crate::config::ClientLimits;
use crate::error::ApiError;

/// Result of one upstream fetch, with how long to keep it.
#[derive(Debug)]
pub enum Fetch<V> {
    Found(V, Duration),
    NotFound(Duration),
}

#[derive(Debug)]
struct Entry<V> {
    value: Option<Arc<V>>,
    ttl: Duration,
}

impl<V> Clone for Entry<V> {
    fn clone(&self) -> Self {
        Self {
            value: self.value.clone(),
            ttl: self.ttl,
        }
    }
}

struct PerEntryTtl;

impl<K, V> Expiry<K, Entry<V>> for PerEntryTtl {
    fn expire_after_create(&self, _: &K, value: &Entry<V>, _: Instant) -> Option<Duration> {
        Some(value.ttl)
    }
}

/// Hit / miss counters of a cache.
#[derive(Debug, Default)]
pub struct CacheStats {
    pub hits: AtomicU64,
    pub misses: AtomicU64,
    pub errors: AtomicU64,
}

/// TTL cache with single-flight fills.
pub struct TtlCache<K, V> {
    what: &'static str,
    cache: Cache<K, Entry<V>>,
    /// Keys whose fill is running (callers joining it cost upstream nothing).
    inflight: Mutex<HashSet<K>>,
    pub stats: CacheStats,
}

/// Removes a key from the in-flight set when the fill ends or is cancelled.
struct InflightGuard<'a, K: Hash + Eq> {
    set: &'a Mutex<HashSet<K>>,
    key: Option<K>,
}

impl<K: Hash + Eq> Drop for InflightGuard<'_, K> {
    fn drop(&mut self) {
        if let Some(k) = self.key.take() {
            self.set
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&k);
        }
    }
}

impl<K, V> std::fmt::Debug for TtlCache<K, V> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TtlCache")
            .field("what", &self.what)
            .field("entries", &self.cache.entry_count())
            .finish_non_exhaustive()
    }
}

impl<K, V> TtlCache<K, V>
where
    K: Hash + Eq + Clone + Send + Sync + 'static,
    V: Send + Sync + 'static,
{
    /// `what` names the entity in "not found" errors and metrics.
    pub fn new(what: &'static str, capacity: u64) -> Self {
        Self {
            what,
            cache: Cache::builder()
                .max_capacity(capacity)
                .expire_after(PerEntryTtl)
                .build(),
            inflight: Mutex::new(HashSet::new()),
            stats: CacheStats::default(),
        }
    }

    pub fn what(&self) -> &'static str {
        self.what
    }

    /// True if `key` is cached (fresh).
    pub fn contains(&self, key: &K) -> bool {
        self.cache.contains_key(key)
    }

    /// True if `key` is cached or a fill for it is already running.
    pub fn covered(&self, key: &K) -> bool {
        self.contains(key)
            || self
                .inflight
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .contains(key)
    }

    pub fn entry_count(&self) -> u64 {
        self.cache.entry_count()
    }

    /// Returns the cached value or runs `fetch` once for all concurrent callers of `key`.
    /// Errors are not cached; "not found" answers are, for their TTL.
    pub async fn get_or_fetch<Fut>(&self, key: K, fetch: Fut) -> Result<Arc<V>, ApiError>
    where
        Fut: Future<Output = Result<Fetch<V>, ApiError>>,
    {
        let ran = AtomicBool::new(false);
        let ran_ref = &ran;
        let inflight = &self.inflight;
        let marker = key.clone();
        let res = self
            .cache
            .try_get_with(key, async move {
                ran_ref.store(true, Ordering::Relaxed);
                inflight
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(marker.clone());
                let _guard = InflightGuard {
                    set: inflight,
                    key: Some(marker),
                };
                match fetch.await? {
                    Fetch::Found(v, ttl) => Ok::<_, ApiError>(Entry {
                        value: Some(Arc::new(v)),
                        ttl,
                    }),
                    Fetch::NotFound(ttl) => Ok(Entry { value: None, ttl }),
                }
            })
            .await;
        if ran.load(Ordering::Relaxed) {
            self.stats.misses.fetch_add(1, Ordering::Relaxed);
        } else {
            self.stats.hits.fetch_add(1, Ordering::Relaxed);
        }
        match res {
            Ok(Entry { value: Some(v), .. }) => Ok(v),
            Ok(Entry { value: None, .. }) => {
                Err(ApiError::not_found(format!("{} not found", self.what)))
            }
            Err(e) => {
                self.stats.errors.fetch_add(1, Ordering::Relaxed);
                Err((*e).clone())
            }
        }
    }
}

/// Per-IP limiter and global concurrency cap for upstream-reaching requests.
pub struct UpstreamGuard {
    limiter: DefaultKeyedRateLimiter<IpAddr>,
    clock: DefaultClock,
    permits: Semaphore,
    queue_timeout: Duration,
    pub rate_limited: AtomicU64,
    pub busy: AtomicU64,
}

impl std::fmt::Debug for UpstreamGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UpstreamGuard")
            .field("tracked_ips", &self.limiter.len())
            .field("free_permits", &self.permits.available_permits())
            .finish_non_exhaustive()
    }
}

impl UpstreamGuard {
    pub fn new(limits: ClientLimits) -> Self {
        let rps = NonZeroU32::new(limits.rps.max(1)).unwrap_or(NonZeroU32::MIN);
        let burst = NonZeroU32::new(limits.burst.max(1)).unwrap_or(NonZeroU32::MIN);
        Self {
            limiter: RateLimiter::keyed(Quota::per_second(rps).allow_burst(burst)),
            clock: DefaultClock::default(),
            permits: Semaphore::new(limits.upstream_concurrency.max(1)),
            queue_timeout: limits.queue_timeout,
            rate_limited: AtomicU64::new(0),
            busy: AtomicU64::new(0),
        }
    }

    /// Charges one upstream-reaching request to `ip`; 429 with `Retry-After` when exhausted.
    pub fn admit(&self, ip: IpAddr) -> Result<(), ApiError> {
        match self.limiter.check_key(&ip) {
            Ok(()) => Ok(()),
            Err(not_until) => {
                self.rate_limited.fetch_add(1, Ordering::Relaxed);
                let wait = not_until.wait_time_from(self.clock.now());
                Err(ApiError::rate_limited(wait.as_secs_f64().ceil() as u64))
            }
        }
    }

    /// Waits for a global upstream slot; 503 when none frees up in time.
    pub async fn permit(&self) -> Result<SemaphorePermit<'_>, ApiError> {
        if let Ok(Ok(p)) = tokio::time::timeout(self.queue_timeout, self.permits.acquire()).await {
            Ok(p)
        } else {
            self.busy.fetch_add(1, Ordering::Relaxed);
            Err(
                ApiError::unavailable("upstream lookups are saturated; try again shortly")
                    .with_retry_after(2),
            )
        }
    }

    /// Forgets idle clients (call periodically).
    pub fn prune(&self) {
        self.limiter.retain_recent();
        self.limiter.shrink_to_fit();
    }

    pub fn tracked_clients(&self) -> usize {
        self.limiter.len()
    }
}

/// Fetches through `cache`, charging `ip` (when given) only if the key is neither cached nor
/// already being fetched (joining an in-flight fill costs upstream nothing), and holding a
/// global upstream slot while the fetch runs.
pub async fn guarded<K, V, Fut>(
    guard: &UpstreamGuard,
    cache: &TtlCache<K, V>,
    ip: Option<IpAddr>,
    key: K,
    fetch: Fut,
) -> Result<Arc<V>, ApiError>
where
    K: Hash + Eq + Clone + Send + Sync + 'static,
    V: Send + Sync + 'static,
    Fut: Future<Output = Result<Fetch<V>, ApiError>>,
{
    if let Some(ip) = ip
        && !cache.covered(&key)
    {
        guard.admit(ip)?;
    }
    cache
        .get_or_fetch(key, async move {
            let _permit = guard.permit().await?;
            fetch.await
        })
        .await
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicU32;

    use super::*;

    #[tokio::test]
    async fn single_flight_and_ttl() {
        let c: TtlCache<u32, String> = TtlCache::new("thing", 100);
        let calls = Arc::new(AtomicU32::new(0));
        let mut tasks = Vec::new();
        let c = Arc::new(c);
        for _ in 0..20 {
            let c = Arc::clone(&c);
            let calls = Arc::clone(&calls);
            tasks.push(tokio::spawn(async move {
                c.get_or_fetch(1, async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok(Fetch::Found("v".to_owned(), Duration::from_millis(150)))
                })
                .await
            }));
        }
        for t in tasks {
            assert_eq!(*t.await.unwrap().unwrap(), "v");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "coalesced");
        assert_eq!(c.stats.misses.load(Ordering::SeqCst), 1);
        assert_eq!(c.stats.hits.load(Ordering::SeqCst), 19);
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert!(!c.contains(&1), "expired");
        c.get_or_fetch(1, async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Fetch::Found("w".to_owned(), Duration::from_secs(5)))
        })
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn negative_and_errors() {
        let c: TtlCache<u32, u8> = TtlCache::new("tx", 10);
        let e = c
            .get_or_fetch(1, async { Ok(Fetch::NotFound(Duration::from_secs(5))) })
            .await
            .unwrap_err();
        assert_eq!(e.status, axum::http::StatusCode::NOT_FOUND);
        assert!(c.contains(&1));
        let e = c
            .get_or_fetch(2, async { Err(ApiError::upstream("boom")) })
            .await
            .unwrap_err();
        assert_eq!(e.status, axum::http::StatusCode::BAD_GATEWAY);
        assert!(!c.contains(&2), "errors are not cached");
    }

    #[tokio::test]
    async fn limiter_charges_misses_only() {
        let g = UpstreamGuard::new(ClientLimits {
            rps: 1,
            burst: 2,
            upstream_concurrency: 4,
            queue_timeout: Duration::from_secs(1),
        });
        let c: TtlCache<u32, u8> = TtlCache::new("x", 10);
        let ip: IpAddr = "203.0.113.1".parse().unwrap();
        let ok = |v| async move { Ok(Fetch::Found(v, Duration::from_secs(60))) };
        guarded(&g, &c, Some(ip), 1, ok(1)).await.unwrap();
        guarded(&g, &c, Some(ip), 2, ok(2)).await.unwrap();
        // Cached keys stay free.
        for _ in 0..10 {
            guarded(&g, &c, Some(ip), 1, ok(1)).await.unwrap();
        }
        let e = guarded(&g, &c, Some(ip), 3, ok(3)).await.unwrap_err();
        assert_eq!(e.status, axum::http::StatusCode::TOO_MANY_REQUESTS);
        assert!(e.retry_after_s.unwrap() >= 1);
        // Another client is unaffected.
        guarded(&g, &c, Some("203.0.113.2".parse().unwrap()), 3, ok(3))
            .await
            .unwrap();
    }
}

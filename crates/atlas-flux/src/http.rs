//! HTTP infrastructure: one pooled reqwest client (rustls, HTTP/2, gzip/br/zstd), a per-host
//! token bucket plus concurrency semaphore, retries with jittered exponential backoff,
//! `Retry-After` handling, per-request timeouts and response-size caps.
//!
//! **Lanes.** Each [`HttpClient`] belongs to one [`Lane`] with its own per-host gates. The
//! ingest lane is the engine's; the interactive lane ([`HttpClient::lane`]) serves user-driven
//! lookups (the explorer) with a smaller budget per host. The two share the connection pool
//! only, so a queue of user requests never delays an ingest request: an ingest request waits
//! for its own gate alone.

use std::collections::{BTreeMap, HashMap};
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};
use governor::{DefaultDirectRateLimiter, Quota, RateLimiter};
use rand::RngExt;
use reqwest::StatusCode;
use reqwest::header::{ETAG, HeaderMap, IF_NONE_MATCH, RETRY_AFTER};
use tokio::sync::Semaphore;
use url::Url;

use crate::error::{FluxError, Result};
use crate::ssrf::GuardedEndpoint;

/// Rate and concurrency policy for one upstream host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostPolicy {
    /// Sustained requests per second.
    pub rps: u32,
    /// Burst size of the token bucket.
    pub burst: u32,
    /// Maximum in-flight requests.
    pub concurrency: usize,
}

impl HostPolicy {
    pub const fn new(rps: u32, burst: u32, concurrency: usize) -> Self {
        Self {
            rps,
            burst,
            concurrency,
        }
    }

    /// The tighter of two policies, field by field.
    #[must_use]
    pub fn min(self, other: Self) -> Self {
        Self {
            rps: self.rps.min(other.rps),
            burst: self.burst.min(other.burst),
            concurrency: self.concurrency.min(other.concurrency),
        }
    }
}

/// Which budget a client draws from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Lane {
    /// The engine's ingest: chain, nodes, apps, stats. Owns the main per-host budget.
    Ingest,
    /// User-driven lookups (explorer): a small budget of its own per host and its own circuit
    /// breakers, so users can neither use the ingest's tokens nor trip its breakers.
    Interactive,
}

impl Lane {
    /// Metric label.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ingest => "ingest",
            Self::Interactive => "interactive",
        }
    }
}

/// Client-wide configuration.
#[derive(Debug, Clone)]
pub struct HttpConfig {
    pub user_agent: String,
    /// Default total request timeout.
    pub timeout: Duration,
    pub connect_timeout: Duration,
    /// Default response-size cap.
    pub max_body_bytes: usize,
    /// Response-size cap for direct node requests.
    pub max_node_body_bytes: usize,
    /// Total attempts per request (1 = no retry).
    pub attempts: u32,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    /// Longest `Retry-After` we are willing to sleep for inside one call.
    pub max_retry_after: Duration,
    /// Policy for hosts without an override.
    pub default_policy: HostPolicy,
    /// Policy for direct node endpoints (keyed per IP, shared by co-hosted nodes).
    pub node_policy: HostPolicy,
    /// Per-host overrides, keyed by host name (for example `api.runonflux.io`).
    pub host_policies: HashMap<String, HostPolicy>,
    /// Interactive lane: policy for hosts without an interactive override. The lane's policy
    /// for a host is never looser than the ingest policy for that host.
    pub interactive_default_policy: HostPolicy,
    /// Interactive lane: per-host overrides.
    pub interactive_host_policies: HashMap<String, HostPolicy>,
    /// Interactive lane: total attempts per request (capped by [`Self::attempts`]).
    pub interactive_attempts: u32,
}

impl HttpConfig {
    /// Ingest-lane policy of `host`.
    pub fn policy_for(&self, host: &str) -> HostPolicy {
        self.host_policies
            .get(host)
            .copied()
            .unwrap_or(self.default_policy)
    }

    /// Interactive-lane policy of `host`: its interactive policy, never looser than the ingest
    /// policy of the same host (an `ATLAS_UPSTREAM_RPS` cut applies to both lanes).
    pub fn interactive_policy_for(&self, host: &str) -> HostPolicy {
        self.interactive_host_policies
            .get(host)
            .copied()
            .unwrap_or(self.interactive_default_policy)
            .min(self.policy_for(host))
    }

    /// This configuration as seen by `lane`: the interactive lane gets its own host policies
    /// (resolved per host against the ingest ones) and fewer attempts.
    fn for_lane(&self, lane: Lane) -> Self {
        match lane {
            Lane::Ingest => self.clone(),
            Lane::Interactive => {
                let mut hosts: Vec<&String> = self.host_policies.keys().collect();
                hosts.extend(self.interactive_host_policies.keys());
                let host_policies = hosts
                    .into_iter()
                    .map(|h| (h.clone(), self.interactive_policy_for(h)))
                    .collect();
                Self {
                    default_policy: self.interactive_default_policy.min(self.default_policy),
                    node_policy: self.interactive_default_policy.min(self.node_policy),
                    host_policies,
                    attempts: self.interactive_attempts.clamp(1, self.attempts.max(1)),
                    ..self.clone()
                }
            }
        }
    }
}

impl Default for HttpConfig {
    fn default() -> Self {
        let mut host_policies = HashMap::new();
        host_policies.insert("api.runonflux.io".to_owned(), HostPolicy::new(4, 4, 4));
        host_policies.insert("stats.runonflux.io".to_owned(), HostPolicy::new(2, 2, 2));
        for h in [
            "explorer.runonflux.io",
            "explorer2.runonflux.io",
            "explorer.flux.zelcore.io",
        ] {
            host_policies.insert(h.to_owned(), HostPolicy::new(4, 4, 4));
        }
        host_policies.insert("api.coingecko.com".to_owned(), HostPolicy::new(1, 1, 1));
        // User lookups: the gateway's budget is the scarcest (the ingest's T1 path lives on
        // it), so users get 1 request a second there; the Insight mirrors carry most explorer
        // pages (tx, address) and get 2 a second each.
        let mut interactive_host_policies = HashMap::new();
        interactive_host_policies.insert("api.runonflux.io".to_owned(), HostPolicy::new(1, 2, 2));
        for h in [
            "explorer.runonflux.io",
            "explorer2.runonflux.io",
            "explorer.flux.zelcore.io",
        ] {
            interactive_host_policies.insert(h.to_owned(), HostPolicy::new(2, 4, 2));
        }
        Self {
            user_agent: format!(
                "flux-atlas/{} (+https://github.com/Sikbik/Flux_Atlas)",
                env!("CARGO_PKG_VERSION")
            ),
            timeout: Duration::from_secs(20),
            connect_timeout: Duration::from_secs(5),
            max_body_bytes: 128 * 1024 * 1024,
            max_node_body_bytes: 4 * 1024 * 1024,
            attempts: 3,
            backoff_base: Duration::from_millis(250),
            backoff_max: Duration::from_secs(5),
            max_retry_after: Duration::from_secs(30),
            default_policy: HostPolicy::new(4, 4, 4),
            node_policy: HostPolicy::new(2, 2, 2),
            host_policies,
            interactive_default_policy: HostPolicy::new(1, 2, 2),
            interactive_host_policies,
            interactive_attempts: 2,
        }
    }
}

/// Per-request options.
#[derive(Debug, Clone, Default)]
pub struct RequestOpts {
    pub timeout: Option<Duration>,
    pub max_bytes: Option<usize>,
    /// Overrides [`HttpConfig::attempts`].
    pub attempts: Option<u32>,
    /// Conditional request; a 304 yields [`Fetched::NotModified`].
    pub if_none_match: Option<String>,
    /// Append `nc=<unix ms>` to bypass FluxOS apicache. Use only where freshness matters.
    pub cache_bust: bool,
}

impl RequestOpts {
    pub fn timeout(mut self, d: Duration) -> Self {
        self.timeout = Some(d);
        self
    }

    pub fn max_bytes(mut self, n: usize) -> Self {
        self.max_bytes = Some(n);
        self
    }

    pub fn attempts(mut self, n: u32) -> Self {
        self.attempts = Some(n);
        self
    }

    pub fn cache_bust(mut self) -> Self {
        self.cache_bust = true;
        self
    }

    pub fn if_none_match(mut self, etag: impl Into<String>) -> Self {
        self.if_none_match = Some(etag.into());
        self
    }
}

/// A successful response body.
#[derive(Debug, Clone)]
pub struct Body {
    pub bytes: Bytes,
    pub status: u16,
    pub etag: Option<String>,
    /// FluxOS gateway `fluxnode` header (which backend served the request).
    pub served_by: Option<String>,
    pub elapsed: Duration,
}

/// Result of a possibly conditional request.
#[derive(Debug, Clone)]
pub enum Fetched {
    Body(Body),
    NotModified,
}

struct HostGate {
    limiter: DefaultDirectRateLimiter,
    sem: Semaphore,
    counters: Arc<HostCounters>,
}

impl HostGate {
    fn new(p: HostPolicy, counters: Arc<HostCounters>) -> Self {
        let rps = NonZeroU32::new(p.rps.max(1)).unwrap_or(NonZeroU32::MIN);
        let burst = NonZeroU32::new(p.burst.max(1)).unwrap_or(NonZeroU32::MIN);
        Self {
            limiter: RateLimiter::direct(Quota::per_second(rps).allow_burst(burst)),
            sem: Semaphore::new(p.concurrency.max(1)),
            counters,
        }
    }
}

/// Request counters of one host label in one lane.
#[derive(Debug, Default)]
struct HostCounters {
    ok: AtomicU64,
    err: AtomicU64,
    /// Requests waiting for a gate permit or token right now.
    waiting: AtomicI64,
}

/// Metric label of direct node requests (one label for every node, so labels stay bounded).
pub const NODE_HOST_LABEL: &str = "direct-node";

/// Counters of one host label in one lane, for metrics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostLaneStats {
    /// Upstream host name, or [`NODE_HOST_LABEL`].
    pub host: String,
    /// HTTP attempts that got an answer (2xx or 304).
    pub ok: u64,
    /// HTTP attempts that failed (transport, timeout, non-success status, oversize body).
    pub err: u64,
    /// Requests queued for this host's gate right now.
    pub waiting: u64,
}

/// Counts a request as waiting for its gate until dropped.
struct Waiting<'a>(&'a AtomicI64);

impl<'a> Waiting<'a> {
    fn enter(c: &'a AtomicI64) -> Self {
        c.fetch_add(1, Ordering::Relaxed);
        Self(c)
    }
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Shared HTTP client. Cheap to clone; clones share gates and counters.
#[derive(Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
    cfg: Arc<HttpConfig>,
    lane: Lane,
    gates: Arc<Mutex<HashMap<String, Arc<HostGate>>>>,
    /// Counters per host label (bounded: configured hosts plus [`NODE_HOST_LABEL`]).
    counters: Arc<Mutex<BTreeMap<String, Arc<HostCounters>>>>,
}

impl std::fmt::Debug for HttpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpClient")
            .field("lane", &self.lane)
            .field("cfg", &self.cfg)
            .finish_non_exhaustive()
    }
}

impl HttpClient {
    pub fn new(cfg: HttpConfig) -> Result<Self> {
        let inner = reqwest::Client::builder()
            .user_agent(cfg.user_agent.clone())
            .connect_timeout(cfg.connect_timeout)
            .timeout(cfg.timeout)
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            // Never follow redirects: a node could redirect us to an internal address.
            .redirect(reqwest::redirect::Policy::none())
            .gzip(true)
            .brotli(true)
            .zstd(true)
            .build()
            .map_err(|e| FluxError::Transport {
                url: String::new(),
                message: e.to_string(),
            })?;
        Ok(Self::assemble(inner, cfg, Lane::Ingest))
    }

    fn assemble(inner: reqwest::Client, cfg: HttpConfig, lane: Lane) -> Self {
        Self {
            inner,
            cfg: Arc::new(cfg),
            lane,
            gates: Arc::new(Mutex::new(HashMap::new())),
            counters: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    /// A client for `lane` that shares this client's connection pool (TLS sessions, idle
    /// connections) but has its own per-host gates and counters, built from the lane's
    /// policies in this client's configuration.
    #[must_use]
    pub fn lane(&self, lane: Lane) -> Self {
        Self::assemble(self.inner.clone(), self.cfg.for_lane(lane), lane)
    }

    /// The lane this client draws from.
    pub fn lane_kind(&self) -> Lane {
        self.lane
    }

    pub fn config(&self) -> &HttpConfig {
        &self.cfg
    }

    /// Request counters per host label of this lane, sorted by host.
    pub fn lane_stats(&self) -> Vec<HostLaneStats> {
        let map = self
            .counters
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        map.iter()
            .map(|(host, c)| HostLaneStats {
                host: host.clone(),
                ok: c.ok.load(Ordering::Relaxed),
                err: c.err.load(Ordering::Relaxed),
                waiting: u64::try_from(c.waiting.load(Ordering::Relaxed)).unwrap_or(0),
            })
            .collect()
    }

    fn counters_for(&self, label: &str) -> Arc<HostCounters> {
        let mut map = self
            .counters
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        map.entry(label.to_owned()).or_default().clone()
    }

    fn gate(&self, key: &str, label: &str, policy: HostPolicy) -> Arc<HostGate> {
        let mut map = self
            .gates
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(g) = map.get(key) {
            return g.clone();
        }
        let g = Arc::new(HostGate::new(policy, self.counters_for(label)));
        map.insert(key.to_owned(), g.clone());
        g
    }

    fn gate_for_url(&self, url: &Url) -> Arc<HostGate> {
        let host = url.host_str().unwrap_or_default();
        self.gate(host, host, self.cfg.policy_for(host))
    }

    /// GET with rate limiting, retries and size cap. `opts.if_none_match` enables 304 handling.
    pub async fn get(&self, url: &Url, opts: &RequestOpts) -> Result<Fetched> {
        let gate = self.gate_for_url(url);
        let max = opts.max_bytes.unwrap_or(self.cfg.max_body_bytes);
        self.get_with_gate(url, opts, &gate, max).await
    }

    /// GET that expects a body (no conditional request).
    pub async fn get_body(&self, url: &Url, opts: &RequestOpts) -> Result<Body> {
        match self.get(url, opts).await? {
            Fetched::Body(b) => Ok(b),
            Fetched::NotModified => Err(FluxError::Status {
                url: url.to_string(),
                status: 304,
                body_snippet: String::new(),
            }),
        }
    }

    /// GET against a node's FluxOS API. The endpoint type guarantees the SSRF check; requests
    /// are limited per IP (co-hosted UPnP nodes share one budget) and capped at
    /// [`HttpConfig::max_node_body_bytes`].
    pub async fn get_node(
        &self,
        ep: &GuardedEndpoint,
        path_and_query: &str,
        opts: &RequestOpts,
    ) -> Result<Body> {
        let url = node_url(ep, path_and_query)?;
        let gate = self.gate(
            &format!("node:{}", ep.endpoint().ip),
            NODE_HOST_LABEL,
            self.cfg.node_policy,
        );
        // The default cap applies to crawl-style reads; failover reads of global endpoints
        // (for example the 4 MB node list) opt in to a larger explicit cap.
        let max = opts.max_bytes.unwrap_or(self.cfg.max_node_body_bytes);
        match self.get_with_gate(&url, opts, &gate, max).await? {
            Fetched::Body(b) => Ok(b),
            Fetched::NotModified => Err(FluxError::Status {
                url: url.to_string(),
                status: 304,
                body_snippet: String::new(),
            }),
        }
    }

    async fn get_with_gate(
        &self,
        url: &Url,
        opts: &RequestOpts,
        gate: &HostGate,
        max: usize,
    ) -> Result<Fetched> {
        let attempts = opts.attempts.unwrap_or(self.cfg.attempts).max(1);
        let mut url = url.clone();
        let mut last_err = None;
        for attempt in 0..attempts {
            if opts.cache_bust {
                set_cache_bust(&mut url);
            }
            let result = {
                let waiting = Waiting::enter(&gate.counters.waiting);
                let _permit = gate.sem.acquire().await.map_err(|_| FluxError::Transport {
                    url: url.to_string(),
                    message: "semaphore closed".to_owned(),
                })?;
                gate.limiter.until_ready().await;
                drop(waiting);
                self.attempt(&url, opts, max).await
            };
            let counter = if result.is_ok() {
                &gate.counters.ok
            } else {
                &gate.counters.err
            };
            counter.fetch_add(1, Ordering::Relaxed);
            match result {
                Ok(f) => return Ok(f),
                Err(e) if e.is_retryable() && attempt + 1 < attempts => {
                    let delay = match &e {
                        FluxError::RateLimited {
                            retry_after: Some(d),
                        } => {
                            if *d > self.cfg.max_retry_after {
                                return Err(e);
                            }
                            *d
                        }
                        _ => backoff(attempt, self.cfg.backoff_base, self.cfg.backoff_max),
                    };
                    tracing::debug!(url = %url, attempt, error = %e, delay_ms = delay.as_millis() as u64, "retrying upstream request");
                    last_err = Some(e);
                    tokio::time::sleep(delay).await;
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap_or(FluxError::NoHealthyUpstream("http")))
    }

    async fn attempt(&self, url: &Url, opts: &RequestOpts, max: usize) -> Result<Fetched> {
        let started = Instant::now();
        let timeout = opts.timeout.unwrap_or(self.cfg.timeout);
        let mut req = self.inner.get(url.clone()).timeout(timeout);
        if let Some(tag) = &opts.if_none_match {
            req = req.header(IF_NONE_MATCH, tag);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| map_reqwest(url, &e, timeout))?;
        let status = resp.status();
        let headers = resp.headers().clone();
        if status == StatusCode::NOT_MODIFIED {
            return Ok(Fetched::NotModified);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(FluxError::RateLimited {
                retry_after: retry_after(&headers),
            });
        }
        if let Some(len) = resp.content_length()
            && len > max as u64
        {
            return Err(FluxError::TooLarge { limit: max });
        }
        let bytes = read_capped(resp, max, url, timeout).await?;
        if !status.is_success() {
            let snippet = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).into_owned();
            return Err(FluxError::Status {
                url: url.to_string(),
                status: status.as_u16(),
                body_snippet: snippet,
            });
        }
        Ok(Fetched::Body(Body {
            bytes,
            status: status.as_u16(),
            etag: header_str(&headers, ETAG.as_str()),
            served_by: header_str(&headers, "fluxnode"),
            elapsed: started.elapsed(),
        }))
    }
}

async fn read_capped(
    mut resp: reqwest::Response,
    max: usize,
    url: &Url,
    timeout: Duration,
) -> Result<Bytes> {
    let mut buf = BytesMut::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| map_reqwest(url, &e, timeout))?
    {
        if buf.len() + chunk.len() > max {
            return Err(FluxError::TooLarge { limit: max });
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf.freeze())
}

fn map_reqwest(url: &Url, e: &reqwest::Error, timeout: Duration) -> FluxError {
    if e.is_timeout() {
        FluxError::Timeout(timeout)
    } else {
        FluxError::Transport {
            url: url.to_string(),
            message: e.to_string(),
        }
    }
}

fn header_str(h: &HeaderMap, name: &str) -> Option<String> {
    h.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
}

/// Parses `Retry-After` in its delta-seconds form (HTTP dates are ignored).
pub fn retry_after(h: &HeaderMap) -> Option<Duration> {
    let v = h
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?;
    Some(Duration::from_secs(v))
}

/// Full-jitter exponential backoff: uniform in `[base/2, min(max, base * 2^attempt)]`.
pub fn backoff(attempt: u32, base: Duration, max: Duration) -> Duration {
    let exp = base.saturating_mul(1u32 << attempt.min(16));
    let cap = exp.min(max);
    let lo = (cap / 2).as_millis() as u64;
    let hi = cap.as_millis() as u64;
    let ms = if hi > lo {
        rand::rng().random_range(lo..=hi)
    } else {
        hi
    };
    Duration::from_millis(ms)
}

fn set_cache_bust(url: &mut Url) {
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != "nc")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let mut q = url.query_pairs_mut();
    q.clear();
    for (k, v) in pairs {
        q.append_pair(&k, &v);
    }
    q.append_pair("nc", &atlas_core::now_ms().to_string());
}

/// Builds `http://ip:port/<path>` for a guarded node endpoint.
pub fn node_url(ep: &GuardedEndpoint, path_and_query: &str) -> Result<Url> {
    let path = path_and_query.trim_start_matches('/');
    Url::parse(&format!("{}/{path}", ep.base_url())).map_err(|e| FluxError::BadUrl(e.to_string()))
}

/// Joins a base URL and a path (the path may contain a query string).
pub fn join(base: &Url, path_and_query: &str) -> Result<Url> {
    let mut s = base.as_str().trim_end_matches('/').to_owned();
    s.push('/');
    s.push_str(path_and_query.trim_start_matches('/'));
    Url::parse(&s).map_err(|e| FluxError::BadUrl(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_bounded_and_grows() {
        let base = Duration::from_millis(100);
        let max = Duration::from_secs(2);
        for attempt in 0..10 {
            let d = backoff(attempt, base, max);
            assert!(d <= max);
        }
        let d0 = backoff(0, base, max);
        assert!(d0 >= Duration::from_millis(50) && d0 <= Duration::from_millis(100));
        let d5 = backoff(5, base, max);
        assert!(d5 >= Duration::from_secs(1));
    }

    #[test]
    fn retry_after_header() {
        let mut h = HeaderMap::new();
        h.insert(RETRY_AFTER, "7".parse().unwrap());
        assert_eq!(retry_after(&h), Some(Duration::from_secs(7)));
        h.insert(
            RETRY_AFTER,
            "Wed, 21 Oct 2015 07:28:00 GMT".parse().unwrap(),
        );
        assert_eq!(retry_after(&h), None);
    }

    #[test]
    fn urls() {
        let base = Url::parse("https://api.runonflux.io/").unwrap();
        assert_eq!(
            join(&base, "/daemon/getblockcount").unwrap().as_str(),
            "https://api.runonflux.io/daemon/getblockcount"
        );
        let mut u = join(&base, "daemon/getblockhash/5?x=1").unwrap();
        set_cache_bust(&mut u);
        set_cache_bust(&mut u);
        let q: Vec<_> = u.query_pairs().map(|(k, _)| k.into_owned()).collect();
        assert_eq!(q, vec!["x".to_owned(), "nc".to_owned()]);
        let ep = GuardedEndpoint::new("94.130.137.2:16137".parse().unwrap()).unwrap();
        assert_eq!(
            node_url(&ep, "/flux/version").unwrap().as_str(),
            "http://94.130.137.2:16137/flux/version"
        );
    }

    #[test]
    fn error_classes() {
        assert!(FluxError::Timeout(Duration::from_secs(1)).is_retryable());
        assert!(
            FluxError::Status {
                url: String::new(),
                status: 502,
                body_snippet: String::new()
            }
            .is_retryable()
        );
        assert!(
            !FluxError::Status {
                url: String::new(),
                status: 404,
                body_snippet: String::new()
            }
            .is_retryable()
        );
        assert!(FluxError::RateLimited { retry_after: None }.is_retryable());
        assert!(
            !FluxError::Upstream {
                code: Some(-8),
                name: None,
                message: String::new()
            }
            .is_retryable()
        );
    }
}

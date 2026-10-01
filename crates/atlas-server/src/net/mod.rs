//! The edge of the server: who the client is ([`trust`]), the listener with its connection
//! caps and timeouts ([`listener`]), process hardening at startup ([`harden`]), and the
//! request middleware that runs before any route: client address resolution, the request
//! timeout, security headers and the private metrics gate.

pub mod harden;
pub mod listener;
pub mod trust;

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderValue, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::ApiError;
use crate::extract::ClientIp;
use crate::state::AppState;
use trust::{FDM_APP_BALANCERS, Source, TrustedProxies, canonical};

/// The TCP peer of a request (never taken from a header).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerAddr(pub IpAddr);

impl PeerAddr {
    /// The peer recorded by the listener, or loopback for in-process requests (tests).
    pub fn of(ext: &axum::http::Extensions) -> Self {
        Self(
            ext.get::<ConnectInfo<SocketAddr>>()
                .map_or(IpAddr::V4(Ipv4Addr::LOCALHOST), |c| canonical(c.0.ip())),
        )
    }
}

/// Most distinct untrusted forwarding peers remembered (by a hash of their /24 or /48).
const MAX_TRACKED_PREFIXES: usize = 4096;

/// How client addresses were derived: anonymised counters for the first deploy (are requests
/// arriving through FDM, from which balancers, with which headers). Nothing here records a
/// user's address: the per-peer counters cover the built-in FDM balancers only, and other
/// peers that send forwarding headers are counted by a hash of their network prefix.
#[derive(Debug)]
pub struct ForwardStats {
    by_source: [AtomicU64; Source::ALL.len()],
    by_fdm_peer: Vec<AtomicU64>,
    untrusted_prefixes: Mutex<HashSet<u64>>,
}

impl Default for ForwardStats {
    fn default() -> Self {
        Self {
            by_source: Default::default(),
            by_fdm_peer: FDM_APP_BALANCERS
                .iter()
                .map(|_| AtomicU64::new(0))
                .collect(),
            untrusted_prefixes: Mutex::new(HashSet::new()),
        }
    }
}

/// A hash of the /24 (IPv4) or /48 (IPv6) of `ip`: enough to count distinct networks without
/// keeping their addresses.
fn prefix_hash(ip: IpAddr) -> u64 {
    use std::hash::Hasher as _;
    let mut f = std::hash::DefaultHasher::new();
    match ip {
        IpAddr::V4(v4) => f.write(&v4.octets()[..3]),
        IpAddr::V6(v6) => f.write(&v6.octets()[..6]),
    }
    f.finish()
}

impl ForwardStats {
    pub fn record(&self, peer: IpAddr, source: Source) {
        self.by_source[source.index()].fetch_add(1, Ordering::Relaxed);
        match source {
            Source::Forwarded | Source::ProxyNoHeader | Source::ProxyBadHeader => {
                if let Some(i) = FDM_APP_BALANCERS
                    .iter()
                    .position(|a| a.parse::<IpAddr>().is_ok_and(|b| b == peer))
                {
                    self.by_fdm_peer[i].fetch_add(1, Ordering::Relaxed);
                }
            }
            Source::DirectHeaderIgnored => {
                let h = prefix_hash(peer);
                let mut s = self
                    .untrusted_prefixes
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if s.len() < MAX_TRACKED_PREFIXES && s.insert(h) {
                    // Debug only: the prefix of a peer that sends forwarding headers but is not a
                    // trusted proxy (a new FDM balancer, or a client forging the header).
                    tracing::debug!(
                        prefix = %prefix_label(peer),
                        "forwarding header from an untrusted peer (ignored)"
                    );
                }
            }
            Source::Direct => {}
        }
    }

    pub fn source_count(&self, s: Source) -> u64 {
        self.by_source[s.index()].load(Ordering::Relaxed)
    }

    /// Per-FDM-balancer request counts (address, count) with a non-zero count.
    pub fn fdm_peers(&self) -> Vec<(&'static str, u64)> {
        FDM_APP_BALANCERS
            .iter()
            .zip(&self.by_fdm_peer)
            .map(|(a, c)| (*a, c.load(Ordering::Relaxed)))
            .filter(|(_, c)| *c > 0)
            .collect()
    }

    /// Distinct network prefixes of untrusted peers that sent forwarding headers.
    pub fn untrusted_forwarders(&self) -> usize {
        self.untrusted_prefixes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }
}

fn prefix_label(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            format!("{}.{}.{}.0/24", o[0], o[1], o[2])
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            format!("{:x}:{:x}:{:x}::/48", s[0], s[1], s[2])
        }
    }
}

/// First middleware: resolves the client address once per request (`ClientIp`, `PeerAddr`).
pub async fn client_ip(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let peer = PeerAddr::of(req.extensions());
    let (ip, source) = trust::resolve(peer.0, req.headers(), &state.cfg.proxies);
    state.forward.record(peer.0, source);
    req.extensions_mut().insert(peer);
    req.extensions_mut().insert(ClientIp(ip));
    next.run(req).await
}

/// Bounds the time to produce a response. A WebSocket upgrade answers at once (the session
/// runs in its own task afterwards), so live connections are not affected.
pub async fn request_timeout(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let limit = state.cfg.http.request_timeout;
    if let Ok(r) = tokio::time::timeout(limit, next.run(req)).await {
        r
    } else {
        state
            .metrics
            .request_timeouts
            .fetch_add(1, Ordering::Relaxed);
        ApiError::unavailable("the request took too long; try again")
            .with_retry_after(5)
            .into_response()
    }
}

/// Content-Security-Policy of the web app. The build has no inline script, no `eval`, no
/// workers and no third-party origins; React sets styles through the CSSOM, which
/// `style-src 'self'` allows. `connect-src` lists `ws:`/`wss:` because older Safari does not
/// match WebSocket URLs against `'self'`.
pub const CSP_DOCUMENT: &str = "default-src 'self'; script-src 'self'; style-src 'self'; \
img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; media-src 'none'; \
object-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; manifest-src 'self'; \
base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Content-Security-Policy of every other response (API bodies, assets): nothing may run.
pub const CSP_RESOURCE: &str = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/// Security headers on every response: CSP, `X-Frame-Options`, `nosniff`, referrer policy.
pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    let is_html = h
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with("text/html"));
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(if is_html { CSP_DOCUMENT } else { CSP_RESOURCE }),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    resp
}

/// Whether a request may read `/metrics/prometheus`: from loopback (inside the container,
/// `atlas metrics`), or with `Authorization: Bearer <ATLAS_METRICS_TOKEN>`. The TCP peer is
/// used, never a forwarding header.
pub fn metrics_allowed(
    peer: PeerAddr,
    headers: &axum::http::HeaderMap,
    token: Option<&str>,
) -> bool {
    if peer.0.is_loopback() {
        return true;
    }
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return false;
    };
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|given| constant_time_eq(given.trim().as_bytes(), token.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Proxies in the `ATLAS_TRUSTED_PROXIES` sense, for the startup log.
pub fn describe(p: &TrustedProxies) -> String {
    if p.trusts_all() {
        "every peer (ATLAS_TRUST_PROXY)".to_owned()
    } else if p.is_empty() {
        "none".to_owned()
    } else if *p == TrustedProxies::fdm() {
        format!("{} FDM app balancers (built in)", p.len())
    } else {
        format!("{} configured blocks", p.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_gate() {
        let lo = PeerAddr("127.0.0.1".parse().unwrap());
        let far = PeerAddr("203.0.113.9".parse().unwrap());
        let mut h = axum::http::HeaderMap::new();
        assert!(metrics_allowed(lo, &h, None));
        assert!(!metrics_allowed(far, &h, None));
        assert!(!metrics_allowed(far, &h, Some("s3cret")));
        h.insert(header::AUTHORIZATION, "Bearer s3cret".parse().unwrap());
        assert!(metrics_allowed(far, &h, Some("s3cret")));
        assert!(!metrics_allowed(far, &h, Some("other")));
        assert!(
            !metrics_allowed(far, &h, Some("")),
            "empty token never opens it"
        );
        assert!(!metrics_allowed(far, &h, None));
    }

    #[test]
    fn forward_stats_are_anonymised() {
        let s = ForwardStats::default();
        s.record("5.39.57.42".parse().unwrap(), Source::Forwarded);
        s.record("5.39.57.42".parse().unwrap(), Source::Forwarded);
        s.record("198.51.100.1".parse().unwrap(), Source::DirectHeaderIgnored);
        s.record(
            "198.51.100.77".parse().unwrap(),
            Source::DirectHeaderIgnored,
        );
        s.record("198.51.101.1".parse().unwrap(), Source::DirectHeaderIgnored);
        assert_eq!(s.source_count(Source::Forwarded), 2);
        assert_eq!(s.fdm_peers(), vec![("5.39.57.42", 2)]);
        assert_eq!(s.untrusted_forwarders(), 2, "one per /24");
        assert_eq!(
            prefix_label("198.51.100.77".parse().unwrap()),
            "198.51.100.0/24"
        );
    }
}

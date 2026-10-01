//! Request metrics, tracing spans, CORS, and the Prometheus text exposition.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use axum::extract::{MatchedPath, Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tracing::Instrument as _;

use crate::state::AppState;

/// Histogram bucket upper bounds, seconds.
pub const BUCKETS: [f64; 14] = [
    0.000_25, 0.000_5, 0.001, 0.002_5, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 10.0,
];

/// Counters of one route.
#[derive(Debug, Default)]
pub struct RouteStats {
    /// By status class 1xx..5xx.
    by_class: [AtomicU64; 5],
    buckets: [AtomicU64; BUCKETS.len()],
    sum_ns: AtomicU64,
    count: AtomicU64,
}

impl RouteStats {
    fn observe(&self, status: StatusCode, elapsed: Duration) {
        let class = (status.as_u16() / 100).clamp(1, 5) as usize - 1;
        self.by_class[class].fetch_add(1, Ordering::Relaxed);
        let s = elapsed.as_secs_f64();
        if let Some(i) = BUCKETS.iter().position(|b| s <= *b) {
            self.buckets[i].fetch_add(1, Ordering::Relaxed);
        }
        self.sum_ns
            .fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
        self.count.fetch_add(1, Ordering::Relaxed);
    }
}

/// Server-wide metrics registry.
#[derive(Debug, Default)]
pub struct Metrics {
    routes: RwLock<HashMap<String, Arc<RouteStats>>>,
    /// Requests refused by the per-IP upstream limiter.
    pub rate_limited: AtomicU64,
    /// Requests refused because every upstream slot was busy.
    pub upstream_busy: AtomicU64,
    /// Requests answered 503 by the request timeout.
    pub request_timeouts: AtomicU64,
    /// Store reads that did not finish within their deadline.
    pub store_timeouts: AtomicU64,
}

impl Metrics {
    fn route(&self, route: &str) -> Arc<RouteStats> {
        if let Some(s) = self
            .routes
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(route)
        {
            return Arc::clone(s);
        }
        let mut w = self
            .routes
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Arc::clone(w.entry(route.to_owned()).or_default())
    }

    /// Total requests seen for `route` (all statuses).
    pub fn route_count(&self, route: &str) -> u64 {
        self.routes
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(route)
            .map_or(0, |s| s.count.load(Ordering::Relaxed))
    }

    /// Appends the HTTP families to a Prometheus exposition.
    pub fn render_http(&self, out: &mut String) {
        let routes = self
            .routes
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut names: Vec<&String> = routes.keys().collect();
        names.sort();
        out.push_str("# HELP atlas_http_requests_total HTTP requests by route and status class.\n");
        out.push_str("# TYPE atlas_http_requests_total counter\n");
        for name in &names {
            let s = &routes[*name];
            for (i, c) in s.by_class.iter().enumerate() {
                let v = c.load(Ordering::Relaxed);
                if v > 0 {
                    let _ = writeln!(
                        out,
                        "atlas_http_requests_total{{route=\"{}\",status=\"{}xx\"}} {v}",
                        escape(name),
                        i + 1
                    );
                }
            }
        }
        out.push_str("# HELP atlas_http_request_duration_seconds HTTP request latency by route.\n");
        out.push_str("# TYPE atlas_http_request_duration_seconds histogram\n");
        for name in &names {
            let s = &routes[*name];
            let route = escape(name);
            let mut cum = 0u64;
            for (i, b) in BUCKETS.iter().enumerate() {
                cum += s.buckets[i].load(Ordering::Relaxed);
                let _ = writeln!(
                    out,
                    "atlas_http_request_duration_seconds_bucket{{route=\"{route}\",le=\"{b}\"}} {cum}"
                );
            }
            let count = s.count.load(Ordering::Relaxed);
            let _ = writeln!(
                out,
                "atlas_http_request_duration_seconds_bucket{{route=\"{route}\",le=\"+Inf\"}} {count}"
            );
            let _ = writeln!(
                out,
                "atlas_http_request_duration_seconds_sum{{route=\"{route}\"}} {}",
                s.sum_ns.load(Ordering::Relaxed) as f64 / 1e9
            );
            let _ = writeln!(
                out,
                "atlas_http_request_duration_seconds_count{{route=\"{route}\"}} {count}"
            );
        }
    }
}

/// Escapes a Prometheus label value.
pub fn escape(v: &str) -> String {
    v.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// Appends one metric family with a single unlabeled sample.
pub fn family(out: &mut String, name: &str, kind: &str, help: &str, value: impl std::fmt::Display) {
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} {kind}");
    let _ = writeln!(out, "{name} {value}");
}

/// Writes the `# HELP` / `# TYPE` header of a family.
pub fn header(out: &mut String, name: &str, kind: &str, help: &str) {
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} {kind}");
}

/// Writes one labelled sample; `labels` is `key="value",...` (already escaped) or empty.
pub fn sample(out: &mut String, name: &str, labels: &str, value: impl std::fmt::Display) {
    if labels.is_empty() {
        let _ = writeln!(out, "{name} {value}");
    } else {
        let _ = writeln!(out, "{name}{{{labels}}} {value}");
    }
}

/// Writes the samples of one histogram (cumulative buckets, `+Inf`, sum, count). Call
/// [`header`] once per family first.
pub fn histogram_samples(
    out: &mut String,
    name: &str,
    labels: &str,
    h: &atlas_engine::stats::Histogram,
) {
    let sep = if labels.is_empty() { "" } else { "," };
    let mut cum = 0u64;
    for (b, c) in h.bounds.iter().zip(&h.counts) {
        cum += c;
        let _ = writeln!(out, "{name}_bucket{{{labels}{sep}le=\"{b}\"}} {cum}");
    }
    let _ = writeln!(out, "{name}_bucket{{{labels}{sep}le=\"+Inf\"}} {}", h.count);
    sample(out, &format!("{name}_sum"), labels, h.sum);
    sample(out, &format!("{name}_count"), labels, h.count);
}

/// The first `max` bytes of `s`, cut at a character boundary.
fn clip(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Per-request middleware: tracing span, latency histogram, slow-request warning (with method,
/// route, query and status).
pub async fn track(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map_or("fallback", MatchedPath::as_str);
    let stats = state.metrics.route(route);
    let route = route.to_owned();
    let method = req.method().clone();
    // The query (percent-encoded, so one line) and, for unmatched routes, the path: what the slow
    // request log needs to name the request. Bounded so a long URL cannot flood the log.
    let query = req.uri().query().map(|q| clip(q, 256).to_owned());
    let path = (route == "fallback").then(|| clip(req.uri().path(), 256).to_owned());
    let span = tracing::debug_span!("http", method = %method, route = %route);
    let started = Instant::now();
    let resp = next.run(req).instrument(span.clone()).await;
    let elapsed = started.elapsed();
    stats.observe(resp.status(), elapsed);
    let _e = span.enter();
    if elapsed > Duration::from_secs(1) {
        tracing::warn!(
            method = %method,
            route = %route,
            path = path.as_deref().unwrap_or(""),
            query = query.as_deref().unwrap_or(""),
            status = resp.status().as_u16(),
            ms = elapsed.as_millis() as u64,
            "slow request"
        );
    } else {
        tracing::debug!(
            status = resp.status().as_u16(),
            us = elapsed.as_micros() as u64,
            "request"
        );
    }
    resp
}

/// Open CORS for the public read API: `*` origin, preflight answered here.
pub async fn cors(req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        let mut r = StatusCode::NO_CONTENT.into_response();
        let h = r.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, HEAD, OPTIONS"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("if-none-match, accept-encoding, content-type"),
        );
        h.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("86400"),
        );
        return r;
    }
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    h.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("etag, retry-after"),
    );
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposition_shape() {
        let m = Metrics::default();
        m.route("/api/v1/x")
            .observe(StatusCode::OK, Duration::from_micros(300));
        m.route("/api/v1/x")
            .observe(StatusCode::NOT_FOUND, Duration::from_millis(3));
        let mut s = String::new();
        m.render_http(&mut s);
        assert!(s.contains("atlas_http_requests_total{route=\"/api/v1/x\",status=\"2xx\"} 1"));
        assert!(s.contains("atlas_http_requests_total{route=\"/api/v1/x\",status=\"4xx\"} 1"));
        assert!(s.contains("le=\"+Inf\"} 2"));
        assert_eq!(m.route_count("/api/v1/x"), 2);
        assert_eq!(escape("a\"b"), "a\\\"b");
    }
}

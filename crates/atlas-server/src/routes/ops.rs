//! Ops endpoints: `/healthz`, `/readyz`, `/metrics/prometheus`.

use std::fmt::Write as _;
use std::sync::atomic::Ordering;

use atlas_core::api::HealthDto;
use atlas_core::now_ms;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::metrics::{escape, family};
use crate::state::AppState;

fn health(s: &AppState) -> (bool, HealthDto) {
    let p = s.engine.published();
    let age_ms = now_ms().saturating_sub(p.generated_ms);
    let degraded = age_ms > s.cfg.degraded_after.as_millis() as u64;
    let status = if p.stale {
        "starting"
    } else if degraded {
        "degraded"
    } else {
        "ok"
    };
    (
        !p.stale,
        HealthDto {
            status: status.to_owned(),
            seq: s.engine.seq(),
            uptime_s: s.started.elapsed().as_secs(),
            tip_height: p.network.tip.as_ref().map(|t| t.height),
        },
    )
}

fn no_store(mut r: Response) -> Response {
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// Liveness: 200 while the process serves requests.
pub async fn healthz(State(s): State<AppState>) -> Response {
    no_store(Json(health(&s).1).into_response())
}

/// Readiness: 200 once the engine published fresh (non-stale) state, 503 before.
pub async fn readyz(State(s): State<AppState>) -> Response {
    let (ready, dto) = health(&s);
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    no_store((status, Json(dto)).into_response())
}

/// Prometheus text exposition.
pub async fn prometheus(State(s): State<AppState>) -> Response {
    let mut out = String::with_capacity(8 * 1024);
    s.metrics.render_http(&mut out);
    let p = s.engine.published();
    let stats = &s.hub.stats;
    let load = |a: &std::sync::atomic::AtomicU64| a.load(Ordering::Relaxed);
    family(
        &mut out,
        "atlas_published_seq",
        "gauge",
        "Sequence of the published state.",
        p.seq,
    );
    family(
        &mut out,
        "atlas_live_seq",
        "gauge",
        "Latest live message sequence.",
        s.engine.seq(),
    );
    family(
        &mut out,
        "atlas_published_age_seconds",
        "gauge",
        "Age of the published state.",
        now_ms().saturating_sub(p.generated_ms) as f64 / 1000.0,
    );
    family(
        &mut out,
        "atlas_published_stale",
        "gauge",
        "1 while serving restored state.",
        u8::from(p.stale),
    );
    family(
        &mut out,
        "atlas_nodes",
        "gauge",
        "Nodes in the published view.",
        p.nodes.len(),
    );
    family(
        &mut out,
        "atlas_ws_connections",
        "gauge",
        "Open WebSocket connections.",
        s.hub.connections(),
    );
    family(
        &mut out,
        "atlas_ws_connections_total",
        "counter",
        "Accepted WebSocket connections.",
        load(&stats.connections_total),
    );
    family(
        &mut out,
        "atlas_ws_rejected_total",
        "counter",
        "Refused WebSocket connections (limits).",
        load(&stats.rejected_total),
    );
    family(
        &mut out,
        "atlas_ws_frames_published_total",
        "counter",
        "Live messages serialized by the hub.",
        load(&stats.frames_published),
    );
    family(
        &mut out,
        "atlas_ws_messages_sent_total",
        "counter",
        "Messages written to clients.",
        load(&stats.messages_sent),
    );
    family(
        &mut out,
        "atlas_ws_bytes_sent_total",
        "counter",
        "Payload bytes written to clients.",
        load(&stats.bytes_sent),
    );
    family(
        &mut out,
        "atlas_ws_messages_dropped_total",
        "counter",
        "Messages missed by lagging clients before they were dropped.",
        load(&stats.messages_dropped),
    );
    family(
        &mut out,
        "atlas_ws_slow_consumer_disconnects_total",
        "counter",
        "Clients dropped as slow consumers.",
        load(&stats.slow_consumer_disconnects),
    );
    family(
        &mut out,
        "atlas_ws_idle_disconnects_total",
        "counter",
        "Clients closed after the idle timeout.",
        load(&stats.idle_disconnects),
    );
    family(
        &mut out,
        "atlas_ws_replayed_total",
        "counter",
        "Messages replayed on resubscribe.",
        load(&stats.replayed),
    );
    family(
        &mut out,
        "atlas_ws_resyncs_total",
        "counter",
        "Resync answers sent.",
        load(&stats.resyncs),
    );
    family(
        &mut out,
        "atlas_upstream_rate_limited_total",
        "counter",
        "Client requests refused by the per-IP upstream limiter.",
        s.explorer.guard.rate_limited.load(Ordering::Relaxed),
    );
    family(
        &mut out,
        "atlas_upstream_busy_total",
        "counter",
        "Client requests refused because upstream slots were saturated.",
        s.explorer.guard.busy.load(Ordering::Relaxed),
    );
    let _ = writeln!(
        out,
        "# HELP atlas_proxy_cache_requests_total Explorer proxy cache lookups."
    );
    let _ = writeln!(out, "# TYPE atlas_proxy_cache_requests_total counter");
    let caches = s.explorer.cache_stats();
    for (name, c, _) in &caches {
        let n = escape(name);
        let _ = writeln!(
            out,
            "atlas_proxy_cache_requests_total{{cache=\"{n}\",result=\"hit\"}} {}",
            load(&c.hits)
        );
        let _ = writeln!(
            out,
            "atlas_proxy_cache_requests_total{{cache=\"{n}\",result=\"miss\"}} {}",
            load(&c.misses)
        );
        let _ = writeln!(
            out,
            "atlas_proxy_cache_requests_total{{cache=\"{n}\",result=\"error\"}} {}",
            load(&c.errors)
        );
    }
    let _ = writeln!(
        out,
        "# HELP atlas_proxy_cache_entries Entries held by each explorer proxy cache."
    );
    let _ = writeln!(out, "# TYPE atlas_proxy_cache_entries gauge");
    for (name, _, entries) in &caches {
        let _ = writeln!(
            out,
            "atlas_proxy_cache_entries{{cache=\"{}\"}} {entries}",
            escape(name)
        );
    }
    let mut r = out.into_response();
    let h = r.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

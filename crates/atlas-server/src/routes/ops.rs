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
    render_engine(&s, &mut out);
    let mut r = out.into_response();
    let h = r.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// Engine families: ingest jobs (runs, errors, upstream time, freshness), upstream calls,
/// derived events, live messages, store commits, publishes and the replay rings. Labels are
/// bounded sets (job, host, event kind, message type, ring); per-endpoint detail stays in logs.
fn render_engine(s: &AppState, out: &mut String) {
    use crate::metrics::{header, histogram_samples, sample};
    let stats = s.engine.stats();
    let jobs = s.engine.job_counters();

    header(
        out,
        "atlas_ingest_job_runs_total",
        "counter",
        "Successful runs (updates delivered) per ingest job.",
    );
    for j in &jobs {
        sample(
            out,
            "atlas_ingest_job_runs_total",
            &format!("job=\"{}\"", j.job),
            j.ok_total,
        );
    }
    header(
        out,
        "atlas_ingest_job_errors_total",
        "counter",
        "Failed attempts per ingest job.",
    );
    for j in &jobs {
        sample(
            out,
            "atlas_ingest_job_errors_total",
            &format!("job=\"{}\"", j.job),
            j.err_total,
        );
    }
    header(
        out,
        "atlas_ingest_job_last_success_age_seconds",
        "gauge",
        "Seconds since the job last succeeded (absent before its first success).",
    );
    for j in &jobs {
        if let Some(age) = j.age_s {
            sample(
                out,
                "atlas_ingest_job_last_success_age_seconds",
                &format!("job=\"{}\"", j.job),
                age,
            );
        }
    }
    header(
        out,
        "atlas_ingest_job_stale",
        "gauge",
        "1 when the job's data is older than its freshness budget.",
    );
    for j in &jobs {
        sample(
            out,
            "atlas_ingest_job_stale",
            &format!("job=\"{}\"", j.job),
            u8::from(j.stale),
        );
    }
    header(
        out,
        "atlas_ingest_job_upstream_calls_total",
        "counter",
        "Upstream calls per ingest task.",
    );
    for (job, t) in &stats.job_upstream {
        sample(
            out,
            "atlas_ingest_job_upstream_calls_total",
            &format!("job=\"{job}\""),
            t.calls,
        );
    }
    header(
        out,
        "atlas_ingest_job_upstream_errors_total",
        "counter",
        "Failed upstream calls per ingest task.",
    );
    for (job, t) in &stats.job_upstream {
        sample(
            out,
            "atlas_ingest_job_upstream_errors_total",
            &format!("job=\"{job}\""),
            t.errors,
        );
    }
    header(
        out,
        "atlas_ingest_job_upstream_seconds_total",
        "counter",
        "Time spent in upstream calls per ingest task (the job duration).",
    );
    for (job, t) in &stats.job_upstream {
        sample(
            out,
            "atlas_ingest_job_upstream_seconds_total",
            &format!("job=\"{job}\""),
            t.seconds,
        );
    }

    header(
        out,
        "atlas_upstream_requests_total",
        "counter",
        "Upstream calls by host and result.",
    );
    for (host, c) in &stats.upstream {
        let h = escape(host);
        sample(
            out,
            "atlas_upstream_requests_total",
            &format!("host=\"{h}\",result=\"ok\""),
            c.ok,
        );
        sample(
            out,
            "atlas_upstream_requests_total",
            &format!("host=\"{h}\",result=\"error\""),
            c.err,
        );
    }
    header(
        out,
        "atlas_upstream_request_duration_seconds",
        "histogram",
        "Upstream call latency by host.",
    );
    for (host, h) in &stats.upstream_seconds {
        histogram_samples(
            out,
            "atlas_upstream_request_duration_seconds",
            &format!("host=\"{}\"", escape(host)),
            h,
        );
    }

    header(
        out,
        "atlas_engine_events_total",
        "counter",
        "Domain events derived, by kind.",
    );
    for (kind, n) in &stats.events {
        sample(
            out,
            "atlas_engine_events_total",
            &format!("kind=\"{kind}\""),
            n,
        );
    }
    header(
        out,
        "atlas_live_messages_total",
        "counter",
        "Live messages emitted, by type.",
    );
    for (kind, n) in &stats.live {
        sample(
            out,
            "atlas_live_messages_total",
            &format!("type=\"{kind}\""),
            n,
        );
    }
    for (name, help, v) in [
        (
            "atlas_engine_blocks_total",
            "Blocks applied live.",
            stats.blocks,
        ),
        (
            "atlas_engine_backfilled_blocks_total",
            "Blocks written by the backfill.",
            stats.backfilled_blocks,
        ),
        ("atlas_engine_reorgs_total", "Reorgs handled.", stats.reorgs),
        (
            "atlas_engine_reconciles_total",
            "Node registry reconciles run.",
            stats.reconciles,
        ),
        (
            "atlas_engine_reconcile_diffs_total",
            "Reconcile field diffs (bug signals).",
            stats.reconcile_diffs,
        ),
        (
            "atlas_engine_rank_corrections_total",
            "Authoritative rank corrections sent (nodes).",
            stats.rank_corrections,
        ),
        (
            "atlas_engine_internal_errors_total",
            "Unexpected internal errors (should stay 0).",
            stats.internal_errors,
        ),
    ] {
        header(out, name, "counter", help);
        sample(out, name, "", v);
    }
    if !stats.block_latency_ms.is_empty() {
        let mut v = stats.block_latency_ms.clone();
        v.sort_unstable();
        let q = |p: f64| v[((v.len() - 1) as f64 * p).round() as usize] as f64 / 1000.0;
        header(
            out,
            "atlas_block_emit_latency_seconds",
            "gauge",
            "Block time to block message emit, over the recent blocks.",
        );
        sample(
            out,
            "atlas_block_emit_latency_seconds",
            "quantile=\"0.5\"",
            q(0.5),
        );
        sample(
            out,
            "atlas_block_emit_latency_seconds",
            "quantile=\"0.95\"",
            q(0.95),
        );
    }

    header(
        out,
        "atlas_store_commits_total",
        "counter",
        "Store write transactions committed.",
    );
    sample(out, "atlas_store_commits_total", "", stats.commits);
    header(
        out,
        "atlas_store_commit_errors_total",
        "counter",
        "Store commits that failed.",
    );
    sample(
        out,
        "atlas_store_commit_errors_total",
        "",
        stats.commit_errors,
    );
    header(
        out,
        "atlas_store_commit_ops_total",
        "counter",
        "Write operations committed.",
    );
    sample(out, "atlas_store_commit_ops_total", "", stats.commit_ops);
    header(
        out,
        "atlas_store_commit_duration_seconds",
        "histogram",
        "Store commit duration (encode, write, commit).",
    );
    histogram_samples(
        out,
        "atlas_store_commit_duration_seconds",
        "",
        &stats.commit_seconds,
    );

    header(
        out,
        "atlas_publish_total",
        "counter",
        "Published state rebuilds (pre-built bodies).",
    );
    sample(out, "atlas_publish_total", "", stats.publishes);
    header(
        out,
        "atlas_publish_duration_seconds",
        "histogram",
        "Duration of one publish (body rebuild and compression).",
    );
    histogram_samples(
        out,
        "atlas_publish_duration_seconds",
        "",
        &stats.publish_seconds,
    );

    let (hub_len, hub_cap) = s.hub.ring_len_cap();
    let (eng_len, eng_cap) = s.engine.replay_ring();
    header(
        out,
        "atlas_replay_ring_messages",
        "gauge",
        "Messages held for since_seq replay.",
    );
    sample(out, "atlas_replay_ring_messages", "ring=\"hub\"", hub_len);
    sample(
        out,
        "atlas_replay_ring_messages",
        "ring=\"engine\"",
        eng_len,
    );
    header(
        out,
        "atlas_replay_ring_capacity",
        "gauge",
        "Replay ring capacity.",
    );
    sample(out, "atlas_replay_ring_capacity", "ring=\"hub\"", hub_cap);
    sample(
        out,
        "atlas_replay_ring_capacity",
        "ring=\"engine\"",
        eng_cap,
    );
}

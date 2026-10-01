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
    let rows = s
        .store_read(|st| Ok(st.table_rows()?))
        .await
        .unwrap_or_default();
    let file = s.engine.store().file_usage().unwrap_or_default();
    render_engine(&mut out, &s.engine.stats(), &rows, file);
    render_process(&mut out);
    render_caches(&mut out, &s);
    let mut r = out.into_response();
    let h = r.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// `name{label="value"} v` lines under one HELP/TYPE header.
fn labeled<'a>(
    out: &mut String,
    name: &str,
    kind: &str,
    help: &str,
    label: &str,
    samples: impl IntoIterator<Item = (&'a str, f64)>,
) {
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} {kind}");
    for (v, x) in samples {
        let _ = writeln!(out, "{name}{{{label}=\"{}\"}} {x}", escape(v));
    }
}

/// Quantiles (seconds) of a recent latency window (ms samples).
fn quantiles(out: &mut String, name: &str, help: &str, samples_ms: &[i64]) {
    let mut v: Vec<i64> = samples_ms.to_vec();
    v.sort_unstable();
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} summary");
    if !v.is_empty() {
        for q in [0.5, 0.9, 0.99, 1.0] {
            let i = ((v.len() - 1) as f64 * q).round() as usize;
            let _ = writeln!(out, "{name}{{quantile=\"{q}\"}} {}", v[i] as f64 / 1000.0);
        }
    }
    let _ = writeln!(out, "{name}_count {}", v.len());
}

/// Engine and storage metrics.
fn render_engine(
    out: &mut String,
    st: &atlas_engine::EngineStats,
    rows: &[(String, u64)],
    file: atlas_store::FileUsage,
) {
    family(
        out,
        "atlas_engine_blocks_total",
        "counter",
        "Blocks applied live.",
        st.blocks,
    );
    family(
        out,
        "atlas_engine_backfilled_blocks_total",
        "counter",
        "Blocks written by the backfill.",
        st.backfilled_blocks,
    );
    family(
        out,
        "atlas_engine_publishes_total",
        "counter",
        "Published states built (bodies rebuilt off the reducer).",
        st.publishes,
    );
    family(
        out,
        "atlas_engine_publish_last_seconds",
        "gauge",
        "Build time of the last publish.",
        st.publish_last_ms as f64 / 1000.0,
    );
    family(
        out,
        "atlas_engine_publish_max_seconds",
        "gauge",
        "Slowest publish since start.",
        st.publish_max_ms as f64 / 1000.0,
    );
    family(
        out,
        "atlas_engine_commits_total",
        "counter",
        "Store commits (one write transaction per reducer tick).",
        st.commits,
    );
    family(
        out,
        "atlas_engine_commit_errors_total",
        "counter",
        "Failed store commits.",
        st.commit_errors,
    );
    labeled(
        out,
        "atlas_engine_payouts_total",
        "counter",
        "Block payouts by attribution (exact = queue head or currentwinner).",
        "attribution",
        [
            ("exact", st.payouts_exact as f64),
            ("fallback", st.payouts_fallback as f64),
            ("none", st.payouts_unattributed as f64),
        ],
    );
    family(
        out,
        "atlas_engine_winner_mismatches_total",
        "counter",
        "fluxnodecurrentwinner answers that disagreed with the local queue.",
        st.winner_mismatches,
    );
    family(
        out,
        "atlas_engine_internal_errors_total",
        "counter",
        "Unexpected internal errors.",
        st.internal_errors,
    );
    quantiles(
        out,
        "atlas_block_pipeline_seconds",
        "Tip push received to block message emitted (fetch, decode, reduce), recent blocks.",
        &st.pipeline_latency_ms,
    );
    quantiles(
        out,
        "atlas_block_emit_lag_seconds",
        "Block header time to block message emitted, recent blocks.",
        &st.block_latency_ms,
    );
    quantiles(
        out,
        "atlas_block_push_lag_seconds",
        "Block header time to tip push received, recent blocks.",
        &st.tip_latency_ms,
    );

    let sto = &st.storage;
    family(
        out,
        "atlas_store_file_bytes",
        "gauge",
        "Database file length.",
        file.len_bytes,
    );
    family(
        out,
        "atlas_store_disk_bytes",
        "gauge",
        "Disk space allocated to the database file.",
        file.disk_bytes,
    );
    family(
        out,
        "atlas_store_budget_bytes",
        "gauge",
        "Disk budget of the database file (0 until the first maintenance pass).",
        sto.budget_bytes,
    );
    labeled(
        out,
        "atlas_store_table_rows",
        "gauge",
        "Rows per table.",
        "table",
        rows.iter().map(|(t, n)| (t.as_str(), *n as f64)),
    );
    labeled(
        out,
        "atlas_store_table_bytes",
        "gauge",
        "Page bytes per table, from the last size report.",
        "table",
        sto.tables.iter().map(|(t, _, b)| (t.as_str(), *b as f64)),
    );
    family(
        out,
        "atlas_store_table_report_age_seconds",
        "gauge",
        "Age of the per-table size report.",
        if sto.tables_at_ms == 0 {
            0.0
        } else {
            now_ms().saturating_sub(sto.tables_at_ms) as f64 / 1000.0
        },
    );
    family(
        out,
        "atlas_store_maintenance_runs_total",
        "counter",
        "Maintenance passes (retention, disk budget, compaction).",
        sto.maintenance_runs,
    );
    family(
        out,
        "atlas_store_maintenance_seconds",
        "gauge",
        "Duration of the last maintenance pass.",
        sto.maintenance_ms as f64 / 1000.0,
    );
    family(
        out,
        "atlas_store_retention_rows_total",
        "counter",
        "Rows removed by the retention tiers.",
        sto.retention_rows,
    );
    labeled(
        out,
        "atlas_store_budget_guard_total",
        "counter",
        "Disk budget guard verdicts.",
        "action",
        sto.guard_actions.iter().map(|(a, n)| (*a, *n as f64)),
    );
    family(
        out,
        "atlas_store_budget_pruned_rows_total",
        "counter",
        "Rows removed by the disk budget guard.",
        sto.guard_rows,
    );
    family(
        out,
        "atlas_store_compactions_total",
        "counter",
        "Database compactions.",
        sto.compactions,
    );
    family(
        out,
        "atlas_store_compaction_seconds",
        "gauge",
        "Duration of the last scheduled compaction (the store is locked meanwhile).",
        sto.compaction_ms as f64 / 1000.0,
    );
}

/// Process resident memory and CPU time (Linux `/proc`; absent elsewhere).
fn render_process(out: &mut String) {
    let Ok(stat) = std::fs::read_to_string("/proc/self/stat") else {
        return;
    };
    // Fields after the parenthesized command name; utime and stime are fields 14 and 15.
    let Some(rest) = stat.rsplit(')').next() else {
        return;
    };
    let f: Vec<&str> = rest.split_whitespace().collect();
    let num = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    // `rest` starts at field 3 (state): field n is at index n - 3. USER_HZ is 100 on Linux.
    let cpu_s = (num(11) + num(12)) as f64 / 100.0;
    let threads = num(17);
    let rss_kb = std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|t| {
            t.lines()
                .find_map(|l| l.strip_prefix("VmRSS:"))
                .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
        })
        .unwrap_or(0);
    family(
        out,
        "atlas_process_cpu_seconds_total",
        "counter",
        "User and system CPU time.",
        cpu_s,
    );
    family(
        out,
        "atlas_process_resident_bytes",
        "gauge",
        "Resident set size.",
        rss_kb * 1024,
    );
    family(
        out,
        "atlas_process_threads",
        "gauge",
        "OS threads.",
        threads,
    );
}

/// Bytes held by the bounded in-memory caches.
fn render_caches(out: &mut String, s: &AppState) {
    let mut rows: Vec<(String, f64)> = s
        .explorer
        .cache_sizes()
        .into_iter()
        .map(|(n, _, _, bytes)| (format!("proxy_{n}"), bytes as f64))
        .collect();
    rows.push(("metrics".into(), s.metrics_cache.weighted_size() as f64));
    rows.push(("timeline".into(), s.timeline_cache.weighted_size() as f64));
    labeled(
        out,
        "atlas_cache_bytes",
        "gauge",
        "Approximate bytes held by each bounded cache.",
        "cache",
        rows.iter().map(|(n, b)| (n.as_str(), *b)),
    );
    labeled(
        out,
        "atlas_replay_ring_bytes",
        "gauge",
        "Serialized bytes held by the live replay rings (engine messages, hub frames).",
        "ring",
        [
            ("engine", s.engine.replay_bytes() as f64),
            ("hub", s.hub.stats.ring_bytes.load(Ordering::Relaxed) as f64),
        ],
    );
}

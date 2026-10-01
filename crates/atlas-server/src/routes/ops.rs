//! Ops endpoints: `/healthz`, `/readyz`, `/metrics/prometheus`.

use std::fmt::Write as _;
use std::sync::atomic::Ordering;

use atlas_core::api::HealthDto;
use atlas_core::now_ms;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};

use crate::error::ApiError;
use crate::metrics::{escape, family};
use crate::net::trust::Source;
use crate::net::{PeerAddr, metrics_allowed};
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

/// Prometheus text exposition. Private: served to loopback peers (`atlas metrics` inside the
/// container) or with `Authorization: Bearer <ATLAS_METRICS_TOKEN>`; anyone else gets a 404,
/// as if the route did not exist.
pub async fn prometheus(
    State(s): State<AppState>,
    Extension(peer): Extension<PeerAddr>,
    headers: HeaderMap,
) -> Response {
    if !metrics_allowed(peer, &headers, s.cfg.metrics_token.as_deref()) {
        return no_store(ApiError::not_found("no such endpoint").into_response());
    }
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
    render_edge(&s, &mut out);
    render_engine(&s, &mut out);
    let rows = s
        .store_read(|st| Ok(st.table_rows()?))
        .await
        .unwrap_or_default();
    let file = s.engine.store().file_usage().unwrap_or_default();
    render_latency_storage(&mut out, &s.engine.stats(), &rows, file);
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

/// The edge: connections, client address derivation, request and store timeouts, and the
/// derived-route and explorer limits (ARCHITECTURE section 11.2). No address is exported
/// except the built-in FDM balancers' (public infrastructure).
fn render_edge(s: &AppState, out: &mut String) {
    let c = &s.listener.stats;
    let load = |a: &std::sync::atomic::AtomicU64| a.load(Ordering::Relaxed) as f64;
    family(
        out,
        "atlas_http_connections",
        "gauge",
        "Open TCP connections (upgraded WebSockets included).",
        s.listener.open(),
    );
    family(
        out,
        "atlas_http_connections_max",
        "gauge",
        "Global cap on open TCP connections.",
        s.listener.limits().max_connections,
    );
    family(
        out,
        "atlas_http_connection_peers",
        "gauge",
        "Distinct untrusted peers (IPv6 by /64) holding connections.",
        c.peers.load(Ordering::Relaxed),
    );
    labeled(
        out,
        "atlas_http_connection_events_total",
        "counter",
        "Connection events: accepted, from_proxy (accepted from a trusted proxy), \
rejected_global, rejected_per_peer, write_stall, error (includes header read timeouts), \
accept_error, drain_dropped.",
        "event",
        [
            ("accepted", load(&c.accepted)),
            ("from_proxy", load(&c.accepted_from_proxy)),
            ("rejected_global", load(&c.rejected_global)),
            ("rejected_per_peer", load(&c.rejected_per_peer)),
            ("write_stall", load(&c.write_stalls)),
            ("error", load(&c.errors)),
            ("accept_error", load(&c.accept_errors)),
            ("drain_dropped", load(&c.drain_dropped)),
        ],
    );
    labeled(
        out,
        "atlas_client_ip_source_total",
        "counter",
        "How each request's client address was derived: direct (untrusted peer), \
direct_header_ignored (untrusted peer sent X-Forwarded-For), forwarded (trusted proxy, header \
used), proxy_no_header, proxy_bad_header.",
        "source",
        Source::ALL.map(|src| (src.label(), s.forward.source_count(src) as f64)),
    );
    labeled(
        out,
        "atlas_fdm_peer_requests_total",
        "counter",
        "Requests received from each built-in FDM app balancer.",
        "peer",
        s.forward
            .fdm_peers()
            .into_iter()
            .map(|(a, n)| (a, n as f64)),
    );
    family(
        out,
        "atlas_untrusted_forwarders",
        "gauge",
        "Distinct /24 (IPv6 /48) networks of untrusted peers that sent X-Forwarded-For.",
        s.forward.untrusted_forwarders(),
    );
    family(
        out,
        "atlas_request_timeouts_total",
        "counter",
        "Requests answered 503 by the request timeout.",
        s.metrics.request_timeouts.load(Ordering::Relaxed),
    );
    family(
        out,
        "atlas_store_read_timeouts_total",
        "counter",
        "Store reads answered 503 after their deadline.",
        s.metrics.store_timeouts.load(Ordering::Relaxed),
    );
    family(
        out,
        "atlas_store_reads_in_flight",
        "gauge",
        "Store reads holding or waiting for a slot.",
        s.store_reads_in_use(),
    );
    labeled(
        out,
        "atlas_limited_total",
        "counter",
        "Requests refused by a limit: derived_rate (per client), derived_busy (global compute \
slots), explorer_global (global explorer budget).",
        "limit",
        [
            ("derived_rate", load(&s.derived.rate_limited)),
            ("derived_busy", load(&s.derived.busy)),
            ("explorer_global", load(&s.explorer.guard.global_limited)),
        ],
    );
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

/// Block pipeline latency, payout attribution and storage (file, tables, retention, disk
/// budget guard, compaction). Counters already in [`render_engine`] are not repeated.
fn render_latency_storage(
    out: &mut String,
    st: &atlas_engine::EngineStats,
    rows: &[(String, u64)],
    file: atlas_store::FileUsage,
) {
    family(
        out,
        "atlas_engine_publish_max_seconds",
        "gauge",
        "Slowest publish since start.",
        st.publish_max_ms as f64 / 1000.0,
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
            "atlas_engine_mesh_calls_rejected_total",
            "Topology calls discarded by the mesh outlier rule.",
            stats.mesh_calls_rejected,
        ),
        (
            "atlas_engine_mesh_links_rejected_total",
            "Links the discarded topology calls would have added.",
            stats.mesh_links_rejected,
        ),
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

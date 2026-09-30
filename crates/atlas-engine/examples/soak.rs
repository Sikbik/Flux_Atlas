//! Live soak: runs the engine against the real Flux network on a temporary store and prints,
//! every minute, blocks seen, block latency (block time to `block` emit), events by type, live
//! messages, upstream calls by host, reconcile diffs and process RSS.
//!
//! ```text
//! cargo run --release -p atlas-engine --example soak -- [minutes=30] [--keep]
//! ```
//!
//! `RUST_LOG` overrides the log filter (default `warn,atlas_engine=info`).
#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use atlas_engine::{Engine, EngineConfig, EngineStats, IngestConfig};
use atlas_flux::{Clients, ClientsConfig};
use atlas_store::{Store, StoreOptions};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn rss_mb() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmRSS:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<f64>().ok())
        })
        .map_or(0.0, |kb| kb / 1024.0)
}

fn lat(v: &[i64]) -> String {
    if v.is_empty() {
        return "n/a".into();
    }
    let mut s = v.to_vec();
    s.sort_unstable();
    format!(
        "min {} / median {} / max {} ms (n={})",
        s[0],
        s[s.len() / 2],
        s[s.len() - 1],
        s.len()
    )
}

fn delta<K: Ord + Clone>(now: &BTreeMap<K, u64>, before: &BTreeMap<K, u64>) -> BTreeMap<K, u64> {
    now.iter()
        .filter_map(|(k, v)| {
            let d = v - before.get(k).copied().unwrap_or(0);
            (d > 0).then(|| (k.clone(), d))
        })
        .collect()
}

fn fmt_map<K: std::fmt::Display>(m: &BTreeMap<K, u64>) -> String {
    if m.is_empty() {
        return "-".into();
    }
    m.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn upstream_totals(s: &EngineStats) -> BTreeMap<String, u64> {
    s.upstream
        .iter()
        .map(|(k, c)| ((*k).to_owned(), c.ok + c.err))
        .collect()
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let mut minutes: u64 = 30;
    let mut keep = false;
    for a in std::env::args().skip(1) {
        if a == "--keep" {
            keep = true;
        } else if let Ok(m) = a.parse() {
            minutes = m;
        }
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,atlas_engine=info")),
        )
        .with_target(false)
        .init();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("soak.redb");
    println!("soak: {minutes} min, store {}", path.display());
    // A bounded redb page cache (the default is 1 GiB) keeps RSS a measure of the engine.
    let store = Store::open_with(
        &path,
        StoreOptions {
            cache_size_bytes: Some(64 << 20),
            ..StoreOptions::default()
        },
    )
    .unwrap();
    let clients = Clients::new(ClientsConfig::default()).unwrap();
    let cfg = EngineConfig {
        ingest: IngestConfig {
            enabled: true,
            ..IngestConfig::default()
        },
        ..EngineConfig::default()
    };
    let eng = Engine::start(cfg, store, clients);
    // Watch a handful of nodes and one app once the network is loaded, to exercise the
    // watch hooks (WatchProbe and hot-app polling).
    let started = Instant::now();
    let mut prev = eng.stats();
    let mut prev_lat = 0usize;
    let mut rss_series: Vec<(u64, f64)> = vec![(0, rss_mb())];
    let mut watched = false;
    let mut iv = tokio::time::interval(Duration::from_secs(60));
    iv.tick().await;
    for minute in 1..=minutes {
        iv.tick().await;
        if !watched {
            let p = eng.published();
            if p.nodes.len() > 100 {
                let nodes = p
                    .nodes
                    .iter()
                    .step_by(p.nodes.len() / 5)
                    .map(|r| r.id)
                    .collect();
                let app = p
                    .apps
                    .iter()
                    .max_by_key(|a| a.instances_running)
                    .map(|a| a.name.clone());
                eng.set_watch(1, nodes, app.into_iter().collect());
                watched = true;
            }
        }
        let s = eng.stats();
        let p = eng.published();
        let rss = rss_mb();
        rss_series.push((minute, rss));
        let new_lat = &s.block_latency_ms[prev_lat.min(s.block_latency_ms.len())..];
        let up_now = upstream_totals(&s);
        let up_prev = upstream_totals(&prev);
        let up_d = delta(&up_now, &up_prev);
        let rps: f64 = up_d.values().sum::<u64>() as f64 / 60.0;
        println!(
            "\n[{minute:>3} min] tip {} | blocks {} (+{}) | nodes {} apps {} mesh {} | stale {} | RSS {rss:.1} MB",
            p.network.tip.as_ref().map_or(0, |t| t.height),
            s.blocks,
            s.blocks - prev.blocks,
            p.network.node_count,
            p.network.app_count,
            p.mesh_edge_count,
            p.stale,
        );
        println!("  block latency (this minute): {}", lat(new_lat));
        println!("  events: {}", fmt_map(&delta(&s.events, &prev.events)));
        println!("  live:   {}", fmt_map(&delta(&s.live, &prev.live)));
        println!("  upstream ({rps:.2} req/s): {}", fmt_map(&up_d));
        println!(
            "  reconciles {} diffs {} {} | winner checks {} mismatches {} stale {} | payouts exact {} fallback {} none {}",
            s.reconciles,
            s.reconcile_diffs,
            fmt_map(&s.reconcile_diff_fields),
            s.winner_checks,
            s.winner_mismatches,
            s.winner_stale,
            s.payouts_exact,
            s.payouts_fallback,
            s.payouts_unattributed
        );
        println!(
            "  commits {} (errors {}) | publishes {} (last {} ms, max {} ms) | backfilled blocks {} | job errors {} | internal errors {}",
            s.commits,
            s.commit_errors,
            s.publishes,
            s.publish_last_ms,
            s.publish_max_ms,
            s.backfilled_blocks,
            fmt_map(&delta(&s.job_errors, &prev.job_errors)),
            s.internal_errors
        );
        let stale: Vec<String> = eng
            .freshness()
            .into_iter()
            .filter(|f| f.stale && f.job != "backfill")
            .map(|f| f.job)
            .collect();
        if !stale.is_empty() {
            println!("  stale jobs: {}", stale.join(", "));
        }
        prev_lat = s.block_latency_ms.len();
        prev = s;
    }

    let s = eng.stats();
    let hours = started.elapsed().as_secs_f64() / 3600.0;
    println!("\n==== soak summary ({:.1} min) ====", hours * 60.0);
    println!("blocks applied live: {}", s.blocks);
    // The first block of a session is a catch-up, not a live latency.
    let steady: Vec<i64> = s.block_latency_ms.iter().skip(1).copied().collect();
    println!("block latency (block time -> emit): {}", lat(&steady));
    println!(
        "socket latency (block time -> push): {}",
        lat(&s.tip_latency_ms)
    );
    println!("events per hour by type:");
    for (k, v) in &s.events {
        println!("  {k:<24} {:>9.0}/h  (total {v})", *v as f64 / hours);
    }
    println!("live messages per hour by type:");
    for (k, v) in &s.live {
        println!("  {k:<24} {:>9.0}/h  (total {v})", *v as f64 / hours);
    }
    println!("upstream calls:");
    let secs = started.elapsed().as_secs_f64();
    for (k, c) in &s.upstream {
        println!(
            "  {k:<24} ok {:>6} err {:>4}  {:.3} req/s",
            c.ok,
            c.err,
            (c.ok + c.err) as f64 / secs
        );
    }
    println!("upstream calls by endpoint:");
    for (k, v) in &s.upstream_by_call {
        println!("  {k:<52} {v:>6}");
    }
    println!(
        "reconciles {} | diffs {} {} | currentwinner checks {} mismatches {} stale {} | reorgs {}",
        s.reconciles,
        s.reconcile_diffs,
        fmt_map(&s.reconcile_diff_fields),
        s.winner_checks,
        s.winner_mismatches,
        s.winner_stale,
        s.reorgs
    );
    println!(
        "payout attribution: exact {} fallback {} unattributed {}",
        s.payouts_exact, s.payouts_fallback, s.payouts_unattributed
    );
    println!(
        "store commits {} ops {} errors {} | publishes {} max {} ms | internal errors {}",
        s.commits, s.commit_ops, s.commit_errors, s.publishes, s.publish_max_ms, s.internal_errors
    );
    println!(
        "job errors (upstream failures, retried): {}",
        fmt_map(&s.job_errors)
    );
    println!(
        "RSS MB by minute: {}",
        rss_series
            .iter()
            .map(|(m, r)| format!("{m}:{r:.0}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let shut = Instant::now();
    eng.shutdown().await;
    println!("shutdown + flush: {} ms", shut.elapsed().as_millis());
    if let Ok(c) = eng.store().table_counts() {
        println!(
            "store rows: {}",
            c.iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    if keep {
        let kept = dir.keep();
        println!("kept data dir {}", kept.display());
    }
}

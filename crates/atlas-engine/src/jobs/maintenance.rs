//! Retention, disk budget and compaction (ARCHITECTURE section 5), hourly:
//!
//! 1. metrics rollup and pruning, snapshot thinning, pending/geo expiry, event pruning;
//! 2. the history retention tiers (blocks, payments, node txs, keyframes, ...);
//! 3. the disk budget guard (prunes oldest-first and compacts when the file nears the budget);
//! 4. a per-table size report every `table_stats_interval` (a full page walk);
//! 5. a weekly compaction (skipped when the guard just compacted).
//!
//! Everything runs on the blocking pool, off the reducer and the request path. Only compaction
//! takes the store exclusively; its duration is recorded in [`crate::StorageStatus`].

use std::time::{Duration, Instant};

use atlas_core::now_ms;
use atlas_store::{BudgetReport, DbStats};

use super::JobCtx;
use crate::meta;
use crate::obs::Obs;

/// What one pass did.
struct Pass {
    retention_rows: u64,
    guard: BudgetReport,
    stats: Option<(DbStats, u64)>,
    compacted: Option<u64>,
    elapsed_ms: u64,
}

pub async fn run(ctx: JobCtx) {
    if !ctx.sleep(Duration::from_secs(600)).await {
        return;
    }
    // A size report soon after startup, then every `table_stats_interval`.
    let mut last_stats: Option<Instant> = None;
    loop {
        let store = ctx.handle.store().clone();
        let cfg = ctx.cfg.clone();
        let stats_due = last_stats.is_none_or(|t| t.elapsed() >= cfg.table_stats_interval);
        let res = tokio::task::spawn_blocking(move || {
            let started = Instant::now();
            let now = now_ms();
            let report = store.run_retention(now, &cfg.retention)?;
            let cut = |d: Duration| now.saturating_sub(d.as_millis() as u64);
            let (e, ne, me) = store.prune_events(
                cut(cfg.events_retention),
                cut(cfg.node_events_retention),
                cut(cfg.mesh_events_retention),
            )?;
            let history = store.prune_history(now, &cfg.history)?;
            let retention_rows = (report.metrics_1m_pruned
                + report.snapshots_thinned
                + report.pending_pruned
                + report.geo_pruned
                + e
                + ne
                + me) as u64
                + history.iter().map(|(_, n)| n).sum::<u64>();
            if !history.is_empty() {
                tracing::info!(?history, "history retention");
            }
            let guard = store.enforce_budget(now, &cfg.disk_budget)?;
            let last = store.meta_u64(meta::LAST_COMPACT_MS)?.unwrap_or(0);
            let weekly =
                last == 0 || now.saturating_sub(last) >= cfg.compaction_interval.as_millis() as u64;
            let compacted = if guard.compacted {
                None
            } else if weekly && last != 0 {
                let t = Instant::now();
                store.compact()?;
                Some(t.elapsed().as_millis() as u64)
            } else {
                None
            };
            let stats = if stats_due {
                let t = Instant::now();
                Some((store.db_stats()?, t.elapsed().as_millis() as u64))
            } else {
                None
            };
            tracing::info!(
                ?report,
                pruned = ?(e, ne, me),
                guard = guard.action,
                used_mb = guard.used_after >> 20,
                budget_mb = guard.budget_bytes >> 20,
                compacted = compacted.is_some() || guard.compacted,
                "maintenance done"
            );
            Ok::<_, atlas_store::StoreError>((
                Pass {
                    retention_rows,
                    guard,
                    stats,
                    compacted,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                },
                weekly || last == 0,
            ))
        })
        .await;
        match res {
            Ok(Ok((pass, stamp))) => {
                if pass.stats.is_some() {
                    last_stats = Some(Instant::now());
                }
                record(&ctx, &pass);
                if stamp || pass.guard.compacted {
                    let _ = ctx
                        .send(Obs::Meta {
                            key: meta::LAST_COMPACT_MS,
                            value: now_ms(),
                        })
                        .await;
                }
                ctx.ok("maintenance");
            }
            Ok(Err(e)) => ctx.fail("maintenance", &e),
            Err(e) => ctx.fail("maintenance", &e),
        }
        ctx.next("maintenance", Duration::from_secs(3600));
        if !ctx.sleep(Duration::from_secs(3600)).await {
            return;
        }
    }
}

fn record(ctx: &JobCtx, pass: &Pass) {
    ctx.handle.inner.stats.with(|s| {
        let st = &mut s.storage;
        st.budget_bytes = pass.guard.budget_bytes;
        st.maintenance_runs += 1;
        st.maintenance_at_ms = now_ms();
        st.maintenance_ms = pass.elapsed_ms;
        st.retention_rows += pass.retention_rows;
        *st.guard_actions.entry(pass.guard.action).or_default() += 1;
        if let Some(p) = &pass.guard.pruned {
            st.guard_rows += p.rows.values().sum::<u64>();
        }
        if pass.guard.compacted || pass.compacted.is_some() {
            st.compactions += 1;
        }
        if let Some(ms) = pass.compacted {
            st.compaction_ms = ms;
        }
        if let Some((stats, walk_ms)) = &pass.stats {
            st.tables = stats
                .tables
                .iter()
                .map(|t| (t.name.clone(), t.rows, t.total_bytes()))
                .collect();
            st.tables_at_ms = now_ms();
            st.tables_walk_ms = *walk_ms;
        }
    });
}

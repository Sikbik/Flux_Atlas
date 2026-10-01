//! Retention and compaction (ARCHITECTURE section 5): hourly metrics rollup and pruning,
//! snapshot thinning, pending/geo expiry, event pruning; weekly compaction.

use std::time::Duration;

use atlas_core::now_ms;

use super::JobCtx;
use crate::meta;
use crate::obs::Obs;

pub async fn run(ctx: JobCtx) {
    if !ctx.sleep(Duration::from_secs(600)).await {
        return;
    }
    loop {
        let store = ctx.handle.store().clone();
        let cfg = ctx.cfg.clone();
        let res = tokio::task::spawn_blocking(move || {
            let now = now_ms();
            let report = store.run_retention(now, &cfg.retention)?;
            let cut = |d: Duration| now.saturating_sub(d.as_millis() as u64);
            let pruned = store.prune_events(
                cut(cfg.events_retention),
                cut(cfg.node_events_retention),
                cut(cfg.mesh_events_retention),
            )?;
            let last = store.meta_u64(meta::LAST_COMPACT_MS)?.unwrap_or(0);
            let compact =
                last == 0 || now.saturating_sub(last) >= cfg.compaction_interval.as_millis() as u64;
            let compacted = if compact && last != 0 {
                store.compact()?
            } else {
                false
            };
            Ok::<_, atlas_store::StoreError>((report, pruned, compact, compacted))
        })
        .await;
        match res {
            Ok(Ok((report, pruned, compact, compacted))) => {
                tracing::info!(?report, ?pruned, compacted, "maintenance done");
                if compact {
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

//! T2 NodeRegistry: full-list reconciliation (10 min, or immediately on count mismatch or
//! reorg), `getfluxnodecount` (60 s), start and DOS lists (60 s).

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use super::JobCtx;
use crate::obs::Obs;
use crate::stats::Upstream;

/// Reconciles against `viewdeterministicfluxnodelist`.
pub async fn reconcile(ctx: JobCtx, now: Arc<Notify>) {
    let iv = ctx.cfg.reconcile_interval;
    let spacing = ctx.cfg.reconcile_min_spacing;
    let mut last: Option<Instant> = None;
    loop {
        if let Some(t) = last
            && t.elapsed() < spacing
            && !ctx.sleep(spacing.saturating_sub(t.elapsed())).await
        {
            return;
        }
        last = Some(Instant::now());
        match ctx
            .call(
                Upstream::FluxOs,
                "viewdeterministicfluxnodelist",
                ctx.clients.fluxos.node_list(None),
            )
            .await
        {
            Ok(list) => {
                let nodes: Vec<_> = list
                    .iter()
                    .filter_map(atlas_flux::models::nodes::NodeListEntry::normalize)
                    .collect();
                if !ctx.send(Obs::NodeList(nodes)).await {
                    return;
                }
                ctx.ok("node_registry");
            }
            Err(e) => {
                ctx.fail("node_registry", &e);
                // Retry sooner after a failure.
                if !ctx.sleep(Duration::from_secs(30)).await {
                    return;
                }
                continue;
            }
        }
        ctx.next("node_registry", iv);
        if !ctx.wait(&now, iv).await {
            return;
        }
    }
}

/// `getfluxnodecount` every 60 s (the reducer triggers a reconcile when totals disagree).
pub async fn counts(ctx: JobCtx) {
    let iv = ctx.cfg.count_interval;
    if !ctx.sleep(Duration::from_secs(20)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "getfluxnodecount",
                ctx.clients.fluxos.get_fluxnode_count(),
            )
            .await
        {
            Ok(c) => {
                if !ctx.send(Obs::NodeCount(c)).await {
                    return;
                }
            }
            Err(e) => ctx.fail("node_count", &e),
        }
        ctx.next("node_count", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// `getstartlist` and `getdoslist` every 60 s as cross-checks.
pub async fn lists(ctx: JobCtx) {
    let iv = ctx.cfg.lists_interval;
    if !ctx.sleep(Duration::from_secs(25)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "getstartlist",
                ctx.clients.fluxos.start_list(),
            )
            .await
        {
            Ok(v) => {
                if !ctx.send(Obs::StartList(v)).await {
                    return;
                }
            }
            Err(e) => ctx.fail("start_dos_lists", &e),
        }
        match ctx
            .call(
                Upstream::FluxOs,
                "getdoslist",
                ctx.clients.fluxos.dos_list(),
            )
            .await
        {
            Ok(v) => {
                if !ctx.send(Obs::DosList(v)).await {
                    return;
                }
            }
            Err(e) => ctx.fail("start_dos_lists", &e),
        }
        ctx.next("start_dos_lists", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

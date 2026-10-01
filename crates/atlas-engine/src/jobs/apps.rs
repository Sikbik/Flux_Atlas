//! T1 AppChainFeed and T2 AppPending, AppInstalling, AppPlacement (+ hot apps), AppCatalog.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use atlas_core::{Hash32, now_ms};
use atlas_flux::{Conditional, MessageFilter};
use tokio::sync::{Notify, mpsc};

use super::JobCtx;
use crate::obs::Obs;
use crate::stats::Upstream;

/// `/apps/temporarymessages` every 10 s.
pub async fn pending(ctx: JobCtx) {
    let iv = ctx.cfg.pending_interval;
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "temporarymessages",
                ctx.clients.fluxos.temporary_messages(),
            )
            .await
        {
            Ok(v) => {
                let msgs = v
                    .iter()
                    .filter_map(atlas_flux::models::apps::TemporaryMessage::to_pending)
                    .collect();
                if !ctx.send(Obs::Pending(msgs)).await {
                    return;
                }
                ctx.ok("app_pending");
            }
            Err(e) => ctx.fail("app_pending", &e),
        }
        ctx.next("app_pending", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// `/apps/installinglocations` every 10 s.
pub async fn installing(ctx: JobCtx) {
    let iv = ctx.cfg.installing_interval;
    if !ctx.sleep(Duration::from_secs(3)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "installinglocations",
                ctx.clients.fluxos.installing_locations(),
            )
            .await
        {
            Ok(v) => {
                let rows = v
                    .iter()
                    .filter_map(|r| r.endpoint().map(|e| (r.name.clone(), e)))
                    .collect();
                if !ctx.send(Obs::Installing(rows)).await {
                    return;
                }
                ctx.ok("app_installing");
            }
            Err(e) => ctx.fail("app_installing", &e),
        }
        ctx.next("app_installing", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// `/apps/locations` diff every 90 s (after the catalog is loaded).
pub async fn placement(ctx: JobCtx) {
    let iv = ctx.cfg.placement_interval;
    if !ctx.sleep(Duration::from_secs(15)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "locations",
                ctx.clients.fluxos.app_locations(),
            )
            .await
        {
            Ok(v) => {
                let rows = v
                    .iter()
                    .filter_map(|l| l.to_instance().map(|i| (l.name.clone(), i)))
                    .collect();
                if !ctx.send(Obs::Locations { rows, scope: None }).await {
                    return;
                }
                ctx.ok("app_placement");
            }
            Err(e) => ctx.fail("app_placement", &e),
        }
        ctx.next("app_placement", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// Apps polled per hot round.
pub const HOT_APPS: usize = 16;

/// Hot apps (open in a client): `/apps/location/<name>` every few seconds, for at most
/// [`HOT_APPS`] apps picked by fair share across connections (most-watched first, each
/// connection voting for a few of its apps only), never alphabetically. The server accepts
/// only names in the app catalog.
pub async fn hot(ctx: JobCtx) {
    let iv = ctx.cfg.hot_app_interval;
    loop {
        let apps = ctx.handle.hot_apps(HOT_APPS);
        for app in apps {
            match ctx
                .call(
                    Upstream::FluxOs,
                    "location",
                    ctx.clients.fluxos.app_location(&app),
                )
                .await
            {
                Ok(v) => {
                    let rows = v
                        .iter()
                        .filter_map(|l| l.to_instance().map(|i| (l.name.clone(), i)))
                        .collect();
                    if !ctx
                        .send(Obs::Locations {
                            rows,
                            scope: Some(app),
                        })
                        .await
                    {
                        return;
                    }
                }
                Err(e) => ctx.fail("app_placement", &e),
            }
        }
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// `/apps/globalappsspecifications` with `If-None-Match` every 10 min, and right after the
/// chain feed resolves a register/update.
pub async fn catalog(ctx: JobCtx, now: Arc<Notify>) {
    let iv = ctx.cfg.catalog_interval;
    let mut etag: Option<String> = None;
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "globalappsspecifications",
                ctx.clients.fluxos.global_app_specs(etag.as_deref()),
            )
            .await
        {
            Ok(Conditional::Modified { value, etag: e }) => {
                etag = e;
                let specs = value
                    .iter()
                    .map(|s| (s.normalize(), s.spec_hash(), s.height.unwrap_or(0)))
                    .collect();
                if !ctx.send(Obs::Catalog(specs)).await {
                    return;
                }
                ctx.ok("app_catalog");
            }
            Ok(Conditional::NotModified) => ctx.ok("app_catalog"),
            Err(e) => ctx.fail("app_catalog", &e),
        }
        ctx.next("app_catalog", iv);
        if !ctx.wait(&now, iv).await {
            return;
        }
    }
}

/// `/apps/installingerrorslocations` every 15 min.
pub async fn install_errors(ctx: JobCtx) {
    let iv = ctx.cfg.install_errors_interval;
    if !ctx.sleep(Duration::from_secs(40)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::FluxOs,
                "installingerrorslocations",
                ctx.clients.fluxos.installing_error_locations(),
            )
            .await
        {
            Ok(v) => {
                let rows = v
                    .iter()
                    .filter_map(|r| r.endpoint().map(|e| (r.name.clone(), e, r.message())))
                    .collect();
                if !ctx.send(Obs::InstallErrors(rows)).await {
                    return;
                }
            }
            Err(e) => ctx.fail("app_catalog", &e),
        }
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

/// Retry schedule of the chain feed after a block (seconds after the block).
const FEED_RETRY_S: [u64; 8] = [2, 10, 30, 60, 120, 240, 480, 900];

/// AppChainFeed: resolves app-message hashes seen in blocks through
/// `permanentmessages?hash=`. A fresh block's message is often not indexed yet, so each hash
/// is retried with backoff over the next few blocks.
pub async fn chain_feed(ctx: JobCtx, mut rx: mpsc::Receiver<(Hash32, u32)>) {
    // due time -> (hash, height, attempt)
    let mut queue: BTreeMap<(u64, Hash32), (u32, usize)> = BTreeMap::new();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            m = rx.recv() => {
                let Some((hash, height)) = m else { return };
                if !queue.keys().any(|(_, h)| *h == hash) {
                    queue.insert((now_ms() + FEED_RETRY_S[0] * 1000, hash), (height, 0));
                }
            }
            _ = tick.tick() => {
                if ctx.stopping() {
                    return;
                }
                let now = now_ms();
                let due: Vec<(u64, Hash32)> = queue.range(..(now + 1, Hash32::ZERO)).map(|(k, _)| *k).collect();
                for key in due {
                    let Some((height, attempt)) = queue.remove(&key) else { continue };
                    let hash = key.1;
                    match ctx
                        .call(
                            Upstream::FluxOs,
                            "permanentmessages?hash",
                            ctx.clients.fluxos.permanent_messages(MessageFilter::Hash(&hash)),
                        )
                        .await
                    {
                        Ok(v) if !v.is_empty() => {
                            for m in v {
                                if let Some(rec) = m.to_record()
                                    && rec.hash == hash
                                {
                                    let _ = ctx.send(Obs::AppMessage(Box::new(rec))).await;
                                }
                            }
                            ctx.ok("app_chain_feed");
                            continue;
                        }
                        Ok(_) => {}
                        Err(e) => ctx.fail("app_chain_feed", &e),
                    }
                    let next = attempt + 1;
                    if let Some(delay) = FEED_RETRY_S.get(next) {
                        let first = key.0 - FEED_RETRY_S[attempt] * 1000;
                        queue.insert((first + delay * 1000, hash), (height, next));
                    } else {
                        tracing::warn!(%hash, height, "app message never appeared in permanentmessages");
                    }
                }
            }
        }
    }
}

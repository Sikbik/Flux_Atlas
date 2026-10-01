//! Bootstrap backfills (background, resumable, polite, <= 2 req/s):
//!
//! 1. `stats /fluxhistorystats`: 30 days of tier counts into metrics (once).
//! 2. `/apps/permanentmessages` in full (about 24.5 MB br / 93 MB raw, 6 years of app history)
//!    into the app-message tables, stream-parsed in chunks (once).
//! 3. The last N days of blocks through `getblock`, walking down from the first live height,
//!    with a resumable cursor in `meta`.

use std::fmt;
use std::time::Duration;

use atlas_core::app::AppMessageRecord;
use atlas_core::now_ms;
use atlas_flux::clients::HUGE_BODY;
use atlas_flux::decode::decode_block;
use atlas_flux::http::RequestOpts;
use atlas_flux::models::apps::PermanentMessage;
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use tokio::sync::mpsc;

use super::JobCtx;
use crate::meta;
use crate::obs::Obs;
use crate::stats::Upstream;

const BLOCKS_PER_DAY: u32 = 2_880;
const BLOCK_CHUNK: usize = 20;
const MESSAGE_CHUNK: usize = 2_000;

pub async fn run(ctx: JobCtx) {
    if !ctx.sleep(Duration::from_secs(45)).await {
        return;
    }
    let bf = ctx.cfg.backfill.clone();
    if bf.history_stats && meta_get(&ctx, meta::BACKFILL_HISTORY_DONE).await.is_none() {
        history(&ctx).await;
    }
    if !ctx.sleep(Duration::from_secs(15)).await {
        return;
    }
    if bf.app_messages
        && meta_get(&ctx, meta::BACKFILL_APP_MESSAGES_DONE)
            .await
            .is_none()
    {
        app_messages(&ctx).await;
    }
    if bf.block_days > 0 {
        blocks(&ctx, bf.block_days, bf.blocks_per_second).await;
    }
}

async fn meta_get(ctx: &JobCtx, key: &'static str) -> Option<u64> {
    ctx.store_read(move |s| s.meta_u64(key)).await.flatten()
}

async fn history(ctx: &JobCtx) {
    for attempt in 0..5 {
        match ctx
            .call(
                Upstream::Stats,
                "fluxhistorystats",
                ctx.clients.stats.history_stats(),
            )
            .await
        {
            Ok(h) => {
                let points: Vec<(u64, [u32; 3])> = h
                    .points()
                    .into_iter()
                    .map(|(t, p)| (t, [p.cumulus, p.nimbus, p.stratus]))
                    .collect();
                tracing::info!(points = points.len(), "tier-count history backfilled");
                let _ = ctx.send(Obs::HistoryStats(points)).await;
                let _ = ctx
                    .send(Obs::Meta {
                        key: meta::BACKFILL_HISTORY_DONE,
                        value: now_ms(),
                    })
                    .await;
                ctx.ok("backfill");
                return;
            }
            Err(e) => {
                ctx.fail("backfill", &e);
                if !ctx.sleep(Duration::from_secs(30 * (attempt + 1))).await {
                    return;
                }
            }
        }
    }
}

async fn app_messages(ctx: &JobCtx) {
    let opts = RequestOpts::default()
        .timeout(Duration::from_secs(240))
        .max_bytes(HUGE_BODY)
        .attempts(2);
    for attempt in 0..3u64 {
        let raw = match ctx
            .call(
                Upstream::FluxOs,
                "permanentmessages (full)",
                ctx.clients.fluxos.get_raw("apps/permanentmessages", &opts),
            )
            .await
        {
            Ok(b) => b,
            Err(e) => {
                ctx.fail("backfill", &e);
                if !ctx.sleep(Duration::from_secs(120 * (attempt + 1))).await {
                    return;
                }
                continue;
            }
        };
        let (tx, mut rx) = mpsc::channel::<Vec<AppMessageRecord>>(4);
        let parse = tokio::task::spawn_blocking(move || {
            let mut chunk = Vec::with_capacity(MESSAGE_CHUNK);
            let mut sink = |m: PermanentMessage| {
                if let Some(r) = m.to_record() {
                    chunk.push(r);
                    if chunk.len() >= MESSAGE_CHUNK {
                        let full = std::mem::replace(&mut chunk, Vec::with_capacity(MESSAGE_CHUNK));
                        let _ = tx.blocking_send(full);
                    }
                }
            };
            let res = parse_messages(&raw, &mut sink);
            drop(raw);
            if !chunk.is_empty() {
                let _ = tx.blocking_send(chunk);
            }
            res
        });
        let mut total = 0usize;
        while let Some(chunk) = rx.recv().await {
            total += chunk.len();
            if !ctx.send(Obs::AppMessagesBackfill(chunk)).await {
                return;
            }
        }
        match parse.await {
            Ok(Ok(n)) => {
                tracing::info!(
                    messages = n,
                    stored = total,
                    "permanent app messages backfilled"
                );
                let _ = ctx
                    .send(Obs::Meta {
                        key: meta::BACKFILL_APP_MESSAGES_DONE,
                        value: now_ms(),
                    })
                    .await;
                ctx.ok("backfill");
                return;
            }
            Ok(Err(e)) => ctx.fail("backfill", &e),
            Err(e) => ctx.fail("backfill", &e),
        }
        if !ctx.sleep(Duration::from_secs(120)).await {
            return;
        }
    }
}

/// Parses the permanent-message envelope `{status, data: [...]}` element by element.
pub fn parse_messages(
    bytes: &[u8],
    sink: &mut dyn FnMut(PermanentMessage),
) -> Result<usize, serde_json::Error> {
    struct Data<'a>(&'a mut dyn FnMut(PermanentMessage));
    impl<'de> DeserializeSeed<'de> for Data<'_> {
        type Value = usize;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<usize, D::Error> {
            d.deserialize_seq(self)
        }
    }
    impl<'de> Visitor<'de> for Data<'_> {
        type Value = usize;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("an array of permanent messages")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<usize, A::Error> {
            let mut n = 0;
            while let Some(m) = seq.next_element::<PermanentMessage>()? {
                (self.0)(m);
                n += 1;
            }
            Ok(n)
        }
    }
    struct Env<'a>(&'a mut dyn FnMut(PermanentMessage));
    impl<'de> Visitor<'de> for Env<'_> {
        type Value = usize;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a FluxOS envelope")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<usize, A::Error> {
            let mut n = 0;
            let mut status = String::new();
            while let Some(k) = map.next_key::<String>()? {
                match k.as_str() {
                    "data" if status != "error" => n = map.next_value_seed(Data(&mut *self.0))?,
                    "status" => status = map.next_value::<String>()?,
                    _ => {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
            }
            if status == "error" {
                return Err(serde::de::Error::custom("upstream returned status error"));
            }
            Ok(n)
        }
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    serde::Deserializer::deserialize_map(&mut de, Env(sink))
}

async fn blocks(ctx: &JobCtx, days: u32, rps: f64) {
    let pause = Duration::from_secs_f64(1.0 / rps.clamp(0.1, 4.0));
    // Wait until the first live block fixed the floor.
    let floor = loop {
        if let Some(f) = meta_get(ctx, meta::LIVE_FLOOR).await {
            break f as u32;
        }
        if !ctx.sleep(Duration::from_secs(30)).await {
            return;
        }
    };
    let target = if let Some(t) = meta_get(ctx, meta::BACKFILL_BLOCKS_TARGET).await {
        t as u32
    } else {
        let t = floor.saturating_sub(days * BLOCKS_PER_DAY);
        let _ = ctx
            .send(Obs::Meta {
                key: meta::BACKFILL_BLOCKS_TARGET,
                value: u64::from(t),
            })
            .await;
        t
    };
    let mut h = meta_get(ctx, meta::BACKFILL_BLOCKS_CURSOR)
        .await
        .map_or(floor.saturating_sub(1), |c| c as u32);
    tracing::info!(from = h, to = target, "block backfill running");
    let mut chunk = Vec::with_capacity(BLOCK_CHUNK);
    let mut failures = 0u32;
    while h > target && h > 0 {
        if ctx.stopping() {
            return;
        }
        if ctx
            .store_read(move |s| s.block(h))
            .await
            .flatten()
            .is_some()
        {
            h -= 1;
            continue;
        }
        match ctx
            .call(
                Upstream::FluxOs,
                "getblock (backfill)",
                ctx.clients.fluxos.get_block(&h.to_string()),
            )
            .await
            .map_err(|e| e.to_string())
            .and_then(|b| decode_block(&b).map_err(|e| e.to_string()))
        {
            Ok(d) => {
                failures = 0;
                chunk.push(d);
                h -= 1;
            }
            Err(e) => {
                failures += 1;
                ctx.fail("backfill", &e);
                if failures >= 5 {
                    tracing::warn!(height = h, "skipping a block the backfill cannot fetch");
                    h -= 1;
                    failures = 0;
                }
                if !ctx.sleep(Duration::from_secs(10)).await {
                    return;
                }
                continue;
            }
        }
        if chunk.len() >= BLOCK_CHUNK {
            let blocks = std::mem::take(&mut chunk);
            if !ctx.send(Obs::BackfillBlocks(blocks)).await
                || !ctx
                    .send(Obs::Meta {
                        key: meta::BACKFILL_BLOCKS_CURSOR,
                        value: u64::from(h),
                    })
                    .await
            {
                return;
            }
            ctx.ok("backfill");
        }
        if !ctx.sleep(pause).await {
            return;
        }
    }
    if !chunk.is_empty() {
        let _ = ctx.send(Obs::BackfillBlocks(chunk)).await;
    }
    let _ = ctx
        .send(Obs::Meta {
            key: meta::BACKFILL_BLOCKS_CURSOR,
            value: u64::from(h),
        })
        .await;
    tracing::info!(to = target, "block backfill complete");
    ctx.ok("backfill");
}

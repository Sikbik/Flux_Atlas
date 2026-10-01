//! ChainSampler: the time and difficulty of the whole chain for `/network/chain-history`,
//! without indexing three million blocks.
//!
//! The mean time per block between two heights is their time difference over their height
//! difference, so sparse samples are enough: one every [`CHAIN_SAMPLE_GRID`] blocks (about 4,200
//! for the whole chain, one `getblock` verbosity 1 request each). Recent blocks need no request:
//! the block decoder and the block backfill store a row for every block they apply.
//!
//! - **Order:** first the newest 30 days on a finer grid (every 120 blocks, about one an hour,
//!   720 requests, newest first), so the 24 h, 7 d and 30 d windows are complete within minutes
//!   of a fresh start, long before the per-block rows exist. Then the deep grid, coarse heights
//!   first (every 8th grid height, then every 4th, 2nd, all), newest first within a level, so the
//!   year and all-time windows have a usable shape within minutes and refine over about an hour.
//!   The fine rows age out with the per-block tier (thinned to the deep grid after 31 days).
//! - **Resumable and idempotent:** the stored rows are the progress. Each pass asks the store
//!   which grid heights below `tip - depth` still lack a row with a difficulty and fetches only
//!   those; a restart resumes where the last flushed chunk ended, and a fetched height is never
//!   fetched again. Heights stay `depth` blocks below the tip, so reorgs never reach them (the
//!   per-block rows near the tip are overwritten by the replacement blocks).
//! - **Polite:** the bulk upstream lane (one request at a time, at most one a second per host,
//!   its own breakers), a pause between requests, and an exponential backoff on errors.
//! - Insight's daily difficulty series (one request a day, the last two years) is stored too: it
//!   fills the difficulty of year-scale buckets whose rows carry none.

use std::time::{Duration, Instant};

use atlas_core::now_ms;
use atlas_flux::Clients;
use atlas_flux::timefmt::parse_iso8601_ms;
use atlas_store::{CHAIN_DENSE_BLOCKS, CHAIN_DENSE_GRID, CHAIN_SAMPLE_GRID, ChainPoint, DAY_MS};

use super::JobCtx;
use crate::meta;
use crate::obs::Obs;
use crate::stats::Upstream;

const JOB: &str = "chain_sampler";
/// Coarse levels: a grid height divisible by `grid << level` belongs to `level`.
const LEVELS: u32 = 3;
/// Samples per observation sent to the reducer (and progress flushed to the store).
const CHUNK: usize = 25;
/// Attempts per height within one pass; a height that keeps failing waits for the next pass.
const MAX_FAILURES: u32 = 4;
const BACKOFF_BASE: Duration = Duration::from_secs(5);
const BACKOFF_MAX: Duration = Duration::from_secs(600);

/// The order to fetch `missing` grid heights in: coarse levels first (a height divisible by
/// `grid << LEVELS`, then by `grid << (LEVELS - 1)`, ...), newest first within a level.
pub fn sample_order(missing: &[u32], grid: u32) -> Vec<u32> {
    let grid = grid.max(1);
    let level = |h: u32| {
        if h == 0 {
            LEVELS
        } else {
            (h / grid).trailing_zeros().min(LEVELS)
        }
    };
    let mut out = missing.to_vec();
    out.sort_unstable_by(|a, b| level(*b).cmp(&level(*a)).then(b.cmp(a)));
    out
}

/// The heights a pass fetches, given the newest height it may sample: first the missing
/// [`CHAIN_DENSE_GRID`] heights of the newest [`CHAIN_DENSE_BLOCKS`] (newest first: the 24 h to
/// 30 d windows complete in that order), then the missing deep-grid heights below them in
/// [`sample_order`].
pub fn plan(store: &atlas_store::Store, max_height: u32) -> atlas_store::Result<Vec<u32>> {
    let dense_from = max_height.saturating_sub(CHAIN_DENSE_BLOCKS);
    let mut out = store.chain_missing(CHAIN_DENSE_GRID, dense_from, max_height)?;
    out.reverse();
    let deep: Vec<u32> = store
        .chain_grid_missing(CHAIN_SAMPLE_GRID, max_height)?
        .into_iter()
        .filter(|h| *h < dense_from)
        .collect();
    out.extend(sample_order(&deep, CHAIN_SAMPLE_GRID));
    Ok(out)
}

/// Backoff after `failures` consecutive errors.
fn backoff(failures: u32) -> Duration {
    BACKOFF_BASE
        .saturating_mul(1 << failures.saturating_sub(1).min(10))
        .min(BACKOFF_MAX)
}

/// Lifetime counters, persisted with every chunk.
struct Counters {
    samples: u64,
    requests: u64,
}

pub async fn run(ctx: JobCtx) {
    let cfg = ctx.cfg.chain_sampler.clone();
    if !cfg.enabled {
        return;
    }
    // Let the chain job set the tip and the first backfills start.
    if !ctx.sleep(Duration::from_secs(90)).await {
        return;
    }
    seed(&ctx).await;
    let bulk = ctx.handle.bulk_clients().clone();
    let mut counters = Counters {
        samples: meta_get(&ctx, meta::CHAIN_SAMPLES).await.unwrap_or(0),
        requests: meta_get(&ctx, meta::CHAIN_REQUESTS).await.unwrap_or(0),
    };
    loop {
        daily(&ctx, &bulk, cfg.daily_interval).await;
        let Some(tip) = ctx
            .handle
            .published()
            .network
            .tip
            .as_ref()
            .map(|t| t.height)
        else {
            if !ctx.sleep(Duration::from_secs(30)).await {
                return;
            }
            continue;
        };
        let max_height = tip.saturating_sub(cfg.depth);
        let Some(order) = ctx.store_read(move |s| plan(s, max_height)).await else {
            if !ctx.sleep(Duration::from_secs(60)).await {
                return;
            }
            continue;
        };
        if order.is_empty() {
            if meta_get(&ctx, meta::CHAIN_SAMPLED_MS).await.is_none() {
                tracing::info!(
                    samples = counters.samples,
                    requests = counters.requests,
                    "chain sampler: every grid height is sampled"
                );
                let _ = ctx
                    .send(Obs::Meta {
                        key: meta::CHAIN_SAMPLED_MS,
                        value: now_ms(),
                    })
                    .await;
            }
            ctx.ok(JOB);
            ctx.next(JOB, cfg.idle_interval);
            if !ctx.sleep(cfg.idle_interval).await {
                return;
            }
            continue;
        }
        tracing::info!(missing = order.len(), tip, "chain sampler running");
        let started = Instant::now();
        let (before_s, before_r) = (counters.samples, counters.requests);
        let Some(stored) = pass(&ctx, &bulk, cfg.pause, &order, &mut counters).await else {
            return;
        };
        let secs = started.elapsed().as_secs_f64();
        tracing::info!(
            stored,
            requests = counters.requests - before_r,
            secs = secs as u64,
            rps = format!(
                "{:.2}",
                (counters.requests - before_r) as f64 / secs.max(1.0)
            ),
            total_samples = counters.samples,
            "chain sampler pass done"
        );
        // Nothing stored (upstream down): wait before trying the same heights again. Otherwise
        // give the store writer time to commit the last chunks, so the next pass does not see
        // them as missing and fetch them twice.
        let wait = if counters.samples == before_s {
            Duration::from_secs(600)
        } else {
            Duration::from_secs(15)
        };
        if !ctx.sleep(wait).await {
            return;
        }
    }
}

/// Fetches `order` once. Returns the samples stored, `None` when shutting down.
async fn pass(
    ctx: &JobCtx,
    bulk: &Clients,
    pause: Duration,
    order: &[u32],
    counters: &mut Counters,
) -> Option<u64> {
    let mut chunk: Vec<(u32, ChainPoint)> = Vec::with_capacity(CHUNK);
    let mut stored = 0u64;
    let mut failures = 0u32;
    for &h in order {
        loop {
            if ctx.stopping() {
                return None;
            }
            counters.requests += 1;
            let res = ctx
                .call(
                    Upstream::FluxOs,
                    "getblock (chain sample)",
                    bulk.fluxos.get_block_brief(h),
                )
                .await;
            match res {
                Ok(b) => {
                    failures = 0;
                    chunk.push((
                        h,
                        ChainPoint {
                            time_s: u32::try_from(b.time).unwrap_or(u32::MAX),
                            difficulty: b.difficulty.filter(|d| d.is_finite()),
                        },
                    ));
                    break;
                }
                Err(e) => {
                    failures += 1;
                    ctx.fail(JOB, &e);
                    if !ctx.sleep(backoff(failures)).await {
                        return None;
                    }
                    if failures >= MAX_FAILURES {
                        tracing::warn!(height = h, error = %e, "chain sampler: height skipped this pass");
                        failures = 0;
                        break;
                    }
                }
            }
        }
        if chunk.len() >= CHUNK {
            stored += chunk.len() as u64;
            if !flush(ctx, &mut chunk, counters).await {
                return None;
            }
        }
        if !ctx.sleep(pause).await {
            return None;
        }
    }
    stored += chunk.len() as u64;
    flush(ctx, &mut chunk, counters).await.then_some(stored)
}

/// Sends the chunk and the counters to the reducer.
async fn flush(ctx: &JobCtx, chunk: &mut Vec<(u32, ChainPoint)>, counters: &mut Counters) -> bool {
    counters.samples += chunk.len() as u64;
    let points = std::mem::take(chunk);
    if !points.is_empty() && !ctx.send(Obs::ChainPoints(points)).await {
        return false;
    }
    for (key, value) in [
        (meta::CHAIN_SAMPLES, counters.samples),
        (meta::CHAIN_REQUESTS, counters.requests),
    ] {
        if !ctx.send(Obs::Meta { key, value }).await {
            return false;
        }
    }
    ctx.ok(JOB);
    true
}

/// Once per data directory: rows for the blocks stored before `chain_points` existed.
async fn seed(ctx: &JobCtx) {
    if meta_get(ctx, meta::CHAIN_SEEDED_MS).await.is_some() {
        return;
    }
    let keep = ctx.cfg.history.chain_blocks_ms.unwrap_or(31 * DAY_MS);
    let since = now_ms().saturating_sub(keep);
    let Some(n) = ctx
        .store_read(move |s| s.seed_chain_points_from_blocks(since))
        .await
    else {
        tracing::warn!("chain history: could not seed from stored blocks");
        return;
    };
    if n > 0 {
        tracing::info!(rows = n, "chain history seeded from stored blocks");
    }
    let _ = ctx
        .send(Obs::Meta {
            key: meta::CHAIN_SEEDED_MS,
            value: now_ms(),
        })
        .await;
}

/// Insight's daily difficulty series, at most once per `every`.
async fn daily(ctx: &JobCtx, bulk: &Clients, every: Duration) {
    let last = meta_get(ctx, meta::CHAIN_DAILY_MS).await.unwrap_or(0);
    if now_ms().saturating_sub(last) < every.as_millis() as u64 {
        return;
    }
    match ctx
        .call(
            Upstream::Insight,
            "statistics/difficulty",
            bulk.insight.stats_series("difficulty", "all"),
        )
        .await
    {
        Ok(series) => {
            let days = daily_points(series.iter().map(|p| (p.date.as_str(), p.sum)));
            tracing::info!(days = days.len(), "daily difficulty stored");
            if !days.is_empty() {
                let _ = ctx.send(Obs::ChainDaily(days)).await;
            }
            let _ = ctx
                .send(Obs::Meta {
                    key: meta::CHAIN_DAILY_MS,
                    value: now_ms(),
                })
                .await;
        }
        Err(e) => ctx.fail(JOB, &e),
    }
}

/// `(UTC day start ms, difficulty)` from Insight's `{date: "YYYY-MM-DD", sum}` rows, skipping
/// unparsable dates and non-finite or missing values.
pub fn daily_points<'a>(rows: impl Iterator<Item = (&'a str, Option<f64>)>) -> Vec<(u64, f64)> {
    let mut out: Vec<(u64, f64)> = rows
        .filter_map(|(date, sum)| {
            let d = sum.filter(|d| d.is_finite())?;
            let ms = parse_iso8601_ms(&format!("{}T00:00:00Z", date.trim()))?;
            Some((ms, d))
        })
        .collect();
    out.sort_unstable_by_key(|(t, _)| *t);
    out.dedup_by_key(|(t, _)| *t);
    out
}

async fn meta_get(ctx: &JobCtx, key: &'static str) -> Option<u64> {
    ctx.store_read(move |s| s.meta_u64(key)).await.flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coarse_heights_first_newest_first() {
        let g = 10;
        let missing: Vec<u32> = (0..=16).map(|i| i * g).collect();
        let order = sample_order(&missing, g);
        assert_eq!(
            order,
            vec![
                // Level 3 (divisible by 80) incl. genesis, newest first.
                160, 80, 0, // level 2 (40)
                120, 40, // level 1 (20)
                140, 100, 60, 20, // level 0
                150, 130, 110, 90, 70, 50, 30, 10,
            ]
        );
        assert_eq!(order.len(), missing.len());
    }

    /// A pass interrupted after some chunks resumes with exactly the heights it had not stored,
    /// in the same order, and a finished pass leaves nothing to fetch.
    #[test]
    fn resume_fetches_only_what_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = atlas_store::Store::open(dir.path().join("t.redb")).unwrap();
        let g = CHAIN_SAMPLE_GRID;
        let max = 40 * g + 5;
        // Live blocks already cover the top: grid heights 36g..=40g have rows.
        let mut b = atlas_store::WriteBatch::new();
        for h in 36 * g..=max {
            b.put_chain_point(h, point(h, Some(1.0)));
        }
        // A row seeded from a stored block (no difficulty) is fetched again.
        b.put_chain_point(10 * g, point(10 * g, None));
        store.commit(b).unwrap();
        let first = sample_order(&store.chain_grid_missing(g, max).unwrap(), g);
        assert_eq!(first.len(), 36);
        assert!(first.contains(&(10 * g)));
        // Store two chunks' worth, then "restart".
        let done = 2 * 7;
        let mut b = atlas_store::WriteBatch::new();
        for &h in &first[..done] {
            b.put_chain_point(h, point(h, Some(2.0)));
        }
        store.commit(b).unwrap();
        let second = sample_order(&store.chain_grid_missing(g, max).unwrap(), g);
        assert_eq!(second, first[done..].to_vec());
        let mut b = atlas_store::WriteBatch::new();
        for &h in &second {
            b.put_chain_point(h, point(h, Some(2.0)));
        }
        store.commit(b).unwrap();
        assert!(store.chain_grid_missing(g, max).unwrap().is_empty());
    }

    /// A fresh store: the newest 30 days on the fine grid first (newest first), then the deep
    /// grid below them; a restart resumes with exactly the rest.
    #[test]
    fn plan_samples_the_recent_month_first_and_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let store = atlas_store::Store::open(dir.path().join("t.redb")).unwrap();
        let max = 3_000_000;
        let first = plan(&store, max).unwrap();
        let dense_from = max - CHAIN_DENSE_BLOCKS;
        let dense = first.iter().take_while(|h| **h >= dense_from).count();
        assert_eq!(dense as u32, CHAIN_DENSE_BLOCKS / CHAIN_DENSE_GRID + 1);
        assert_eq!(first[0], max - max % CHAIN_DENSE_GRID);
        assert!(first[..dense].windows(2).all(|w| w[0] > w[1]));
        assert!(
            first[dense..]
                .iter()
                .all(|h| *h < dense_from && h % CHAIN_SAMPLE_GRID == 0)
        );
        assert_eq!(first[dense], 2_908_800, "the newest coarsest deep height");
        let mut seen = std::collections::HashSet::new();
        assert!(first.iter().all(|h| seen.insert(*h)), "no height twice");
        // Fetch 100, restart.
        let mut b = atlas_store::WriteBatch::new();
        for &h in &first[..100] {
            b.put_chain_point(h, point(h, Some(1.0)));
        }
        store.commit(b).unwrap();
        assert_eq!(plan(&store, max).unwrap(), first[100..].to_vec());
    }

    fn point(h: u32, difficulty: Option<f64>) -> ChainPoint {
        ChainPoint {
            time_s: 1_500_000_000 + h * 30,
            difficulty,
        }
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff(1), Duration::from_secs(5));
        assert_eq!(backoff(2), Duration::from_secs(10));
        assert_eq!(backoff(4), Duration::from_secs(40));
        assert_eq!(backoff(30), BACKOFF_MAX);
    }

    #[test]
    fn daily_series_parses_and_sorts() {
        let rows = [
            ("2026-10-01", Some(0.08)),
            ("2025-10-24", Some(10_658.97)),
            ("bad", Some(1.0)),
            ("2025-10-25", None),
            ("2025-10-26", Some(f64::NAN)),
        ];
        let days = daily_points(rows.iter().map(|(d, s)| (*d, *s)));
        assert_eq!(
            days,
            vec![(1_761_264_000_000, 10_658.97), (1_790_812_800_000, 0.08)]
        );
    }
}

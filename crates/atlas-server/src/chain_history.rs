//! `GET /network/chain-history`: block difficulty and time per block, bucketed from the
//! `chain_points` rows (per block for recent history, the sample grid for older history).
//!
//! **Buckets** are aligned on UTC multiples of the window's step: 5 min for 24 h (288 points),
//! 15 min for 7 d (672), 1 h for 30 d (720), 1 day for a year (365), and whole days for the
//! whole chain (at most 720). Buckets are right-closed, `(end - step, end]`, and the last one
//! ends at the newest row. A row falls into the bucket of its time, with times taken as a
//! running maximum in height order (block times are not strictly ascending), so every bucket
//! holds a contiguous run of heights.
//!
//! **Time per block** of a bucket is `(time(last) - time(anchor)) / (last - anchor)`, where
//! `last` is the bucket's last row and `anchor` the row just below its first one. With per-block
//! rows the anchor is the previous block, so the mean is exact. With samples (one every 120
//! blocks for the last 30 days, every 720 before) the span reaches back to the previous sample:
//! the two rows must be linked, i.e. at most one deep-grid interval (720 blocks) or three buckets
//! apart. A bucket with no row inside a linked sample span gets that span's mean, an
//! interpolated height and no difficulty (`sampled`). Wider spans are gaps: never smeared over.
//! Where per-block rows do not cover a bucket, `block_time_max_s` is `null`.
//!
//! **Coverage** counts the heights covered by a known time per block against the window's
//! heights (from the row at or before the window start, or estimated from the target spacing
//! when the data does not reach that far back).

use atlas_core::api::{
    BlockTimeTargetDto, ChainCoverageDto, ChainHistoryDto, ChainPointDto, ChainWindow,
};
use atlas_core::emission::{
    GENESIS_TIME_MS, PON_ACTIVATION_HEIGHT, PON_ACTIVATION_TIME_MS, PON_TARGET_SPACING_S,
    PRE_PON_TARGET_SPACING_S, target_spacing_s,
};
use atlas_store::{CHAIN_SAMPLE_GRID, ChainPoint, DAY_MS, HOUR_MS, MINUTE_MS};

use crate::body::cache;

/// Most points one window returns.
pub const MAX_POINTS: u64 = 720;

/// Bucket width and count of `window` ending at `end_ms`.
pub fn buckets(window: ChainWindow, end_ms: u64) -> (u64, u64) {
    match window {
        ChainWindow::Day => (5 * MINUTE_MS, 288),
        ChainWindow::Week => (15 * MINUTE_MS, 672),
        ChainWindow::Month => (HOUR_MS, 720),
        ChainWindow::Year => (DAY_MS, 365),
        ChainWindow::All => {
            let span = end_ms.saturating_sub(GENESIS_TIME_MS);
            let step = span.div_ceil(MAX_POINTS * DAY_MS).max(1) * DAY_MS;
            // Buckets are right-closed, so the genesis row needs an edge strictly before it.
            let first = (GENESIS_TIME_MS - 1) - (GENESIS_TIME_MS - 1) % step;
            (step, (end_ms.div_ceil(step) * step - first) / step)
        }
    }
}

/// How long one computed body is reused, and its `Cache-Control`.
pub fn cache_policy(window: ChainWindow) -> (u64, &'static str) {
    match window {
        ChainWindow::Day => (30_000, cache::CHAIN_SHORT),
        ChainWindow::Week => (60_000, cache::CHAIN_SHORT),
        ChainWindow::Month => (120_000, cache::CHAIN_MEDIUM),
        ChainWindow::Year | ChainWindow::All => (600_000, cache::CHAIN_LONG),
    }
}

/// Lowest height whose row a window ending at the newest row `latest` can need: the window's
/// span at the fastest plausible rate (30 s target, 25% faster), plus two sample intervals for
/// the first bucket's anchor.
pub fn lowest_height(window: ChainWindow, latest: Option<(u32, ChainPoint)>) -> u32 {
    let Some((h, p)) = latest else { return 0 };
    if window == ChainWindow::All {
        return 0;
    }
    let (step, n) = buckets(window, p.time_ms());
    let span_s = (step * (n + 2)) / 1000;
    let blocks = span_s / u64::from(PON_TARGET_SPACING_S) * 5 / 4;
    let back = u32::try_from(blocks).unwrap_or(u32::MAX);
    h.saturating_sub(back).saturating_sub(2 * CHAIN_SAMPLE_GRID)
}

/// The target spacing schedule.
pub fn targets() -> Vec<BlockTimeTargetDto> {
    vec![
        BlockTimeTargetDto {
            from_height: 0,
            from_ms: GENESIS_TIME_MS,
            seconds: PRE_PON_TARGET_SPACING_S,
        },
        BlockTimeTargetDto {
            from_height: PON_ACTIVATION_HEIGHT,
            from_ms: PON_ACTIVATION_TIME_MS,
            seconds: PON_TARGET_SPACING_S,
        },
    ]
}

fn mean(values: impl Iterator<Item = f64>) -> Option<f64> {
    let (sum, n) = values.fold((0.0, 0u32), |(s, n), v| (s + v, n + 1));
    (n > 0).then(|| sum / f64::from(n))
}

fn seconds(ms_delta: i64) -> f64 {
    ms_delta as f64 / 1000.0
}

/// Builds the window from `rows` (ascending by height, every row the window can need: see
/// [`lowest_height`]; the last row is the newest) and the daily difficulty series. `now_ms`
/// stamps the body and ends the window when there is no data.
#[allow(clippy::too_many_lines)]
pub fn build(
    window: ChainWindow,
    rows: &[(u32, ChainPoint)],
    daily: &[(u64, f64)],
    now_ms: u64,
) -> ChainHistoryDto {
    let latest = rows.last().copied();
    let end_ms = latest.map_or(now_ms, |(_, p)| p.time_ms());
    let (step, n) = buckets(window, end_ms);
    // Buckets are right-closed, `(end - step, end]`: a point at `t_ms` sums up the step before.
    let end_edge = end_ms.div_ceil(step) * step;
    let start_edge = end_edge - n * step;
    let window_start = if window == ChainWindow::All {
        start_edge.max(GENESIS_TIME_MS)
    } else {
        start_edge
    };

    // Effective times (running maximum) and each row's bucket.
    let mut t_eff = Vec::with_capacity(rows.len());
    let mut run = 0u64;
    for (_, p) in rows {
        run = run.max(p.time_ms());
        t_eff.push(run);
    }
    // (bucket index, first row index, last row index)
    let mut spans: Vec<(u64, usize, usize)> = Vec::new();
    for (i, t) in t_eff.iter().enumerate() {
        if *t <= start_edge || *t > end_edge {
            continue;
        }
        let b = (t - start_edge - 1) / step;
        match spans.last_mut() {
            Some(s) if s.0 == b => s.2 = i,
            _ => spans.push((b, i, i)),
        }
    }

    // Two consecutive rows are linked (their mean time per block spans the heights between
    // them) when they are adjacent blocks, consecutive samples (at most one deep-grid interval
    // apart), or less than three buckets apart in time. Anything wider is a gap.
    let linked = |a: usize, b: usize| {
        let gap = rows[b].0.saturating_sub(rows[a].0);
        gap >= 1 && (gap <= CHAIN_SAMPLE_GRID || t_eff[b] - t_eff[a] <= 3 * step)
    };
    let link_time = |a: usize, b: usize| {
        let gap = rows[b].0 - rows[a].0;
        seconds(rows[b].1.time_ms() as i64 - rows[a].1.time_ms() as i64) / f64::from(gap)
    };

    let mut points = Vec::with_capacity(n as usize);
    let mut covered: u64 = 0;
    for (si, &(b, first, last)) in spans.iter().enumerate() {
        let bucket_start = start_edge + b * step;
        let bucket_end = bucket_start + step;
        // Buckets without a row between the previous row and this one: the mean of the
        // sampled link that spans them (never across adjacent blocks, where an empty bucket
        // just means no block was found in it).
        if let Some(a) = first.checked_sub(1)
            && rows[first].0 - rows[a].0 > 1
            && linked(a, first)
        {
            let from_bucket = match si.checked_sub(1) {
                Some(prev) => spans[prev].0 + 1,
                None => 0,
            };
            let (ta, tb) = (t_eff[a], t_eff[first]);
            let gap = rows[first].0 - rows[a].0;
            for k in from_bucket..b {
                let end_k = start_edge + (k + 1) * step;
                if end_k <= ta {
                    continue;
                }
                let frac = (end_k - ta) as f64 / (tb - ta).max(1) as f64;
                let off = ((frac * f64::from(gap)) as u32).min(gap - 1);
                points.push(ChainPointDto {
                    t_ms: end_k,
                    height: rows[a].0 + off,
                    difficulty: None,
                    difficulty_mean: None,
                    block_time_s: Some(link_time(a, first)),
                    block_time_max_s: None,
                    sampled: true,
                });
            }
        }
        let in_bucket = &rows[first..=last];
        let (h_last, p_last) = rows[last];
        let anchor = first.checked_sub(1);
        let contiguous_anchor = anchor.is_some_and(|a| rows[a].0 + 1 == rows[first].0);
        // Without a linked row below, the bucket's own first row is the base (its own span).
        let base = anchor
            .filter(|a| linked(*a, first))
            .map(|a| rows[a])
            .or_else(|| (last > first).then(|| rows[first]));
        let block_time_s = base.and_then(|(h_a, p_a)| {
            let blocks = h_last.checked_sub(h_a).filter(|d| *d > 0)?;
            covered += u64::from(blocks);
            Some(seconds(p_last.time_ms() as i64 - p_a.time_ms() as i64) / f64::from(blocks))
        });
        let per_block = contiguous_anchor && in_bucket.windows(2).all(|w| w[0].0 + 1 == w[1].0);
        let block_time_max_s = per_block
            .then(|| {
                rows[first - 1..=last]
                    .windows(2)
                    .map(|w| seconds(w[1].1.time_ms() as i64 - w[0].1.time_ms() as i64))
                    .reduce(f64::max)
            })
            .flatten();
        // Daily difficulty fills buckets of a day or more whose rows carry none.
        let days: Vec<f64> = if step >= DAY_MS {
            daily
                .iter()
                .filter(|(d, _)| d + DAY_MS > bucket_start && d + DAY_MS <= bucket_end)
                .map(|(_, v)| *v)
                .collect()
        } else {
            Vec::new()
        };
        let difficulty = in_bucket
            .iter()
            .rev()
            .find_map(|(_, p)| p.difficulty)
            .or_else(|| days.last().copied());
        let difficulty_mean = mean(in_bucket.iter().filter_map(|(_, p)| p.difficulty))
            .or_else(|| mean(days.iter().copied()));
        points.push(ChainPointDto {
            t_ms: bucket_end.min(end_ms),
            height: h_last,
            difficulty,
            difficulty_mean,
            block_time_s,
            block_time_max_s,
            sampled: block_time_s.is_some() && !per_block,
        });
    }

    let first_row = spans.first().map(|s| rows[s.1]);
    let last_row = spans.last().map(|s| rows[s.2]);
    let (from_ms, from_height) = first_row.map_or((window_start, latest.map_or(0, |l| l.0)), |r| {
        (r.1.time_ms(), r.0)
    });
    let (to_ms, to_height) = last_row.map_or((end_ms, latest.map_or(0, |l| l.0)), |r| {
        (r.1.time_ms(), r.0)
    });
    let avg_block_time_s = (to_height > from_height)
        .then(|| seconds(to_ms as i64 - from_ms as i64) / f64::from(to_height - from_height));

    // The window's heights: from the last row at or before its start, else estimated back from
    // the first row at the target spacing.
    let start_height = spans
        .first()
        .map(|&(_, first, _)| match first.checked_sub(1) {
            Some(a) if t_eff[a] <= window_start => rows[a].0,
            _ => {
                let (h, p) = rows[first];
                let back_s = p.time_ms().saturating_sub(window_start) / 1000;
                let blocks = back_s / u64::from(target_spacing_s(h));
                h.saturating_sub(u32::try_from(blocks).unwrap_or(u32::MAX))
            }
        });
    let total = start_height.map_or(0, |s| u64::from(to_height.saturating_sub(s)));
    let percent = if total == 0 {
        0.0
    } else {
        (covered.min(total) as f64 * 1000.0 / total as f64).floor() / 10.0
    };
    let latest_height = latest.map_or(0, |l| l.0);
    ChainHistoryDto {
        window,
        generated_ms: now_ms,
        from_ms,
        to_ms,
        from_height,
        to_height,
        block_count: if points.is_empty() {
            0
        } else {
            to_height - from_height + 1
        },
        avg_block_time_s,
        bucket_ms: step,
        latest_height,
        latest_difficulty: latest.and_then(|l| l.1.difficulty),
        target_block_time_s: target_spacing_s(latest_height),
        targets: targets(),
        points,
        coverage: ChainCoverageDto {
            complete: total > 0 && covered >= total,
            indexed_from_height: first_row.map(|r| r.0),
            percent,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 12:00 UTC on 2026-10-01.
    const NOON: u64 = 1_790_856_000_000;

    fn p(t_ms: u64, d: Option<f64>) -> ChainPoint {
        ChainPoint {
            time_s: (t_ms / 1000) as u32,
            difficulty: d,
        }
    }

    /// Per-block rows ending at `end_h` / `end_ms`, `count` blocks `spacing_s` apart.
    fn chain(end_h: u32, end_ms: u64, count: u32, spacing_s: u64) -> Vec<(u32, ChainPoint)> {
        (0..count)
            .rev()
            .map(|i| {
                let t = end_ms - u64::from(i) * spacing_s * 1000;
                (end_h - i, p(t, Some(f64::from(end_h - i))))
            })
            .collect()
    }

    #[test]
    fn day_window_buckets_and_averages() {
        // 24 h of blocks at exactly 30 s, plus the previous hour.
        let rows = chain(3_000_000, NOON, 3_000, 30);
        let dto = build(ChainWindow::Day, &rows, &[], NOON + 5);
        assert_eq!(dto.bucket_ms, 5 * MINUTE_MS);
        assert_eq!(dto.points.len(), 288);
        assert!(
            dto.points
                .iter()
                .all(|pt| pt.block_time_s == Some(30.0) && pt.block_time_max_s == Some(30.0))
        );
        assert!(dto.points.windows(2).all(|w| w[0].t_ms < w[1].t_ms));
        assert_eq!(dto.points.last().unwrap().t_ms, NOON);
        assert_eq!(dto.points.last().unwrap().height, 3_000_000);
        assert_eq!(dto.points.last().unwrap().difficulty, Some(3_000_000.0));
        assert_eq!(dto.avg_block_time_s, Some(30.0));
        assert_eq!(dto.block_count, dto.to_height - dto.from_height + 1);
        assert_eq!(dto.latest_height, 3_000_000);
        assert_eq!(dto.target_block_time_s, 30);
        assert!(dto.coverage.complete);
        assert!((dto.coverage.percent - 100.0).abs() < f64::EPSILON);
        // The window is the 288 buckets up to the newest row (on a bucket edge here).
        assert_eq!(dto.from_ms, NOON - 288 * 5 * MINUTE_MS + 30_000);
    }

    #[test]
    fn slow_block_sets_the_max_and_the_mean() {
        let mut rows = chain(3_000_000, NOON, 400, 30);
        // One block 4 minutes late: every later block shifts.
        let late = rows.len() - 50;
        for r in &mut rows[late..] {
            r.1.time_s += 210;
        }
        let dto = build(ChainWindow::Day, &rows, &[], NOON);
        let slow: Vec<&ChainPointDto> = dto
            .points
            .iter()
            .filter(|pt| pt.block_time_max_s == Some(240.0))
            .collect();
        assert_eq!(slow.len(), 1);
        let mean = slow[0].block_time_s.unwrap();
        assert!(mean > 30.0 && mean < 240.0, "{mean}");
        // Per bucket means telescope to the overall average.
        let sum: f64 = dto
            .points
            .iter()
            .map(|pt| pt.block_time_s.unwrap_or(0.0))
            .sum();
        assert!(sum > 0.0);
    }

    #[test]
    fn gaps_stay_null_and_lower_coverage() {
        let mut rows = chain(3_000_000, NOON, 3_000, 30);
        // Six hours missing in the middle of the day (720 blocks).
        rows.drain(1_000..1_720);
        let dto = build(ChainWindow::Day, &rows, &[], NOON);
        // No points inside the gap. The bucket after it has no usable anchor (6 h back): its
        // mean spans its own rows only, and it claims no per-block maximum.
        assert!(dto.points.len() < 288 - 70);
        let after = dto
            .points
            .iter()
            .find(|pt| pt.height > rows[999].0)
            .unwrap();
        assert_eq!(after.block_time_s, Some(30.0));
        assert_eq!(after.block_time_max_s, None);
        let before = dto.points.iter().rev().find(|pt| pt.height <= rows[999].0);
        assert_eq!(before.unwrap().height, rows[999].0);
        assert!(!dto.coverage.complete);
        assert!(dto.coverage.percent > 70.0 && dto.coverage.percent < 76.0);
        // Points step over the gap: a step wider than the bucket.
        assert!(
            dto.points
                .windows(2)
                .any(|w| w[1].t_ms - w[0].t_ms > dto.bucket_ms)
        );
    }

    #[test]
    fn partial_coverage_estimates_the_window_start() {
        // Only the newest 6 hours exist.
        let rows = chain(3_000_000, NOON, 720, 30);
        let dto = build(ChainWindow::Day, &rows, &[], NOON);
        assert_eq!(dto.coverage.indexed_from_height, Some(3_000_000 - 719));
        assert!(!dto.coverage.complete);
        assert!(
            dto.coverage.percent > 24.0 && dto.coverage.percent < 26.0,
            "{}",
            dto.coverage.percent
        );
        // The first bucket has no row below it: its own span only, no per-block maximum.
        assert_eq!(dto.points[0].block_time_s, Some(30.0));
        assert_eq!(dto.points[0].block_time_max_s, None);
        // A single row with nothing below has no time per block.
        let one = build(ChainWindow::Day, &rows[..1], &[], NOON);
        assert_eq!(one.points.len(), 1);
        assert_eq!(one.points[0].block_time_s, None);
        assert_eq!(one.avg_block_time_s, None);
        assert_eq!(one.block_count, 1);
        // No data at all.
        let empty = build(ChainWindow::Week, &[], &[], NOON);
        assert!(empty.points.is_empty());
        assert_eq!(empty.block_count, 0);
        assert_eq!(empty.avg_block_time_s, None);
        assert!(!empty.coverage.complete);
        assert_eq!(empty.coverage.indexed_from_height, None);
        assert_eq!(empty.latest_difficulty, None);
    }

    /// Grid samples every 720 heights across the fork: 120 s before, 30 s after.
    fn sampled_chain(tip: u32) -> Vec<(u32, ChainPoint)> {
        let time = |h: u32| {
            if h >= PON_ACTIVATION_HEIGHT {
                PON_ACTIVATION_TIME_MS + u64::from(h - PON_ACTIVATION_HEIGHT) * 30_000
            } else {
                PON_ACTIVATION_TIME_MS - u64::from(PON_ACTIVATION_HEIGHT - h) * 120_000
            }
        };
        let mut rows: Vec<(u32, ChainPoint)> = (0..=tip / CHAIN_SAMPLE_GRID)
            .map(|i| i * CHAIN_SAMPLE_GRID)
            .map(|h| {
                let d = if h >= PON_ACTIVATION_HEIGHT {
                    0.1
                } else {
                    10_000.0
                };
                (h, p(time(h), Some(d)))
            })
            .collect();
        if rows.last().map(|r| r.0) != Some(tip) {
            rows.push((tip, p(time(tip), Some(0.1))));
        }
        rows
    }

    #[test]
    fn target_schedule_across_the_fork() {
        let rows = sampled_chain(2_980_000);
        let dto = build(ChainWindow::All, &rows, &[], NOON);
        assert!(dto.points.len() as u64 <= MAX_POINTS);
        assert_eq!(dto.bucket_ms % DAY_MS, 0);
        assert_eq!(dto.targets.len(), 2);
        assert_eq!(dto.targets[0].seconds, 120);
        assert_eq!(dto.targets[1].from_height, PON_ACTIVATION_HEIGHT);
        assert_eq!(dto.targets[1].seconds, 30);
        assert_eq!(dto.target_block_time_s, 30);
        let pre: Vec<f64> = dto
            .points
            .iter()
            .filter(|pt| pt.t_ms < PON_ACTIVATION_TIME_MS - dto.bucket_ms)
            .filter_map(|pt| pt.block_time_s)
            .collect();
        let post: Vec<f64> = dto
            .points
            .iter()
            .filter(|pt| pt.t_ms > PON_ACTIVATION_TIME_MS + 2 * dto.bucket_ms)
            .filter_map(|pt| pt.block_time_s)
            .collect();
        assert!(pre.len() > 400 && pre.iter().all(|v| (*v - 120.0).abs() < 1e-9));
        assert!(post.len() > 50 && post.iter().all(|v| (*v - 30.0).abs() < 1e-9));
        // The fork bucket mixes both.
        assert!(
            dto.points
                .iter()
                .filter_map(|pt| pt.block_time_s)
                .any(|v| v > 30.5 && v < 119.5)
        );
        assert!(dto.coverage.complete, "{:?}", dto.coverage);
        assert_eq!(dto.coverage.indexed_from_height, Some(0));
        // Sampled data never claims per-block maxima.
        assert!(dto.points.iter().all(|pt| pt.block_time_max_s.is_none()));
        // A year of 30 s samples every 720 blocks: one or two per day.
        let year = build(ChainWindow::Year, &rows, &[], NOON);
        assert_eq!(year.points.len(), 365);
        assert!(year.coverage.complete);
        assert!(
            year.points
                .iter()
                .filter(|pt| pt.t_ms > PON_ACTIVATION_TIME_MS + DAY_MS)
                .all(|pt| pt.block_time_s == Some(30.0))
        );
    }

    #[test]
    fn sparse_samples_leave_unanchored_buckets_null_and_daily_fills_difficulty() {
        let mut rows = sampled_chain(2_980_000);
        // Samples only from 2,500,000 up: everything older is missing; one bucket's rows
        // lack a difficulty.
        rows.retain(|r| r.0 >= 2_500_000);
        let tip_ms = rows.last().unwrap().1.time_ms();
        let day = tip_ms - tip_ms % DAY_MS - 3 * DAY_MS;
        // The UTC day bucket (day + 1, day + 2] has rows without a difficulty.
        for r in &mut rows {
            if r.1.time_ms() > day + DAY_MS && r.1.time_ms() <= day + 2 * DAY_MS {
                r.1.difficulty = None;
            }
        }
        let daily = [(day, 0.25), (day + DAY_MS, 0.5)];
        let year = build(ChainWindow::Year, &rows, &daily, NOON);
        assert!(!year.coverage.complete);
        assert!(year.coverage.percent > 30.0 && year.coverage.percent < 70.0);
        assert_eq!(year.coverage.indexed_from_height, Some(2_500_560));
        assert_eq!(year.points[0].height % CHAIN_SAMPLE_GRID, 0);
        assert_eq!(year.points[0].block_time_max_s, None);
        let empty_days = 365 - year.points.len();
        assert!(empty_days > 100, "no data before 2,500,560: {empty_days}");
        let filled: Vec<&ChainPointDto> = year
            .points
            .iter()
            .filter(|pt| pt.difficulty == Some(0.5) || pt.difficulty == Some(0.25))
            .collect();
        assert_eq!(filled.len(), 1, "{:?}", year.points.last());
        assert_eq!(filled[0].difficulty_mean, Some(0.5));
        // Daily values never apply to sub-day buckets.
        let month = build(ChainWindow::Month, &rows, &daily, NOON);
        assert!(month.points.iter().all(|pt| pt.difficulty != Some(0.5)));
    }

    #[test]
    fn samples_a_little_wider_than_a_bucket_keep_their_anchor() {
        // A sample every 24.6 h against day buckets: some days have none.
        let rows: Vec<(u32, ChainPoint)> = (0..400u32)
            .map(|i| {
                let h = 2_100_000 + i * 2_952;
                (h, p(NOON - u64::from(399 - i) * 2_952 * 30_000, Some(0.1)))
            })
            .collect();
        let year = build(ChainWindow::Year, &rows, &[], NOON);
        assert_eq!(year.points.len(), 365);
        assert!(year.points.iter().all(|pt| pt.block_time_s == Some(30.0)));
        // Days without a sample of their own: the span's mean, no difficulty.
        assert!(
            year.points
                .iter()
                .any(|pt| pt.sampled && pt.difficulty.is_none())
        );
        assert!(year.coverage.complete, "{:?}", year.coverage);
    }

    #[test]
    fn recent_samples_alone_complete_the_short_windows() {
        // A fresh instance: no per-block rows yet, a sample every 120 blocks for 30 days.
        let rows: Vec<(u32, ChainPoint)> = (0..=720u32)
            .map(|i| {
                let h = 3_000_000 - (720 - i) * 120;
                let t = NOON - u64::from(720 - i) * 120 * 30_000;
                (h, p(t + u64::from(i % 3) * 1_000, Some(0.1)))
            })
            .collect();
        for w in [ChainWindow::Day, ChainWindow::Week, ChainWindow::Month] {
            let dto = build(w, &rows, &[], NOON);
            let (_, n) = buckets(w, NOON);
            assert_eq!(dto.points.len() as u64, n, "{w:?}");
            assert!(dto.coverage.complete, "{w:?} {:?}", dto.coverage);
            assert!(
                dto.points
                    .iter()
                    .all(|pt| pt.sampled && pt.block_time_max_s.is_none())
            );
            let bt = dto.points.iter().filter_map(|pt| pt.block_time_s);
            assert_eq!(bt.clone().count() as u64, n);
            assert!(bt.into_iter().all(|v| (v - 30.0).abs() < 0.1));
            assert!(dto.points.windows(2).all(|w| w[0].t_ms < w[1].t_ms));
            assert!(dto.points.windows(2).all(|w| w[0].height <= w[1].height));
        }
        // A missing sample run (more than 720 blocks) stays a gap.
        let mut holed = rows.clone();
        holed.retain(|r| !(3_000_000 - 20 * 120..3_000_000 - 12 * 120).contains(&r.0));
        let day = build(ChainWindow::Day, &holed, &[], NOON);
        assert!(!day.coverage.complete);
        assert!(day.points.len() < 288);
    }

    #[test]
    fn rows_out_of_time_order_stay_in_height_order() {
        let mut rows = chain(3_000_000, NOON, 3_000, 30);
        // A block stamped 3 minutes before its parent.
        let i = rows.len() - 100;
        rows[i].1.time_s -= 180;
        let dto = build(ChainWindow::Day, &rows, &[], NOON);
        assert!(dto.points.windows(2).all(|w| w[0].height < w[1].height));
        assert!(dto.coverage.complete);
        assert!(
            dto.points
                .iter()
                .any(|pt| pt.block_time_max_s == Some(210.0))
        );
    }

    #[test]
    fn windows_and_lowest_height() {
        assert_eq!(ChainWindow::parse("30d"), Some(ChainWindow::Month));
        assert_eq!(ChainWindow::parse("1Y"), None);
        for w in ChainWindow::ALL {
            let (_, n) = buckets(w, NOON);
            assert!(n <= MAX_POINTS, "{w:?}");
            assert_eq!(ChainWindow::parse(w.as_str()), Some(w));
        }
        let latest = Some((3_000_000, p(NOON, None)));
        assert_eq!(lowest_height(ChainWindow::All, latest), 0);
        assert_eq!(lowest_height(ChainWindow::Day, None), 0);
        let lo = lowest_height(ChainWindow::Day, latest);
        assert!(lo < 3_000_000 - 2_900 && lo > 3_000_000 - 6_000, "{lo}");
    }
}

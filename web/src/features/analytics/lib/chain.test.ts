import { describe, expect, it } from 'vitest';
import {
  type BlockTimeSummaryInput,
  blockTimeDomain,
  blockTimeSummary,
  chainFrame,
  chainModel,
  countAbove,
  difficultyChange,
  difficultyDomain,
  difficultySummary,
  formatBlockTime,
  formatBucketTime,
  formatDifficulty,
  formatTargetSeconds,
  formatTickSeconds,
  gapBandWorthDrawing,
  gapCeiling,
  gapReach,
  indexingPercent,
  indexingText,
  isChainWindow,
  nearestIndex,
  paceVsTarget,
  percentile,
  pointFacts,
  pointReading,
  spikeMarkers,
  targetAt,
  targetChanges,
  targetSegments,
  targetStepPoints,
  targetStory,
  timeDomain,
} from './chain';
import type { BlockTimeTargetDto, ChainHistoryDto, ChainPointDto } from './chainTypes';

const DAY = 86_400_000;
const FORK_MS = 1_757_938_712_000;

/** The chain's schedule: 120 s until Proof of Node at height 2,020,000, then 30 s. */
const SCHEDULE: BlockTimeTargetDto[] = [
  { from_height: 0, from_ms: 1_513_089_006_000, seconds: 120 },
  { from_height: 2_020_000, from_ms: FORK_MS, seconds: 30 },
];

const point = (over: Partial<ChainPointDto> = {}): ChainPointDto => ({
  t_ms: 1_000,
  height: 10,
  difficulty: 0.4,
  block_time_s: 30,
  block_time_max_s: 60,
  ...over,
});

describe('chainFrame', () => {
  it('lays the points out in columns', () => {
    const f = chainFrame([
      point({ t_ms: 1_000, height: 10, difficulty: 0.4, block_time_s: 30, block_time_max_s: 60 }),
      point({ t_ms: 2_000, height: 14, difficulty: 0.41, block_time_s: 37.5, block_time_max_s: 90 }),
    ]);
    expect(f.t).toEqual([1_000, 2_000]);
    expect(f.height).toEqual([10, 14]);
    expect(f.difficulty).toEqual([0.4, 0.41]);
    expect(f.blockTime).toEqual([30, 37.5]);
    expect(f.blockMax).toEqual([60, 90]);
  });

  it('keeps a missing value as null, never zero', () => {
    const f = chainFrame([
      point({ difficulty: null, block_time_s: null, block_time_max_s: null }),
      point({ t_ms: 2_000, difficulty: 0 }),
    ]);
    expect(f.difficulty).toEqual([null, 0]);
    expect(f.blockTime[0]).toBeNull();
    expect(f.blockMax[0]).toBeNull();
  });

  it('turns a value that is not a number into null', () => {
    const f = chainFrame([
      point({ difficulty: Number.NaN, block_time_s: Number.POSITIVE_INFINITY, block_time_max_s: Number.NaN }),
    ]);
    expect(f.difficulty).toEqual([null]);
    expect(f.blockTime).toEqual([null]);
    expect(f.blockMax).toEqual([null]);
  });

  it('does not plot a negative duration (a block stamped before its parent)', () => {
    const f = chainFrame([point({ block_time_s: -3, block_time_max_s: -3 })]);
    expect(f.blockTime).toEqual([null]);
    expect(f.blockMax).toEqual([null]);
  });

  it('drops a bucket with no usable time and puts the rest in order', () => {
    const f = chainFrame([
      point({ t_ms: 3_000, height: 30 }),
      point({ t_ms: Number.NaN, height: 99 }),
      point({ t_ms: 1_000, height: 10 }),
      point({ t_ms: 2_000, height: 20 }),
    ]);
    expect(f.t).toEqual([1_000, 2_000, 3_000]);
    expect(f.height).toEqual([10, 20, 30]);
  });

  it('is empty for no points', () => {
    expect(chainFrame([]).t).toEqual([]);
  });
});

describe('gapCeiling', () => {
  it('is the longest gap, never under the mean, and null where the longest gap is unknown', () => {
    const f = chainFrame([
      point({ t_ms: 1, block_time_s: 30, block_time_max_s: 90 }),
      point({ t_ms: 2, block_time_s: 40, block_time_max_s: 35 }),
      point({ t_ms: 3, block_time_s: 30, block_time_max_s: null }),
      point({ t_ms: 4, block_time_s: null, block_time_max_s: 120 }),
    ]);
    expect(gapCeiling(f)).toEqual([90, 40, null, 120]);
  });
});

describe('gapReach', () => {
  it('is the longer of the mean and the longest gap, and the mean where the longest gap is unknown', () => {
    const f = chainFrame([
      point({ t_ms: 1, block_time_s: 30, block_time_max_s: 90 }),
      point({ t_ms: 2, block_time_s: 40, block_time_max_s: 35 }),
      point({ t_ms: 3, block_time_s: 30, block_time_max_s: null }),
      point({ t_ms: 4, block_time_s: null, block_time_max_s: 120 }),
      point({ t_ms: 5, block_time_s: null, block_time_max_s: null }),
    ]);
    expect(gapReach(f)).toEqual([90, 40, 30, 120, null]);
  });
});

describe('nearestIndex', () => {
  const t = [100, 200, 400, 800];
  it('finds the closest bucket', () => {
    expect(nearestIndex(t, 90)).toBe(0);
    expect(nearestIndex(t, 290)).toBe(1);
    expect(nearestIndex(t, 310)).toBe(2);
    expect(nearestIndex(t, 5_000)).toBe(3);
  });
  it('is -1 with nothing to find', () => {
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('targetSegments', () => {
  it('draws the step at the fork in a window that crosses it', () => {
    const seg = targetSegments(SCHEDULE, FORK_MS - 10 * DAY, FORK_MS + 20 * DAY, 30);
    expect(seg).toEqual([
      { fromMs: FORK_MS - 10 * DAY, toMs: FORK_MS, seconds: 120, fromHeight: 0 },
      { fromMs: FORK_MS, toMs: FORK_MS + 20 * DAY, seconds: 30, fromHeight: 2_020_000 },
    ]);
  });

  it('is one flat segment inside the 30 s era, whatever the schedule holds before it', () => {
    const seg = targetSegments(SCHEDULE, FORK_MS + 5 * DAY, FORK_MS + 6 * DAY, 30);
    expect(seg).toEqual([
      { fromMs: FORK_MS + 5 * DAY, toMs: FORK_MS + 6 * DAY, seconds: 30, fromHeight: 2_020_000 },
    ]);
  });

  it('is one flat segment before the fork', () => {
    const seg = targetSegments(SCHEDULE, FORK_MS - 6 * DAY, FORK_MS - 5 * DAY, 30);
    expect(seg).toEqual([
      { fromMs: FORK_MS - 6 * DAY, toMs: FORK_MS - 5 * DAY, seconds: 120, fromHeight: 0 },
    ]);
  });

  it('holds a target that begins exactly at the start of the window', () => {
    const seg = targetSegments(SCHEDULE, FORK_MS, FORK_MS + DAY, 30);
    expect(seg).toHaveLength(1);
    expect(seg[0]?.seconds).toBe(30);
  });

  it('does not draw a target that starts after the window ends', () => {
    const seg = targetSegments(SCHEDULE, FORK_MS - 2 * DAY, FORK_MS - DAY, 30);
    expect(seg.map((s) => s.seconds)).toEqual([120]);
  });

  it('works from a schedule trimmed to the entries that apply, extending the first back to the window start', () => {
    const trimmed = [SCHEDULE[1]!];
    const seg = targetSegments(trimmed, FORK_MS - 5 * DAY, FORK_MS + 5 * DAY, 30);
    expect(seg).toEqual([
      { fromMs: FORK_MS - 5 * DAY, toMs: FORK_MS + 5 * DAY, seconds: 30, fromHeight: 2_020_000 },
    ]);
  });

  it('puts an unsorted schedule in order, and lets the later of two entries at one instant win', () => {
    const seg = targetSegments(
      [
        { from_height: 100, from_ms: 5_000, seconds: 30 },
        { from_height: 0, from_ms: 0, seconds: 120 },
        { from_height: 100, from_ms: 5_000, seconds: 45 },
      ],
      0,
      10_000,
      30,
    );
    expect(seg.map((s) => [s.fromMs, s.toMs, s.seconds])).toEqual([
      [0, 5_000, 120],
      [5_000, 10_000, 45],
    ]);
  });

  it('ignores an entry that is not a usable target', () => {
    const seg = targetSegments(
      [
        { from_height: 0, from_ms: 0, seconds: 30 },
        { from_height: 5, from_ms: Number.NaN, seconds: 60 },
        { from_height: 6, from_ms: 5_000, seconds: 0 },
        { from_height: 7, from_ms: 6_000, seconds: -10 },
      ],
      0,
      10_000,
      30,
    );
    expect(seg).toEqual([{ fromMs: 0, toMs: 10_000, seconds: 30, fromHeight: 0 }]);
  });

  it('falls back to the current target with no schedule', () => {
    expect(targetSegments([], 0, 1_000, 30)).toEqual([
      { fromMs: 0, toMs: 1_000, seconds: 30, fromHeight: null },
    ]);
  });

  it('draws nothing with no schedule and no target, or with an empty window', () => {
    expect(targetSegments([], 0, 1_000, null)).toEqual([]);
    expect(targetSegments([], 0, 1_000, 0)).toEqual([]);
    expect(targetSegments(SCHEDULE, 1_000, 1_000, 30)).toEqual([]);
    expect(targetSegments(SCHEDULE, 2_000, 1_000, 30)).toEqual([]);
  });
});

describe('the target as a step', () => {
  const seg = targetSegments(SCHEDULE, FORK_MS - DAY, FORK_MS + DAY, 30);

  it('has a corner either side of the jump, at the same instant', () => {
    expect(targetStepPoints(seg)).toEqual([
      { ms: FORK_MS - DAY, seconds: 120 },
      { ms: FORK_MS, seconds: 120 },
      { ms: FORK_MS, seconds: 30 },
      { ms: FORK_MS + DAY, seconds: 30 },
    ]);
  });

  it('is a flat line when the target never changes', () => {
    const flat = targetSegments(SCHEDULE, FORK_MS + DAY, FORK_MS + 2 * DAY, 30);
    expect(targetStepPoints(flat)).toEqual([
      { ms: FORK_MS + DAY, seconds: 30 },
      { ms: FORK_MS + 2 * DAY, seconds: 30 },
    ]);
  });

  it('answers the target at a moment: the one in force, and the nearest at the edges', () => {
    expect(targetAt(seg, FORK_MS - 1)).toBe(120);
    expect(targetAt(seg, FORK_MS)).toBe(30);
    expect(targetAt(seg, FORK_MS + 5 * DAY)).toBe(30);
    expect(targetAt(seg, FORK_MS - 9 * DAY)).toBe(120);
    expect(targetAt([], 5)).toBeNull();
  });

  it('lists where it changes', () => {
    expect(targetChanges(seg)).toEqual([{ ms: FORK_MS, from: 120, to: 30, height: 2_020_000 }]);
    expect(targetChanges(targetSegments(SCHEDULE, FORK_MS + DAY, FORK_MS + 2 * DAY, 30))).toEqual([]);
  });

  it('does not report a change between two segments with the same target', () => {
    const same = targetSegments(
      [
        { from_height: 0, from_ms: 0, seconds: 30 },
        { from_height: 10, from_ms: 500, seconds: 30 },
      ],
      0,
      1_000,
      30,
    );
    expect(targetChanges(same)).toEqual([]);
  });
});

describe('targetStory', () => {
  it('says the one target of a window inside the 30 s era', () => {
    const s = targetStory(SCHEDULE, 2_900_000, 2_999_000, 30);
    expect(s.text).toBe('Target 30 s');
    expect(s.expected).toBe(30);
  });

  it('judges a window across the fork against both targets, weighted by blocks', () => {
    // 20,000 blocks at 120 s, then 80,000 at 30 s.
    const s = targetStory(SCHEDULE, 2_000_000, 2_099_999, 30);
    expect(s.text).toBe('Target 120 s, then 30 s');
    expect(s.expected).toBeCloseTo((20_000 * 120 + 80_000 * 30) / 100_000, 9);
  });

  it('covers the whole chain', () => {
    const s = targetStory(SCHEDULE, 1, 2_999_468, 30);
    expect(s.text).toBe('Target 120 s, then 30 s');
    expect(s.expected).toBeCloseTo((2_019_999 * 120 + 979_469 * 30) / 2_999_468, 9);
  });

  it('counts a window that stops at the fork as 120 s only', () => {
    expect(targetStory(SCHEDULE, 1_000_000, 2_019_999, 30).text).toBe('Target 120 s');
  });

  it('says how many times a longer schedule changed', () => {
    const s = targetStory(
      [
        { from_height: 0, from_ms: 0, seconds: 120 },
        { from_height: 100, from_ms: 1, seconds: 60 },
        { from_height: 200, from_ms: 2, seconds: 30 },
      ],
      0,
      300,
      30,
    );
    expect(s.text).toBe('Target changed 2 times');
  });

  it('falls back to the current target without a schedule or a block range', () => {
    expect(targetStory([], 0, 100, 30)).toEqual({ expected: 30, text: 'Target 30 s' });
    expect(targetStory(SCHEDULE, 100, 50, 30)).toEqual({ expected: 30, text: 'Target 30 s' });
    expect(targetStory([], 0, 100, null)).toEqual({ expected: null, text: '' });
  });
});

describe('paceVsTarget', () => {
  it('is the percent over (slower) or under (faster) the target', () => {
    expect(paceVsTarget(30.6, 30)).toBeCloseTo(2, 9);
    expect(paceVsTarget(27, 30)).toBeCloseTo(-10, 9);
    expect(paceVsTarget(30, 30)).toBe(0);
  });
  it('is null without an average or a target', () => {
    expect(paceVsTarget(null, 30)).toBeNull();
    expect(paceVsTarget(30, null)).toBeNull();
    expect(paceVsTarget(30, 0)).toBeNull();
    expect(paceVsTarget(Number.NaN, 30)).toBeNull();
  });
});

describe('difficultyChange', () => {
  it('is the percent from the first reading to the last', () => {
    expect(difficultyChange([null, 0.4, 0.5, null, 0.44])).toBeCloseTo(10, 9);
    expect(difficultyChange([0.5, 0.4])).toBeCloseTo(-20, 9);
  });
  it('is null without two readings or a first reading of zero', () => {
    expect(difficultyChange([null, 0.4, null])).toBeNull();
    expect(difficultyChange([null, null])).toBeNull();
    expect(difficultyChange([0, 0.4])).toBeNull();
  });
});

describe('percentile', () => {
  it('interpolates between the sorted values and ignores gaps', () => {
    expect(percentile([4, null, 1, 3, 2], 0)).toBe(1);
    expect(percentile([4, null, 1, 3, 2], 1)).toBe(4);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('is null with nothing to rank', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([null, null], 0.5)).toBeNull();
  });
});

describe('blockTimeDomain', () => {
  const steady = Array.from({ length: 700 }, () => 30);

  it('starts at zero and holds the 30 s target with room above it', () => {
    const d = blockTimeDomain(steady, [30]);
    expect(d.lo).toBe(0);
    expect(d.hi).toBeGreaterThanOrEqual(45);
    expect(d.hi).toBeLessThanOrEqual(100);
    expect(d.ticks[0]).toBe(0);
    expect(d.ticks.at(-1)).toBe(d.hi);
  });

  it('holds a skipped slot in full: a 60 s gap on a 30 s chain is inside the chart', () => {
    expect(blockTimeDomain(steady, [30]).hi).toBeGreaterThanOrEqual(60);
  });

  it('is not flattened by one very long gap: the top is the same with or without it', () => {
    const calm = blockTimeDomain(steady, [30]);
    const stalled = [...steady];
    stalled[300] = 7_400;
    expect(blockTimeDomain(stalled, [30])).toEqual(calm);
  });

  it('is not flattened by a handful of long ones either (under 1 percent of the buckets)', () => {
    const calm = blockTimeDomain(steady, [30]);
    const spiky = steady.map((v, i) => (i % 200 === 7 ? 900 : v));
    expect(blockTimeDomain(spiky, [30]).hi).toBe(calm.hi);
  });

  it('opens up for a chain that is genuinely slow', () => {
    const slow = Array.from({ length: 700 }, () => 100);
    expect(blockTimeDomain(slow, [30]).hi).toBeGreaterThanOrEqual(125);
  });

  it('holds the 120 s target of the old chain, when the window reaches back to it', () => {
    const old = Array.from({ length: 700 }, () => 120);
    expect(blockTimeDomain(old, [120, 30]).hi).toBeGreaterThanOrEqual(180);
  });

  it('is judged by the target in force now: a window that has left the old chain behind is not stretched by it', () => {
    const now = blockTimeDomain(steady, [30]);
    // The old target is only in the window as a stretch that has no bucket of its own to hold.
    expect(blockTimeDomain(steady, [30, 30]).hi).toBe(now.hi);
    expect(blockTimeDomain(steady, [120, 30]).hi).toBeGreaterThan(now.hi);
  });

  it('is built from the target alone when there is no data, and has a default with neither', () => {
    expect(blockTimeDomain([null, null], [30]).hi).toBeGreaterThanOrEqual(60);
    expect(blockTimeDomain([], []).hi).toBeGreaterThanOrEqual(60);
  });

  it('puts round values on the ticks', () => {
    const d = blockTimeDomain(steady, [30]);
    for (const tick of d.ticks) expect(tick % d.step).toBe(0);
  });
});

describe('gapBandWorthDrawing', () => {
  it('is for the window whose buckets are short, a day (4 blocks), not a week (28), a month (120) or a year', () => {
    expect(gapBandWorthDrawing(4)).toBe(true);
    expect(gapBandWorthDrawing(12)).toBe(true);
    expect(gapBandWorthDrawing(28)).toBe(false);
    expect(gapBandWorthDrawing(120)).toBe(false);
    expect(gapBandWorthDrawing(1_460)).toBe(false);
    expect(gapBandWorthDrawing(4_200)).toBe(false);
  });
  it('is not drawn when the bucket size is not known', () => {
    expect(gapBandWorthDrawing(null)).toBe(false);
  });
});

describe('spikeMarkers', () => {
  it('marks the buckets above the top of the chart, in time order', () => {
    expect(spikeMarkers([30, 90, 30, 400, 30, 61], 60)).toEqual([1, 3, 5]);
  });

  it('marks nothing when every bucket fits', () => {
    expect(spikeMarkers([30, 45, 50], 60)).toEqual([]);
    expect(spikeMarkers([30, null, 60], 60)).toEqual([]);
  });

  it('keeps only the longest ones when there are more than the limit', () => {
    const tops = [100, 500, 200, 900, 300, 700];
    expect(spikeMarkers(tops, 50, 3)).toEqual([1, 3, 5]);
  });

  it('keeps a mark clear of a longer one next to it', () => {
    // 5 and 6 are neighbours: the shorter of them gives way.
    const tops = [0, 0, 0, 0, 0, 800, 600, 0, 0, 0, 0, 500];
    expect(spikeMarkers(tops, 100, 8, 3)).toEqual([5, 11]);
  });

  it('gives a stretch of clipped buckets a few marks, not a row of them', () => {
    const tops = Array.from({ length: 300 }, (_, i) => 1_000 + (i % 7));
    const marks = spikeMarkers(tops, 200, 6, 12);
    expect(marks.length).toBeLessThanOrEqual(6);
    for (let k = 1; k < marks.length; k++) expect(marks[k]! - marks[k - 1]!).toBeGreaterThanOrEqual(12);
  });

  it('counts the buckets above the top', () => {
    expect(countAbove([30, 90, null, 400, 60], 60)).toBe(2);
  });
});

describe('difficultyDomain', () => {
  it('holds the range with a little room and round ticks', () => {
    const d = difficultyDomain([0.388, 0.4, 0.431]);
    expect(d.lo).toBeLessThanOrEqual(0.388);
    expect(d.hi).toBeGreaterThanOrEqual(0.431);
    expect(d.ticks[0]).toBe(d.lo);
    expect(d.ticks.at(-1)).toBe(d.hi);
  });

  it('puts a flat series mid-chart', () => {
    const d = difficultyDomain([0.312, 0.312, null, 0.312]);
    expect(d.lo).toBeLessThan(0.312);
    expect(d.hi).toBeGreaterThan(0.312);
  });

  it('does not go below zero for a difficulty near it', () => {
    expect(difficultyDomain([0.001, 0.002, 0.004]).lo).toBeGreaterThanOrEqual(0);
  });

  it('is a default axis with no values', () => {
    expect(difficultyDomain([null, null])).toMatchObject({ lo: 0, hi: 1 });
  });
});

describe('formatBlockTime', () => {
  it('shows seconds to a tenth under a hundred', () => {
    expect(formatBlockTime(30)).toBe('30.0 s');
    expect(formatBlockTime(30.44)).toBe('30.4 s');
    expect(formatBlockTime(99.94)).toBe('99.9 s');
  });
  it('shows minutes and hours from a hundred seconds up', () => {
    expect(formatBlockTime(100)).toBe('1m 40s');
    expect(formatBlockTime(124)).toBe('2m 4s');
    expect(formatBlockTime(4_320)).toBe('1h 12m');
  });
  it('says Unknown for a missing value', () => {
    expect(formatBlockTime(null)).toBe('Unknown');
    expect(formatBlockTime(undefined)).toBe('Unknown');
    expect(formatBlockTime(Number.NaN)).toBe('Unknown');
  });
});

describe('formatTargetSeconds and formatTickSeconds', () => {
  it('writes a whole target plainly and keeps a fraction', () => {
    expect(formatTargetSeconds(30)).toBe('30 s');
    expect(formatTargetSeconds(120)).toBe('120 s');
    expect(formatTargetSeconds(7.5)).toBe('7.5 s');
  });
  it('labels an axis in seconds, and in whole minutes from five', () => {
    expect(formatTickSeconds(0)).toBe('0 s');
    expect(formatTickSeconds(150)).toBe('150 s');
    expect(formatTickSeconds(300)).toBe('5 min');
    expect(formatTickSeconds(360)).toBe('6 min');
    expect(formatTickSeconds(330)).toBe('330 s');
  });
});

describe('formatDifficulty', () => {
  it('keeps the digits that mean something at every size', () => {
    expect(formatDifficulty(0.4123)).toBe('0.412');
    expect(formatDifficulty(0.7)).toBe('0.700');
    expect(formatDifficulty(0)).toBe('0.000');
    expect(formatDifficulty(0.001234)).toBe('0.00123');
    expect(formatDifficulty(1.23456)).toBe('1.235');
    expect(formatDifficulty(12.3456)).toBe('12.35');
    expect(formatDifficulty(123.456)).toBe('123.5');
    expect(formatDifficulty(12_345.6)).toBe('12,346');
    expect(formatDifficulty(1_500_000)).toBe('1.5M');
  });
  it('says Unknown, never zero, for a missing value', () => {
    expect(formatDifficulty(null)).toBe('Unknown');
    expect(formatDifficulty(Number.NaN)).toBe('Unknown');
  });
});

describe('formatBucketTime', () => {
  const ms = Date.UTC(2026, 8, 30, 19, 39, 4);
  it('is to the minute in a short window and the day in a long one', () => {
    expect(formatBucketTime(ms, '24h')).toBe('2026-09-30 19:39 UTC');
    expect(formatBucketTime(ms, '30d')).toBe('2026-09-30 19:39 UTC');
    expect(formatBucketTime(ms, '1y')).toBe('2026-09-30 UTC');
    expect(formatBucketTime(ms, 'all')).toBe('2026-09-30 UTC');
  });
});

describe('what one bucket says', () => {
  const frame = chainFrame([
    point({
      t_ms: FORK_MS + 1_000,
      height: 2_020_001,
      difficulty: 0.355898,
      block_time_s: 37.5,
      block_time_max_s: 90,
    }),
    point({
      t_ms: FORK_MS + 2_000,
      height: 2_020_005,
      difficulty: null,
      block_time_s: 30,
      block_time_max_s: null,
    }),
    point({
      t_ms: FORK_MS + 3_000,
      height: 2_020_009,
      difficulty: 0.36,
      block_time_s: 60,
      block_time_max_s: 330,
    }),
  ]);
  const ctx = {
    window: '24h' as const,
    segments: targetSegments(SCHEDULE, FORK_MS, FORK_MS + DAY, 30),
    cap: 60,
  };

  it('formats the four facts, the longest gap and the target', () => {
    expect(pointFacts(frame, 0, ctx)).toEqual({
      time: '2025-09-15 12:18 UTC',
      height: '2,020,001',
      difficulty: '0.356',
      blockTime: '37.5 s',
      longest: '90.0 s',
      offChart: true,
      target: '30 s',
    });
  });

  it('leaves out the longest gap the server did not give, and says Unknown for a missing difficulty', () => {
    const f = pointFacts(frame, 1, ctx);
    expect(f?.longest).toBeNull();
    expect(f?.difficulty).toBe('Unknown');
    expect(f?.offChart).toBe(false);
  });

  it('says when a gap is above the top of the chart', () => {
    expect(pointFacts(frame, 2, ctx)?.offChart).toBe(true);
    expect(pointFacts(frame, 2, { ...ctx, cap: 400 })?.offChart).toBe(false);
  });

  it('has no target without a schedule', () => {
    expect(pointFacts(frame, 0, { ...ctx, segments: [] })?.target).toBeNull();
  });

  it('is null for a bucket that does not exist', () => {
    expect(pointFacts(frame, 9, ctx)).toBeNull();
  });

  it('reads out all four facts for a screen reader', () => {
    const f = pointFacts(frame, 0, ctx);
    expect(f && pointReading(f)).toBe(
      '2025-09-15 12:18 UTC, block 2,020,001: difficulty 0.356, block time 37.5 s, longest gap 90.0 s (above the chart)',
    );
    const g = pointFacts(frame, 1, ctx);
    expect(g && pointReading(g)).toBe(
      '2025-09-15 12:18 UTC, block 2,020,005: difficulty Unknown, block time 30.0 s',
    );
  });
});

describe('the chart summaries', () => {
  it('says where the difficulty went, and its range', () => {
    expect(difficultySummary([0.351, null, 0.371, 0.341, 0.356])).toBe(
      'From 0.351 to 0.356, up 1.4%. Low 0.341, high 0.371.',
    );
    expect(difficultySummary([0.4, 0.3])).toBe('From 0.400 to 0.300, down 25.0%. Low 0.300, high 0.400.');
  });

  it('says so when the difficulty did not move, had one reading, or was not recorded', () => {
    expect(difficultySummary([0.312, 0.312, 0.312])).toBe('Flat at 0.312. Low 0.312, high 0.312.');
    expect(difficultySummary([null, 0.4, null])).toBe('Only one reading, 0.400.');
    expect(difficultySummary([null, null])).toBe('No difficulty recorded for this window.');
    expect(difficultySummary([])).toBe('No difficulty recorded for this window.');
  });

  const input = (over: Partial<BlockTimeSummaryInput> = {}): BlockTimeSummaryInput => ({
    avg: 30.4,
    target: 'Target 30 s',
    longest: 330,
    above: 2,
    ...over,
  });

  it('gives the average, the target, the longest gap and what ran off the chart', () => {
    expect(blockTimeSummary(input())).toBe(
      'Averages 30.4 s. Target 30 s. Longest gap 5m 30s; 2 buckets run off the top of the chart.',
    );
  });

  it('says one bucket, in the singular', () => {
    expect(blockTimeSummary(input({ above: 1 }))).toContain('1 bucket runs off the top');
  });

  it('is shorter when nothing ran off the chart, and says so when the server gave no longest gap or average', () => {
    expect(blockTimeSummary(input({ above: 0 }))).toBe('Averages 30.4 s. Target 30 s. Longest gap 5m 30s.');
    expect(blockTimeSummary(input({ longest: null, above: 0 }))).toBe('Averages 30.4 s. Target 30 s.');
    expect(blockTimeSummary(input({ avg: null, target: '', longest: null, above: 0 }))).toBe(
      'No average block time for this window.',
    );
  });
});

describe('indexing', () => {
  it('says how far the server has read, rounded, while it is still reading', () => {
    const c = { complete: false, indexed_from_height: 1_750_000, percent: 41.6 };
    expect(indexingPercent(c)).toBe(42);
    expect(indexingText(c)).toBe('Indexing chain history: 42%');
  });

  it('never says 100 percent before it is complete', () => {
    expect(indexingPercent({ complete: false, indexed_from_height: 5, percent: 99.7 })).toBe(99);
    expect(indexingPercent({ complete: false, indexed_from_height: 5, percent: 140 })).toBe(99);
  });

  it('starts at zero, and reads a bad percent as zero', () => {
    expect(indexingText({ complete: false, indexed_from_height: null, percent: 0 })).toBe(
      'Indexing chain history: 0%',
    );
    expect(indexingPercent({ complete: false, indexed_from_height: null, percent: Number.NaN })).toBe(0);
    expect(indexingPercent({ complete: false, indexed_from_height: null, percent: -5 })).toBe(0);
  });

  it('is silent once complete, or before the first answer', () => {
    expect(indexingText({ complete: true, indexed_from_height: 0, percent: 100 })).toBeNull();
    expect(indexingText(undefined)).toBeNull();
    expect(indexingText(null)).toBeNull();
  });
});

describe('isChainWindow', () => {
  it('accepts the five windows and nothing else', () => {
    for (const w of ['24h', '7d', '30d', '1y', 'all']) expect(isChainWindow(w)).toBe(true);
    for (const w of ['1h', '24H', '', null, undefined, 7]) expect(isChainWindow(w)).toBe(false);
  });
});

describe('timeDomain', () => {
  it('is the window, widened to hold every bucket', () => {
    expect(timeDomain(1_000, 5_000, [2_000, 3_000])).toEqual([1_000, 5_000]);
    expect(timeDomain(1_000, 5_000, [500, 6_000])).toEqual([500, 6_000]);
  });
  it('is the buckets alone when the window is not a number', () => {
    expect(timeDomain(Number.NaN, Number.NaN, [2_000, 3_000])).toEqual([2_000, 3_000]);
  });
  it('gives a lone bucket a width, and no buckets at all a default', () => {
    expect(timeDomain(Number.NaN, Number.NaN, [100_000])).toEqual([70_000, 130_000]);
    expect(timeDomain(Number.NaN, Number.NaN, [])).toEqual([0, 1]);
  });
});

describe('chainModel', () => {
  const dto = (over: Partial<ChainHistoryDto> = {}): ChainHistoryDto => ({
    window: '24h',
    from_ms: FORK_MS,
    to_ms: FORK_MS + DAY,
    from_height: 2_100_000,
    to_height: 2_102_880,
    block_count: 2_881,
    avg_block_time_s: 30.4,
    latest_height: 2_102_880,
    latest_difficulty: 0.355,
    target_block_time_s: 30,
    targets: SCHEDULE,
    points: [
      point({ t_ms: FORK_MS + 1 * DAY * 0.25, block_time_s: 30, block_time_max_s: 60 }),
      point({ t_ms: FORK_MS + 1 * DAY * 0.5, block_time_s: 37.5, block_time_max_s: 400 }),
      point({ t_ms: FORK_MS + 1 * DAY * 0.75, block_time_s: 30, block_time_max_s: 30 }),
    ],
    coverage: { complete: true, indexed_from_height: 0, percent: 100 },
    ...over,
  });

  it('puts the window, the buckets, the target and both axes together', () => {
    const m = chainModel(dto());
    expect(m.window).toBe('24h');
    expect(m.frame.t).toHaveLength(3);
    expect(m.domain).toEqual([FORK_MS, FORK_MS + DAY]);
    expect(m.segments.map((s) => s.seconds)).toEqual([30]);
    expect(m.changes).toEqual([]);
    expect(m.blockTime.lo).toBe(0);
    expect(m.blockTime.hi).toBeGreaterThanOrEqual(45);
    expect(m.story.text).toBe('Target 30 s');
  });

  it('reads a window it does not know as the one that was asked for', () => {
    expect(chainModel(dto({ window: '90d' }), '30d').window).toBe('30d');
    expect(chainModel(dto({ window: '' })).window).toBe('7d');
    expect(chainModel(dto({ window: '1y' }), '30d').window).toBe('1y');
  });

  it('counts the bucket whose longest gap runs off the top of the chart', () => {
    const m = chainModel(dto());
    expect(m.reach).toEqual([60, 400, 30]);
    expect(m.above).toBe(1);
    expect(m.summary.blockTime).toContain('Longest gap 6m 40s');
    expect(m.summary.blockTime).toContain('1 bucket runs off the top of the chart');
  });

  it('knows how many blocks a bucket holds', () => {
    expect(chainModel(dto()).perBucket).toBe(2_881 / 3);
    expect(chainModel(dto({ points: [] })).perBucket).toBeNull();
    expect(chainModel(dto({ block_count: 0 })).perBucket).toBeNull();
  });

  it('draws the step where a longer window crosses the fork', () => {
    const m = chainModel(
      dto({
        window: '1y',
        from_ms: FORK_MS - 25 * DAY,
        to_ms: FORK_MS + 340 * DAY,
        from_height: 1_950_000,
        to_height: 2_999_000,
      }),
    );
    expect(m.segments.map((s) => s.seconds)).toEqual([120, 30]);
    expect(m.changes).toHaveLength(1);
    expect(m.story.text).toBe('Target 120 s, then 30 s');
    // The axis holds the old, slower target.
    expect(m.blockTime.hi).toBeGreaterThanOrEqual(180);
  });

  it('is empty, not broken, with no points: the axes and the window stay', () => {
    const m = chainModel(
      dto({ points: [], coverage: { complete: false, indexed_from_height: null, percent: 0 } }),
    );
    expect(m.frame.t).toEqual([]);
    expect(m.domain).toEqual([FORK_MS, FORK_MS + DAY]);
    expect(m.above).toBe(0);
    expect(m.summary.difficulty).toBe('No difficulty recorded for this window.');
  });

  it('copes with a bucket missing every value', () => {
    const m = chainModel(
      dto({
        points: [point({ difficulty: null, block_time_s: null, block_time_max_s: null })],
        avg_block_time_s: null,
      }),
    );
    expect(m.reach).toEqual([null]);
    expect(m.summary.blockTime).toBe('No average block time for this window. Target 30 s.');
  });
});

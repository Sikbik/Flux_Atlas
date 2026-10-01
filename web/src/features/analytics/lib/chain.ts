// The Chain tab's data shaping: what the server's chain history becomes before anything is drawn. A
// bucket of history is clean (a value the server could not work out is null, never zero), the block
// time target is a step line that changes where the chain's rules did, the time-per-block axis is set by
// the typical block and the target (so one very long gap never flattens the rest and longer gaps are
// marked instead), and every number and sentence the tab shows is formatted here. Pure: no DOM, no React.

import { formatDuration, formatInt, formatUtcDateTime, UNKNOWN } from '../../../lib/format';
import { niceTicks } from '../viz/scale';
import type {
  BlockTimeTargetDto,
  ChainCoverageDto,
  ChainHistoryDto,
  ChainPointDto,
  ChainWindow,
} from './chainTypes';

export type { ChainWindow } from './chainTypes';

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

export const CHAIN_WINDOWS = ['24h', '7d', '30d', '1y', 'all'] as const satisfies readonly ChainWindow[];

export interface WindowText {
  /** The label of the selector. */
  short: string;
  /** The period a change is measured over (a `Delta`'s period): `7 days`. */
  period: string;
  /** Fits after "over": `over the last 7 days`, `over all time`. */
  phrase: string;
  /** The label of the block count tile. */
  blocks: string;
}

export const WINDOW_TEXT: Record<ChainWindow, WindowText> = {
  '24h': { short: '24H', period: '24 hours', phrase: 'the last 24 hours', blocks: 'Blocks in 24 hours' },
  '7d': { short: '7D', period: '7 days', phrase: 'the last 7 days', blocks: 'Blocks in 7 days' },
  '30d': { short: '30D', period: '30 days', phrase: 'the last 30 days', blocks: 'Blocks in 30 days' },
  '1y': { short: '1Y', period: '1 year', phrase: 'the last year', blocks: 'Blocks in a year' },
  all: { short: 'All', period: 'all time', phrase: 'all time', blocks: 'Blocks, all time' },
};

export function isChainWindow(v: unknown): v is ChainWindow {
  return typeof v === 'string' && (CHAIN_WINDOWS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------------------------
// Buckets of history
// ---------------------------------------------------------------------------------------------

/** The history in columns, one entry per bucket. Null is unknown, never zero. */
export interface ChainFrame {
  /** Unix ms of each bucket, ascending. */
  t: number[];
  height: (number | null)[];
  difficulty: (number | null)[];
  /** Mean seconds per block across the bucket. */
  blockTime: (number | null)[];
  /** The longest single gap in the bucket. */
  blockMax: (number | null)[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: number | null | undefined): number | null => (finite(v) ? v : null);
/** A duration cannot be negative: a block stamped before its parent leaves its bucket without a value. */
const duration = (v: number | null | undefined): number | null => (finite(v) && v >= 0 ? v : null);

/**
 * The server's points as columns. A point without a usable time is dropped; the rest are put in time
 * order if they are not; a value that is missing, not a number or (for a duration) negative is null.
 */
export function chainFrame(points: readonly ChainPointDto[]): ChainFrame {
  const rows = points.filter((p) => finite(p.t_ms));
  let ordered = rows;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.t_ms < rows[i - 1]!.t_ms) {
      ordered = [...rows].sort((a, b) => a.t_ms - b.t_ms);
      break;
    }
  }
  return {
    t: ordered.map((p) => p.t_ms),
    height: ordered.map((p) => orNull(p.height)),
    difficulty: ordered.map((p) => orNull(p.difficulty)),
    blockTime: ordered.map((p) => duration(p.block_time_s)),
    blockMax: ordered.map((p) => duration(p.block_time_max_s)),
  };
}

/** True when at least one bucket has this metric. */
export function hasValues(values: readonly (number | null)[]): boolean {
  return values.some(finite);
}

/**
 * The top of the longest-gap band in each bucket: the longest gap, never below the bucket's mean (a
 * server rounding can put them the wrong way round). Null where the longest gap is unknown.
 */
export function gapCeiling(frame: Pick<ChainFrame, 'blockTime' | 'blockMax'>): (number | null)[] {
  return frame.blockMax.map((m, i) => {
    if (m === null) return null;
    const mean = frame.blockTime[i];
    return mean === null || mean === undefined ? m : Math.max(m, mean);
  });
}

/**
 * How far each bucket reaches up the time axis: its longest gap or its mean, whichever is longer. This is
 * what decides whether a bucket runs off the top of the chart.
 */
export function gapReach(frame: Pick<ChainFrame, 'blockTime' | 'blockMax'>): (number | null)[] {
  return frame.blockTime.map((mean, i) => {
    const m = frame.blockMax[i] ?? null;
    if (m === null) return mean;
    return mean === null ? m : Math.max(mean, m);
  });
}

/** Index of the last bucket with a value, or -1. */
export function lastKnown(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (finite(values[i])) return i;
  return -1;
}

/** Index of the first bucket with a value, or -1. */
export function firstKnown(values: readonly (number | null)[]): number {
  for (let i = 0; i < values.length; i++) if (finite(values[i])) return i;
  return -1;
}

/** Index of the timestamp nearest to `target` (binary search; `t` ascending), or -1 when there are none. */
export function nearestIndex(t: readonly number[], target: number): number {
  if (t.length === 0) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= target) lo = mid;
    else hi = mid;
  }
  return Math.abs(t[lo]! - target) <= Math.abs(t[hi]! - target) ? lo : hi;
}

// ---------------------------------------------------------------------------------------------
// The block time target: a step line
// ---------------------------------------------------------------------------------------------

/** One stretch of the window with one target. */
export interface TargetSegment {
  fromMs: number;
  toMs: number;
  seconds: number;
  /** The height the target took effect at, when the schedule says. */
  fromHeight: number | null;
}

/**
 * The target schedule cut to a window: one segment per target in force between `fromMs` and `toMs`,
 * in order, each ending where the next begins. A schedule that starts after the window does (it does
 * not reach back) has its first target extended back to the window's start. With no schedule the
 * current target holds for the whole window; with neither there is no target to draw.
 */
export function targetSegments(
  targets: readonly BlockTimeTargetDto[],
  fromMs: number,
  toMs: number,
  fallbackSeconds: number | null | undefined,
): TargetSegment[] {
  if (!finite(fromMs) || !finite(toMs) || toMs <= fromMs) return [];
  const clean = targets
    .filter((x) => finite(x.from_ms) && finite(x.seconds) && x.seconds > 0)
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.from_ms - b.from_ms || a.i - b.i);
  // Two entries at one instant: the later one wins.
  const steps = clean.filter((x, k) => clean[k + 1]?.from_ms !== x.from_ms);
  if (steps.length === 0) {
    return finite(fallbackSeconds) && fallbackSeconds > 0
      ? [{ fromMs, toMs, seconds: fallbackSeconds, fromHeight: null }]
      : [];
  }
  let first = 0;
  for (let k = 0; k < steps.length; k++) if (steps[k]!.from_ms <= fromMs) first = k;
  const out: TargetSegment[] = [];
  for (let k = first; k < steps.length; k++) {
    const s = steps[k]!;
    const start = k === first ? fromMs : s.from_ms;
    if (start >= toMs) break;
    const next = steps[k + 1];
    const end = next ? Math.min(next.from_ms, toMs) : toMs;
    if (end > start) {
      out.push({ fromMs: start, toMs: end, seconds: s.seconds, fromHeight: orNull(s.from_height) });
    }
  }
  return out;
}

/** The corners of the step line, left to right: a flat run per segment and a vertical jump between two. */
export function targetStepPoints(segments: readonly TargetSegment[]): { ms: number; seconds: number }[] {
  const out: { ms: number; seconds: number }[] = [];
  for (const s of segments) {
    out.push({ ms: s.fromMs, seconds: s.seconds }, { ms: s.toMs, seconds: s.seconds });
  }
  return out;
}

/** The target in force at `ms` (the first segment's before the window, the last one's after it), or null. */
export function targetAt(segments: readonly TargetSegment[], ms: number): number | null {
  if (segments.length === 0) return null;
  let found = segments[0]!;
  for (const s of segments) if (s.fromMs <= ms) found = s;
  return found.seconds;
}

export interface TargetChange {
  /** When the target changed. */
  ms: number;
  from: number;
  to: number;
  /** The height it changed at, when the schedule says. */
  height: number | null;
}

/** Where the target changes inside the window. */
export function targetChanges(segments: readonly TargetSegment[]): TargetChange[] {
  const out: TargetChange[] = [];
  for (let k = 1; k < segments.length; k++) {
    const a = segments[k - 1]!;
    const b = segments[k]!;
    if (a.seconds !== b.seconds)
      out.push({ ms: b.fromMs, from: a.seconds, to: b.seconds, height: b.fromHeight });
  }
  return out;
}

export interface TargetStory {
  /** The target the window's blocks should average: each block counts at the target in force at its height. */
  expected: number | null;
  /** One line for the tile: `Target 30 s`, or `Target 120 s, then 30 s`. */
  text: string;
}

/**
 * What the blocks of a window should have averaged, weighted by how many blocks each target covered,
 * and a line saying so. The 30 s target applies from the Proof of Node fork and 120 s before it, so a
 * window across the fork is judged against both, not against today's target alone.
 */
export function targetStory(
  targets: readonly BlockTimeTargetDto[],
  fromHeight: number,
  toHeight: number,
  fallbackSeconds: number | null | undefined,
): TargetStory {
  const steps = targets
    .filter((x) => finite(x.from_height) && finite(x.seconds) && x.seconds > 0)
    .sort((a, b) => a.from_height - b.from_height);
  const flat = finite(fallbackSeconds) && fallbackSeconds > 0 ? fallbackSeconds : null;
  const lines = (seconds: number) => `Target ${formatTargetSeconds(seconds)}`;
  if (steps.length === 0 || !finite(fromHeight) || !finite(toHeight) || toHeight < fromHeight) {
    return { expected: flat, text: flat === null ? '' : lines(flat) };
  }
  let weighted = 0;
  let blocks = 0;
  const seen: number[] = [];
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]!;
    const next = steps[k + 1];
    const lo = Math.max(fromHeight, s.from_height);
    const hi = Math.min(toHeight, next ? next.from_height - 1 : toHeight);
    if (hi < lo) continue;
    const n = hi - lo + 1;
    weighted += n * s.seconds;
    blocks += n;
    if (seen.at(-1) !== s.seconds) seen.push(s.seconds);
  }
  if (blocks === 0) return { expected: flat, text: flat === null ? '' : lines(flat) };
  const expected = weighted / blocks;
  if (seen.length === 1) return { expected, text: lines(seen[0]!) };
  if (seen.length === 2) {
    return {
      expected,
      text: `Target ${formatTargetSeconds(seen[0]!)}, then ${formatTargetSeconds(seen[1]!)}`,
    };
  }
  return { expected, text: `Target changed ${seen.length - 1} times` };
}

/** How much the difficulty moved from the first reading of the window to the last, in percent, or null. */
export function difficultyChange(values: readonly (number | null)[]): number | null {
  const a = firstKnown(values);
  const b = lastKnown(values);
  if (a < 0 || a === b) return null;
  const first = values[a]!;
  return first === 0 ? null : (values[b]! / first - 1) * 100;
}

/** How far the average is from what it should be, in percent (positive: slower than the target). */
export function paceVsTarget(
  avg: number | null | undefined,
  expected: number | null | undefined,
): number | null {
  if (!finite(avg) || !finite(expected) || expected <= 0) return null;
  return (avg / expected - 1) * 100;
}

// ---------------------------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------------------------

/** An axis: its extent, and the round values that carry a gridline and a label. */
export interface AxisDomain {
  lo: number;
  hi: number;
  ticks: number[];
  step: number;
}

/** The value `p` (0 to 1) of the way up the sorted values, or null with none. */
export function percentile(values: readonly (number | null | undefined)[], p: number): number | null {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const at = (v.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return v[lo]! + (v[hi]! - v[lo]!) * (at - lo);
}

/**
 * The difficulty axis: the range of the values with a little room, round ticks, never below zero. A flat
 * series gets room either side so it draws mid-chart rather than on an edge.
 */
export function difficultyDomain(values: readonly (number | null)[], tickCount = 4): AxisDomain {
  const v = values.filter(finite);
  if (v.length === 0) return { lo: 0, hi: 1, ticks: [0, 0.5, 1], step: 0.5 };
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min;
  const pad = span > 0 ? span * 0.08 : Math.abs(max) * 0.05 || 1;
  const lo = min >= 0 ? Math.max(0, min - pad) : min - pad;
  const t = niceTicks(lo, max + pad, tickCount);
  return { lo: t.min, hi: t.max, ticks: t.ticks, step: t.step };
}

/**
 * The room the time per block axis gives, as multiples: above the target in force at the end of the
 * window (two slots of it, so a skipped slot, a 60 s gap on a 30 s chain, is in the chart in full), above
 * the slowest earlier target (the old 120 s chain), and above the typical bucket.
 */
const CURRENT_ROOM = 2.5;
const EARLIER_ROOM = 1.5;
const TYPICAL_ROOM = 1.25;
/** The share of buckets the top of the axis must hold. */
const TYPICAL_PERCENTILE = 0.99;

/**
 * The time per block axis, from zero. Its top is set by the targets and the typical bucket (the mean
 * block time to a high percentile), not by the longest gap in the window: one stalled hour would
 * otherwise squash the thirty-second band into the floor. A gap above the top is clipped there, and
 * `spikeMarkers` flags the worst of them. `targets` are the seconds of each target in the window, in time
 * order, so the last is the one in force now.
 */
export function blockTimeDomain(
  means: readonly (number | null)[],
  targets: readonly number[],
  tickCount = 4,
): AxisDomain {
  const valid = targets.filter((x) => finite(x) && x > 0);
  const current = valid.at(-1) ?? 0;
  const slowest = Math.max(0, ...valid);
  const typical = percentile(means, TYPICAL_PERCENTILE) ?? 0;
  const top = Math.max(CURRENT_ROOM * current, EARLIER_ROOM * slowest, TYPICAL_ROOM * typical);
  const t = niceTicks(0, top > 0 ? top : 60, tickCount);
  return { lo: 0, hi: t.max, ticks: t.ticks, step: t.step };
}

/**
 * Over this many blocks (six minutes of the chain) a bucket is wide enough that its longest gap is long
 * whatever the chain did: the more blocks, the longer the longest. Drawing that for every bucket says
 * nothing and fills the chart with a barcode, so such a window marks only the gaps that run off the top.
 */
export const BAND_MAX_PER_BUCKET = 12;

/** Whether the longest gap of every bucket is worth a band behind the line: only where a bucket is short. */
export function gapBandWorthDrawing(perBucket: number | null): boolean {
  return perBucket !== null && perBucket <= BAND_MAX_PER_BUCKET;
}

/**
 * The buckets whose gap runs off the top of the axis that deserve a marker: the longest first, at most
 * `limit`, none within `minGap` buckets of a longer one, so a stretch of clipped buckets (the old, slower
 * chain) gets a few marks for its worst gaps rather than a row of them. Returned in time order.
 */
export function spikeMarkers(tops: readonly (number | null)[], cap: number, limit = 8, minGap = 1): number[] {
  const over = tops
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => finite(x.v) && x.v > cap)
    .sort((a, b) => b.v - a.v || a.i - b.i);
  const picked: number[] = [];
  for (const x of over) {
    if (picked.length >= limit) break;
    if (picked.every((j) => Math.abs(j - x.i) >= minGap)) picked.push(x.i);
  }
  return picked.sort((a, b) => a - b);
}

/** How many buckets run off the top of the axis. */
export function countAbove(tops: readonly (number | null)[], cap: number): number {
  let n = 0;
  for (const v of tops) if (finite(v) && v > cap) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Numbers for people
// ---------------------------------------------------------------------------------------------

/** `30` -> `30 s`; the fraction stays when there is one (`7.5 s`). */
export function formatTargetSeconds(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(1))} s`;
}

/** Seconds per block: `30.4 s`, then minutes and hours from a hundred seconds up (`2m 4s`, `1h 12m`). */
export function formatBlockTime(seconds: number | null | undefined): string {
  if (!finite(seconds)) return UNKNOWN;
  if (seconds < 100) return `${seconds.toFixed(1)} s`;
  return formatDuration(seconds * 1000);
}

/** A tick on the time per block axis: `30 s`, and whole minutes from five up (`5 min`). */
export function formatTickSeconds(seconds: number): string {
  return seconds >= 300 && seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.round(seconds)} s`;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

/** Difficulty with the digits that mean something: `0.412`, `12.35`, `1,234`, `1.5M`. */
export function formatDifficulty(d: number | null | undefined): string {
  if (!finite(d)) return UNKNOWN;
  const a = Math.abs(d);
  if (a >= 1e6) return compact.format(d);
  if (a >= 1000) return formatInt(Math.round(d));
  if (a >= 100) return d.toFixed(1);
  if (a >= 10) return d.toFixed(2);
  if (a >= 0.01 || a === 0) return d.toFixed(3);
  return d.toPrecision(3);
}

/** The time of a bucket: to the minute in a short window, the day in a long one (a bucket there is days wide). */
export function formatBucketTime(ms: number, window: ChainWindow): string {
  if (!finite(ms)) return UNKNOWN;
  return window === '1y' || window === 'all'
    ? `${new Date(ms).toISOString().slice(0, 10)} UTC`
    : formatUtcDateTime(ms);
}

// ---------------------------------------------------------------------------------------------
// One bucket in words
// ---------------------------------------------------------------------------------------------

export interface PointFacts {
  time: string;
  height: string;
  difficulty: string;
  /** The mean block time of the bucket. */
  blockTime: string;
  /** The longest gap, or null where the server did not say. */
  longest: string | null;
  /** True when the longest gap, or the mean, is above the top of the chart. */
  offChart: boolean;
  /** The target in force then, or null with no schedule. */
  target: string | null;
}

export interface FactsContext {
  window: ChainWindow;
  segments: readonly TargetSegment[];
  /** The top of the time per block axis. */
  cap: number;
}

/** What a bucket says, formatted: the tooltip, the screen reader's reading and the data table all use it. */
export function pointFacts(frame: ChainFrame, i: number, ctx: FactsContext): PointFacts | null {
  const t = frame.t[i];
  if (t === undefined) return null;
  const mean = frame.blockTime[i] ?? null;
  const max = frame.blockMax[i] ?? null;
  const top = max === null ? mean : mean === null ? max : Math.max(max, mean);
  const target = targetAt(ctx.segments, t);
  return {
    time: formatBucketTime(t, ctx.window),
    height: formatInt(frame.height[i] ?? null),
    difficulty: formatDifficulty(frame.difficulty[i]),
    blockTime: formatBlockTime(mean),
    longest: max === null ? null : formatBlockTime(top),
    offChart: top !== null && top > ctx.cap,
    target: target === null ? null : formatTargetSeconds(target),
  };
}

/** The reading a screen reader gets for one bucket of either chart: all four facts. */
export function pointReading(f: PointFacts): string {
  return `${f.time}, block ${f.height}: difficulty ${f.difficulty}, block time ${f.blockTime}${
    f.longest === null ? '' : `, longest gap ${f.longest}${f.offChart ? ' (above the chart)' : ''}`
  }`;
}

// ---------------------------------------------------------------------------------------------
// The chart summaries (visible under each chart, and what a screen reader hears about it)
// ---------------------------------------------------------------------------------------------

const direction = (change: number): string => (change > 0 ? 'up' : 'down');

/** `From 0.351 to 0.356, up 1.4%. Low 0.341, high 0.371.` */
export function difficultySummary(values: readonly (number | null)[]): string {
  const a = firstKnown(values);
  const b = lastKnown(values);
  if (a < 0) return 'No difficulty recorded for this window.';
  const first = values[a]!;
  const last = values[b]!;
  const known = values.filter(finite);
  const low = Math.min(...known);
  const high = Math.max(...known);
  if (a === b) return `Only one reading, ${formatDifficulty(last)}.`;
  const change = last - first;
  const rel = first !== 0 ? Math.abs(change / first) * 100 : null;
  const trend =
    change === 0 || (rel !== null && Number(rel.toFixed(1)) === 0)
      ? `Flat at ${formatDifficulty(last)}.`
      : `From ${formatDifficulty(first)} to ${formatDifficulty(last)}, ${direction(change)}${rel === null ? '' : ` ${rel.toFixed(1)}%`}.`;
  return `${trend} Low ${formatDifficulty(low)}, high ${formatDifficulty(high)}.`;
}

export interface BlockTimeSummaryInput {
  avg: number | null;
  /** `Target 30 s` and friends, from `targetStory`. */
  target: string;
  /** The longest single gap in the window, when the server said. */
  longest: number | null;
  /** How many buckets run off the top of the chart. */
  above: number;
}

/** `Averages 30.4 s. Target 30 s. Longest gap 5m 30s; 2 buckets run off the top of the chart.` */
export function blockTimeSummary(s: BlockTimeSummaryInput): string {
  const parts: string[] = [];
  parts.push(
    s.avg === null ? 'No average block time for this window.' : `Averages ${formatBlockTime(s.avg)}.`,
  );
  if (s.target) parts.push(`${s.target}.`);
  const tail: string[] = [];
  if (s.longest !== null) tail.push(`Longest gap ${formatBlockTime(s.longest)}`);
  if (s.above > 0)
    tail.push(
      `${formatInt(s.above)} ${s.above === 1 ? 'bucket runs' : 'buckets run'} off the top of the chart`,
    );
  if (tail.length > 0) parts.push(`${tail.join('; ')}.`);
  return parts.join(' ');
}

/** The largest value of a column, or null. */
export function maxOf(values: readonly (number | null)[]): number | null {
  let m: number | null = null;
  for (const v of values) if (finite(v) && (m === null || v > m)) m = v;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------------------------

/** The share of the chain read so far while the server is still reading it (never 100), else null. */
export function indexingPercent(c: ChainCoverageDto | null | undefined): number | null {
  if (!c || c.complete) return null;
  const p = finite(c.percent) ? Math.min(100, Math.max(0, c.percent)) : 0;
  return Math.min(99, Math.round(p));
}

/** `Indexing chain history: 42%`, or null once the whole chain is read. */
export function indexingText(c: ChainCoverageDto | null | undefined): string | null {
  const p = indexingPercent(c);
  return p === null ? null : `Indexing chain history: ${p}%`;
}

// ---------------------------------------------------------------------------------------------
// Everything the tab draws, from one answer of the server
// ---------------------------------------------------------------------------------------------

export interface ChainModel {
  window: ChainWindow;
  frame: ChainFrame;
  /** The time axis, unix ms: the window's, widened to hold every bucket. */
  domain: [number, number];
  /** The target as flat stretches, one per target in force. */
  segments: TargetSegment[];
  changes: TargetChange[];
  difficulty: AxisDomain;
  blockTime: AxisDomain;
  /** What each bucket reaches up the time axis (see `gapReach`). */
  reach: (number | null)[];
  /** How many blocks one bucket holds, on average: 4 in a day, thousands over the chain's life. */
  perBucket: number | null;
  /** How many buckets run off the top of the time axis. */
  above: number;
  story: TargetStory;
  /** One sentence for each chart. */
  summary: { difficulty: string; blockTime: string };
}

/** The time axis: the window the server answered for, widened to hold every bucket, or the buckets alone. */
export function timeDomain(fromMs: number, toMs: number, t: readonly number[]): [number, number] {
  let lo = finite(fromMs) ? fromMs : Number.POSITIVE_INFINITY;
  let hi = finite(toMs) ? toMs : Number.NEGATIVE_INFINITY;
  if (t.length > 0) {
    lo = Math.min(lo, t[0]!);
    hi = Math.max(hi, t[t.length - 1]!);
  }
  if (!finite(lo) || !finite(hi)) return [0, 1];
  // One bucket, or none: give the axis a width so a single point draws mid-chart.
  return hi > lo ? [lo, hi] : [lo - 30_000, hi + 30_000];
}

/**
 * Everything the two charts and the four tiles draw, from one answer. The answer names its own window; one
 * the tab does not know (a newer server) is read as the window `asked` for.
 */
export function chainModel(dto: ChainHistoryDto, asked: ChainWindow = '7d'): ChainModel {
  const frame = chainFrame(dto.points);
  const domain = timeDomain(dto.from_ms, dto.to_ms, frame.t);
  const segments = targetSegments(dto.targets, domain[0], domain[1], dto.target_block_time_s);
  const blockTime = blockTimeDomain(
    frame.blockTime,
    segments.map((s) => s.seconds),
  );
  const reach = gapReach(frame);
  const above = countAbove(reach, blockTime.hi);
  const perBucket =
    frame.t.length > 0 && finite(dto.block_count) && dto.block_count > 0
      ? dto.block_count / frame.t.length
      : null;
  const story = targetStory(dto.targets, dto.from_height, dto.to_height, dto.target_block_time_s);
  return {
    window: isChainWindow(dto.window) ? dto.window : asked,
    frame,
    domain,
    segments,
    changes: targetChanges(segments),
    difficulty: difficultyDomain(frame.difficulty),
    blockTime,
    reach,
    perBucket,
    above,
    story,
    summary: {
      difficulty: difficultySummary(frame.difficulty),
      blockTime: blockTimeSummary({
        avg: orNull(dto.avg_block_time_s),
        target: story.text,
        longest: maxOf(frame.blockMax),
        above,
      }),
    },
  };
}

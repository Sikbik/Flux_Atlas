// The chain's daily figures, shaped for the landing's charts: which figures there are and how each reads, one
// series out of the daily payload, the linear or log scale a series deserves, a tile's headline and change, the
// sentence that names a chart for a screen reader, and the footnote on the mining years. Pure.
//
// What the payload means (the contract of `GET /chain/daily`): the counters of a day are for that UTC day; the last
// row is the day so far, so its counters are low and it is drawn as partial, never as a day; `fees` is Insight's
// average fee per block, so the day's fees are `fees_total`; `outputs` is an amount of FLUX moved, not a count;
// `supply` is transparent plus shielded; and `difficulty` and `network_hash` stopped measuring mining work with
// Proof of Node, so they are not charts here, only a footnote. `days=all` is two years, not the chain's whole life.

import type { ChainDailyDto } from '../../../../api/generated/ChainDailyDto';
import type { ChainDay } from '../../../../api/generated/ChainDay';
import { formatCompact, formatInt } from '../../../../lib/format';
import { formatDifficulty, formatLogTick } from '../../../analytics/lib/chain';
import { compactTickAt } from '../../../analytics/viz/scale';
import { formatDate } from '../../../wallet/lib/dates';
import { type Axis, axisFromZero } from '../../../wallet/lib/plotAxis';
import type { DailyRange } from '../api';

export const DAY_MS = 86_400_000;

/** The first Proof of Node block's time (2025-10-25): where the chain's rules, and its difficulty, changed. */
export const PON_ACTIVATION_MS = 1_761_415_235_000;

/** A chart draws at most this many marks; a longer history would be drawn as the means of its weeks. */
export const MAX_POINTS = 800;

/** Blocks a day on the 30 second schedule of Proof of Node, and on the 120 second schedule before it. */
export const BLOCKS_PER_DAY_PON = 2880;
export const BLOCKS_PER_DAY_POW = 720;

/** A Monday (1970-01-05), so every weekly bucket starts on one and the edges do not move from day to day. */
const BUCKET_REF = Date.UTC(1970, 0, 5);

// ---- the ranges ---------------------------------------------------------------------------------------------

/**
 * The ranges the server serves. The last is everything Insight keeps, two years; it is never called the whole chain.
 */
export const DAILY_RANGES: readonly { id: DailyRange; label: string; phrase: string }[] = [
  { id: '30', label: '30D', phrase: 'the last 30 days' },
  { id: '90', label: '90D', phrase: 'the last 90 days' },
  { id: '365', label: '1Y', phrase: 'the last year' },
  { id: 'all', label: '2Y', phrase: 'the last two years, all that Insight keeps' },
];

export const rangePhrase = (range: DailyRange): string =>
  DAILY_RANGES.find((r) => r.id === range)?.phrase ?? 'the last two years';

// ---- the figures --------------------------------------------------------------------------------------------

export type MetricId = 'transactions' | 'fees' | 'outputs' | 'blocks' | 'supply';

export const METRIC_IDS: readonly MetricId[] = ['transactions', 'fees', 'outputs', 'blocks', 'supply'];

export interface MetricInfo {
  id: MetricId;
  field: keyof Omit<ChainDay, 'day_ms'>;
  /** The tile's label. */
  label: string;
  /** The chart's name. */
  title: string;
  /** `flow`: an amount a day (the running day is partial). `level`: a standing value. */
  kind: 'flow' | 'level';
  /** Whether a tile compares the newest day with the days before it (a block count a day is a schedule, not a trend). */
  compare: boolean;
  /** The unit after a value, or an empty string. */
  unit: string;
  /** Whether the scale may go to log by itself when the values span orders of magnitude. */
  logAuto: boolean;
  /** A value as the tooltip and the table read it. */
  value(v: number): string;
  /** A value in a tile, as short as it can be. */
  short(v: number): string;
  /** A label on the linear value axis. */
  tick(v: number, step: number): string;
}

/** FLUX with the digits that mean something at its size: `1,234`, `12.50`, `0.021`, `0.00002`. */
export function fluxText(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  if (a === 0) return '0';
  return v.toFixed(5);
}

const HASH_UNITS = ['sol/s', 'Ksol/s', 'Msol/s', 'Gsol/s', 'Tsol/s', 'Psol/s'] as const;

/** A solution rate in the biggest unit that keeps it above 1: `148 Msol/s`, `3.66 Gsol/s`. */
export function hashrateText(v: number): string {
  let x = Math.abs(v);
  let u = 0;
  while (x >= 1000 && u < HASH_UNITS.length - 1) {
    x /= 1000;
    u++;
  }
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${v < 0 ? '-' : ''}${x.toFixed(digits)} ${HASH_UNITS[u]}`;
}

export const METRICS: Record<MetricId, MetricInfo> = {
  transactions: {
    id: 'transactions',
    field: 'transactions',
    label: 'Transactions',
    title: 'Transactions a day',
    kind: 'flow',
    compare: true,
    unit: '',
    logAuto: true,
    value: (v) => formatInt(Math.round(v)),
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
  fees: {
    id: 'fees',
    // The day's total, not Insight's `fees`, which is the average per block.
    field: 'fees_total',
    label: 'Fees',
    title: 'Fees paid a day',
    kind: 'flow',
    compare: true,
    unit: 'FLUX',
    logAuto: true,
    value: fluxText,
    short: fluxText,
    tick: (v, step) => compactTickAt(v, step),
  },
  outputs: {
    id: 'outputs',
    field: 'outputs',
    label: 'FLUX moved',
    title: 'FLUX moved a day',
    kind: 'flow',
    compare: true,
    unit: 'FLUX',
    logAuto: true,
    value: fluxText,
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
  blocks: {
    id: 'blocks',
    field: 'blocks',
    label: 'Blocks',
    title: 'Blocks a day',
    kind: 'flow',
    compare: false,
    unit: '',
    logAuto: false,
    value: (v) => formatInt(Math.round(v)),
    short: (v) => formatInt(Math.round(v)),
    tick: (v, step) => compactTickAt(v, step),
  },
  supply: {
    id: 'supply',
    field: 'supply',
    label: 'Supply',
    title: 'Total supply',
    kind: 'level',
    compare: false,
    unit: 'FLUX',
    logAuto: false,
    value: (v) => Math.round(v).toLocaleString('en-US'),
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
};

/** The seconds between blocks that a day's block count means (86,400 over the count), or null with none. */
export function blockSeconds(blocks: number | null | undefined): number | null {
  return typeof blocks === 'number' && Number.isFinite(blocks) && blocks > 0 ? 86_400 / blocks : null;
}

/** The blocks a day should hold on the schedule of its time: 720 on the 120 second blocks, 2,880 on 30 second ones. */
export const expectedBlocks = (dayMs: number): number =>
  dayMs + DAY_MS <= PON_ACTIVATION_MS ? BLOCKS_PER_DAY_POW : BLOCKS_PER_DAY_PON;

// ---- a series -----------------------------------------------------------------------------------------------

export interface SeriesFrame {
  metric: MetricId;
  /** Unix ms of the first day each point stands for. */
  t: number[];
  v: (number | null)[];
  /** The days one point stands for: 1, or 7 or more when a long history is drawn as the means of its weeks. */
  span: number;
  /** The newest point is the day so far: its counters are low, and it is drawn as partial. */
  running: boolean;
  /** The day so far was left out (a long history drawn as weekly means would be pulled down by it). */
  trimmed: boolean;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** True while the day is not over at the time the server built the payload. */
export function isRunningDay(dayMs: number, generatedMs: number): boolean {
  return dayMs + DAY_MS > generatedMs;
}

/** One figure, a point a day. The last point of a per-day figure is flagged `running` while its day is not over. */
export function dailySeries(dto: ChainDailyDto, metric: MetricId): SeriesFrame {
  const info = METRICS[metric];
  const days = dto.days;
  const last = days.at(-1);
  return {
    metric,
    t: days.map((d) => d.day_ms),
    v: days.map((d) => {
      const x = d[info.field];
      return finite(x) ? x : null;
    }),
    span: 1,
    running: info.kind === 'flow' && !!last && isRunningDay(last.day_ms, dto.generated_ms),
    trimmed: false,
  };
}

/** The points of a series that are whole days: the day so far is not one. */
export function completeValues(frame: SeriesFrame): (number | null)[] {
  return frame.running ? frame.v.slice(0, -1) : frame.v;
}

/** How many days one point stands for, so that a chart has at most `max` of them: 1, then whole weeks. */
export function pickBucketSize(n: number, max = MAX_POINTS): number {
  if (n <= max) return 1;
  for (const size of [7, 14, 28, 56, 112]) if (Math.ceil(n / size) <= max) return size;
  return 224;
}

/** Means of consecutive days in buckets of `size` days that start on a Monday. A bucket with no value has none. */
export function bucketFrame(frame: SeriesFrame, size: number): SeriesFrame {
  if (size <= 1) return frame;
  const t: number[] = [];
  const v: (number | null)[] = [];
  let key = Number.NaN;
  let sum = 0;
  let count = 0;
  const flush = () => {
    if (t.length > 0 && count > 0) v[t.length - 1] = sum / count;
  };
  for (let i = 0; i < frame.t.length; i++) {
    const day = frame.t[i] as number;
    const k = Math.floor((day - BUCKET_REF) / (size * DAY_MS));
    if (k !== key) {
      flush();
      key = k;
      sum = 0;
      count = 0;
      t.push(day);
      v.push(null);
    }
    const x = frame.v[i];
    if (finite(x)) {
      sum += x;
      count++;
    }
  }
  flush();
  return { ...frame, t, v, span: size * frame.span };
}

/**
 * The series as a chart draws it: a point a day, or the means of weeks once it is too long for that (and then the day
 * so far is left out, because a partial day would pull its week's mean down).
 */
export function drawnSeries(frame: SeriesFrame, max = MAX_POINTS): SeriesFrame {
  const size = pickBucketSize(frame.t.length, max);
  if (size <= 1) return frame;
  const whole: SeriesFrame = frame.running
    ? { ...frame, t: frame.t.slice(0, -1), v: frame.v.slice(0, -1), running: false, trimmed: true }
    : frame;
  return bucketFrame(whole, size);
}

/** Index of the newest known value, or -1. */
export function lastKnown(v: readonly (number | null)[]): number {
  for (let i = v.length - 1; i >= 0; i--) if (finite(v[i])) return i;
  return -1;
}

export const hasData = (frame: SeriesFrame): boolean => lastKnown(frame.v) >= 0;

/**
 * At most `n` values from a longer run, for a tile's sparkline: each is the mean of its share of the run, and a
 * share with nothing known stays a gap.
 */
export function thinValues(v: readonly (number | null)[], n = 36): (number | null)[] {
  if (v.length <= n) return [...v];
  const out: (number | null)[] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.floor((k * v.length) / n);
    const b = Math.floor(((k + 1) * v.length) / n);
    const known = v.slice(a, Math.max(b, a + 1)).filter(finite);
    out.push(known.length === 0 ? null : mean(known));
  }
  return out;
}

// ---- the scale ----------------------------------------------------------------------------------------------

export type ScalePref = 'auto' | 'linear' | 'log';

/** How far apart the smallest and the largest value must be before a series goes to log by itself. */
export const LOG_RATIO = 40;

const positives = (v: readonly (number | null)[]): number[] =>
  v.filter((x): x is number => finite(x) && x > 0);

/** Whether a series is drawn on a log scale: the reader's choice, or by itself when it spans orders of magnitude. */
export function resolveScale(frame: SeriesFrame, pref: ScalePref): 'linear' | 'log' {
  const info = METRICS[frame.metric];
  // The day so far is low by its nature and says nothing about the range of the days.
  const values = completeValues(frame);
  const pos = positives(values);
  if (pref === 'log') return pos.length >= 2 ? 'log' : 'linear';
  if (pref === 'linear' || !info.logAuto || pos.length < 10) return 'linear';
  // Days with none cannot be drawn on a log scale: a series that has many of them stays linear.
  const known = values.filter(finite).length;
  if (pos.length < known * 0.95) return 'linear';
  let lo = Number.POSITIVE_INFINITY;
  let hi = 0;
  for (const x of pos) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi / lo >= LOG_RATIO ? 'log' : 'linear';
}

/** A value axis in powers of ten: `lo` and `hi` are exponents, and so are the ticks. */
export interface LogAxis {
  lo: number;
  hi: number;
  ticks: number[];
  step: number;
}

export function logAxisFor(values: readonly (number | null)[], maxTicks = 6): LogAxis {
  const pos = positives(values);
  if (pos.length === 0) return { lo: 0, hi: 1, ticks: [0, 1], step: 1 };
  let lo = Math.floor(Math.log10(Math.min(...pos)) + 1e-9);
  let hi = Math.ceil(Math.log10(Math.max(...pos)) - 1e-9);
  if (hi <= lo) hi = lo + 1;
  const step = Math.max(1, Math.ceil((hi - lo) / Math.max(1, maxTicks - 1)));
  // Ticks at multiples of the step from the low edge; the axis ends on a whole number of steps.
  hi = lo + Math.ceil((hi - lo) / step) * step;
  lo = Math.round(lo);
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e += step) ticks.push(e);
  return { lo, hi, ticks, step };
}

/** A tick of the log axis (its exponent) as a number: `0.01`, `100`, `10K`, `1M`. */
export const logTickText = (exponent: number): string => formatLogTick(10 ** exponent);

/** The linear axis of a series: from zero to a little over its largest value. */
export function linearAxisFor(frame: SeriesFrame): Axis {
  const known = frame.v.filter(finite);
  return axisFromZero(known.length === 0 ? 0 : Math.max(...known));
}

// ---- a tile's headline --------------------------------------------------------------------------------------

export interface Headline {
  /** The newest known value of a whole day (or the newest of a standing figure), or null when there is none. */
  value: number | null;
  /** The day it belongs to (unix ms), or null. */
  at: number | null;
  change: { kind: 'percent' | 'amount'; value: number; period: string } | null;
}

/**
 * The newest whole day of a per-day figure and how it compares: against the mean of the seven days before it. A
 * standing figure (the supply) reads its newest value and what it gained since the range began. A block count is a
 * schedule, not a trend, so it carries no comparison.
 */
export function headline(frame: SeriesFrame): Headline {
  const values = completeValues(frame);
  const i = lastKnown(values);
  if (i < 0) return { value: null, at: null, change: null };
  const value = values[i] as number;
  const info = METRICS[frame.metric];
  let change: Headline['change'] = null;
  if (info.kind === 'flow' && info.compare) {
    const before = values.slice(Math.max(0, i - 7), i).filter(finite);
    if (before.length >= 4) {
      const base = mean(before);
      if (base > 0)
        change = { kind: 'percent', value: (value / base - 1) * 100, period: 'the 7 days before' };
    }
  } else if (frame.metric === 'supply') {
    const first = values.findIndex(finite);
    const days = first >= 0 ? Math.round(((frame.t[i] as number) - (frame.t[first] as number)) / DAY_MS) : 0;
    if (first >= 0 && first < i && days >= 7)
      change = { kind: 'amount', value: value - (values[first] as number), period: `${days} days` };
  }
  return { value, at: frame.t[i] ?? null, change };
}

// ---- words --------------------------------------------------------------------------------------------------

export const dayStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The point a chart is read at: a day, or the week a mean stands for. */
export function pointLabel(frame: SeriesFrame, i: number): string {
  const t = frame.t[i];
  if (t === undefined) return 'Unknown';
  return frame.span > 1 ? `Week of ${formatDate(t)}` : formatDate(t);
}

interface Extremes {
  hi: { i: number; v: number } | null;
  lo: { i: number; v: number } | null;
}

function extremes(v: readonly (number | null)[]): Extremes {
  let hi: Extremes['hi'] = null;
  let lo: Extremes['lo'] = null;
  v.forEach((x, i) => {
    if (!finite(x)) return;
    if (!hi || x > hi.v) hi = { i, v: x };
    if (!lo || x < lo.v) lo = { i, v: x };
  });
  return { hi, lo };
}

/**
 * One or two sentences that name a chart for a screen reader: what it is, over which days, where it starts and ends
 * and its extremes, on which scale, and what was left out.
 */
export function summaryOf(frame: SeriesFrame, scale: 'linear' | 'log', range: DailyRange): string {
  const info = METRICS[frame.metric];
  const first = frame.v.findIndex(finite);
  const last = lastKnown(frame.v);
  if (first < 0 || last < 0) return `${info.title}: no figures for ${rangePhrase(range)}.`;
  const unit = info.unit ? ` ${info.unit}` : '';
  const fmt = (x: number) => `${info.value(x)}${unit}`;
  const { hi, lo } = extremes(frame.v);
  const parts = [
    `${info.title}${frame.span > 1 ? ', as means of weeks,' : ''} over ${rangePhrase(range)}, UTC.`,
    first === last
      ? `${fmt(frame.v[last] as number)} on ${formatDate(frame.t[last] as number)}.`
      : `From ${fmt(frame.v[first] as number)} on ${formatDate(frame.t[first] as number)} to ${fmt(frame.v[last] as number)} on ${formatDate(frame.t[last] as number)}.`,
  ];
  if (hi && lo && hi.i !== lo.i) {
    parts.push(
      `Highest ${fmt(hi.v)} on ${formatDate(frame.t[hi.i] as number)}, lowest ${fmt(lo.v)} on ${formatDate(frame.t[lo.i] as number)}.`,
    );
  }
  if (scale === 'log') parts.push('Drawn on a log scale.');
  if (frame.running) parts.push('The last point is today so far, drawn lighter, and is not a whole day.');
  if (frame.trimmed) parts.push('The day still running is left out.');
  return parts.join(' ');
}

// ---- the mining years ---------------------------------------------------------------------------------------

export interface LegacyMining {
  /** The last day of mining the payload holds (unix ms). */
  dayMs: number;
  difficulty: number | null;
  networkHash: number | null;
}

/**
 * The last day of mining in the payload: the newest day that ended before Proof of Node began and has a difficulty or
 * a hash rate. Null when the range starts after the mining years. These two figures stopped measuring mining work
 * when Proof of Node began, so they are told once, as a footnote, and never charted as the network's health.
 */
export function legacyMining(dto: ChainDailyDto): LegacyMining | null {
  for (let i = dto.days.length - 1; i >= 0; i--) {
    const d = dto.days[i] as ChainDay;
    if (d.day_ms + DAY_MS > PON_ACTIVATION_MS) continue;
    const difficulty = finite(d.difficulty) ? d.difficulty : null;
    const networkHash = finite(d.network_hash) ? d.network_hash : null;
    if (difficulty !== null || networkHash !== null) return { dayMs: d.day_ms, difficulty, networkHash };
  }
  return null;
}

/** The footnote on difficulty and hash rate, with the last mining day's figures when the range holds it. */
export function legacyNote(legacy: LegacyMining | null): string {
  const head =
    'Mining ended when Proof of Node began on 25 Oct 2025. Insight still reports a difficulty and a network hash rate, but since then they no longer measure mining work, so they are not charted here.';
  if (!legacy) return head;
  const bits = [
    legacy.difficulty === null ? null : `a difficulty of ${formatDifficulty(legacy.difficulty)}`,
    legacy.networkHash === null ? null : `a network rate of ${hashrateText(legacy.networkHash)}`,
  ].filter((x): x is string => x !== null);
  return `${head} On ${formatDate(legacy.dayMs)}, the last whole day of mining in this range, the chain had ${bits.join(' and ')}.`;
}

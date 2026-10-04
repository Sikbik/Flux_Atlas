// The chain's daily figures, shaped for the landing's charts: which figures there are and how each reads, one
// series out of the daily payload, the weekly means a chain's whole life is drawn as, the linear or log scale a
// series deserves, a tile's headline and change, and the sentence that names a chart for a screen reader. Pure.

import { formatCompact, formatInt } from '../../../../lib/format';
import { formatDifficulty, formatLogTick } from '../../../analytics/lib/chain';
import { compactTickAt } from '../../../analytics/viz/scale';
import { formatDate } from '../../../wallet/lib/dates';
import { type Axis, axisFromZero } from '../../../wallet/lib/plotAxis';
import type { ChainDailyDay, ChainDailyDto, DailyRange } from '../api';

export const DAY_MS = 86_400_000;

/** The first Proof of Node block's time (2025-10-25): where the chain's rules, and its difficulty, changed. */
export const PON_ACTIVATION_MS = 1_761_415_235_000;

/** A chart draws at most this many marks; a longer history is drawn as the means of its weeks. */
export const MAX_POINTS = 480;

/** A Monday (1970-01-05), so every weekly bucket starts on one and the edges do not move from day to day. */
const BUCKET_REF = Date.UTC(1970, 0, 5);

// ---- the ranges ---------------------------------------------------------------------------------------------

export const DAILY_RANGES: readonly { id: DailyRange; label: string; phrase: string }[] = [
  { id: '30', label: '30D', phrase: 'the last 30 days' },
  { id: '90', label: '90D', phrase: 'the last 90 days' },
  { id: '365', label: '1Y', phrase: 'the last year' },
  { id: 'all', label: 'All', phrase: 'the whole chain' },
];

export const rangePhrase = (range: DailyRange): string =>
  DAILY_RANGES.find((r) => r.id === range)?.phrase ?? 'the whole chain';

// ---- the figures --------------------------------------------------------------------------------------------

export type MetricId = 'transactions' | 'fees' | 'outputs' | 'network_hash' | 'difficulty' | 'supply';

export const METRIC_IDS: readonly MetricId[] = [
  'transactions',
  'fees',
  'outputs',
  'network_hash',
  'difficulty',
  'supply',
];

export interface MetricInfo {
  id: MetricId;
  field: keyof Omit<ChainDailyDay, 'day_ms'>;
  /** The tile's label. */
  label: string;
  /** The chart's name. */
  title: string;
  /** `flow`: an amount a day (the running day is left out). `level`: a standing value. */
  kind: 'flow' | 'level';
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

const HASH_UNITS = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'] as const;

/** A hash rate in the biggest unit that keeps it above 1: `148 MH/s`, `1.52 GH/s`. */
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
    unit: '',
    logAuto: true,
    value: (v) => formatInt(Math.round(v)),
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
  fees: {
    id: 'fees',
    field: 'fees',
    label: 'Fees',
    title: 'Fees paid a day',
    kind: 'flow',
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
    unit: 'FLUX',
    logAuto: true,
    value: fluxText,
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
  network_hash: {
    id: 'network_hash',
    field: 'network_hash',
    label: 'Network hash',
    title: 'Network hash rate',
    kind: 'level',
    unit: '',
    logAuto: true,
    value: hashrateText,
    short: hashrateText,
    tick: (v) => hashrateText(v),
  },
  difficulty: {
    id: 'difficulty',
    field: 'difficulty',
    label: 'Difficulty',
    title: 'Difficulty',
    kind: 'level',
    unit: '',
    logAuto: true,
    value: (v) => formatDifficulty(v),
    short: (v) => formatDifficulty(v),
    tick: (v, step) => compactTickAt(v, step),
  },
  supply: {
    id: 'supply',
    field: 'supply',
    label: 'Supply',
    title: 'Total supply',
    kind: 'level',
    unit: 'FLUX',
    logAuto: false,
    value: (v) => Math.round(v).toLocaleString('en-US'),
    short: (v) => formatCompact(v),
    tick: (v, step) => compactTickAt(v, step),
  },
};

// ---- a series -----------------------------------------------------------------------------------------------

export interface SeriesFrame {
  metric: MetricId;
  /** Unix ms of the first day each point stands for. */
  t: number[];
  v: (number | null)[];
  /** The days one point stands for: 1, or 7 or more when a long history is drawn as the means of its weeks. */
  span: number;
  /** The newest day was left out of a per-day series because it is not over yet. */
  trimmed: boolean;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** True while the day is not over at the time the server built the payload. */
export function isRunningDay(dayMs: number, generatedMs: number): boolean {
  return dayMs + DAY_MS > generatedMs;
}

/** One figure, a point a day. A running day of a per-day figure is left out: it is a part of one, not a day. */
export function dailySeries(dto: ChainDailyDto, metric: MetricId): SeriesFrame {
  const info = METRICS[metric];
  let days = dto.days;
  let trimmed = false;
  const last = days.at(-1);
  if (info.kind === 'flow' && last && isRunningDay(last.day_ms, dto.generated_ms)) {
    days = days.slice(0, -1);
    trimmed = true;
  }
  return {
    metric,
    t: days.map((d) => d.day_ms),
    v: days.map((d) => {
      const x = d[info.field];
      return finite(x) ? x : null;
    }),
    span: 1,
    trimmed,
  };
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

/** The series as a chart draws it: a point a day, or the means of weeks once it is too long for that. */
export function drawnSeries(frame: SeriesFrame, max = MAX_POINTS): SeriesFrame {
  return bucketFrame(frame, pickBucketSize(frame.t.length, max));
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
  const pos = positives(frame.v);
  if (pref === 'log') return pos.length >= 2 ? 'log' : 'linear';
  if (pref === 'linear' || !info.logAuto || pos.length < 10) return 'linear';
  // Days with none cannot be drawn on a log scale: a series that has many of them stays linear.
  const known = frame.v.filter(finite).length;
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
  /** The newest known value, or null when the series has none. */
  value: number | null;
  /** The day it belongs to (unix ms), or null. */
  at: number | null;
  /** The newest value is not from the series' last day: the figure has been unknown since. */
  lapsed: boolean;
  change: { kind: 'percent' | 'amount'; value: number; period: string } | null;
}

/**
 * The newest value of a per-day series and how it compares: a flow against the mean of the seven days before it, the
 * supply against thirty days earlier. Difficulty and hash rate carry no comparison: they move too much from day to
 * day (and difficulty means another thing since Proof of Node) for a percentage to say anything.
 */
export function headline(frame: SeriesFrame): Headline {
  const i = lastKnown(frame.v);
  if (i < 0) return { value: null, at: null, lapsed: false, change: null };
  const value = frame.v[i] as number;
  const info = METRICS[frame.metric];
  let change: Headline['change'] = null;
  if (info.kind === 'flow') {
    const before = frame.v.slice(Math.max(0, i - 7), i).filter((x): x is number => finite(x));
    if (before.length >= 4) {
      const base = mean(before);
      if (base > 0)
        change = { kind: 'percent', value: (value / base - 1) * 100, period: 'the 7 days before' };
    }
  } else if (frame.metric === 'supply') {
    const earlier = frame.v[i - 30];
    if (finite(earlier)) change = { kind: 'amount', value: value - earlier, period: '30 days' };
  }
  return { value, at: frame.t[i] ?? null, lapsed: i < frame.v.length - 1, change };
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
  if (frame.trimmed) parts.push('The day still running is left out.');
  return parts.join(' ');
}

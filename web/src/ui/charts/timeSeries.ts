// TimeSeries logic that needs no DOM and no uPlot: series preparation (limits, alignment, the
// rolling window), the y range, UTC axis labels, legend visibility rules, keyboard stepping and the
// text equivalents of the chart (summary, announcement, data table). Kept apart from the uPlot
// wrapper so it is unit tested and so the wrapper's chunk stays small.

import { formatUtcDateTime, UNKNOWN } from '../../lib/format';
import { formatSample } from './scale';

/** A series may not exceed the six validated categorical slots (a seventh folds into "Other"). */
export const MAX_SERIES = 6;

/** The props a TimeSeries consumes itself; everything else goes to the root element. */
const OWN_PROPS: ReadonlySet<string> = new Set([
  't',
  'series',
  'height',
  'area',
  'yFormat',
  'xFormat',
  'yDomain',
  'maxPoints',
  'label',
  'loading',
  'error',
  'onRetry',
  'refreshing',
  'emptyText',
  'defaultShowData',
]);

/** The props meant for the root element (`ref`, `className`, `style`, `id`, `data-*`, `aria-*`, events). */
export function rootProps<T extends object>(props: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!OWN_PROPS.has(k)) out[k] = v;
  return out;
}

/** The categorical colour slots in their fixed order (design 5.6); never cycled, never reordered. */
export const SLOT_COLORS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
] as const;

/** The colour of series slot `i` (0-based). */
export function slotColor(i: number): string {
  return SLOT_COLORS[Math.min(Math.max(0, i), SLOT_COLORS.length - 1)] as string;
}

/** One series as callers describe it. */
export interface SeriesInput {
  /** Stable identity (a metric name): colour and legend visibility follow the key, never the rank. */
  key: string;
  /** Human label for the legend, tooltip and data table. */
  label: string;
  /** One value per timestamp; null (or a non-finite number) is a gap. */
  values: readonly (number | null)[];
  /** Mark colour as a CSS colour value; defaults to the series' slot in `--viz-1` to `--viz-6`. */
  color?: string;
  /** Formats a value for the tooltip and the table; defaults to the chart's `yFormat`. */
  format?: (value: number) => string;
}

export interface PreparedSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  format?: (value: number) => string;
}

export interface PreparedData {
  /** Timestamps, unix ms, ascending. */
  t: number[];
  series: PreparedSeries[];
  /** Series beyond the sixth that were ignored. */
  dropped: number;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Normalises caller data: at most six series (extras are dropped and counted), every series exactly
 * as long as `t` (short ones are padded with gaps, long ones cut), non-finite values turned into
 * gaps, and the oldest points dropped beyond `maxPoints`.
 */
export function prepareData(
  t: readonly number[],
  series: readonly SeriesInput[],
  maxPoints?: number,
): PreparedData {
  const keep = series.slice(0, MAX_SERIES);
  const n = t.length;
  const from = maxPoints !== undefined && maxPoints > 0 && n > maxPoints ? n - Math.floor(maxPoints) : 0;
  return {
    t: t.slice(from),
    series: keep.map((s, i) => ({
      key: s.key,
      label: s.label,
      color: s.color ?? slotColor(i),
      format: s.format,
      values: Array.from({ length: n - from }, (_, j) => {
        const v = s.values[from + j];
        return finite(v) ? v : null;
      }),
    })),
    dropped: Math.max(0, series.length - MAX_SERIES),
  };
}

/** True when there is nothing to draw: no timestamps, or no finite value in any series. */
export function isEmptyData(p: Pick<PreparedData, 't' | 'series'>): boolean {
  if (p.t.length === 0) return true;
  return !p.series.some((s) => s.values.some(finite));
}

/** True when two prepared data sets hold the same arrays (by identity) and the same series identity. */
export function sameData(a: PreparedData | null, b: PreparedData | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.t.length !== b.t.length || a.series.length !== b.series.length) return false;
  for (let i = 0; i < a.t.length; i++) if (a.t[i] !== b.t[i]) return false;
  return a.series.every((s, i) => {
    const o = b.series[i];
    if (!o || o.key !== s.key || o.color !== s.color || o.label !== s.label) return false;
    for (let j = 0; j < s.values.length; j++) if (s.values[j] !== o.values[j]) return false;
    return true;
  });
}

/** The aligned columns uPlot takes: x in seconds, then one array per series. */
export function toAligned(p: PreparedData): [number[], ...(number | null)[][]] {
  return [p.t.map((ms) => ms / 1000), ...p.series.map((s) => s.values)];
}

/** Index of the last finite value in `values`, or -1. */
export function lastFiniteIndex(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (finite(values[i])) return i;
  return -1;
}

/** Index of the first finite value in `values`, or -1. */
export function firstFiniteIndex(values: readonly (number | null)[]): number {
  for (let i = 0; i < values.length; i++) if (finite(values[i])) return i;
  return -1;
}

/**
 * Indices that deserve a marker even though a line chart draws no mark for them: the newest finite
 * value (the end dot) and any isolated value between gaps (which would otherwise be invisible).
 */
export function markerIndices(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  const last = lastFiniteIndex(values);
  for (let i = 0; i < values.length; i++) {
    if (!finite(values[i])) continue;
    const alone = !finite(values[i - 1]) && !finite(values[i + 1]);
    if (alone || i === last) out.push(i);
  }
  return out;
}

/** Smallest and largest finite value, or null. */
export function rangeOf(values: readonly (number | null)[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!finite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

export type YDomain = readonly [number | null, number | null];

/**
 * The y scale range for data between `min` and `max`: 8 percent of headroom on both sides (never
 * below zero for non-negative data), a flat series centred, and fixed bounds from `domain` where
 * given (`[0, null]` pins a zero baseline and lets the top float).
 */
export function padRange(min: number, max: number, domain?: YDomain): [number, number] {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  const span = hi - lo;
  const pad = span > 0 ? span * 0.08 : Math.abs(hi) * 0.05 || 1;
  let autoLo = lo - pad;
  const autoHi = hi + pad;
  if (lo >= 0 && autoLo < 0) autoLo = 0;
  const outLo = domain?.[0] ?? autoLo;
  let outHi = domain?.[1] ?? autoHi;
  if (outHi <= outLo) outHi = outLo + 1;
  return [outLo, outHi];
}

// ---------------------------------------------------------------------------------------------
// Time labels (UTC everywhere: Atlas shows chain time)
// ---------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * A compact UTC axis label for a tick, chosen by the visible span: seconds under two minutes,
 * `14:30` up to two days (midnight shows the date), `Sep 30` up to three months, `Sep 2026` beyond.
 */
export function formatXTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (spanMs <= 2 * MIN) return `${hh}:${mm}:${pad2(d.getUTCSeconds())}`;
  if (spanMs <= 2 * DAY) return spanMs > 6 * HOUR && hh === '00' && mm === '00' ? date : `${hh}:${mm}`;
  if (spanMs <= 92 * DAY) return date;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------------------------
// Formatting and text equivalents
// ---------------------------------------------------------------------------------------------

export interface Formatters {
  /** Axis ticks and the default value format. */
  yFormat?: (value: number) => string;
  /** Tooltip header, table and summary time format (default UTC date and time). */
  xFormat?: (ms: number) => string;
}

/** The value formatter for a series: its own, else the chart's, else three significant digits. */
export function valueFormatter(s: Pick<PreparedSeries, 'format'>, f: Formatters): (v: number) => string {
  return s.format ?? f.yFormat ?? formatSample;
}

const timeFormatter = (f: Formatters) => f.xFormat ?? ((ms: number) => formatUtcDateTime(ms));

/** A series value for display: formatted, or "Unknown" for a gap (never zero, never blank). */
export function cellText(v: number | null | undefined, fmt: (v: number) => string): string {
  return finite(v) ? fmt(v) : UNKNOWN;
}

function trendWords(first: number, last: number, fmt: (v: number) => string): string {
  const change = last - first;
  const rel = first !== 0 ? change / Math.abs(first) : null;
  if (change === 0 || (rel !== null && Math.abs(rel) < 0.0005)) return `flat at ${fmt(last)}`;
  const dir = change > 0 ? 'up' : 'down';
  const pct = rel === null ? '' : ` ${(Math.abs(rel) * 100).toFixed(1)} percent`;
  return `from ${fmt(first)} to ${fmt(last)}, ${dir}${pct}`;
}

function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * One sentence that stands in for the picture (design 10.3): what is plotted, over what span, and
 * where each series went. `Node count, 83 points from 2026-09-30 02:00 UTC to 2026-10-01 02:00 UTC:
 * from 6,633 to 6,723, up 1.4 percent; low 6,597, high 6,742.`
 */
export function summarize(p: PreparedData, f: Formatters = {}): string {
  if (isEmptyData(p)) return 'No data for this range';
  const fmtTime = timeFormatter(f);
  const names = joinWords(p.series.map((s) => s.label));
  const start = fmtTime(p.t[0] as number);
  const end = fmtTime(p.t[p.t.length - 1] as number);
  const head = `${names}, ${p.t.length} points from ${start} to ${end}`;
  const parts = p.series.map((s) => {
    const fmt = valueFormatter(s, f);
    const a = firstFiniteIndex(s.values);
    const b = lastFiniteIndex(s.values);
    const r = rangeOf(s.values);
    if (a < 0 || b < 0 || !r) return `${s.label} has no data`;
    const trend =
      a === b
        ? `only ${fmt(s.values[b] as number)}`
        : trendWords(s.values[a] as number, s.values[b] as number, fmt);
    const span = `low ${fmt(r[0])}, high ${fmt(r[1])}`;
    return p.series.length === 1 ? `${trend}; ${span}` : `${s.label} ${trend} (${span})`;
  });
  return `${head}: ${parts.join('; ')}.`;
}

/** What assistive technology hears when the crosshair lands on a point: the time, then every visible series. */
export function pointAnnouncement(
  p: PreparedData,
  idx: number,
  f: Formatters = {},
  visible?: readonly boolean[],
): string {
  const t = p.t[idx];
  if (t === undefined) return '';
  const fmtTime = timeFormatter(f);
  const rows = p.series
    .filter((_, i) => visible?.[i] !== false)
    .map((s) => `${s.label} ${cellText(s.values[idx], valueFormatter(s, f))}`);
  return `${fmtTime(t)}: ${rows.join(', ')}`;
}

export interface TableRow {
  /** Unix ms of the row. */
  t: number;
  time: string;
  /** One cell per series, "Unknown" for gaps. */
  cells: string[];
}

/** Rows of the accessible data table; the latest `limit` points when the data is longer. */
export function tableRows(p: PreparedData, f: Formatters = {}, limit = 500): TableRow[] {
  const fmtTime = timeFormatter(f);
  const from = Math.max(0, p.t.length - limit);
  const fmts = p.series.map((s) => valueFormatter(s, f));
  const rows: TableRow[] = [];
  for (let i = from; i < p.t.length; i++) {
    const t = p.t[i] as number;
    rows.push({
      t,
      time: fmtTime(t),
      cells: p.series.map((s, k) => cellText(s.values[i], fmts[k] as (v: number) => string)),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Legend and keyboard rules
// ---------------------------------------------------------------------------------------------

/**
 * Legend interaction (design 5.6): a click isolates one series (a second click on the isolated one
 * shows all again); shift-click toggles one series on or off. At least one series always stays on.
 */
export function legendNext(visible: readonly boolean[], i: number, shift: boolean): boolean[] {
  if (i < 0 || i >= visible.length) return [...visible];
  if (shift) {
    const next = visible.map((v, k) => (k === i ? !v : v));
    return next.some(Boolean) ? next : [...visible];
  }
  const onlyThis = visible.every((v, k) => (k === i ? v : !v));
  return onlyThis ? visible.map(() => true) : visible.map((_, k) => k === i);
}

/**
 * The crosshair index a key moves to, or null when the key does nothing. The first arrow press
 * lands on the newest point; Shift jumps ten points; Home and End go to the ends.
 */
export function stepIndex(current: number | null, key: string, shift: boolean, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const jump = shift ? 10 : 1;
  const clampIdx = (n: number) => Math.min(last, Math.max(0, n));
  switch (key) {
    case 'ArrowLeft':
      return current === null ? last : clampIdx(current - jump);
    case 'ArrowRight':
      return current === null ? last : clampIdx(current + jump);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

export interface TipPlacementInput {
  /** Crosshair x in plot pixels. */
  x: number;
  /** y of the highest and lowest visible values at the crosshair (plot pixels), or null when none. */
  top: number | null;
  bottom: number | null;
  tip: { width: number; height: number };
  plot: { width: number; height: number };
  /** Space kept between the tooltip and the points (default 14). */
  gap?: number;
}

/**
 * Where the tooltip goes: centred on the crosshair above the highest point so it never covers the
 * data being read, else below the lowest point, else beside the crosshair (right, flipped left near
 * the right edge) centred on the points. Always inside the plot.
 */
export function placeTip(i: TipPlacementInput): {
  x: number;
  y: number;
  side: 'above' | 'below' | 'right' | 'left';
} {
  const gap = i.gap ?? 14;
  const { width: w, height: h } = i.tip;
  const maxX = Math.max(0, i.plot.width - w);
  const maxY = Math.max(0, i.plot.height - h);
  const centred = Math.max(0, Math.min(i.x - w / 2, maxX));
  if (i.top === null || i.bottom === null) return { x: centred, y: maxY / 2, side: 'above' };
  const above = i.top - gap - h;
  if (above >= 0) return { x: centred, y: above, side: 'above' };
  const below = i.bottom + gap;
  if (below <= maxY) return { x: centred, y: below, side: 'below' };
  // No room above or below: stand beside the crosshair, centred on the points.
  const y = Math.max(0, Math.min((i.top + i.bottom) / 2 - h / 2, maxY));
  const right = i.x + gap + 2;
  if (right <= maxX) return { x: right, y, side: 'right' };
  return { x: Math.max(0, Math.min(i.x - gap - 2 - w, maxX)), y, side: 'left' };
}

/** Index of the timestamp nearest to `target` (binary search; `t` ascending). */
export function nearestIndex(t: readonly number[], target: number): number {
  if (t.length === 0) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) <= target) lo = mid;
    else hi = mid;
  }
  return Math.abs((t[lo] as number) - target) <= Math.abs((t[hi] as number) - target) ? lo : hi;
}

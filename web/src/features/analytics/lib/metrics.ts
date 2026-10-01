// Turns the columnar `/metrics` payload into chart-ready frames and keeps the history honest.
//
// Rows backfilled from the 30-day stats history only know the node counts; every other column of such
// a row is 0 on the wire (a server defect the backend team is fixing: those cells should be null). A
// recorded row always has a chain tip, so `tip_height` is the marker: where it is 0 or null, the
// columns that the backfill cannot know are treated as unknown, never as 0. Once the server sends nulls
// this masking changes nothing.

import type { MetricsSeriesDto } from '../../../api/generated/MetricsSeriesDto';

/** Series the 30-day backfill really fills (the node counts). */
export const BACKFILLED_SERIES: ReadonlySet<string> = new Set(['node_count', 'cumulus', 'nimbus', 'stratus']);

/** Gauges that cannot be 0 on a live network: a 0 means "not recorded". */
const NEVER_ZERO: ReadonlySet<string> = new Set([
  'tip_height',
  'host_count',
  'country_count',
  'total_cores',
  'total_ram_gb',
  'total_storage_gb',
  'supply_flux_f64',
  'price_usd',
  'app_count',
  'instance_count',
]);

export interface MetricFrame {
  /** Unix ms of each bucket start. */
  t: number[];
  /** Series name to values; null means unknown. */
  v: Record<string, (number | null)[]>;
}

export function frameFromDto(dto: MetricsSeriesDto): MetricFrame {
  const n = dto.t.length;
  const tip = dto.series.tip_height;
  const recorded: boolean[] = new Array<boolean>(n).fill(true);
  if (tip) for (let i = 0; i < n; i++) recorded[i] = (tip[i] ?? 0) > 0;
  const v: Record<string, (number | null)[]> = {};
  for (const [name, col] of Object.entries(dto.series)) {
    v[name] = col.map((x, i) => {
      if (x === null || x === undefined || !Number.isFinite(x)) return null;
      if (!BACKFILLED_SERIES.has(name) && tip && !recorded[i]) return null;
      if (NEVER_ZERO.has(name) && x === 0) return null;
      return x;
    });
  }
  return { t: [...dto.t], v };
}

/** Drops leading and trailing buckets where every listed series is unknown (the open bucket, empty history). */
export function trimEmpty(frame: MetricFrame, names: readonly string[]): MetricFrame {
  const known = (i: number) => names.some((n) => frame.v[n]?.[i] != null);
  let a = 0;
  let b = frame.t.length - 1;
  while (a <= b && !known(a)) a++;
  while (b >= a && !known(b)) b--;
  if (a === 0 && b === frame.t.length - 1) return frame;
  const v: Record<string, (number | null)[]> = {};
  for (const [k, col] of Object.entries(frame.v)) v[k] = col.slice(a, b + 1);
  return { t: frame.t.slice(a, b + 1), v };
}

/**
 * Appends a live point (right now) to named series, so a chart's right edge follows the stream between
 * server samples. A point at or before the last bucket replaces nothing: it is only added when newer.
 */
export function withLiveTail(
  frame: MetricFrame,
  nowMs: number,
  live: Record<string, number | null>,
): MetricFrame {
  const last = frame.t.at(-1);
  if (last !== undefined && nowMs <= last) return frame;
  const t = [...frame.t, nowMs];
  const v: Record<string, (number | null)[]> = {};
  for (const [k, col] of Object.entries(frame.v)) v[k] = [...col, live[k] ?? null];
  return { t, v };
}

/** Difference between consecutive known points of a series (null where either end is unknown). */
export function differences(values: readonly (number | null)[]): (number | null)[] {
  return values.map((x, i) => {
    if (i === 0) return null;
    const prev = values[i - 1];
    return x === null || prev === null || prev === undefined ? null : x - prev;
  });
}

/** Sum of several series per bucket (null when any is unknown). */
export function sumSeries(frame: MetricFrame, names: readonly string[]): (number | null)[] {
  return frame.t.map((_, i) => {
    let s = 0;
    for (const n of names) {
      const x = frame.v[n]?.[i];
      if (x === null || x === undefined) return null;
      s += x;
    }
    return s;
  });
}

/** Number of known points in a series. */
export function knownCount(values: readonly (number | null)[]): number {
  let c = 0;
  for (const x of values) if (x !== null) c++;
  return c;
}

export type Range = '24h' | '7d' | '30d';

export const RANGES: Record<Range, { label: string; ms: number; stepMs: number }> = {
  '24h': { label: '24 hours', ms: 24 * 3_600_000, stepMs: 15 * 60_000 },
  '7d': { label: '7 days', ms: 7 * 24 * 3_600_000, stepMs: 3_600_000 },
  '30d': { label: '30 days', ms: 30 * 24 * 3_600_000, stepMs: 3_600_000 },
};

/** A request window ending at the current step boundary, so the query key is stable between ticks. */
export function rangeWindow(range: Range, nowMs: number): { from: number; to: number; step: number } {
  const { ms, stepMs } = RANGES[range];
  const to = Math.floor(nowMs / stepMs) * stepMs + stepMs;
  return { from: to - ms, to, step: stepMs };
}

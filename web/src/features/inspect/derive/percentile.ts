// Hardware percentiles against a node's own tier, from the node table's benchmark columns (cores,
// RAM, SSD). Unknown values (0 in the table) are left out of the distribution and never ranked.

import type { NodeTable } from '../../../store/nodeTable';

export type HardwareColumn = 'cores' | 'ramGb' | 'ssdGb';

/** Sorted ascending values of one column for every known (non-zero) node of a tier. */
export function tierColumn(t: NodeTable, tierCode: number, col: HardwareColumn): Float64Array {
  const src = t[col];
  const out: number[] = [];
  for (let i = 0; i < t.count; i++) {
    if (t.tier[i] !== tierCode) continue;
    const v = src[i]!;
    if (v > 0) out.push(v);
  }
  out.sort((a, b) => a - b);
  return Float64Array.from(out);
}

/**
 * Mid-rank percentile of `value` in a sorted distribution: the share of nodes below it plus half of
 * the nodes equal to it, from 0 to 100. Null when the value is unknown or nothing is known.
 */
export function percentileOf(sorted: ArrayLike<number>, value: number | null | undefined): number | null {
  const n = sorted.length;
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0 || n === 0) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const below = lo;
  let upper = lo;
  hi = n;
  while (upper < hi) {
    const mid = (upper + hi) >>> 1;
    if (sorted[mid]! <= value) upper = mid + 1;
    else hi = mid;
  }
  const equal = upper - below;
  return ((below + equal / 2) / n) * 100;
}

/** The median of a sorted distribution (null when empty). */
export function medianOf(sorted: ArrayLike<number>): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  return n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** Plain-language rank: `Above 73% of Stratus`, or `Typical for Stratus` near the middle. */
export function describePercentile(p: number | null, tierName: string): string | null {
  if (p === null) return null;
  const r = Math.round(p);
  if (r >= 45 && r <= 55) return `Typical for ${tierName}`;
  if (r > 55) return `Above ${r}% of ${tierName}`;
  return `Below ${100 - r}% of ${tierName}`;
}

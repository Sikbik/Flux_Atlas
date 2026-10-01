// BarList logic with no DOM: how long a bar is, how wide the value columns are, which rows show.

import { formatInt } from '../../lib/format';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The denominator that turns values into bar lengths: `total` when given (bars then read as shares
 * of the whole), else `max` when given, else the largest value in the list.
 */
export function barScale(
  values: readonly (number | null | undefined)[],
  total?: number,
  max?: number,
): number {
  if (total !== undefined && total > 0) return total;
  if (max !== undefined && max > 0) return max;
  let m = 0;
  for (const v of values) if (isNum(v) && v > m) m = v;
  return m;
}

/** A value's share of the scale, 0 to 1. Unknown, zero, negative and non-finite values have no bar. */
export function barFraction(value: number | null | undefined, scale: number): number {
  if (!isNum(value) || value <= 0 || scale <= 0) return 0;
  return Math.min(1, value / scale);
}

/** The value text when the caller gave none: a grouped integer, or "Unknown" for a missing value. */
export function defaultDisplay(value: number | null | undefined): string {
  return formatInt(isNum(value) ? value : null);
}

/**
 * The width of a column of text cells in `ch` (the longest cell plus half a character of air), so
 * numbers in Plex Mono line up across rows. Cells that are not plain text are ignored; 0 when none are.
 */
export function columnCh(cells: readonly unknown[]): number {
  let longest = 0;
  for (const c of cells) {
    if (typeof c === 'string' || typeof c === 'number') longest = Math.max(longest, String(c).length);
  }
  return longest === 0 ? 0 : longest + 0.5;
}

/** The rows to draw: all of them, or the first `limit` while collapsed. */
export function visibleItems<T>(items: readonly T[], limit: number | undefined, expanded: boolean): T[] {
  if (limit === undefined || limit <= 0 || expanded || items.length <= limit) return [...items];
  return items.slice(0, Math.floor(limit));
}

/** True when a `limit` actually hides rows (so a "Show all" toggle is worth drawing). */
export function isTruncated(count: number, limit: number | undefined): boolean {
  return limit !== undefined && limit > 0 && count > limit;
}

// Pure helpers for live lists: which rows just arrived (for the white wash) and how many rows were
// added above the previous first row (to keep a scrolled list still, and to slide the list down
// when a row lands at the top). No timers here; the hook that uses them is `useFreshKeys`.

/** Keys of `rows` that are not in `seen`, in row order. */
export function arrivedKeys<Row>(
  seen: ReadonlySet<string | number>,
  rows: readonly Row[],
  rowKey: (row: Row) => string | number,
): Array<string | number> {
  const out: Array<string | number> = [];
  for (const row of rows) {
    const k = rowKey(row);
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

/**
 * How many rows were inserted above the row that used to be first: 0 when the first row is
 * unchanged, the previous first row is gone, or it is further down than `limit`.
 */
export function prependedCount(
  prevFirstKey: string | null,
  length: number,
  keyAt: (index: number) => string,
  limit = 64,
): number {
  if (prevFirstKey === null || length === 0) return 0;
  const max = Math.min(length, limit + 1);
  for (let i = 0; i < max; i++) {
    if (keyAt(i) === prevFirstKey) return i;
  }
  return 0;
}

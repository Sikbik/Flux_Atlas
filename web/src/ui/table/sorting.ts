// Sorting for the data table: comparators per value type, a stable sort that always puts missing
// values last (in both directions, which is how "Unknown" cells behave), and the header-click cycle.
// Pure, so it is unit tested without a DOM.

export type SortDir = 'asc' | 'desc';

/** The active sort: a column id and a direction. `null` means unsorted (the rows' own order). */
export interface SortState {
  id: string;
  dir: SortDir;
}

/** What a column's sort key may be; nullish and NaN count as missing and always sort last. */
export type SortValue = number | bigint | string | boolean | Date | null | undefined;

type Present = Exclude<SortValue, null | undefined>;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** True for a value that has no meaningful order: nullish, NaN, or an invalid Date. */
export function isMissing(v: SortValue): v is null | undefined {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (v instanceof Date) return Number.isNaN(v.getTime());
  return false;
}

/** Narrows anything a column's `value` returns to a sort key; objects and functions become missing. */
export function toSortValue(v: unknown): SortValue {
  switch (typeof v) {
    case 'number':
    case 'bigint':
    case 'string':
    case 'boolean':
      return v;
    case 'object':
      return v instanceof Date ? v : null;
    default:
      return null;
  }
}

/** Ascending comparison of two present values (call `isMissing` first). Mixed types fall back to text. */
export function compareValues(a: Present, b: Present): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  const tx = typeof x;
  const ty = typeof y;
  if ((tx === 'number' || tx === 'bigint') && (ty === 'number' || ty === 'bigint')) {
    // number and bigint compare correctly with the relational operators; Infinity sorts at the ends.
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (tx === 'boolean' && ty === 'boolean') return Number(x) - Number(y);
  if (tx === 'string' && ty === 'string') return collator.compare(x as string, y as string);
  return collator.compare(String(x), String(y));
}

/**
 * A stable sorted copy of `rows` by the key `getKey` returns. Keys are read once per row. Missing
 * keys go last in both directions; ties keep their input order.
 */
export function sortRows<Row>(rows: readonly Row[], getKey: (row: Row) => SortValue, dir: SortDir): Row[] {
  const n = rows.length;
  const keys = new Array<SortValue>(n);
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    keys[i] = getKey(rows[i]!);
    order[i] = i;
  }
  const sign = dir === 'asc' ? 1 : -1;
  order.sort((i, j) => {
    const a = keys[i];
    const b = keys[j];
    const ma = isMissing(a);
    const mb = isMissing(b);
    if (ma || mb) return ma && mb ? i - j : ma ? 1 : -1;
    const c = compareValues(a as Present, b as Present);
    return c === 0 ? i - j : c * sign;
  });
  const out = new Array<Row>(n);
  for (let k = 0; k < n; k++) out[k] = rows[order[k]!]!;
  return out;
}

/** The direction a column sorts in on its first click: numbers start descending, text ascending. */
export function defaultDir(column: { numeric?: boolean; defaultSortDir?: SortDir }): SortDir {
  return column.defaultSortDir ?? (column.numeric ? 'desc' : 'asc');
}

/** The opposite direction. */
export const flipDir = (d: SortDir): SortDir => (d === 'asc' ? 'desc' : 'asc');

/**
 * The sort after a header click: another column starts in its default direction; the same column
 * goes default, then opposite, then back to unsorted.
 */
export function nextSort(
  current: SortState | null | undefined,
  id: string,
  first: SortDir,
): SortState | null {
  if (!current || current.id !== id) return { id, dir: first };
  if (current.dir === first) return { id, dir: flipDir(first) };
  return null;
}

/** `aria-sort` value for a header. */
export function ariaSort(
  current: SortState | null | undefined,
  id: string,
): 'ascending' | 'descending' | 'none' {
  if (!current || current.id !== id) return 'none';
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

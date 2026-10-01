import { describe, expect, it } from 'vitest';
import {
  ariaSort,
  compareValues,
  defaultDir,
  isMissing,
  nextSort,
  type SortValue,
  sortRows,
  toSortValue,
} from './sorting';

const by = <T>(rows: T[], key: (r: T) => SortValue, dir: 'asc' | 'desc') => sortRows(rows, key, dir);

describe('compareValues', () => {
  it('orders numbers, bigints and mixed number/bigint', () => {
    expect(compareValues(1, 2)).toBe(-1);
    expect(compareValues(2n, 1n)).toBe(1);
    expect(compareValues(2, 2n)).toBe(0);
    expect(compareValues(10n ** 20n, 1e19)).toBe(1);
    expect(compareValues(Number.POSITIVE_INFINITY, 5)).toBe(1);
  });

  it('orders strings with numeric, case-insensitive collation', () => {
    expect(compareValues('node2', 'node10')).toBeLessThan(0);
    expect(compareValues('1.2.3.4:16127', '1.2.3.10:16127')).toBeLessThan(0);
    expect(compareValues('Alpha', 'alpha')).toBe(0);
  });

  it('orders booleans false before true and dates by time', () => {
    expect(compareValues(false, true)).toBe(-1);
    expect(compareValues(new Date(2026, 0, 2), new Date(2026, 0, 1))).toBeGreaterThan(0);
  });
});

describe('isMissing / toSortValue', () => {
  it('treats nullish, NaN and invalid dates as missing', () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing(Number.NaN)).toBe(true);
    expect(isMissing(new Date('nope'))).toBe(true);
    expect(isMissing(0)).toBe(false);
    expect(isMissing('')).toBe(false);
    expect(isMissing(false)).toBe(false);
  });

  it('narrows arbitrary values to sort keys', () => {
    expect(toSortValue(3)).toBe(3);
    expect(toSortValue({})).toBeNull();
    expect(toSortValue(() => 1)).toBeNull();
    const d = new Date();
    expect(toSortValue(d)).toBe(d);
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 'a', n: 3 },
    { id: 'b', n: null },
    { id: 'c', n: 1 },
    { id: 'd', n: Number.NaN },
    { id: 'e', n: 2 },
    { id: 'f', n: 1 },
  ] as Array<{ id: string; n: number | null }>;

  it('sorts ascending with missing values last', () => {
    expect(by(rows, (r) => r.n, 'asc').map((r) => r.id)).toEqual(['c', 'f', 'e', 'a', 'b', 'd']);
  });

  it('sorts descending with missing values still last', () => {
    expect(by(rows, (r) => r.n, 'desc').map((r) => r.id)).toEqual(['a', 'e', 'c', 'f', 'b', 'd']);
  });

  it('is stable for equal keys in both directions', () => {
    const ties = [
      { id: 1, k: 'x' },
      { id: 2, k: 'x' },
      { id: 3, k: 'x' },
    ];
    expect(by(ties, (r) => r.k, 'asc').map((r) => r.id)).toEqual([1, 2, 3]);
    expect(by(ties, (r) => r.k, 'desc').map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('does not mutate its input and reads each key once', () => {
    const input = [{ v: 2 }, { v: 1 }];
    let reads = 0;
    const out = sortRows(
      input,
      (r) => {
        reads++;
        return r.v;
      },
      'asc',
    );
    expect(input.map((r) => r.v)).toEqual([2, 1]);
    expect(out.map((r) => r.v)).toEqual([1, 2]);
    expect(reads).toBe(2);
  });

  it('handles empty input', () => {
    expect(sortRows([], () => 1, 'asc')).toEqual([]);
  });
});

describe('nextSort', () => {
  it('cycles default, opposite, none on one column', () => {
    let s = nextSort(null, 'rank', 'desc');
    expect(s).toEqual({ id: 'rank', dir: 'desc' });
    s = nextSort(s, 'rank', 'desc');
    expect(s).toEqual({ id: 'rank', dir: 'asc' });
    s = nextSort(s, 'rank', 'desc');
    expect(s).toBeNull();
  });

  it('starts another column in its own default direction', () => {
    expect(nextSort({ id: 'rank', dir: 'asc' }, 'name', 'asc')).toEqual({ id: 'name', dir: 'asc' });
  });
});

describe('defaultDir / ariaSort', () => {
  it('numeric columns start descending unless told otherwise', () => {
    expect(defaultDir({ numeric: true })).toBe('desc');
    expect(defaultDir({})).toBe('asc');
    expect(defaultDir({ numeric: true, defaultSortDir: 'asc' })).toBe('asc');
  });

  it('maps a sort state to aria-sort', () => {
    expect(ariaSort({ id: 'a', dir: 'asc' }, 'a')).toBe('ascending');
    expect(ariaSort({ id: 'a', dir: 'desc' }, 'a')).toBe('descending');
    expect(ariaSort({ id: 'a', dir: 'desc' }, 'b')).toBe('none');
    expect(ariaSort(null, 'a')).toBe('none');
  });
});

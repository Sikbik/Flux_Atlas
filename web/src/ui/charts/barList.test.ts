import { describe, expect, it } from 'vitest';
import { barFraction, barScale, columnCh, defaultDisplay, isTruncated, visibleItems } from './barList';

describe('barScale', () => {
  it('uses the largest value by default', () => {
    expect(barScale([3, 9, null, 4])).toBe(9);
    expect(barScale([])).toBe(0);
    expect(barScale([null, null])).toBe(0);
  });

  it('prefers a given total, then a given max', () => {
    expect(barScale([3, 9], 100)).toBe(100);
    expect(barScale([3, 9], undefined, 50)).toBe(50);
    expect(barScale([3, 9], 100, 50)).toBe(100);
  });

  it('ignores a non-positive total or max', () => {
    expect(barScale([3, 9], 0)).toBe(9);
    expect(barScale([3, 9], -5, -1)).toBe(9);
  });
});

describe('barFraction', () => {
  it('is value over scale, capped at one', () => {
    expect(barFraction(5, 10)).toBe(0.5);
    expect(barFraction(10, 10)).toBe(1);
    expect(barFraction(12, 10)).toBe(1);
  });

  it('gives no bar to unknown, zero, negative or non-finite values or an empty scale', () => {
    expect(barFraction(null, 10)).toBe(0);
    expect(barFraction(undefined, 10)).toBe(0);
    expect(barFraction(0, 10)).toBe(0);
    expect(barFraction(-3, 10)).toBe(0);
    expect(barFraction(Number.NaN, 10)).toBe(0);
    expect(barFraction(5, 0)).toBe(0);
  });
});

describe('defaultDisplay', () => {
  it('groups integers and never shows a missing value as zero', () => {
    expect(defaultDisplay(1450)).toBe('1,450');
    expect(defaultDisplay(0)).toBe('0');
    expect(defaultDisplay(null)).toBe('Unknown');
    expect(defaultDisplay(undefined)).toBe('Unknown');
  });
});

describe('columnCh', () => {
  it('is the longest text cell plus half a character', () => {
    expect(columnCh(['1,450', '97', '1,157'])).toBe(5.5);
    expect(columnCh([12, 3456])).toBe(4.5);
  });

  it('ignores cells that are not text and returns 0 when none are', () => {
    expect(columnCh([{}, null, undefined])).toBe(0);
    expect(columnCh([])).toBe(0);
    expect(columnCh(['ab', {}])).toBe(2.5);
  });
});

describe('visibleItems and isTruncated', () => {
  const rows = [1, 2, 3, 4, 5];

  it('shows everything without a limit, when expanded, or when the list is short', () => {
    expect(visibleItems(rows, undefined, false)).toEqual(rows);
    expect(visibleItems(rows, 3, true)).toEqual(rows);
    expect(visibleItems(rows, 5, false)).toEqual(rows);
    expect(visibleItems(rows, 0, false)).toEqual(rows);
  });

  it('cuts to the limit while collapsed', () => {
    expect(visibleItems(rows, 3, false)).toEqual([1, 2, 3]);
  });

  it('knows when a toggle is needed', () => {
    expect(isTruncated(5, 3)).toBe(true);
    expect(isTruncated(3, 3)).toBe(false);
    expect(isTruncated(5, undefined)).toBe(false);
    expect(isTruncated(5, 0)).toBe(false);
  });
});

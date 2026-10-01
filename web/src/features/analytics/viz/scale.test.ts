import { describe, expect, it } from 'vitest';
import {
  areaPath,
  compactTick,
  extent,
  linear,
  linePath,
  nearestIndex,
  niceTicks,
  stack,
  timeTicks,
} from './scale';

describe('linear', () => {
  it('maps the domain to the range and back', () => {
    const f = linear([0, 100], [10, 210]);
    expect(f(0)).toBe(10);
    expect(f(50)).toBe(110);
    expect(f(100)).toBe(210);
    expect(f.invert(110)).toBe(50);
  });

  it('centres a degenerate domain', () => {
    expect(linear([5, 5], [0, 100])(5)).toBe(50);
  });

  it('can flip for a y axis', () => {
    const y = linear([0, 10], [100, 0]);
    expect(y(0)).toBe(100);
    expect(y(10)).toBe(0);
  });
});

describe('niceTicks', () => {
  it('rounds to clean values that cover the data', () => {
    const t = niceTicks(3, 97, 5);
    expect(t.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(t.min).toBe(0);
    expect(t.max).toBe(100);
  });

  it('works for supply-sized and fractional ranges', () => {
    const big = niceTicks(430_000_000, 560_000_000, 5);
    expect(big.ticks[0]!).toBeLessThanOrEqual(430_000_000);
    expect(big.ticks.at(-1)!).toBeGreaterThanOrEqual(560_000_000);
    const small = niceTicks(0.1, 0.35, 5);
    expect(small.ticks).toContain(0.2);
    expect(small.ticks.every((v) => !String(v).includes('0000000'))).toBe(true);
  });

  it('survives equal and non-finite inputs', () => {
    expect(niceTicks(5, 5).ticks.length).toBeGreaterThan(1);
    expect(niceTicks(Number.NaN, 1).ticks).toEqual([0]);
  });
});

describe('timeTicks', () => {
  const H = 3_600_000;
  const D = 24 * H;
  const base = Date.UTC(2026, 8, 28, 0, 0, 0);

  it('uses clock times under a day and marks midnight as a date', () => {
    const t = timeTicks(base + 2 * H, base + 30 * H, 6);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(7);
    const midnight = t.find((x) => x.t === base + D);
    expect(midnight?.label).toBe('Sep 29');
    expect(midnight?.major).toBe(true);
    const clock = t.find((x) => !x.major);
    expect(clock?.label).toMatch(/^\d\d:\d\d$/);
  });

  it('uses dates for a month of data', () => {
    const t = timeTicks(base, base + 30 * D, 6);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.every((x) => /^[A-Z][a-z]{2} \d{1,2}$/.test(x.label))).toBe(true);
  });

  it('uses month starts and years for long spans', () => {
    const t = timeTicks(Date.UTC(2026, 9, 1), Date.UTC(2046, 0, 1), 6);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.every((x) => /^\d{4}$/.test(x.label))).toBe(true);
    for (const x of t) expect(new Date(x.t).getUTCMonth()).toBe(0);
    const halfYear = timeTicks(Date.UTC(2026, 0, 1), Date.UTC(2028, 0, 1), 6);
    expect(halfYear.length).toBeGreaterThanOrEqual(3);
    expect(halfYear.some((x) => x.label === '2027')).toBe(true);
  });

  it('is empty for an empty span', () => {
    expect(timeTicks(10, 10)).toEqual([]);
    expect(timeTicks(10, 5)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 40];
  it('finds the closest x', () => {
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 29)).toBe(2);
    expect(nearestIndex(xs, 31)).toBe(3);
    expect(nearestIndex(xs, 999)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('paths', () => {
  it('breaks the line at unknown values', () => {
    expect(linePath([0, 1, 2, 3], [1, null, 3, 4])).toBe('M0 1M2 3L3 4');
  });

  it('draws a step-after line', () => {
    expect(linePath([0, 10, 20], [1, 2, 3], { step: true })).toBe('M0 1H10V2H20V3');
  });

  it('closes an area against a baseline and splits at gaps', () => {
    const d = areaPath([0, 1, 2, 3], [5, 6, null, 7], 10);
    expect(d.split('Z')).toHaveLength(3); // two closed pieces
    expect(d).toContain('L1 10');
    expect(d.startsWith('M0 5')).toBe(true);
  });

  it('stacks values and drops the stack where any part is unknown', () => {
    const s = stack([
      [1, 2, null],
      [10, 20, 30],
    ]);
    expect(s.tops[1]).toEqual([11, 22, null]);
    expect(s.bottoms[1]).toEqual([1, 2, null]);
    expect(s.bottoms[0]).toEqual([0, 0, null]);
  });
});

describe('extent and compactTick', () => {
  it('finds the finite range and ignores nulls', () => {
    expect(extent([3, null, 1], [Number.NaN, 9])).toEqual([1, 9]);
    expect(extent([null])).toBeNull();
  });

  it('formats compact axis labels', () => {
    expect(compactTick(0)).toBe('0');
    expect(compactTick(950)).toBe('950');
    expect(compactTick(2000)).toBe('2K');
    expect(compactTick(12_500)).toBe('12.5K');
    expect(compactTick(430_000_000)).toBe('430M');
    expect(compactTick(1_500_000_000)).toBe('1.5B');
    expect(compactTick(0.25)).toBe('0.25');
  });
});

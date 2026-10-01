import { describe, expect, it } from 'vitest';
import { compactTickAt, linear, niceTicks, timeTicks } from './scale';

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

describe('compactTickAt', () => {
  it('keeps the digits the step needs', () => {
    expect(compactTickAt(10_160_000, 10_000)).toBe('10.16M');
    expect(compactTickAt(10_170_000, 10_000)).toBe('10.17M');
    expect(compactTickAt(12_500, 2_500)).toBe('12.5K');
    expect(compactTickAt(15_000, 5_000)).toBe('15K');
    expect(compactTickAt(2_000_000, 500_000)).toBe('2.0M');
    expect(compactTickAt(2_500_000, 500_000)).toBe('2.5M');
  });

  it('handles small and fractional values', () => {
    expect(compactTickAt(0, 0.5)).toBe('0.0');
    expect(compactTickAt(1.5, 0.5)).toBe('1.5');
    expect(compactTickAt(40, 20)).toBe('40');
    expect(compactTickAt(0.0025, 0.0005)).toBe('0.0025');
  });
});

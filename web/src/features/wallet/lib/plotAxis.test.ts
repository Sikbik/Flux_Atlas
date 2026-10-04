import { describe, expect, it } from 'vitest';
import { axisAround, axisCount, axisFromZero, dayDomain, fluxTick, roundedTop } from './plotAxis';

describe('axisFromZero', () => {
  it('runs from zero to a little over the data, on round ticks', () => {
    const a = axisFromZero(980);
    expect(a.lo).toBe(0);
    expect(a.hi).toBeGreaterThanOrEqual(980);
    expect(a.ticks[0]).toBe(0);
    expect(a.ticks.at(-1)).toBe(a.hi);
    // The ticks are evenly spaced by the step.
    for (let i = 1; i < a.ticks.length; i++) {
      expect((a.ticks[i] as number) - (a.ticks[i - 1] as number)).toBeCloseTo(a.step, 9);
    }
  });

  it('gives an empty or all-zero chart a zero to one axis', () => {
    for (const max of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(axisFromZero(max)).toEqual({ lo: 0, hi: 1, ticks: [0, 0.5, 1], step: 0.5 });
    }
  });
});

describe('axisCount', () => {
  it('puts a whole number at every tick', () => {
    for (const max of [1, 2, 3, 5, 7, 12, 40, 208, 1240]) {
      const a = axisCount(max);
      expect(a.lo).toBe(0);
      expect(a.hi).toBeGreaterThanOrEqual(max);
      for (const t of a.ticks) expect(Number.isInteger(t)).toBe(true);
      expect(a.step).toBeGreaterThanOrEqual(1);
    }
  });

  it('is zero and one for no count, and for one node is zero and one, not a half', () => {
    expect(axisCount(0)).toEqual({ lo: 0, hi: 1, ticks: [0, 1], step: 1 });
    expect(axisCount(Number.NaN).ticks).toEqual([0, 1]);
    expect(axisCount(1)).toEqual({ lo: 0, hi: 1, ticks: [0, 1], step: 1 });
  });

  it('counts up by one for a handful, and by round steps for a big fleet', () => {
    expect(axisCount(3).step).toBe(1);
    expect(axisCount(208).step).toBeGreaterThanOrEqual(50);
  });
});

describe('axisAround', () => {
  it('spans data that does not start at zero', () => {
    const a = axisAround(940, 990);
    expect(a.lo).toBeLessThanOrEqual(940);
    expect(a.hi).toBeGreaterThanOrEqual(990);
    expect(a.lo).toBeGreaterThan(0);
  });

  it('copes with a flat line and with garbage', () => {
    const flat = axisAround(5, 5);
    expect(flat.lo).toBeLessThan(5);
    expect(flat.hi).toBeGreaterThan(5);
    expect(axisAround(Number.NaN, 4).ticks).toEqual([0, 0.5, 1]);
  });
});

describe('fluxTick', () => {
  it('labels with only the precision the step needs', () => {
    expect(fluxTick(0, 500)).toBe('0');
    expect(fluxTick(1500, 500)).toBe('1.5K');
    expect(fluxTick(2_000_000, 500_000)).toBe('2.0M');
    expect(fluxTick(2_000_000, 1_000_000)).toBe('2M');
  });
});

describe('dayDomain', () => {
  const DAY = 86_400_000;
  it('runs from the first day to the end of the last, so the last day has its whole width', () => {
    expect(dayDomain([10 * DAY, 11 * DAY, 12 * DAY])).toEqual([10 * DAY, 13 * DAY]);
    expect(dayDomain([5 * DAY])).toEqual([5 * DAY, 6 * DAY]);
  });

  it('has one day for no days at all', () => {
    expect(dayDomain([])).toEqual([0, DAY]);
  });
});

describe('roundedTop', () => {
  it('draws a plain bar when there is nothing to round', () => {
    expect(roundedTop(0, 10, 8, 20, 0)).toBe('M0 30V10H8V30Z');
  });

  it('rounds the upper corners only', () => {
    const d = roundedTop(0, 0, 10, 20, 3);
    expect(d.startsWith('M0 20V3Q0 0 3 0H7Q10 0 10 3V20Z')).toBe(true);
  });

  it('never rounds past the bar: half its width, or its height', () => {
    expect(roundedTop(0, 0, 4, 20, 9)).toContain('Q0 0 2 0');
    expect(roundedTop(0, 0, 40, 1, 9)).toContain('V1Q0 0 1 0');
  });
});

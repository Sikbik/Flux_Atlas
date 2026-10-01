import { describe, expect, it } from 'vitest';
import {
  clamp01,
  cubicBezier,
  EASE_OUT_FALLBACK,
  formatSample,
  formatTicks,
  lerp,
  parseCubicBezier,
  r2,
} from './scale';

describe('lerp, clamp01 and r2', () => {
  it('interpolates and clamps', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('rounds to two decimals', () => {
    expect(r2(1.23456)).toBe(1.23);
    expect(r2(1.236)).toBe(1.24);
  });
});

describe('cubicBezier', () => {
  it('maps the endpoints to themselves', () => {
    const f = cubicBezier(0.22, 1, 0.36, 1);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
  });

  it('is monotone and front-loaded for the ease-out token', () => {
    const f = EASE_OUT_FALLBACK;
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const y = f(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    // Ease-out: well past halfway at a third of the time.
    expect(f(1 / 3)).toBeGreaterThan(0.7);
  });

  it('is the identity for a linear curve', () => {
    const f = cubicBezier(0, 0, 1, 1);
    expect(f(0.25)).toBeCloseTo(0.25, 4);
    expect(f(0.75)).toBeCloseTo(0.75, 4);
  });

  it('parses the token string', () => {
    const f = parseCubicBezier('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(f).not.toBeNull();
    expect(f?.(0.5)).toBeCloseTo(EASE_OUT_FALLBACK(0.5), 5);
    expect(parseCubicBezier('linear')).toBeNull();
    expect(parseCubicBezier('')).toBeNull();
  });
});

describe('formatSample', () => {
  it('uses three significant digits below a thousand', () => {
    expect(formatSample(0.07461)).toBe('0.0746');
    expect(formatSample(0.0718)).toBe('0.0718');
    expect(formatSample(12.345)).toBe('12.3');
    expect(formatSample(5)).toBe('5');
  });

  it('groups integers from a thousand', () => {
    expect(formatSample(6727)).toBe('6,727');
    expect(formatSample(2996914)).toBe('2,996,914');
    expect(formatSample(-1500)).toBe('-1,500');
  });

  it('renders Unknown for missing values, never zero', () => {
    expect(formatSample(null)).toBe('Unknown');
    expect(formatSample(undefined)).toBe('Unknown');
    expect(formatSample(Number.NaN)).toBe('Unknown');
  });
});

describe('formatTicks', () => {
  it('uses whole numbers for whole steps', () => {
    expect(formatTicks([6600, 6650, 6700], 50)).toEqual(['6,600', '6,650', '6,700']);
  });

  it('derives the decimal count from the step and keeps it for every label', () => {
    expect(formatTicks([0.07, 0.075, 0.08], 0.005)).toEqual(['0.070', '0.075', '0.080']);
    expect(formatTicks([0, 0.5, 1], 0.5)).toEqual(['0.0', '0.5', '1.0']);
  });

  it('goes compact once the axis reaches ten thousand', () => {
    expect(formatTicks([0, 5000, 10000, 15000], 5000)).toEqual(['0', '5,000', '10K', '15K']);
  });
});

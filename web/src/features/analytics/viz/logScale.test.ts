import { describe, expect, it } from 'vitest';
import { logScale } from './logScale';

describe('logScale', () => {
  const y = logScale([0.001, 1000], [240, 0]);

  it('gives each decade the same height', () => {
    expect(y(0.001)).toBeCloseTo(240);
    expect(y(0.01)).toBeCloseTo(200);
    expect(y(1)).toBeCloseTo(120);
    expect(y(1000)).toBeCloseTo(0);
    expect(y(10) - y(100)).toBeCloseTo(y(0.1) - y(1));
  });

  it('puts a value that is not above zero on the low edge', () => {
    expect(y(0)).toBeCloseTo(240);
    expect(y(-5)).toBeCloseTo(240);
  });

  it('inverts', () => {
    expect(y.invert(120)).toBeCloseTo(1);
    expect(y.invert(y(0.37))).toBeCloseTo(0.37);
  });

  it('keeps its domain and range', () => {
    expect(y.domain).toEqual([0.001, 1000]);
    expect(y.range).toEqual([240, 0]);
  });
});

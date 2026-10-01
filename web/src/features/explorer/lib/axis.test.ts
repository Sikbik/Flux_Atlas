import { describe, expect, it } from 'vitest';
import { axisFormat } from './axis';

describe('axisFormat', () => {
  it('prints plain digits for a balance that barely moves', () => {
    const f = axisFormat([678_101, 678_150, 678_230]);
    expect(f).toBeDefined();
    expect(f?.(678_150)).toBe('678150');
    expect(f?.(678_100)).toBe('678100');
  });

  it('never prints the same label for ticks a few units apart', () => {
    const f = axisFormat([678_100, 678_220]);
    const labels = [678_100, 678_130, 678_160, 678_190, 678_220].map((v) => f?.(v));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps every label within the six characters the gutter holds', () => {
    const f = axisFormat([12_345, 12_380]);
    for (const v of [12_345, 12_360, 12_380]) expect((f?.(v) ?? '').length).toBeLessThanOrEqual(6);
  });

  it('goes bare when the digits cannot fit, rather than clip or repeat', () => {
    const f = axisFormat([100_000_000, 100_000_050]);
    expect(f).toBeDefined();
    expect(f?.(100_000_025)).toBe('');
    // decimals push a mid-sized value past the gutter too
    expect(axisFormat([2_000_000.1, 2_000_000.9])?.(2_000_000.5)).toBe('');
  });

  it('leaves the kit alone when the series travels far', () => {
    expect(axisFormat([0, 700_000])).toBeUndefined();
    expect(axisFormat([430_000_000, 560_000_000])).toBeUndefined();
  });

  it('leaves the kit alone below 10,000, where its labels are exact', () => {
    expect(axisFormat([10, 500])).toBeUndefined();
    expect(axisFormat([3_200, 3_900])).toBeUndefined();
  });

  it('copes with a flat series and with nothing to measure', () => {
    expect(axisFormat([678_150, 678_150])?.(678_150)).toBe('678150');
    expect(axisFormat([])).toBeUndefined();
    expect(axisFormat([Number.NaN])).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { lastDays } from './RunRate';

/** Days as the server sends them: the main chain paid, and what it accrued in parallel assets. */
const day = (native: number, pa = native) => ({ native: native.toFixed(8), pa: pa.toFixed(8) });

describe('lastDays', () => {
  const days = [day(100), day(100), day(110), day(90), day(120), day(80), day(100), day(105), day(95)];

  it('sums the last days with what they accrued in parallel assets, and the days before them', () => {
    // Golden: the last 3 days earned 100 + 105 + 95 on the main chain and as much again.
    expect(lastDays(days, 3, true)).toEqual({ last: 600, before: 580 });
  });

  it('sums the main chain alone when parallel assets do not count', () => {
    expect(lastDays(days, 3, false)).toEqual({ last: 300, before: 290 });
  });

  it('has no earlier window when the days do not reach back that far', () => {
    expect(lastDays(days, 7, true).before).toBeNull();
    expect(lastDays([], 7, true)).toEqual({ last: 0, before: null });
  });

  it('reads the parallel assets the server sent, whatever they are', () => {
    expect(lastDays([day(10, 2.5)], 1, true).last).toBe(12.5);
  });
});

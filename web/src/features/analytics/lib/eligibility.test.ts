import { describe, expect, it } from 'vitest';
import {
  confirmedCounts,
  type EligibleSample,
  expectedByBlock,
  nearestSample,
  sampleTimes,
  sumCounts,
} from './eligibility';

describe('confirmedCounts', () => {
  it('counts only confirmed nodes, by tier', () => {
    // tier codes: 1 cumulus, 2 nimbus, 3 stratus; status codes: 1 confirmed, 2 started, 3 dos, 5 expired
    const tier = [1, 1, 1, 2, 2, 3, 3, 0];
    const status = [1, 1, 2, 1, 3, 1, 5, 1];
    expect(confirmedCounts(tier, status, tier.length)).toEqual({ cumulus: 2, nimbus: 1, stratus: 1 });
  });
  it('is empty for no nodes', () => {
    expect(sumCounts(confirmedCounts([], [], 0))).toBe(0);
  });
});

describe('sampleTimes', () => {
  it('spreads evenly over the span, inside the recorded range', () => {
    expect(sampleTimes(1000, 5000, 0, 10_000, 5)).toEqual([1000, 2000, 3000, 4000, 5000]);
  });
  it('clamps a span that reaches before or after the recording', () => {
    expect(sampleTimes(-5000, 20_000, 0, 10_000, 3)).toEqual([0, 5000, 10_000]);
  });
  it('gives one instant when the span lies wholly outside the recording', () => {
    expect(sampleTimes(-9000, -4000, 0, 10_000, 4)).toEqual([0]);
    expect(sampleTimes(20_000, 30_000, 0, 10_000, 4)).toEqual([10_000]);
  });
  it('gives nothing for no recording or no samples', () => {
    expect(sampleTimes(0, 10, 100, 50, 3)).toEqual([]);
    expect(sampleTimes(0, 10, 0, 10, 0)).toEqual([]);
  });
});

describe('nearestSample', () => {
  const s = (t: number): EligibleSample => ({ t, counts: { cumulus: t, nimbus: 0, stratus: 0 } });
  it('picks the closest in time, the earlier on a tie', () => {
    const list = [s(0), s(100), s(200)];
    expect(nearestSample(list, 120)!.t).toBe(100);
    expect(nearestSample(list, 150)!.t).toBe(100);
    expect(nearestSample(list, 500)!.t).toBe(200);
    expect(nearestSample([], 1)).toBeNull();
  });
});

describe('expectedByBlock', () => {
  const early: EligibleSample = { t: 0, counts: { cumulus: 50, nimbus: 25, stratus: 25 } };
  const late: EligibleSample = { t: 1000, counts: { cumulus: 20, nimbus: 40, stratus: 40 } };

  it("adds each block's eligible share, using the set nearest in time", () => {
    const e = expectedByBlock([0, 100, 900, 1000], [early, late], { cumulus: 1, nimbus: 1, stratus: 1 });
    // Two blocks judged against `early` (0.5, 0.25, 0.25), two against `late` (0.2, 0.4, 0.4).
    expect(e.expected.cumulus).toBeCloseTo(2 * 0.5 + 2 * 0.2);
    expect(e.expected.nimbus).toBeCloseTo(2 * 0.25 + 2 * 0.4);
    expect(e.expected.stratus).toBeCloseTo(2 * 0.25 + 2 * 0.4);
    expect(e.variance.cumulus).toBeCloseTo(2 * 0.25 + 2 * 0.16);
  });

  it('keeps the totals equal to the number of blocks', () => {
    const e = expectedByBlock([0, 1, 2, 3, 4], [early], { cumulus: 1, nimbus: 1, stratus: 1 });
    expect(sumCounts(e.expected)).toBeCloseTo(5);
  });

  it('falls back to the given set when there are no samples', () => {
    const e = expectedByBlock([0, 1], [], { cumulus: 2, nimbus: 1, stratus: 1 });
    expect(e.expected.cumulus).toBeCloseTo(1);
    expect(e.expected.nimbus).toBeCloseTo(0.5);
  });

  it('skips a block when no node was eligible', () => {
    const e = expectedByBlock([0], [], { cumulus: 0, nimbus: 0, stratus: 0 });
    expect(sumCounts(e.expected)).toBe(0);
  });
});

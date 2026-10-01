import { describe, expect, it } from 'vitest';
import { CUT_KEEP, FIRST_CUT_HEIGHT, rewardCutView, splitReward } from './rewardcut';

describe('splitReward', () => {
  it('splits 14 FLUX into 1.0, 3.5, 9.0 and 0.5', () => {
    const s = splitReward(14);
    expect(s.cumulus).toBeCloseTo(1, 10);
    expect(s.nimbus).toBeCloseTo(3.5, 10);
    expect(s.stratus).toBeCloseTo(9, 10);
    expect(s.dev).toBeCloseTo(0.5, 10);
  });

  it('keeps the shares after the cut: 12.6 FLUX is 8.1, 3.15, 0.9 and 0.45', () => {
    const s = splitReward(14 * CUT_KEEP);
    expect(s.total).toBeCloseTo(12.6, 10);
    expect(s.stratus).toBeCloseTo(8.1, 10);
    expect(s.nimbus).toBeCloseTo(3.15, 10);
    expect(s.cumulus).toBeCloseTo(0.9, 10);
    expect(s.dev).toBeCloseTo(0.45, 10);
  });
});

describe('rewardCutView', () => {
  const tip = { height: FIRST_CUT_HEIGHT - 74_271, timeMs: 1_000_000 };

  it('counts blocks and estimates the time at 30 s per block', () => {
    const v = rewardCutView(FIRST_CUT_HEIGHT, tip, tip.timeMs + 12_000, 14);
    expect(v).not.toBeNull();
    expect(v?.blocksLeft).toBe(74_271);
    expect(v?.atMs).toBe(tip.timeMs + 74_271 * 30_000);
    expect(v?.etaMs).toBe(74_271 * 30_000 - 12_000);
    expect(v?.landed).toBe(false);
  });

  it('reports the before and after split', () => {
    const v = rewardCutView(FIRST_CUT_HEIGHT, tip, tip.timeMs, 14);
    expect(v?.before.stratus).toBeCloseTo(9, 10);
    expect(v?.after.stratus).toBeCloseTo(8.1, 10);
  });

  it('puts progress between the start of Proof of Node and the cut', () => {
    const v = rewardCutView(FIRST_CUT_HEIGHT, tip, tip.timeMs, 14);
    expect(v?.progress).toBeGreaterThan(0.92);
    expect(v?.progress).toBeLessThan(0.94);
  });

  it('is null without a reduction height or a tip (unknown is never zero)', () => {
    expect(rewardCutView(null, tip, 0, 14)).toBeNull();
    expect(rewardCutView(FIRST_CUT_HEIGHT, null, 0, 14)).toBeNull();
  });

  it('clamps to landed once the tip reaches the cut', () => {
    const v = rewardCutView(FIRST_CUT_HEIGHT, { height: FIRST_CUT_HEIGHT + 3, timeMs: 5 }, 100_000, 12.6);
    expect(v?.landed).toBe(true);
    expect(v?.blocksLeft).toBe(0);
    expect(v?.etaMs).toBe(0);
    expect(v?.progress).toBe(1);
  });
});

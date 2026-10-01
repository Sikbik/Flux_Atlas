import { describe, expect, it } from 'vitest';
import {
  ANNOUNCED_MAX_SUPPLY_FLUX,
  allCuts,
  COIN,
  emittedBetween,
  estimateTimeMs,
  FIRST_REDUCTION_HEIGHT,
  heightReachingSupply,
  MAX_REDUCTIONS,
  nextReductionHeight,
  PON_ACTIVATION_HEIGHT,
  payoutSchedule,
  projectEmission,
  REDUCTION_INTERVAL,
  reductionHeight,
  reductionsAt,
  satsToFlux,
  subsidyAt,
  tierPayoutAt,
} from './emission';

const flux = (s: string): bigint => {
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w) * COIN + BigInt(f.padEnd(8, '0').slice(0, 8));
};

describe('subsidy schedule (mirrors atlas_core::emission)', () => {
  it('is 14 FLUX from activation and cut by 10% every 1,051,200 blocks', () => {
    expect(subsidyAt(PON_ACTIVATION_HEIGHT - 1)).toBeNull();
    expect(subsidyAt(2_020_000)).toBe(flux('14'));
    expect(subsidyAt(3_071_199)).toBe(flux('14'));
    expect(subsidyAt(3_071_200)).toBe(flux('12.6'));
    expect(subsidyAt(4_122_400)).toBe(flux('11.34'));
  });

  it('floors after twenty cuts and stays constant', () => {
    expect(subsidyAt(23_043_999)).not.toBe(subsidyAt(23_044_000));
    expect(subsidyAt(23_044_000)).toBe(flux('1.70207313'));
    expect(subsidyAt(40_000_000)).toBe(flux('1.70207313'));
    expect(reductionsAt(23_044_000)).toBe(20);
    expect(reductionsAt(23_043_999)).toBe(19);
  });

  it('finds the next cut', () => {
    expect(FIRST_REDUCTION_HEIGHT).toBe(3_071_200);
    expect(nextReductionHeight(2_996_914)).toBe(3_071_200);
    expect(nextReductionHeight(3_071_200)).toBe(4_122_400);
    expect(nextReductionHeight(23_044_000)).toBeNull();
    expect(nextReductionHeight(1_000_000)).toBe(3_071_200);
  });
});

describe('tier split', () => {
  it('pays 1 / 3.5 / 9 and 0.5 to the dev fund before the first cut', () => {
    const s = payoutSchedule(2_996_914)!;
    expect(s.cumulus).toBe(flux('1'));
    expect(s.nimbus).toBe(flux('3.5'));
    expect(s.stratus).toBe(flux('9'));
    expect(s.devFundMin).toBe(flux('0.5'));
  });

  it('pays 0.9 / 3.15 / 8.1 and 0.45 after the first cut', () => {
    const s = payoutSchedule(3_071_200)!;
    expect(s.cumulus).toBe(flux('0.9'));
    expect(s.nimbus).toBe(flux('3.15'));
    expect(s.stratus).toBe(flux('8.1'));
    expect(s.devFundMin).toBe(flux('0.45'));
    expect(tierPayoutAt(3_071_200, 'stratus')).toBe(flux('8.1'));
  });

  it('sums exactly to the subsidy at every cut', () => {
    for (const c of allCuts()) {
      const s = c.schedule;
      expect(s.cumulus + s.nimbus + s.stratus + s.devFundMin).toBe(s.subsidy);
      expect(s.devFundMin >= 0n).toBe(true);
    }
    expect(allCuts()).toHaveLength(MAX_REDUCTIONS);
  });
});

describe('emission totals', () => {
  it('sums subsidy over a range in closed form', () => {
    expect(emittedBetween(2_020_000, 2_020_010)).toBe(10n * flux('14'));
    // Across the first cut: 3 blocks at 14 and 2 at 12.6.
    expect(emittedBetween(3_071_197, 3_071_202)).toBe(3n * flux('14') + 2n * flux('12.6'));
    expect(emittedBetween(10, 5)).toBe(0n);
  });

  it('matches a brute-force sum over several periods', () => {
    let brute = 0n;
    const from = 3_071_000;
    const to = 3_071_000 + 3_000;
    for (let h = from; h < to; h++) brute += subsidyAt(h)!;
    expect(emittedBetween(from, to)).toBe(brute);
  });

  it('emits the schedule total through the twentieth cut, about 129 million FLUX', () => {
    const total = satsToFlux(emittedBetween(PON_ACTIVATION_HEIGHT, reductionHeight(MAX_REDUCTIONS)));
    expect(total).toBeGreaterThan(129_000_000);
    expect(total).toBeLessThan(130_000_000);
  });

  it('ignores blocks before PoN', () => {
    expect(emittedBetween(1_000_000, PON_ACTIVATION_HEIGHT)).toBe(0n);
    expect(emittedBetween(PON_ACTIVATION_HEIGHT - 5, PON_ACTIVATION_HEIGHT + 5)).toBe(5n * flux('14'));
  });
});

describe('projection', () => {
  it('starts at the tip supply and is monotone, with sharp steps at every cut', () => {
    const pts = projectEmission(2_997_000, 430_000_000, 5_500_000);
    expect(pts[0]!.height).toBe(2_997_000);
    expect(pts[0]!.supply).toBe(430_000_000);
    expect(pts.at(-1)!.height).toBe(5_500_000);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.height).toBeGreaterThan(pts[i - 1]!.height);
      expect(pts[i]!.supply).toBeGreaterThanOrEqual(pts[i - 1]!.supply);
    }
    const heights = pts.map((p) => p.height);
    expect(heights).toContain(3_071_199);
    expect(heights).toContain(3_071_200);
    const before = pts.find((p) => p.height === 3_071_199)!;
    const after = pts.find((p) => p.height === 3_071_200)!;
    expect(before.subsidy).toBe(14);
    expect(after.subsidy).toBeCloseTo(12.6, 8);
  });

  it('accumulates the dev fund minimum output', () => {
    const pts = projectEmission(2_997_000, 430_000_000, 3_000_000, 10);
    // 3,000 blocks at 0.5 FLUX.
    expect(pts.at(-1)!.devFund).toBeCloseTo(1_500, 6);
  });

  it('reaches the announced 560M only after the last cut (the schedule alone sums to about 546M)', () => {
    const h = heightReachingSupply(2_997_000, 430_665_000, ANNOUNCED_MAX_SUPPLY_FLUX);
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThan(reductionHeight(MAX_REDUCTIONS));
    const at = 430_665_000 + satsToFlux(emittedBetween(2_997_000, h!));
    expect(at).toBeGreaterThanOrEqual(ANNOUNCED_MAX_SUPPLY_FLUX);
    const justBefore = 430_665_000 + satsToFlux(emittedBetween(2_997_000, h! - 1));
    expect(justBefore).toBeLessThan(ANNOUNCED_MAX_SUPPLY_FLUX);
  });

  it('returns the tip when the target is already reached', () => {
    expect(heightReachingSupply(2_997_000, 600_000_000, ANNOUNCED_MAX_SUPPLY_FLUX)).toBe(2_997_000);
  });

  it('estimates a height time from the tip at 30 s per block', () => {
    expect(estimateTimeMs(100 + 120, { height: 100, timeMs: 1_000 })).toBe(1_000 + 120 * 30_000);
  });

  it('keeps the interval constant', () => {
    expect(REDUCTION_INTERVAL).toBe(1_051_200);
  });
});

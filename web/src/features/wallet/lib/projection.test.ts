import { describe, expect, it } from 'vitest';
import type { ProjectionDay, RewardReduction } from '../types';
import { DAY_MS, MONTH_DAYS } from './money';
import {
  buildProjection,
  dayStart,
  factorText,
  NO_COSTS,
  parseCostInput,
  profitability,
  SCENARIO_MAX,
  SCENARIO_MIN,
  scenarioFactor,
  scenarioStep,
} from './projection';

const START = Date.UTC(2026, 9, 3);

/** 365 days at 3,024 FLUX a day of each kind, a tenth less from day `cutAt` on. */
function days(cutAt: number | null, n = 365): ProjectionDay[] {
  return Array.from({ length: n }, (_, i) => {
    const k = cutAt !== null && i >= cutAt ? 0.9 : 1;
    return {
      day_ms: START + i * DAY_MS,
      native: (3024 * k).toFixed(8),
      pa: (3024 * k).toFixed(8),
    };
  });
}

const reduction = (daysAhead: number): RewardReduction => ({
  height: 3_071_200,
  eta_ms: START + daysAhead * DAY_MS + 5 * 3_600_000,
  subsidy_before: '14.00000000',
  subsidy_after: '12.60000000',
});

describe('buildProjection', () => {
  it('turns days into columns and totals them', () => {
    const p = buildProjection(days(null, 10), null, true);
    expect(p.t).toHaveLength(10);
    expect(p.native[0]).toBe(3024);
    expect(p.total[0]).toBe(6048);
    expect(p.cumulative[9]).toBe(60480);
    expect(p.sums).toEqual({ native: 30240, pa: 30240, total: 60480 });
    expect(p.step).toBeNull();
  });

  it('leaves the parallel assets out of the total when they do not count', () => {
    const p = buildProjection(days(null, 10), null, false);
    expect(p.total[0]).toBe(3024);
    expect(p.sums.total).toBe(30240);
    expect(p.sums.pa).toBe(30240);
  });

  it('marks the reward cut on the day it falls, with the rate before and after', () => {
    const p = buildProjection(days(23), reduction(23), true);
    expect(p.step).not.toBeNull();
    expect(p.step?.index).toBe(23);
    expect(p.step?.t).toBe(START + 23 * DAY_MS);
    expect(p.step?.before).toBe(6048);
    expect(p.step?.after).toBeCloseTo(5443.2, 6);
    expect(p.step?.change).toBeCloseTo(-0.1, 10);
    expect(p.step?.height).toBe(3_071_200);
  });

  it('draws no step for a cut beyond the year, or one already past', () => {
    expect(buildProjection(days(null), reduction(400), true).step).toBeNull();
    expect(buildProjection(days(null), reduction(-3), true).step).toBeNull();
  });

  it('copes with an empty projection', () => {
    const p = buildProjection([], reduction(10), true);
    expect(p.t).toEqual([]);
    expect(p.sums.total).toBe(0);
    expect(p.step).toBeNull();
  });
});

describe('dayStart', () => {
  it('floors to the UTC day', () => {
    expect(dayStart(START + 17 * 3_600_000)).toBe(START);
  });
});

describe('the price scenario', () => {
  it('is today at step 0, ten times at the top and a tenth at the bottom', () => {
    expect(scenarioFactor(0)).toBe(1);
    expect(scenarioFactor(SCENARIO_MAX)).toBeCloseTo(10, 10);
    expect(scenarioFactor(SCENARIO_MIN)).toBeCloseTo(0.1, 10);
  });

  it('clamps and rounds a step', () => {
    expect(scenarioFactor(99)).toBeCloseTo(10, 10);
    expect(scenarioFactor(-99)).toBeCloseTo(0.1, 10);
    expect(scenarioFactor(0.4)).toBe(1);
  });

  it('turns a multiple back into the nearest step', () => {
    expect(scenarioStep(1)).toBe(0);
    expect(scenarioStep(10)).toBe(20);
    expect(scenarioStep(2)).toBe(6);
    expect(scenarioStep(0.5)).toBe(-6);
    expect(scenarioStep(1000)).toBe(SCENARIO_MAX);
    expect(scenarioStep(0)).toBe(0);
  });

  it('says a multiple the way it reads beside the slider', () => {
    expect(factorText(1)).toBe('Today');
    expect(factorText(2)).toBe('2.0x');
    expect(factorText(10)).toBe('10x');
    expect(factorText(0.5)).toBe('0.50x');
  });
});

describe('profitability', () => {
  const base = {
    nativePerDay: 3024,
    paPerDay: 3024,
    includePa: true,
    nodes: { cumulus: 0, nimbus: 0, stratus: 208 },
    collateralFlux: 8_320_000,
    price: 0.0747,
    costs: { cumulus: 0, nimbus: 0, stratus: 20 },
  };

  it('works out net, margin, yield on collateral and the break-even price', () => {
    const p = profitability(base);
    const fluxMonthly = 6048 * MONTH_DAYS;
    expect(p.fluxMonthly).toBeCloseTo(fluxMonthly, 6);
    expect(p.revenue).toBeCloseTo(fluxMonthly * 0.0747, 6);
    expect(p.cost).toBe(208 * 20);
    expect(p.net).toBeCloseTo(fluxMonthly * 0.0747 - 4160, 6);
    expect(p.margin).toBeCloseTo((p.net as number) / (p.revenue as number), 10);
    expect(p.apr).toBeCloseTo(((p.net as number) * 12) / (8_320_000 * 0.0747), 10);
    expect(p.breakEven).toBeCloseTo(4160 / fluxMonthly, 10);
    expect(p.costed).toBe(true);
  });

  it('counts only native earnings when the parallel assets are not income', () => {
    const p = profitability({ ...base, includePa: false });
    expect(p.fluxMonthly).toBeCloseTo(3024 * MONTH_DAYS, 6);
    expect(p.breakEven).toBeCloseTo(4160 / (3024 * MONTH_DAYS), 10);
  });

  it('reads a loss as a negative margin and a break-even above the price', () => {
    const p = profitability({ ...base, price: 0.01 });
    expect(p.net).toBeLessThan(0);
    expect(p.margin).toBeLessThan(0);
    expect(p.breakEven).toBeGreaterThan(0.01);
  });

  it('has no break-even and says nothing was costed when no cost is entered', () => {
    const p = profitability({ ...base, costs: NO_COSTS.perNode });
    expect(p.cost).toBe(0);
    expect(p.costed).toBe(false);
    expect(p.breakEven).toBeNull();
    expect(p.net).toBe(p.revenue);
  });

  it('has no money without a price, but still counts FLUX and cost', () => {
    const p = profitability({ ...base, price: null });
    expect(p.revenue).toBeNull();
    expect(p.net).toBeNull();
    expect(p.margin).toBeNull();
    expect(p.apr).toBeNull();
    expect(p.fluxMonthly).toBeGreaterThan(0);
    expect(p.cost).toBe(4160);
    expect(p.breakEven).toBeCloseTo(4160 / p.fluxMonthly, 10);
  });

  it('costs each tier by its own nodes', () => {
    const p = profitability({
      ...base,
      nodes: { cumulus: 3, nimbus: 2, stratus: 1 },
      costs: { cumulus: 5, nimbus: 10, stratus: 40 },
    });
    expect(p.perTier.map((t) => t.cost)).toEqual([15, 20, 40]);
    expect(p.cost).toBe(75);
  });

  it('has no margin or yield for an empty fleet', () => {
    const p = profitability({
      ...base,
      nativePerDay: 0,
      paPerDay: 0,
      nodes: { cumulus: 0, nimbus: 0, stratus: 0 },
      collateralFlux: 0,
    });
    expect(p.margin).toBeNull();
    expect(p.apr).toBeNull();
    expect(p.breakEven).toBeNull();
  });
});

describe('parseCostInput', () => {
  it('reads a number, with grouping and without a leading digit', () => {
    expect(parseCostInput('20')).toBe(20);
    expect(parseCostInput('1,250.50')).toBe(1250.5);
    expect(parseCostInput('.5')).toBe(0.5);
  });

  it('treats an empty field as no cost', () => {
    expect(parseCostInput('')).toBe(0);
    expect(parseCostInput('   ')).toBe(0);
  });

  it('refuses anything that is not a plain non-negative number', () => {
    expect(parseCostInput('-5')).toBeNull();
    expect(parseCostInput('12abc')).toBeNull();
    expect(parseCostInput('1e3')).toBeNull();
    expect(parseCostInput('1.2.3')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { SupplyDto } from '../../../../api/generated/SupplyDto';
import { lockedCollateral, supplyGlance } from './supply';

const TIERS = [
  { tier: 'cumulus', count: 3421, collateral: '1000.00000000' },
  { tier: 'nimbus', count: 1638, collateral: '12500.00000000' },
  { tier: 'stratus', count: 1782, collateral: '40000.00000000' },
];

function dto(over: Partial<NonNullable<SupplyDto['supply']>> | null = {}): SupplyDto {
  return {
    supply:
      over === null
        ? null
        : {
            height: 3_010_000,
            transparent: '420000000.00000000',
            shielded: '10800000.00000000',
            total: '430800000.00000000',
            circulating_explorer: '420900000.00000000',
            updated_ms: 1,
            ...over,
          },
    reward: '14.00000000',
    emission_per_day: '40320.00000000',
    next_reduction_height: 3_071_200,
    blocks_to_reduction: 61_200,
    max_supply_reference: '560000000.00000000',
  };
}

describe('lockedCollateral', () => {
  it('multiplies the confirmed nodes of each tier by their collateral', () => {
    expect(lockedCollateral(TIERS)).toBe(3421 * 1000 + 1638 * 12500 + 1782 * 40000);
  });

  it('does not guess when a tier is missing', () => {
    expect(lockedCollateral([])).toBeNull();
    expect(lockedCollateral(TIERS.slice(0, 2))).toBeNull();
    expect(
      lockedCollateral([...TIERS.slice(0, 2), { tier: 'stratus', count: 1, collateral: '' }]),
    ).toBeNull();
  });
});

describe('supplyGlance', () => {
  it('splits the total into locked, other transparent and shielded coins that add up to it', () => {
    const g = supplyGlance(dto(), TIERS);
    expect(g.total).toBe(430_800_000);
    expect(g.segments.map((s) => s.id)).toEqual(['locked', 'transparent', 'shielded']);
    expect(g.segments.reduce((s, x) => s + x.value, 0)).toBeCloseTo(430_800_000);
    expect(g.lockedShare).toBeCloseTo(95_176_000 / 430_800_000);
    expect(g.capShare).toBeCloseTo(430_800_000 / 560_000_000);
    expect(g.perDay).toBe(40_320);
    expect(g.circulating).toBe(420_900_000);
  });

  it('leaves the locked part out when the tiers are not known', () => {
    const g = supplyGlance(dto(), []);
    expect(g.locked).toBeNull();
    expect(g.lockedShare).toBeNull();
    expect(g.segments.map((s) => s.id)).toEqual(['transparent', 'shielded']);
  });

  it('leaves it out when more is locked than there are transparent coins (sources that disagree)', () => {
    const g = supplyGlance(
      dto({ transparent: '1000.00000000', total: '1100.00000000', shielded: '100.00000000' }),
      TIERS,
    );
    expect(g.locked).toBeNull();
    expect(g.segments.map((s) => s.id)).toEqual(['transparent', 'shielded']);
  });

  it('is unknown, never zero, when the server has no supply yet', () => {
    const g = supplyGlance(dto(null), TIERS);
    expect(g.total).toBeNull();
    expect(g.circulating).toBeNull();
    expect(g.segments).toEqual([]);
    expect(g.capShare).toBeNull();
    expect(supplyGlance(undefined, TIERS).total).toBeNull();
  });

  it('has no circulating figure when the explorer sent none', () => {
    expect(supplyGlance(dto({ circulating_explorer: null }), TIERS).circulating).toBeNull();
  });
});

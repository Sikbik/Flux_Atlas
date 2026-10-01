import { describe, expect, it } from 'vitest';
import { formatCycle, tierYields } from './economics';

const inputs = [
  { tier: 'cumulus' as const, count: 3380, collateral: 1000, payout: 1, cycleBlocks: 3380 },
  { tier: 'nimbus' as const, count: 1578, collateral: 12_500, payout: 3.5, cycleBlocks: 1578 },
  { tier: 'stratus' as const, count: 1762, collateral: 40_000, payout: 9, cycleBlocks: 1762 },
];

describe('tierYields', () => {
  const [cumulus, nimbus, stratus] = tierYields(inputs);
  it('shares a tier day of payouts across the nodes in its cycle', () => {
    expect(cumulus!.perDay).toBeCloseTo((1 * 2880) / 3380, 6);
    expect(stratus!.perDay).toBeCloseTo((9 * 2880) / 1762, 6);
  });
  it('turns that into a yearly yield on the collateral', () => {
    expect(cumulus!.apy).toBeCloseTo((((1 * 2880) / 3380) * 365) / 1000, 6);
    // The smallest tier yields the most per FLUX locked.
    expect(cumulus!.apy).toBeGreaterThan(nimbus!.apy);
    expect(nimbus!.apy).toBeGreaterThan(stratus!.apy);
  });
  it('gives the hours between two payouts to one node', () => {
    expect(cumulus!.cycleBlocks).toBe(3380);
    expect(cumulus!.cycleHours).toBeCloseTo((3380 * 30) / 3600, 6);
  });
  it('falls back to the node count when the server gives no cycle', () => {
    const [t] = tierYields([{ ...inputs[0]!, cycleBlocks: null }]);
    expect(t!.cycleBlocks).toBe(3380);
    const [z] = tierYields([{ ...inputs[0]!, count: 0, cycleBlocks: null }]);
    expect(z!.cycleBlocks).toBe(1);
  });
  it('scales by the payout change at the next cut', () => {
    const [t] = tierYields([inputs[2]!], { stratus: 8.1 });
    expect(t!.after!.perDay).toBeCloseTo(t!.perDay * 0.9, 6);
    expect(t!.after!.apy).toBeCloseTo(t!.apy * 0.9, 6);
    expect(tierYields([inputs[2]!])[0]!.after).toBeNull();
  });
  it('has no yield without collateral', () => {
    const [t] = tierYields([{ ...inputs[0]!, collateral: 0 }]);
    expect(t!.apy).toBe(0);
  });
});

describe('formatCycle', () => {
  it('speaks in minutes, hours, then days', () => {
    expect(formatCycle(0.5)).toBe('30 minutes');
    expect(formatCycle(28.2)).toBe('28 hours');
    expect(formatCycle(52)).toBe('2 days 4 hours');
    expect(formatCycle(72)).toBe('3 days');
    expect(formatCycle(0)).toBe('unknown');
  });
});

import { describe, expect, it } from 'vitest';
import { amountLabel, amountWords, approxIn, nextPayoutLines, payoutSentence } from './payouts';

const tip = { height: 100, timeMs: 1_000_000 };
const next = {
  height: 101,
  payees: [
    { tier: 'cumulus', node: 3, address: 'a3' },
    { tier: 'stratus', node: 1, address: 'a1' },
    { tier: 'nimbus', node: null, address: 'a2' },
  ],
};
const cities: Record<number, string> = { 1: 'Helsinki', 3: 'Taganrog' };

describe('nextPayoutLines', () => {
  it('orders tiers Stratus, Nimbus, Cumulus and splits the subsidy', () => {
    const lines = nextPayoutLines(next, tip, 1_012_000, 14, (id) => cities[id] ?? null);
    expect(lines.map((l) => l.tier)).toEqual(['stratus', 'nimbus', 'cumulus']);
    expect(lines.map((l) => l.amount)).toEqual([9, 3.5, 1]);
    expect(lines[0]?.city).toBe('Helsinki');
    expect(lines[1]?.city).toBeNull();
  });

  it('estimates the time to the paying block from the tip and the 30 s cadence', () => {
    const lines = nextPayoutLines(next, tip, 1_012_000, 14, () => null);
    expect(lines[0]?.etaMs).toBe(18_000);
  });

  it('is empty before any payees are known', () => {
    expect(nextPayoutLines(null, tip, 0, 14, () => null)).toEqual([]);
  });

  it('skips a tier without a predicted payee', () => {
    const lines = nextPayoutLines(
      { height: 101, payees: [{ tier: 'stratus', node: 1, address: 'a1' }] },
      tip,
      1_000_000,
      14,
      () => 'Helsinki',
    );
    expect(lines).toHaveLength(1);
  });
});

describe('labels', () => {
  it('formats amounts for chips and sentences', () => {
    expect(amountLabel(9)).toBe('9.0');
    expect(amountLabel(3.5)).toBe('3.5');
    expect(amountLabel(3.15)).toBe('3.15');
    expect(amountLabel(0.9)).toBe('0.9');
    expect(amountWords(9)).toBe('9 FLUX');
    expect(amountWords(3.15)).toBe('3.15 FLUX');
  });

  it('marks time estimates with a tilde', () => {
    expect(approxIn(12_400)).toBe('in ~12 s');
    expect(approxIn(0)).toBe('in ~1 s');
    expect(approxIn(5 * 60_000)).toBe('in ~5 min');
    expect(approxIn(14.7 * 3_600_000)).toBe('in ~14.7 h');
  });

  it('writes the ticker sentence', () => {
    const [line] = nextPayoutLines(next, tip, 1_012_000, 14, (id) => cities[id] ?? null);
    expect(line && payoutSentence(line, 'Stratus')).toBe('Next Stratus payout: Helsinki, 9 FLUX, in ~18 s');
  });
});

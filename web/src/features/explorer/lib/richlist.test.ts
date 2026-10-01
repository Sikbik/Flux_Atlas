import { describe, expect, it } from 'vitest';
import { bucketLabel, concentration, formatShare, lockedSats } from './richlist';

describe('formatShare', () => {
  it('keeps the digits that matter at each magnitude', () => {
    expect(formatShare(37.16)).toBe('37.2%');
    expect(formatShare(3.5427)).toBe('3.54%');
    expect(formatShare(0.1234)).toBe('0.12%');
    expect(formatShare(0.00412)).toBe('0.004%');
  });
});

const holders = (shares: number[]) => shares.map((share_pct, i) => ({ rank: i + 1, share_pct }));

describe('concentration', () => {
  it('splits ranks into #1, #2 to #10, #11 to #100 and the rest of the supply', () => {
    const shares = [40, ...Array.from({ length: 9 }, () => 2), ...Array.from({ length: 90 }, () => 0.1)];
    const c = concentration(holders(shares));
    expect(c.listed).toBe(100);
    expect(c.buckets.map((b) => b.label)).toEqual(['#1', '#2 to #10', '#11 to #100', 'Everyone else']);
    expect(c.buckets[0]!.share).toBeCloseTo(40);
    expect(c.buckets[1]!.share).toBeCloseTo(18);
    expect(c.buckets[2]!.share).toBeCloseTo(9);
    expect(c.buckets[3]!.share).toBeCloseTo(33);
    expect(c.buckets.reduce((s, b) => s + b.share, 0)).toBeCloseTo(100);
  });

  it('counts holders per bucket and none for everyone else', () => {
    const c = concentration(holders(Array.from({ length: 25 }, () => 1)));
    expect(c.buckets.map((b) => b.holders)).toEqual([1, 9, 15, 0]);
  });

  it('answers cumulative top-n shares however the input is ordered', () => {
    const c = concentration([...holders([30, 20, 10, 5])].reverse());
    expect(c.top(1)).toBe(30);
    expect(c.top(2)).toBe(50);
    expect(c.top(10)).toBe(65);
  });

  it('never reports a negative remainder when the listed shares overshoot 100', () => {
    const c = concentration(holders([60, 50]));
    expect(c.buckets.at(-1)!.share).toBe(0);
  });

  it('handles an empty list', () => {
    const c = concentration([]);
    expect(c.buckets).toHaveLength(1);
    expect(c.buckets[0]!.share).toBe(100);
  });
});

describe('bucketLabel', () => {
  it('names one rank or a range', () => {
    expect(bucketLabel(1, 1)).toBe('#1');
    expect(bucketLabel(101, 1000)).toBe('#101 to #1,000');
  });
});

describe('lockedSats', () => {
  const collateral = { cumulus: 1_000n, nimbus: 12_500n, stratus: 40_000n };
  it('multiplies node counts by the collateral of each tier', () => {
    expect(lockedSats({ cumulus: 3, nimbus: 2, stratus: 1 }, collateral, 10_000_000n)).toBe(68_000n);
  });
  it('caps at the balance', () => {
    expect(lockedSats({ cumulus: 0, nimbus: 0, stratus: 10 }, collateral, 100_000n)).toBe(100_000n);
  });
});

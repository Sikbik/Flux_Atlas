import { describe, expect, it } from 'vitest';
import { allocateCells, tierSlices, tierSummary } from './tiers';

describe('allocateCells', () => {
  it('always adds up to the number of cells', () => {
    for (const counts of [
      [3090, 1517, 2031],
      [1, 1, 1],
      [10, 0, 0],
      [3, 3, 3],
      [999, 1, 0],
      [33, 33, 34],
    ]) {
      expect(allocateCells(counts, 100).reduce((s, n) => s + n, 0)).toBe(100);
    }
  });

  it('follows the proportions by largest remainder', () => {
    // 46.55, 22.85 and 30.60: the two spare cells go to the largest remainders, Nimbus then Stratus.
    expect(allocateCells([3090, 1517, 2031], 100)).toEqual([46, 23, 31]);
    expect(allocateCells([1, 1], 3)).toEqual([2, 1]);
  });

  it('leaves a tier that has nodes at least one cell, taken from the largest', () => {
    const out = allocateCells([9990, 6, 4], 100);
    expect(out[1]).toBeGreaterThanOrEqual(1);
    expect(out[2]).toBeGreaterThanOrEqual(1);
    expect(out.reduce((s, n) => s + n, 0)).toBe(100);
  });

  it('gives nothing to a tier with no nodes, and draws nothing for an empty network', () => {
    expect(allocateCells([5, 0, 5], 10)).toEqual([5, 0, 5]);
    expect(allocateCells([0, 0, 0], 100)).toEqual([0, 0, 0]);
  });
});

describe('tierSlices', () => {
  const counts = { cumulus: 3090, nimbus: 1517, stratus: 2031, total: 6638 };

  it('lists the tiers smallest first with their shares and cells', () => {
    const { slices, total } = tierSlices(counts);
    expect(total).toBe(6638);
    expect(slices.map((s) => s.id)).toEqual(['cumulus', 'nimbus', 'stratus']);
    expect(slices[0]?.share).toBeCloseTo(3090 / 6638);
    expect(slices.reduce((s, x) => s + x.cells, 0)).toBe(100);
  });

  it('keeps nodes of no known tier as their own slice instead of dropping them', () => {
    const { slices, total } = tierSlices({ ...counts, total: 6700 });
    expect(total).toBe(6700);
    const unknown = slices.at(-1);
    expect(unknown?.id).toBe('unknown');
    expect(unknown?.count).toBe(62);
    expect(slices.reduce((s, x) => s + x.cells, 0)).toBe(100);
  });

  it('is empty-safe', () => {
    const { slices, total } = tierSlices({ cumulus: 0, nimbus: 0, stratus: 0, total: 0 });
    expect(total).toBe(0);
    expect(slices.every((s) => s.cells === 0 && s.share === 0)).toBe(true);
  });
});

describe('tierSummary', () => {
  it('reads the waffle as a sentence', () => {
    const { slices } = tierSlices({ cumulus: 3090, nimbus: 1517, stratus: 2031, total: 6638 });
    expect(tierSummary(slices)).toBe(
      '3,090 Cumulus nodes (46.6%), 1,517 Nimbus nodes (22.9%) and 2,031 Stratus nodes (30.6%)',
    );
  });

  it('says so when there is nothing to count', () => {
    const { slices } = tierSlices({ cumulus: 0, nimbus: 0, stratus: 0, total: 0 });
    expect(tierSummary(slices)).toBe('No nodes counted yet');
  });
});

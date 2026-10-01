import { describe, expect, it } from 'vitest';
import { chiSquare, chiSquareP, fairness, hhi, hhiBand, nakamoto, pareto, wilson, Z } from './stats';

describe('nakamoto', () => {
  it('counts the smallest set holding more than half', () => {
    expect(nakamoto([60, 20, 10, 10])).toBe(1);
    expect(nakamoto([30, 30, 20, 20])).toBe(2); // 30 + 30 = 60 of 100 is more than half
    expect(nakamoto([25, 25, 25, 25])).toBe(3);
    expect(nakamoto([10, 10, 10, 10, 10, 10, 10, 10, 10, 10])).toBe(6);
  });

  it('needs strictly more than half', () => {
    expect(nakamoto([50, 50])).toBe(2);
    expect(nakamoto([51, 49])).toBe(1);
  });

  it('is order independent and handles empties', () => {
    expect(nakamoto([10, 50, 20, 20])).toBe(nakamoto([50, 20, 20, 10]));
    expect(nakamoto([])).toBe(0);
    expect(nakamoto([0, 0])).toBe(0);
  });

  it('reproduces the live country figure: DE FI US FR DK hold a majority in three countries', () => {
    // Real /network/geo counts (top of the list); the rest are small.
    const counts = [
      1450, 1157, 970, 746, 499, 383, 197, 166, 105, 95, 86, 76, 70, 52, 50, 48, 45, 43, 42, 40,
    ];
    const rest = 6701 - counts.reduce((a, b) => a + b, 0);
    expect(nakamoto([...counts, rest])).toBe(3);
  });
});

describe('pareto and hhi', () => {
  it('accumulates the largest first', () => {
    const p = pareto([10, 50, 40]);
    expect(p.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(p[0]!.share).toBeCloseTo(0.5);
    expect(p[1]!.cumulative).toBeCloseTo(0.9);
    expect(p[2]!.cumulative).toBeCloseTo(1);
  });

  it('can measure against a total larger than the listed entities', () => {
    const p = pareto([40, 10], 200);
    expect(p[1]!.cumulative).toBeCloseTo(0.25);
  });

  it('computes the HHI and reads its band', () => {
    expect(hhi([1])).toBe(1);
    expect(hhi([50, 50])).toBeCloseTo(0.5);
    expect(hhi(Array.from({ length: 100 }, () => 1))).toBeCloseTo(0.01);
    expect(hhiBand(0.0784)).toBe('low');
    expect(hhiBand(0.1217)).toBe('low');
    expect(hhiBand(0.2)).toBe('moderate');
    expect(hhiBand(0.4)).toBe('high');
    expect(hhi([])).toBe(0);
  });
});

describe('wilson', () => {
  it('brackets the observed proportion', () => {
    const { lo, hi } = wilson(50, 100);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
  });

  it('stays inside 0..1 at the extremes', () => {
    expect(wilson(0, 50).lo).toBe(0);
    expect(wilson(0, 50).hi).toBeGreaterThan(0);
    expect(wilson(50, 50).hi).toBe(1);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });

  it('narrows with more samples', () => {
    const a = wilson(500, 1000);
    const b = wilson(5000, 10000);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
  });
});

describe('fairness', () => {
  const rows = [
    { key: 'stratus', label: 'Stratus', nodes: 1764, produced: 0 },
    { key: 'nimbus', label: 'Nimbus', nodes: 1579, produced: 0 },
    { key: 'cumulus', label: 'Cumulus', nodes: 3386, produced: 0 },
  ];
  const total = 6729;

  it('expects each category to produce in proportion to its nodes', () => {
    const n = 2880;
    const out = fairness(
      rows.map((r) => ({ ...r, produced: Math.round((r.nodes / total) * n) })),
      total,
      n,
    );
    for (const r of out) {
      expect(r.verdict).toBe('within');
      expect(Math.abs(r.z)).toBeLessThan(0.5);
      expect(r.lo).toBeLessThanOrEqual(r.nodeShare);
      expect(r.hi).toBeGreaterThanOrEqual(r.nodeShare);
    }
    expect(out[0]!.expected).toBeCloseTo((1764 / total) * n, 6);
  });

  it('flags a category far from expectation, and only beyond the 99% bar', () => {
    const n = 2880;
    const exp = (1764 / total) * n; // about 755
    const sd = Math.sqrt(n * (1764 / total) * (1 - 1764 / total));
    const above = fairness(
      [{ ...rows[0]!, produced: Math.round(exp + 3 * sd) }, rows[1]!, rows[2]!],
      total,
      n,
    );
    expect(above[0]!.verdict).toBe('above');
    const near = fairness(
      [{ ...rows[0]!, produced: Math.round(exp + 2 * sd) }, rows[1]!, rows[2]!],
      total,
      n,
    );
    expect(near[0]!.verdict).toBe('within');
    const below = fairness(
      [{ ...rows[0]!, produced: Math.round(exp - 3 * sd) }, rows[1]!, rows[2]!],
      total,
      n,
    );
    expect(below[0]!.verdict).toBe('below');
  });

  it('handles an empty sample', () => {
    const out = fairness(rows, total, 0);
    for (const r of out) {
      expect(r.producedShare).toBe(0);
      expect(r.z).toBe(0);
      expect(r.verdict).toBe('within');
    }
  });

  it('takes expected counts and variances that differ from the node share', () => {
    const [a] = fairness(
      [{ key: 'a', label: 'A', nodes: 50, produced: 400, expectedBlocks: 500, variance: 250 }],
      100,
      1000,
    );
    // (400 - 500) / sqrt(250) is about -6.3: flagged, though 400 of 1000 is a fair share of 50 nodes of 100.
    expect(a!.z).toBeCloseTo(-100 / Math.sqrt(250), 6);
    expect(a!.verdict).toBe('below');
    expect(a!.expected).toBe(500);
    expect(a!.nodeShare).toBeCloseTo(0.5);
  });

  it('uses z = 1.96 for 95% intervals', () => {
    expect(Z[95]).toBeCloseTo(1.96, 2);
  });
});

describe('chi-square', () => {
  it('is near zero for a perfect fit and large for a skew', () => {
    const rows = [
      { key: 'a', label: 'A', nodes: 50, produced: 500 },
      { key: 'b', label: 'B', nodes: 50, produced: 500 },
    ];
    const fit = chiSquare(rows, 100, 1000);
    expect(fit.chi2).toBe(0);
    expect(fit.df).toBe(1);
    const skew = chiSquare(
      [
        { key: 'a', label: 'A', nodes: 50, produced: 600 },
        { key: 'b', label: 'B', nodes: 50, produced: 400 },
      ],
      100,
      1000,
    );
    expect(skew.chi2).toBeCloseTo(40, 6);
  });

  it('compares against supplied expected counts when there are any', () => {
    const r = chiSquare(
      [
        { key: 'a', label: 'A', nodes: 50, produced: 450, expectedBlocks: 450 },
        { key: 'b', label: 'B', nodes: 50, produced: 550, expectedBlocks: 550 },
      ],
      100,
      1000,
    );
    expect(r.chi2).toBe(0);
  });

  it('turns a statistic into a plausible p-value', () => {
    expect(chiSquareP(0, 5)).toBeGreaterThan(0.99);
    expect(chiSquareP(5, 5)).toBeGreaterThan(0.3);
    expect(chiSquareP(5, 5)).toBeLessThan(0.5);
    expect(chiSquareP(40, 5)).toBeLessThan(0.001);
    expect(chiSquareP(1, 0)).toBe(1);
  });
});

// Concentration and fairness statistics for the analytics tabs. Pure functions over counts; the
// server computes the headline Nakamoto coefficients, and these let the charts show the curve behind
// them and check them.

/**
 * The Nakamoto coefficient: the smallest number of entities that together hold MORE than half of the
 * total. `counts` need not be sorted. Zero entities give 0.
 */
export function nakamoto(counts: readonly number[], threshold = 0.5): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total <= 0) return 0;
  const sorted = [...counts].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i]!;
    if (acc / total > threshold) return i + 1;
  }
  return sorted.length;
}

export interface ParetoPoint {
  rank: number;
  /** Share of the total held by this entity, 0..1. */
  share: number;
  /** Cumulative share of the largest `rank` entities, 0..1. */
  cumulative: number;
}

/** Entities sorted by size with the running share: the curve behind a Nakamoto coefficient. */
export function pareto(counts: readonly number[], total?: number): ParetoPoint[] {
  const sum = total ?? counts.reduce((s, c) => s + c, 0);
  if (sum <= 0) return [];
  const sorted = [...counts].sort((a, b) => b - a);
  let acc = 0;
  return sorted.map((c, i) => {
    acc += c;
    return { rank: i + 1, share: c / sum, cumulative: acc / sum };
  });
}

/** Herfindahl-Hirschman index of a distribution of counts: sum of squared shares, 0..1. */
export function hhi(counts: readonly number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total <= 0) return 0;
  return counts.reduce((s, c) => s + (c / total) ** 2, 0);
}

/** Reading of an HHI on the 0..1 scale (the antitrust bands, 1,500 and 2,500 of 10,000). */
export function hhiBand(h: number): 'low' | 'moderate' | 'high' {
  if (h < 0.15) return 'low';
  if (h < 0.25) return 'moderate';
  return 'high';
}

/** z for a two-sided confidence level. */
export const Z = { 90: 1.6449, 95: 1.96, 99: 2.5758 } as const;

/** Wilson score interval for a proportion: `k` successes of `n`, at the given z. Behaves at 0 and n. */
export function wilson(k: number, n: number, z: number = Z[95]): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export type FairnessVerdict = 'within' | 'above' | 'below';

export interface FairnessInput {
  key: string;
  label: string;
  /** Nodes in this category. */
  nodes: number;
  /** Blocks in the sample produced by nodes of this category. */
  produced: number;
  /**
   * Blocks this category is expected to produce, when the chance differs from block to block (the set
   * of eligible nodes changes over the sample). Overrides the constant-share expectation.
   */
  expectedBlocks?: number;
  /** Variance of the produced count under that expectation: the sum of p(1 - p) over the blocks. */
  variance?: number;
}

export interface FairnessRow extends FairnessInput {
  nodeShare: number;
  producedShare: number;
  /** Expected blocks if every node were equally likely to produce. */
  expected: number;
  /** Confidence interval of the produced share (Wilson), 0..1. */
  lo: number;
  hi: number;
  /** Standardized difference: (produced - expected) / sqrt(n p (1 - p)). */
  z: number;
  verdict: FairnessVerdict;
}

/**
 * Compares each category's share of produced blocks with its share of nodes. Every node has the same
 * chance in Proof of Node, so the expected share of a category is its share of nodes. A category is
 * flagged only beyond `flagZ` (99% by default), because with many categories a few land outside a 95%
 * interval by chance alone.
 */
export function fairness(
  rows: readonly FairnessInput[],
  totalNodes: number,
  sampleBlocks: number,
  opts: { ciZ?: number; flagZ?: number } = {},
): FairnessRow[] {
  const ciZ = opts.ciZ ?? Z[95];
  const flagZ = opts.flagZ ?? Z[99];
  return rows.map((r) => {
    const p = totalNodes > 0 ? r.nodes / totalNodes : 0;
    const expected = r.expectedBlocks ?? p * sampleBlocks;
    const sd = Math.sqrt(r.variance ?? sampleBlocks * p * (1 - p));
    const z = sd > 0 ? (r.produced - expected) / sd : 0;
    const { lo, hi } = wilson(r.produced, sampleBlocks, ciZ);
    return {
      ...r,
      // The expected share: the share of nodes, or the average eligible share when it varies.
      nodeShare: r.expectedBlocks !== undefined && sampleBlocks > 0 ? expected / sampleBlocks : p,
      producedShare: sampleBlocks > 0 ? r.produced / sampleBlocks : 0,
      expected,
      lo,
      hi,
      z,
      verdict: z > flagZ ? 'above' : z < -flagZ ? 'below' : 'within',
    };
  });
}

/** Chi-square statistic of observed producer counts against node shares (degrees of freedom k - 1). */
export function chiSquare(
  rows: readonly FairnessInput[],
  totalNodes: number,
  sampleBlocks: number,
): { chi2: number; df: number } {
  let chi2 = 0;
  let used = 0;
  for (const r of rows) {
    const e = r.expectedBlocks ?? (totalNodes > 0 ? (r.nodes / totalNodes) * sampleBlocks : 0);
    if (e <= 0) continue;
    chi2 += (r.produced - e) ** 2 / e;
    used++;
  }
  return { chi2, df: Math.max(0, used - 1) };
}

/** Upper-tail p-value of a chi-square statistic (Wilson-Hilferty approximation; fine for df >= 2). */
export function chiSquareP(chi2: number, df: number): number {
  if (df <= 0) return 1;
  const x = (chi2 / df) ** (1 / 3);
  const mu = 1 - 2 / (9 * df);
  const sigma = Math.sqrt(2 / (9 * df));
  const z = (x - mu) / sigma;
  return 1 - normalCdf(z);
}

function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Who could have produced a block: the nodes that were confirmed at the time (not started but not yet
// confirmed, not on the DoS list, not expired). The expected share of a tier is its share of those
// nodes. The set changes as nodes join and leave, so each block is judged against the eligible set
// nearest to it in time, taken from the server's recorded timeline; where the recorded history does not
// reach back, the earliest recorded set stands in.

import { STATUS_CODES } from '../../../api/nodesBin';
import type { ProducerTier } from './producers';

export type TierCounts = Record<ProducerTier, number>;

export interface EligibleSample {
  /** When the node table was read, unix ms. */
  t: number;
  /** Confirmed nodes per tier at that time. */
  counts: TierCounts;
}

const CONFIRMED = STATUS_CODES.indexOf('confirmed');
const TIER_NAME: readonly (ProducerTier | null)[] = [null, 'cumulus', 'nimbus', 'stratus'];

export const emptyCounts = (): TierCounts => ({ cumulus: 0, nimbus: 0, stratus: 0 });

export const sumCounts = (c: TierCounts): number => c.cumulus + c.nimbus + c.stratus;

/** Confirmed nodes per tier from the wire columns of a node table (tier codes 1 to 3, status code 1). */
export function confirmedCounts(tier: ArrayLike<number>, status: ArrayLike<number>, n: number): TierCounts {
  const out = emptyCounts();
  for (let i = 0; i < n; i++) {
    if (status[i] !== CONFIRMED) continue;
    const name = TIER_NAME[tier[i] ?? 0];
    if (name) out[name]++;
  }
  return out;
}

/**
 * Times at which to read the node table so that the blocks between `fromMs` and `toMs` can each be
 * judged against a nearby set: `n` evenly spaced times, kept inside the recorded range. A span that
 * lies wholly before the recording yields its first instant; wholly after, its last.
 */
export function sampleTimes(
  fromMs: number,
  toMs: number,
  recordedFromMs: number,
  recordedToMs: number,
  n: number,
): number[] {
  if (n <= 0 || recordedToMs < recordedFromMs) return [];
  const lo = Math.min(Math.max(fromMs, recordedFromMs), recordedToMs);
  const hi = Math.max(Math.min(toMs, recordedToMs), recordedFromMs);
  if (n === 1 || hi - lo < 1000) return [Math.round(lo)];
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(Math.round(lo + ((hi - lo) * k) / (n - 1)));
  return out;
}

/** The sample nearest to `timeMs` (the earlier one on a tie), or null without samples. */
export function nearestSample(samples: readonly EligibleSample[], timeMs: number): EligibleSample | null {
  let best: EligibleSample | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    const d = Math.abs(s.t - timeMs);
    if (d < bestD || (d === bestD && best !== null && s.t < best.t)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export interface Expectation {
  /** Blocks each tier is expected to produce: the sum over blocks of its eligible share. */
  expected: Record<ProducerTier, number>;
  /** Variance of each tier's produced count: the sum over blocks of p(1 - p). */
  variance: Record<ProducerTier, number>;
}

/**
 * What chance predicts for a run of blocks. Every confirmed node has the same chance, so a block at a
 * given time gives each tier the probability `its confirmed nodes / all confirmed nodes` then. Blocks
 * with no sample use `fallback`.
 */
export function expectedByBlock(
  blockTimesMs: readonly number[],
  samples: readonly EligibleSample[],
  fallback: TierCounts,
): Expectation {
  const expected = emptyCounts();
  const variance = emptyCounts();
  for (const t of blockTimesMs) {
    const counts = nearestSample(samples, t)?.counts ?? fallback;
    const total = sumCounts(counts);
    if (total <= 0) continue;
    for (const tier of ['cumulus', 'nimbus', 'stratus'] as const) {
      const p = counts[tier] / total;
      expected[tier] += p;
      variance[tier] += p * (1 - p);
    }
  }
  return { expected, variance };
}

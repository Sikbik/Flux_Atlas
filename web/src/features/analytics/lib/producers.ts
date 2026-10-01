// Who produced the blocks, by tier. A block's producer is a node; its tier is that node's tier today.
// Blocks made by nodes that have since left the network have no tier, so they are counted apart and
// kept out of the comparison rather than guessed into one.

export type ProducerTier = 'cumulus' | 'nimbus' | 'stratus';

export interface SampleBlock {
  height: number;
  /** Block time, unix ms: the confirmed set of that moment is the one that could have produced it. */
  timeMs: number;
  /** Node id of the producer, when the chain explorer knows it. */
  producer: number | null;
}

export interface ProducerTally {
  counts: Record<ProducerTier, number>;
  /** Blocks whose producer is no longer in the node table, or is not known. */
  unknown: number;
  /** Blocks with a known tier: the sample the comparison is made on. */
  known: number;
  total: number;
  /** Block times of the known blocks, newest first as given: what the expectation is summed over. */
  knownTimes: number[];
}

export function tallyProducers(
  blocks: readonly SampleBlock[],
  tierOf: (nodeId: number) => ProducerTier | null,
): ProducerTally {
  const counts: Record<ProducerTier, number> = { cumulus: 0, nimbus: 0, stratus: 0 };
  const knownTimes: number[] = [];
  let unknown = 0;
  for (const b of blocks) {
    const tier = b.producer === null ? null : tierOf(b.producer);
    if (tier === null) {
      unknown++;
    } else {
      counts[tier]++;
      knownTimes.push(b.timeMs);
    }
  }
  const known = counts.cumulus + counts.nimbus + counts.stratus;
  return { counts, unknown, known, total: known + unknown, knownTimes };
}

/**
 * The newest `limit` blocks from a fetched history (newest first) and live blocks (newest first),
 * without duplicates: live blocks newer than the history come first.
 */
export function mergeSample(
  fetched: readonly SampleBlock[],
  live: readonly SampleBlock[],
  limit: number,
): SampleBlock[] {
  const newest = fetched.reduce((m, b) => Math.max(m, b.height), -1);
  const fresh = live.filter((b) => b.height > newest);
  const seen = new Set<number>();
  const out: SampleBlock[] = [];
  for (const b of [...fresh, ...fetched]) {
    if (seen.has(b.height)) continue;
    seen.add(b.height);
    out.push(b);
    if (out.length >= limit) break;
  }
  return out;
}

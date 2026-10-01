// The recent blocks and who produced them, for the fairness check. History comes from the server a
// hundred blocks a page (cached: a block that deep never changes), blocks that arrive while the tab
// is open come from the live ring, and the tier of each producer is read from the live node table.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/endpoints';
import type { BlocksPage } from '../../../api/generated/BlocksPage';
import { useChainBlocks, useNetwork, useRuntime } from '../../../app/context';
import {
  mergeSample,
  type ProducerTally,
  type ProducerTier,
  type SampleBlock,
  tallyProducers,
} from '../lib/producers';

export const SAMPLE_TARGET = 1000;
const PAGE = 100;
const TIER_BY_CODE: readonly (ProducerTier | null)[] = [null, 'cumulus', 'nimbus', 'stratus'];

export interface ProducerSample {
  tally: ProducerTally;
  /** Blocks fetched or live so far, newest first. */
  loaded: number;
  target: number;
  done: boolean;
  error: boolean;
}

export function useProducerSample(target: number = SAMPLE_TARGET): ProducerSample {
  const qc = useQueryClient();
  const live = useChainBlocks();
  const nodesVersion = useNetwork((s) => s.versions.Nodes);
  const { store } = useRuntime();
  const [fetched, setFetched] = useState<SampleBlock[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setError(false);
    (async () => {
      const out: SampleBlock[] = [];
      let before: number | null = null;
      while (out.length < target && !cancelled) {
        const cursor: number | null = before;
        const page: BlocksPage = await qc.fetchQuery({
          queryKey: ['atlas', 'analytics', 'producer-sample', cursor ?? 'head'],
          queryFn: ({ signal }) => api.blocks({ before: cursor, limit: PAGE }, { signal }),
          // The newest page changes with every block; anything older is immutable.
          staleTime: cursor === null ? 20_000 : Number.POSITIVE_INFINITY,
        });
        for (const b of page.items) out.push({ height: b.height, producer: b.producer });
        if (cancelled) return;
        setFetched([...out]);
        if (page.next_before === null || page.items.length === 0) break;
        before = page.next_before;
      }
      if (!cancelled) setDone(true);
    })().catch(() => {
      if (!cancelled) {
        setError(true);
        setDone(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [qc, target]);

  const blocks = useMemo(
    () =>
      mergeSample(
        fetched,
        live.map((b) => ({ height: b.height, producer: b.producer })),
        target,
      ),
    [fetched, live, target],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the node table is mutable; its slice version is the signal
  const tally = useMemo(
    () =>
      tallyProducers(blocks, (id) => {
        const i = store.nodes.indexOf(id);
        return i < 0 ? null : (TIER_BY_CODE[store.nodes.tier[i] ?? 0] ?? null);
      }),
    [blocks, store, nodesVersion],
  );

  return { tally, loaded: blocks.length, target, done, error };
}

// The confirmed nodes by tier at a few moments across a span of blocks, read from the server's recorded
// timeline, so a block can be judged against the nodes that could have produced it then. Where the
// recording does not reach back the earliest usable set stands in; with no recording at all, today's
// confirmed nodes (from the live table) do. Counts are cached by minute: a past moment never changes.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { hasColumn, NodeSection } from '../../../api/nodesBin';
import { queries, useTimeline } from '../../../api/queries';
import { useNetwork, useRuntime } from '../../../app/context';
import {
  confirmedCounts,
  type EligibleSample,
  sampleTimes,
  type TierCounts,
  usableSets,
} from '../lib/eligibility';

const MINUTE = 60_000;
/** Spans and the recorded range are rounded to this, so the sets asked for stay put as blocks arrive. */
const SETTLE = 10 * MINUTE;
const SAMPLES = 6;

/** Confirmed counts by whole minute; null: the state was read but lacks the columns to count. */
const COUNTS = new Map<number, TierCounts | null>();

const down = (ms: number, to: number) => Math.floor(ms / to) * to;
const up = (ms: number, to: number) => Math.ceil(ms / to) * to;

export interface EligibleSets {
  /** Recorded sets that look like the whole network, oldest first. */
  samples: EligibleSample[];
  /** Today's confirmed nodes by tier, for blocks no recorded set covers. */
  fallback: TierCounts;
  /** Where the recorded history begins (unix ms), or null when there is none to use. */
  recordedFromMs: number | null;
  /** The sets for this span are settled: read, or there is nothing to read. */
  ready: boolean;
}

export function useEligibleSets(spanFromMs: number | null, spanToMs: number | null): EligibleSets {
  const qc = useQueryClient();
  const { store } = useRuntime();
  const nodesVersion = useNetwork((s) => s.versions.Nodes);
  const timeline = useTimeline();
  const tl = timeline.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the node table is mutable; its slice version is the signal
  const fallback = useMemo(
    () => confirmedCounts(store.nodes.tier, store.nodes.status, store.nodes.count),
    [store, nodesVersion],
  );

  const first = tl?.first_ms ?? null;
  const last = tl?.last_ms ?? null;
  const times = useMemo(() => {
    if (first === null || last === null || spanFromMs === null || spanToMs === null) return [];
    return sampleTimes(
      down(spanFromMs, SETTLE),
      up(spanToMs, SETTLE),
      first,
      down(last, SETTLE),
      SAMPLES,
    ).map((t) => down(t, MINUTE));
  }, [first, last, spanFromMs, spanToMs]);
  const key = times.join(',');

  const [read, setRead] = useState<{ key: string; counts: Map<number, TierCounts> } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `times`
  useEffect(() => {
    if (times.length === 0) return;
    let cancelled = false;
    void (async () => {
      await Promise.allSettled(
        times.map(async (t) => {
          if (COUNTS.has(t)) return;
          const bin = await qc.fetchQuery(queries.timelineState(t));
          // A state without these columns did not record them: it cannot say who was confirmed.
          const ok = hasColumn(bin, NodeSection.Tier) && hasColumn(bin, NodeSection.Status);
          COUNTS.set(t, ok ? confirmedCounts(bin.tier, bin.status, bin.count) : null);
        }),
      );
      if (cancelled) return;
      const counts = new Map<number, TierCounts>();
      for (const t of times) {
        const c = COUNTS.get(t);
        if (c) counts.set(t, c);
      }
      setRead({ key, counts });
    })();
    return () => {
      cancelled = true;
    };
  }, [qc, key]);

  const samples = useMemo(() => {
    if (!read || read.key !== key) return [];
    const all: EligibleSample[] = [];
    for (const t of times) {
      const counts = read.counts.get(t);
      if (counts) all.push({ t, counts });
    }
    return usableSets(all, fallback);
  }, [read, key, times, fallback]);

  const settled =
    timeline.isError || (tl !== undefined && (times.length === 0 || (read !== null && read.key === key)));
  return {
    samples,
    fallback,
    recordedFromMs: samples[0]?.t ?? null,
    ready: settled && spanFromMs !== null && spanToMs !== null,
  };
}

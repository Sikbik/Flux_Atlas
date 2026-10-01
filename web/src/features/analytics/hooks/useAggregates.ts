// The server's network aggregates (geography, providers, versions, capacity, decentralization) are
// recomputed when the network changes. They are not polled: a `stats` message on the stream says the
// summary moved, and while a tab that shows them is open that triggers one refetch, at most every 30 s.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { qk } from '../../../api/queryKeys';
import { useSummary } from '../../../app/context';

const AGGREGATES = [
  qk.network.geo(),
  qk.network.providers(),
  qk.network.versions(),
  qk.network.capacity(),
  qk.network.decentralization(),
] as const;

export const AGGREGATE_MIN_MS = 30_000;

/** Refetches the aggregates that an open tab observes whenever the live summary moves (throttled). */
export function useAggregateRefresh(minMs: number = AGGREGATE_MIN_MS): void {
  const qc = useQueryClient();
  const summary = useSummary();
  const last = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: the summary object changing is the trigger
  useEffect(() => {
    if (!summary) return;
    const now = performance.now();
    if (now - last.current < minMs) return;
    last.current = now;
    for (const key of AGGREGATES) void qc.invalidateQueries({ queryKey: key, refetchType: 'active' });
  }, [summary]);
}

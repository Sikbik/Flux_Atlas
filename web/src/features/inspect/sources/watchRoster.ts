// What the server knows about each watched node (its detail record), fetched once per node and kept for
// half an hour. The watchlist view reads it to fill what the live table lacks (where the node is, whether
// the last sweep reached it, its last check-in); the alert engine reads the same record for the check-in
// height. One key, so each node is asked for once however many parts of the app need it.

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../../api/endpoints';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { rowFromDetail } from '../derive/operator';
import { WATCH_LIVE_LIMIT } from '../watch/model';

export const watchNodeQuery = (id: number) => ({
  queryKey: ['atlas', 'inspect', 'watch-base', id] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => api.node(id, { signal }),
  staleTime: 30 * 60_000,
});

/** Roster rows for the first watched nodes (the ones the server follows live), keyed by node id. */
export function useWatchRows(ids: readonly number[], enabled: boolean): ReadonlyMap<number, NodeRow> {
  const results = useQueries({
    queries: ids.slice(0, WATCH_LIVE_LIMIT).map((id) => ({ ...watchNodeQuery(id), enabled })),
    combine: (rs) => rs.map((r) => r.data?.node ?? null),
  });
  return useMemo(() => {
    const m = new Map<number, NodeRow>();
    for (const node of results) if (node) m.set(node.id, rowFromDetail(node));
    return m;
  }, [results]);
}

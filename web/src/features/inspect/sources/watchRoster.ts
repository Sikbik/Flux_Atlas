// What the server knows about each watched node (its detail record), fetched once per node and kept for
// half an hour. The watchlist view reads it to fill what the live table lacks (where the node is, whether
// the last sweep reached it, its last check-in); the alert engine reads the same record for the check-in
// height. One key, so each node is asked for once however many parts of the app need it.

import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../../api/endpoints';
import type { Geo } from '../../../api/generated/Geo';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { canonicalNodeKey } from '../../../store/nodeKeys';
import { rowFromDetail } from '../derive/operator';
import { WATCH_LIVE_LIMIT } from '../watch/model';

/** Keyed and fetched by outpoint when the snapshot knows the node (ids are per instance). */
export const watchNodeQuery = (id: number, key = canonicalNodeKey(id)) => ({
  queryKey: ['atlas', 'inspect', 'watch-base', key] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => api.node(key, { signal }),
  staleTime: 30 * 60_000,
});

/**
 * Roster rows for the first watched nodes (the ones the server follows live), keyed by node id, and whether
 * any of those records is still on its way: until it has arrived a node's reachability is not known.
 */
export function useWatchRows(
  ids: readonly number[],
  enabled: boolean,
): { rows: ReadonlyMap<number, NodeRow>; loading: boolean } {
  const asked = ids.slice(0, WATCH_LIVE_LIMIT);
  const results = useQueries({
    queries: asked.map((id) => ({ ...watchNodeQuery(id), enabled })),
    combine: (rs) => ({
      nodes: rs.map((r) => r.data?.node ?? null),
      loading: rs.some((r) => r.isLoading),
    }),
  });
  const { nodes, loading } = results;
  // Keyed by the session's id that was asked for: the record's own id is the answering instance's.
  const key = asked.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the ids asked for
  const rows = useMemo(() => {
    const m = new Map<number, NodeRow>();
    nodes.forEach((node, k) => {
      const id = asked[k];
      if (node && id !== undefined) m.set(id, { ...rowFromDetail(node), id });
    });
    return m;
  }, [nodes, key]);
  return { rows, loading };
}

/**
 * The geolocation of a fleet's only node, from its detail record: the roster rows say nothing about a city, so a
 * fleet of one asks for the one record (the same key the watchlist already shares, so it is one request).
 */
export function useSoleGeo(nodes: readonly { id: number; present: boolean }[]): Geo | null {
  const sole = nodes.length === 1 && nodes[0]?.present ? nodes[0] : null;
  const q = useQuery({ ...watchNodeQuery(sole?.id ?? -1), enabled: sole !== null });
  return sole ? (q.data?.node.geo ?? null) : null;
}

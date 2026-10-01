// The fleet an operator view shows: an operator's roster (a payment address) or the user's watchlist,
// joined with the live node table so status, queue place and check-in age follow the stream. Earnings
// come from the server's operator totals, or from the nodes' own payments for a small fleet.

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { api } from '../../../api/endpoints';
import type { OperatorDto } from '../../../api/generated/OperatorDto';
import { queries } from '../../../api/queries';
import { useNetwork, useRuntime, useTip } from '../../../app/context';
import { fluxToNumber } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { type Earnings, earningsFromPayments, earningsFromTotals, NO_EARNINGS } from '../derive/earnings';
import { buildFleet, buildWatchFleet, type FleetNode } from '../derive/operator';
import { useFirstIngestMs } from './hooks';
import { tierPayouts, useQueues, useTierInfo } from './live';
import { useWatchRows } from './watchRoster';

/** The route key that stands for the user's own watchlist (`/operator/watchlist`). */
export const WATCHLIST_KEY = 'watchlist';

export const isWatchlist = (addr: string): boolean => addr === WATCHLIST_KEY;

/** Up to this many nodes the week is summed from the nodes' own payments; beyond it, scaled. */
export const EXACT_EARNINGS_LIMIT = 24;

function sameNode(a: FleetNode, b: FleetNode): boolean {
  const ka = Object.keys(a) as (keyof FleetNode)[];
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** Keeps the previous array while every node in it is unchanged, so memoized children can skip a render. */
function useStableFleet(next: FleetNode[]): FleetNode[] {
  const prev = useRef<FleetNode[]>(next);
  const p = prev.current;
  if (p !== next && p.length === next.length && next.every((n, i) => sameNode(n, p[i] as FleetNode))) {
    return p;
  }
  prev.current = next;
  return next;
}

export interface FleetData {
  mode: 'operator' | 'watchlist';
  nodes: FleetNode[];
  /** The operator's server totals (null for the watchlist and while loading). */
  operator: OperatorDto | null;
  /** The roster request is in flight (operator mode only). */
  pending: boolean;
  /** The roster request failed. */
  error: unknown;
  /**
   * A watchlist's per-node records are still arriving, so whether each node is reachable is not known yet:
   * a claim of health would be a guess until they have.
   */
  settling: boolean;
}

/** The fleet of `addr` (a payment address), or of the user's watchlist for `watchlist`. */
export function useFleet(addr: string): FleetData {
  const watchlist = isWatchlist(addr);
  const op = useQuery({ ...queries.operator(addr), enabled: !watchlist });
  const watched = useUi((s) => s.watched);
  const { rows, loading: rowsLoading } = useWatchRows(watched, watchlist);
  const { store } = useRuntime();
  const loaded = useNetwork((s) => s.loaded);
  // Re-run when any node changes: status, reachability, check-ins and paid heights live in the table.
  const nodesVersion = useNetwork((s) => s.versions.Nodes);
  const queues = useQueues();
  const tip = useTip()?.height ?? null;
  const info = useTierInfo();

  // `nodesVersion` stands for the table's contents, which are read from `store.nodes`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodesVersion is the change signal for store.nodes
  const built = useMemo(() => {
    if (!loaded) return [];
    const payouts = tierPayouts(info);
    if (watchlist) return buildWatchFleet(watched, store.nodes, queues, tip, payouts, rows);
    return op.data ? buildFleet(op.data.nodes, store.nodes, queues, tip, payouts) : [];
  }, [loaded, watchlist, watched, rows, op.data, store, queues, tip, info, nodesVersion]);

  const nodes = useStableFleet(built);
  return {
    mode: watchlist ? 'watchlist' : 'operator',
    nodes,
    operator: op.data ?? null,
    pending: !watchlist && op.isPending,
    error: op.error,
    settling: watchlist && rowsLoading,
  };
}

export interface FleetEarnings {
  earnings: Earnings;
  /** True while the per-node payments a small fleet needs are still arriving. */
  pending: boolean;
  /** The 7 day figure is a sum of payments (not scaled from the 30 days). */
  exactWeek: boolean;
}

/**
 * Earnings over 24 hours, 7 days and 30 days. An operator's 24 hour and 30 day totals come from the
 * server; the week is summed from the nodes' payments when the fleet is small enough to ask for them,
 * and scaled from the 30 days otherwise (and says so). A watchlist has no server totals, so its figures
 * are sums of the watched nodes' payments, or unknown for a long list.
 */
export function useFleetEarnings(data: FleetData): FleetEarnings {
  const { clock } = useRuntime();
  const first = useFirstIngestMs();
  const small = data.nodes.length > 0 && data.nodes.length <= EXACT_EARNINGS_LIMIT;
  const results = useQueries({
    queries: data.nodes.map((n) => ({
      // A node's own paid height is part of the key: a new payment fetches fresh payments, nothing polls.
      queryKey: ['atlas', 'inspect', 'fleet-pay', n.id, n.lastPaid ?? 0],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.nodePayments(n.id, { limit: 50 }, { signal }),
      enabled: small,
      staleTime: 10 * 60_000,
      placeholderData: keepPreviousData,
    })),
    combine: (rs) => ({
      pending: rs.some((r) => r.isPending),
      items: rs.flatMap((r) => r.data?.items ?? []),
    }),
  });

  const nowMs = clock.now();
  const week = useMemo(
    () =>
      small ? earningsFromPayments(results.items, { nowMs, firstMs: first, toFlux: fluxToNumber }) : null,
    [small, results.items, nowMs, first],
  );

  if (data.mode === 'watchlist') {
    return { earnings: week ?? NO_EARNINGS, pending: small && results.pending, exactWeek: small };
  }
  const dto = data.operator;
  if (!dto) return { earnings: NO_EARNINGS, pending: data.pending, exactWeek: false };
  const h24 = fluxToNumber(dto.earned_24h);
  const d30 = fluxToNumber(dto.earned_30d);
  const exact7 = week && !results.pending ? week.d7.flux : null;
  const e = earningsFromTotals({
    h24,
    d30,
    d7: exact7 !== null && d30 !== null ? Math.min(exact7, d30) : exact7,
    nowMs,
    firstMs: first,
  });
  return { earnings: e, pending: false, exactWeek: exact7 !== null };
}

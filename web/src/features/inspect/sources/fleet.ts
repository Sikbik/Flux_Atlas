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
import { earnedOrNull, type PaSplit } from '../../earnings/basis';
import { type Earnings, earningsFromPayments, earningsFromTotals, NO_EARNINGS } from '../derive/earnings';
import { buildFleet, buildWatchFleet, type FleetNode } from '../derive/operator';
import { useFirstIngestMs } from './hooks';
import { tierPaPayouts, tierPayouts, useQueues, useTierInfo } from './live';
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
    const pa = tierPaPayouts(info);
    if (watchlist) return buildWatchFleet(watched, store.nodes, queues, tip, payouts, rows, pa);
    return op.data ? buildFleet(op.data.nodes, store.nodes, queues, tip, payouts, pa) : [];
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
  /** The last 24 hours as main chain and parallel assets, when the server knows both (operator mode). */
  split24: PaSplit | null;
}

/**
 * Earnings over 24 hours, 7 days and 30 days. An operator's 24 hour and 30 day totals come from the
 * server; the week is summed from the nodes' payments when the fleet is small enough to ask for them,
 * and scaled from the 30 days otherwise (and says so). A watchlist has no server totals, so its figures
 * are sums of the watched nodes' payments, or unknown for a long list.
 */
export function useFleetEarnings(data: FleetData): FleetEarnings {
  const { clock } = useRuntime();
  const includePa = useUi((s) => s.includePa);
  const first = useFirstIngestMs();
  const small = data.nodes.length > 0 && data.nodes.length <= EXACT_EARNINGS_LIMIT;
  const results = useQueries({
    queries: data.nodes.map((n) => ({
      // A node's own paid height is part of the key: a new payment fetches fresh payments, nothing polls.
      // By outpoint: the same node whichever instance answers (ARCHITECTURE 8.1).
      queryKey: ['atlas', 'inspect', 'fleet-pay', n.outpoint || n.id, n.lastPaid ?? 0],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.nodePayments(n.outpoint || n.id, { limit: 50 }, { signal }),
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
      small
        ? earningsFromPayments(results.items, { nowMs, firstMs: first, toFlux: fluxToNumber, includePa })
        : null,
    [small, results.items, nowMs, first, includePa],
  );

  if (data.mode === 'watchlist') {
    return {
      earnings: week ?? NO_EARNINGS,
      pending: small && results.pending,
      exactWeek: small,
      split24: null,
    };
  }
  const dto = data.operator;
  if (!dto) return { earnings: NO_EARNINGS, pending: data.pending, exactWeek: false, split24: null };
  // Each window is the main chain plus what it accrued in parallel assets (the server's `pa_*`), on the viewer's
  // basis; the server leaves both unknown together.
  const window = (native: string | null, pa: string | null) =>
    earnedOrNull(fluxToNumber(native), fluxToNumber(pa), includePa);
  const h24 = window(dto.earned_24h, dto.pa_earned_24h);
  const d30 = window(dto.earned_30d, dto.pa_earned_30d);
  // The server sums every stored payout to the operator's addresses (B7); a window the stored blocks do not cover
  // is null. Fall back to the node-attributed payments only when the server cannot say.
  const server7 = window(dto.earned_7d, dto.pa_earned_7d);
  const exact7 = server7 ?? (week && !results.pending ? week.d7.flux : null);
  const e = earningsFromTotals({
    h24,
    d30,
    d7: exact7 !== null && d30 !== null ? Math.min(exact7, d30) : exact7,
    nowMs,
    firstMs: first,
  });
  const native24 = fluxToNumber(dto.earned_24h);
  const pa24 = fluxToNumber(dto.pa_earned_24h);
  return {
    earnings: e,
    pending: false,
    exactWeek: exact7 !== null,
    split24: native24 === null || pa24 === null ? null : { native: native24, pa: pa24 },
  };
}

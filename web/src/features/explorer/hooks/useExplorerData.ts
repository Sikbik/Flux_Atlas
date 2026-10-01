// Explorer data with the right freshness for each kind of fact.
//
// - A block or transaction with FINAL_DEPTH confirmations is immutable: its observer switches off, so
//   the shared live invalidator (which refetches every active block query on each block) leaves it
//   alone and the cache keeps it. Confirmations themselves never need a refetch: they come from the
//   live tip.
// - Anything younger keeps refetching with the chain, so a pending transaction turns confirmed and a
//   tip block learns its successor without a reload.
// - An address changes with every block that touches it, so it refetches on a new tip.

import { type InfiniteData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../../../api/endpoints';
import type { AddressTxsPage } from '../../../api/generated/AddressTxsPage';
import { isApiError } from '../../../api/http';
import { queries, useAddressNodes, useAddressTxs, useAddressUtxos } from '../../../api/queries';
import { qk } from '../../../api/queryKeys';
import { isFinal, liveConfirmations, useTipHeight } from './useChain';

export function isNotFound(e: unknown): boolean {
  return isApiError(e) && (e.code === 'not_found' || e.status === 404);
}

/** Runs `fn` when the live tip moves (not on mount). */
function useOnTip(tip: number | null, fn: () => void): void {
  const last = useRef<number | null>(tip);
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (tip === null || last.current === tip) return;
    last.current = tip;
    cb.current();
  }, [tip]);
}

export function useBlockData(key: string) {
  const tip = useTipHeight();
  const q = useQuery({
    ...queries.block(key),
    enabled: (query) => {
      const d = query.state.data;
      return !(d && isFinal(liveConfirmations(tip, d.block.height, d.confirmations)));
    },
  });
  const d = q.data;
  const confirmations = d ? liveConfirmations(tip, d.block.height, d.confirmations) : 0;
  // A block just past the tip does not exist yet: keep asking as the chain moves.
  useOnTip(tip, () => {
    if (q.isError && isNotFound(q.error)) void q.refetch();
  });
  const hasNext = d ? (tip !== null ? tip > d.block.height : false) || d.next_hash !== null : false;
  return { ...q, confirmations, hasNext, tip };
}

export function useTxData(txid: string) {
  const tip = useTipHeight();
  const q = useQuery({
    ...queries.tx(txid),
    enabled: (query) => {
      const d = query.state.data;
      return !(d && d.height !== null && isFinal(liveConfirmations(tip, d.height, d.confirmations)));
    },
  });
  const d = q.data;
  const pending = d ? d.height === null : false;
  const confirmations = d ? liveConfirmations(tip, d.height, d.confirmations) : 0;
  // A pending transaction is looked up again whenever a block lands (it may be in it).
  useOnTip(tip, () => {
    if (pending || (d && d.confirmations < 2)) void q.refetch();
  });
  return { ...q, pending, confirmations, tip };
}

export function useAddressData(addr: string) {
  const tip = useTipHeight();
  const q = useQuery(queries.address(addr));
  useOnTip(tip, () => void q.refetch());
  return { ...q, tip };
}

/**
 * Transaction history, newest first, with a live head: when a block lands, the first page is fetched
 * again and anything new is prepended to the cached pages (so a long scroll position is kept).
 */
export function useAddressTxsLive(addr: string, limit = 25) {
  const qc = useQueryClient();
  const tip = useTipHeight();
  const q = useAddressTxs(addr, { limit });
  const key = qk.address.txs(addr, { limit });
  useOnTip(tip, () => {
    void api.addressTxs(addr, { limit }).then((head) => {
      qc.setQueryData<InfiniteData<AddressTxsPage, string | null>>(key, (old) => {
        if (!old || old.pages.length === 0) return old;
        const seen = new Set(old.pages.flatMap((p) => p.items.map((t) => t.txid)));
        const fresh = head.items.filter((t) => !seen.has(t.txid));
        // Items that were pending and are now mined carry newer data: replace them in place.
        const byId = new Map(head.items.map((t) => [t.txid, t]));
        const pages = old.pages.map((p, i) => ({
          ...p,
          items: (i === 0 ? [...fresh, ...p.items] : p.items).map((t) =>
            t.height === null ? (byId.get(t.txid) ?? t) : t,
          ),
          total: i === 0 ? head.total : p.total,
        }));
        return { ...old, pages };
      });
    });
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? null;
  return { ...q, items, total };
}

export { useAddressNodes, useAddressUtxos };

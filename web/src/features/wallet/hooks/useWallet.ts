// The wallet's three queries, and the live part: a page that is open when a block pays the wallet knows at once
// (the block's payouts are in the store), says so, and fetches the wallet again for the new balance. Between
// payments the wallet is refreshed at most every couple of minutes while blocks keep arriving; nothing polls.

import { type UseQueryResult, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { Slice } from '../../../store/network';
import { walletKeys, walletQueries } from '../api';
import { KEEP_LANDINGS, type Landing, landingsAfter, newestHeight, pushLandings } from '../lib/landing';
import type { ParallelAssetsDto, PricesDto, WalletDto } from '../types';

/** A wallet that no block has paid is fetched again after this long, as blocks keep arriving. */
export const IDLE_REFRESH_MS = 2 * 60_000;

export interface WalletData {
  query: UseQueryResult<WalletDto>;
  dto: WalletDto | undefined;
  /** Payments that landed while this page was open, newest first. */
  landings: readonly Landing[];
}

export function useWallet(addr: string): WalletData {
  const query = useQuery(walletQueries.wallet(addr));
  const landings = useLandings(addr, query.data?.address);
  return { query, dto: query.data, landings };
}

/** The parallel assets, from an external service that can be down on its own: its own query, its own failure. */
export function useParallelAssets(addr: string): UseQueryResult<ParallelAssetsDto> {
  return useQuery(walletQueries.parallelAssets(addr));
}

export function usePrices(): UseQueryResult<PricesDto> {
  return useQuery(walletQueries.prices());
}

/**
 * Watches the live blocks for payments to this wallet. It subscribes to the store directly, so the page does not
 * re-render for every block, only for one that paid the wallet. `canonical` is the address as the server spells it
 * (the route may carry another case or a ZelID); both are matched.
 */
export function useLandings(addr: string, canonical: string | undefined): readonly Landing[] {
  const { store } = useRuntime();
  const qc = useQueryClient();
  const [landings, setLandings] = useState<readonly Landing[]>([]);
  // The names to match change when the wallet arrives; the watch itself is not restarted for them.
  const names = useRef<readonly string[]>([addr]);
  names.current = [addr, canonical].filter((a): a is string => !!a);

  useEffect(() => {
    setLandings([]);
    let seen = newestHeight(store.blocks.toArray());
    const keyOf = (id: number): string | null => {
      const i = store.nodes.indexOf(id);
      return i < 0 ? null : store.nodes.outpoint(i) || null;
    };
    return store.subscribe((change) => {
      if (!(change.slices & Slice.Blocks)) return;
      const blocks = store.blocks.toArray();
      const found = [...new Set(names.current)].flatMap((a) => landingsAfter(blocks, a, seen, keyOf));
      seen = Math.max(seen, newestHeight(blocks));
      const key = walletKeys.one(addr);
      if (found.length > 0) {
        found.sort((a, b) => a.height - b.height);
        setLandings((kept) => pushLandings(kept, found).slice(0, KEEP_LANDINGS));
        void qc.invalidateQueries({ queryKey: key, refetchType: 'active' });
        return;
      }
      const at = qc.getQueryState(key)?.dataUpdatedAt ?? 0;
      if (at > 0 && Date.now() - at >= IDLE_REFRESH_MS) {
        void qc.invalidateQueries({ queryKey: key, refetchType: 'active' });
      }
    });
  }, [store, qc, addr]);

  return landings;
}

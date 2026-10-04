// Fetchers and query options for the wallet workspace's three endpoints. They live here, next to the feature,
// until the backend's generated types and `api/endpoints.ts` entries land (see types.ts).
//
// The three are deliberately separate queries: the wallet itself comes from this server's own data and is fast
// and dependable, the parallel assets come from an external service (Zelcore Fusion) that can be down on its
// own, and the prices change slowly. A failure in one never blanks the others.

import { queryOptions } from '@tanstack/react-query';
import { getJson, type RequestOptions, seg } from '../../api/http';
import { qk } from '../../api/queryKeys';
import type { ParallelAssetsDto, PricesDto, WalletDto } from './types';

const SEC = 1000;
const MIN = 60 * SEC;

export const walletApi = {
  wallet: (addr: string, o?: RequestOptions) => getJson<WalletDto>(`/wallet/${seg(addr)}`, undefined, o),
  parallelAssets: (addr: string, o?: RequestOptions) =>
    getJson<ParallelAssetsDto>(`/wallet/${seg(addr)}/parallel-assets`, undefined, o),
  prices: (o?: RequestOptions) => getJson<PricesDto>('/prices', undefined, o),
};

const root = [...qk.all(), 'wallet'] as const;

export const walletKeys = {
  all: () => root,
  one: (addr: string) => [...root, 'dto', addr] as const,
  assets: (addr: string) => [...root, 'assets', addr] as const,
  prices: () => [...root, 'prices'] as const,
  /** One node's history, for the uptime sample (the Health tab). */
  uptime: (nodeKey: string) => [...root, 'uptime', nodeKey] as const,
};

export const walletQueries = {
  wallet: (addr: string) =>
    queryOptions({
      queryKey: walletKeys.one(addr),
      queryFn: ({ signal }) => walletApi.wallet(addr, { signal }),
      // Payout ETAs, last-paid and the run-rate move every block; a block that pays the wallet refetches it
      // at once (useWallet), and the rest wait out this interval.
      staleTime: 30 * SEC,
    }),
  parallelAssets: (addr: string) =>
    queryOptions({
      queryKey: walletKeys.assets(addr),
      queryFn: ({ signal }) => walletApi.parallelAssets(addr, { signal }),
      // An external service: ask politely, and keep what it said for a few minutes.
      staleTime: 5 * MIN,
      retry: 1,
    }),
  prices: () =>
    queryOptions({
      queryKey: walletKeys.prices(),
      queryFn: ({ signal }) => walletApi.prices({ signal }),
      staleTime: 5 * MIN,
    }),
};

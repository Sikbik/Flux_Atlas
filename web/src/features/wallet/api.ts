// Fetchers and query options for the wallet workspace's three endpoints. The shared client has no entries for them
// (`api/endpoints.ts` is the app's own explorer API), so they live here, next to the feature, on the same `getJson`.
//
// The three are deliberately separate queries: the wallet itself comes from this server's own data and is fast
// and dependable, the parallel assets come from an external service (Flux Fusion) that can be down on its
// own, and the prices change slowly. A failure in one never blanks the others.

import { queryOptions } from '@tanstack/react-query';
import { ApiError, getJson, type RequestOptions, seg } from '../../api/http';
import { qk } from '../../api/queryKeys';
import type { ParallelAssetsDto, PricesDto, WalletDto } from './types';

const SEC = 1000;
const MIN = 60 * SEC;

/** What the server says when Fusion does not answer (503 with `Retry-After: 30`, or 502): ask again after this. */
export const FUSION_RETRY_MS = 30 * SEC;

/** Whether an error is the parallel-asset service being down (as opposed to a bad address or a client fault). */
export function isUpstreamDown(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'upstream_unavailable' ||
      error.code === 'upstream' ||
      error.code === 'unavailable' ||
      error.status === 502 ||
      error.status === 503)
  );
}

/** How long to wait before asking again: the server's `Retry-After` when it sent one, else half a minute. */
export function retryAfterMs(error: unknown): number {
  const s = error instanceof ApiError ? error.retryAfterS : undefined;
  return s !== undefined && Number.isFinite(s) && s > 0 ? Math.min(s, 300) * SEC : FUSION_RETRY_MS;
}

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
      // An external service: ask politely, and keep what it said for a few minutes. When it is down the page must
      // say so at once, not after the app's own retries (which wait out the server's Retry-After: half a minute
      // each), so there is no retry here. The state it shows asks again at the pace the server states, and stops the
      // moment Fusion answers (the page is open and visible: no background polling).
      staleTime: 5 * MIN,
      retry: false,
      refetchInterval: (query) => (query.state.status === 'error' ? retryAfterMs(query.state.error) : false),
    }),
  prices: () =>
    queryOptions({
      queryKey: walletKeys.prices(),
      queryFn: ({ signal }) => walletApi.prices({ signal }),
      staleTime: 5 * MIN,
    }),
};

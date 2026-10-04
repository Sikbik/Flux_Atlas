// The one endpoint the Apps hub reads that nothing else does yet: the app economy (`GET /network/app-economy`), what
// apps pay for their register and update messages. Its type is the generated one; the query lives here until it moves
// into `api/endpoints.ts` and `api/queries.ts` with the rest.
//
// Like the hub's own three endpoints it answers 503 with `Retry-After: 5` until the chain tip is known. That is the
// server saying "wait", so the query keeps asking and the panel says the numbers are being read.

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppEconomyDto } from '../../../api/generated/AppEconomyDto';
import { getJson } from '../../../api/http';
import { qk } from '../../../api/queryKeys';
import { retryWhileFilling } from '../api';

/** The panel draws a quarter of daily figures (the endpoint takes 1 to 365 days, 90 by default). */
export const ECONOMY_DAYS = 90;
/** It names the biggest payer and no more (the endpoint takes 1 to 100, 20 by default). */
export const ECONOMY_TOP = 3;

/** The server builds one body per tip and keeps it a minute; asking more often repeats the answer. */
const ECONOMY_STALE_MS = 60_000;

export const appEconomyKey = () => [...qk.network.all(), 'app-economy', ECONOMY_DAYS, ECONOMY_TOP] as const;

export const appEconomyQuery = () =>
  queryOptions({
    queryKey: appEconomyKey(),
    queryFn: ({ signal }) =>
      getJson<AppEconomyDto>('/network/app-economy', { days: ECONOMY_DAYS, top: ECONOMY_TOP }, { signal }),
    staleTime: ECONOMY_STALE_MS,
    retry: retryWhileFilling,
  });

export const useAppEconomy = () => useQuery(appEconomyQuery());

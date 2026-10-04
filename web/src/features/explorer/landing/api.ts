// The two endpoints the Explorer landing is the first to read: the chain's daily figures (`GET /chain/daily`) and the
// rich list's movers (`GET /richlist/movers`). Their types are the generated ones; the queries live here until they
// move into `api/endpoints.ts` and `api/queries.ts` with the rest.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { ChainDailyDto } from '../../../api/generated/ChainDailyDto';
import type { RichListDto } from '../../../api/generated/RichListDto';
import type { RichMoversDto } from '../../../api/generated/RichMoversDto';
import type { RichMoversWindow } from '../../../api/generated/RichMoversWindow';
import { getJson, isApiError } from '../../../api/http';
import { qk } from '../../../api/queryKeys';

const SEC = 1000;
const MIN = 60 * SEC;

// ---- /chain/daily -------------------------------------------------------------------------------------------

/**
 * The `days` parameter of the endpoint. `all` is everything Insight keeps, the last two years (730 days), not the
 * chain's whole life.
 */
export type DailyRange = '30' | '90' | '365' | 'all';

/** The server refreshes the series every 12 hours: asking more than once in a while only repeats the answer. */
const DAILY_STALE_MS = 30 * MIN;

/** How many times a start-up 503 is asked again (the server says to wait 5 s, and fills in about 30 s). */
const FILL_RETRIES = 12;

/** True for the answer a server gives before its first fill of the daily series: 503 with `Retry-After`. */
export function isFilling(error: unknown): boolean {
  return isApiError(error) && error.status === 503;
}

export const chainDailyKey = (range: DailyRange) => [...qk.all(), 'chain-daily', range] as const;

export const chainDailyQuery = (range: DailyRange) =>
  queryOptions({
    queryKey: chainDailyKey(range),
    queryFn: ({ signal }) => getJson<ChainDailyDto>('/chain/daily', { days: range }, { signal }),
    staleTime: DAILY_STALE_MS,
    // Before its first fill the server answers 503 and a Retry-After of 5 s: that is waiting, not failing, so the
    // query keeps asking (at the pace the server names) and the panel says the history is being read.
    retry: (count, error) =>
      isFilling(error) ? count < FILL_RETRIES : count < 3 && (!isApiError(error) || error.retryable),
    // A new range keeps the last chart on screen, dimmed, until its answer arrives.
    placeholderData: keepPreviousData,
  });

export const useChainDaily = (range: DailyRange) => useQuery(chainDailyQuery(range));

// ---- /richlist/movers ---------------------------------------------------------------------------------------

/** The window the landing and the rich list page open with. */
export const DEFAULT_MOVERS_WINDOW: RichMoversWindow = '7d';

export const richMoversKey = (window: RichMoversWindow) => [...qk.richList(), 'movers', window] as const;

export const richMoversQuery = (window: RichMoversWindow) =>
  queryOptions({
    queryKey: richMoversKey(window),
    queryFn: ({ signal }) => getJson<RichMoversDto>('/richlist/movers', { window }, { signal }),
    // The comparison changes once a day.
    staleTime: 10 * MIN,
    placeholderData: keepPreviousData,
  });

export const useRichMovers = (window: RichMoversWindow) => useQuery(richMoversQuery(window));

// ---- the rich list's `stale` flag ----------------------------------------------------------------------------

/**
 * True when the server is serving the last good copy of the ranking because it could not build a fresh one (or the
 * copy is over an hour old). `updated_ms` is then the time of that copy.
 */
export const isRichListStale = (dto: Pick<RichListDto, 'stale'> | undefined | null): boolean =>
  dto?.stale === true;

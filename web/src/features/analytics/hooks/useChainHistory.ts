// The chain's recorded history for one window (`GET /network/chain-history`). The newest bucket moves
// with every block, so an open tab asks again on a cadence that suits the window: the 24 hour window
// follows the chain (a block every 30 s), the longer ones barely move between asks. A server that is
// still reading the chain's past is asked about every 30 s whatever the window, so the indexing note
// and the history keep filling in. A window switch keeps the last answer on screen, dimmed, until the
// next one arrives.
//
// The request goes through the shared transport (`api/http`) like every other endpoint; it is declared
// here because its types are the feature's own until the server's are generated.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { ChainHistoryDto } from '../../../api/generated/ChainHistoryDto';
import type { ChainWindow } from '../../../api/generated/ChainWindow';
import { getJson } from '../../../api/http';
import { qk } from '../../../api/queryKeys';

const SEC = 1000;
const MIN = 60 * SEC;

/** How often an open tab asks again, by window. */
export const CHAIN_REFRESH_MS: Record<ChainWindow, number> = {
  '24h': 30 * SEC,
  '7d': 3 * MIN,
  '30d': 5 * MIN,
  '1y': 5 * MIN,
  all: 5 * MIN,
};

/** While the server is still indexing, how often at most. */
export const INDEXING_REFRESH_MS = 30 * SEC;

export const chainHistoryKey = (window: ChainWindow) =>
  [...qk.network.all(), 'chain-history', window] as const;

/** The interval for the next ask, given what the last answer said. */
export function refreshInterval(window: ChainWindow, last: ChainHistoryDto | undefined): number {
  const every = CHAIN_REFRESH_MS[window];
  return last && !last.coverage.complete ? Math.min(every, INDEXING_REFRESH_MS) : every;
}

export const chainHistoryQuery = (window: ChainWindow) =>
  queryOptions({
    queryKey: chainHistoryKey(window),
    queryFn: ({ signal }) => getJson<ChainHistoryDto>('/network/chain-history', { window }, { signal }),
    // Fresh for most of one interval: reopening the tab at once does not ask again, coming back later does.
    staleTime: Math.round(CHAIN_REFRESH_MS[window] * 0.66),
    refetchInterval: (query) => refreshInterval(window, query.state.data),
    placeholderData: keepPreviousData,
  });

export const useChainHistory = (window: ChainWindow) => useQuery(chainHistoryQuery(window));

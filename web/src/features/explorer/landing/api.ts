// The two endpoints the Explorer landing is the first to read: the chain's daily figures since its first day
// (`GET /chain/daily`) and the rich list's movers (`GET /richlist/movers`). Their DTOs are declared here until the
// generated types arrive, and the queries live here for the same reason; the shapes below are the data contract.
//
// TODO(reconcile): replace `ChainDailyDto`, `ChainDailyDay`, `RichMoversDto`, `RichMove`, `RichEntered`, `RichLeft`
// and `RichConcentrationPoint` with the generated types (`api/generated`), move the two queries into
// `api/endpoints.ts` and `api/queries.ts`, and read `stale` from the generated `RichListDto`.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { Amount } from '../../../api/generated/Amount';
import type { RichListDto } from '../../../api/generated/RichListDto';
import { getJson } from '../../../api/http';
import { qk } from '../../../api/queryKeys';

const SEC = 1000;
const MIN = 60 * SEC;

// ---- /chain/daily -------------------------------------------------------------------------------------------

/** One UTC day of the chain. A figure the server could not read is `null`, never 0. */
export interface ChainDailyDay {
  /** Unix ms of the day's UTC midnight. */
  day_ms: number;
  /** Transactions mined that day (the coinbase and node check-ins included). */
  transactions: number | null;
  /** Fees paid that day, FLUX. */
  fees: number | null;
  /** The total value of the day's transaction outputs, FLUX ("FLUX moved"). */
  outputs: number | null;
  /** Total supply at the end of the day, FLUX. */
  supply: number | null;
  /** Difficulty. Across the change to Proof of Node it is a different quantity. */
  difficulty: number | null;
  /** Network hash rate of the day (the proof of work years; `null` since Proof of Node), hashes a second. */
  network_hash: number | null;
}

/** `GET /chain/daily?days=30|90|365|all`: oldest first, refreshed by the server every 12 hours. */
export interface ChainDailyDto {
  generated_ms: number;
  /** The chain's first day (UTC midnight), or null when the server has none yet. */
  first_day_ms: number | null;
  days: ChainDailyDay[];
}

/** The `days` parameter of the endpoint. */
export type DailyRange = '30' | '90' | '365' | 'all';

/** Refreshed server side every 12 hours: asking more than once in a while only repeats the answer. */
const DAILY_STALE_MS = 30 * MIN;

export const chainDailyKey = (range: DailyRange) => [...qk.all(), 'chain-daily', range] as const;

export const chainDailyQuery = (range: DailyRange) =>
  queryOptions({
    queryKey: chainDailyKey(range),
    queryFn: ({ signal }) => getJson<ChainDailyDto>('/chain/daily', { days: range }, { signal }),
    staleTime: DAILY_STALE_MS,
    // A new range keeps the last chart on screen, dimmed, until its answer arrives.
    placeholderData: keepPreviousData,
  });

export const useChainDaily = (range: DailyRange) => useQuery(chainDailyQuery(range));

// ---- /richlist/movers ---------------------------------------------------------------------------------------

export type MoversWindow = '1d' | '7d' | '30d';

/** An address that gained or lost balance over the window and is on the list now (or was). */
export interface RichMove {
  address: string;
  /** Its rank now, or null when it fell off the list. */
  rank: number | null;
  /** Its rank at the start of the window, or null when it was not on the list. */
  prev_rank: number | null;
  balance: Amount;
  prev_balance: Amount;
  /** `balance - prev_balance`, signed. */
  delta: Amount;
  node_count: number;
}

export interface RichEntered {
  address: string;
  rank: number;
  balance: Amount;
  node_count: number;
}

export interface RichLeft {
  address: string;
  prev_rank: number;
  prev_balance: Amount;
}

/** The share of the supply held by the largest 10, 100 and 1,000 addresses on one day. */
export interface RichConcentrationPoint {
  day_ms: number;
  top10_pct: number;
  top100_pct: number;
  top1000_pct: number;
}

/**
 * `GET /richlist/movers?window=1d|7d|30d`. The server saves one snapshot of the ranking a day, from the day it
 * starts: while `snapshots < 2` there is nothing to compare, `from_ms` is null and every list is empty.
 */
export interface RichMoversDto {
  window: MoversWindow;
  to_ms: number;
  from_ms: number | null;
  snapshots: number;
  gainers: RichMove[];
  losers: RichMove[];
  entered: RichEntered[];
  left: RichLeft[];
  concentration: RichConcentrationPoint[];
}

export const richMoversKey = (window: MoversWindow) => [...qk.richList(), 'movers', window] as const;

export const richMoversQuery = (window: MoversWindow) =>
  queryOptions({
    queryKey: richMoversKey(window),
    queryFn: ({ signal }) => getJson<RichMoversDto>('/richlist/movers', { window }, { signal }),
    // The comparison changes once a day.
    staleTime: 10 * MIN,
    placeholderData: keepPreviousData,
  });

export const useRichMovers = (window: MoversWindow) => useQuery(richMoversQuery(window));

// ---- the rich list's `stale` flag ----------------------------------------------------------------------------

/**
 * True when the server is serving the last good ranking because it could not build a fresh one. The generated
 * `RichListDto` has no `stale` yet (see the TODO above), so it is read off the response.
 */
export function isRichListStale(dto: RichListDto | undefined | null): boolean {
  return (dto as (RichListDto & { stale?: boolean }) | undefined | null)?.stale === true;
}

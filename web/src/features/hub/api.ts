// What the Nodes and Apps hubs read that nothing else does: the operator leaderboard (`GET /network/operators`), the
// nodes overview (`GET /network/nodes-overview`) and the apps overview (`GET /network/apps-overview`). Their types are
// the generated ones; the queries live here until they move into `api/endpoints.ts` and `api/queries.ts` with the rest.
//
// All three answer 503 with `Retry-After: 5` until the chain tip is known. That is the server saying "wait", so a query
// here keeps asking at the pace the server names, a few times more than it would for a real failure, and the panel says
// the numbers are being read instead of showing an error.

import { keepPreviousData, queryOptions, type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { AppsOverviewDto } from '../../api/generated/AppsOverviewDto';
import type { NodesOverviewDto } from '../../api/generated/NodesOverviewDto';
import type { OperatorsBy } from '../../api/generated/OperatorsBy';
import type { OperatorsDto } from '../../api/generated/OperatorsDto';
import { getJson, isApiError } from '../../api/http';
import { qk } from '../../api/queryKeys';

/** A hub query as a panel receives it from its view: the error is whatever the server's answer made of it. */
export type HubQuery<T> = UseQueryResult<T, unknown>;

/** The answers are built once per publish of the node snapshot (about every 90 s): asking more often repeats them. */
const HUB_STALE_MS = 60_000;

/** How many times a start-up 503 is asked again before it counts as a failure (5 s apart: a minute in all). */
export const FILL_RETRIES = 12;

/** True for the answer a server gives before it knows the chain tip: 503, with `Retry-After`. */
export function isFilling(error: unknown): boolean {
  return isApiError(error) && error.status === 503;
}

/** The retry rule for an endpoint that fills: keep asking while the server says to wait, a few times otherwise. */
export function retryWhileFilling(count: number, error: unknown): boolean {
  if (isFilling(error)) return count < FILL_RETRIES;
  return count < 3 && (!isApiError(error) || error.retryable);
}

// ---- the operators -------------------------------------------------------------------------------------------

/** How many operators the leaderboard asks for (the endpoint takes 1 to 500; the hub shows the top of them). */
export const OPERATORS_LIMIT = 25;

export const operatorsKey = (by: OperatorsBy, limit: number) =>
  [...qk.network.all(), 'operators', by, limit] as const;

export const operatorsQuery = (by: OperatorsBy, limit: number = OPERATORS_LIMIT) =>
  queryOptions({
    queryKey: operatorsKey(by, limit),
    queryFn: ({ signal }) => getJson<OperatorsDto>('/network/operators', { by, limit }, { signal }),
    staleTime: HUB_STALE_MS,
    retry: retryWhileFilling,
    // Switching between ZelID and payment address keeps the last list on screen, dimmed, until the next one is in.
    placeholderData: keepPreviousData,
  });

export const useOperators = (by: OperatorsBy, limit: number = OPERATORS_LIMIT) =>
  useQuery(operatorsQuery(by, limit));

// ---- the nodes overview --------------------------------------------------------------------------------------

export const nodesOverviewKey = () => [...qk.network.all(), 'nodes-overview'] as const;

export const nodesOverviewQuery = () =>
  queryOptions({
    queryKey: nodesOverviewKey(),
    queryFn: ({ signal }) => getJson<NodesOverviewDto>('/network/nodes-overview', undefined, { signal }),
    staleTime: HUB_STALE_MS,
    retry: retryWhileFilling,
  });

export const useNodesOverview = () => useQuery(nodesOverviewQuery());

// ---- the apps overview ---------------------------------------------------------------------------------------

export const appsOverviewKey = () => [...qk.network.all(), 'apps-overview'] as const;

export const appsOverviewQuery = () =>
  queryOptions({
    queryKey: appsOverviewKey(),
    queryFn: ({ signal }) => getJson<AppsOverviewDto>('/network/apps-overview', undefined, { signal }),
    staleTime: HUB_STALE_MS,
    retry: retryWhileFilling,
  });

export const useAppsOverview = () => useQuery(appsOverviewQuery());

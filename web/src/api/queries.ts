// TanStack Query options and hooks for every entity and analytics view. `queries.*` returns plain
// option objects (usable in route loaders with `queryClient.ensureQueryData`); the `use*` hooks wrap
// them. Freshness is live-first: long stale times, with `liveInvalidation.ts` invalidating or
// patching the affected keys the moment a WebSocket event says the data changed.

import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { canonicalNodeKey } from '../store/nodeKeys';
import {
  api,
  type BlocksParams,
  type CursorParams,
  type MetricsParams,
  type NodesParams,
  type RangeParams,
} from './endpoints';
import { qk } from './queryKeys';

const SEC = 1000;
const MIN = 60 * SEC;

/** Stale times by data class. Live-updated data relies on invalidation, not polling. */
export const staleTimes = {
  /** Kept current by live events (invalidated or patched on change). */
  live: 5 * MIN,
  /** Derived aggregates recomputed by the server on publish. */
  derived: 30 * SEC,
  /** Immutable (deep blocks, confirmed transactions, history). */
  immutable: Number.POSITIVE_INFINITY,
  /** Upstream-proxied explorer data. */
  explorer: 60 * SEC,
} as const;

export const queries = {
  bootstrap: () =>
    queryOptions({
      queryKey: qk.bootstrap(),
      queryFn: ({ signal }) => api.bootstrap({ signal }),
      staleTime: staleTimes.live,
    }),
  health: () =>
    queryOptions({
      queryKey: qk.health(),
      queryFn: ({ signal }) => api.health({ signal }),
      staleTime: 10 * SEC,
    }),

  nodes: (p: NodesParams = {}) =>
    queryOptions({
      queryKey: qk.nodes.list(p),
      queryFn: ({ signal }) => api.nodes(p, { signal }),
      staleTime: staleTimes.derived,
      placeholderData: keepPreviousData,
    }),
  // Node queries are keyed and fetched by outpoint whenever the snapshot knows the node: the same
  // node on every instance behind the domain (ARCHITECTURE 8.1).
  nodeDetail: (key: string | number, k = canonicalNodeKey(key)) =>
    queryOptions({
      queryKey: qk.nodes.detail(k),
      queryFn: ({ signal }) => api.node(k, { signal }),
      staleTime: staleTimes.live,
    }),
  nodeHistory: (key: string | number, p: RangeParams = {}, k = canonicalNodeKey(key)) =>
    queryOptions({
      queryKey: qk.nodes.history(k, p),
      queryFn: ({ signal }) => api.nodeHistory(k, p, { signal }),
      staleTime: staleTimes.derived,
    }),
  nodePayments: (key: string | number, p: Omit<CursorParams, 'cursor'> = {}, k = canonicalNodeKey(key)) =>
    infiniteQueryOptions({
      queryKey: qk.nodes.payments(k, p),
      queryFn: ({ signal, pageParam }) => api.nodePayments(k, { ...p, cursor: pageParam }, { signal }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor ?? undefined,
      staleTime: staleTimes.live,
    }),
  nodePeers: (key: string | number, k = canonicalNodeKey(key)) =>
    queryOptions({
      queryKey: qk.nodes.peers(k),
      queryFn: ({ signal }) => api.nodePeers(k, { signal }),
      staleTime: staleTimes.derived,
    }),
  operator: (address: string) =>
    queryOptions({
      queryKey: qk.operator(address),
      queryFn: ({ signal }) => api.operator(address, { signal }),
      staleTime: staleTimes.live,
    }),

  appsIndex: () =>
    queryOptions({
      queryKey: qk.apps.index(),
      queryFn: ({ signal }) => api.apps({ signal }),
      staleTime: staleTimes.live,
    }),
  appDetail: (name: string) =>
    queryOptions({
      queryKey: qk.apps.detail(name),
      queryFn: ({ signal }) => api.app(name, { signal }),
      staleTime: staleTimes.live,
    }),
  appHistory: (name: string) =>
    queryOptions({
      queryKey: qk.apps.history(name),
      queryFn: ({ signal }) => api.appHistory(name, { signal }),
      staleTime: staleTimes.live,
    }),

  networkSummary: () =>
    queryOptions({
      queryKey: qk.network.summary(),
      queryFn: ({ signal }) => api.networkSummary({ signal }),
      staleTime: staleTimes.live,
    }),
  networkGeo: () =>
    queryOptions({
      queryKey: qk.network.geo(),
      queryFn: ({ signal }) => api.networkGeo({ signal }),
      staleTime: staleTimes.derived,
    }),
  networkProviders: () =>
    queryOptions({
      queryKey: qk.network.providers(),
      queryFn: ({ signal }) => api.networkProviders({ signal }),
      staleTime: staleTimes.derived,
    }),
  networkVersions: () =>
    queryOptions({
      queryKey: qk.network.versions(),
      queryFn: ({ signal }) => api.networkVersions({ signal }),
      staleTime: staleTimes.derived,
    }),
  networkCapacity: () =>
    queryOptions({
      queryKey: qk.network.capacity(),
      queryFn: ({ signal }) => api.networkCapacity({ signal }),
      staleTime: staleTimes.derived,
    }),
  networkDecentralization: () =>
    queryOptions({
      queryKey: qk.network.decentralization(),
      queryFn: ({ signal }) => api.networkDecentralization({ signal }),
      staleTime: staleTimes.derived,
    }),
  metrics: (p: MetricsParams) =>
    queryOptions({
      queryKey: qk.metrics(p),
      queryFn: ({ signal }) => api.metrics(p, { signal }),
      staleTime: MIN,
      placeholderData: keepPreviousData,
    }),

  blocks: (p: Omit<BlocksParams, 'before'> = {}) =>
    infiniteQueryOptions({
      queryKey: qk.blocks.list(p),
      queryFn: ({ signal, pageParam }) => api.blocks({ ...p, before: pageParam }, { signal }),
      initialPageParam: null as number | null,
      getNextPageParam: (last) => last.next_before ?? undefined,
      staleTime: staleTimes.live,
    }),
  block: (id: string | number) =>
    queryOptions({
      queryKey: qk.blocks.detail(id),
      queryFn: ({ signal }) => api.block(id, { signal }),
      staleTime: staleTimes.explorer,
    }),
  tx: (txid: string) =>
    queryOptions({
      queryKey: qk.tx(txid),
      queryFn: ({ signal }) => api.tx(txid, { signal }),
      staleTime: staleTimes.explorer,
    }),
  address: (addr: string) =>
    queryOptions({
      queryKey: qk.address.detail(addr),
      queryFn: ({ signal }) => api.address(addr, { signal }),
      staleTime: staleTimes.explorer,
    }),
  addressTxs: (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
    infiniteQueryOptions({
      queryKey: qk.address.txs(addr, p),
      queryFn: ({ signal, pageParam }) => api.addressTxs(addr, { ...p, cursor: pageParam }, { signal }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor ?? undefined,
      staleTime: staleTimes.explorer,
    }),
  addressUtxos: (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
    infiniteQueryOptions({
      queryKey: qk.address.utxos(addr, p),
      queryFn: ({ signal, pageParam }) => api.addressUtxos(addr, { ...p, cursor: pageParam }, { signal }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor ?? undefined,
      staleTime: staleTimes.explorer,
    }),
  addressNodes: (addr: string) =>
    queryOptions({
      queryKey: qk.address.nodes(addr),
      queryFn: ({ signal }) => api.addressNodes(addr, { signal }),
      staleTime: staleTimes.live,
    }),
  mempool: () =>
    queryOptions({
      queryKey: qk.mempool(),
      queryFn: ({ signal }) => api.mempool({ signal }),
      staleTime: 15 * SEC,
    }),
  supply: () =>
    queryOptions({
      queryKey: qk.supply(),
      queryFn: ({ signal }) => api.supply({ signal }),
      staleTime: 5 * MIN,
    }),
  richList: () =>
    queryOptions({
      queryKey: qk.richList(),
      queryFn: ({ signal }) => api.richList({ signal }),
      staleTime: 10 * MIN,
    }),
  search: (q: string) =>
    queryOptions({
      queryKey: qk.search(q),
      queryFn: ({ signal }) => api.search(q.trim(), { signal }),
      staleTime: 30 * SEC,
      enabled: q.trim().length > 0,
      placeholderData: keepPreviousData,
    }),

  timeline: () =>
    queryOptions({
      queryKey: qk.timeline.index(),
      queryFn: ({ signal }) => api.timeline({ signal }),
      staleTime: MIN,
    }),
  timelineState: (t: number) =>
    queryOptions({
      queryKey: qk.timeline.state(t),
      queryFn: ({ signal }) => api.timelineState(t, { signal }),
      staleTime: staleTimes.immutable,
      gcTime: 2 * MIN,
    }),
};

// Hooks: one per entity and analytics view.
export const useBootstrap = () => useQuery(queries.bootstrap());
export const useHealth = () => useQuery(queries.health());
export const useNodes = (p: NodesParams = {}) => useQuery(queries.nodes(p));
export const useNodeDetail = (key: string | number) => useQuery(queries.nodeDetail(key));
export const useNodeHistory = (key: string | number, p: RangeParams = {}) =>
  useQuery(queries.nodeHistory(key, p));
export const useNodePayments = (key: string | number, p: Omit<CursorParams, 'cursor'> = {}) =>
  useInfiniteQuery(queries.nodePayments(key, p));
export const useNodePeers = (key: string | number) => useQuery(queries.nodePeers(key));
export const useOperator = (address: string) => useQuery(queries.operator(address));
export const useAppsIndex = () => useQuery(queries.appsIndex());
export const useAppDetail = (name: string) => useQuery(queries.appDetail(name));
export const useAppHistory = (name: string) => useQuery(queries.appHistory(name));
export const useNetworkSummary = () => useQuery(queries.networkSummary());
export const useNetworkGeo = () => useQuery(queries.networkGeo());
export const useNetworkProviders = () => useQuery(queries.networkProviders());
export const useNetworkVersions = () => useQuery(queries.networkVersions());
export const useNetworkCapacity = () => useQuery(queries.networkCapacity());
export const useNetworkDecentralization = () => useQuery(queries.networkDecentralization());
export const useMetrics = (p: MetricsParams) => useQuery(queries.metrics(p));
export const useBlocks = (p: Omit<BlocksParams, 'before'> = {}) => useInfiniteQuery(queries.blocks(p));
export const useBlock = (id: string | number) => useQuery(queries.block(id));
export const useTx = (txid: string) => useQuery(queries.tx(txid));
export const useAddress = (addr: string) => useQuery(queries.address(addr));
export const useAddressTxs = (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
  useInfiniteQuery(queries.addressTxs(addr, p));
export const useAddressUtxos = (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
  useInfiniteQuery(queries.addressUtxos(addr, p));
export const useAddressNodes = (addr: string) => useQuery(queries.addressNodes(addr));
export const useMempool = () => useQuery(queries.mempool());
export const useSupply = () => useQuery(queries.supply());
export const useRichList = () => useQuery(queries.richList());
export const useSearch = (q: string) => useQuery(queries.search(q));
export const useTimeline = () => useQuery(queries.timeline());
export const useTimelineState = (t: number) => useQuery(queries.timelineState(t));

// Typed functions for every `/api/v1` endpoint (ARCHITECTURE section 6). DTOs come from the Rust
// types through ts-rs (`./generated`, never hand-edited). Every function takes an optional
// AbortSignal and rejects with `ApiError` on failure.

import { canonicalNodeKey } from '../store/nodeKeys';
import type { AddressDto } from './generated/AddressDto';
import type { AddressNodesDto } from './generated/AddressNodesDto';
import type { AddressTxsPage } from './generated/AddressTxsPage';
import type { AddressUtxosDto } from './generated/AddressUtxosDto';
import type { AppDetailDto } from './generated/AppDetailDto';
import type { AppHistoryDto } from './generated/AppHistoryDto';
import type { AppsIndexDto } from './generated/AppsIndexDto';
import type { BlockDetailDto } from './generated/BlockDetailDto';
import type { BlocksPage } from './generated/BlocksPage';
import type { BootstrapDto } from './generated/BootstrapDto';
import type { CapacityDto } from './generated/CapacityDto';
import type { DecentralizationDto } from './generated/DecentralizationDto';
import type { GeoBreakdownDto } from './generated/GeoBreakdownDto';
import type { HealthDto } from './generated/HealthDto';
import type { MempoolDto } from './generated/MempoolDto';
import type { MetricsSeriesDto } from './generated/MetricsSeriesDto';
import type { NetworkSummary } from './generated/NetworkSummary';
import type { NodeDetailDto } from './generated/NodeDetailDto';
import type { NodeHistoryDto } from './generated/NodeHistoryDto';
import type { NodePaymentsPage } from './generated/NodePaymentsPage';
import type { NodePeersDto } from './generated/NodePeersDto';
import type { NodesPage } from './generated/NodesPage';
import type { NodesQuery } from './generated/NodesQuery';
import type { OperatorDto } from './generated/OperatorDto';
import type { ProvidersDto } from './generated/ProvidersDto';
import type { RichListDto } from './generated/RichListDto';
import type { SearchResultsDto } from './generated/SearchResultsDto';
import type { SupplyDto } from './generated/SupplyDto';
import type { TimelineDto } from './generated/TimelineDto';
import type { TxDetailDto } from './generated/TxDetailDto';
import type { VersionsDto } from './generated/VersionsDto';
import { getBinary, getJson, getRootJson, type RequestOptions, seg } from './http';
import { decodeMeshBin, type MeshBin } from './meshBin';
import { decodeNodesBin, type NodesBin } from './nodesBin';

/** Filters and paging of `GET /nodes`; every field optional. */
export type NodesParams = { [K in keyof NodesQuery]?: NodesQuery[K] | undefined };

export interface CursorParams {
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

export interface BlocksParams {
  /** Fetch blocks strictly below this height (use `next_before` of the previous page). */
  before?: number | null | undefined;
  limit?: number | undefined;
}

export interface RangeParams {
  from?: number | undefined;
  to?: number | undefined;
}

/** Metric series names accepted by `GET /metrics` (see crates/atlas-server/src/routes/network.rs). */
export type MetricName =
  | 'tip_height'
  | 'node_count'
  | 'cumulus'
  | 'nimbus'
  | 'stratus'
  | 'host_count'
  | 'country_count'
  | 'arcane_count'
  | 'unreachable_count'
  | 'app_count'
  | 'instance_count'
  | 'pending_app_count'
  | 'total_cores'
  | 'total_ram_gb'
  | 'total_storage_gb'
  | 'supply_flux_f64'
  | 'price_usd'
  | 'mempool_size'
  | 'mesh_edge_count'
  | 'block_count'
  | 'tx_count'
  | 'node_tx_count'
  | 'fees_flux_f64'
  | 'payouts_flux_f64'
  | 'avg_block_time_ms';

export interface MetricsParams extends RangeParams {
  series: readonly MetricName[];
  /** Bucket width: milliseconds (>= 60000) or a duration such as `5m`, `1h`. */
  step?: number | string | undefined;
}

type O = RequestOptions;

/** A node path segment: the outpoint when the snapshot knows the node, the key as given otherwise. */
const nodeSeg = (key: string | number): string => seg(canonicalNodeKey(key));

export const api = {
  // Hot snapshots.
  bootstrap: (o?: O) => getJson<BootstrapDto>('/bootstrap', undefined, o),
  nodesBinRaw: (o?: O) => getBinary('/nodes.bin', undefined, o),
  nodesBin: async (o?: O): Promise<NodesBin> => decodeNodesBin(await getBinary('/nodes.bin', undefined, o)),
  meshBin: async (o?: O): Promise<MeshBin> => decodeMeshBin(await getBinary('/mesh.bin', undefined, o)),
  apps: (o?: O) => getJson<AppsIndexDto>('/apps', undefined, o),

  // Nodes.
  nodes: (p: NodesParams = {}, o?: O) => getJson<NodesPage>('/nodes', { ...p }, o),
  /**
   * `key` is a node id, `ip:port`, or a collateral outpoint. Requests name the node by outpoint
   * whenever the loaded snapshot knows it, so a request that reaches the other instance behind the
   * domain still means the same node (ids are per instance, ARCHITECTURE 8.1).
   */
  node: (key: string | number, o?: O) => getJson<NodeDetailDto>(`/nodes/${nodeSeg(key)}`, undefined, o),
  nodeHistory: (key: string | number, p: RangeParams = {}, o?: O) =>
    getJson<NodeHistoryDto>(`/nodes/${nodeSeg(key)}/history`, { ...p }, o),
  nodePayments: (key: string | number, p: CursorParams = {}, o?: O) =>
    getJson<NodePaymentsPage>(`/nodes/${nodeSeg(key)}/payments`, { ...p }, o),
  nodePeers: (key: string | number, o?: O) =>
    getJson<NodePeersDto>(`/nodes/${nodeSeg(key)}/peers`, undefined, o),
  operator: (address: string, o?: O) => getJson<OperatorDto>(`/operator/${seg(address)}`, undefined, o),

  // Apps.
  app: (name: string, o?: O) => getJson<AppDetailDto>(`/apps/${seg(name)}`, undefined, o),
  appHistory: (name: string, o?: O) => getJson<AppHistoryDto>(`/apps/${seg(name)}/history`, undefined, o),

  // Analytics.
  networkSummary: (o?: O) => getJson<NetworkSummary>('/network/summary', undefined, o),
  networkGeo: (o?: O) => getJson<GeoBreakdownDto>('/network/geo', undefined, o),
  networkProviders: (o?: O) => getJson<ProvidersDto>('/network/providers', undefined, o),
  networkVersions: (o?: O) => getJson<VersionsDto>('/network/versions', undefined, o),
  networkCapacity: (o?: O) => getJson<CapacityDto>('/network/capacity', undefined, o),
  networkDecentralization: (o?: O) => getJson<DecentralizationDto>('/network/decentralization', undefined, o),
  metrics: (p: MetricsParams, o?: O) =>
    getJson<MetricsSeriesDto>('/metrics', { series: p.series, from: p.from, to: p.to, step: p.step }, o),

  // Explorer.
  blocks: (p: BlocksParams = {}, o?: O) => getJson<BlocksPage>('/blocks', { ...p }, o),
  /** `id` is a height or a block hash. */
  block: (id: string | number, o?: O) => getJson<BlockDetailDto>(`/blocks/${seg(id)}`, undefined, o),
  tx: (txid: string, o?: O) => getJson<TxDetailDto>(`/tx/${seg(txid)}`, undefined, o),
  address: (addr: string, o?: O) => getJson<AddressDto>(`/address/${seg(addr)}`, undefined, o),
  addressTxs: (addr: string, p: CursorParams = {}, o?: O) =>
    getJson<AddressTxsPage>(`/address/${seg(addr)}/txs`, { ...p }, o),
  addressUtxos: (addr: string, p: CursorParams = {}, o?: O) =>
    getJson<AddressUtxosDto>(`/address/${seg(addr)}/utxos`, { ...p }, o),
  addressNodes: (addr: string, o?: O) =>
    getJson<AddressNodesDto>(`/address/${seg(addr)}/nodes`, undefined, o),
  mempool: (o?: O) => getJson<MempoolDto>('/mempool', undefined, o),
  supply: (o?: O) => getJson<SupplyDto>('/supply', undefined, o),
  richList: (o?: O) => getJson<RichListDto>('/richlist', undefined, o),
  search: (q: string, o?: O) => getJson<SearchResultsDto>('/search', { q }, o),

  // Time machine.
  timeline: (o?: O) => getJson<TimelineDto>('/timeline', undefined, o),
  /** Network state at `t` (unix ms), in nodes.bin format. */
  timelineState: async (t: number, o?: O): Promise<NodesBin> =>
    decodeNodesBin(await getBinary('/timeline/state', { t }, o)),

  // Ops.
  health: (o?: O) => getRootJson<HealthDto>('/healthz', o),
  ready: (o?: O) => getRootJson<HealthDto>('/readyz', o),
};

export type Api = typeof api;

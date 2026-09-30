// Query-key factory. Keys are hierarchical so live events can invalidate whole families
// (`qk.nodes.all()`) or single entities (`qk.nodes.detail(id)`).

import type { BlocksParams, CursorParams, MetricsParams, NodesParams, RangeParams } from './endpoints';

const root = ['atlas'] as const;

export const qk = {
  all: () => root,
  bootstrap: () => [...root, 'bootstrap'] as const,
  health: () => [...root, 'health'] as const,

  nodes: {
    all: () => [...root, 'nodes'] as const,
    list: (p: NodesParams = {}) => [...root, 'nodes', 'list', p] as const,
    detail: (key: string | number) => [...root, 'nodes', 'detail', String(key)] as const,
    history: (key: string | number, p: RangeParams = {}) =>
      [...root, 'nodes', 'history', String(key), p] as const,
    payments: (key: string | number, p: Omit<CursorParams, 'cursor'> = {}) =>
      [...root, 'nodes', 'payments', String(key), p] as const,
    peers: (key: string | number) => [...root, 'nodes', 'peers', String(key)] as const,
  },
  operator: (address: string) => [...root, 'operator', address] as const,

  apps: {
    all: () => [...root, 'apps'] as const,
    index: () => [...root, 'apps', 'index'] as const,
    detail: (name: string) => [...root, 'apps', 'detail', name.toLowerCase()] as const,
    history: (name: string) => [...root, 'apps', 'history', name.toLowerCase()] as const,
  },

  network: {
    all: () => [...root, 'network'] as const,
    summary: () => [...root, 'network', 'summary'] as const,
    geo: () => [...root, 'network', 'geo'] as const,
    providers: () => [...root, 'network', 'providers'] as const,
    versions: () => [...root, 'network', 'versions'] as const,
    capacity: () => [...root, 'network', 'capacity'] as const,
    decentralization: () => [...root, 'network', 'decentralization'] as const,
  },
  metrics: (p: MetricsParams) => [...root, 'metrics', { ...p, series: [...p.series].sort() }] as const,

  blocks: {
    all: () => [...root, 'blocks'] as const,
    list: (p: Omit<BlocksParams, 'before'> = {}) => [...root, 'blocks', 'list', p] as const,
    detail: (id: string | number) => [...root, 'blocks', 'detail', String(id)] as const,
  },
  tx: (txid: string) => [...root, 'tx', txid.toLowerCase()] as const,
  address: {
    all: (addr: string) => [...root, 'address', addr] as const,
    detail: (addr: string) => [...root, 'address', addr, 'detail'] as const,
    txs: (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
      [...root, 'address', addr, 'txs', p] as const,
    utxos: (addr: string, p: Omit<CursorParams, 'cursor'> = {}) =>
      [...root, 'address', addr, 'utxos', p] as const,
    nodes: (addr: string) => [...root, 'address', addr, 'nodes'] as const,
  },
  mempool: () => [...root, 'mempool'] as const,
  supply: () => [...root, 'supply'] as const,
  richList: () => [...root, 'richlist'] as const,
  search: (q: string) => [...root, 'search', q.trim()] as const,

  timeline: {
    index: () => [...root, 'timeline', 'index'] as const,
    state: (t: number) => [...root, 'timeline', 'state', t] as const,
  },
} as const;

// Hosts: every node that shares an IP (UPnP multi-node hosts run up to eight nodes on ports 16127 to
// 16197). Built from the live table and cached per store and node-slice version.

import { useNetwork } from '../../../app/context';
import { parseEndpoint } from '../../../lib/format';
import type { NetworkStore } from '../../../store/network';
import { shallowEqual } from '../../../store/react';
import { type NodeLive, readNodeLive } from './live';

/** The UPnP port ladder: eight ports, ten apart. */
export const LADDER_PORTS = [16127, 16137, 16147, 16157, 16167, 16177, 16187, 16197] as const;

interface Entry {
  key: number;
  byIp: Map<string, number[]>;
}

const cache = new WeakMap<NetworkStore, Entry>();

/** IP to node ids (each list ordered by port). Rebuilt when the node slice changes. */
export function hostIndexFor(store: NetworkStore): Map<string, number[]> {
  const key = store.versions.Nodes;
  const hit = cache.get(store);
  if (hit && hit.key === key) return hit.byIp;
  const t = store.nodes;
  const byIp = new Map<string, { id: number; port: number }[]>();
  for (let i = 0; i < t.count; i++) {
    const ep = parseEndpoint(t.endpoint(i));
    if (!ep) continue;
    const list = byIp.get(ep.host);
    const item = { id: t.ids[i]!, port: ep.port ?? 0 };
    if (list) list.push(item);
    else byIp.set(ep.host, [item]);
  }
  const out = new Map<string, number[]>();
  for (const [ip, list] of byIp)
    out.set(
      ip,
      list.sort((a, b) => a.port - b.port || a.id - b.id).map((x) => x.id),
    );
  cache.set(store, { key, byIp: out });
  return out;
}

const NONE: number[] = [];

/** The ids of every node on `ip`, ordered by port. */
export function useHostNodes(ip: string | null): number[] {
  return useNetwork((s) => (ip ? (hostIndexFor(s).get(ip) ?? NONE) : NONE), shallowEqual);
}

/** The host part of an endpoint (`1.2.3.4:16127` gives `1.2.3.4`), or null. */
export function ipOfEndpoint(endpoint: string | null | undefined): string | null {
  return parseEndpoint(endpoint)?.host ?? null;
}

// ---- live rows of one host ----------------------------------------------------------------------------

export interface HostLive {
  /** Every node on the host, ordered by port. */
  live: NodeLive[];
  /** The nodes on the eight ladder ports. */
  byPort: Map<number, NodeLive>;
  /** Nodes on any other port. */
  other: NodeLive[];
}

const EMPTY_HOST: HostLive = { live: [], byPort: new Map(), other: [] };
const liveCache = new WeakMap<NetworkStore, { key: number; byIp: Map<string, HostLive> }>();

/** The live facts of every node on `ip`, cached per node-slice version so the reference is stable. */
export function hostLiveFor(store: NetworkStore, ip: string): HostLive {
  const key = store.versions.Nodes;
  let entry = liveCache.get(store);
  if (!entry || entry.key !== key) {
    entry = { key, byIp: new Map() };
    liveCache.set(store, entry);
  }
  const hit = entry.byIp.get(ip);
  if (hit) return hit;
  const ids = hostIndexFor(store).get(ip) ?? [];
  const live = ids.map((i) => readNodeLive(store, i)).filter((n): n is NodeLive => n !== null);
  const byPort = new Map<number, NodeLive>();
  const other: NodeLive[] = [];
  for (const n of live) {
    const port = parseEndpoint(n.endpoint)?.port ?? 0;
    if ((LADDER_PORTS as readonly number[]).includes(port) && !byPort.has(port)) byPort.set(port, n);
    else other.push(n);
  }
  const value = { live, byPort, other };
  entry.byIp.set(ip, value);
  return value;
}

export const useHostLive = (ip: string | null): HostLive =>
  useNetwork((s) => (ip ? hostLiveFor(s, ip) : EMPTY_HOST));

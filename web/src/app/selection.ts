// Resolves node keys from the URL (`/node/:key`, `?sel=`) to node ids, so selected nodes get
// priority effects and WatchProbe enrollment. Keys are a node id, `ip:port`, or a collateral
// outpoint (resolved by the server, not here: nodes.bin carries no outpoints).

import type { NetworkStore } from '../store/network';

export function resolveNodeKey(store: NetworkStore, key: string): number | null {
  const k = key.trim();
  if (/^\d+$/.test(k)) {
    const id = Number(k);
    return store.nodes.has(id) ? id : null;
  }
  const t = store.nodes;
  for (let i = 0; i < t.count; i++) if (t.endpoint(i) === k) return t.ids[i] ?? null;
  return null;
}

export function resolveSelection(store: NetworkStore, keys: readonly string[]): number[] {
  const out: number[] = [];
  for (const k of keys.slice(0, 50)) {
    const id = resolveNodeKey(store, k);
    if (id !== null) out.push(id);
  }
  return out;
}

// Stable node keys (ARCHITECTURE 3.3 and 8.1). A node id is local to one origin: the two instances
// behind the domain number nodes in their own order of first sight, so anything stored or shared
// (URLs, `?sel=`, the watchlist, window layouts, palette recents) names a node by its collateral
// outpoint `txid:vout`. Ids are only resolved from keys against the snapshot loaded right now.
//
// Keys accepted from old links and storage: a numeric id (legacy, resolved against whatever
// instance answered, the best a pre-B9 link can do) and `ip:port`.

import type { NodeTable } from './nodeTable';

const OUTPOINT_RE = /^[0-9a-f]{64}:\d{1,10}$/i;
const ID_RE = /^\d+$/;

/** True for a collateral outpoint `txid:vout` (64 hex digits, a colon, the output index). */
export function isOutpoint(key: string): boolean {
  return OUTPOINT_RE.test(key);
}

/** True for a legacy numeric node id key. */
export function isLegacyId(key: string): boolean {
  return ID_RE.test(key);
}

/** The node id `key` names in `table` (outpoint, legacy id or `ip:port`), or null. */
export function resolveNodeKey(table: NodeTable, key: string): number | null {
  const k = key.trim();
  if (!k) return null;
  if (isOutpoint(k)) {
    const id = table.idOfOutpoint(k);
    return id < 0 ? null : id;
  }
  if (isLegacyId(k)) {
    const id = Number(k);
    return table.has(id) ? id : null;
  }
  for (let i = 0; i < table.count; i++) if (table.endpoint(i) === k) return table.ids[i] ?? null;
  return null;
}

/**
 * The id in `table` of a node a server record names. The record's own id is the answering
 * instance's, which can be the other one behind the domain, so its outpoint decides whenever the
 * table has outpoints; only a table without them (an older server) falls back to the id.
 */
export function localNodeId(table: NodeTable, ref: { id: number; outpoint?: string | null }): number | null {
  if (ref.outpoint && table.hasOutpoints) {
    const id = table.idOfOutpoint(ref.outpoint);
    return id < 0 ? null : id;
  }
  return table.has(ref.id) ? ref.id : null;
}

/** The outpoint of node `id` in `table`, or null when the node or its outpoint is unknown. */
export function outpointOfId(table: NodeTable, id: number): string | null {
  return table.outpointOf(id) || null;
}

/**
 * The key to put in a link or in storage for `key`: the node's outpoint when the table resolves it,
 * the key itself (lowercased when it already is an outpoint) otherwise.
 */
export function stableNodeKey(table: NodeTable, key: string): string {
  const k = key.trim();
  if (isOutpoint(k)) return k.toLowerCase();
  const id = resolveNodeKey(table, k);
  return (id !== null && outpointOfId(table, id)) || k;
}

// -------------------------------------------------------------------------------------------------
// The session's table, for link builders that have no store at hand (route helpers, EntityLink).
// The runtime registers its store; without one (tests, early boot) keys pass through unchanged.
// -------------------------------------------------------------------------------------------------

let source: (() => NodeTable | null) | null = null;

/** Registers where link builders resolve node keys (the runtime's store). */
export function setNodeKeySource(fn: (() => NodeTable | null) | null): void {
  source = fn;
}

/** The session's loaded node table, or null before the first snapshot (or without a runtime). */
export function currentNodeTable(): NodeTable | null {
  return source?.() ?? null;
}

/** The canonical link key for a node: its outpoint when the loaded snapshot knows the node. */
export function canonicalNodeKey(key: string | number): string {
  const k = String(key);
  const table = source?.() ?? null;
  if (!table) return isOutpoint(k) ? k.toLowerCase() : k;
  return stableNodeKey(table, k);
}

/** The node id a key names in the loaded snapshot, or null (no snapshot, unknown key). */
export function currentNodeId(key: string): number | null {
  const table = source?.() ?? null;
  return table ? resolveNodeKey(table, key) : null;
}

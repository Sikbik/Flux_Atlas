// Node keys in the URL (`/node/:key`, `?sel=`, `?w=node:...`). Links name nodes by collateral
// outpoint (ARCHITECTURE 8.1); the selection is fed to the runtime as keys and resolved to ids of
// the loaded snapshot there. Older links (a numeric id, `ip:port`) are resolved once against the
// snapshot and the URL is replaced with the outpoint form (`canonicalNodeLocation`).

import { decodeSegment, parseExtraWindows, serializeExtraWindows } from '../shell/wm/route';
import { isOutpoint, resolveNodeKey, stableNodeKey } from '../store/nodeKeys';
import type { NodeTable } from '../store/nodeTable';

const NODE_PATH = /^\/node\/([^/]+)\/?$/;

/** The decoded key of a `/node/:key` path, or null for other paths. A malformed escape stays as is. */
export function nodeKeyFromPath(pathname: string): string | null {
  const m = NODE_PATH.exec(pathname);
  return m?.[1] ? decodeSegment(m[1]) : null;
}

/** Node keys a location selects: the `/node/:key` window and `?sel=` (comma separated). */
export function selectionKeys(pathname: string, sel: unknown): string[] {
  const keys: string[] = [];
  const k = nodeKeyFromPath(pathname);
  if (k) keys.push(k);
  if (typeof sel === 'string' && sel) keys.push(...sel.split(',').filter(Boolean));
  else if (typeof sel === 'number') keys.push(String(sel));
  return keys;
}

/** Ids the keys name in `table` (unknown keys are skipped). */
export function resolveSelection(table: NodeTable, keys: readonly string[]): number[] {
  const out: number[] = [];
  for (const k of keys.slice(0, 50)) {
    const id = resolveNodeKey(table, k);
    if (id !== null) out.push(id);
  }
  return out;
}

/** True when a `/node/:key` path names a node in a form the snapshot cannot place (not found). */
export function isUnresolvableLegacyKey(table: NodeTable, key: string): boolean {
  return !isOutpoint(key) && resolveNodeKey(table, key) === null;
}

/**
 * The outpoint form of a location whose node keys are older forms (id, `ip:port`), or null when it
 * is already canonical or nothing resolves. Unresolvable keys are left as they are.
 */
export function canonicalNodeLocation(
  table: NodeTable,
  pathname: string,
  search: Record<string, unknown>,
): { pathname: string; search: Record<string, unknown> } | null {
  let changed = false;
  let path = pathname;
  const key = nodeKeyFromPath(pathname);
  if (key !== null) {
    const stable = stableNodeKey(table, key);
    if (stable !== key) {
      path = `/node/${encodeURIComponent(stable)}`;
      changed = true;
    }
  }
  const next: Record<string, unknown> = { ...search };
  const sel = search.sel;
  if ((typeof sel === 'string' && sel) || typeof sel === 'number') {
    const keys = String(sel).split(',').filter(Boolean);
    const stable = keys.map((k) => stableNodeKey(table, k));
    if (stable.some((k, i) => k !== keys[i])) {
      next.sel = stable.join(',');
      changed = true;
    }
  }
  if (typeof search.w === 'string' && search.w) {
    const extras = parseExtraWindows(search.w);
    let moved = false;
    const stable = extras.map((r) => {
      if (r.type !== 'node' || r.key === null) return r;
      const k = stableNodeKey(table, r.key);
      if (k !== r.key) moved = true;
      return { ...r, key: k };
    });
    if (moved) {
      next.w = serializeExtraWindows(stable);
      changed = true;
    }
  }
  return changed ? { pathname: path, search: next } : null;
}

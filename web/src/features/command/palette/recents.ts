// "Recent": the last things opened from the palette, kept in this browser. Only what the user ran is
// remembered, never what they typed; the list is short and every read is guarded (private windows,
// blocked storage and corrupt values all fall back to an empty list).

import { isLegacyId, isOutpoint, stableNodeKey } from '../../../store/nodeKeys';
import type { NodeTable } from '../../../store/nodeTable';
import type { PaletteRow, RecentEntry, RowAction } from './types';

const KEY = 'atlas.recents.v1';
const MAX = 12;

const ICONS = new Set([
  'node',
  'host',
  'provider',
  'app',
  'block',
  'tx',
  'address',
  'wallet',
  'operator',
  'country',
  'city',
  'version',
  'place',
  'globe',
  'queue',
  'analytics',
  'explorer',
  'time',
  'weather',
  'terminal',
  'settings',
  'award',
  'moon',
  'ambient',
  'mesh',
  'filter',
  'art',
  'perf',
  'motion',
  'sound',
  'link',
  'info',
  'egg',
  'search',
  'watch',
]);

const KINDS = new Set([
  'node',
  'host',
  'provider',
  'app',
  'block',
  'tx',
  'address',
  'wallet',
  'operator',
  'country',
  'city',
  'version',
  'place',
  'action',
  'shielded',
  'payee',
  'egg',
]);

function validAction(a: unknown): a is RowAction {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  if (o.type === 'go') {
    const t = o.target as Record<string, unknown> | undefined;
    return !!t && typeof t.to === 'string';
  }
  if (o.type === 'run') return typeof o.id === 'string';
  return false;
}

function validEntry(v: unknown): v is RecentEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.chip === 'string' &&
    typeof o.ts === 'number' &&
    typeof o.kind === 'string' &&
    KINDS.has(o.kind) &&
    typeof o.icon === 'string' &&
    ICONS.has(o.icon) &&
    validAction(o.action)
  );
}

/** Newest first. */
export function loadRecents(): RecentEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(validEntry).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function store(list: readonly RecentEntry[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: recents last for the session only.
  }
}

/** The entry that remembers `row`, or null when the row is not the kind that is kept. */
export function entryFromRow(row: PaletteRow, ts: number): RecentEntry | null {
  if (!row.remember) return null;
  if (row.action.type !== 'go' && row.action.type !== 'run') return null;
  return {
    id: row.id,
    kind: row.kind,
    icon: row.icon,
    title: row.title,
    ...(row.mono ? { mono: true } : {}),
    ...(row.sub ? { sub: row.sub } : {}),
    ...(row.subMono ? { subMono: true } : {}),
    chip: row.chip,
    ...(row.tier ? { tier: row.tier } : {}),
    action: row.action,
    ...(row.fly ? { fly: row.fly } : {}),
    ...(row.alsoFly ? { alsoFly: true } : {}),
    ...(row.alongside ? { alongside: true } : {}),
    ts,
  };
}

/** Puts `row` at the head of the list (once), and returns the list. */
export function rememberRow(row: PaletteRow, now = Date.now()): RecentEntry[] {
  const entry = entryFromRow(row, now);
  const cur = loadRecents();
  if (!entry) return cur;
  const next = [entry, ...cur.filter((e) => e.id !== entry.id)].slice(0, MAX);
  store(next);
  return next;
}

export function clearRecents(): void {
  store([]);
}

/**
 * Node entries name their node by outpoint (ARCHITECTURE 8.1). Entries from older clients carry a
 * numeric node id or an `ip:port`: they are resolved once against the first snapshot that has
 * outpoints and rewritten; an id that resolves to nothing is dropped (it may mean another node on
 * the other instance). Returns the rewritten list, or null when nothing had to change.
 */
export function migrateRecentEntries(list: readonly RecentEntry[], table: NodeTable): RecentEntry[] | null {
  let changed = false;
  const out: RecentEntry[] = [];
  for (const e of list) {
    const target = e.action.type === 'go' ? e.action.target : null;
    const key = target?.to === '/node/$key' ? target.params?.key : undefined;
    if (!target || key === undefined || isOutpoint(key)) {
      out.push(e);
      continue;
    }
    const stable = stableNodeKey(table, key);
    if (!isOutpoint(stable)) {
      changed ||= isLegacyId(key);
      if (!isLegacyId(key)) out.push(e);
      continue;
    }
    changed = true;
    const id = isLegacyId(e.id.replace(/^node:/, '')) ? `node:${stable}` : e.id;
    out.push({
      ...e,
      id,
      action: { type: 'go', target: { ...target, params: { ...target.params, key: stable } } },
    });
  }
  return changed ? out : null;
}

let migrated = false;

/** Runs the recents migration once per session, at the first snapshot that carries outpoints. */
export function migrateRecents(table: NodeTable): void {
  if (migrated || table.count === 0 || !table.outpoint(0)) return;
  migrated = true;
  const next = migrateRecentEntries(loadRecents(), table);
  if (next) store(next);
}

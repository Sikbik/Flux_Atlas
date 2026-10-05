// UI preferences (zustand). Network data lives in the NetworkStore; URL state (selection, filters,
// camera, windows) lives in the router. This holds only local preferences: motion, performance
// tier, the globe's art style and its borders, whether earnings count parallel assets, the
// watchlist. Persisted per browser; every storage access is guarded.
//
// Whether earnings count parallel assets was the wallet's own preference (`includePa` in
// `atlas.wallet.v1`) before every earnings figure in Atlas followed it. A browser that stored it
// there and not here takes it over once (`migrateIncludePa`), and it is written here at once so
// the wallet's store can forget it.
//
// The watchlist is kept by collateral outpoint (ARCHITECTURE 8.1): node ids are local to the
// instance that served the snapshot, so `watched` (ids) is derived from `watchedKeys` after every
// snapshot load (`resolveWatched`). Stored numeric ids from older clients are resolved once against
// the first snapshot that carries outpoints and rewritten as outpoints; unresolvable ones are dropped.

import { create } from 'zustand';
import { currentNodeTable, isOutpoint, outpointOfId } from './nodeKeys';
import type { NodeTable } from './nodeTable';

export type MotionPref = 'system' | 'full' | 'reduced' | 'off';
export type PerfPref = 'auto' | 'high' | 'balanced' | 'lite';
/**
 * The globe's art style: `marble` (NASA imagery through a slate grade, the default), `holo` (the
 * dot-matrix planet, also the look of the lite tier) or `neon` (glowing coastlines).
 */
export type GlobeArtPref = 'marble' | 'holo' | 'neon';

export const GLOBE_ARTS: readonly GlobeArtPref[] = ['marble', 'holo', 'neon'];

/**
 * The political lines on the globe: none, the country borders, or the country borders with state and
 * province lines (the default). State lines come in as the camera comes down, and are not drawn on the
 * Lite level.
 */
export type GlobeBordersPref = 'off' | 'countries' | 'states';

export const GLOBE_BORDERS: readonly GlobeBordersPref[] = ['off', 'countries', 'states'];

const MAX_WATCHED = 500;

interface Persisted {
  motion: MotionPref;
  perf: PerfPref;
  globeArt: GlobeArtPref;
  globeBorders: GlobeBordersPref;
  includePa: boolean;
  watchedKeys: string[];
  legacyWatched: number[];
}

export interface UiState {
  motion: MotionPref;
  perf: PerfPref;
  globeArt: GlobeArtPref;
  globeBorders: GlobeBordersPref;
  /**
   * Earnings count the parallel assets beside the main chain (the default): every figure of what a node or
   * an operator earns, run rate, realized, projected or in money, is main chain plus parallel assets, or
   * main chain only when this is off.
   */
  includePa: boolean;
  /** Watched node ids in the loaded snapshot (WatchProbe enrollment; P1 effects). Derived. */
  watched: number[];
  /** Watched nodes by outpoint `txid:vout`: what is stored. */
  watchedKeys: string[];
  /**
   * Numeric ids stored by an older client, or watched while the server sends no outpoints. They
   * become outpoints at the first snapshot that has them.
   */
  legacyWatched: number[];
  setMotion(m: MotionPref): void;
  setPerf(p: PerfPref): void;
  setGlobeArt(a: GlobeArtPref): void;
  setGlobeBorders(b: GlobeBordersPref): void;
  setIncludePa(on: boolean): void;
  watch(id: number): void;
  unwatch(id: number): void;
  /** Maps the watchlist onto a freshly loaded table (and migrates legacy ids). */
  resolveWatched(table: NodeTable): void;
}

const KEY = 'atlas.ui.v1';
/** The wallet's preferences, where `includePa` lived before it moved here. */
export const WALLET_KEY = 'atlas.wallet.v1';

/** Reads the stored preferences. `watched` holds outpoints, and numeric ids from older clients. */
export function parseUi(raw: string | null | undefined): Partial<Persisted> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Persisted> = {};
    if (v.motion === 'system' || v.motion === 'full' || v.motion === 'reduced' || v.motion === 'off')
      out.motion = v.motion;
    if (v.perf === 'auto' || v.perf === 'high' || v.perf === 'balanced' || v.perf === 'lite')
      out.perf = v.perf;
    if (v.globeArt === 'marble' || v.globeArt === 'holo' || v.globeArt === 'neon') out.globeArt = v.globeArt;
    // Absent in what an older client stored (the default applies); anything else is dropped.
    if (v.globeBorders === 'off' || v.globeBorders === 'countries' || v.globeBorders === 'states')
      out.globeBorders = v.globeBorders;
    if (typeof v.includePa === 'boolean') out.includePa = v.includePa;
    if (Array.isArray(v.watched)) {
      const list = v.watched.slice(0, MAX_WATCHED);
      out.watchedKeys = [
        ...new Set(list.filter((x): x is string => typeof x === 'string' && isOutpoint(x)).map(lower)),
      ];
      out.legacyWatched = [...new Set(list.filter((x): x is number => Number.isInteger(x) && x >= 0))];
    }
    return out;
  } catch {
    return {};
  }
}

const lower = (s: string) => s.toLowerCase();

/**
 * Takes over the wallet's `includePa` when these preferences have none of their own (stored before the
 * setting moved here). Null when there is nothing to take over: the setting is here already, or the wallet
 * never stored one (the default applies).
 */
export function migrateIncludePa(
  ui: Partial<Persisted>,
  walletRaw: string | null | undefined,
): boolean | null {
  if (ui.includePa !== undefined || !walletRaw) return null;
  try {
    const v = JSON.parse(walletRaw) as Record<string, unknown> | null;
    return v && typeof v === 'object' && typeof v.includePa === 'boolean' ? v.includePa : null;
  } catch {
    return null;
  }
}

function load(): Partial<Persisted> {
  try {
    const storage = globalThis.localStorage;
    const raw = storage?.getItem(KEY);
    const out = parseUi(raw);
    const moved = migrateIncludePa(out, storage?.getItem(WALLET_KEY));
    if (moved !== null) {
      out.includePa = moved;
      // Written here at once, beside whatever else is stored, so it no longer depends on the wallet's copy.
      let rest: Record<string, unknown> = {};
      try {
        const v = raw ? (JSON.parse(raw) as unknown) : null;
        if (v && typeof v === 'object' && !Array.isArray(v)) rest = v as Record<string, unknown>;
      } catch {
        // A damaged record is replaced by the setting alone; parseUi already gave up on it.
      }
      try {
        storage?.setItem(KEY, JSON.stringify({ ...rest, includePa: moved }));
      } catch {
        // Storage unavailable: the setting still applies for the session.
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(s: Persisted): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({
        motion: s.motion,
        perf: s.perf,
        globeArt: s.globeArt,
        globeBorders: s.globeBorders,
        includePa: s.includePa,
        watched: [...s.watchedKeys, ...s.legacyWatched],
      }),
    );
  } catch {
    // Storage unavailable (private mode, quota): preferences last for the session only.
  }
}

/** True when the table carries outpoints (a server from B9 on). */
function hasOutpoints(table: NodeTable): boolean {
  for (let i = 0; i < table.count; i++) if (table.outpoint(i)) return true;
  return false;
}

/** The watchlist resolved against `table`: legacy ids migrated, ids of the watched outpoints. */
export function resolveWatchlist(
  table: NodeTable,
  keys: readonly string[],
  legacy: readonly number[],
): { watchedKeys: string[]; legacyWatched: number[]; watched: number[] } {
  let watchedKeys = [...keys];
  let legacyWatched = [...legacy];
  if (legacyWatched.length > 0 && hasOutpoints(table)) {
    // Resolved once, against whatever instance answered: the best an id from an older client can do.
    for (const id of legacyWatched) {
      const op = outpointOfId(table, id);
      if (op && !watchedKeys.includes(op)) watchedKeys.push(op);
    }
    legacyWatched = [];
    watchedKeys = watchedKeys.slice(0, MAX_WATCHED);
  }
  const watched: number[] = [];
  for (const k of watchedKeys) {
    const id = table.idOfOutpoint(k);
    if (id >= 0) watched.push(id);
  }
  for (const id of legacyWatched) if (table.has(id) && !watched.includes(id)) watched.push(id);
  return { watchedKeys, legacyWatched, watched };
}

const stored = load();

export const useUi = create<UiState>()((set, get) => ({
  motion: 'system',
  perf: 'auto',
  globeArt: 'marble',
  globeBorders: 'states',
  includePa: true,
  watchedKeys: [],
  legacyWatched: [],
  ...stored,
  // Ids are known once a snapshot loads (`resolveWatched`).
  watched: [],
  setMotion: (motion) => {
    set({ motion });
    save(get());
  },
  setPerf: (perf) => {
    set({ perf });
    save(get());
  },
  setGlobeArt: (globeArt) => {
    set({ globeArt });
    save(get());
  },
  setGlobeBorders: (globeBorders) => {
    set({ globeBorders });
    save(get());
  },
  setIncludePa: (includePa) => {
    set({ includePa });
    save(get());
  },
  watch: (id) => {
    const s = get();
    if (s.watched.includes(id)) return;
    const table = currentNodeTable();
    const op = table ? outpointOfId(table, id) : null;
    if (op) {
      if (s.watchedKeys.includes(op)) return;
      set({ watchedKeys: [...s.watchedKeys, op], watched: [...s.watched, id] });
    } else {
      // No outpoint known (an older server): keep the id until a snapshot has outpoints.
      set({ legacyWatched: [...s.legacyWatched, id], watched: [...s.watched, id] });
    }
    save(get());
  },
  unwatch: (id) => {
    const s = get();
    const table = currentNodeTable();
    const op = table ? outpointOfId(table, id) : null;
    set({
      watched: s.watched.filter((x) => x !== id),
      watchedKeys: op ? s.watchedKeys.filter((k) => k !== op) : s.watchedKeys,
      legacyWatched: s.legacyWatched.filter((x) => x !== id),
    });
    save(get());
  },
  resolveWatched: (table) => {
    const s = get();
    const next = resolveWatchlist(table, s.watchedKeys, s.legacyWatched);
    const migrated =
      next.legacyWatched.length !== s.legacyWatched.length ||
      next.watchedKeys.length !== s.watchedKeys.length;
    const same = next.watched.length === s.watched.length && next.watched.every((x, i) => x === s.watched[i]);
    if (!migrated && same) return;
    set(next);
    if (migrated) save(get());
  },
}));

/** Effective motion: the OS preference applies unless the user chose explicitly. */
export function effectiveMotion(pref: MotionPref): 'full' | 'reduced' | 'off' {
  if (pref !== 'system') return pref;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return mq?.matches ? 'reduced' : 'full';
}

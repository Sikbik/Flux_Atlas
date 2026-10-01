// UI preferences (zustand). Network data lives in the NetworkStore; URL state (selection, filters,
// camera, windows) lives in the router. This holds only local preferences: motion, performance
// tier, the globe's art style, the watchlist. Persisted per browser; every storage access is guarded.

import { create } from 'zustand';

export type MotionPref = 'system' | 'full' | 'reduced' | 'off';
export type PerfPref = 'auto' | 'high' | 'balanced' | 'lite';
/**
 * The globe's art style: `marble` (NASA imagery through a slate grade, the default), `holo` (the
 * dot-matrix planet, also the look of the lite tier) or `neon` (glowing coastlines).
 */
export type GlobeArtPref = 'marble' | 'holo' | 'neon';

export const GLOBE_ARTS: readonly GlobeArtPref[] = ['marble', 'holo', 'neon'];

type Persisted = Pick<UiState, 'motion' | 'perf' | 'globeArt' | 'watched'>;

export interface UiState {
  motion: MotionPref;
  perf: PerfPref;
  globeArt: GlobeArtPref;
  /** Watched node ids (WatchProbe enrollment; P1 effects). */
  watched: number[];
  setMotion(m: MotionPref): void;
  setPerf(p: PerfPref): void;
  setGlobeArt(a: GlobeArtPref): void;
  watch(id: number): void;
  unwatch(id: number): void;
}

const KEY = 'atlas.ui.v1';

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Persisted> = {};
    if (v.motion === 'system' || v.motion === 'full' || v.motion === 'reduced' || v.motion === 'off')
      out.motion = v.motion;
    if (v.perf === 'auto' || v.perf === 'high' || v.perf === 'balanced' || v.perf === 'lite')
      out.perf = v.perf;
    if (v.globeArt === 'marble' || v.globeArt === 'holo' || v.globeArt === 'neon') out.globeArt = v.globeArt;
    if (Array.isArray(v.watched))
      out.watched = v.watched.filter((x): x is number => Number.isInteger(x)).slice(0, 500);
    return out;
  } catch {
    return {};
  }
}

function save(s: Persisted): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({ motion: s.motion, perf: s.perf, globeArt: s.globeArt, watched: s.watched }),
    );
  } catch {
    // Storage unavailable (private mode, quota): preferences last for the session only.
  }
}

export const useUi = create<UiState>()((set, get) => ({
  motion: 'system',
  perf: 'auto',
  globeArt: 'marble',
  watched: [],
  ...load(),
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
  watch: (id) => {
    if (get().watched.includes(id)) return;
    set({ watched: [...get().watched, id] });
    save(get());
  },
  unwatch: (id) => {
    set({ watched: get().watched.filter((x) => x !== id) });
    save(get());
  },
}));

/** Effective motion: the OS preference applies unless the user chose explicitly. */
export function effectiveMotion(pref: MotionPref): 'full' | 'reduced' | 'off' {
  if (pref !== 'system') return pref;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return mq?.matches ? 'reduced' : 'full';
}

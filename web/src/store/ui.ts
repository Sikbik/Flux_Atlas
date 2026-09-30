// UI preferences (zustand). Network data lives in the NetworkStore; URL state (selection, filters,
// camera, windows) lives in the router. This holds only local preferences: motion, performance
// tier, the watchlist. Persisted per browser; every storage access is guarded.

import { create } from 'zustand';

export type MotionPref = 'system' | 'full' | 'reduced' | 'off';
export type PerfPref = 'auto' | 'high' | 'balanced' | 'lite';

export interface UiState {
  motion: MotionPref;
  perf: PerfPref;
  /** Watched node ids (WatchProbe enrollment; P1 effects). */
  watched: number[];
  setMotion(m: MotionPref): void;
  setPerf(p: PerfPref): void;
  watch(id: number): void;
  unwatch(id: number): void;
}

const KEY = 'atlas.ui.v1';

function load(): Partial<Pick<UiState, 'motion' | 'perf' | 'watched'>> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Pick<UiState, 'motion' | 'perf' | 'watched'>> = {};
    if (v.motion === 'system' || v.motion === 'full' || v.motion === 'reduced' || v.motion === 'off')
      out.motion = v.motion;
    if (v.perf === 'auto' || v.perf === 'high' || v.perf === 'balanced' || v.perf === 'lite')
      out.perf = v.perf;
    if (Array.isArray(v.watched))
      out.watched = v.watched.filter((x): x is number => Number.isInteger(x)).slice(0, 500);
    return out;
  } catch {
    return {};
  }
}

function save(s: Pick<UiState, 'motion' | 'perf' | 'watched'>): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({ motion: s.motion, perf: s.perf, watched: s.watched }),
    );
  } catch {
    // Storage unavailable (private mode, quota): preferences last for the session only.
  }
}

export const useUi = create<UiState>()((set, get) => ({
  motion: 'system',
  perf: 'auto',
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

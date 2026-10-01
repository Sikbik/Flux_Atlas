// What this browser has unlocked and how far the counted ones have got. Persisted locally and nowhere
// else: reading and writing are guarded, so private windows and blocked storage just forget on reload.
// A zustand store so the Settings list and the terminal read the same truth the tracker writes.

import { create } from 'zustand';
import { ACHIEVEMENT_COUNT, achievementById } from './catalog';

const KEY = 'atlas.achievements.v1';

export interface Progress {
  /** Continents whose nodes were opened. */
  continents: string[];
  /** Times the palette was opened with the keyboard. */
  paletteKeys: number;
  /** Terminal commands run. */
  commands: number;
  /** Live blocks watched in this visit (not persisted: "in one visit"). */
  blocks: number;
}

export interface AchievementData {
  /** Achievement id to the unix ms it unlocked. */
  unlocked: Record<string, number>;
  progress: Progress;
}

export interface AchievementsState extends AchievementData {
  /** Unlocks `id`; false when it already was. */
  unlock(id: string, atMs: number): boolean;
  setProgress(patch: Partial<Progress>): void;
  reset(): void;
}

export const EMPTY: AchievementData = {
  unlocked: {},
  progress: { continents: [], paletteKeys: 0, commands: 0, blocks: 0 },
};

const int = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** Reads stored data; unknown ids and malformed fields are dropped. */
export function parseAchievements(raw: string | null | undefined): AchievementData {
  const out: AchievementData = { unlocked: {}, progress: { ...EMPTY.progress, continents: [] } };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const un = v.unlocked;
    if (un && typeof un === 'object') {
      for (const [id, at] of Object.entries(un as Record<string, unknown>)) {
        if (achievementById(id) && typeof at === 'number' && Number.isFinite(at)) out.unlocked[id] = at;
      }
    }
    const p = v.progress as Record<string, unknown> | undefined;
    if (p && typeof p === 'object') {
      if (Array.isArray(p.continents))
        out.progress.continents = p.continents.filter((c): c is string => typeof c === 'string').slice(0, 8);
      out.progress.paletteKeys = int(p.paletteKeys);
      out.progress.commands = int(p.commands);
    }
  } catch {
    // Corrupt storage: start over.
  }
  return out;
}

function load(): AchievementData {
  try {
    return parseAchievements(globalThis.localStorage?.getItem(KEY));
  } catch {
    return parseAchievements(null);
  }
}

function save(s: AchievementData): void {
  try {
    const { continents, paletteKeys, commands } = s.progress;
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({ v: 1, unlocked: s.unlocked, progress: { continents, paletteKeys, commands } }),
    );
  } catch {
    // Storage unavailable: achievements last for the session only.
  }
}

export const useAchievements = create<AchievementsState>()((set, get) => ({
  ...load(),
  unlock: (id, atMs) => {
    if (!achievementById(id) || get().unlocked[id] !== undefined) return false;
    set({ unlocked: { ...get().unlocked, [id]: atMs } });
    save(get());
    return true;
  },
  setProgress: (patch) => {
    set({ progress: { ...get().progress, ...patch } });
    save(get());
  },
  reset: () => {
    set({ ...EMPTY, unlocked: {}, progress: { ...EMPTY.progress, continents: [] } });
    save(get());
  },
}));

export const unlockedCount = (s: Pick<AchievementData, 'unlocked'>): number => Object.keys(s.unlocked).length;

export { ACHIEVEMENT_COUNT };

// The home state over the globe (design 2.2, 10.3, 9.1), as pure logic: the sentence a screen reader gets
// for the canvas, and the rule for the one-time hint beside the moon.

import { formatHeight, formatInt } from '../../lib/format';

/** The globe is a picture of data; this is the same data as text (design 10.3), refreshed once a minute. */
export const GLOBE_DESCRIPTION_MS = 60_000;

export interface GlobeFacts {
  nodes: number | null;
  countries: number | null;
  tip: number | null;
}

/**
 * "Live globe of all Flux nodes: 6,727 nodes in 60 countries; chain tip 2,997,836. Drag to rotate, scroll to
 * zoom." A fact that is not known yet is left out of the sentence, never written as zero.
 */
export function describeGlobe(f: GlobeFacts): string {
  const parts: string[] = [];
  if (f.nodes !== null)
    parts.push(
      f.countries === null
        ? `${formatInt(f.nodes)} nodes`
        : `${formatInt(f.nodes)} nodes in ${formatInt(f.countries)} countries`,
    );
  if (f.tip !== null) parts.push(`chain tip ${formatHeight(f.tip)}`);
  const head =
    parts.length === 0 ? 'Live globe of all Flux nodes' : `Live globe of all Flux nodes: ${parts.join('; ')}`;
  return `${head}. Drag to rotate, scroll to zoom. Press Control K to search.`;
}

// ---- the moon hint -------------------------------------------------------------------------------

/** The local flag that says the hint has been shown (design 9.1 step 8): once, never again. */
export const MOON_HINT_FLAG = 'atlas.hint.moon';
/** After a block lands: the relay of beams plays out first. */
export const MOON_HINT_DELAY_MS = 3_500;
export const MOON_HINT_SHOW_MS = 6_000;
/** The fade out; the hint is gone after it. */
export const MOON_HINT_LEAVE_MS = 320;

export function moonHintSeen(storage: Pick<Storage, 'getItem'> | null | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(MOON_HINT_FLAG) === '1';
  } catch {
    return false;
  }
}

export function markMoonHintSeen(storage: Pick<Storage, 'setItem'> | null | undefined = safeStorage()): void {
  try {
    storage?.setItem(MOON_HINT_FLAG, '1');
  } catch {
    // Storage unavailable: the hint may show again next visit, which is harmless.
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface HintSignals {
  /** The flag says it was shown before. */
  seen: boolean;
  /** The boot has ended. */
  booted: boolean;
  /** The tip the boot ended on; null until then. */
  baseline: number | null;
  /** The tip now. */
  height: number | null;
  /** The bare globe is showing (no window over it, not ambient). */
  home: boolean;
}

/** Whether the block that just arrived is the first one after the boot, on the bare globe, for a first visit. */
export function startsMoonHint(s: HintSignals): boolean {
  if (s.seen || !s.booted || !s.home) return false;
  if (s.baseline === null || s.height === null) return false;
  return s.height > s.baseline;
}

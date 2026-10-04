// How steadily blocks arrive, read off the blocks the live store holds (the newest 100, about fifty minutes): the
// seconds between each pair of neighbours, their mean against the 30 second target, and the longest wait. Pure.

import { BLOCK_SECONDS } from '../../lib/emission';

export interface BlockPace {
  /** Seconds between each block and the one before it, oldest first. */
  gaps: number[];
  /** The mean gap, or null with fewer than two blocks. */
  avgS: number | null;
  longestS: number | null;
  /** Percent the mean is above (positive: slower) the target. */
  vsTarget: number | null;
}

/** A gap is only a gap between consecutive heights; a hole in the store's blocks is not one long block. */
export function blockPace(blocks: readonly { height: number; timeMs: number }[]): BlockPace {
  const sorted = [...blocks].sort((a, b) => a.height - b.height);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (!a || !b || b.height !== a.height + 1) continue;
    const s = (b.timeMs - a.timeMs) / 1000;
    if (Number.isFinite(s) && s >= 0) gaps.push(s);
  }
  if (gaps.length === 0) return { gaps, avgS: null, longestS: null, vsTarget: null };
  const avgS = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  return {
    gaps,
    avgS,
    longestS: Math.max(...gaps),
    vsTarget: (avgS / BLOCK_SECONDS - 1) * 100,
  };
}

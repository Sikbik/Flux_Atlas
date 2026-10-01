// The phone's bottom sheet, as pure arithmetic (design 3.6): how tall each of its four snaps is and which one a
// drag ends on. The window manager keeps the snap in its state (`setSheet`) and `windowRect` turns it into a
// rectangle; this is the same height formula, restated for the code that has to decide before the state
// changes (the drag gesture, the Live sheet, the globe's inset). sheet.test.ts runs both against each other
// across viewport heights, so a change to one that is not made to the other fails there.

import { SHEET, TABBAR_H } from './specs';
import type { SheetSnap } from './types';

/** The snaps from the lowest to the highest. */
export const SNAP_ORDER: readonly SheetSnap[] = ['peek', 'half', 'tall', 'full'];

export type SheetHeights = Record<SheetSnap, number>;

/** The height of each snap for a viewport height: the same numbers machine.ts's `windowRect` gives a sheet. */
export function sheetHeights(viewportH: number): SheetHeights {
  const avail = viewportH - TABBAR_H;
  return {
    peek: Math.min(SHEET.peek, avail),
    half: Math.min(SHEET.half, avail),
    tall: Math.max(SHEET.half, avail - SHEET.tallGap),
    full: Math.max(0, avail - SHEET.fullGap),
  };
}

/** The snaps that differ in height for this viewport, lowest first: a short viewport folds tall into half. */
export function distinctSnaps(heights: SheetHeights): SheetSnap[] {
  return SNAP_ORDER.filter((s, i) => SNAP_ORDER.findIndex((o) => heights[o] === heights[s]) === i);
}

/** Where a tap on the grabber goes: the next snap up, and back to the lowest after the highest. */
export function cycleSnap(from: SheetSnap, heights: SheetHeights): SheetSnap {
  const snaps = distinctSnaps(heights);
  const at = snaps.findIndex((s) => heights[s] === heights[from]);
  return snaps[(at + 1) % snaps.length] ?? from;
}

/** One snap up (`1`) or down (`-1`); it stops at the ends. */
export function stepSnap(from: SheetSnap, dir: 1 | -1, heights: SheetHeights): SheetSnap {
  const snaps = distinctSnaps(heights);
  const at = snaps.findIndex((s) => heights[s] === heights[from]);
  return snaps[Math.min(snaps.length - 1, Math.max(0, at + dir))] ?? from;
}

/** The y of a sheet's top edge: it stands on the tab bar. */
export const sheetTop = (viewportH: number, height: number): number => viewportH - TABBAR_H - height;

/** The sheet's own scroll applies from this snap up: below it the content is a preview, read by lifting the sheet. */
export const scrollsAt = (snap: SheetSnap): boolean => snap === 'tall' || snap === 'full';

export interface SheetRelease {
  /** The sheet's height where the finger let go: its snap's height less the distance dragged down. */
  height: number;
  /** Vertical speed of the finger in px per ms, positive downward (the sheet getting shorter). */
  velocity: number;
  /** The snap the drag began at. */
  from: SheetSnap;
}

export type SheetOutcome = { kind: 'snap'; snap: SheetSnap } | { kind: 'dismiss' };

/** How far a flick carries the sheet past where the finger left it, as milliseconds of the finger's speed. */
export const FLICK_CARRY_MS = 180;
/** A release at least this fast (px per ms) is a flick: it moves the sheet at least one snap its way. */
export const FLICK_PX_PER_MS = 0.45;
/** Carried below this share of the peek height, the sheet goes: a flick down from peek dismisses it. */
export const DISMISS_BELOW = 0.6;

/**
 * Where a drag ends. The sheet is thrown a little past where the finger left it (its speed carries it), then
 * takes the nearest snap; a flick that would land where it started still moves it one snap its way; and a
 * sheet carried below most of its lowest snap is dismissed to the bare globe.
 */
export function nearestSnap(rel: SheetRelease, heights: SheetHeights): SheetOutcome {
  const projected = rel.height - rel.velocity * FLICK_CARRY_MS;
  if (projected < heights.peek * DISMISS_BELOW) return { kind: 'dismiss' };
  // Snaps that share a height (a short viewport folds tall into half) count once, the lowest first.
  const snaps = distinctSnaps(heights);
  let best = snaps[0] ?? rel.from;
  for (const s of snaps) if (Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected)) best = s;
  if (Math.abs(rel.velocity) >= FLICK_PX_PER_MS && heights[best] === heights[rel.from]) {
    const at = snaps.indexOf(best);
    const next = snaps[at + (rel.velocity < 0 ? 1 : -1)];
    if (next) best = next;
  }
  return { kind: 'snap', snap: best };
}

/** The finger's speed from its last few samples (time in ms, y in px), positive downward; 0 with too little to go on. */
export function releaseVelocity(samples: readonly { t: number; y: number }[], windowMs = 100): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    if (!s || last.t - s.t > windowMs) break;
    first = s;
  }
  const dt = last.t - first.t;
  return dt >= 8 ? (last.y - first.y) / dt : 0;
}

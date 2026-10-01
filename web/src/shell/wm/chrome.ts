// Pure geometry for the window chrome's motion (design 8.3, 6.4 B): the transform that carries a window from
// where it was to where it is, and the flight of a minimised window's ghost to its dot in the dock. The
// React layer plays them with the Web Animations API (transform and opacity only).

import type { Rect } from './types';

/** A move or resize smaller than this many px is not worth an animation. */
export const FLIP_MIN_PX = 2;

export interface Flip {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

/**
 * The transform, with its origin at the top left, that makes `next` look like `prev`: translate, then scale.
 * Null when nothing visibly changed or the new rectangle is empty.
 */
export function flipBetween(prev: Rect, next: Rect): Flip | null {
  if (next.w <= 0 || next.h <= 0 || prev.w <= 0 || prev.h <= 0) return null;
  const moved = Math.abs(prev.x - next.x) >= FLIP_MIN_PX || Math.abs(prev.y - next.y) >= FLIP_MIN_PX;
  const sized = Math.abs(prev.w - next.w) >= FLIP_MIN_PX || Math.abs(prev.h - next.h) >= FLIP_MIN_PX;
  if (!moved && !sized) return null;
  return { dx: prev.x - next.x, dy: prev.y - next.y, sx: prev.w / next.w, sy: prev.h / next.h };
}

export const flipTransform = (f: Flip): string => `translate(${f.dx}px, ${f.dy}px) scale(${f.sx}, ${f.sy})`;

export interface Flight {
  dx: number;
  dy: number;
  scale: number;
}

/**
 * A minimised window flies from the centre of its frame to the centre of its dot in the dock, shrinking to
 * about the dot's size (never smaller than 4%, so the last frames still read as the window).
 */
export function minimizeFlight(from: Rect, to: Rect): Flight {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  const ratio = from.w > 0 && from.h > 0 ? Math.max(to.w / from.w, to.h / from.h) : 0.1;
  return { dx, dy, scale: Math.min(0.2, Math.max(0.04, ratio)) };
}

/**
 * A window that fills the workspace to its top or bottom edge (docked, snapped to a column, maximised) is
 * drawn with a gutter there, so every window floats clear of the top bar and the rail like the others.
 * Windows already clear of the edges are untouched, and so is everything left and right: the dock and the
 * workspace's own right margin keep those.
 */
export function withGutter(r: Rect, workspace: Rect, gutter: number): Rect {
  const top = Math.max(r.y, workspace.y + gutter);
  const bottom = Math.min(r.y + r.h, workspace.y + workspace.h - gutter);
  return { x: r.x, y: top, w: r.w, h: Math.max(0, bottom - top) };
}

/**
 * The order the frames sit in the DOM: the order they appeared, whatever the stacking. Raising a window
 * changes its z-index only; moving its element in the document would cancel a click that is half done on one
 * of its controls (the press that focused the window would swallow the release).
 */
export function stableOrder(prev: readonly string[], ids: readonly string[]): string[] {
  const live = new Set(ids);
  const kept = prev.filter((id) => live.has(id));
  const have = new Set(kept);
  return [...kept, ...ids.filter((id) => !have.has(id))];
}

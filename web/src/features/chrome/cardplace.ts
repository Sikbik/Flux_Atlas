// Hover cards over the globe, as pure logic (the React layer is globe/overlays.tsx).
//
// Which thing a card is about, how long the pointer rests before the card shows, and which side of its
// point the card opens on so it never leaves the screen or runs under the top chrome.

import type { GlobeHover } from '../../globe/bindings';

/** What a card is about: the same string for as long as the pointer stays on the same node, site or moon. */
export function hoverKey(h: GlobeHover | null): string {
  if (!h) return '';
  if (h.kind === 'moon') return 'moon';
  return h.info.isCluster ? `site:${h.info.loc}` : `node:${h.id}`;
}

/** How long the pointer rests on a node or site before its card shows (the moon's card shows at once). */
export const TIP_DELAY_MS = 180;

/** The card opens up and to the right of its point: this far right of it, this far above it. */
export const CARD_GAP_X = 14;
export const CARD_GAP_Y = 8;
/** A card keeps this far from the right edge of the screen. */
export const CARD_EDGE = 12;
/** Moon x below which its card opens to the right (so it never slides under the dock). */
export const MOON_FLIP_X = 330;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/**
 * Which way a node or site card flips: to the left of its point when it would run off the right edge,
 * below its point when it would run under the top chrome (`top` is the first y it may cover). Stateless,
 * so it cannot flicker at a threshold.
 */
export function cardFlips(p: Point, card: Size, viewW: number, top: number): { x: boolean; y: boolean } {
  return {
    x: p.x + CARD_GAP_X + card.w > viewW - CARD_EDGE,
    y: p.y - CARD_GAP_Y - card.h < top,
  };
}

/**
 * The moon's card is centred beside the moon: on its left, or its right near the dock, and nudged down by
 * whatever keeps its top clear of the top chrome.
 */
export function moonCardPlace(p: Point, card: Size, top: number): { flipX: boolean; nudge: number } {
  return { flipX: p.x < MOON_FLIP_X, nudge: Math.max(0, Math.round(top - (p.y - card.h / 2))) };
}

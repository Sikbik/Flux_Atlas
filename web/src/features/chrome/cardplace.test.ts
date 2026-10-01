import { describe, expect, it } from 'vitest';
import type { GlobeHover } from '../../globe/bindings';
import type { PickInfo } from '../../globe/engine/types';
import {
  CARD_EDGE,
  CARD_GAP_X,
  CARD_GAP_Y,
  cardFlips,
  hoverKey,
  MOON_FLIP_X,
  moonCardPlace,
} from './cardplace';

const pick = (over: Partial<PickInfo> = {}): PickInfo => ({
  id: 1,
  slot: 0,
  loc: 11,
  clusterSize: 531,
  isCluster: true,
  lat: 50,
  lon: 12,
  tier: 1,
  status: 1,
  flags: 0,
  x: 840,
  y: 190,
  ...over,
});

const node = (id: number, info: Partial<PickInfo> = {}): GlobeHover => ({
  kind: 'node',
  id,
  key: `k${id}`,
  info: pick({ id: id + 1, ...info }),
});

describe('hoverKey', () => {
  it('is empty for nothing and "moon" for the moon', () => {
    expect(hoverKey(null)).toBe('');
    expect(hoverKey({ kind: 'moon', x: 1, y: 2, r: 3 })).toBe('moon');
  });

  it('names a single node by its id', () => {
    expect(hoverKey(node(42, { isCluster: false }))).toBe('node:42');
    expect(hoverKey(node(43, { isCluster: false }))).toBe('node:43');
  });

  it('names a stacked hub by its site, whichever of its nodes the pick resolved to', () => {
    expect(hoverKey(node(78, { isCluster: true, loc: 11 }))).toBe('site:11');
    expect(hoverKey(node(1953, { isCluster: true, loc: 11 }))).toBe('site:11');
    expect(hoverKey(node(78, { isCluster: true, loc: 12 }))).toBe('site:12');
  });

  it('is the same string while the engine re-emits the same hover with new coordinates', () => {
    const a = node(5, { isCluster: false, x: 100, y: 100 });
    const b = node(5, { isCluster: false, x: 101, y: 100 });
    expect(a).not.toBe(b);
    expect(hoverKey(a)).toBe(hoverKey(b));
  });
});

describe('cardFlips', () => {
  const card = { w: 190, h: 106 };
  const top = 114;

  it('opens up and to the right when there is room', () => {
    expect(cardFlips({ x: 700, y: 500 }, card, 1600, top)).toEqual({ x: false, y: false });
  });

  it('flips left when the card would run off the right edge', () => {
    const edge = 1600 - CARD_EDGE - CARD_GAP_X - card.w;
    expect(cardFlips({ x: edge, y: 500 }, card, 1600, top).x).toBe(false);
    expect(cardFlips({ x: edge + 1, y: 500 }, card, 1600, top).x).toBe(true);
  });

  it('flips below when the card would run under the top chrome', () => {
    const limit = top + CARD_GAP_Y + card.h;
    expect(cardFlips({ x: 700, y: limit }, card, 1600, top).y).toBe(false);
    expect(cardFlips({ x: 700, y: limit - 1 }, card, 1600, top).y).toBe(true);
  });

  it('flips both ways in the top right corner', () => {
    expect(cardFlips({ x: 1580, y: 130 }, card, 1600, top)).toEqual({ x: true, y: true });
  });

  it('depends on the point and the card only, so it cannot flicker at a threshold', () => {
    const p = { x: 1500, y: 150 };
    const first = cardFlips(p, card, 1600, top);
    for (let k = 0; k < 5; k++) expect(cardFlips(p, card, 1600, top)).toEqual(first);
  });
});

describe('moonCardPlace', () => {
  const card = { w: 224, h: 124 };
  const top = 114;

  it('opens to the left of the moon, and to the right near the dock', () => {
    expect(moonCardPlace({ x: MOON_FLIP_X, y: 400 }, card, top).flipX).toBe(false);
    expect(moonCardPlace({ x: MOON_FLIP_X - 1, y: 400 }, card, top).flipX).toBe(true);
  });

  it('needs no nudge when the card is clear of the top chrome', () => {
    expect(moonCardPlace({ x: 900, y: 400 }, card, top).nudge).toBe(0);
    expect(moonCardPlace({ x: 900, y: top + card.h / 2 }, card, top).nudge).toBe(0);
  });

  it('nudges the card down by what keeps its top at the chrome line', () => {
    // Centred on y = 170, a 124 px card would start at y = 108: 6 px short of the line.
    expect(moonCardPlace({ x: 900, y: 170 }, card, top).nudge).toBe(6);
    expect(moonCardPlace({ x: 900, y: 100 }, card, top).nudge).toBe(76);
  });
});

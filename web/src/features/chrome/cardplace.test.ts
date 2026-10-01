import { describe, expect, it } from 'vitest';
import {
  CARD_EDGE,
  CARD_GAP_X,
  CARD_GAP_Y,
  cardFlips,
  MOON_CARD_GAP,
  MOON_LEFT_CLEAR,
  moonCardPlace,
} from './cardplace';

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

  // Where the card's left edge would reach the dock's clearance.
  const FLIP_X = MOON_LEFT_CLEAR + MOON_CARD_GAP + card.w;

  it('opens to the left of the moon, and to the right near the dock', () => {
    expect(moonCardPlace({ x: FLIP_X, y: 400 }, card, top).flipX).toBe(false);
    expect(moonCardPlace({ x: FLIP_X - 1, y: 400 }, card, top).flipX).toBe(true);
  });

  it('stays on the left of a moon near the right edge of a phone, where the right has no room and there is no dock', () => {
    const phone = { w: 390, leftClear: 0 };
    // The moon at x 295 on a 390 px screen: 7 px to spare on the left, nothing on the right.
    expect(moonCardPlace({ x: 295, y: 400 }, card, top, phone).flipX).toBe(false);
    // With a dock's clearance the left would not do, but the right does not fit either: it still stays left.
    expect(moonCardPlace({ x: 295, y: 400 }, card, top, { w: 390, leftClear: MOON_LEFT_CLEAR }).flipX).toBe(
      false,
    );
  });

  it('goes to the right of a moon near the left edge when the right fits', () => {
    expect(moonCardPlace({ x: 100, y: 400 }, card, top, { w: 390, leftClear: 0 }).flipX).toBe(false);
    expect(moonCardPlace({ x: 60, y: 400 }, card, top, { w: 800, leftClear: 0 }).flipX).toBe(true);
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

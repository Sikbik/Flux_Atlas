import { describe, expect, it } from 'vitest';
import { initialWmState, wmReduce } from '../wm/machine';
import { sheetHeights } from '../wm/sheet';
import type { SheetSnap, WmState } from '../wm/types';
import { moonParked, PARK_SIZE, parkAt } from './moonpark';

const desktop = (): WmState => initialWmState({ w: 1600, h: 900 }, { x: 0, y: 52, w: 1588, h: 716 });

/** A phone of this size, with the settings window open as the sheet at `snap` (or no window at all). */
function phone(w: number, h: number, snap: SheetSnap, open = true): WmState {
  let s = wmReduce(desktop(), {
    t: 'setViewport',
    viewport: { w, h },
    workspace: { x: 0, y: 158, w, h: h - 158 - 64 },
  });
  if (open) s = wmReduce(s, { t: 'open', type: 'settings', key: null, now: 1 });
  return wmReduce(s, { t: 'setSheet', snap });
}

describe('moonParked', () => {
  it('parks while a sheet is as tall as the tall snap or taller', () => {
    expect(moonParked(phone(390, 844, 'tall'), false)).toBe(true);
    expect(moonParked(phone(390, 844, 'full'), false)).toBe(true);
  });

  it('leaves the moon on its orbit while the sheet is peek or half', () => {
    expect(moonParked(phone(390, 844, 'peek'), false)).toBe(false);
    expect(moonParked(phone(390, 844, 'half'), false)).toBe(false);
  });

  it('goes by the sheet height, so a short phone that folds tall into half parks at half', () => {
    const heights = sheetHeights(667);
    expect(heights.half).toBe(heights.tall);
    expect(moonParked(phone(375, 667, 'half'), false)).toBe(true);
    expect(moonParked(phone(375, 667, 'peek'), false)).toBe(false);
  });

  it('counts the Live sheet, which the window manager does not know, but only with no window above it', () => {
    expect(moonParked(phone(390, 844, 'tall', false), true)).toBe(true);
    expect(moonParked(phone(390, 844, 'half', false), true)).toBe(false);
    // No window and no Live sheet: nothing covers the orbit, whatever snap the state remembers.
    expect(moonParked(phone(390, 844, 'tall', false), false)).toBe(false);
  });

  it('is a phone behaviour only', () => {
    const s = wmReduce(desktop(), { t: 'open', type: 'settings', key: null, now: 1 });
    expect(s.layout).toBe('desktop');
    expect(moonParked(wmReduce(s, { t: 'setSheet', snap: 'full' }), true)).toBe(false);
  });
});

describe('parkAt', () => {
  it('is the ring centre, to a tenth of a pixel, at the symbol size', () => {
    expect(parkAt({ left: 165.8, top: 16, width: 28, height: 28 })).toEqual({
      x: 179.8,
      y: 30,
      size: PARK_SIZE,
    });
    expect(parkAt({ left: 100.04, top: 9.97, width: 31.9, height: 31.9 })).toEqual({
      x: 116,
      y: 25.9,
      size: PARK_SIZE,
    });
  });

  it('takes the symbol size it is given', () => {
    expect(parkAt({ left: 0, top: 0, width: 10, height: 10 }, 18)).toMatchObject({ size: 18 });
  });

  it('is null while the ring has no size (hidden, or not laid out yet)', () => {
    expect(parkAt({ left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(parkAt({ left: 0, top: 0, width: 28, height: 0 })).toBeNull();
    expect(parkAt({ left: 0, top: 0, width: Number.NaN, height: 28 })).toBeNull();
  });
});

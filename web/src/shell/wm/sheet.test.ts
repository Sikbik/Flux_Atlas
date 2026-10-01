import { describe, expect, it } from 'vitest';
import { initialWmState, windowRect, wmReduce } from './machine';
import {
  FLICK_PX_PER_MS,
  nearestSnap,
  releaseVelocity,
  type SheetRelease,
  SNAP_ORDER,
  scrollsAt,
  sheetHeights,
  sheetTop,
} from './sheet';
import { TABBAR_H } from './specs';
import type { SheetSnap } from './types';

describe('sheetHeights', () => {
  it('gives the design numbers on a 390 x 844 phone: peek 132, half 372, tall the screen less the tabs and 250, full less 16', () => {
    expect(sheetHeights(844)).toEqual({
      peek: 132,
      half: 372,
      tall: 844 - TABBAR_H - 250,
      full: 844 - TABBAR_H - 16,
    });
  });

  it('stands on the tab bar', () => {
    expect(sheetTop(844, 372)).toBe(844 - TABBAR_H - 372);
  });

  // The window manager owns the real formula (machine.ts, private). This keeps the copy honest.
  it.each([844, 812, 740, 667, 568, 480, 320])(
    'matches the window manager for every snap at a viewport height of %i',
    (h) => {
      const heights = sheetHeights(h);
      let s = initialWmState({ w: 390, h }, { x: 0, y: 60, w: 390, h: Math.max(1, h - 120) });
      s = wmReduce(s, { t: 'open', type: 'queue', key: null, now: 1 });
      const id = s.focused as string;
      for (const snap of SNAP_ORDER) {
        const next = wmReduce(s, { t: 'setSheet', snap });
        const r = windowRect(next, id);
        expect(r.h, `${snap} height`).toBe(heights[snap]);
        expect(r.y, `${snap} top`).toBe(sheetTop(h, heights[snap]));
      }
    },
  );
});

describe('nearestSnap', () => {
  const H = sheetHeights(844);
  const rel = (from: SheetSnap, dy: number, velocity = 0): SheetRelease => ({
    from,
    height: H[from] - dy,
    velocity,
  });
  const outcome = (r: SheetRelease, heights = H) => nearestSnap(r, heights);

  it('takes the nearest snap when the finger lets go slowly', () => {
    expect(outcome(rel('half', -200))).toEqual({ kind: 'snap', snap: 'tall' });
    expect(outcome(rel('half', -30))).toEqual({ kind: 'snap', snap: 'half' });
    expect(outcome(rel('tall', -200))).toEqual({ kind: 'snap', snap: 'full' });
    expect(outcome(rel('full', 100))).toEqual({ kind: 'snap', snap: 'full' });
    expect(outcome(rel('tall', 250))).toEqual({ kind: 'snap', snap: 'half' });
  });

  it('a flick carries the sheet past where the finger left it', () => {
    expect(outcome(rel('half', -8, -0.8))).toEqual({ kind: 'snap', snap: 'tall' });
    expect(outcome(rel('tall', 40, 1.2))).toEqual({ kind: 'snap', snap: 'half' });
  });

  it('a flick that would land where it started still moves the sheet one snap its way', () => {
    const up = outcome(rel('half', 0, -(FLICK_PX_PER_MS + 0.01)));
    expect(up).toEqual({ kind: 'snap', snap: 'tall' });
    const down = outcome(rel('half', 0, FLICK_PX_PER_MS + 0.01));
    expect(down).toEqual({ kind: 'snap', snap: 'peek' });
  });

  it('never goes past the ends: a flick up from full stays full, a flick down from peek dismisses', () => {
    expect(outcome(rel('full', 0, -1))).toEqual({ kind: 'snap', snap: 'full' });
    expect(outcome(rel('peek', 0, 0.6))).toEqual({ kind: 'dismiss' });
  });

  it('dismisses a sheet pulled most of the way out of the screen, and keeps one that was only nudged', () => {
    expect(outcome(rel('peek', 60))).toEqual({ kind: 'dismiss' });
    expect(outcome(rel('peek', 25))).toEqual({ kind: 'snap', snap: 'peek' });
  });

  it('a flick down from half goes to peek, not off the screen; a very hard one does dismiss', () => {
    expect(outcome(rel('half', 20, 0.7))).toEqual({ kind: 'snap', snap: 'peek' });
    expect(outcome(rel('half', 100, 1.8))).toEqual({ kind: 'dismiss' });
  });

  it('counts snaps that share a height once: a short screen folds tall into half', () => {
    const short = sheetHeights(667);
    expect(short.tall).toBe(short.half);
    expect(nearestSnap({ from: 'half', height: short.half, velocity: -0.8 }, short)).toEqual({
      kind: 'snap',
      snap: 'full',
    });
    for (const dy of [-300, -100, 0, 100]) {
      const r = nearestSnap({ from: 'half', height: short.half - dy, velocity: 0 }, short);
      expect(r).not.toEqual({ kind: 'snap', snap: 'tall' });
    }
  });
});

describe('releaseVelocity', () => {
  it('is the finger speed over the last 100 ms, downward positive', () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 50, y: 10 },
      { t: 100, y: 60 },
      { t: 150, y: 110 },
      { t: 200, y: 160 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo(1, 5);
    expect(releaseVelocity(samples.map((s) => ({ t: s.t, y: -s.y })))).toBeCloseTo(-1, 5);
  });

  it('is zero for a finger that rested before it lifted, or when there is too little to go on', () => {
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0);
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 300, y: 80 },
      ]),
    ).toBe(0);
    expect(releaseVelocity([])).toBe(0);
  });
});

describe('scrollsAt', () => {
  it('scrolls the content only from tall up', () => {
    expect(SNAP_ORDER.map(scrollsAt)).toEqual([false, false, true, true]);
  });
});

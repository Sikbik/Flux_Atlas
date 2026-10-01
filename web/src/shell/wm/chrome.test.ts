import { describe, expect, it } from 'vitest';
import { flipBetween, flipTransform, minimizeFlight, stableOrder, withGutter } from './chrome';

describe('flipBetween', () => {
  it('is null when nothing visibly changed', () => {
    const r = { x: 100, y: 80, w: 400, h: 300 };
    expect(flipBetween(r, r)).toBeNull();
    expect(flipBetween(r, { ...r, x: 101, h: 301 })).toBeNull();
  });

  it('carries a window from where it was to where it is', () => {
    const prev = { x: 100, y: 80, w: 400, h: 300 };
    const next = { x: 0, y: 52, w: 800, h: 600 };
    const f = flipBetween(prev, next);
    expect(f).toEqual({ dx: 100, dy: 28, sx: 0.5, sy: 0.5 });
    expect(flipTransform(f ?? { dx: 0, dy: 0, sx: 1, sy: 1 })).toBe('translate(100px, 28px) scale(0.5, 0.5)');
  });

  it('ignores empty rectangles', () => {
    expect(flipBetween({ x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5, w: 10, h: 10 })).toBeNull();
    expect(flipBetween({ x: 5, y: 5, w: 10, h: 10 }, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
});

describe('minimizeFlight', () => {
  it('flies centre to centre and shrinks to about the dot', () => {
    const f = minimizeFlight({ x: 100, y: 100, w: 400, h: 200 }, { x: 20, y: 600, w: 10, h: 10 });
    expect(f.dx).toBe(25 - 300);
    expect(f.dy).toBe(605 - 200);
    expect(f.scale).toBeCloseTo(0.05, 5);
  });

  it('never shrinks below 4% or grows above 20%', () => {
    expect(minimizeFlight({ x: 0, y: 0, w: 1000, h: 1000 }, { x: 0, y: 0, w: 1, h: 1 }).scale).toBe(0.04);
    expect(minimizeFlight({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 90, h: 90 }).scale).toBe(0.2);
  });
});

describe('withGutter', () => {
  const ws = { x: 76, y: 52, w: 1512, h: 693 };

  it('leaves a window that is already clear of the edges alone', () => {
    const r = { x: 118, y: 66, w: 820, h: 666 };
    expect(withGutter(r, ws, 12)).toEqual(r);
  });

  it('draws a window that fills the workspace with a gutter above and below', () => {
    expect(withGutter({ x: 1168, y: 52, w: 420, h: 693 }, ws, 12)).toEqual({
      x: 1168,
      y: 64,
      w: 420,
      h: 669,
    });
  });

  it('never returns a negative height', () => {
    expect(withGutter({ x: 0, y: 52, w: 10, h: 10 }, { x: 0, y: 52, w: 10, h: 10 }, 12).h).toBe(0);
  });
});

describe('stableOrder', () => {
  it('keeps the order windows appeared in when the stacking changes', () => {
    expect(stableOrder(['a', 'b'], ['b', 'a'])).toEqual(['a', 'b']);
  });

  it('drops windows that left and appends new ones', () => {
    expect(stableOrder(['a', 'b', 'c'], ['c', 'd'])).toEqual(['c', 'd']);
    expect(stableOrder([], ['x', 'y'])).toEqual(['x', 'y']);
  });
});

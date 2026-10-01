import { describe, expect, it } from 'vitest';
import { CLEARANCE, lineCrosses, placeTip } from './avoid';

describe('lineCrosses', () => {
  const line = { x: [100, 200, 300], y: [50, 100, 50] };
  it('is true for a point inside the rectangle', () => {
    expect(lineCrosses(line, 190, 210, 90, 110)).toBe(true);
  });
  it('is true for a segment that passes through with no point inside', () => {
    // Between (100, 50) and (200, 100): at x 150 it is at y 75.
    expect(lineCrosses(line, 140, 160, 70, 80)).toBe(true);
  });
  it('is false for a rectangle the line stays clear of', () => {
    expect(lineCrosses(line, 140, 160, 0, 40)).toBe(false);
    expect(lineCrosses(line, 400, 500, 0, 200)).toBe(false);
  });
  it('counts a line just outside the rectangle as in the way, by the clearance', () => {
    const flat = { x: [0, 400], y: [100, 100] };
    // A box ending CLEARANCE short of the line is clear; one ending nearer is not.
    expect(lineCrosses(flat, 190, 210, 0, 100 - CLEARANCE - 1)).toBe(false);
    expect(lineCrosses(flat, 190, 210, 0, 100 - CLEARANCE + 1)).toBe(true);
    expect(lineCrosses(flat, 190, 210, 100 + CLEARANCE + 1, 200)).toBe(false);
    expect(lineCrosses(flat, 190, 210, 100 + CLEARANCE - 1, 200)).toBe(true);
  });
  it('is false with no line to avoid', () => {
    expect(lineCrosses(undefined, 0, 1000, 0, 1000)).toBe(false);
  });
  it('steps over an unknown value instead of drawing through it', () => {
    expect(lineCrosses({ x: [100, 200, 300], y: [50, null, 50] }, 190, 210, 0, 1000)).toBe(false);
  });
});

describe('placeTip', () => {
  // A chart 600 wide and 232 tall; the axes take 46 on the left, 16 on the right, 12 above and 26 below.
  const g = { width: 600, height: 232, top: 12, bottom: 26, left: 46, right: 16 };
  const size = (rows: number) => ({ w: 220, h: 40 + 22 * rows });

  it('goes to the right of a crosshair in the left of the chart, and in the half away from the dot', () => {
    expect(placeTip(g, 150, 40, size(2))).toEqual({ side: 'right', v: 'bottom' });
    expect(placeTip(g, 150, 190, size(2))).toEqual({ side: 'right', v: 'top' });
  });

  it('goes to the left of a crosshair past 58% of the width', () => {
    expect(placeTip(g, 450, 40, size(2))).toEqual({ side: 'left', v: 'bottom' });
  });

  it('is up, in the top half, with no dot', () => {
    expect(placeTip(g, 150, null, size(2))).toEqual({ side: 'right', v: 'top' });
  });

  it('takes the other half when a line runs through this one', () => {
    // The dot is high, so the tooltip wants the bottom; the line runs low across where it would sit.
    const low = { x: [160, 400], y: [180, 180] };
    expect(placeTip(g, 150, 40, size(2), low)).toEqual({ side: 'right', v: 'top' });
  });

  it('takes the other side when both halves of this one are crossed', () => {
    // The crosshair is mid-chart, so both sides have room. A step runs top to bottom to the right of it.
    const onTheRight = { x: [320, 321, 322, 323], y: [20, 200, 20, 200] };
    expect(placeTip(g, 300, 100, size(2), onTheRight)).toEqual({ side: 'left', v: 'bottom' });
    // The same step on the left of the crosshair leaves the right free.
    const onTheLeft = { x: [100, 101, 102, 103], y: [20, 200, 20, 200] };
    expect(placeTip(g, 300, 100, size(2), onTheLeft)).toEqual({ side: 'right', v: 'bottom' });
  });

  it('keeps to a side it fits on when every spot is crossed', () => {
    // A phone: 358 wide, a 172 wide tooltip, the crosshair at 199. The right (213 to 385) does not fit; the left
    // (13 to 185) fits only over the axis labels. With a line through both halves, it stays left rather than
    // leave the chart on the right, though the right is the side the crosshair's place prefers.
    const phone = { ...g, width: 358 };
    const everywhere = {
      x: Array.from({ length: 36 }, (_, i) => i * 10),
      y: Array.from({ length: 36 }, (_, i) => (i % 2 === 0 ? 20 : 200)),
    };
    expect(placeTip(phone, 199, 40, { w: 172, h: 84 }, everywhere).side).toBe('left');
  });

  it('keeps the preferred spot when every spot is crossed', () => {
    const everywhere = {
      x: Array.from({ length: 60 }, (_, i) => i * 10),
      y: Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 20 : 200)),
    };
    expect(placeTip(g, 150, 40, size(2), everywhere)).toEqual({ side: 'right', v: 'bottom' });
  });

  it('does not put a tooltip where it would leave the chart', () => {
    // 80 px from the right edge there is no room on the right for a 220 px tooltip.
    expect(placeTip(g, 520, 40, size(2)).side).toBe('left');
    expect(placeTip(g, 100, 40, size(2)).side).toBe('right');
  });

  it('keeps off the axis labels while there is room to', () => {
    // 290 in a 520 wide chart: the right has no room, and the left fits only if it may cover the labels (x under 46)...
    const narrow = { ...g, width: 520 };
    // ...from 56 to 276: inside the plot, so the left it is.
    expect(placeTip(narrow, 290, 40, size(2)).side).toBe('left');
    // 250: the left box would start at 16, over the labels; the right box (264 to 484) fits inside the plot.
    expect(placeTip(narrow, 250, 40, size(2)).side).toBe('right');
    // A 340 wide tooltip at 200 fits on neither side: the side with more room, the right.
    expect(placeTip(narrow, 200, 40, { w: 340, h: 100 }).side).toBe('right');
  });

  it('takes the side with more room when the tooltip fits on neither (a phone)', () => {
    const phone = { ...g, width: 330 };
    expect(placeTip(phone, 120, 40, size(2)).side).toBe('right');
    expect(placeTip(phone, 150, 40, size(2)).side).toBe('right');
    expect(placeTip(phone, 200, 40, size(2)).side).toBe('left');
    expect(placeTip(phone, 300, 40, size(2)).side).toBe('left');
  });

  it('is taller with more rows, so a bigger tooltip is crossed where a small one is not', () => {
    // A line a little below where a two row tooltip ends in the top half, and through a four row one.
    const under = { x: [310, 520], y: [125, 125] };
    expect(placeTip(g, 300, 190, size(2), under)).toEqual({ side: 'right', v: 'top' });
    expect(placeTip(g, 300, 190, size(4), under)).toEqual({ side: 'left', v: 'top' });
  });
});

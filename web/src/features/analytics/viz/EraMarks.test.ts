import { describe, expect, it } from 'vitest';
import { placeLabel } from './EraMarks';

// A plot 600 wide and 200 tall, at (46, 12): the top slot's baseline is at y 36, the bottom one's at y 204.
const geo = { plot: { x: 46, y: 12, w: 600, h: 200 } } as Parameters<typeof placeLabel>[0];
const TOP = 36;
const BOTTOM = 204;

describe('placeLabel', () => {
  it('goes to the right of the hairline, near the top, when it fits and nothing is in the way', () => {
    expect(placeLabel(geo, 200)).toEqual({ after: true, y: TOP });
  });

  it('goes to the left of a hairline near the right edge', () => {
    expect(placeLabel(geo, 600)).toEqual({ after: false, y: TOP });
  });

  it('drops to the bottom when the chart line runs along the top', () => {
    const along = { x: [100, 250, 400], y: [30, 30, 30] };
    expect(placeLabel(geo, 200, along)).toEqual({ after: true, y: BOTTOM });
  });

  it('takes the other side when this side is blocked top and bottom', () => {
    // A line down the right of the hairline across both slots; clear on the left.
    const wall = { x: [210, 211, 212], y: [0, 100, 250] };
    expect(placeLabel(geo, 200, wall)).toEqual({ after: false, y: TOP });
  });

  it('keeps to the preferred spot when every spot is in the way', () => {
    // A zigzag between the top and the bottom, either side of the hairline.
    const zigzag = {
      x: [50, 60, 80, 100, 150, 180, 210, 260, 300],
      y: [30, 200, 30, 200, 30, 200, 30, 200, 30],
    };
    expect(placeLabel(geo, 200, zigzag)).toEqual({ after: true, y: TOP });
  });

  it('does not put a name where it would leave the plot', () => {
    // 60 px from the left edge: no room on the left, so it goes right even with the top blocked.
    const top = { x: [60, 400], y: [30, 30] };
    expect(placeLabel(geo, 60, top)).toEqual({ after: true, y: BOTTOM });
  });
});

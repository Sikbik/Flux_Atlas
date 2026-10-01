import { describe, expect, it } from 'vitest';
import { computePosition, intersect, isOutOfView, parsePlacement, spaceOn } from './position';

const viewport = { width: 1000, height: 800 };
const anchor = { left: 400, top: 300, width: 100, height: 30 };
const floating = { width: 200, height: 100 };

describe('computePosition', () => {
  it('centres a bottom layer under the anchor with the offset', () => {
    const r = computePosition({ anchor, floating, viewport, placement: 'bottom', offset: 6 });
    expect(r.side).toBe('bottom');
    expect(r.top).toBe(300 + 30 + 6);
    expect(r.left).toBe(450 - 100);
  });

  it('aligns to the start and end edges of the anchor', () => {
    const start = computePosition({ anchor, floating, viewport, placement: 'bottom-start' });
    const end = computePosition({ anchor, floating, viewport, placement: 'bottom-end' });
    expect(start.left).toBe(400);
    expect(end.left).toBe(500 - 200);
    expect(end.placement).toBe('bottom-end');
  });

  it('places left and right layers vertically centred on the anchor', () => {
    const right = computePosition({ anchor, floating, viewport, placement: 'right', offset: 8 });
    expect(right.left).toBe(500 + 8);
    expect(right.top).toBe(315 - 50);
    const left = computePosition({ anchor, floating, viewport, placement: 'left', offset: 8 });
    expect(left.left).toBe(400 - 8 - 200);
  });

  it('flips to the opposite side when the preferred side lacks room', () => {
    const low = { left: 400, top: 740, width: 100, height: 30 };
    const r = computePosition({ anchor: low, floating, viewport, placement: 'bottom' });
    expect(r.side).toBe('top');
    expect(r.top).toBe(740 - 6 - 100);
  });

  it('does not flip when flipping is disabled, and clamps into the viewport instead', () => {
    const low = { left: 400, top: 740, width: 100, height: 30 };
    const r = computePosition({ anchor: low, floating, viewport, placement: 'bottom', flip: false });
    expect(r.side).toBe('bottom');
    expect(r.top).toBe(800 - 100 - 8);
  });

  it('keeps the preferred side when the opposite side has even less room', () => {
    const tiny = { width: 1000, height: 120 };
    const r = computePosition({
      anchor: { left: 400, top: 40, width: 100, height: 30 },
      floating: { width: 200, height: 100 },
      viewport: tiny,
      placement: 'bottom',
    });
    expect(r.side).toBe('bottom');
  });

  it('clamps the cross axis into the viewport padding', () => {
    const edge = { left: 960, top: 300, width: 30, height: 30 };
    const r = computePosition({ anchor: edge, floating, viewport, placement: 'bottom', padding: 8 });
    expect(r.left).toBe(1000 - 200 - 8);
    const near = { left: 2, top: 300, width: 30, height: 30 };
    expect(computePosition({ anchor: near, floating, viewport, padding: 8 }).left).toBe(8);
  });

  it('reports the room left for scrollable content', () => {
    const r = computePosition({ anchor, floating, viewport, padding: 10 });
    expect(r.maxHeight).toBe(780);
    expect(r.maxWidth).toBe(980);
  });
});

describe('placement helpers', () => {
  it('parses placements into side and align', () => {
    expect(parsePlacement('top')).toEqual({ side: 'top', align: 'center' });
    expect(parsePlacement('left-end')).toEqual({ side: 'left', align: 'end' });
  });

  it('measures room on each side', () => {
    expect(spaceOn('top', anchor, viewport, 6, 8)).toBe(300 - 6 - 8);
    expect(spaceOn('bottom', anchor, viewport, 6, 8)).toBe(800 - 330 - 6 - 8);
    expect(spaceOn('left', anchor, viewport, 6, 8)).toBe(400 - 6 - 8);
    expect(spaceOn('right', anchor, viewport, 6, 8)).toBe(1000 - 500 - 6 - 8);
  });
});

describe('visibility helpers', () => {
  const visible = { left: 0, top: 0, width: 1000, height: 800 };

  it('intersects overlapping boxes and collapses disjoint ones', () => {
    expect(
      intersect({ left: 0, top: 0, width: 100, height: 100 }, { left: 50, top: 60, width: 100, height: 100 }),
    ).toEqual({
      left: 50,
      top: 60,
      width: 50,
      height: 40,
    });
    const none = intersect(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 20, top: 20, width: 10, height: 10 },
    );
    expect(none.width).toBe(0);
    expect(none.height).toBe(0);
  });

  it('keeps an anchor that is partly on screen and flags one scrolled fully out', () => {
    expect(isOutOfView({ left: 100, top: -10, width: 80, height: 30 }, visible)).toBe(false);
    expect(isOutOfView({ left: 100, top: -40, width: 80, height: 30 }, visible)).toBe(true);
    expect(isOutOfView({ left: 100, top: 790, width: 80, height: 30 }, visible)).toBe(false);
    expect(isOutOfView({ left: 100, top: 800, width: 80, height: 30 }, visible)).toBe(true);
    expect(isOutOfView({ left: 1000, top: 100, width: 80, height: 30 }, visible)).toBe(true);
  });
});

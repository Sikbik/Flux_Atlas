import { describe, expect, it } from 'vitest';
import { fadeEdges, revealLeft } from './KindStrip';

describe('fadeEdges', () => {
  it('fades nothing when every chip fits', () => {
    expect(fadeEdges(0, 300, 300)).toBeUndefined();
    expect(fadeEdges(0, 300, 301)).toBeUndefined();
  });

  it('fades the end while more chips wait on the right, the start once scrolled, both in between', () => {
    expect(fadeEdges(0, 300, 420)).toBe('end');
    expect(fadeEdges(60, 300, 420)).toBe('both');
    expect(fadeEdges(120, 300, 420)).toBe('start');
  });

  it('treats a sub-pixel position as the edge', () => {
    expect(fadeEdges(0.5, 300, 420)).toBe('end');
    expect(fadeEdges(119.4, 300, 420)).toBe('start');
  });
});

describe('revealLeft', () => {
  const view = { scrollLeft: 0, width: 300 };

  it('leaves a chip that already shows, clear of the fades, where it is', () => {
    expect(revealLeft(view, { left: 60, width: 80 }, 28)).toBe(0);
    expect(revealLeft({ scrollLeft: 50, width: 300 }, { left: 120, width: 80 }, 28)).toBe(50);
  });

  it('scrolls right until the chip clears the end fade', () => {
    expect(revealLeft(view, { left: 250, width: 90 }, 28)).toBe(68);
  });

  it('scrolls left until the chip clears the start fade, and never below zero', () => {
    expect(revealLeft({ scrollLeft: 200, width: 300 }, { left: 150, width: 70 }, 28)).toBe(122);
    expect(revealLeft({ scrollLeft: 10, width: 300 }, { left: 14, width: 60 }, 28)).toBe(0);
  });

  it('shows the start of a chip wider than the strip', () => {
    expect(revealLeft(view, { left: 100, width: 400 }, 28)).toBe(72);
  });
});

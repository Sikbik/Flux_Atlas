import { describe, expect, it } from 'vitest';
import { edgeFade, scrollLeftToReveal } from './scroll';

describe('edgeFade', () => {
  it('fades nothing when the strip fits', () => {
    expect(edgeFade(0, 400, 400)).toBeUndefined();
    expect(edgeFade(0, 400, 400.4)).toBeUndefined();
  });

  it('fades the end when content continues to the right', () => {
    expect(edgeFade(0, 400, 700)).toBe('end');
  });

  it('fades the start once scrolled, and both in the middle', () => {
    expect(edgeFade(300, 400, 700)).toBe('start');
    expect(edgeFade(120, 400, 700)).toBe('both');
  });

  it('treats sub-pixel positions as the edge', () => {
    expect(edgeFade(0.6, 400, 700)).toBe('end');
    expect(edgeFade(299.5, 400, 700)).toBe('start');
  });
});

describe('scrollLeftToReveal', () => {
  const view = { scrollLeft: 100, width: 400 };

  it('keeps the position when the item is clear of both edges', () => {
    expect(scrollLeftToReveal(view, { left: 200, width: 80 }, 28)).toBe(100);
  });

  it('scrolls left to clear the start fade', () => {
    expect(scrollLeftToReveal(view, { left: 110, width: 80 }, 28)).toBe(82);
  });

  it('scrolls right to clear the end fade', () => {
    expect(scrollLeftToReveal(view, { left: 440, width: 80 }, 28)).toBe(100 + (440 + 80 + 28 - 500));
  });

  it('never goes below zero', () => {
    expect(scrollLeftToReveal({ scrollLeft: 10, width: 400 }, { left: 0, width: 60 }, 28)).toBe(0);
  });

  it('aligns to the start when the item is wider than the view', () => {
    expect(scrollLeftToReveal(view, { left: 300, width: 600 }, 28)).toBe(272);
  });
});

import { describe, expect, it } from 'vitest';
import { fitsLabel, foldTail, squarify, type TreemapItem } from './treemap';

const items = (values: number[]): TreemapItem[] =>
  values.map((value, i) => ({ id: `a${i}`, label: `App ${i}`, value }));

const area = (c: { w: number; h: number }) => c.w * c.h;

describe('squarify', () => {
  it('fills the box: the cells add up to its area', () => {
    const cells = squarify(items([6, 6, 4, 3, 2, 2, 1]), 600, 400);
    expect(cells).toHaveLength(7);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeCloseTo(600 * 400, 6);
  });

  it('gives each cell the area of its share', () => {
    const cells = squarify(items([50, 30, 20]), 100, 100);
    const byId = Object.fromEntries(cells.map((c) => [c.id, area(c)]));
    expect(byId.a0).toBeCloseTo(5000, 6);
    expect(byId.a1).toBeCloseTo(3000, 6);
    expect(byId.a2).toBeCloseTo(2000, 6);
  });

  it('keeps every cell inside the box and none over another', () => {
    const cells = squarify(items(Array.from({ length: 40 }, (_, i) => 40 - i)), 700, 300);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(700 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(300 + 1e-9);
    }
    for (let a = 0; a < cells.length; a++) {
      for (let b = a + 1; b < cells.length; b++) {
        const p = cells[a] as (typeof cells)[number];
        const q = cells[b] as (typeof cells)[number];
        const overlapW = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const overlapH = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        expect(overlapW <= 1e-6 || overlapH <= 1e-6).toBe(true);
      }
    }
  });

  it('puts the biggest first, whatever order it is given', () => {
    const cells = squarify(items([1, 9, 4]), 100, 100);
    expect(cells[0]?.id).toBe('a1');
    expect(cells[0]?.x).toBe(0);
    expect(cells[0]?.y).toBe(0);
  });

  it('keeps cells near square', () => {
    const cells = squarify(items([8, 7, 6, 5, 4, 3, 2, 1]), 400, 400);
    for (const c of cells) expect(Math.max(c.w / c.h, c.h / c.w)).toBeLessThan(4);
  });

  it('leaves a gap between cells without losing any', () => {
    const cells = squarify(items([4, 3, 2, 1]), 200, 200, 4);
    expect(cells).toHaveLength(4);
    const total = cells.reduce((s, c) => s + area(c), 0);
    expect(total).toBeLessThan(200 * 200);
    expect(total).toBeGreaterThan(200 * 200 * 0.85);
  });

  it('never shrinks a tiny cell past a hairline for the gap', () => {
    const cells = squarify(items([1000, 1]), 100, 100, 8);
    for (const c of cells) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  });

  it('drops items with nothing in them and copes with no room', () => {
    expect(squarify(items([0, -2, Number.NaN]), 100, 100)).toEqual([]);
    expect(squarify(items([3, 2]), 0, 100)).toEqual([]);
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify(items([5]), 80, 40)).toEqual([
      { id: 'a0', label: 'App 0', value: 5, x: 0, y: 0, w: 80, h: 40 },
    ]);
  });
});

describe('foldTail', () => {
  it('keeps what fits, and folds the rest into one cell with their sum', () => {
    const out = foldTail(items([10, 9, 8, 7, 6, 5]), 4, (n) => `${n} more`);
    expect(out.map((i) => i.id)).toEqual(['a0', 'a1', 'a2', '__other']);
    expect(out[3]).toEqual({ id: '__other', label: '3 more', value: 18 });
  });

  it('changes nothing when it already fits', () => {
    const out = foldTail(items([3, 2, 1]), 5, (n) => `${n} more`);
    expect(out).toHaveLength(3);
  });

  it('drops empty items before it counts', () => {
    expect(foldTail(items([3, 0, 1]), 5, (n) => `${n}`)).toHaveLength(2);
  });
});

describe('fitsLabel', () => {
  it('asks for room for a name and a count', () => {
    expect(fitsLabel({ w: 80, h: 40 })).toBe(true);
    expect(fitsLabel({ w: 40, h: 40 })).toBe(false);
    expect(fitsLabel({ w: 80, h: 20 })).toBe(false);
  });
});

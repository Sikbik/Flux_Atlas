import { describe, expect, it } from 'vitest';
import { BOX, buildCurve, curvePaths, readingAt, yDomain } from './curve';

const M = 60_000;
const T0 = 1_790_816_000_000;
const ts = (n: number) => Array.from({ length: n }, (_, i) => T0 + i * M);

describe('buildCurve', () => {
  it('drops buckets before the first recording', () => {
    const c = buildCurve({
      t: ts(5),
      nodes: [null, null, 100, 110, 105],
      tip: [null, null, 5000, 5002, 5004],
    });
    expect(c).not.toBeNull();
    expect(c!.first).toBe(T0 + 2 * M);
    expect(c!.t.length).toBe(3);
    expect(c!.min).toBe(100);
    expect(c!.max).toBe(110);
  });

  it('keeps holes in the middle as unknown', () => {
    const c = buildCurve({ t: ts(5), nodes: [100, null, null, 120, 121], tip: [1, null, null, 4, 5] });
    expect(c!.nodes).toEqual([100, null, null, 120, 121]);
  });

  it('needs at least two known points', () => {
    expect(buildCurve({ t: ts(3), nodes: [null, 5, null], tip: [null, 1, null] })).toBeNull();
    expect(buildCurve({ t: [], nodes: [], tip: [] })).toBeNull();
  });

  it('treats non-finite values as unknown', () => {
    const c = buildCurve({
      t: ts(4),
      nodes: [1, Number.NaN, 3, 4],
      tip: [1, 2, 3, Number.POSITIVE_INFINITY],
    });
    expect(c!.nodes).toEqual([1, null, 3, 4]);
    expect(c!.tip).toEqual([1, 2, 3, null]);
  });
});

describe('yDomain', () => {
  it('lets a moving count fill most of the height with some air around it', () => {
    const [lo, hi] = yDomain(6713, 6730);
    expect(lo).toBeLessThan(6713);
    expect(hi).toBeGreaterThan(6730);
    // The data covers at least half of the drawn range.
    expect((6730 - 6713) / (hi - lo)).toBeGreaterThan(0.5);
  });

  it('stays close to the data for a large move', () => {
    const [lo, hi] = yDomain(3000, 6700);
    expect(lo).toBeLessThan(3000);
    expect(lo).toBeGreaterThan(2000);
    expect(hi).toBeGreaterThan(6700);
    expect(hi).toBeLessThan(7500);
  });

  it('gives a constant series a small window around its level', () => {
    const [lo, hi] = yDomain(500, 500);
    expect(hi).toBeGreaterThan(lo);
    expect((lo + hi) / 2).toBe(500);
  });
});

describe('curvePaths', () => {
  const c = buildCurve({ t: ts(4), nodes: [100, 110, 105, 120], tip: [1, 2, 3, 4] })!;

  it('spans the time range left to right', () => {
    const p = curvePaths(c, T0, T0 + 3 * M);
    expect(p.line.startsWith('M0 ')).toBe(true);
    expect(p.line).toContain(`L${BOX.w} `);
    expect(p.area.endsWith('Z')).toBe(true);
  });

  it('breaks the line at an unknown bucket and closes each piece of the area', () => {
    const gap = buildCurve({ t: ts(5), nodes: [100, 101, null, 103, 104], tip: [1, 2, 3, 4, 5] })!;
    const p = curvePaths(gap, T0, T0 + 4 * M);
    expect(p.line.match(/M/g)).toHaveLength(2);
    expect(p.area.match(/Z/g)).toHaveLength(2);
  });

  it('draws higher counts higher (smaller y)', () => {
    const p = curvePaths(c, T0, T0 + 3 * M);
    const ys = [...p.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[3]!).toBeLessThan(ys[0]!); // 120 above 100
    expect(ys[1]!).toBeLessThan(ys[0]!); // 110 above 100
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(BOX.h);
    }
  });

  it('skips buckets outside the range', () => {
    const p = curvePaths(c, T0 + M, T0 + 2 * M);
    expect(p.line.match(/[ML]/g)).toHaveLength(2);
  });

  it('is empty when nothing falls in range', () => {
    expect(curvePaths(c, T0 + 10 * M, T0 + 20 * M)).toEqual({ line: '', area: '' });
  });
});

describe('readingAt', () => {
  const c = buildCurve({ t: ts(5), nodes: [100, 101, null, 103, 104], tip: [10, 11, 12, 13, 14] })!;

  it('reads the bucket at or before the instant', () => {
    expect(readingAt(c, T0 + 30_000)).toEqual({ at: T0, nodes: 100, tip: 10 });
    expect(readingAt(c, T0 + M)).toEqual({ at: T0 + M, nodes: 101, tip: 11 });
    expect(readingAt(c, T0 + 10 * M)).toEqual({ at: T0 + 4 * M, nodes: 104, tip: 14 });
  });

  it('carries the last known count across a short hole and keeps the tip of its own bucket', () => {
    const r = readingAt(c, T0 + 2 * M + 1000);
    expect(r.nodes).toBe(101);
    expect(r.tip).toBe(12);
  });

  it('is unknown before the first recording', () => {
    expect(readingAt(c, T0 - 1)).toEqual({ at: null, nodes: null, tip: null });
  });
});

import { describe, expect, it } from 'vitest';
import {
  areaPath,
  barMetrics,
  barsPath,
  describeSeries,
  detectTransition,
  extentOf,
  finiteCount,
  framePaths,
  isEmpty,
  isFlat,
  layoutBars,
  layoutPoints,
  lerpDomain,
  linePath,
  resolveDomain,
  type Sample,
  SPARK_PRESETS,
  sameSamples,
  sparkBox,
  splitRuns,
  staticFrame,
  transitionFrame,
  xAt,
  yAt,
} from './sparkline';

const BOX = sparkBox(64, 26, 'line', true);

describe('sparkBox', () => {
  it('reserves room for the 8 px end dot and its ring', () => {
    expect(BOX).toEqual({ width: 64, height: 26, padLeft: 2, padRight: 5, padTop: 5, padBottom: 5 });
  });

  it('shrinks the insets without a dot and for bars', () => {
    expect(sparkBox(64, 26, 'line', false).padRight).toBe(2);
    expect(sparkBox(64, 26, 'bars', true)).toMatchObject({ padLeft: 0, padRight: 0, padBottom: 0 });
  });

  it('keeps the two documented presets', () => {
    expect(SPARK_PRESETS.tile).toEqual({ width: 64, height: 26 });
    expect(SPARK_PRESETS.card).toEqual({ width: 120, height: 34 });
  });
});

describe('extent, emptiness and flatness', () => {
  it('ignores nulls and non-finite samples', () => {
    expect(extentOf([3, null, 1, Number.NaN, 7])).toEqual([1, 7]);
    expect(extentOf([null, null])).toBeNull();
    expect(finiteCount([1, null, 2, Number.POSITIVE_INFINITY])).toBe(2);
  });

  it('is empty without a finite sample', () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty([null, null])).toBe(true);
    expect(isEmpty([null, 0])).toBe(false);
  });

  it('is flat when at least two samples exist and none differ', () => {
    expect(isFlat([5, 5, 5])).toBe(true);
    expect(isFlat([5, null, 5])).toBe(true);
    expect(isFlat([5])).toBe(false);
    expect(isFlat([5, 6])).toBe(false);
    expect(isFlat([])).toBe(false);
  });
});

describe('resolveDomain', () => {
  it('uses the data extent for lines', () => {
    expect(resolveDomain([2, 9, 4], 'line')).toEqual([2, 9]);
  });

  it('centres a flat line by widening the domain around it', () => {
    const [lo, hi] = resolveDomain([10, 10, 10], 'line');
    expect(lo).toBeLessThan(10);
    expect(hi).toBeGreaterThan(10);
    expect((lo + hi) / 2).toBe(10);
    expect(resolveDomain([0, 0], 'line')).toEqual([-1, 1]);
  });

  it('grows bars from zero so their length stays honest', () => {
    expect(resolveDomain([5, 9, 7], 'bars')).toEqual([0, 9]);
    expect(resolveDomain([-4, -1], 'bars')).toEqual([-4, 0]);
    expect(resolveDomain([-3, 6], 'bars')).toEqual([-3, 6]);
  });

  it('draws flat bars at half height', () => {
    expect(resolveDomain([4, 4, 4], 'bars')).toEqual([0, 8]);
    expect(resolveDomain([0, 0], 'bars')).toEqual([0, 1]);
  });

  it('lets an explicit domain win, widening a degenerate one and fixing an inverted one', () => {
    expect(resolveDomain([1, 2], 'line', [0, 100])).toEqual([0, 100]);
    expect(resolveDomain([1, 2], 'line', [5, 5])).toEqual([4, 6]);
    expect(resolveDomain([1, 2], 'line', [10, 0])).toEqual([0, 10]);
    expect(resolveDomain([], 'line')).toEqual([0, 1]);
  });

  it('interpolates between domains', () => {
    expect(lerpDomain([0, 10], [10, 30], 0)).toEqual([0, 10]);
    expect(lerpDomain([0, 10], [10, 30], 0.5)).toEqual([5, 20]);
    expect(lerpDomain([0, 10], [10, 30], 1)).toEqual([10, 30]);
  });
});

describe('scaling', () => {
  it('spreads samples across the box, first at the left inset and last at the right inset', () => {
    expect(xAt(0, 5, BOX)).toBe(2);
    expect(xAt(4, 5, BOX)).toBe(59);
    expect(xAt(2, 5, BOX)).toBeCloseTo(30.5, 5);
  });

  it('puts a lone sample at the right edge', () => {
    expect(xAt(0, 1, BOX)).toBe(59);
  });

  it('maps larger values higher (smaller y) inside the insets', () => {
    expect(yAt(0, [0, 10], BOX)).toBe(21);
    expect(yAt(10, [0, 10], BOX)).toBe(5);
    expect(yAt(5, [0, 10], BOX)).toBe(13);
  });

  it('lays out a point per finite sample and null for gaps', () => {
    const pts = layoutPoints([1, null, 3], [1, 3], BOX);
    expect(pts[0]).toEqual({ x: 2, y: 21 });
    expect(pts[1]).toBeNull();
    expect(pts[2]).toEqual({ x: 59, y: 5 });
  });
});

describe('paths', () => {
  const p = (x: number, y: number) => ({ x, y });

  it('splits runs at gaps', () => {
    expect(splitRuns([p(0, 0), p(1, 1), null, p(3, 3), null, null, p(6, 6)]).map((r) => r.length)).toEqual([
      2, 1, 1,
    ]);
    expect(splitRuns([null, null])).toEqual([]);
  });

  it('builds a polyline per run', () => {
    expect(linePath([p(0, 10), p(5, 4), p(10, 8)])).toBe('M0 10L5 4L10 8');
  });

  it('breaks the line at a gap with a new subpath', () => {
    expect(linePath([p(0, 10), p(5, 4), null, p(15, 2), p(20, 3)])).toBe('M0 10L5 4M15 2L20 3');
  });

  it('draws a lone sample as a zero-length stroke so round caps render a dot', () => {
    expect(linePath([null, p(5, 5), null])).toBe('M5 5L5 5');
  });

  it('is empty for no points', () => {
    expect(linePath([])).toBe('');
    expect(linePath([null, null])).toBe('');
  });

  it('closes the area to the baseline per run and skips single samples', () => {
    expect(areaPath([p(0, 10), p(10, 4)], 26)).toBe('M0 26L0 10L10 4L10 26Z');
    expect(areaPath([p(0, 10), null, p(10, 4)], 26)).toBe('');
    expect(areaPath([p(0, 10), p(5, 8), null, p(10, 4), p(15, 5)], 26)).toBe(
      'M0 26L0 10L5 8L5 26ZM10 26L10 4L15 5L15 26Z',
    );
  });
});

describe('bars', () => {
  const box = sparkBox(64, 26, 'bars', true);

  it('keeps a 2 px gap while bars stay at least 3 px thick', () => {
    const m = barMetrics(12, box);
    expect(m.slot).toBeCloseTo(64 / 12, 5);
    expect(m.width).toBeCloseTo(64 / 12 - 2, 5);
  });

  it('tightens the gap for dense bars and never goes below one pixel of bar', () => {
    const dense = barMetrics(30, box);
    expect(dense.width).toBeGreaterThanOrEqual(1);
    expect(dense.width).toBeLessThanOrEqual(dense.slot);
    expect(barMetrics(200, box).width).toBe(1);
  });

  it('caps thickness at 24 px', () => {
    expect(barMetrics(2, sparkBox(400, 34, 'bars', false)).width).toBe(24);
  });

  it('draws bars from the baseline upward and leaves a stub for the smallest value', () => {
    const rects = layoutBars([0, 5, 10], [0, 10], box);
    expect(rects[2]?.y).toBe(1);
    expect((rects[2]?.y ?? 0) + (rects[2]?.h ?? 0)).toBe(26);
    expect(rects[0]?.h).toBe(2);
    expect(rects[1]?.h).toBeCloseTo(12.5, 5);
  });

  it('skips gaps and hangs negative bars below the zero line', () => {
    const rects = layoutBars([null, 4, -4], [-4, 4], box);
    expect(rects[0]).toBeNull();
    const up = rects[1];
    const down = rects[2];
    expect(up).toBeDefined();
    expect(down?.down).toBe(true);
    expect(down?.y).toBeCloseTo((up?.y ?? 0) + (up?.h ?? 0), 5);
  });

  it('rounds the data end and keeps the baseline end square', () => {
    const d = barsPath([{ x: 0, y: 4, w: 6, h: 10 }]);
    expect(d).toBe('M0 14V6Q0 4 2 4H4Q6 4 6 6V14Z');
    const down = barsPath([{ x: 0, y: 10, w: 6, h: 6, down: true }]);
    expect(down).toBe('M0 10V14Q0 16 2 16H4Q6 16 6 14V10Z');
  });

  it('never rounds more than the bar allows', () => {
    const d = barsPath([{ x: 0, y: 10, w: 2, h: 1 }]);
    expect(d).toContain('Q0 10 1 10');
  });
});

describe('detectTransition', () => {
  it('recognises a window that shifted by one', () => {
    expect(detectTransition([1, 2, 3], [2, 3, 4])).toBe('shift');
    expect(detectTransition([1, null, 3], [null, 3, 4])).toBe('shift');
  });

  it('recognises a series that grew by one', () => {
    expect(detectTransition([1, 2, 3], [1, 2, 3, 4])).toBe('grow');
    expect(detectTransition([7], [7, 8])).toBe('grow');
  });

  it('does not animate unchanged, replaced, empty or multi-sample updates', () => {
    expect(detectTransition([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(detectTransition([1, 2, 3], [9, 8, 7])).toBeNull();
    expect(detectTransition([], [1])).toBeNull();
    expect(detectTransition([1, 2, 3], [1, 2, 3, 4, 5])).toBeNull();
    expect(detectTransition([1, 2, 3], [2, 3])).toBeNull();
    expect(detectTransition([1, 2, 3], [1, 2, 4, 5])).toBeNull();
  });

  it('compares samples by value', () => {
    expect(sameSamples([1, null], [1, null])).toBe(true);
    expect(sameSamples([1, null], [1, 0])).toBe(false);
    const a: Sample[] = [1, 2];
    expect(sameSamples(a, a)).toBe(true);
  });
});

describe('transitionFrame', () => {
  const prev = [10, 12, 11, 14];
  const next = [12, 11, 14, 18];
  const base = { kind: 'shift' as const, prev, next, form: 'line' as const, box: BOX };

  it('ends exactly on the settled layout', () => {
    const end = transitionFrame({ ...base, reveal: 1, domain: 1 });
    const settled = staticFrame(next, 'line', BOX);
    expect(end.points.length).toBe(settled.points.length);
    end.points.forEach((p, i) => {
      expect(p?.x).toBeCloseTo(settled.points[i]?.x ?? Number.NaN, 5);
      expect(p?.y).toBeCloseTo(settled.points[i]?.y ?? Number.NaN, 5);
    });
    expect(end.dot?.x).toBeCloseTo(settled.dot?.x ?? Number.NaN, 5);
    expect(end.dot?.y).toBeCloseTo(settled.dot?.y ?? Number.NaN, 5);
  });

  it('starts with the old samples where they were and the new one beyond the right edge', () => {
    const start = transitionFrame({ ...base, reveal: 0, domain: 0 });
    const oldLayout = staticFrame(prev, 'line', BOX);
    // New index i is old index i + 1: same x as before the shift.
    for (let i = 0; i < next.length - 1; i++) {
      expect(start.points[i]?.x).toBeCloseTo(oldLayout.points[i + 1]?.x ?? Number.NaN, 5);
    }
    const edge = BOX.width - BOX.padRight;
    expect(start.points[next.length - 1]?.x).toBeGreaterThan(edge);
  });

  it('keeps the end dot on the right edge and rides it along the new segment', () => {
    const edge = BOX.width - BOX.padRight;
    const start = transitionFrame({ ...base, reveal: 0, domain: 1 });
    const mid = transitionFrame({ ...base, reveal: 0.5, domain: 1 });
    const end = transitionFrame({ ...base, reveal: 1, domain: 1 });
    for (const f of [start, mid, end]) expect(f.dot?.x).toBeCloseTo(edge, 5);
    const settled = staticFrame(next, 'line', BOX, undefined);
    const lastY = settled.points[next.length - 1]?.y ?? 0;
    const beforeY = settled.points[next.length - 2]?.y ?? 0;
    // 14 -> 18 is rising, so the dot climbs (y decreases) from the old last height to the new one.
    expect(start.dot?.y ?? 0).toBeGreaterThan(mid.dot?.y ?? 0);
    expect(mid.dot?.y ?? 0).toBeGreaterThan(end.dot?.y ?? 0);
    expect(end.dot?.y).toBeCloseTo(lastY, 5);
    expect(start.dot?.y).toBeCloseTo(beforeY, 5);
  });

  it('eases the domain independently of the reveal', () => {
    const early = transitionFrame({ ...base, reveal: 1, domain: 0 });
    const late = transitionFrame({ ...base, reveal: 1, domain: 1 });
    expect(early.domain).toEqual([10, 14]);
    expect(late.domain).toEqual([11, 18]);
  });

  it('handles growth: old samples compress while the new one enters', () => {
    const grow = { ...base, kind: 'grow' as const, prev: [1, 2, 3], next: [1, 2, 3, 4] };
    const start = transitionFrame({ ...grow, reveal: 0, domain: 0 });
    const old = staticFrame([1, 2, 3], 'line', BOX);
    for (let i = 0; i < 3; i++) expect(start.points[i]?.x).toBeCloseTo(old.points[i]?.x ?? Number.NaN, 5);
    const end = transitionFrame({ ...grow, reveal: 1, domain: 1 });
    const settled = staticFrame([1, 2, 3, 4], 'line', BOX);
    for (let i = 0; i < 4; i++) expect(end.points[i]?.x).toBeCloseTo(settled.points[i]?.x ?? Number.NaN, 5);
  });

  it('animates bars the same way and has no dot', () => {
    const bbox = sparkBox(64, 26, 'bars', true);
    const f = transitionFrame({
      kind: 'shift',
      prev: [1, 2, 3],
      next: [2, 3, 4],
      form: 'bars',
      box: bbox,
      reveal: 0,
      domain: 1,
    });
    expect(f.dot).toBeNull();
    expect(f.rects).toHaveLength(3);
    const settled = staticFrame([2, 3, 4], 'bars', bbox);
    const slot = barMetrics(3, bbox).slot;
    expect(f.rects[0]?.x).toBeCloseTo((settled.rects[0]?.x ?? 0) + slot, 5);
    const end = transitionFrame({
      kind: 'shift',
      prev: [1, 2, 3],
      next: [2, 3, 4],
      form: 'bars',
      box: bbox,
      reveal: 1,
      domain: 1,
    });
    expect(end.rects[0]?.x).toBeCloseTo(settled.rects[0]?.x ?? Number.NaN, 5);
  });
});

describe('framePaths', () => {
  it('produces line and area for a line frame and splits the last bar for emphasis', () => {
    const f = staticFrame([1, 3, 2], 'area', BOX);
    const paths = framePaths(f, BOX);
    expect(paths.line.startsWith('M')).toBe(true);
    expect(paths.area.endsWith('Z')).toBe(true);
    expect(paths.bars).toBe('');

    const bbox = sparkBox(64, 26, 'bars', false);
    const b = framePaths(staticFrame([1, 3, 2], 'bars', bbox), bbox);
    expect(b.bars).not.toBe('');
    expect(b.barLast).not.toBe('');
    expect(b.line).toBe('');
  });
});

describe('describeSeries', () => {
  it('matches the documented wording', () => {
    const v = [0.0718, 0.0722, 0.0731, 0.0728, 0.0735, 0.0746];
    expect(describeSeries(v)).toBe('Trend over 6 samples, from 0.0718 to 0.0746, up 3.9 percent');
  });

  it('reads down moves and uses the caller format', () => {
    expect(describeSeries([200, 150], { format: (n) => `${n} nodes` })).toBe(
      'Trend over 2 samples, from 200 nodes to 150 nodes, down 25.0 percent',
    );
  });

  it('reads flat series and tiny moves as flat', () => {
    expect(describeSeries([6727, 6727, 6727])).toBe('Trend over 3 samples, flat at 6,727');
    expect(describeSeries([100000, 100000.01])).toBe('Trend over 2 samples, flat at 100,000');
  });

  it('counts missing samples and handles one sample and none', () => {
    expect(describeSeries([1, null, 2])).toBe(
      'Trend over 2 samples, from 1 to 2, up 100.0 percent, 1 missing',
    );
    expect(describeSeries([null, 4])).toBe('One sample: 4, 1 missing');
    expect(describeSeries([])).toBe('No data');
    expect(describeSeries([null, null])).toBe('No data');
  });

  it('does not divide by a zero start', () => {
    expect(describeSeries([0, 5])).toBe('Trend over 2 samples, from 0 to 5, up');
  });
});

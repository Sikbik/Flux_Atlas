import { describe, expect, it } from 'vitest';
import {
  firstFiniteIndex,
  formatXTick,
  isEmptyData,
  lastFiniteIndex,
  legendNext,
  MAX_SERIES,
  markerIndices,
  nearestIndex,
  padRange,
  placeTip,
  pointAnnouncement,
  prepareData,
  rangeOf,
  type SeriesInput,
  SLOT_COLORS,
  sameData,
  slotColor,
  stepIndex,
  summarize,
  tableRows,
  toAligned,
  valueFormatter,
} from './timeSeries';

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
const HOUR = 3_600_000;
const t = [T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR];

describe('slot colours', () => {
  it('are the six validated categorical tokens in fixed order', () => {
    expect(SLOT_COLORS).toEqual([
      'var(--viz-1)',
      'var(--viz-2)',
      'var(--viz-3)',
      'var(--viz-4)',
      'var(--viz-5)',
      'var(--viz-6)',
    ]);
    expect(MAX_SERIES).toBe(6);
  });

  it('never cycles: a slot past the sixth stays on the sixth', () => {
    expect(slotColor(0)).toBe('var(--viz-1)');
    expect(slotColor(5)).toBe('var(--viz-6)');
    expect(slotColor(9)).toBe('var(--viz-6)');
    expect(slotColor(-1)).toBe('var(--viz-1)');
  });
});

describe('prepareData', () => {
  const one: SeriesInput[] = [{ key: 'a', label: 'A', values: [1, 2, 3, 4] }];

  it('assigns slot colours by position and keeps an explicit colour', () => {
    const p = prepareData(t, [
      { key: 'a', label: 'A', values: [1, 2, 3, 4] },
      { key: 'b', label: 'B', values: [1, 2, 3, 4], color: 'var(--tier-cumulus-ink)' },
      { key: 'c', label: 'C', values: [1, 2, 3, 4] },
    ]);
    expect(p.series.map((s) => s.color)).toEqual(['var(--viz-1)', 'var(--tier-cumulus-ink)', 'var(--viz-3)']);
  });

  it('keeps at most six series and counts the dropped ones', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      key: `s${i}`,
      label: `S${i}`,
      values: [1, 2, 3, 4],
    }));
    const p = prepareData(t, many);
    expect(p.series).toHaveLength(6);
    expect(p.dropped).toBe(2);
    expect(p.series[5]?.key).toBe('s5');
  });

  it('pads short series with gaps, cuts long ones and turns non-finite values into gaps', () => {
    const p = prepareData(t, [
      { key: 'short', label: 'Short', values: [1, 2] },
      { key: 'long', label: 'Long', values: [1, 2, 3, 4, 5, 6] },
      { key: 'bad', label: 'Bad', values: [1, Number.NaN, Number.POSITIVE_INFINITY, 4] },
    ]);
    expect(p.series[0]?.values).toEqual([1, 2, null, null]);
    expect(p.series[1]?.values).toEqual([1, 2, 3, 4]);
    expect(p.series[2]?.values).toEqual([1, null, null, 4]);
  });

  it('drops the oldest points beyond maxPoints', () => {
    const p = prepareData(t, one, 2);
    expect(p.t).toEqual([t[2], t[3]]);
    expect(p.series[0]?.values).toEqual([3, 4]);
    expect(prepareData(t, one, 10).t).toHaveLength(4);
    expect(prepareData(t, one, 0).t).toHaveLength(4);
  });

  it('is the identity for data that already fits', () => {
    const p = prepareData(t, one);
    expect(p.t).toEqual(t);
    expect(p.dropped).toBe(0);
  });
});

describe('isEmptyData and sameData', () => {
  it('is empty without timestamps or without any finite value', () => {
    expect(isEmptyData(prepareData([], [{ key: 'a', label: 'A', values: [] }]))).toBe(true);
    expect(isEmptyData(prepareData(t, [{ key: 'a', label: 'A', values: [null, null, null, null] }]))).toBe(
      true,
    );
    expect(isEmptyData(prepareData(t, [{ key: 'a', label: 'A', values: [null, 0, null, null] }]))).toBe(
      false,
    );
    expect(isEmptyData(prepareData(t, []))).toBe(true);
  });

  it('compares by value so an unchanged refetch does not redraw', () => {
    const a = prepareData(t, [{ key: 'a', label: 'A', values: [1, 2, 3, 4] }]);
    const b = prepareData(t, [{ key: 'a', label: 'A', values: [1, 2, 3, 4] }]);
    const c = prepareData(t, [{ key: 'a', label: 'A', values: [1, 2, 3, 5] }]);
    expect(sameData(a, b)).toBe(true);
    expect(sameData(a, c)).toBe(false);
    expect(sameData(a, null)).toBe(false);
    expect(sameData(null, null)).toBe(true);
    const d = prepareData(t, [{ key: 'z', label: 'A', values: [1, 2, 3, 4] }]);
    expect(sameData(a, d)).toBe(false);
  });
});

describe('toAligned', () => {
  it('converts the x column to seconds and keeps series in order', () => {
    const p = prepareData(t, [
      { key: 'a', label: 'A', values: [1, null, 3, 4] },
      { key: 'b', label: 'B', values: [5, 6, 7, 8] },
    ]);
    const [x, a, b] = toAligned(p);
    expect(x[0]).toBe(T0 / 1000);
    expect(x[1]).toBe(T0 / 1000 + 3600);
    expect(a).toEqual([1, null, 3, 4]);
    expect(b).toEqual([5, 6, 7, 8]);
  });
});

describe('finite helpers', () => {
  it('finds the first and last finite value and the range', () => {
    expect(firstFiniteIndex([null, null, 4, 5, null])).toBe(2);
    expect(lastFiniteIndex([null, null, 4, 5, null])).toBe(3);
    expect(firstFiniteIndex([null])).toBe(-1);
    expect(lastFiniteIndex([])).toBe(-1);
    expect(rangeOf([3, null, -1, 8])).toEqual([-1, 8]);
    expect(rangeOf([null])).toBeNull();
  });
});

describe('markerIndices', () => {
  it('marks the newest value and isolated values between gaps', () => {
    expect(markerIndices([1, 2, 3, 4])).toEqual([3]);
    expect(markerIndices([1, null, 3, null, 5, 6])).toEqual([0, 2, 5]);
    expect(markerIndices([null, 2, null])).toEqual([1]);
    expect(markerIndices([1, 2, null, null])).toEqual([1]);
    expect(markerIndices([null, null])).toEqual([]);
    expect(markerIndices([])).toEqual([]);
  });
});

describe('padRange', () => {
  it('adds headroom on both sides', () => {
    const [lo, hi] = padRange(6600, 6700);
    expect(lo).toBeCloseTo(6592, 5);
    expect(hi).toBeCloseTo(6708, 5);
  });

  it('never dips below zero for non-negative data', () => {
    expect(padRange(0, 10)[0]).toBe(0);
    expect(padRange(1, 100)[0]).toBe(0);
    expect(padRange(-5, 5)[0]).toBeLessThan(-5);
  });

  it('centres a flat series', () => {
    const [lo, hi] = padRange(40, 40);
    expect(lo).toBeLessThan(40);
    expect(hi).toBeGreaterThan(40);
    expect(padRange(0, 0)).toEqual([0, 1]);
  });

  it('honours fixed bounds and lets the other side float', () => {
    expect(padRange(5, 10, [0, 100])).toEqual([0, 100]);
    const [lo, hi] = padRange(5, 10, [0, null]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(10);
    expect(padRange(5, 10, [8, 8])).toEqual([8, 9]);
  });

  it('falls back to a unit range for non-finite input', () => {
    expect(padRange(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toEqual([0, 1.08]);
  });
});

describe('formatXTick', () => {
  it('shows seconds on a very short span', () => {
    expect(formatXTick(Date.UTC(2026, 8, 30, 12, 5, 9), 60_000)).toBe('12:05:09');
  });

  it('shows hours and minutes up to two days and the date at midnight', () => {
    expect(formatXTick(Date.UTC(2026, 8, 30, 14, 30), 24 * HOUR)).toBe('14:30');
    expect(formatXTick(Date.UTC(2026, 9, 1, 0, 0), 24 * HOUR)).toBe('Oct 1');
    expect(formatXTick(Date.UTC(2026, 9, 1, 0, 0), 2 * HOUR)).toBe('00:00');
  });

  it('shows the date for weeks and month and year beyond three months', () => {
    expect(formatXTick(Date.UTC(2026, 8, 30), 7 * 24 * HOUR)).toBe('Sep 30');
    expect(formatXTick(Date.UTC(2026, 8, 30), 200 * 24 * HOUR)).toBe('Sep 2026');
  });
});

describe('text equivalents', () => {
  const p = prepareData(t, [{ key: 'n', label: 'Nodes', values: [6600, 6650, 6700, 6750] }]);
  const multi = prepareData(t, [
    { key: 'c', label: 'Cumulus', values: [10, 11, 12, 13] },
    { key: 'n', label: 'Nimbus', values: [20, null, 18, 16] },
  ]);

  it('summarises a single series in one sentence', () => {
    expect(summarize(p)).toBe(
      'Nodes, 4 points from 2026-09-30 12:00 UTC to 2026-09-30 15:00 UTC: from 6,600 to 6,750, up 2.3 percent; low 6,600, high 6,750.',
    );
  });

  it('summarises several series, each with its own trend', () => {
    const s = summarize(multi);
    expect(s).toContain('Cumulus and Nimbus, 4 points');
    expect(s).toContain('Cumulus from 10 to 13, up 30.0 percent (low 10, high 13)');
    expect(s).toContain('Nimbus from 20 to 16, down 20.0 percent (low 16, high 20)');
  });

  it('says so when there is no data', () => {
    expect(summarize(prepareData([], []))).toBe('No data for this range');
  });

  it('uses the caller formatters', () => {
    const s = summarize(p, { yFormat: (v) => `${v} nodes`, xFormat: (ms) => `T${ms}` });
    expect(s).toContain('from 6600 nodes to 6750 nodes');
    expect(s).toContain(`from T${T0} to T${t[3]}`);
  });

  it('announces a point with every series and Unknown for gaps', () => {
    expect(pointAnnouncement(multi, 1)).toBe('2026-09-30 13:00 UTC: Cumulus 11, Nimbus Unknown');
    expect(pointAnnouncement(multi, 1, {}, [true, false])).toBe('2026-09-30 13:00 UTC: Cumulus 11');
    expect(pointAnnouncement(multi, 99)).toBe('');
  });

  it('builds table rows with Unknown for gaps and a per-series format', () => {
    const fmtd = prepareData(t, [{ key: 'a', label: 'A', values: [1, null, 3, 4], format: (v) => `${v}!` }]);
    const rows = tableRows(fmtd);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ t: T0, time: '2026-09-30 12:00 UTC', cells: ['1!'] });
    expect(rows[1]?.cells).toEqual(['Unknown']);
  });

  it('keeps only the latest rows when the data is long', () => {
    const rows = tableRows(p, {}, 2);
    expect(rows.map((r) => r.t)).toEqual([t[2], t[3]]);
  });

  it('resolves value formatters: series, then chart, then significant digits', () => {
    const own = (v: number) => `own ${v}`;
    const chart = (v: number) => `chart ${v}`;
    expect(valueFormatter({ format: own }, { yFormat: chart })(1)).toBe('own 1');
    expect(valueFormatter({}, { yFormat: chart })(1)).toBe('chart 1');
    expect(valueFormatter({}, {})(0.07461)).toBe('0.0746');
  });
});

describe('legendNext', () => {
  const all = [true, true, true];

  it('isolates the clicked series, then shows all on a second click', () => {
    const one = legendNext(all, 1, false);
    expect(one).toEqual([false, true, false]);
    expect(legendNext(one, 1, false)).toEqual(all);
    expect(legendNext(one, 2, false)).toEqual([false, false, true]);
  });

  it('toggles one series on shift-click', () => {
    expect(legendNext(all, 0, true)).toEqual([false, true, true]);
    expect(legendNext([false, true, true], 0, true)).toEqual(all);
  });

  it('never hides the last visible series', () => {
    expect(legendNext([false, true, false], 1, true)).toEqual([false, true, false]);
  });

  it('ignores an index out of range', () => {
    expect(legendNext(all, 7, false)).toEqual(all);
  });
});

describe('stepIndex', () => {
  it('lands on the newest point first, then steps', () => {
    expect(stepIndex(null, 'ArrowLeft', false, 10)).toBe(9);
    expect(stepIndex(null, 'ArrowRight', false, 10)).toBe(9);
    expect(stepIndex(9, 'ArrowLeft', false, 10)).toBe(8);
    expect(stepIndex(3, 'ArrowRight', false, 10)).toBe(4);
  });

  it('clamps at the ends and jumps ten with shift', () => {
    expect(stepIndex(0, 'ArrowLeft', false, 10)).toBe(0);
    expect(stepIndex(9, 'ArrowRight', false, 10)).toBe(9);
    expect(stepIndex(25, 'ArrowLeft', true, 30)).toBe(15);
    expect(stepIndex(2, 'ArrowLeft', true, 30)).toBe(0);
  });

  it('goes to the ends with Home and End and ignores other keys', () => {
    expect(stepIndex(5, 'Home', false, 10)).toBe(0);
    expect(stepIndex(5, 'End', false, 10)).toBe(9);
    expect(stepIndex(5, 'a', false, 10)).toBeNull();
    expect(stepIndex(5, 'ArrowLeft', false, 0)).toBeNull();
  });
});

describe('placeTip', () => {
  const tip = { width: 160, height: 60 };
  const plot = { width: 800, height: 200 };

  it('sits centred above the highest point', () => {
    const p = placeTip({ x: 400, top: 120, bottom: 120, tip, plot });
    expect(p).toEqual({ x: 320, y: 46, side: 'above' });
  });

  it('flips below the lowest point when there is no room above', () => {
    const p = placeTip({ x: 400, top: 30, bottom: 80, tip, plot });
    expect(p).toEqual({ x: 320, y: 94, side: 'below' });
  });

  it('stays inside the plot horizontally', () => {
    expect(placeTip({ x: 10, top: 150, bottom: 150, tip, plot }).x).toBe(0);
    expect(placeTip({ x: 790, top: 150, bottom: 150, tip, plot }).x).toBe(640);
  });

  it('stands beside the crosshair when there is no room above or below', () => {
    const tall = { width: 160, height: 120 };
    const right = placeTip({ x: 300, top: 60, bottom: 150, tip: tall, plot });
    expect(right.side).toBe('right');
    expect(right.x).toBe(316);
    expect(right.y).toBe(45);
    const left = placeTip({ x: 780, top: 60, bottom: 150, tip: tall, plot });
    expect(left.side).toBe('left');
    expect(left.x).toBe(780 - 16 - 160);
    expect(left.y + tall.height).toBeLessThanOrEqual(plot.height);
  });

  it('centres vertically when there are no points', () => {
    expect(placeTip({ x: 400, top: null, bottom: null, tip, plot }).y).toBe(70);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 30, 40];

  it('finds the nearest timestamp', () => {
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 100)).toBe(4);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex([7], 100)).toBe(0);
  });
});

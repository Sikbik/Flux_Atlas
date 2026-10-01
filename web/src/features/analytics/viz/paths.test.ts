import { describe, expect, it } from 'vitest';
import { areaPath, bandPath, cornersPath, isolated, linePath, runs } from './paths';

describe('runs', () => {
  it('finds the stretches of known values', () => {
    expect(runs([1, 2, null, 3, null, null, 4, 5, 6])).toEqual([
      [0, 1],
      [3, 3],
      [6, 8],
    ]);
  });
  it('treats NaN and undefined as unknown', () => {
    expect(runs([Number.NaN, 1, undefined, 2])).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });
  it('is empty for nothing known', () => {
    expect(runs([])).toEqual([]);
    expect(runs([null, null])).toEqual([]);
  });
  it('also ends a stretch where the history has a hole: every value known, the pen still lifts', () => {
    expect(runs([1, 2, 3, 4, 5], [false, false, false, true, false])).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });
  it('lets a hole and an unknown value meet, and a hole before the first value, without a stray run', () => {
    expect(runs([1, null, 3, 4], [false, false, true, false])).toEqual([
      [0, 0],
      [2, 3],
    ]);
    expect(runs([null, 2, 3], [false, true, false])).toEqual([[1, 2]]);
    expect(runs([1, 2], [true, true])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('isolated', () => {
  it('finds a known value between gaps', () => {
    expect(isolated([1, null, 2, null, 3, 4])).toEqual([0, 2]);
  });
  it('is not a lone point when it is the only value there is', () => {
    expect(isolated([5])).toEqual([]);
  });
  it('finds a value a hole cuts off on both sides', () => {
    expect(isolated([1, 2, 3, 4, 5], [false, false, true, true, false])).toEqual([2]);
  });
});

describe('linePath', () => {
  it('joins known points', () => {
    expect(linePath([0, 10, 20], [5, 6, 7])).toBe('M0 5L10 6L20 7');
  });
  it('lifts the pen at a gap instead of drawing through it', () => {
    expect(linePath([0, 10, 20, 30, 40], [1, 2, null, 4, 5])).toBe('M0 1L10 2M30 4L40 5');
  });
  it('draws nothing for a lone point or for nothing', () => {
    expect(linePath([0, 10, 20], [null, 2, null])).toBe('');
    expect(linePath([], [])).toBe('');
  });
  it('rounds to two decimals', () => {
    expect(linePath([0.123456, 10.987654], [1.234, 2.5])).toBe('M0.12 1.23L10.99 2.5');
  });
  it('lifts the pen across a hole in the history', () => {
    expect(linePath([0, 10, 20, 30, 40], [1, 2, 3, 4, 5], [false, false, false, true, false])).toBe(
      'M0 1L10 2L20 3M30 4L40 5',
    );
  });
  it('draws no line for a value alone between two holes', () => {
    expect(linePath([0, 10, 20], [1, 2, 3], [false, true, true])).toBe('');
  });
});

describe('areaPath', () => {
  it('closes each run down to the baseline', () => {
    expect(areaPath([0, 10, 20], [5, 6, 7], 100)).toBe('M0 5L10 6L20 7L20 100L0 100Z');
  });
  it('closes the runs of a gappy series separately', () => {
    expect(areaPath([0, 10, 20, 30], [1, 2, null, 4], 9)).toBe('M0 1L10 2L10 9L0 9Z');
  });
  it('closes the two sides of a hole in the history separately', () => {
    expect(areaPath([0, 10, 20, 30], [1, 2, 3, 4], 9, [false, false, true, false])).toBe(
      'M0 1L10 2L10 9L0 9ZM20 3L30 4L30 9L20 9Z',
    );
  });
});

describe('bandPath', () => {
  it('runs along the upper edge and back along the lower', () => {
    expect(bandPath([0, 10], [5, 6], [1, 2])).toBe('M0 1L10 2L10 6L0 5Z');
  });
  it('leaves out the buckets where either edge is unknown', () => {
    const d = bandPath([0, 10, 20, 30, 40], [5, 5, 5, null, 5], [1, 1, null, 1, 1]);
    expect(d).toBe('M0 1L10 1L10 5L0 5Z');
  });
  it('is empty with nothing between', () => {
    expect(bandPath([0, 10], [null, null], [1, 2])).toBe('');
  });
  it('breaks at a hole in the history', () => {
    const d = bandPath([0, 10, 20, 30], [5, 5, 5, 5], [1, 1, 1, 1], [false, false, true, false]);
    expect(d).toBe('M0 1L10 1L10 5L0 5ZM20 1L30 1L30 5L20 5Z');
  });
});

describe('cornersPath', () => {
  it('makes the vertical jump of a step from two corners at one x', () => {
    expect(
      cornersPath([
        { x: 0, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 40 },
        { x: 100, y: 40 },
      ]),
    ).toBe('M0 10L50 10L50 40L100 40');
  });
  it('is empty for no corners', () => {
    expect(cornersPath([])).toBe('');
  });
});

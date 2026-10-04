import { describe, expect, it } from 'vitest';
import { areaPath, linePath, seriesPoints } from './stackPath';

const DAY = 86_400_000;
const x = (ms: number) => ms / DAY; // a day is one pixel
const y = (v: number) => 100 - v; // up is smaller

describe('seriesPoints', () => {
  it('runs through the end of each day, from zero at the start', () => {
    const pts = seriesPoints('running', [0, DAY, 2 * DAY], [10, 25, 45], x, y);
    expect(pts).toEqual([
      { x: 0, y: 100 },
      { x: 1, y: 90 },
      { x: 2, y: 75 },
      { x: 3, y: 55 },
    ]);
  });

  it('holds each day at its level as steps', () => {
    const pts = seriesPoints('steps', [0, DAY], [30, 20], x, y);
    expect(pts).toEqual([
      { x: 0, y: 70 },
      { x: 1, y: 70 },
      { x: 1, y: 80 },
      { x: 2, y: 80 },
    ]);
  });

  it('draws nothing for no days', () => {
    expect(seriesPoints('running', [], [], x, y)).toEqual([]);
    expect(seriesPoints('steps', [], [], x, y)).toEqual([]);
  });
});

describe('linePath', () => {
  it('moves to the first point and lines to the rest', () => {
    expect(
      linePath([
        { x: 0, y: 1 },
        { x: 2.04, y: 3 },
      ]),
    ).toBe('M0 1L2 3');
    expect(linePath([])).toBe('');
  });
});

describe('areaPath', () => {
  const upper = [
    { x: 0, y: 10 },
    { x: 5, y: 20 },
  ];

  it('closes down to the baseline when there is no lower line', () => {
    expect(areaPath(upper, null, 100)).toBe('M0 10L5 20L5 100L0 100Z');
  });

  it('comes back along the lower line, reversed', () => {
    const lower = [
      { x: 0, y: 50 },
      { x: 5, y: 60 },
    ];
    expect(areaPath(upper, lower, 100)).toBe('M0 10L5 20L5 60L0 50Z');
  });

  it('is empty without an upper line', () => {
    expect(areaPath([], null, 100)).toBe('');
  });
});

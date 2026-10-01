import { describe, expect, it } from 'vitest';
import { isGroup, isoTime, relativeLabel, splitDateTime, threadStops } from './timeline';

const NOW = Date.UTC(2026, 8, 30, 19, 39, 4);

describe('relativeLabel', () => {
  it('reads a past event as an age', () => {
    expect(relativeLabel(NOW - 12_000, NOW)).toBe('12 s ago');
    expect(relativeLabel(NOW - 3 * 60_000, NOW)).toBe('3 min ago');
    expect(relativeLabel(NOW - 2 * 3_600_000, NOW)).toBe('2 h ago');
    expect(relativeLabel(NOW - 5 * 86_400_000, NOW)).toBe('5 d ago');
  });

  it('reads the present as now', () => {
    expect(relativeLabel(NOW, NOW)).toBe('now');
    expect(relativeLabel(NOW - 400, NOW)).toBe('now');
  });

  it('reads a projected event as an ETA', () => {
    expect(relativeLabel(NOW + 28_000, NOW)).toBe('in 28 s');
    expect(relativeLabel(NOW + 12 * 60_000, NOW)).toBe('in 12 min');
    expect(relativeLabel(NOW + 14.7 * 3_600_000, NOW)).toBe('in 14.7 h');
  });
});

describe('time formats', () => {
  it('gives an ISO instant', () => {
    expect(isoTime(NOW)).toBe('2026-09-30T19:39:04.000Z');
  });

  it('splits an absolute time for a narrow gutter', () => {
    expect(splitDateTime(NOW)).toEqual({ date: '2026-09-30', time: '19:39 UTC' });
  });
});

describe('isGroup', () => {
  it('is a run only from two up', () => {
    expect(isGroup(undefined)).toBe(false);
    expect(isGroup(0)).toBe(false);
    expect(isGroup(1)).toBe(false);
    expect(isGroup(2)).toBe(true);
    expect(isGroup(9)).toBe(true);
    expect(isGroup(Number.NaN)).toBe(false);
  });
});

describe('threadStops', () => {
  it('runs the thread from full accent at the top to none at the bottom', () => {
    expect(threadStops(0, 5)).toEqual({ from: 100, to: 75 });
    expect(threadStops(1, 5)).toEqual({ from: 75, to: 50 });
    expect(threadStops(3, 5)).toEqual({ from: 25, to: 0 });
  });

  it('joins up: every segment ends where the next begins', () => {
    const n = 7;
    for (let i = 0; i < n - 1; i++) {
      expect(threadStops(i, n).to).toBe(threadStops(i + 1, n).from);
    }
  });

  it('handles a single item', () => {
    expect(threadStops(0, 1)).toEqual({ from: 100, to: 100 });
    expect(threadStops(0, 0)).toEqual({ from: 100, to: 100 });
  });
});

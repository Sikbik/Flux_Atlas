import { describe, expect, it } from 'vitest';
import { computeWindow, rowsPerPage, scrollTopToReveal } from './windowing';

const base = { viewportHeight: 340, rowHeight: 34, rowCount: 10_000, overscan: 5 };

describe('computeWindow', () => {
  it('starts at the top with overscan below only', () => {
    const w = computeWindow({ ...base, scrollTop: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(15); // 10 visible + 5 overscan
    expect(w.offsetTop).toBe(0);
    expect(w.totalHeight).toBe(340_000);
  });

  it('adds overscan on both sides mid-list and offsets the first row', () => {
    const w = computeWindow({ ...base, scrollTop: 34 * 100 });
    expect(w.start).toBe(95);
    expect(w.end).toBe(115);
    expect(w.offsetTop).toBe(95 * 34);
  });

  it('includes a partially visible row at both edges', () => {
    const w = computeWindow({ ...base, overscan: 0, scrollTop: 17 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(11);
  });

  it('clamps at the end of the list', () => {
    const w = computeWindow({ ...base, scrollTop: 10_000_000 });
    expect(w.end).toBe(10_000);
    expect(w.start).toBe(10_000 - 10 - 5);
  });

  it('handles empty, tiny and garbage input', () => {
    expect(computeWindow({ ...base, rowCount: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
    const few = computeWindow({ ...base, rowCount: 3, scrollTop: 0 });
    expect([few.start, few.end]).toEqual([0, 3]);
    const bad = computeWindow({
      scrollTop: Number.NaN,
      viewportHeight: -5,
      rowHeight: 0,
      rowCount: 4,
      overscan: -1,
    });
    expect(bad.start).toBe(0);
    expect(bad.end).toBeGreaterThanOrEqual(0);
  });

  it('never renders more than viewport rows plus twice the overscan plus two', () => {
    for (let st = 0; st < 340_000; st += 977) {
      const w = computeWindow({ ...base, scrollTop: st });
      expect(w.end - w.start).toBeLessThanOrEqual(10 + 2 * 5 + 2);
    }
  });
});

describe('scrollTopToReveal', () => {
  it('leaves a visible row alone', () => {
    expect(scrollTopToReveal(12, 340, 340, 34)).toBe(340);
  });

  it('scrolls up to a row above the viewport and down to a row below', () => {
    expect(scrollTopToReveal(3, 340, 340, 34)).toBe(102);
    expect(scrollTopToReveal(30, 0, 340, 34)).toBe(30 * 34 + 34 - 340);
  });

  it('never goes negative', () => {
    expect(scrollTopToReveal(0, 50, 340, 34)).toBe(0);
  });
});

describe('rowsPerPage', () => {
  it('is the visible rows less one, at least one', () => {
    expect(rowsPerPage(340, 34)).toBe(9);
    expect(rowsPerPage(20, 34)).toBe(1);
    expect(rowsPerPage(0, 34)).toBe(1);
  });
});

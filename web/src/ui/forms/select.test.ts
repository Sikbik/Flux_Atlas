import { describe, expect, it } from 'vitest';
import { indexOfValue, initialActive, pageIndex, scrollTopToReveal } from './select';

const options = [
  { value: 'a', label: 'Alpha', disabled: true },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta', disabled: true },
];

describe('indexOfValue', () => {
  it('finds the option, or -1', () => {
    expect(indexOfValue(options, 'c')).toBe(2);
    expect(indexOfValue(options, 'zzz')).toBe(-1);
    expect(indexOfValue(options, null)).toBe(-1);
    expect(indexOfValue(options, undefined)).toBe(-1);
  });
});

describe('initialActive', () => {
  it('highlights the selected option', () => {
    expect(initialActive(options, 'c')).toBe(2);
  });

  it('falls back to the first or last enabled option', () => {
    expect(initialActive(options, null)).toBe(1);
    expect(initialActive(options, null, 'last')).toBe(2);
  });

  it('does not highlight a selected option that cannot be chosen', () => {
    expect(initialActive(options, 'a')).toBe(1);
    expect(initialActive(options, 'd', 'last')).toBe(2);
  });

  it('is -1 when nothing can be chosen', () => {
    expect(initialActive([{ value: 'x', label: 'X', disabled: true }], null)).toBe(-1);
    expect(initialActive([{ value: 'x', label: 'X', disabled: true }], null, 'last')).toBe(-1);
    expect(initialActive([], null)).toBe(-1);
  });
});

describe('pageIndex', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ value: `v${i}`, label: `Item ${i}` }));

  it('moves by the page size', () => {
    expect(pageIndex(many, 3, 10)).toBe(13);
    expect(pageIndex(many, 25, -10)).toBe(15);
  });

  it('clamps to the ends', () => {
    expect(pageIndex(many, 25, 10)).toBe(29);
    expect(pageIndex(many, 4, -10)).toBe(0);
  });

  it('starts from the ends when nothing is active', () => {
    expect(pageIndex(many, -1, 10)).toBe(9);
    expect(pageIndex(many, -1, -10)).toBe(20);
  });

  it('lands on an option that can be chosen', () => {
    const gappy = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
      { value: 'c', label: 'C', disabled: true },
      { value: 'd', label: 'D' },
    ];
    expect(pageIndex(gappy, 0, 1)).toBe(3);
    expect(pageIndex(gappy, 3, -1)).toBe(0);
    expect(pageIndex([], 0, 1)).toBe(-1);
  });
});

describe('scrollTopToReveal', () => {
  const view = { scrollTop: 100, height: 200 };

  it('keeps the position when the item fits', () => {
    expect(scrollTopToReveal(view, { top: 150, height: 32 }, 4)).toBe(100);
  });

  it('scrolls up to show an item above the view', () => {
    expect(scrollTopToReveal(view, { top: 90, height: 32 }, 4)).toBe(86);
  });

  it('scrolls down to show an item below the view', () => {
    expect(scrollTopToReveal(view, { top: 290, height: 32 }, 4)).toBe(100 + (290 + 32 + 4 - 300));
  });

  it('never goes below zero', () => {
    expect(scrollTopToReveal({ scrollTop: 10, height: 200 }, { top: 0, height: 32 }, 4)).toBe(0);
  });
});

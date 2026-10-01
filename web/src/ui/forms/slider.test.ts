import { describe, expect, it } from 'vitest';
import { decimalsOf, formatSliderValue, fractionOf, normalizeMarks } from './slider';

describe('fractionOf', () => {
  it('places a value between min and max', () => {
    expect(fractionOf(50, 0, 100)).toBe(0.5);
    expect(fractionOf(2, 1, 5)).toBe(0.25);
  });

  it('clamps outside the range and survives an empty range', () => {
    expect(fractionOf(-5, 0, 100)).toBe(0);
    expect(fractionOf(500, 0, 100)).toBe(1);
    expect(fractionOf(3, 5, 5)).toBe(0);
  });
});

describe('decimalsOf', () => {
  it('counts the fraction digits of a step', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(10)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.025)).toBe(3);
    expect(decimalsOf(1e-7)).toBe(6);
  });

  it('is zero for junk', () => {
    expect(decimalsOf(0)).toBe(0);
    expect(decimalsOf(Number.NaN)).toBe(0);
    expect(decimalsOf(-1)).toBe(0);
  });
});

describe('formatSliderValue', () => {
  it('groups whole numbers and fixes decimals', () => {
    expect(formatSliderValue(2996914, 1)).toBe('2,996,914');
    expect(formatSliderValue(98.5, 0.5)).toBe('98.5');
    expect(formatSliderValue(3, 0.25)).toBe('3.00');
  });
});

describe('normalizeMarks', () => {
  it('accepts numbers and objects, drops out-of-range and duplicate marks, and sorts', () => {
    expect(normalizeMarks([50, { value: 0, label: 'Off' }, 120, 50, -1, 100], 0, 100)).toEqual([
      { value: 0, label: 'Off' },
      { value: 50 },
      { value: 100 },
    ]);
  });

  it('is empty without marks', () => {
    expect(normalizeMarks(undefined, 0, 10)).toEqual([]);
  });
});

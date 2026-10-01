import { describe, expect, it } from 'vitest';
import { parseColor, withAlpha } from './color';

describe('parseColor', () => {
  it('reads hex in every length', () => {
    expect(parseColor('#4f7ad4')).toEqual({ r: 79, g: 122, b: 212, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 136 / 255 });
    const withA = parseColor('#4f7ad480');
    expect(withA?.r).toBe(79);
    expect(withA?.a).toBeCloseTo(128 / 255, 5);
  });

  it('reads legacy and modern rgb syntax', () => {
    expect(parseColor('rgb(79, 122, 212)')).toEqual({ r: 79, g: 122, b: 212, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 0.06)')).toEqual({ r: 255, g: 255, b: 255, a: 0.06 });
    expect(parseColor('rgb(255 255 255 / 0.1)')).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
    expect(parseColor('rgb(255 255 255 / 25%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.25 });
    expect(parseColor('  RGB(1,2,3) ')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('refuses what it does not understand', () => {
    expect(parseColor('oklab(0.5 0.1 0.1)')).toBeNull();
    expect(parseColor('var(--viz-1)')).toBeNull();
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('withAlpha', () => {
  it('scales the existing alpha', () => {
    expect(withAlpha('rgb(79, 122, 212)', 0.12)).toBe('rgba(79, 122, 212, 0.12)');
    expect(withAlpha('rgba(255, 255, 255, 0.5)', 0.5)).toBe('rgba(255, 255, 255, 0.25)');
    expect(withAlpha('#4f7ad4', 0)).toBe('rgba(79, 122, 212, 0)');
  });

  it('clamps the alpha', () => {
    expect(withAlpha('rgb(0, 0, 0)', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('rgb(0, 0, 0)', -1)).toBe('rgba(0, 0, 0, 0)');
  });

  it('falls back to color-mix for syntax it cannot parse', () => {
    expect(withAlpha('oklab(0.5 0.1 0.1)', 0.4)).toBe(
      'color-mix(in srgb, oklab(0.5 0.1 0.1) 40%, transparent)',
    );
  });
});

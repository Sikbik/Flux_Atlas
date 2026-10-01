import { describe, expect, it } from 'vitest';
import { flashDirection, flashPhase, resolveFlashTone } from './flash';

describe('flashDirection', () => {
  it('reads the direction of numbers and bigints', () => {
    expect(flashDirection(1, 2)).toBe('up');
    expect(flashDirection(2, 1)).toBe('down');
    expect(flashDirection(5n, 9n)).toBe('up');
    expect(flashDirection(9n, 5n)).toBe('down');
    expect(flashDirection(3, 3)).toBeNull();
  });

  it('has no direction for strings, booleans, null or mixed values', () => {
    expect(flashDirection('a', 'b')).toBeNull();
    expect(flashDirection(true, false)).toBeNull();
    expect(flashDirection(null, 4)).toBeNull();
    expect(flashDirection(4, undefined)).toBeNull();
    expect(flashDirection('3', 4)).toBeNull();
  });

  it('ignores NaN', () => {
    expect(flashDirection(Number.NaN, 1)).toBeNull();
    expect(flashDirection(1, Number.NaN)).toBeNull();
  });
});

describe('resolveFlashTone', () => {
  it('passes explicit tones through', () => {
    expect(resolveFlashTone('accent', 'up')).toBe('accent');
    expect(resolveFlashTone('white', 'down')).toBe('white');
    expect(resolveFlashTone('up', null)).toBe('up');
  });

  it('auto follows the direction and falls back to the accent', () => {
    expect(resolveFlashTone('auto', 'up')).toBe('up');
    expect(resolveFlashTone('auto', 'down')).toBe('down');
    expect(resolveFlashTone('auto', null)).toBe('accent');
  });
});

describe('flashPhase', () => {
  it('is quiet before the first change, then alternates', () => {
    expect(flashPhase(0)).toBeUndefined();
    expect(flashPhase(1)).toBe('a');
    expect(flashPhase(2)).toBe('b');
    expect(flashPhase(3)).toBe('a');
  });
});

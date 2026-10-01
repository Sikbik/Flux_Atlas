import { describe, expect, it } from 'vitest';
import { arrivals } from './fresh';

describe('arrivals', () => {
  it('finds the keys that appeared', () => {
    expect(arrivals(new Set(['a', 'b']), ['c', 'a', 'b'])).toEqual(['c']);
    expect(arrivals(new Set(['a', 'b']), ['d', 'c', 'a', 'b'])).toEqual(['d', 'c']);
  });

  it('is nothing on the first fill', () => {
    expect(arrivals(null, ['a', 'b'])).toEqual([]);
    expect(arrivals(new Set(), ['a', 'b'])).toEqual([]);
  });

  it('is nothing when the set is unchanged or only lost keys', () => {
    expect(arrivals(new Set(['a']), ['a'])).toEqual([]);
    expect(arrivals(new Set(['a', 'b']), ['a'])).toEqual([]);
  });

  it('treats more than `max` at once as a refill, not an arrival', () => {
    expect(arrivals(new Set(['x']), ['a', 'b', 'c', 'x'], 2)).toEqual([]);
    expect(arrivals(new Set(['x']), ['a', 'b', 'x'], 2)).toEqual(['a', 'b']);
    // no limit by default: a burst of rows is all fresh
    expect(arrivals(new Set(['x']), ['a', 'b', 'c', 'x'])).toEqual(['a', 'b', 'c']);
  });
});

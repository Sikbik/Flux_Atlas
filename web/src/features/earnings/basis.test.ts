import { describe, expect, it } from 'vitest';
import { BASIS_LABEL, BASIS_PHRASE, basisOf, earned, earnedOrNull, earnedSats } from './basis';

describe('earned', () => {
  it('adds the parallel assets to the main chain, or leaves them out', () => {
    expect(earned({ native: 14.71, pa: 14.71 }, true)).toBeCloseTo(29.42, 9);
    expect(earned({ native: 14.71, pa: 14.71 }, false)).toBe(14.71);
  });

  it('is unknown when the main chain is, and when counted parallel assets are', () => {
    expect(earnedOrNull(null, 3, true)).toBeNull();
    expect(earnedOrNull(null, 3, false)).toBeNull();
    expect(earnedOrNull(3, null, true)).toBeNull();
    // Main chain only does not need the parallel assets.
    expect(earnedOrNull(3, null, false)).toBe(3);
    expect(earnedOrNull(3, 3, true)).toBe(6);
  });

  it('keeps every digit of the wire amounts', () => {
    expect(earnedSats('2047.64547647', '2047.64547647', true)).toBe(409_529_095_294n);
    expect(earnedSats('2047.64547647', '2047.64547647', false)).toBe(204_764_547_647n);
    expect(earnedSats(null, '1.00000000', true)).toBeNull();
    expect(earnedSats('1.00000000', null, true)).toBeNull();
    expect(earnedSats('1.00000000', null, false)).toBe(100_000_000n);
  });
});

describe('the words', () => {
  it('names each basis the same way everywhere', () => {
    expect(basisOf(true)).toBe('all');
    expect(basisOf(false)).toBe('main');
    expect(BASIS_LABEL.all).toBe('Main chain + parallel assets');
    expect(BASIS_LABEL.main).toBe('Main chain only');
    expect(BASIS_PHRASE.all).toBe('main chain + parallel assets');
  });
});

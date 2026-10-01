import { describe, expect, it } from 'vitest';
import { navigateIndex, typeaheadIndex } from './keys';

describe('navigateIndex', () => {
  it('steps with the arrow keys and wraps', () => {
    expect(navigateIndex('ArrowRight', 0, 3)).toBe(1);
    expect(navigateIndex('ArrowRight', 2, 3)).toBe(0);
    expect(navigateIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(navigateIndex('ArrowLeft', 2, 3)).toBe(1);
  });

  it('honours orientation', () => {
    expect(navigateIndex('ArrowDown', 0, 3)).toBeNull();
    expect(navigateIndex('ArrowDown', 0, 3, { orientation: 'vertical' })).toBe(1);
    expect(navigateIndex('ArrowRight', 0, 3, { orientation: 'vertical' })).toBeNull();
    expect(navigateIndex('ArrowUp', 1, 3, { orientation: 'both' })).toBe(0);
    expect(navigateIndex('ArrowRight', 1, 3, { orientation: 'both' })).toBe(2);
  });

  it('skips disabled items', () => {
    const isDisabled = (i: number) => i === 1;
    expect(navigateIndex('ArrowRight', 0, 4, { isDisabled })).toBe(2);
    expect(navigateIndex('ArrowLeft', 2, 4, { isDisabled })).toBe(0);
    expect(navigateIndex('Home', 3, 4, { isDisabled: (i) => i === 0 })).toBe(1);
    expect(navigateIndex('End', 0, 4, { isDisabled: (i) => i === 3 })).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(navigateIndex('Home', 2, 5)).toBe(0);
    expect(navigateIndex('End', 2, 5)).toBe(4);
  });

  it('returns null for other keys, empty lists and all-disabled lists', () => {
    expect(navigateIndex('a', 0, 3)).toBeNull();
    expect(navigateIndex('ArrowRight', 0, 0)).toBeNull();
    expect(navigateIndex('ArrowRight', 0, 3, { isDisabled: () => true })).toBeNull();
    expect(navigateIndex('Home', 0, 3, { isDisabled: () => true })).toBeNull();
  });

  it('stops at the ends when looping is off', () => {
    expect(navigateIndex('ArrowRight', 2, 3, { loop: false })).toBeNull();
    expect(navigateIndex('ArrowLeft', 0, 3, { loop: false })).toBeNull();
    expect(navigateIndex('ArrowRight', 1, 3, { loop: false })).toBe(2);
  });

  it('starts from the matching end when nothing is active', () => {
    expect(navigateIndex('ArrowRight', -1, 3)).toBe(0);
    expect(navigateIndex('ArrowLeft', -1, 3)).toBe(2);
  });
});

describe('typeaheadIndex', () => {
  const labels = ['Alpha', 'Bravo', 'Brick', 'Charlie'];

  it('finds the next label with the prefix after the current item', () => {
    expect(typeaheadIndex(labels, 'b', 0)).toBe(1);
    expect(typeaheadIndex(labels, 'b', 1)).toBe(2);
    expect(typeaheadIndex(labels, 'b', 2)).toBe(1);
    expect(typeaheadIndex(labels, 'br', 0)).toBe(1);
    expect(typeaheadIndex(labels, 'bri', 0)).toBe(2);
  });

  it('skips disabled items and ignores empty or unmatched input', () => {
    expect(typeaheadIndex(labels, 'b', 0, (i) => i === 1)).toBe(2);
    expect(typeaheadIndex(labels, '', 0)).toBeNull();
    expect(typeaheadIndex(labels, 'z', 0)).toBeNull();
  });

  it('cycles with a repeated character', () => {
    expect(typeaheadIndex(labels, 'bb', 1)).toBe(2);
  });
});

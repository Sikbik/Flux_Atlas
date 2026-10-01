import { describe, expect, it } from 'vitest';
import { navigateRow } from './navigation';

const nav = (current: number, count = 20, page = 5) => ({ current, count, page });

describe('navigateRow', () => {
  it('steps by one with Up and Down and stops at the ends', () => {
    expect(navigateRow('ArrowDown', nav(3))).toBe(4);
    expect(navigateRow('ArrowUp', nav(3))).toBe(2);
    expect(navigateRow('ArrowDown', nav(19))).toBeNull();
    expect(navigateRow('ArrowUp', nav(0))).toBeNull();
  });

  it('lands on the first row going forward and the last going back when nothing is active', () => {
    expect(navigateRow('ArrowDown', nav(-1))).toBe(0);
    expect(navigateRow('ArrowUp', nav(-1))).toBe(19);
    expect(navigateRow('PageDown', nav(-1))).toBe(0);
    expect(navigateRow('PageUp', nav(-1))).toBe(19);
  });

  it('moves by a page and clamps', () => {
    expect(navigateRow('PageDown', nav(3))).toBe(8);
    expect(navigateRow('PageDown', nav(17))).toBe(19);
    expect(navigateRow('PageUp', nav(3))).toBe(0);
    expect(navigateRow('PageUp', nav(12))).toBe(7);
  });

  it('jumps to the edges', () => {
    expect(navigateRow('Home', nav(9))).toBe(0);
    expect(navigateRow('End', nav(9))).toBe(19);
  });

  it('ignores other keys and empty tables', () => {
    expect(navigateRow('ArrowLeft', nav(3))).toBeNull();
    expect(navigateRow('a', nav(3))).toBeNull();
    expect(navigateRow('ArrowDown', nav(-1, 0))).toBeNull();
    expect(navigateRow('End', nav(-1, 0))).toBeNull();
  });
});

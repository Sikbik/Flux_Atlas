import { describe, expect, it } from 'vitest';
import { resolveStop } from './roving';

const items = [{ id: 'a' }, { id: 'b', disabled: true }, { id: 'c' }, { id: 'd' }];

describe('resolveStop', () => {
  it('prefers the item focus rests on', () => {
    expect(resolveStop(items, 'c', 'a')).toBe('c');
  });

  it('falls back to the selected item when nothing is focused', () => {
    expect(resolveStop(items, undefined, 'd')).toBe('d');
  });

  it('ignores a focused or selected item that is disabled or unknown', () => {
    expect(resolveStop(items, 'b', 'd')).toBe('d');
    expect(resolveStop(items, 'zzz', 'b')).toBe('a');
    expect(resolveStop(items, undefined, 'nope')).toBe('a');
  });

  it('lands on the first enabled item when there is no usable selection', () => {
    expect(resolveStop([{ id: 'x', disabled: true }, { id: 'y' }], undefined, undefined)).toBe('y');
  });

  it('returns undefined when every item is disabled or the group is empty', () => {
    expect(resolveStop([{ id: 'x', disabled: true }], undefined, 'x')).toBeUndefined();
    expect(resolveStop([], undefined, undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { arrivedKeys, prependedCount } from './liveList';

describe('arrivedKeys', () => {
  it('returns keys not seen before, in row order', () => {
    const rows = [{ k: 5 }, { k: 4 }, { k: 3 }];
    expect(arrivedKeys(new Set([4, 3]), rows, (r) => r.k)).toEqual([5]);
    expect(arrivedKeys(new Set(), rows, (r) => r.k)).toEqual([5, 4, 3]);
    expect(arrivedKeys(new Set([5, 4, 3]), rows, (r) => r.k)).toEqual([]);
  });
});

describe('prependedCount', () => {
  const keys = ['9', '8', '7', '6'];
  const at = (i: number) => keys[i]!;

  it('is 0 when the first row did not change or there was no previous list', () => {
    expect(prependedCount('9', keys.length, at)).toBe(0);
    expect(prependedCount(null, keys.length, at)).toBe(0);
    expect(prependedCount('9', 0, at)).toBe(0);
  });

  it('counts rows inserted above the old first row', () => {
    expect(prependedCount('8', keys.length, at)).toBe(1);
    expect(prependedCount('7', keys.length, at)).toBe(2);
  });

  it('is 0 when the old first row is gone or beyond the limit', () => {
    expect(prependedCount('1', keys.length, at)).toBe(0);
    expect(prependedCount('6', keys.length, at, 2)).toBe(0);
  });
});

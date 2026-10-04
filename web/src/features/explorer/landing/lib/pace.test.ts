import { describe, expect, it } from 'vitest';
import { blockPace } from './pace';

const at = (height: number, s: number) => ({ height, timeMs: 1_700_000_000_000 + s * 1000 });

describe('blockPace', () => {
  it('reads the gaps between neighbours, oldest first, whatever order the blocks come in', () => {
    const p = blockPace([at(103, 95), at(100, 0), at(102, 61), at(101, 29)]);
    expect(p.gaps).toEqual([29, 32, 34]);
    expect(p.avgS).toBeCloseTo(95 / 3);
    expect(p.longestS).toBe(34);
  });

  it('puts the mean against the 30 second target', () => {
    const slow = blockPace([at(1, 0), at(2, 33), at(3, 66)]);
    expect(slow.vsTarget).toBeCloseTo(10);
    const quick = blockPace([at(1, 0), at(2, 27), at(3, 54)]);
    expect(quick.vsTarget).toBeCloseTo(-10);
  });

  it('does not take a hole in the store for one long block', () => {
    const p = blockPace([at(1, 0), at(2, 30), at(5, 120), at(6, 150)]);
    expect(p.gaps).toEqual([30, 30]);
  });

  it('has no answer for fewer than two blocks, and never a zero in place of one', () => {
    expect(blockPace([])).toEqual({ gaps: [], avgS: null, longestS: null, vsTarget: null });
    expect(blockPace([at(1, 0)]).avgS).toBeNull();
  });

  it('ignores a block that claims to be older than its predecessor', () => {
    const p = blockPace([at(1, 100), at(2, 90), at(3, 120)]);
    expect(p.gaps).toEqual([30]);
  });
});

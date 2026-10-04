import { describe, expect, it } from 'vitest';
import type { RichListEntry } from '../../../../api/generated/RichListEntry';
import { SWAP_POOL_ADDRESS } from '../../lib/entities';
import { holderGlance, RING, ringSlices, ringSummary, sliceMid, topHolders } from './holders';

function list(n: number, shares: (rank: number) => number): RichListEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    address: i === 0 ? SWAP_POOL_ADDRESS : `t1addr${i + 1}`,
    balance: `${(shares(i + 1) * 4_308_000).toFixed(8)}`,
    share_pct: shares(i + 1),
    node_count: i % 3,
  }));
}

// A plausible ranking: one giant, then a long tail of small holders.
const share = (rank: number) => (rank === 1 ? 37 : rank <= 10 ? 2.5 : rank <= 100 ? 0.3 : 0.01);

describe('topHolders', () => {
  it('takes the first n by rank, whatever order the server sent, and labels the known ones', () => {
    const shuffled = [...list(20, share)].reverse();
    const top = topHolders(shuffled, 5);
    expect(top.map((h) => h.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(top[0]?.entity?.label).toBe('Swap pool');
    expect(top[1]?.entity).toBeNull();
    expect(top[0]?.share).toBe(37);
  });

  it('keeps the server balance string and a number beside it for scaling', () => {
    const [h] = topHolders(list(3, share), 1);
    expect(h?.balance).toMatch(/^\d+\.\d{8}$/);
    expect(h?.flux).toBeCloseTo(37 * 4_308_000);
  });
});

describe('ringSlices', () => {
  const glance = holderGlance(list(1000, share));

  it('lays the buckets out clockwise from the top, covering the whole ring', () => {
    const slices = glance?.slices ?? [];
    expect(slices.map((s) => s.key)).toEqual(['r1-1', 'r2-10', 'r11-100', 'r101-1000', 'rest']);
    expect(slices[0]?.a0).toBeCloseTo(0.009);
    const last = slices[slices.length - 1];
    expect(last?.a1).toBeGreaterThan(Math.PI * 2 - 0.02);
    for (let i = 1; i < slices.length; i++) {
      expect((slices[i]?.a0 ?? 0) >= (slices[i - 1]?.a1 ?? 0)).toBe(true);
    }
  });

  it('sizes each slice by its share of the supply', () => {
    const slices = glance?.slices ?? [];
    const first = slices[0];
    expect(((first?.a1 ?? 0) - (first?.a0 ?? 0)) / (Math.PI * 2)).toBeCloseTo(
      0.37 - 0.018 / (Math.PI * 2),
      2,
    );
  });

  it('draws a sliver for a bucket that holds almost nothing, never a vanished one', () => {
    const slices = ringSlices([
      { key: 'r1-1', label: '#1', from: 1, to: 1, share: 99.9999, holders: 1 },
      { key: 'rest', label: 'Everyone else', from: null, to: null, share: 0.0001, holders: 0 },
    ]);
    const rest = slices[1];
    expect((rest?.a1 ?? 0) - (rest?.a0 ?? 0)).toBeGreaterThan(0.0119);
  });

  it('has no slices for nothing, and a path for each slice otherwise', () => {
    expect(ringSlices([])).toEqual([]);
    for (const s of glance?.slices ?? []) expect(s.d).toMatch(/^M/);
  });

  it('finds the middle of a slice on the ring', () => {
    const p = sliceMid({ a0: 0, a1: Math.PI }, RING.r1);
    // Half way round clockwise from the top is the right edge of the ring.
    expect(p.x).toBeCloseTo(RING.size / 2 + RING.r1);
    expect(p.y).toBeCloseTo(RING.size / 2);
  });
});

describe('holderGlance', () => {
  it('reads the top-ten share and the number of addresses ranked', () => {
    const g = holderGlance(list(1000, share));
    expect(g?.top10).toBeCloseTo(37 + 9 * 2.5);
    expect(g?.listed).toBe(1000);
    expect(g?.top).toHaveLength(5);
  });

  it('is null for an empty ranking', () => {
    expect(holderGlance([])).toBeNull();
  });

  it('reads the ring to a screen reader in one sentence', () => {
    const g = holderGlance(list(1000, share));
    const text = g ? ringSummary(g) : '';
    expect(text).toMatch(/^Share of the supply by rank: #1 37\.0 percent, /);
    expect(text).toMatch(/everyone else/);
  });
});

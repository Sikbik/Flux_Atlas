import { describe, expect, it } from 'vitest';
import {
  type BlockLike,
  freshKeys,
  mixSegments,
  nextTombs,
  payeesByTier,
  TOMB_MS,
  txMix,
  withTombs,
} from './rail';

const blk = (height: number, hash = `h${height}`, over: Partial<BlockLike> = {}): BlockLike => ({
  height,
  hash,
  txCount: 17,
  confirmCount: 14,
  startCount: 1,
  transferCount: 0,
  ...over,
});
/** Newest first, like the store's ring. */
const chain = (...heights: number[]) => heights.map((h) => blk(h));

describe('txMix', () => {
  it('names what the server counts and leaves the rest as other', () => {
    expect(txMix(blk(1))).toEqual({ confirms: 14, starts: 1, transfers: 0, other: 2, total: 17 });
  });

  it('never goes negative when the counts overlap', () => {
    const m = txMix(blk(1, 'x', { txCount: 5, confirmCount: 9 }));
    expect(m.other).toBe(0);
    expect(m.total).toBe(5);
  });
});

describe('mixSegments', () => {
  it('drops empty kinds and keeps a fixed order', () => {
    const segs = mixSegments(txMix(blk(1)));
    expect(segs.map((s) => s.key)).toEqual(['confirms', 'starts', 'other']);
  });

  it('sums to one even after lifting a tiny segment to its floor', () => {
    const segs = mixSegments({ confirms: 500, starts: 1, transfers: 0, other: 1, total: 502 });
    const sum = segs.reduce((a, s) => a + s.frac, 0);
    expect(sum).toBeCloseTo(1, 10);
    for (const s of segs) expect(s.frac).toBeGreaterThanOrEqual(0.04 - 1e-9);
  });

  it('is empty for an empty block', () => {
    expect(mixSegments({ confirms: 0, starts: 0, transfers: 0, other: 0, total: 0 })).toEqual([]);
  });
});

describe('payeesByTier', () => {
  it('orders Stratus, Nimbus, Cumulus and skips the unknown tier', () => {
    const p = (tier: string) => ({ tier, node: 1, address: 'a', amount: '1' }) as never;
    const out = payeesByTier([p('cumulus'), p('unknown'), p('stratus'), p('nimbus')]);
    expect(out.map((x) => x.tier)).toEqual(['stratus', 'nimbus', 'cumulus']);
  });
});

describe('freshKeys', () => {
  it('finds the one or two cards that appeared', () => {
    expect([...freshKeys(new Set(['a', 'b']), ['c', 'a', 'b'])]).toEqual(['c']);
    expect([...freshKeys(new Set(['a', 'b']), ['d', 'c', 'a', 'b'])]).toEqual(['d', 'c']);
  });

  it('animates nothing on the first fill or when a whole resync arrives', () => {
    expect(freshKeys(null, ['a', 'b']).size).toBe(0);
    expect(freshKeys(new Set(), ['a', 'b']).size).toBe(0);
    expect(freshKeys(new Set(['x']), ['a', 'b', 'c', 'x']).size).toBe(0);
  });

  it('reports nothing when the set is unchanged', () => {
    expect(freshKeys(new Set(['a']), ['a']).size).toBe(0);
  });
});

describe('nextTombs', () => {
  it('keeps blocks a reorg removed, marked with the time it happened', () => {
    const prev = chain(12, 11, 10, 9);
    const next = chain(10, 9);
    const tombs = nextTombs(prev, next, [], 1_000);
    expect(tombs.map((t) => t.block.height)).toEqual([12, 11]);
    expect(tombs.every((t) => t.at === 1_000)).toBe(true);
  });

  it('keeps a replaced block (same height, new hash) as a tombstone', () => {
    const prev = [blk(11, 'old'), blk(10)];
    const next = [blk(11, 'new'), blk(10)];
    const tombs = nextTombs(prev, next, [], 5);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]?.block.hash).toBe('old');
  });

  it('does not treat blocks that aged out of the ring as orphans', () => {
    const prev = chain(12, 11, 10, 9);
    const next = chain(13, 12, 11, 10);
    expect(nextTombs(prev, next, [], 5)).toEqual([]);
  });

  it('expires tombstones after the lifetime and drops ones that came back', () => {
    const old = { block: blk(12), at: 0 };
    expect(nextTombs(chain(11), chain(11), [old], TOMB_MS)).toEqual([]);
    expect(nextTombs(chain(11), chain(12, 11), [{ block: blk(12), at: 10 }], 20)).toEqual([]);
  });

  it('does not add the same orphan twice', () => {
    const prev = chain(12, 11, 10);
    const next = chain(10);
    const first = nextTombs(prev, next, [], 1);
    const second = nextTombs(prev, next, first, 2);
    expect(second).toHaveLength(2);
  });

  it('only expires: an empty next set keeps live tombstones', () => {
    const t = { block: blk(5), at: 100 };
    expect(nextTombs(chain(5), [], [t], 200)).toEqual([t]);
  });
});

describe('withTombs', () => {
  it('places an orphan just after the live block of the same height', () => {
    const live = [blk(11, 'new'), blk(10)];
    const tombs = [{ block: blk(11, 'old'), at: 0 }];
    const out = withTombs(live, tombs);
    expect(out.map((c) => `${c.block.hash}${c.orphan ? '*' : ''}`)).toEqual(['new', 'old*', 'h10']);
  });

  it('places an orphan above the live set when no live block has its height', () => {
    const out = withTombs([blk(10)], [{ block: blk(12), at: 0 }]);
    expect(out.map((c) => c.block.height)).toEqual([12, 10]);
    expect(out[0]?.orphan).toBe(true);
  });
});

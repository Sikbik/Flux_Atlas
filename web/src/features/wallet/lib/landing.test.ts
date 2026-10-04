import { describe, expect, it } from 'vitest';
import {
  type BlockLike,
  KEEP_LANDINGS,
  landingsAfter,
  landingText,
  newestHeight,
  pushLandings,
} from './landing';

const ME = 't3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ';

const block = (
  height: number,
  payouts: BlockLike['payouts'],
  live = true,
  timeMs = height * 1000,
): BlockLike => ({ height, live, timeMs, payouts });

const pay = (address: string, tier: string, amount: string, node: number | null = null) => ({
  address,
  tier,
  amount,
  node,
});

describe('landingsAfter', () => {
  it('finds the live blocks that paid this wallet, oldest first', () => {
    const blocks = [
      block(12, [pay('other', 'stratus', '9.00000000'), pay(ME, 'stratus', '9.20000000', 4)]),
      block(11, [pay('other', 'nimbus', '3.00000000')]),
      block(10, [pay(ME, 'nimbus', '3.10000000', 7)]),
    ];
    const out = landingsAfter(blocks, ME, 9, (id) => `out:${id}`);
    expect(out.map((l) => l.height)).toEqual([10, 12]);
    expect(out[1]?.flux).toBeCloseTo(9.2, 12);
    expect(out[1]?.byTier.stratus).toEqual({ count: 1, flux: 9.2 });
    expect(out[1]?.keys).toEqual(['out:4']);
    expect(out[0]?.byTier.nimbus.count).toBe(1);
  });

  it('stops at the height already seen', () => {
    const blocks = [
      block(12, [pay(ME, 'stratus', '9.00000000')]),
      block(11, [pay(ME, 'stratus', '9.00000000')]),
    ];
    expect(landingsAfter(blocks, ME, 11).map((l) => l.height)).toEqual([12]);
    expect(landingsAfter(blocks, ME, 12)).toEqual([]);
  });

  it('never counts a block of the bootstrap, which is history', () => {
    const blocks = [block(12, [pay(ME, 'stratus', '9.00000000')], false)];
    expect(landingsAfter(blocks, ME, 0)).toEqual([]);
  });

  it('adds up several payouts to one wallet in one block', () => {
    const blocks = [
      block(12, [
        pay(ME, 'stratus', '9.00000000', 1),
        pay(ME, 'stratus', '9.00000000', 2),
        pay(ME, 'cumulus', '1.50000000', 3),
      ]),
    ];
    const [l] = landingsAfter(blocks, ME, 0);
    expect(l?.count).toBe(3);
    expect(l?.flux).toBeCloseTo(19.5, 12);
    expect(l?.byTier.stratus.count).toBe(2);
    expect(l?.byTier.cumulus.flux).toBeCloseTo(1.5, 12);
  });

  it('ignores a payout of an unknown tier in the tier split, not in the total', () => {
    const [l] = landingsAfter([block(5, [pay(ME, 'unknown', '2.00000000')])], ME, 0);
    expect(l?.flux).toBe(2);
    expect(Object.values(l?.byTier ?? {}).reduce((n, t) => n + t.count, 0)).toBe(0);
  });

  it('does not repeat a node that was paid twice', () => {
    const [l] = landingsAfter(
      [block(5, [pay(ME, 'stratus', '1.00000000', 3), pay(ME, 'stratus', '1.00000000', 3)])],
      ME,
      0,
      (id) => `k${id}`,
    );
    expect(l?.keys).toEqual(['k3']);
  });

  it('finds nothing in no blocks', () => {
    expect(landingsAfter([], ME, 0)).toEqual([]);
  });
});

describe('newestHeight', () => {
  it('is the first height, or zero', () => {
    expect(newestHeight([block(9, []), block(8, [])])).toBe(9);
    expect(newestHeight([])).toBe(0);
  });
});

describe('pushLandings', () => {
  const l = (height: number) => landingsAfter([block(height, [pay(ME, 'stratus', '1.00000000')])], ME, 0)[0]!;

  it('puts the newest first and drops repeats', () => {
    const kept = pushLandings([l(5)], [l(6), l(7), l(5)]);
    expect(kept.map((x) => x.height)).toEqual([7, 6, 5]);
  });

  it('keeps only so many', () => {
    const many = Array.from({ length: KEEP_LANDINGS + 5 }, (_, i) => l(i + 1));
    const kept = pushLandings([], many);
    expect(kept).toHaveLength(KEEP_LANDINGS);
    expect(kept[0]?.height).toBe(KEEP_LANDINGS + 5);
  });
});

describe('landingText', () => {
  it('says what landed in a line', () => {
    const [one] = landingsAfter([block(5, [pay(ME, 'stratus', '9.20000000')])], ME, 0);
    expect(landingText(one!)).toBe('+9.20 FLUX from 1 node');
    const [two] = landingsAfter(
      [block(6, [pay(ME, 'stratus', '9.20000000'), pay(ME, 'nimbus', '3.00000000')])],
      ME,
      0,
    );
    expect(landingText(two!)).toBe('+12.20 FLUX from 2 nodes');
  });
});

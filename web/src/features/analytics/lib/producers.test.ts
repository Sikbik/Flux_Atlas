import { describe, expect, it } from 'vitest';
import { mergeSample, type ProducerTier, tallyProducers } from './producers';

const tiers: Record<number, ProducerTier> = { 1: 'cumulus', 2: 'cumulus', 3: 'nimbus', 4: 'stratus' };
const tierOf = (id: number) => tiers[id] ?? null;

describe('tallyProducers', () => {
  it('counts blocks per producer tier and keeps unknown producers apart', () => {
    const t = tallyProducers(
      [
        { height: 5, timeMs: 5000, producer: 1 },
        { height: 4, timeMs: 4000, producer: 2 },
        { height: 3, timeMs: 3000, producer: 3 },
        { height: 2, timeMs: 2000, producer: 99 },
        { height: 1, timeMs: 1000, producer: null },
      ],
      tierOf,
    );
    expect(t.counts).toEqual({ cumulus: 2, nimbus: 1, stratus: 0 });
    expect(t.unknown).toBe(2);
    expect(t.known).toBe(3);
    expect(t.total).toBe(5);
  });
  it('keeps the times of the blocks it counted, not of the unknown ones', () => {
    const t = tallyProducers(
      [
        { height: 3, timeMs: 3000, producer: 1 },
        { height: 2, timeMs: 2000, producer: null },
        { height: 1, timeMs: 1000, producer: 4 },
      ],
      tierOf,
    );
    expect(t.knownTimes).toEqual([3000, 1000]);
  });
  it('is empty for no blocks', () => {
    expect(tallyProducers([], tierOf)).toEqual({
      counts: { cumulus: 0, nimbus: 0, stratus: 0 },
      unknown: 0,
      known: 0,
      total: 0,
      knownTimes: [],
    });
  });
});

describe('mergeSample', () => {
  const b = (height: number) => ({ height, timeMs: height * 1000, producer: 1 });
  it('puts live blocks newer than the history in front', () => {
    const m = mergeSample([b(10), b(9), b(8)], [b(12), b(11), b(10)], 100);
    expect(m.map((x) => x.height)).toEqual([12, 11, 10, 9, 8]);
  });
  it('never repeats a height and respects the limit', () => {
    const m = mergeSample([b(10), b(9), b(8)], [b(10), b(9)], 2);
    expect(m.map((x) => x.height)).toEqual([10, 9]);
  });
  it('works with no live blocks', () => {
    expect(mergeSample([b(3), b(2)], [], 10).map((x) => x.height)).toEqual([3, 2]);
  });
});

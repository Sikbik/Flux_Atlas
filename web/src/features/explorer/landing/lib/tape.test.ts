import { describe, expect, it } from 'vitest';
import type { ChainBlock } from '../../../../store/network';
import { barText, LATE_AFTER_S, MIN_SCALE_TX, tapeBars, tapeCount, tapeSummary } from './tape';

const T0 = 1_790_000_000_000;

function block(height: number, afterS: number, over: Partial<ChainBlock> = {}): ChainBlock {
  return {
    height,
    hash: `h${height}`,
    timeMs: T0 + afterS * 1000,
    size: 3000,
    txCount: 20,
    producer: null,
    payouts: [],
    reward: '14.00000000',
    fees: '0.00000000',
    devFund: null,
    confirmCount: 14,
    startCount: 2,
    transferCount: 1,
    observedMs: null,
    live: true,
    ...over,
  };
}

/** Newest first, as the store hands them out. */
const run = (...bs: ChainBlock[]) => [...bs].reverse();

describe('tapeBars', () => {
  it('takes the newest blocks, oldest first', () => {
    const bars = tapeBars(run(block(1, 0), block(2, 30), block(3, 60), block(4, 90)), 3);
    expect(bars.map((b) => b.height)).toEqual([2, 3, 4]);
  });

  it('reads the gap from the block before and calls a long one late', () => {
    const bars = tapeBars(run(block(1, 0), block(2, 30), block(3, 95)), 5);
    expect(bars[0]?.gapS).toBeNull();
    expect(bars[1]?.gapS).toBe(30);
    expect(bars[1]?.late).toBe(false);
    expect(bars[2]?.gapS).toBe(65);
    expect(bars[2]?.late).toBe(65 > LATE_AFTER_S);
  });

  it('does not take a hole in the run for a long block', () => {
    const bars = tapeBars(run(block(1, 0), block(5, 120)), 5);
    expect(bars[1]?.gapS).toBeNull();
    expect(bars[1]?.late).toBe(false);
  });

  it('scales the bars against the busiest block, and never below a floor', () => {
    const quiet = tapeBars(run(block(1, 0, { txCount: 6 }), block(2, 30, { txCount: 12 })), 5);
    expect(quiet[1]?.frac).toBeCloseTo(12 / MIN_SCALE_TX);
    const busy = tapeBars(run(block(1, 0, { txCount: 30 }), block(2, 30, { txCount: 60 })), 5);
    expect(busy[1]?.frac).toBe(1);
    expect(busy[0]?.frac).toBeCloseTo(0.5);
  });

  it('keeps an empty block visible as a sliver, never nothing', () => {
    const bars = tapeBars(
      run(block(1, 0, { txCount: 0, confirmCount: 0, startCount: 0, transferCount: 0 })),
      2,
    );
    expect(bars[0]?.frac).toBeGreaterThan(0);
    expect(bars[0]?.segments).toEqual([]);
  });

  it('cuts a bar into the kinds of its transactions', () => {
    const bars = tapeBars(run(block(1, 0)), 2);
    const keys = bars[0]?.segments.map((s) => s.key);
    expect(keys).toEqual(['confirms', 'starts', 'transfers', 'other']);
    expect(bars[0]?.other).toBe(3);
  });

  it('shows nothing for a count of zero', () => {
    expect(tapeBars(run(block(1, 0)), 0)).toEqual([]);
  });
});

describe('tapeCount', () => {
  it('fits about 9 px a bar, between 20 and 60', () => {
    expect(tapeCount(360)).toBe(40);
    expect(tapeCount(120)).toBe(20);
    expect(tapeCount(900)).toBe(60);
    expect(tapeCount(0)).toBe(40);
  });
});

describe('words', () => {
  it('names a bar by its block, age, transactions and gap', () => {
    const [a, b] = tapeBars(run(block(2996929, 0), block(2996930, 70)), 2);
    expect(b && barText(b, T0 + 82_000)).toBe(
      'Block 2,996,930, 12 s ago, 20 transactions, 70 s after the one before, late',
    );
    expect(a && barText(a, T0 + 600_000)).toBe('Block 2,996,929, 10 min ago, 20 transactions');
  });

  it('summarizes the tape in a sentence', () => {
    const bars = tapeBars(run(block(1, 0), block(2, 30), block(3, 62)), 5);
    expect(tapeSummary(bars)).toBe(
      'The last 3 blocks carried 60 transactions. Blocks came 31.0 seconds apart on average.',
    );
    expect(tapeSummary([])).toBe('No blocks yet.');
  });
});

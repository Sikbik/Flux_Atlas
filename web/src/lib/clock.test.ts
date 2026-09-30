import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatState, blockAnchorMs, EventClock, freshness } from './clock';

describe('beat', () => {
  it('tracks progress across the 30 s interval', () => {
    const last = { height: 100, anchorMs: 1_000_000 };
    expect(beatState(null, 0).phase).toBe('unknown');
    const b = beatState(last, 1_012_000);
    expect(b.progress).toBeCloseTo(0.4);
    expect(b.remainingMs).toBe(18_000);
    expect(b.phase).toBe('waiting');
    expect(beatState(last, 1_028_000).phase).toBe('soon');
    const late = beatState(last, 1_041_000);
    expect(late.phase).toBe('late');
    expect(late.lateMs).toBe(11_000);
    expect(late.progress).toBe(1);
    expect(beatState(last, 1_091_000).phase).toBe('quiet');
  });

  it('anchors on header time unless it is implausible', () => {
    expect(blockAnchorMs(1000, 1900)).toBe(1000);
    expect(blockAnchorMs(10_000, 1000)).toBe(1000);
    expect(blockAnchorMs(0, 100_000)).toBe(100_000);
    expect(blockAnchorMs(5, null)).toBe(5);
  });

  it('classifies freshness', () => {
    expect(freshness(4_000, 5_000)).toBe('fresh');
    expect(freshness(10_000, 5_000)).toBe('aging');
    expect(freshness(20_000, 5_000)).toBe('stale');
    expect(freshness(60_000, 5_000)).toBe('dead');
  });
});

describe('EventClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_300);
  });
  afterEach(() => vi.useRealTimers());

  it('ticks once per second aligned to whole seconds, only while subscribed', () => {
    const clock = new EventClock();
    const seen: number[] = [];
    const off = clock.subscribe((t) => seen.push(t));
    vi.advanceTimersByTime(700);
    expect(seen).toEqual([11_000]);
    vi.advanceTimersByTime(2_000);
    expect(seen).toEqual([11_000, 12_000, 13_000]);
    off();
    vi.advanceTimersByTime(5_000);
    expect(seen.length).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies the server clock offset and drives the beat', () => {
    const clock = new EventClock();
    clock.setOffset(2_000);
    expect(clock.now()).toBe(12_300);
    clock.setLastBlock(7, 12_300 - 5_000, 12_300 - 4_000);
    expect(clock.beat().sinceMs).toBe(5_000);
    clock.setLastBlock(6, 0, 0);
    expect(clock.lastBlockInfo?.height).toBe(7);
  });
});

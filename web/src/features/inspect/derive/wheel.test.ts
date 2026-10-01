import { describe, expect, it } from 'vitest';
import {
  angleOf,
  binCount,
  binOfPosition,
  laneOffset,
  onBand,
  slotAngle,
  slotAtAngle,
  TAU,
  tickShade,
} from './wheel';

describe('slotAngle', () => {
  it('puts the head at the gate when the block is due and one slot ahead right after a block', () => {
    expect(slotAngle(0, 100, 1)).toBeCloseTo(0, 9);
    expect(slotAngle(0, 100, 0)).toBeCloseTo(TAU / 100, 9);
  });

  it('keeps the node paid by the last block at the gate, then lets it drift behind', () => {
    // Position n-1 is the back of the queue: the node that was just paid.
    expect(slotAngle(99, 100, 0)).toBeCloseTo(0, 9);
    expect(slotAngle(99, 100, 0.5)).toBeCloseTo(TAU - (TAU / 100) * 0.5, 9);
  });

  it('is continuous across a block: position 1 at phase 1 is where position 0 is at phase 0', () => {
    expect(slotAngle(1, 100, 1)).toBeCloseTo(slotAngle(0, 100, 0), 9);
  });
});

describe('slotAtAngle', () => {
  it('inverts slotAngle for every slot', () => {
    for (const phase of [0, 0.3, 0.9]) {
      for (const i of [0, 1, 17, 98, 99]) {
        expect(slotAtAngle(slotAngle(i, 100, phase), 100, phase)).toBe(i);
      }
    }
  });

  it('wraps negative and large angles', () => {
    expect(slotAtAngle(-TAU / 100, 100, 1)).toBe(slotAtAngle(TAU - TAU / 100, 100, 1));
    expect(slotAtAngle(TAU * 3, 100, 0)).toBe(slotAtAngle(0, 100, 0));
  });
});

describe('bins', () => {
  it('draws about one tick per few pixels and never more ticks than slots', () => {
    expect(binCount(3385, 110)).toBe(222);
    expect(binCount(40, 110)).toBe(40);
    expect(binCount(0, 110)).toBe(0);
    expect(binCount(100_000, 400)).toBe(420);
  });

  it('counts clockwise from the gate, with the just-paid node in the first tick', () => {
    expect(binOfPosition(99, 100, 10)).toBe(0);
    expect(binOfPosition(0, 100, 10)).toBe(0);
    expect(binOfPosition(10, 100, 10)).toBe(1);
    expect(binOfPosition(98, 100, 10)).toBe(9);
  });

  it('shades a bright runway ahead of the gate and a wake behind it, dim elsewhere', () => {
    const first = tickShade(0, 200);
    const mid = tickShade(100, 200);
    const last = tickShade(199, 200);
    expect(first.run).toBeGreaterThan(0.9);
    expect(mid.run).toBeLessThan(0.3);
    expect(last.wake).toBeGreaterThan(0.7);
    expect(mid.wake).toBeLessThan(0.01);
    expect(tickShade(0, 0)).toEqual({ run: 0, wake: 0 });
  });
});

describe('pointer geometry', () => {
  it('measures angles clockwise from 12 o clock', () => {
    expect(angleOf(0, -10)).toBeCloseTo(0, 9);
    expect(angleOf(10, 0)).toBeCloseTo(TAU / 4, 9);
    expect(angleOf(0, 10)).toBeCloseTo(TAU / 2, 9);
    expect(angleOf(-10, 0)).toBeCloseTo((TAU * 3) / 4, 9);
  });

  it('recognises the tick band with some slack', () => {
    expect(onBand(0, -100, 90, 104)).toBe(true);
    expect(onBand(0, -60, 90, 104)).toBe(false);
    expect(onBand(0, -112, 90, 104)).toBe(true);
    expect(onBand(0, -140, 90, 104)).toBe(false);
  });
});

describe('laneOffset', () => {
  it('moves one slot toward the gate per block and meets it as the block is due', () => {
    expect(laneOffset(0, 0)).toBe(1);
    expect(laneOffset(0, 1)).toBe(0);
    expect(laneOffset(3, 0.5)).toBe(3.5);
    expect(laneOffset(-1, 0)).toBe(0);
  });
});

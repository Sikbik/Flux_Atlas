import { describe, expect, it } from 'vitest';
import { blocksSinceConfirm, checkinGauge, expiryState, isAtRisk, startBlocksLeft } from './expiry';

describe('check-in arithmetic', () => {
  it('counts blocks since the last check-in and treats 0 as unknown', () => {
    expect(blocksSinceConfirm(1_000, 940)).toBe(60);
    expect(blocksSinceConfirm(1_000, 1_000)).toBe(0);
    expect(blocksSinceConfirm(1_000, 1_005)).toBe(0);
    expect(blocksSinceConfirm(1_000, 0)).toBeNull();
    expect(blocksSinceConfirm(null, 100)).toBeNull();
    expect(blocksSinceConfirm(1_000, null)).toBeNull();
  });

  it('classifies the zones at the documented thresholds (500, 560, 640)', () => {
    expect(expiryState(null)).toBe('unknown');
    expect(expiryState(0)).toBe('healthy');
    expect(expiryState(499)).toBe('healthy');
    expect(expiryState(500)).toBe('due');
    expect(expiryState(559)).toBe('due');
    expect(expiryState(560)).toBe('atRisk');
    expect(expiryState(639)).toBe('atRisk');
    expect(expiryState(640)).toBe('expired');
    expect(isAtRisk(559)).toBe(false);
    expect(isAtRisk(560)).toBe(true);
    expect(isAtRisk(null)).toBe(false);
  });

  it('builds the gauge with the blocks and time left', () => {
    const g = checkinGauge(16);
    expect(g.state).toBe('healthy');
    expect(g.fraction).toBeCloseTo(16 / 640, 6);
    expect(g.blocksToDue).toBe(484);
    expect(g.blocksToRisk).toBe(544);
    expect(g.blocksToExpiry).toBe(624);
    expect(g.msToExpiry).toBe(624 * 30_000);
    const late = checkinGauge(600);
    expect(late.state).toBe('atRisk');
    expect(late.blocksToDue).toBe(0);
    expect(late.blocksToRisk).toBe(0);
    expect(late.blocksToExpiry).toBe(40);
    expect(checkinGauge(900).fraction).toBe(1);
    expect(checkinGauge(null).blocksToExpiry).toBeNull();
  });
});

describe('startBlocksLeft', () => {
  it('counts down the 240-block confirmation window', () => {
    expect(startBlocksLeft(1_100, 1_000)).toBe(140);
    expect(startBlocksLeft(1_300, 1_000)).toBe(0);
    expect(startBlocksLeft(null, 1_000)).toBeNull();
  });
});

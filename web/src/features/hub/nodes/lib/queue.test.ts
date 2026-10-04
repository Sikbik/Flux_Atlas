import { describe, expect, it } from 'vitest';
import type { NodeRef } from '../../../../api/generated/NodeRef';
import type { TierStats } from '../../../../api/generated/TierStats';
import { BLOCKS_PER_DAY, queueRows } from './queue';

const ref = (id: number, tier: NodeRef['tier'], endpoint: string): NodeRef => ({
  id,
  outpoint: `${'ab'.repeat(32)}:${id}`,
  tier,
  endpoint,
  lat: null,
  lon: null,
  country_code: null,
});

const stat = (tier: TierStats['tier'], count: number, payout: string, head: NodeRef | null): TierStats => ({
  tier,
  count,
  collateral: '1000.00000000',
  payout,
  cycle_blocks: count,
  next: head,
});

const STATS: TierStats[] = [
  stat('stratus', 1781, '9.00000000', ref(30, 'stratus', '203.0.113.30:16127')),
  stat('cumulus', 3419, '1.00000000', ref(10, 'cumulus', '203.0.113.10:16127')),
  stat('nimbus', 1641, '3.50000000', null),
];

describe('queueRows', () => {
  it('lists the tiers smallest first, whatever order the server sent', () => {
    expect(queueRows(STATS, null).map((r) => r.tier)).toEqual(['cumulus', 'nimbus', 'stratus']);
  });

  it('says what a block pays and how long one turn of the queue takes', () => {
    const r = queueRows(STATS, null);
    expect(r[2]?.payout).toBe('9.00');
    // 1,781 blocks of about 30 s.
    expect(r[2]?.cycleText).toBe('14h 50m');
    expect(r[2]?.cycleBlocks).toBe(1781);
  });

  it('estimates what a node earns in a day at that pace', () => {
    const r = queueRows(STATS, null);
    expect(r[2]?.perDay).toBeCloseTo((9 * BLOCKS_PER_DAY) / 1781);
    expect(r[2]?.perDayText).toBe('15');
    expect(r[0]?.perDayText).toBe('0.8');
  });

  it('names who is paid next, from the announced payees first', () => {
    const r = queueRows(STATS, {
      height: 100,
      payees: [{ tier: 'stratus', node: 30, address: 'tPayee' }],
    });
    expect(r[2]?.next).toEqual({
      nodeId: 30,
      outpoint: `${'ab'.repeat(32)}:30`,
      endpoint: '203.0.113.30:16127',
      address: 'tPayee',
    });
  });

  it('does not borrow the queue head for a different node than the one announced', () => {
    const r = queueRows(STATS, { height: 100, payees: [{ tier: 'stratus', node: 77, address: 'tPayee' }] });
    expect(r[2]?.next).toEqual({ nodeId: 77, outpoint: null, endpoint: null, address: 'tPayee' });
  });

  it('falls back to the head the stats name, and to nothing for a tier with neither', () => {
    const r = queueRows(STATS, null);
    expect(r[0]?.next?.nodeId).toBe(10);
    expect(r[1]?.next).toBeNull();
  });

  it('leaves out a tier the server sent nothing for, and an empty tier has no cycle', () => {
    const r = queueRows([stat('cumulus', 0, '1.00000000', null)], null);
    expect(r.map((x) => x.tier)).toEqual(['cumulus']);
    expect(r[0]?.cycleText).toBeNull();
    expect(r[0]?.perDay).toBeNull();
    expect(r[0]?.perDayText).toBe('Unknown');
  });
});

import { describe, expect, it } from 'vitest';
import type { ChainBlock } from '../../../store/network';
import { recentPayees } from './payees';

const block = (height: number, payouts: ChainBlock['payouts']): ChainBlock =>
  ({ height, payouts }) as unknown as ChainBlock;

const pay = (tier: 'cumulus' | 'nimbus' | 'stratus', node: number | null, address = `t${node}`) => ({
  tier,
  node,
  address,
  amount: '1.00000000',
});

describe('recentPayees', () => {
  // The store keeps blocks newest first.
  const ring = [
    block(105, [pay('stratus', 5), pay('nimbus', 50)]),
    block(104, [pay('stratus', 4), pay('nimbus', 40)]),
    block(103, [pay('nimbus', 30)]),
    block(102, [pay('stratus', 2), pay('nimbus', 20)]),
    block(101, [pay('stratus', 1)]),
  ];

  it('lists the newest payees of a tier first', () => {
    expect(recentPayees(ring, 'stratus', 3).map((p) => p.node)).toEqual([5, 4, 2]);
    expect(recentPayees(ring, 'nimbus', 2).map((p) => [p.height, p.node])).toEqual([
      [105, 50],
      [104, 40],
    ]);
  });

  it('skips blocks that paid the tier nobody and stops at the limit', () => {
    expect(recentPayees(ring, 'stratus', 10)).toHaveLength(4);
    expect(recentPayees(ring, 'cumulus', 3)).toEqual([]);
    expect(recentPayees(ring, 'stratus', 0)).toEqual([]);
  });

  it('keeps a payee whose node is not known by its address', () => {
    const r = [block(9, [pay('stratus', null, 't1abc')])];
    expect(recentPayees(r, 'stratus', 1)).toEqual([{ height: 9, node: null, address: 't1abc' }]);
  });
});

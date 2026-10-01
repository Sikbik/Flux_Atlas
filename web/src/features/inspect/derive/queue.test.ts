import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, type SyntheticNode } from '../../../api/bin/writer';
import { decodeNodesBin } from '../../../api/nodesBin';
import { NodeTable } from '../../../store/nodeTable';
import { buildQueues, cycleHours, estimatePayment, fluxPerDay, positionOf, queueProgress } from './queue';

/** Tier `tier` nodes with ids base..base+n-1, stored rank = index + 1, paid in rank order. */
function tierNodes(tier: number, base: number, n: number, lastPaidTop: number): SyntheticNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: base + i,
    tier,
    rank: i + 1,
    // The back of a valid snapshot is the newest payment.
    lastPaid: lastPaidTop - (n - 1 - i),
    ip: `10.0.${tier}.${i}:16127`,
  }));
}

function tableOf(nodes: SyntheticNode[]): NodeTable {
  return NodeTable.fromSnapshot(decodeNodesBin(encodeSyntheticNodesBin(nodes)));
}

const row = (t: NodeTable, id: number) => t.indexOf(id);

describe('buildQueues', () => {
  it('orders each tier by the stored rank and indexes positions', () => {
    const t = tableOf([
      ...tierNodes(1, 0, 50, 1_000),
      ...tierNodes(2, 100, 20, 1_000),
      ...tierNodes(3, 200, 10, 1_000),
    ]);
    const q = buildQueues(t);
    expect(q.tiers.cumulus.size).toBe(50);
    expect(q.tiers.nimbus.size).toBe(20);
    expect(q.tiers.stratus.size).toBe(10);
    expect([...q.tiers.stratus.ids.slice(0, 3)]).toEqual([200, 201, 202]);
    expect(positionOf(q, 205)).toEqual({ tier: 'stratus', position: 5, size: 10 });
    expect(positionOf(q, 100)).toEqual({ tier: 'nimbus', position: 0, size: 20 });
    expect(positionOf(q, 9_999)).toBeNull();
    expect(q.tiers.stratus.throughHeight).toBe(1_000);
  });

  it('leaves out nodes that are not queued (rank 0) and nodes of unknown tier', () => {
    const nodes = tierNodes(1, 0, 5, 100);
    nodes[2]!.rank = 0;
    nodes.push({ id: 50, tier: 0, rank: 3 });
    const q = buildQueues(tableOf(nodes));
    expect([...q.tiers.cumulus.ids]).toEqual([0, 1, 3, 4]);
    expect(positionOf(q, 2)).toBeNull();
    expect(positionOf(q, 50)).toBeNull();
  });

  it('rotates payees to the back when the stored ranks are stale (the store only updates lastPaid)', () => {
    const t = tableOf(tierNodes(3, 0, 12, 1_000));
    // Three blocks land: the store records payments of the three nodes at the head, but its
    // rank column is still the snapshot's.
    t.lastPaid[row(t, 0)] = 1_001;
    t.lastPaid[row(t, 1)] = 1_002;
    t.lastPaid[row(t, 2)] = 1_003;
    const q = buildQueues(t);
    expect([...q.tiers.stratus.ids]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]);
    expect(positionOf(q, 3)?.position).toBe(0);
    expect(positionOf(q, 0)?.position).toBe(9);
    expect(q.tiers.stratus.throughHeight).toBe(1_003);
  });

  it('gives the same order when the store already rotates the ranks', () => {
    const stale = tableOf(tierNodes(3, 0, 12, 1_000));
    stale.lastPaid[row(stale, 0)] = 1_001;
    stale.lastPaid[row(stale, 1)] = 1_002;

    const rotated = tableOf(tierNodes(3, 0, 12, 1_000));
    rotated.lastPaid[row(rotated, 0)] = 1_001;
    rotated.lastPaid[row(rotated, 1)] = 1_002;
    // Rotated ranks (plus one): 2..11 move up by two, 0 and 1 go to the back.
    for (let id = 2; id < 12; id++) rotated.rank[row(rotated, id)] = id - 1;
    rotated.rank[row(rotated, 0)] = 11;
    rotated.rank[row(rotated, 1)] = 12;

    expect([...buildQueues(rotated).tiers.stratus.ids]).toEqual([...buildQueues(stale).tiers.stratus.ids]);
  });

  it('follows a rotation spread over several blocks, paid in order', () => {
    const t = tableOf(tierNodes(2, 0, 30, 5_000));
    for (let k = 0; k < 7; k++) t.lastPaid[row(t, k)] = 5_001 + k;
    const ids = buildQueues(t).tiers.nimbus.ids;
    expect(ids[0]).toBe(7);
    expect([...ids.slice(-7)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('moves the authoritative next payee to the head and says so', () => {
    const t = tableOf(tierNodes(1, 0, 10, 700));
    const q = buildQueues(t, { height: 701, payees: [{ tier: 'cumulus', node: 3 }] }, 700);
    expect([...q.tiers.cumulus.ids.slice(0, 4)]).toEqual([3, 0, 1, 2]);
    expect(q.tiers.cumulus.headCorrected).toBe(true);
    expect(positionOf(q, 3)?.position).toBe(0);
  });

  it('ignores next payees that are not for the next block, or already agree', () => {
    const t = tableOf(tierNodes(1, 0, 10, 700));
    const stale = buildQueues(t, { height: 700, payees: [{ tier: 'cumulus', node: 3 }] }, 700);
    expect(stale.tiers.cumulus.ids[0]).toBe(0);
    expect(stale.tiers.cumulus.headCorrected).toBe(false);
    const agree = buildQueues(t, { height: 701, payees: [{ tier: 'cumulus', node: 0 }] }, 700);
    expect(agree.tiers.cumulus.headCorrected).toBe(false);
    const unknown = buildQueues(t, { height: 701, payees: [{ tier: 'cumulus', node: 999 }] }, 700);
    expect(unknown.tiers.cumulus.ids[0]).toBe(0);
    const none = buildQueues(t, { height: 701, payees: [{ tier: 'cumulus', node: null }] }, 700);
    expect(none.tiers.cumulus.headCorrected).toBe(false);
  });

  it('handles an empty table and sparse ids', () => {
    const q = buildQueues(tableOf([]));
    expect(q.tiers.cumulus.size).toBe(0);
    const t = tableOf([{ id: 4_000, tier: 3, rank: 1, lastPaid: 10, ip: '1.1.1.1:16127' }]);
    expect(positionOf(buildQueues(t), 4_000)).toEqual({ tier: 'stratus', position: 0, size: 1 });
  });

  it('closes the gap when a node leaves the table', () => {
    const t = tableOf(tierNodes(3, 0, 6, 100));
    t.remove(1);
    const q = buildQueues(t);
    expect([...q.tiers.stratus.ids]).toEqual([0, 2, 3, 4, 5]);
    expect(positionOf(q, 2)?.position).toBe(1);
  });
});

describe('estimatePayment', () => {
  it('puts the next block one interval after the tip and each slot one more', () => {
    const e0 = estimatePayment(0, 1_764, 2_997_000, 1_000_000, 1_010_000);
    expect(e0.blocks).toBe(1);
    expect(e0.payingHeight).toBe(2_997_001);
    expect(e0.atMs).toBe(1_030_000);
    expect(e0.etaMs).toBe(20_000);
    const e9 = estimatePayment(9, 1_764, 2_997_000, 1_000_000, 1_010_000);
    expect(e9.etaMs).toBe(9 * 30_000 + 20_000);
    expect(e9.payingHeight).toBe(2_997_010);
  });

  it('never reports a negative wait for a late block', () => {
    expect(estimatePayment(0, 10, 100, 0, 90_000).etaMs).toBe(0);
  });
});

describe('queue arithmetic', () => {
  it('derives cycle length, daily earnings and progress', () => {
    expect(cycleHours(1_764)).toBeCloseTo(14.7, 5);
    expect(cycleHours(3_378)).toBeCloseTo(28.15, 2);
    expect(fluxPerDay(9, 1_764)).toBeCloseTo(14.694, 2);
    expect(fluxPerDay(9, 0)).toBeNull();
    expect(fluxPerDay(Number.NaN, 10)).toBeNull();
    expect(queueProgress(0, 100)).toBe(1);
    expect(queueProgress(99, 100)).toBe(0);
    expect(queueProgress(0, 1)).toBe(1);
  });
});

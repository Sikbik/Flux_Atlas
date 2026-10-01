// Payment-queue ranks maintained by the client (ARCHITECTURE section 8, rank contract). The rules
// mirror the server's model of the clients (`atlas_engine::state::queue::ClientRanks`), which is
// what makes its `cause: reconcile` corrections exact.

import { describe, expect, it } from 'vitest';
import type { NodeLite } from '../api/generated/NodeLite';
import type { NodesDelta } from '../api/generated/NodesDelta';
import { statusCode, tierCode } from '../api/nodesBin';
import { blockMsg, bootstrap, hex64, live, syntheticNodesBin } from '../testing/fixtures';
import { NetworkStore, NodeField, type StoreChange } from './network';

const C = tierCode('cumulus');
const N = tierCode('nimbus');

/** A 12-node store whose queues are exactly `queues` (tier code -> ids in rank order). */
function queued(queues: Record<number, number[]>): NetworkStore {
  const s = new NetworkStore({ now: () => 5_000_000 });
  s.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(12, 100) });
  const t = s.nodes;
  for (let i = 0; i < t.count; i++) {
    t.rank[i] = 0;
    t.tier[i] = C;
    t.status[i] = statusCode('confirmed');
  }
  for (const [tier, ids] of Object.entries(queues)) {
    ids.forEach((id, r) => {
      const i = t.indexOf(id);
      t.tier[i] = Number(tier);
      t.rank[i] = r + 1;
    });
  }
  return s;
}

/** Ids of `tier` in rank order; asserts the ranks are dense 0..n-1. */
function order(s: NetworkStore, tier: number): number[] {
  const t = s.nodes;
  const rows: [number, number][] = [];
  for (let i = 0; i < t.count; i++)
    if (t.tier[i] === tier && t.rank[i]! > 0) rows.push([t.rank[i]! - 1, t.ids[i]!]);
  rows.sort((a, b) => a[0] - b[0]);
  expect(rows.map((r) => r[0])).toEqual(rows.map((_, k) => k));
  return rows.map((r) => r[1]);
}

const delta = (seq: number, body: Partial<NodesDelta>) =>
  live('nodes', seq, { prev_seq: 0, added: [], removed: [], changed: [], cause: 'block', ...body });

const lite = (id: number, extra: Partial<NodeLite> = {}): NodeLite => ({
  id,
  outpoint: `${hex64(id)}:0`,
  endpoint: '9.9.9.9:16137',
  tier: 'cumulus',
  status: 'confirmed',
  lat: null,
  lon: null,
  country_code: null,
  org: null,
  rank: null,
  last_paid_height: null,
  app_count: 0,
  flags: 0,
  ...extra,
});

describe('payment queue ranks (rank contract)', () => {
  it('rotates each payee to the back of its tier on a block', () => {
    const s = queued({ [C]: [0, 1, 2, 3], [N]: [4, 5, 6] });
    const changes: StoreChange[] = [];
    s.subscribe((c) => changes.push(c));
    s.apply(live('block', 101, blockMsg(2_996_915, { payees: [0, 5] })));
    expect(order(s, C)).toEqual([1, 2, 3, 0]);
    expect(order(s, N)).toEqual([4, 6, 5]);
    expect(changes[0]!.nodes!.fields & NodeField.Rank).toBeTruthy();
    expect(changes[0]!.nodes!.changed).toEqual(expect.arrayContaining([0, 1, 2, 3, 5, 6]));
    // A payee the client does not rank (or does not know) changes nothing.
    s.apply(live('block', 102, blockMsg(2_996_916, { payees: [9, 999] })));
    expect(order(s, C)).toEqual([1, 2, 3, 0]);
  });

  it('closes the gap when a node is removed', () => {
    const s = queued({ [C]: [0, 1, 2, 3] });
    s.apply(delta(101, { removed: [1], cause: 'reconcile' }));
    expect(order(s, C)).toEqual([0, 2, 3]);
  });

  it('(a) drops a node whose status leaves confirmed, closing the gap', () => {
    const s = queued({ [C]: [0, 1, 2, 3, 4] });
    s.apply(delta(101, { changed: [{ id: 2, status: 'expired' }] }));
    expect(order(s, C)).toEqual([0, 1, 3, 4]);
    expect(s.nodes.rank[s.nodes.indexOf(2)]).toBe(0);
    // Staying confirmed keeps the place.
    s.apply(delta(102, { prev_seq: 101, changed: [{ id: 3, status: 'confirmed' }] }));
    expect(order(s, C)).toEqual([0, 1, 3, 4]);
  });

  it('(b) inserts an unranked node that receives a rank, shifting the rest back', () => {
    const s = queued({ [C]: [0, 1, 2, 3] });
    s.nodes.status[s.nodes.indexOf(7)] = statusCode('started');
    s.apply(delta(101, { changed: [{ id: 7, status: 'confirmed', rank: 1 }] }));
    expect(order(s, C)).toEqual([0, 7, 1, 2, 3]);
    // Past the end: clamped to the back.
    s.apply(delta(102, { prev_seq: 101, changed: [{ id: 8, rank: 50 }] }));
    expect(order(s, C)).toEqual([0, 7, 1, 2, 3, 8]);
  });

  it('enters added nodes at their rank, ascending', () => {
    const s = queued({ [C]: [0, 1, 2] });
    s.apply(
      delta(101, {
        added: [lite(501, { rank: 3 }), lite(500, { rank: 0 }), lite(502, { status: 'started', rank: null })],
      }),
    );
    expect(order(s, C)).toEqual([500, 0, 1, 501, 2]);
    expect(s.nodes.rank[s.nodes.indexOf(502)]).toBe(0);
  });

  it('moves an already ranked node to a new rank outside a reconcile', () => {
    const s = queued({ [C]: [0, 1, 2, 3] });
    s.apply(delta(101, { changed: [{ id: 3, rank: 0 }] }));
    expect(order(s, C)).toEqual([3, 0, 1, 2]);
  });

  it('keeps the held rank when a known node is re-added without one', () => {
    const s = queued({ [C]: [0, 1, 2] });
    s.apply(delta(101, { added: [lite(1, { rank: null })] }));
    expect(order(s, C)).toEqual([0, 1, 2]);
  });

  it('applies reconcile ranks as authoritative, without shifting others', () => {
    const s = queued({ [C]: [0, 1, 2, 3] });
    // The server saw the client model diverge (0 and 1 swapped) and sends the truth.
    s.apply(
      delta(101, {
        cause: 'reconcile',
        changed: [
          { id: 1, rank: 0 },
          { id: 0, rank: 1 },
        ],
      }),
    );
    expect(order(s, C)).toEqual([1, 0, 2, 3]);
    // An unranked node gets its exact rank too; the rest of the corrections come with it.
    s.apply(
      delta(102, {
        prev_seq: 101,
        cause: 'reconcile',
        changed: [
          { id: 9, rank: 2 },
          { id: 2, rank: 3 },
          { id: 3, rank: 4 },
        ],
      }),
    );
    expect(order(s, C)).toEqual([1, 0, 9, 2, 3]);
  });

  it('unranks a node on an authoritative rank: null, without shifting others', () => {
    const s = queued({ [C]: [0, 1, 2, 3] });
    // The true queue dropped node 1 while it stays confirmed: the reconcile sends `rank: null`
    // for it, and the authoritative ranks of the nodes behind it.
    s.apply(
      delta(101, {
        cause: 'reconcile',
        changed: [
          { id: 1, rank: null },
          { id: 2, rank: 1 },
          { id: 3, rank: 2 },
        ],
      }),
    );
    expect(order(s, C)).toEqual([0, 2, 3]);
    const i = s.nodes.indexOf(1);
    expect(s.nodes.rank[i]).toBe(0);
    expect(s.nodes.status[i]).toBe(statusCode('confirmed'));
  });

  it('treats rank: null outside a reconcile as an exit that closes the gap', () => {
    const s = queued({ [C]: [0, 1, 2, 3], [N]: [4, 5] });
    s.apply(delta(101, { changed: [{ id: 1, rank: null }] }));
    expect(order(s, C)).toEqual([0, 2, 3]);
    expect(order(s, N)).toEqual([4, 5]);
    expect(s.nodes.rank[s.nodes.indexOf(1)]).toBe(0);
    // Absent rank is unchanged; a later rank enters the node again (rule 5).
    s.apply(delta(102, { prev_seq: 101, changed: [{ id: 1, flags: 0 }] }));
    expect(order(s, C)).toEqual([0, 2, 3]);
    s.apply(delta(103, { prev_seq: 102, changed: [{ id: 1, rank: 3 }] }));
    expect(order(s, C)).toEqual([0, 2, 3, 1]);
  });

  it('ignores rank: null for a node that is not queued', () => {
    const s = queued({ [C]: [0, 1] });
    s.apply(delta(101, { changed: [{ id: 7, rank: null }] }));
    expect(order(s, C)).toEqual([0, 1]);
    expect(s.nodes.rank[s.nodes.indexOf(7)]).toBe(0);
  });

  it('mirrors the server model across a block followed by deltas', () => {
    // Server: payee 0 rotates; node 2 expires; node 6 joins at rank 1. Truth: [1, 6, 3, 0].
    const s = queued({ [C]: [0, 1, 2, 3] });
    s.nodes.status[s.nodes.indexOf(6)] = statusCode('started');
    s.apply(live('block', 101, blockMsg(2_996_915, { payees: [0] })));
    s.apply(
      delta(102, {
        changed: [
          { id: 2, status: 'expired' },
          { id: 6, status: 'confirmed', rank: 1 },
        ],
      }),
    );
    expect(order(s, C)).toEqual([1, 6, 3, 0]);
  });
});

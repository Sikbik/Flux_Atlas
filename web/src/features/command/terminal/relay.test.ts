import { beforeAll, describe, expect, it } from 'vitest';
import type { AtlasRuntime } from '../../../app/runtime';
import { NetworkStore } from '../../../store/network';
import { blockMsg, bootstrap, live, syntheticNodesBin } from '../../../testing/fixtures';
import { replayMessage } from './relay';

let runtime: AtlasRuntime;

beforeAll(() => {
  const store = new NetworkStore();
  store.loadSnapshot({ bootstrap: bootstrap(100, 2_996_914), nodes: syntheticNodesBin(60) });
  store.apply(live('block', 101, blockMsg(2_996_915, { producer: 7, payees: [10, 20, 30] })));
  runtime = { store, clock: { now: () => 1_234_567 } } as unknown as AtlasRuntime;
});

describe('moon replay', () => {
  it('rebuilds the relay of the newest stored block', () => {
    const msg = replayMessage(runtime);
    expect(msg?.t).toBe('block');
    if (msg?.t !== 'block') return;
    const newest = runtime.store.blocks.newest();
    expect(msg.height).toBe(newest?.height);
    expect(msg.hash).toBe(newest?.hash);
    expect(msg.payouts).toHaveLength(3);
    expect(msg.reward).toBe('14.00000000');
    expect(msg.dev_fund).toBe('0.50010000');
    expect(msg.observed_ms).toBe(1_234_567);
  });

  it('links to the stored parent block when there is one', () => {
    const msg = replayMessage(runtime);
    if (msg?.t !== 'block') throw new Error('expected a block message');
    const parent = runtime.store.blocks.toArray().find((b) => b.height === msg.height - 1);
    expect(msg.prev_hash).toBe(parent?.hash ?? '');
    expect(msg.prev_hash).not.toBe('');
  });

  it('performs the relay only: every other child event of the block is empty', () => {
    const msg = replayMessage(runtime);
    if (msg?.t !== 'block') throw new Error('expected a block message');
    const lists = Object.entries(msg).filter(([k, v]) => Array.isArray(v) && k !== 'payouts');
    // The child events the generated BlockMsg carries today; a new one must be decided on in relay.ts.
    expect(lists.map(([k]) => k).sort()).toEqual([
      'app_payments',
      'collateral_spent',
      'confirms',
      'heartbeats',
      'starts',
      'transfers_over_threshold',
      'updates',
    ]);
    for (const [, v] of lists) expect(v).toEqual([]);
  });

  it('says nothing when the store holds no block yet', () => {
    const empty = { store: new NetworkStore(), clock: { now: () => 0 } } as unknown as AtlasRuntime;
    expect(replayMessage(empty)).toBeNull();
  });
});

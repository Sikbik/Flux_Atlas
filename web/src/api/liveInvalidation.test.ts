import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { blockMsg, live, summary } from '../testing/fixtures';
import { createLiveInvalidator } from './liveInvalidation';
import { qk } from './queryKeys';

function setup() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  let now = 0;
  const inv = createLiveInvalidator(qc, { scheduler: { now: () => now, setTimeout, clearTimeout } });
  const keys = () => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
  return { qc, spy, inv, keys, advance: (ms: number) => (now += ms) };
}

describe('live query invalidation', () => {
  it('refreshes block lists and open node views on every block', () => {
    const { inv, keys } = setup();
    inv(live('block', 1, blockMsg(100)));
    expect(keys()).toContain(JSON.stringify(qk.blocks.all()));
    expect(keys()).toContain(JSON.stringify([...qk.nodes.all(), 'detail']));
  });

  it('patches the network summary from stats without a refetch', () => {
    const { qc, inv, spy } = setup();
    inv(live('stats', 1, { summary: summary(7) }));
    expect(qc.getQueryData(qk.network.summary())).toMatchObject({ tip: { height: 7 } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('throttles chatty sources and targets changed nodes', () => {
    const { inv, keys, advance } = setup();
    const nodes = (seq: number) =>
      live('nodes', seq, {
        prev_seq: 0,
        added: [],
        removed: [3],
        changed: [{ id: 4, rank: 1 }],
        cause: 'block',
      });
    inv(nodes(1));
    inv(nodes(2));
    const list = JSON.stringify([...qk.nodes.all(), 'list']);
    expect(keys().filter((k) => k === list).length).toBe(1);
    expect(keys()).toContain(JSON.stringify(qk.nodes.detail(3)));
    expect(keys()).toContain(JSON.stringify(qk.nodes.detail(4)));
    advance(5_000);
    inv(nodes(3));
    expect(keys().filter((k) => k === list).length).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, type SyntheticNode } from '../../../api/bin/writer';
import { decodeNodesBin, STATUS_CODES } from '../../../api/nodesBin';
import { NodeTable, Reach } from '../../../store/nodeTable';
import { snapshotOf, WatchEngine } from './engine';

function tableOf(nodes: SyntheticNode[]): NodeTable {
  return NodeTable.fromSnapshot(decodeNodesBin(encodeSyntheticNodesBin(nodes)));
}

const CONFIRMED = STATUS_CODES.indexOf('confirmed');

function world(height = 1_000) {
  const nodes = tableOf(
    [1, 2, 3].map((id) => ({
      id,
      tier: 3,
      rank: id,
      lastPaid: 100 + id,
      status: CONFIRMED,
      ip: `10.0.0.${id}:16127`,
    })),
  );
  const store = { nodes, tip: { height }, loaded: true } as never as Parameters<typeof snapshotOf>[0];
  const set = (h: number) => {
    (store as unknown as { tip: { height: number } }).tip = { height: h };
  };
  return { store, nodes, set };
}

describe('snapshotOf', () => {
  it('reads a node from the live table and merges the server check-in height', () => {
    const { store, nodes } = world();
    nodes.lastConfirmed[nodes.indexOf(2)] = 800;
    expect(snapshotOf(store, 2, 700)).toMatchObject({
      present: true,
      status: 'confirmed',
      endpoint: '10.0.0.2:16127',
      lastPaid: 102,
      lastConfirmed: 800,
      tip: 1_000,
    });
    expect(snapshotOf(store, 2, 900).lastConfirmed).toBe(900);
  });

  it('reports a node the table does not know as absent', () => {
    const { store } = world();
    expect(snapshotOf(store, 99, 5)).toMatchObject({ present: false, endpoint: '', lastConfirmed: 5 });
  });
});

describe('WatchEngine', () => {
  it('raises nothing on the first look and then each change once', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    expect(e.look(store, [1, 2], 0)).toEqual([]);

    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    nodes.lastPaid[nodes.indexOf(2)] = 1_000;
    const alerts = e.look(store, [1, 2], 1_000);
    expect(alerts.map((a) => [a.kind, a.id])).toEqual([
      ['offline', 1],
      ['paid', 2],
    ]);
    expect(alerts[0]!.endpoint).toBe('10.0.0.1:16127');
    expect(e.look(store, [1, 2], 2_000)).toEqual([]);
  });

  it('warns when the check-in age crosses 560 blocks, using the server height before any live check-in', () => {
    const { store, set } = world(1_000);
    const e = new WatchEngine();
    e.setBase(3, 450);
    expect(e.look(store, [3], 0)).toEqual([]);
    set(1_011);
    const alerts = e.look(store, [3], 30_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'at_risk', id: 3, detail: 561 });
  });

  it('reports an address change with the old and the new address', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    e.look(store, [1], 0);
    nodes.setEndpoint(nodes.indexOf(1), '10.9.9.9:16127');
    const [a] = e.look(store, [1], 1_000);
    expect(a).toMatchObject({ kind: 'ip_changed', endpoint: '10.9.9.9:16127', from: '10.0.0.1:16127' });
  });

  it('reports a node that leaves the table as expired', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    e.look(store, [1, 2], 0);
    nodes.remove(2);
    const alerts = e.look(store, [1, 2], 1_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'expired', id: 2, endpoint: '10.0.0.2:16127' });
  });

  it('records a baseline without alerting, for a reloaded table', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    e.look(store, [1], 0);
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    expect(e.look(store, [1], 1_000, true)).toEqual([]);
    expect(e.look(store, [1], 2_000)).toEqual([]);
  });

  it('does nothing until the table is loaded', () => {
    const { store, nodes } = world();
    (store as unknown as { loaded: boolean }).loaded = false;
    const e = new WatchEngine();
    expect(e.look(store, [1], 0)).toEqual([]);
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    (store as unknown as { loaded: boolean }).loaded = true;
    // The first look after loading is the baseline, not an alert.
    expect(e.look(store, [1], 1_000)).toEqual([]);
  });

  it('starts a node that is watched again from a fresh baseline', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    e.look(store, [1], 0);
    e.prune(new Set());
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    expect(e.look(store, [1], 1_000)).toEqual([]);
  });

  it('merges the same alert repeated inside the window', () => {
    const { store, nodes } = world();
    const e = new WatchEngine();
    e.look(store, [1], 0);
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    expect(e.look(store, [1], 1_000)).toHaveLength(1);
    nodes.reachable[nodes.indexOf(1)] = Reach.Yes;
    e.look(store, [1], 2_000);
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    expect(e.look(store, [1], 3_000)).toHaveLength(0);
    nodes.reachable[nodes.indexOf(1)] = Reach.Yes;
    e.look(store, [1], 20_000);
    nodes.reachable[nodes.indexOf(1)] = Reach.No;
    expect(e.look(store, [1], 21_000)).toHaveLength(1);
  });
});

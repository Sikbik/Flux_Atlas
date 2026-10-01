import { describe, expect, it, vi } from 'vitest';
import { encodeMeshBin } from '../api/bin/writer';
import type { NodeLite } from '../api/generated/NodeLite';
import { decodeMeshBin } from '../api/meshBin';
import { NodeFlag, statusCode } from '../api/nodesBin';
import { blockMsg, bootstrap, hex64, live, summary, syntheticNodesBin } from '../testing/fixtures';
import { NetworkStore, NodeField, Slice, type StoreChange } from './network';
import { Ring } from './ring';

function loaded(opts: ConstructorParameters<typeof NetworkStore>[0] = {}, count = 200) {
  const s = new NetworkStore({ now: () => 5_000_000, ...opts });
  s.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(count, 100) });
  return s;
}

const lite = (id: number, extra: Partial<NodeLite> = {}): NodeLite => ({
  id,
  outpoint: `${hex64(id)}:0`,
  endpoint: '9.9.9.9:16137',
  tier: 'nimbus',
  status: 'started',
  lat: 60.17,
  lon: 24.94,
  country_code: 'FI',
  org: 'New Provider',
  rank: null,
  last_paid_height: null,
  app_count: 0,
  flags: 0x04,
  ...extra,
});

describe('Ring', () => {
  it('keeps the newest items, newest first, with a stable array per version', () => {
    const r = new Ring<number>(3);
    for (const x of [1, 2, 3, 4, 5]) r.push(x);
    expect(r.toArray()).toEqual([5, 4, 3]);
    expect(r.toArray()).toBe(r.toArray());
    const before = r.toArray();
    r.push(6);
    expect(r.toArray()).not.toBe(before);
    expect(r.newest()).toBe(6);
    r.reset([1, 2, 3, 4]);
    expect(r.toArray()).toEqual([4, 3, 2]);
    expect(r.replaceWhere((x) => x === 3, 30)).toBe(true);
    expect(r.toArray()).toEqual([4, 30, 2]);
  });
});

describe('NetworkStore snapshot', () => {
  it('loads nodes, blocks, apps, summary and seq', () => {
    const s = loaded();
    expect(s.nodes.count).toBe(200);
    expect(s.nodes.indexOf(42)).toBe(42);
    expect(s.nodes.endpoint(3)).toBe('5.0.0.3:16127');
    expect(s.nodes.countryCode(1)).toBe('US');
    expect(s.blocks.size).toBe(30);
    expect(s.blocks.newest()?.height).toBe(2_996_914);
    expect(s.apps.get('kadenanode')?.instances_running).toBe(3);
    expect(s.tip?.height).toBe(2_996_914);
    expect(s.seq).toBe(100);
    expect(s.loaded).toBe(true);
  });

  it('seeds next payees from the bootstrap; live messages for the same or a newer height replace them', () => {
    const s = new NetworkStore();
    const boot = {
      ...bootstrap(100),
      next_payees: { height: 2_996_915, payees: [{ tier: 'stratus' as const, node: 30, address: 'a' }] },
    };
    s.loadSnapshot({ bootstrap: boot, nodes: syntheticNodesBin(10, 100) });
    expect(s.nextPayees?.height).toBe(2_996_915);
    expect(s.nextPayees?.payees[0]?.node).toBe(30);
    s.apply(
      live('next_payees', 101, { height: 2_996_915, payees: [{ tier: 'stratus', node: 31, address: 'b' }] }),
      1,
    );
    expect(s.nextPayees?.payees[0]?.node).toBe(31);
    // A resync body older than the live value does not roll it back.
    s.loadSnapshot({ bootstrap: { ...boot, seq: 100 }, nodes: syntheticNodesBin(10, 100) });
    expect(s.nextPayees?.payees[0]?.node).toBe(31);
    s.apply(
      live('next_payees', 103, { height: 2_996_916, payees: [{ tier: 'stratus', node: 32, address: 'c' }] }),
      2,
    );
    expect(s.nextPayees?.height).toBe(2_996_916);
  });

  it('notifies once per batch with the slices touched', () => {
    const s = new NetworkStore();
    const seen: StoreChange[] = [];
    s.subscribe((c) => seen.push(c));
    s.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(10, 100) });
    expect(seen.length).toBe(1);
    expect(seen[0]!.slices & Slice.Nodes).toBeTruthy();
    expect(seen[0]!.slices & Slice.Blocks).toBeTruthy();
    expect(seen[0]!.nodes?.reloaded).toBe(true);
  });
});

describe('nodes deltas', () => {
  it('adds, removes and changes nodes, interning new strings and clusters', () => {
    const s = loaded();
    const changes: StoreChange[] = [];
    s.subscribe((c) => changes.push(c));
    s.apply(
      live('nodes', 101, {
        prev_seq: 90,
        added: [lite(5000)],
        removed: [0],
        changed: [
          { id: 7, status: 'dos', rank: 4 },
          { id: 8, lat: 60.17, lon: 24.94, country_code: 'FI' },
          { id: 9, endpoint: '1.1.1.1:16147', flux_os: '8.21.0', reachable: false },
        ],
        cause: 'reconcile',
      }),
    );
    const t = s.nodes;
    expect(t.count).toBe(200);
    expect(t.has(0)).toBe(false);
    // Swap-remove moved the last row into slot 0.
    expect(t.ids[0]).toBe(199);
    expect(t.indexOf(199)).toBe(0);
    const i = t.indexOf(5000);
    expect(i).toBe(199);
    expect(t.endpoint(i)).toBe('9.9.9.9:16137');
    expect(t.countryCode(i)).toBe('FI');
    expect(t.orgName(i)).toBe('New Provider');
    expect(t.rank[i]).toBe(0);
    expect(t.status[i]).toBe(statusCode('started'));
    // New coordinates became a new cluster, shared by node 8 which moved there.
    expect(t.loc[i]).toBeGreaterThan(10);
    expect(t.loc[t.indexOf(8)]).toBe(t.loc[i]);
    expect(t.locations.nodeCount(t.loc[i]!)).toBe(2);
    expect(t.status[t.indexOf(7)]).toBe(statusCode('dos'));
    expect(t.rank[t.indexOf(7)]).toBe(5);
    expect(t.endpoint(t.indexOf(9))).toBe('1.1.1.1:16147');
    expect(t.fluxOs(t.indexOf(9))).toBe('8.21.0');
    expect(changes.length).toBe(1);
    const nc = changes[0]!.nodes!;
    expect(nc.structural).toBe(true);
    expect(nc.added).toEqual([5000]);
    expect(nc.removed).toEqual([0]);
    // Node 7 left the queue (status dos), so the ranks behind it were renumbered too.
    expect(nc.changed).toEqual(expect.arrayContaining([7, 8, 9]));
    expect(nc.fields & NodeField.Geo).toBeTruthy();
    expect(nc.fields & NodeField.Endpoint).toBeTruthy();
    expect(s.seq).toBe(101);
  });

  it('grows past the snapshot capacity', () => {
    const s = loaded({}, 10);
    const added = Array.from({ length: 100 }, (_, k) => lite(1000 + k));
    s.apply(live('nodes', 101, { prev_seq: 0, added, removed: [], changed: [], cause: 'block' }));
    expect(s.nodes.count).toBe(110);
    expect(s.nodes.capacity).toBeGreaterThanOrEqual(110);
    expect(s.nodes.endpoint(s.nodes.indexOf(1099))).toBe('9.9.9.9:16137');
    expect(s.nodes.endpoint(3)).toBe('5.0.0.3:16127');
    expect(s.nodes.view('ids').length).toBe(110);
  });

  it('skips deltas already in the snapshot and detects gaps', () => {
    const onGap = vi.fn();
    const s = loaded({ onGap });
    s.apply(
      live('nodes', 99, { prev_seq: 80, added: [lite(9999)], removed: [], changed: [], cause: 'block' }),
    );
    expect(s.nodes.has(9999)).toBe(false);
    expect(s.stats.skippedStale).toBe(1);
    // First delta after the snapshot: its predecessor must be inside the snapshot.
    s.apply(
      live('nodes', 110, { prev_seq: 105, added: [lite(9999)], removed: [], changed: [], cause: 'block' }),
    );
    expect(s.nodes.has(9999)).toBe(false);
    expect(onGap).toHaveBeenCalledWith('nodes', { expected: null, prevSeq: 105, seq: 110 });
    s.apply(
      live('nodes', 111, { prev_seq: 97, added: [lite(9999)], removed: [], changed: [], cause: 'block' }),
    );
    expect(s.nodes.has(9999)).toBe(true);
    s.apply(live('nodes', 115, { prev_seq: 112, added: [], removed: [9999], changed: [], cause: 'block' }));
    expect(s.nodes.has(9999)).toBe(true);
    expect(onGap).toHaveBeenCalledTimes(2);
    s.apply(live('nodes', 116, { prev_seq: 111, added: [], removed: [9999], changed: [], cause: 'block' }));
    expect(s.nodes.has(9999)).toBe(false);
  });
});

describe('block messages', () => {
  it('pushes the block, moves the tip, and applies payouts and heartbeats', () => {
    const s = loaded();
    const t = s.nodes;
    t.flags[50] = t.flags[50]! | NodeFlag.RecentlyPaid;
    t.lastPaid[50] = 2_996_900;
    s.apply(
      live('mempool', 101, { txs: [{ txid: hex64(1), value: '1.00000000', kind: 'transfer', size: 250 }] }),
      900_000,
    );
    s.apply(
      live('mempool', 102, {
        txs: [{ txid: hex64(2), value: '0.00000000', kind: 'node_confirm', size: 200 }],
      }),
      2_000_000,
    );
    const m = blockMsg(2_996_915, {
      heartbeats: [1, 2, 3],
      confirms: [4],
      producer: 7,
      payees: [10, 20, 30],
    });
    t.status[4] = statusCode('started');
    s.apply(live('block', 103, m, 1_031_000));
    expect(s.blocks.newest()?.height).toBe(2_996_915);
    expect(s.blocks.newest()?.live).toBe(true);
    expect(s.blocks.newest()?.confirmCount).toBe(4);
    expect(s.tip?.height).toBe(2_996_915);
    expect(t.lastPaid[10]).toBe(2_996_915);
    expect(t.flags[20]! & NodeFlag.RecentlyPaid).toBeTruthy();
    expect(t.lastConfirmed[2]).toBe(2_996_915);
    expect(t.status[4]).toBe(statusCode('confirmed'));
    // Paid 15 blocks ago: the flag ages out.
    expect(t.flags[50]! & NodeFlag.RecentlyPaid).toBe(0);
    // Seen before the header time: mined. Seen after: still pending.
    expect(s.mempool.has(hex64(1))).toBe(false);
    expect(s.mempool.has(hex64(2))).toBe(true);
  });

  it('merges a live block into its bootstrap row and caps the ring at 100', () => {
    const s = loaded();
    s.apply(live('block', 101, blockMsg(2_996_914), 1_000_500));
    expect(s.blocks.size).toBe(30);
    expect(s.blocks.newest()?.live).toBe(true);
    for (let h = 2_996_915; h < 2_996_915 + 120; h++) s.apply(live('block', h - 2_996_000, blockMsg(h)));
    expect(s.blocks.size).toBe(100);
    expect(s.blocks.newest()?.height).toBe(2_996_915 + 119);
  });

  it('drops orphaned blocks on reorg', () => {
    const s = loaded();
    s.apply(
      live('reorg', 101, {
        fork_height: 2_996_910,
        from_height: 2_996_911,
        to_height: 2_996_914,
        orphaned: [],
      }),
    );
    expect(s.blocks.newest()?.height).toBe(2_996_910);
  });
});

describe('other slices', () => {
  it('keeps the feed ring at 500', () => {
    const s = loaded();
    for (let k = 0; k < 600; k++) {
      s.apply(
        live('feed', 200 + k, {
          kind: 'node_joined',
          ts_ms: k,
          text_key: 'feed.node_joined',
          refs: [],
          params: {},
        }),
      );
    }
    expect(s.feed.size).toBe(500);
    expect(s.feed.newest()?.seq).toBe(799);
  });

  it('applies mesh snapshots and deltas', () => {
    const s = loaded();
    s.loadMesh(
      decodeMeshBin(
        encodeMeshBin([
          [1, 2, 1],
          [2, 3, 0],
        ]),
      ),
    );
    const changes: StoreChange[] = [];
    s.subscribe((c) => changes.push(c));
    s.apply(
      live('mesh', 101, {
        added: [
          [9, 4],
          [1, 2],
        ],
        removed: [[3, 2]],
        reporters: [4],
      }),
    );
    expect(s.mesh.size).toBe(2);
    expect(changes[0]!.mesh).toEqual({ reloaded: false, added: [[4, 9]], removed: [[2, 3]] });
    const e = s.meshEdges();
    expect(Array.from(e.a)).toEqual([1, 4]);
    expect(Array.from(e.b)).toEqual([2, 9]);
    expect(Array.from(e.flags)).toEqual([1, 0]);
    expect(s.meshEdges()).toBe(e);
  });

  it('tracks next payees, pending apps, installs, and app instances', () => {
    const s = loaded();
    s.apply(
      live('next_payees', 101, { height: 2_996_915, payees: [{ tier: 'stratus', node: 30, address: 'x' }] }),
      1,
    );
    expect(s.nextPayees?.height).toBe(2_996_915);
    s.apply(
      live('app_pending', 102, {
        hash: hex64(9),
        app: 'kadenanode',
        kind: 'update',
        received_ms: 10,
        expires_ms: 3_600_010,
      }),
    );
    s.apply(live('app_installing', 103, { app: 'kadenanode', node: 42, endpoint: '5.0.0.42:16127' }), 100);
    expect(s.pendingList()[0]?.state).toBe('pending');
    expect(s.installing.size).toBe(1);
    s.apply(live('app_pending_resolved', 104, { hash: hex64(9), app: 'kadenanode', mined: true }), 200);
    expect(s.pendingApps.get(hex64(9))?.state).toBe('mined');
    s.apply(
      live('apps', 105, {
        prev_seq: 50,
        upserted: [],
        removed: [],
        instances: [{ app: 'kadenanode', started: [42], removed: [], updated: [] }],
        cause: 'sweep',
      }),
    );
    expect(s.apps.get('kadenanode')?.instances_running).toBe(4);
    expect(s.installing.size).toBe(0);
    s.prune(200 + 11 * 60_000);
    expect(s.pendingApps.size).toBe(0);
  });

  it('expires unmined pending apps as a visible end state', () => {
    const s = loaded();
    s.apply(
      live('app_pending', 101, {
        hash: hex64(8),
        app: 'x',
        kind: 'register',
        received_ms: 0,
        expires_ms: 1_000,
      }),
    );
    s.prune(2_000);
    expect(s.pendingApps.get(hex64(8))?.state).toBe('expired');
  });

  it('applies stats to summary, price and tip', () => {
    const s = loaded();
    const price = {
      usd: 0.31,
      btc: 0.000004,
      change_24h_pct: 1.2,
      market_cap_usd: 1,
      volume_24h_usd: 1,
      updated_ms: 1,
      source: 'insight',
    };
    s.apply(live('stats', 101, { summary: summary(2_996_920, { price }) }));
    expect(s.summary?.tip?.height).toBe(2_996_920);
    expect(s.price?.usd).toBe(0.31);
    expect(s.tip?.height).toBe(2_996_920);
    expect(s.versions.Price).toBeGreaterThan(0);
  });
});

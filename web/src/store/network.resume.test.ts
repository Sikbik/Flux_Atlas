// Resume after a resync (ARCHITECTURE 8.1): the snapshots lag the live stream by different amounts,
// the client resumes from the lowest seq that still needs the stream, and each topic skips what its
// snapshot already holds. Also the origin rules: one origin per loaded state.

import { describe, expect, it } from 'vitest';
import { encodeMeshBin, encodeSyntheticNodesBin } from '../api/bin/writer';
import type { BootstrapDto } from '../api/generated/BootstrapDto';
import type { LiveMsg } from '../api/generated/LiveMsg';
import { decodeMeshBin } from '../api/meshBin';
import { decodeNodesBin, statusCode, tierCode } from '../api/nodesBin';
import { blockMsg, bootstrap, live, syntheticNodesBin } from '../testing/fixtures';
import { NetworkStore, resumeSeq, snapshotOriginError } from './network';

const A = { instance: 'aaaaaaaaaaaaaaaa', startedMs: 1_000 };
const B = { instance: 'bbbbbbbbbbbbbbbb', startedMs: 2_000 };

const serverOf = (o: typeof A) => ({
  name: 'flux-atlas',
  version: '0',
  api_version: 1,
  started_ms: o.startedMs,
  instance: o.instance,
});

function boot(seq: number, extra: Partial<BootstrapDto> = {}, origin = A): BootstrapDto {
  return { ...bootstrap(seq), server: serverOf(origin), ...extra };
}

type Edge = [number, number];

const meshDelta = (seq: number, added: Edge[], removed: Edge[]): LiveMsg =>
  live('mesh', seq, { added, removed, reporters: [] });

const meshBin = (seq: number, edges: Edge[], origin = A) =>
  decodeMeshBin(
    encodeMeshBin(
      edges.map(([a, b]) => [a, b, 0]),
      { seq, origin },
    ),
  );

const edgesOf = (s: NetworkStore): string[] => {
  const e = s.meshEdges();
  return Array.from(e.a, (a, i) => `${a}-${e.b[i]}`).sort();
};

/** Replays what the server would send after `since`: every message of the log with a higher seq. */
function replay(s: NetworkStore, log: readonly LiveMsg[], since: number): void {
  for (const m of log) if (m.seq > since) s.apply(m, 1);
}

describe('resume point', () => {
  it('is min(bootstrap, nodes) when the mesh body holds every edge change', () => {
    expect(resumeSeq({ seq: 110, mesh_seq: 105 }, { seq: 108 }, { seq: 106 })).toBe(108);
    expect(resumeSeq({ seq: 110 }, { seq: 112 }, { seq: 90 })).toBe(110);
    expect(resumeSeq({ seq: 110, mesh_seq: 105 }, { seq: 112 }, null)).toBe(110);
  });

  it('drops to the mesh seq when mesh.bin lags the last edge change', () => {
    expect(resumeSeq({ seq: 110, mesh_seq: 105 }, { seq: 112 }, { seq: 100 })).toBe(100);
  });
});

describe('mesh resume (M8)', () => {
  // The server's history: mesh.bin was last rebuilt at seq 100; edges changed at 105 (inside the
  // bootstrap) and at 112 (after it). The truth after everything: {3-4, 5-6}.
  const log: LiveMsg[] = [
    meshDelta(105, [[3, 4]], [[1, 2]]),
    live('stats', 108, { summary: bootstrap(108).network }),
    meshDelta(
      112,
      [[5, 6]],
      [
        [2, 3],
        [7, 8],
      ],
    ),
  ];

  it('replays the edge changes a lagging mesh.bin misses: no lost and no ghost edges', () => {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({
      bootstrap: boot(110, { mesh_seq: 105 }),
      nodes: syntheticNodesBin(20, 110),
      mesh: meshBin(100, [
        [1, 2],
        [2, 3],
        [7, 8],
      ]),
    });
    expect(s.seq).toBe(100);
    replay(s, log, s.seq);
    expect(edgesOf(s)).toEqual(['3-4', '5-6']);
  });

  it('would lose them resuming from the bootstrap (the pre-B9 resume point)', () => {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({
      bootstrap: boot(110, { mesh_seq: 105 }),
      nodes: syntheticNodesBin(20, 110),
      mesh: meshBin(100, [
        [1, 2],
        [2, 3],
        [7, 8],
      ]),
    });
    replay(s, log, 110);
    // 1-2 is a ghost and 3-4 is lost: the reason the resume point includes the mesh seq.
    expect(edgesOf(s)).toEqual(['1-2', '5-6']);
  });

  it('skips a mesh delta at or below the mesh.bin seq', () => {
    const s = new NetworkStore({ now: () => 0 });
    // mesh.bin is newer than the bootstrap: it already holds the change at 112 and a re-add at 115.
    s.loadSnapshot({
      bootstrap: boot(110, { mesh_seq: 105 }),
      nodes: syntheticNodesBin(20, 110),
      mesh: meshBin(115, [
        [3, 4],
        [5, 6],
        [7, 8],
      ]),
    });
    expect(s.seq).toBe(110);
    const skipped = s.stats.skippedStale;
    s.apply(meshDelta(112, [], [[7, 8]]), 1);
    s.apply(meshDelta(115, [], [[3, 4]]), 1);
    expect(s.stats.skippedStale).toBe(skipped + 2);
    expect(edgesOf(s)).toEqual(['3-4', '5-6', '7-8']);
    s.apply(meshDelta(116, [], [[7, 8]]), 1);
    expect(edgesOf(s)).toEqual(['3-4', '5-6']);
  });

  it('loads an empty mesh for a server without one, and applies every delta', () => {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({ bootstrap: boot(110), nodes: syntheticNodesBin(20, 110), mesh: meshBin(90, [[1, 2]]) });
    s.loadSnapshot({ bootstrap: boot(120), nodes: syntheticNodesBin(20, 120), mesh: null });
    expect(edgesOf(s)).toEqual([]);
    s.apply(meshDelta(121, [[1, 9]], []), 1);
    expect(edgesOf(s)).toEqual(['1-9']);
  });
});

describe('replayed blocks (L12)', () => {
  const C = tierCode('cumulus');

  /** A store whose nodes.bin (seq `nodesSeq`) ranks cumulus as `order`; bootstrap at `bootSeq`. */
  function store(order: number[], nodesSeq: number, bootSeq: number): NetworkStore {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({ bootstrap: boot(bootSeq), nodes: syntheticNodesBin(order.length, nodesSeq) });
    const t = s.nodes;
    order.forEach((id, r) => {
      const i = t.indexOf(id);
      t.tier[i] = C;
      t.status[i] = statusCode('confirmed');
      t.rank[i] = r + 1;
    });
    return s;
  }

  const ranks = (s: NetworkStore): number[] => {
    const t = s.nodes;
    const rows: [number, number][] = [];
    for (let i = 0; i < t.count; i++) if (t.rank[i]! > 0) rows.push([t.rank[i]!, t.ids[i]!]);
    return rows.sort((a, b) => a[0] - b[0]).map((r) => r[1]);
  };

  it('does not rotate a payee again when nodes.bin is newer than the bootstrap', () => {
    // Truth: [0,1,2,3,4]; block 102 paid 0 -> [1,2,3,4,0]; a reconcile at 104 put 0 back at rank 2
    // -> [1,2,0,3,4]. nodes.bin (seq 105) holds all of it; the bootstrap (seq 101) does not.
    const s = store([1, 2, 0, 3, 4], 105, 101);
    const lastPaid = s.nodes.lastPaid[s.nodes.indexOf(0)];
    expect(s.seq).toBe(101);
    s.apply(live('block', 102, blockMsg(2_996_915, { payees: [0], heartbeats: [3] })), 1);
    expect(ranks(s)).toEqual([1, 2, 0, 3, 4]);
    expect(s.nodes.lastPaid[s.nodes.indexOf(0)]).toBe(lastPaid);
    expect(s.nodes.lastConfirmed[s.nodes.indexOf(3)]).toBe(0);
    // The block list still gets the block: the bootstrap did not list it.
    expect(s.blocks.newest()?.height).toBe(2_996_915);
    // A block after nodes.bin rotates as usual.
    s.apply(live('block', 106, blockMsg(2_996_916, { payees: [1] })), 1);
    expect(ranks(s)).toEqual([2, 0, 3, 4, 1]);
  });

  it('does not list a block again that the bootstrap already holds', () => {
    const s = store([0, 1, 2], 100, 105);
    const before = s.blocks.toArray();
    s.apply(live('block', 103, blockMsg(2_996_914, { payees: [0] })), 1);
    expect(s.blocks.toArray()).toBe(before);
  });
});

describe('origins (M9)', () => {
  const nodesOf = (origin: typeof A | null, ids: number[], seq = 100) =>
    decodeNodesBin(
      encodeSyntheticNodesBin(
        ids.map((id) => ({ id, ip: `1.1.1.${id}:16127` })),
        { seq, withOutpoints: true, ...(origin ? { origin } : {}) },
      ),
    );

  it('accepts three bodies of the bootstrap origin', () => {
    expect(snapshotOriginError(boot(1), nodesOf(A, [1]), meshBin(1, [], A))).toBeNull();
    expect(snapshotOriginError(boot(1), nodesOf(A, [1]), null)).toBeNull();
  });

  it('rejects a mixed set', () => {
    expect(snapshotOriginError(boot(1), nodesOf(B, [1]), meshBin(1, [], A))).toMatch(/nodes\.bin/);
    expect(snapshotOriginError(boot(1), nodesOf(A, [1]), meshBin(1, [], B))).toMatch(/mesh\.bin/);
    // The same instance after a restart is another origin too (its seqs restarted).
    const restarted = { ...A, startedMs: 5 };
    expect(snapshotOriginError(boot(1), nodesOf(restarted, [1]), null)).not.toBeNull();
  });

  it('accepts files without ORIGIN only from a server that names no instance', () => {
    const old = { ...bootstrap(1) };
    expect(old.server.instance).toBe('');
    expect(snapshotOriginError(old, nodesOf(null, [1]), meshBin(1, [], null as never))).toBeNull();
    expect(snapshotOriginError(boot(1), nodesOf(null, [1]), null)).toMatch(/no origin/);
    expect(snapshotOriginError(old, nodesOf(A, [1]), null)).not.toBeNull();
  });

  it('switching instance leaves no state of the old one', () => {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({
      bootstrap: boot(100, {
        next_payees: { height: 2_996_915, payees: [{ tier: 'cumulus', node: 3, address: 'a' }] },
      }),
      nodes: nodesOf(A, [1, 2, 3]),
      mesh: meshBin(100, [[1, 2]]),
    });
    s.apply(
      live('feed', 101, { kind: 'node_joined', ts_ms: 0, text_key: 'k', refs: [{ kind: 'node', id: 2 }] }),
      1,
    );
    s.apply(live('block', 102, blockMsg(2_996_915, { payees: [3] })), 1);
    s.apply(live('app_installing', 103, { app: 'x', node: 2, endpoint: '1.1.1.2:16127' }), 1);
    expect(s.feed.size).toBe(1);

    s.loadSnapshot({ bootstrap: boot(7, {}, B), nodes: nodesOf(B, [10, 11]), mesh: meshBin(7, [], B) });
    expect(s.instanceSwitches).toBe(1);
    expect(s.nodes.count).toBe(2);
    for (const id of [1, 2, 3]) expect(s.nodes.has(id)).toBe(false);
    expect(s.mesh.size).toBe(0);
    expect(s.feed.size).toBe(0);
    expect(s.installing.size).toBe(0);
    expect(s.nextPayees).toBeNull();
    expect(s.blocks.toArray().every((b) => !b.live)).toBe(true);
    expect(s.server?.instance).toBe(B.instance);
    expect(s.seq).toBe(7);
    // The feed mark was reset: the new instance's seqs start low and its items are new.
    s.apply(live('feed', 8, { kind: 'node_joined', ts_ms: 0, text_key: 'k', refs: [] }), 1);
    expect(s.feed.size).toBe(1);
  });

  it('keeps ids across a restart of the same instance (only the seq marks reset)', () => {
    const s = new NetworkStore({ now: () => 0 });
    s.loadSnapshot({ bootstrap: boot(100), nodes: nodesOf(A, [1, 2, 3]), mesh: meshBin(100, [[1, 2]], A) });
    s.apply(
      live('feed', 101, { kind: 'node_joined', ts_ms: 0, text_key: 'k', refs: [{ kind: 'node', id: 2 }] }),
      1,
    );
    const restarted = { ...A, startedMs: 9_000 };
    s.loadSnapshot({ bootstrap: boot(5, {}, restarted), nodes: nodesOf(restarted, [1, 2, 3], 5) });
    expect(s.instanceSwitches).toBe(0);
    expect(s.feed.size).toBe(1);
    expect(s.mesh.size).toBe(1);
    // Seqs restarted: the new process's feed item 6 is new although 101 was seen before.
    s.apply(live('feed', 6, { kind: 'node_joined', ts_ms: 0, text_key: 'k', refs: [] }), 1);
    expect(s.feed.size).toBe(2);
  });
});

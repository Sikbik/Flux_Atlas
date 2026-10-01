// The runtime's resync against two instances behind one domain (ARCHITECTURE 8.1): snapshot sets of
// mixed origin are never loaded, a `hello` from another instance resyncs, and an instance switch
// leaves no id-keyed state behind while selected and watched nodes follow their outpoints.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMeshBin, encodeSyntheticNodesBin } from '../api/bin/writer';
import type { BootstrapDto } from '../api/generated/BootstrapDto';
import { ApiError } from '../api/http';
import type { LiveEnvironment, WebSocketLike } from '../api/live';
import { decodeMeshBin } from '../api/meshBin';
import { decodeNodesBin } from '../api/nodesBin';
import { qk } from '../api/queryKeys';
import { canonicalNodeKey } from '../store/nodeKeys';
import { useUi } from '../store/ui';
import { bootstrap, hex64 } from '../testing/fixtures';
import { createRuntime } from './runtime';
import { fetchSnapshot, type SnapshotFetchers, SnapshotOriginError } from './snapshot';

interface Origin {
  instance: string;
  startedMs: number;
}
const A: Origin = { instance: 'aaaaaaaaaaaaaaaa', startedMs: 1_000 };
const B: Origin = { instance: 'bbbbbbbbbbbbbbbb', startedMs: 1_000 };

const op = (n: number) => `${hex64(n)}:0`;

function boot(o: Origin, seq = 50): BootstrapDto {
  return {
    ...bootstrap(seq),
    server: {
      name: 'flux-atlas',
      version: '0',
      api_version: 1,
      started_ms: o.startedMs,
      instance: o.instance,
    },
  };
}

/** One instance's bodies. `rows` maps node id -> collateral number (the same node has the same outpoint). */
function bodies(o: Origin, rows: [number, number][], seq = 50) {
  return {
    bootstrap: boot(o, seq),
    nodes: decodeNodesBin(
      encodeSyntheticNodesBin(
        rows.map(([id, c]) => ({ id, outpoint: op(c), ip: `10.0.0.${c}:16127` })),
        { seq, origin: o },
      ),
    ),
    mesh: decodeMeshBin(encodeMeshBin([[rows[0]![0], rows[1]![0], 0]], { seq, origin: o })),
  };
}

type Bodies = ReturnType<typeof bodies>;

function fetchersFrom(pick: () => { bootstrap: Bodies; nodes: Bodies; mesh: Bodies }) {
  const calls = { bootstrap: 0, nodes: 0, mesh: 0 };
  const f: SnapshotFetchers = {
    bootstrap: async () => {
      calls.bootstrap++;
      return pick().bootstrap.bootstrap;
    },
    nodesBin: async () => {
      calls.nodes++;
      return pick().nodes.nodes;
    },
    meshBin: async () => {
      calls.mesh++;
      return pick().mesh.mesh;
    },
  };
  return { f, calls };
}

const noWait = { wait: async () => {} };

describe('fetchSnapshot', () => {
  const a = bodies(A, [
    [1, 101],
    [2, 102],
  ]);
  const b = bodies(B, [
    [1, 202],
    [2, 101],
  ]);

  it('discards a mixed set and fetches again until all three share one origin', async () => {
    let n = 0;
    const { f, calls } = fetchersFrom(() =>
      n++ < 3 ? { bootstrap: a, nodes: b, mesh: a } : { bootstrap: a, nodes: a, mesh: a },
    );
    const s = await fetchSnapshot(f, new AbortController().signal, noWait);
    expect(s.nodes).toBe(a.nodes);
    expect(s.bootstrap).toBe(a.bootstrap);
    expect(calls.bootstrap).toBe(2);
  });

  it('gives up after a bounded number of mixed sets, never returning a mix', async () => {
    const { f, calls } = fetchersFrom(() => ({ bootstrap: a, nodes: a, mesh: b }));
    const waits: number[] = [];
    await expect(
      fetchSnapshot(f, new AbortController().signal, {
        delaysMs: [10, 20],
        wait: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(SnapshotOriginError);
    expect(calls.mesh).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it('loads an empty mesh on 404 and fails the resync on any other mesh error', async () => {
    const base = fetchersFrom(() => ({ bootstrap: a, nodes: a, mesh: a })).f;
    const missing: SnapshotFetchers = {
      ...base,
      meshBin: async () => {
        throw new ApiError('not_found', 'no mesh', 404, '/api/v1/mesh.bin');
      },
    };
    expect((await fetchSnapshot(missing, new AbortController().signal, noWait)).mesh).toBeNull();
    const broken: SnapshotFetchers = {
      ...base,
      meshBin: async () => {
        throw new ApiError('internal', 'boom', 500, '/api/v1/mesh.bin');
      },
    };
    await expect(fetchSnapshot(broken, new AbortController().signal, noWait)).rejects.toThrow('boom');
  });
});

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  hello(o: Origin, seq: number): void {
    this.onmessage?.({
      data: JSON.stringify({
        seq,
        observed_ms: Date.now(),
        event_ms: null,
        t: 'hello',
        server: {
          name: 'flux-atlas',
          version: '0',
          api_version: 1,
          started_ms: o.startedMs,
          instance: o.instance,
        },
        tip: null,
        now_ms: Date.now(),
      }),
    });
  }
}

const env: LiveEnvironment = {
  isOnline: () => true,
  isVisible: () => true,
  onOnlineChange: () => () => {},
  onVisibilityChange: () => () => {},
};

describe('runtime across instances', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    useUi.setState({ watchedKeys: [], legacyWatched: [], watched: [] });
  });
  afterEach(() => useUi.setState({ watchedKeys: [], legacyWatched: [], watched: [] }));

  // Instance A knows collateral 101 as id 1 and 102 as id 2; instance B numbers them differently.
  const a = bodies(A, [
    [1, 101],
    [2, 102],
    [3, 103],
  ]);
  const b = bodies(B, [
    [7, 103],
    [8, 101],
    [9, 104],
  ]);

  function setup() {
    let serving: Bodies = a;
    const { f, calls } = fetchersFrom(() => ({ bootstrap: serving, nodes: serving, mesh: serving }));
    const rt = createRuntime({
      snapshot: f,
      snapshotRetry: noWait,
      live: { createSocket: () => new FakeSocket(), env, random: () => 0.5 },
    });
    return {
      rt,
      calls,
      serve: (x: Bodies) => {
        serving = x;
      },
      sock: () => FakeSocket.all[FakeSocket.all.length - 1]!,
    };
  }

  it('resyncs on a hello from another instance and keeps nothing of the old one', async () => {
    const t = setup();
    useUi.setState({ watchedKeys: [op(101)] });
    t.rt.setSelected([op(103)]);
    t.rt.start();
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(1));
    expect(t.rt.store.server?.instance).toBe(A.instance);
    expect(useUi.getState().watched).toEqual([1]);
    expect(t.rt.selectedIds()).toEqual([3]);
    t.sock().open();
    t.sock().hello(A, 50);
    expect(t.sock().sent.find((m) => m.t === 'sub')?.watch).toEqual([1, 3]);

    // An id-keyed cache entry from instance A.
    t.rt.queryClient.setQueryData(qk.nodes.detail(1), { id: 1 });

    // The socket reconnects and lands on instance B.
    t.serve(b);
    t.sock().open();
    t.sock().hello(B, 9);
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(2));
    expect(t.calls.bootstrap).toBe(2);

    const s = t.rt.store;
    expect(s.server?.instance).toBe(B.instance);
    expect(s.instanceSwitches).toBe(1);
    expect(Array.from(s.nodes.view('ids')).sort()).toEqual([7, 8, 9]);
    expect(s.nodes.has(1)).toBe(false);
    expect([...s.mesh.keys()].length).toBe(1);
    expect(t.rt.queryClient.getQueryData(qk.nodes.detail(1))).toBeUndefined();
    // Watched and selected nodes follow their outpoints to B's ids.
    expect(useUi.getState().watched).toEqual([8]);
    expect(t.rt.selectedIds()).toEqual([7]);
    expect(canonicalNodeKey('8')).toBe(op(101));

    t.sock().open();
    t.sock().hello(B, 9);
    expect(t.sock().sent.find((m) => m.t === 'sub')).toMatchObject({ since_seq: 50, watch: [7, 8] });
    t.rt.stop();
  });

  it('never loads a mixed set: a persistent mix leaves the store empty and reports the error', async () => {
    const { f } = fetchersFrom(() => ({ bootstrap: a, nodes: b, mesh: a }));
    const rt = createRuntime({
      snapshot: f,
      snapshotRetry: { delaysMs: [1], wait: async () => {} },
      live: { createSocket: () => new FakeSocket(), env, random: () => 0.5, backoff: { baseMs: 60_000 } },
    });
    rt.start();
    await vi.waitFor(() => expect(rt.store.connection.lastError).toMatch(/different servers/));
    expect(rt.store.loaded).toBe(false);
    expect(rt.store.connection.status).toBe('reconnecting');
    rt.stop();
  });
});

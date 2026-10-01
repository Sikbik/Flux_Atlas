import { describe, expect, it, vi } from 'vitest';
import type { MeshBin } from '../api/meshBin';
import { type EffectSink, recordingSink } from '../choreo/effects';
import { NetworkStore } from '../store/network';
import { NodeTable } from '../store/nodeTable';
import { bootstrap, live, syntheticNodesBin } from '../testing/fixtures';
import {
  bindGlobe,
  type GlobeBindingDeps,
  type GlobeHover,
  type GlobeIntent,
  type GlobeTarget,
  globeViewFromLocation,
  HOST_ALT,
  ipOf,
  meshModeFor,
  shiftSink,
} from './bindings';
import type { EngineEvents, NodeColumns, NodeDelta, PickInfo } from './engine/types';

// ---- a fake engine that records every call -----------------------------------------------------

interface Call {
  name: string;
  args: unknown[];
}

function fakeEngine() {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  // What the engine currently shows per node, so `nodeInfo` answers like the real engine.
  const nodes = new Map<number, { lat: number; lon: number; tier: number; status: number; flags: number }>();
  const putColumns = (cols: NodeColumns) => {
    for (let i = 0; i < cols.ids.length; i++)
      nodes.set(cols.ids[i]!, {
        lat: cols.lat[i]!,
        lon: cols.lon[i]!,
        tier: cols.tier[i]!,
        status: cols.status[i]!,
        flags: cols.flags[i]!,
      });
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const sink = recordingSink(() => 0);
  const engine = {
    sink,
    stats: {} as GlobeTarget['stats'],
    reduced: false,
    setNodes: (cols: NodeColumns, opts?: unknown) => {
      calls.push({ name: 'setNodes', args: [cols, opts] });
      nodes.clear();
      putColumns(cols);
    },
    updateNodes: (delta: NodeDelta) => {
      calls.push({ name: 'updateNodes', args: [delta] });
      for (const id of Array.from(delta.removedIds ?? [])) nodes.delete(id);
      if (delta.added) putColumns(delta.added);
      const ch = delta.changed;
      if (!ch) return;
      for (let k = 0; k < ch.ids.length; k++) {
        const n = nodes.get(ch.ids[k]!);
        if (!n) continue;
        if (ch.tier) n.tier = ch.tier[k]!;
        if (ch.status) n.status = ch.status[k]!;
        if (ch.flags) n.flags = ch.flags[k]!;
      }
    },
    setMesh: record('setMesh'),
    updateMesh: record('updateMesh'),
    setMeshMode: record('setMeshMode'),
    setFilter: record('setFilter'),
    setWatched: record('setWatched'),
    select: record('select'),
    setHover: record('setHover'),
    flyTo: (...args: unknown[]) => {
      calls.push({ name: 'flyTo', args });
      return Promise.resolve(true);
    },
    showAppConstellation: record('showAppConstellation'),
    clearAppConstellation: record('clearAppConstellation'),
    setMode: record('setMode'),
    home: (...args: unknown[]) => {
      calls.push({ name: 'home', args });
      return Promise.resolve(true);
    },
    setMoon: record('setMoon'),
    moonState: () => ({ x: 0, y: 0, s: 0, r: 0, z: 0, visible: false, hover: false, phase: 0 }),
    moonClick: record('moonClick'),
    setBeat: record('setBeat'),
    setMoonStatus: record('setMoonStatus'),
    seedMoonChain: record('seedMoonChain'),
    setInset: record('setInset'),
    setArtDirection: record('setArtDirection'),
    setQuality: record('setQuality'),
    setReduced: record('setReduced'),
    nodeInfo: (id: number) => {
      const n = nodes.get(id);
      return n ? ({ id, ...n } as PickInfo) : null;
    },
    projectNode: () => false,
    project: () => false,
    setLabelAnchors: record('setLabelAnchors'),
    labelAnchors: () => [],
    notifyKey: record('notifyKey'),
    on: (type: string, cb: (p: unknown) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
      return () => set?.delete(cb);
    },
  } as unknown as GlobeTarget;
  const emit = <K extends keyof EngineEvents>(type: K, payload: EngineEvents[K]) => {
    for (const cb of listeners.get(type) ?? []) cb(payload);
  };
  const named = (name: string) => calls.filter((c) => c.name === name);
  const last = (name: string) => named(name).at(-1);
  return { engine, calls, named, last, emit, sink, listeners };
}

function setup(opts: { count?: number; load?: boolean; deps?: Partial<GlobeBindingDeps> } = {}) {
  const store = new NetworkStore();
  if (opts.load !== false)
    store.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(opts.count ?? 20, 100) });
  const f = fakeEngine();
  const intents: GlobeIntent[] = [];
  const hovers: (GlobeHover | null)[] = [];
  let sink: EffectSink | null = null;
  const timers: (() => void)[] = [];
  const binding = bindGlobe(f.engine, {
    store,
    setEffectSink: (s) => {
      sink = s;
    },
    onIntent: (i) => intents.push(i),
    onHover: (h) => hovers.push(h),
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    ...opts.deps,
  });
  const view = (path: string, search: Record<string, unknown> = {}) =>
    binding.setView(globeViewFromLocation(path, search));
  return { store, binding, intents, hovers, sinkRef: () => sink, timers, view, ...f };
}

const nodesMsg = (seq: number, body: object) =>
  live('nodes', seq, {
    prev_seq: seq - 1 < 100 ? 0 : seq - 1,
    added: [],
    removed: [],
    changed: [],
    cause: 'block',
    ...body,
  });

const lite = (id: number, extra: object = {}) => ({
  id,
  outpoint: `${id}:0`,
  endpoint: `9.9.9.${id}:16127`,
  tier: 'stratus',
  status: 'confirmed',
  lat: 50,
  lon: 8,
  country_code: 'DE',
  org: 'Hetzner Online GmbH',
  rank: null,
  last_paid_height: null,
  app_count: 0,
  flags: 0,
  ...extra,
});

// ---- tests -------------------------------------------------------------------------------------

describe('store -> engine', () => {
  it('loads the snapshot keyed by node id (shifted past 0) and attaches the effect sink', () => {
    const { named, sinkRef, store } = setup();
    const set = named('setNodes');
    expect(set.length).toBe(1);
    const [cols, o] = set[0]!.args as [NodeColumns, { animate: boolean; intro: boolean }];
    expect(Array.from(cols.ids)).toEqual(Array.from(store.nodes.view('ids')).map((id) => id + 1));
    expect(o).toEqual({ animate: false, intro: true });
    expect(cols.tier[3]).toBe(store.nodes.tier[3]);
    // Every node on one IP shares a host id; the 20 synthetic nodes have 20 IPs.
    expect(new Set(cols.host).size).toBe(20);
    expect(sinkRef()).not.toBeNull();
  });

  it('waits for the snapshot when the engine arrives first', () => {
    const { named, store } = setup({ load: false });
    expect(named('setNodes').length).toBe(0);
    store.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(10, 100) });
    expect(named('setNodes').length).toBe(1);
    expect(named('seedMoonChain').length).toBe(1);
  });

  it('turns change sets into one updateNodes: added, removed and visible field changes', () => {
    const { named, store } = setup();
    store.apply(
      nodesMsg(101, {
        added: [lite(500)],
        removed: [3],
        changed: [
          { id: 4, status: 'dos' },
          { id: 0, flags: 0x10 },
        ],
      }),
    );
    const up = named('updateNodes');
    expect(up.length).toBe(1);
    const d = up[0]!.args[0] as {
      added: NodeColumns;
      removedIds: number[];
      changed: { ids: number[]; status: number[]; flags: number[] };
    };
    expect(Array.from(d.added.ids)).toEqual([501]);
    expect(d.removedIds).toEqual([4]);
    // Store status `dos` (3) is the engine's 4; node 0 is engine node 1.
    expect(d.changed.ids).toEqual([5, 1]);
    expect(d.changed.status[0]).toBe(4);
    expect(d.changed.flags[1]).toBe(0x10);
  });

  it('skips bookkeeping-only changes (ranks, heartbeats)', () => {
    const { named, store } = setup();
    store.apply(nodesMsg(101, { changed: [{ id: 2, rank: 9 }], cause: 'reconcile' }));
    expect(named('updateNodes').length).toBe(0);
  });

  it('relocates a node whose position changed (leave now, come back at the new site)', () => {
    const { named, store, timers } = setup();
    store.apply(nodesMsg(101, { changed: [{ id: 5, lat: -33.9, lon: 151.2 }], cause: 'geo' }));
    const first = named('updateNodes');
    expect(first.length).toBe(1);
    expect(first[0]!.args[0]).toEqual({ removedIds: [6], animate: false });
    expect(timers.length).toBe(1);
    timers[0]!();
    const back = named('updateNodes')[1]!.args[0] as { added: NodeColumns };
    expect(Array.from(back.added.ids)).toEqual([6]);
    expect(back.added.lat[0]).toBeCloseTo(-33.9, 3);
  });

  it('reloads on a resync with a diffing setNodes', () => {
    const { named, store } = setup();
    store.loadSnapshot({ bootstrap: bootstrap(200), nodes: syntheticNodesBin(25, 200) });
    const set = named('setNodes');
    expect(set.length).toBe(2);
    expect(set[1]!.args[1]).toEqual({ animate: true, intro: false });
    expect((set[1]!.args[0] as NodeColumns).ids.length).toBe(25);
  });

  it('loads the mesh and streams its deltas', () => {
    const { named, store } = setup();
    const mesh: MeshBin = {
      seq: 100,
      generatedMs: 0,
      count: 2,
      a: new Uint32Array([0, 1]),
      b: new Uint32Array([1, 2]),
      flags: new Uint8Array(2),
      unknownSections: [],
    };
    store.loadMesh(mesh);
    const set = named('setMesh')[0]!.args as [Uint32Array, Uint32Array];
    expect([Array.from(set[0]), Array.from(set[1])]).toEqual([
      [1, 2],
      [2, 3],
    ]);
    store.apply(live('mesh', 101, { added: [[4, 5]], removed: [[0, 1]], reporters: [] }));
    expect(named('updateMesh')[0]!.args[0]).toEqual({ addA: [5], addB: [6], removeA: [1], removeB: [2] });
  });

  it('seeds the moon chain with recent blocks once', () => {
    const { named, store } = setup();
    expect(named('seedMoonChain').length).toBe(1);
    const blocks = named('seedMoonChain')[0]!.args[0] as { height: number; time: number }[];
    expect(blocks.length).toBe(12);
    store.loadSnapshot({ bootstrap: bootstrap(200), nodes: syntheticNodesBin(20, 200) });
    expect(named('seedMoonChain').length).toBe(1);
  });
});

describe('URL -> engine', () => {
  it('selects and flies to /node/$key (by ip:port or id), and clears on the bare globe', () => {
    const { view, last, named } = setup();
    view('/node/5.0.0.7:16127');
    expect(last('select')!.args).toEqual([8, { fly: true, silent: true }]);
    view('/node/0');
    expect(last('select')!.args).toEqual([1, { fly: true, silent: true }]);
    view('/');
    expect(last('select')!.args).toEqual([null, { fly: false, silent: true }]);
    view('/');
    expect(named('select').length).toBe(3);
  });

  it('selects `?sel=` without flying', () => {
    const { view, last } = setup();
    view('/', { sel: 'nope:1,5.0.0.2:16127' });
    expect(last('select')!.args).toEqual([3, { fly: false, silent: true }]);
  });

  it('resolves a deep link once the snapshot arrives', () => {
    const { view, last, store } = setup({ load: false });
    view('/node/5.0.0.4:16127');
    expect(last('select')).toBeUndefined();
    store.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(10, 100) });
    expect(last('select')!.args).toEqual([5, { fly: true, silent: true }]);
  });

  it('shows the app constellation for /app/$name and clears it on leave', async () => {
    const appInstances = vi.fn(async () => [1, 2, 999]);
    const { view, last, named } = setup({ deps: { appInstances } });
    view('/app/kadenanode');
    await Promise.resolve();
    await Promise.resolve();
    expect(appInstances).toHaveBeenCalledWith('kadenanode');
    expect(last('showAppConstellation')!.args).toEqual([[2, 3], { name: 'kadenanode', fly: true }]);
    view('/app/kadenanode/history/2');
    expect(appInstances).toHaveBeenCalledTimes(1);
    view('/');
    expect(named('clearAppConstellation').length).toBe(1);
  });

  it('drops a stale app answer when the route moved on', async () => {
    let resolve: (v: number[]) => void = () => {};
    const appInstances = () => new Promise<number[]>((r) => (resolve = r));
    const { view, named } = setup({ deps: { appInstances } });
    view('/app/a');
    view('/');
    resolve([1]);
    await Promise.resolve();
    expect(named('showAppConstellation').length).toBe(0);
  });

  it('flies to the host site for /host/$ip', () => {
    const { view, last, store } = setup();
    view('/host/5.0.0.7');
    const i = store.nodes.indexOf(7);
    expect(last('flyTo')!.args).toEqual([store.nodes.lat[i], store.nodes.lon[i], HOST_ALT]);
  });

  it('maps filter params to a mask and an id allow-list', () => {
    const { view, last, store } = setup();
    view('/', { tier: 'stratus,nimbus', cc: 'DE' });
    const [filter, allow] = last('setFilter')!.args as [{ tiers: number }, number[]];
    expect(filter).toEqual({ tiers: (1 << 3) | (1 << 2) });
    const t = store.nodes;
    const de: number[] = [];
    for (let i = 0; i < t.count; i++) if (t.countryCode(i) === 'DE') de.push(t.ids[i]! + 1);
    expect(allow).toEqual(de);
    expect(de.length).toBeGreaterThan(0);
    view('/', { arcane: false });
    expect(last('setFilter')!.args).toEqual([{ excludeFlags: 0x10 }, null]);
    view('/');
    expect(last('setFilter')!.args).toEqual([null, null]);
  });

  it('maps layers to the mesh mode and /ambient to ambient mode', () => {
    const { view, last } = setup();
    view('/');
    expect(last('setMeshMode')!.args).toEqual(['selection']);
    view('/', { l: 'nodes,mesh.flow' });
    expect(last('setMeshMode')!.args).toEqual(['flow']);
    view('/ambient');
    expect(last('setMode')!.args).toEqual(['ambient']);
    view('/');
    expect(last('setMode')!.args).toEqual(['explore']);
  });

  it('restores the URL mesh layer after ambient, whatever the director left on', () => {
    const { view, named, calls } = setup();
    view('/', { l: 'mesh.flow' });
    view('/ambient');
    // The director's own mesh flow (the real engine switches to flow on entry).
    const n = named('setMeshMode').length;
    view('/');
    const after = named('setMeshMode');
    expect(after.length).toBe(n + 1);
    expect(after.at(-1)!.args).toEqual(['selection']);
    // ...and after setMode('explore'), so the director's restore cannot win.
    const order = calls.map((c) => c.name).filter((x) => x === 'setMode' || x === 'setMeshMode');
    expect(order.slice(-2)).toEqual(['setMode', 'setMeshMode']);
  });

  it('marks watched nodes, and the watched filter allows only them', () => {
    const { view, binding, last } = setup();
    binding.setWatched([0, 4]);
    expect(last('setWatched')!.args).toEqual([[1, 5]]);
    view('/', { watched: true });
    expect(last('setFilter')!.args).toEqual([{}, [1, 5]]);
  });

  it('goes home when a camera route returns to the bare globe', () => {
    const { view, named, binding } = setup();
    view('/');
    view('/settings');
    view('/');
    expect(named('home').length).toBe(0); // a plain window never moved the camera
    view('/node/3');
    view('/');
    expect(named('home').length).toBe(1);
    view('/host/5.0.0.7');
    view('/', { tier: 'stratus' });
    expect(named('home').length).toBe(2);
    view('/ambient');
    view('/');
    expect(named('home').length).toBe(2); // ambient restores its own saved pose
    binding.home();
    expect(named('home').length).toBe(3);
    view('/ambient');
    binding.home();
    expect(named('home').length).toBe(3);
  });
});

describe('engine -> app', () => {
  it('turns a node click into a selectNode intent with the canonical key, and empty space into a clear', () => {
    const { emit, intents } = setup();
    emit('select', { id: 8, isCluster: false } as PickInfo);
    expect(intents).toEqual([{ kind: 'selectNode', id: 7, key: '5.0.0.7:16127' }]);
    emit('select', { id: 8, isCluster: true } as PickInfo);
    emit('select', null);
    expect(intents.at(-1)).toEqual({ kind: 'clearSelection' });
    expect(intents.length).toBe(2);
  });

  it('does not echo a selection the URL already made', () => {
    const { view, emit, intents, named } = setup();
    emit('select', { id: 3, isCluster: false } as PickInfo);
    view('/node/5.0.0.2:16127');
    expect(named('select').length).toBe(0);
    expect(intents.length).toBe(1);
  });

  it('reports hover (store ids) and the moon; the moon click opens About', () => {
    const { emit, hovers, intents } = setup();
    emit('hover', { id: 1, isCluster: false } as PickInfo);
    expect(hovers[0]).toMatchObject({ kind: 'node', id: 0, key: '5.0.0.0:16127' });
    emit('moonhover', { hovered: true, on: true, x: 10, y: 20, r: 30 });
    expect(hovers[1]).toEqual({ kind: 'moon', x: 10, y: 20, r: 30 });
    emit('moonclick', { x: 0, y: 0, key: true });
    expect(intents).toEqual([{ kind: 'openAbout', key: true }]);
    emit('wake', { kind: 'key' });
    expect(intents.at(-1)).toEqual({ kind: 'wake' });
  });

  it('puts the moon in auto placement (companion in the shell, orbit in ambient)', () => {
    const { named } = setup();
    expect(named('setMoon')[0]!.args).toEqual([{ mode: 'auto' }]);
  });

  it('detaches everything on dispose', () => {
    const { binding, sinkRef, store, named, listeners } = setup();
    binding.dispose();
    expect(sinkRef()).toBeNull();
    store.apply(nodesMsg(101, { removed: [1] }));
    expect(named('updateNodes').length).toBe(0);
    for (const set of listeners.values()) expect(set.size).toBe(0);
  });
});

describe('the effect sink across the boundary', () => {
  it('shifts every node id in every command', () => {
    const inner = recordingSink(() => 0);
    const s = shiftSink(inner);
    s.beat({ height: 1, producer: 0, producerTier: null, compact: false, reduced: false, emission: false });
    s.uplink({ height: 1, from: null, durationMs: 720 });
    s.downlink({
      height: 1,
      to: 9,
      tier: 'stratus',
      piece: 'cap',
      amount: '9',
      durationMs: 900,
      order: 3,
      mine: false,
    });
    s.payoutLanded({ height: 1, node: 9, tier: 'stratus', amount: '9', mine: false, highlightMs: null });
    s.heartbeats({ height: 1, nodes: [0, 1] });
    s.pulse({ node: 4, kind: 'joined', priority: 2, tier: null });
    s.aim({ height: 2, payees: [{ tier: 'cumulus', node: 3 }], etaMs: 1, mine: [3] });
    s.app({ app: 'x', phase: 'pending', nodes: [7] });
    s.links({ added: [[1, 2]], removed: [[3, 4]] });
    const cmds = inner.log.map((e) => e.cmd);
    expect(cmds[0]).toMatchObject({ producer: 1 });
    expect(cmds[1]).toMatchObject({ from: null });
    expect(cmds[2]).toMatchObject({ to: 10, piece: 'cap' });
    expect(cmds[3]).toMatchObject({ node: 10 });
    expect(cmds[4]).toMatchObject({ nodes: [1, 2] });
    expect(cmds[5]).toMatchObject({ node: 5 });
    expect(cmds[6]).toMatchObject({ payees: [{ tier: 'cumulus', node: 4 }], mine: [4] });
    expect(cmds[7]).toMatchObject({ nodes: [8] });
    expect(cmds[8]).toEqual({ added: [[2, 3]], removed: [[4, 5]] });
  });

  it('drives the engine from the live runtime choreographer path', () => {
    const { sinkRef, sink } = setup();
    sinkRef()!.payoutLanded({
      height: 1,
      node: 2,
      tier: 'nimbus',
      amount: '3.5',
      mine: false,
      highlightMs: null,
    });
    expect(sink.log.at(-1)).toMatchObject({ name: 'payoutLanded', cmd: { node: 3 } });
  });
});

describe('the view from a location', () => {
  it('parses focus, ambient, selection, filters and layers', () => {
    expect(
      globeViewFromLocation('/node/1.2.3.4%3A16127', { sel: 'a,b', tier: 'stratus', l: 'mesh.off' }),
    ).toEqual({
      focus: { kind: 'node', key: '1.2.3.4:16127' },
      ambient: false,
      sel: ['a', 'b'],
      filter: {
        tier: 'stratus',
        cc: undefined,
        org: undefined,
        ver: undefined,
        arcane: undefined,
        watched: undefined,
      },
      layers: 'mesh.off',
    });
    expect(globeViewFromLocation('/host/1.2.3.4', {}).focus).toEqual({ kind: 'host', ip: '1.2.3.4' });
    expect(globeViewFromLocation('/app/x/history/3', {}).focus).toEqual({ kind: 'app', name: 'x' });
    expect(globeViewFromLocation('/about', {}).focus).toEqual({ kind: 'about' });
    expect(globeViewFromLocation('/ambient', {}).ambient).toBe(true);
    expect(globeViewFromLocation('/', { arcane: 'true', watched: '1' }).filter).toMatchObject({
      arcane: true,
      watched: true,
    });
  });

  it('reads host IPs and mesh modes', () => {
    expect(ipOf('1.2.3.4:16127')).toBe('1.2.3.4');
    expect(ipOf('[2001:db8::1]:16127')).toBe('2001:db8::1');
    expect(ipOf('2001:db8::1')).toBe('2001:db8::1');
    expect(meshModeFor(undefined)).toBe('selection');
    expect(meshModeFor('-mesh')).toBe('off');
  });
});

describe('archive view (time machine)', () => {
  const past = () => NodeTable.fromSnapshot(syntheticNodesBin(5, 90));

  it('shows a past node table, detaches live effects and holds live changes back', () => {
    const { binding, named, last, sinkRef, store } = setup();
    expect(sinkRef()).not.toBeNull();
    binding.setArchive(past());

    const sets = named('setNodes');
    expect(sets.length).toBe(2);
    const [cols, opts] = sets[1]!.args as [NodeColumns, { animate: boolean; intro: boolean }];
    expect(Array.from(cols.ids)).toEqual([1, 2, 3, 4, 5]);
    // The globe already has nodes, so the swap cross-fades instead of replaying the intro.
    expect(opts).toEqual({ animate: true, intro: false });
    expect(last('setMoonStatus')!.args).toEqual(['archive']);
    expect(sinkRef()).toBeNull();
    const [a] = last('setMesh')!.args as [ArrayLike<number>];
    expect(a.length).toBe(0);

    // Live changes keep updating the store, not the engine.
    store.apply(nodesMsg(101, { added: [lite(500)], removed: [3] }));
    expect(named('updateNodes').length).toBe(0);
    // Another table swaps the picture without re-announcing the archive.
    binding.setArchive(NodeTable.fromSnapshot(syntheticNodesBin(8, 91)));
    expect(named('setNodes').length).toBe(3);
    expect(named('setMoonStatus').length).toBe(1);
  });

  it('keeps the moon in its archive state when the canvas re-sets it for a late feed', () => {
    const { binding, engine, emit, named, last } = setup();
    const frame = {} as EngineEvents['frame'];
    binding.setArchive(past());
    // The canvas flips the moon to late; the next frame puts the archive state back.
    engine.setMoonStatus('late');
    emit('frame', frame);
    expect(last('setMoonStatus')!.args).toEqual(['archive']);
    // Leaving stops holding it: the live status is the canvas's again.
    binding.setArchive(null);
    expect(last('setMoonStatus')!.args).toEqual(['live']);
    const calls = named('setMoonStatus').length;
    emit('frame', frame);
    expect(named('setMoonStatus').length).toBe(calls);
  });

  it('applies the URL filters to the archived rows', () => {
    const { binding, view, last } = setup();
    view('/time', { cc: 'FI' });
    const table = past();
    binding.setArchive(table);
    const [, allow] = last('setFilter')!.args as [unknown, number[]];
    const want: number[] = [];
    for (let i = 0; i < table.count; i++) if (table.countryCode(i) === 'FI') want.push(table.ids[i]! + 1);
    expect(want.length).toBeGreaterThan(0);
    expect(allow).toEqual(want);
  });

  it('leaving the archive brings back the current table, effects and moon at once', () => {
    const { binding, named, last, sinkRef, store } = setup();
    binding.setArchive(past());
    // While away the live network moved on: one node joined.
    store.apply(nodesMsg(101, { added: [lite(500)] }));
    binding.setArchive(null);

    const [cols, opts] = last('setNodes')!.args as [NodeColumns, { animate: boolean }];
    expect(cols.ids.length).toBe(21);
    expect(Array.from(cols.ids)).toContain(501);
    expect(opts.animate).toBe(true);
    expect(last('setMoonStatus')!.args).toEqual(['live']);
    expect(sinkRef()).not.toBeNull();
    // Leaving twice is harmless, and live changes flow again.
    binding.setArchive(null);
    expect(named('setNodes').length).toBe(3);
    store.apply(nodesMsg(102, { removed: [1] }));
    expect(named('updateNodes').length).toBe(1);
  });
});

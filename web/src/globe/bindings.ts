// Bindings: the live runtime and the URL drive the globe engine; the globe's own input (clicks,
// hover, the moon) comes back out as intents for the router. Pure TypeScript, no React and no
// three.js: the engine is reached through `GlobeTarget` (a structural subset of `GlobeEngine`), so the
// whole module is unit-tested with a fake engine (bindings.test.ts).
//
//   NetworkStore snapshot            -> engine.setNodes (keyed by node id: store rows are unordered)
//   NetworkStore change sets         -> engine.updateNodes (added, removed, tier/status/flags changes)
//   mesh.bin load + mesh deltas      -> engine.setMesh / updateMesh
//   recent blocks (once)             -> engine.seedMoonChain
//   URL filters (tier, cc, org, ver, arcane, watched) -> engine.setFilter
//   URL layers (`l=mesh.off|mesh.sel|mesh.flow`)      -> engine.setMeshMode
//   `/node/$key` and `?sel=`         -> engine.select (flies on `/node`)
//   `/app/$name`                     -> engine.showAppConstellation (instances from the app API)
//   `/host/$ip`                      -> engine.flyTo the host's site, close enough that it fans out
//   `/ambient`                       -> engine.setMode('ambient') (the moon blends to orbit, 900 ms)
//   watched nodes                    -> engine.setWatched
//   the time machine (`setArchive`)  -> engine.setNodes with a past node table; live changes wait
//   the choreographer                -> runtime.setEffectSink(sink): every live animation
//   engine select / hover / moon     -> intents (navigate) and hover state (tooltips)
//
// Node ids. The server interns node ids from 0; the engine reserves 0 for "none". Every id crossing
// the boundary is shifted by one (`toEngineId`, `fromEngineId`), including inside effect commands
// (`shiftSink`), so the rest of the app only ever sees store ids.

import { NodeFlag } from '../api/nodesBin';
import type { EffectSink } from '../choreo/effects';
import { type NetworkStore, Slice, type StoreChange } from '../store/network';
import { NodeField, type NodeTable, Reach } from '../store/nodeTable';
import type { LabelAnchor, LabelAnchorInput, ScreenPoint } from './engine/GlobeEngine';
import type { MoonState } from './engine/moon/moon';
import type {
  ArtDirection,
  EngineEvents,
  EngineMode,
  EngineStats,
  NodeColumns,
  NodeDelta,
  NodeFilter,
  PickInfo,
  QualityLevel,
} from './engine/types';

// -------------------------------------------------------------------------------------------------
// The engine surface the app uses
// -------------------------------------------------------------------------------------------------

/** The part of `GlobeEngine` the app talks to (bindings, canvas, anchors). */
export interface GlobeTarget {
  readonly sink: EffectSink;
  readonly stats: EngineStats;
  readonly reduced: boolean;
  setNodes(cols: NodeColumns, opts?: { animate?: boolean; intro?: boolean }): void;
  updateNodes(delta: NodeDelta): void;
  setMesh(a: ArrayLike<number>, b: ArrayLike<number>): void;
  updateMesh(delta: {
    addA?: ArrayLike<number>;
    addB?: ArrayLike<number>;
    removeA?: ArrayLike<number>;
    removeB?: ArrayLike<number>;
  }): void;
  setMeshMode(mode: 'off' | 'selection' | 'flow'): void;
  setFilter(filter: NodeFilter | null, allowIds?: ArrayLike<number> | null): void;
  setWatched(ids: ArrayLike<number>): void;
  select(id: number | null, opts?: { fly?: boolean; alt?: number; silent?: boolean }): void;
  setHover(id: number | null): void;
  flyTo(
    lat: number,
    lon: number,
    alt?: number,
    opts?: { tilt?: number; heading?: number; duration?: number },
  ): Promise<boolean>;
  showAppConstellation(ids: ArrayLike<number> | null, opts?: { name?: string; fly?: boolean }): void;
  clearAppConstellation(): void;
  setMode(mode: EngineMode): void;
  /** Eases back to the home view (no pitch, north up, the home zoom, framed in the free area). */
  home(): Promise<boolean>;
  setMoon(opts: {
    on?: boolean;
    mode?: 'auto' | 'companion' | 'orbit';
    scale?: number;
    padTop?: number;
  }): void;
  moonState(): MoonState;
  moonClick(): void;
  setBeat(v: number): void;
  setMoonStatus(status: 'live' | 'late' | 'offline' | 'archive'): void;
  seedMoonChain(blocks: readonly { height: number; time: number }[]): void;
  setInset(inset: { left: number; right: number; top: number; bottom: number }, ms?: number): void;
  setArtDirection(art: ArtDirection): void;
  setQuality(level: QualityLevel): void;
  setReduced(reduced: boolean): void;
  nodeInfo(id: number): PickInfo | null;
  projectNode(id: number, out: ScreenPoint): boolean;
  project(lat: number, lon: number, radius: number, out: ScreenPoint): boolean;
  setLabelAnchors(list: readonly LabelAnchorInput[]): void;
  labelAnchors(): readonly LabelAnchor[];
  notifyKey(): void;
  on<K extends keyof EngineEvents>(type: K, cb: (payload: EngineEvents[K]) => void): () => void;
}

// -------------------------------------------------------------------------------------------------
// Ids across the boundary
// -------------------------------------------------------------------------------------------------

/** Store node id to engine node id (the engine reserves 0). */
export const toEngineId = (id: number): number => id + 1;
/** Engine node id to store node id. */
export const fromEngineId = (id: number): number => id - 1;

const shiftN = (id: number | null): number | null => (id === null ? null : id + 1);

/** Wraps an engine sink so every node id in every command is shifted to engine ids. */
export function shiftSink(s: EffectSink): EffectSink {
  return {
    beat: (c) => s.beat({ ...c, producer: shiftN(c.producer) }),
    uplink: (c) => s.uplink({ ...c, from: shiftN(c.from) }),
    moonFlare: (c) => s.moonFlare(c),
    downlink: (c) => s.downlink({ ...c, to: shiftN(c.to) }),
    payoutLanded: (c) => s.payoutLanded({ ...c, node: shiftN(c.node) }),
    devFund: (c) => s.devFund(c),
    heartbeats: (c) => s.heartbeats({ ...c, nodes: c.nodes.map(toEngineId) }),
    pulse: (c) => s.pulse({ ...c, node: c.node + 1 }),
    aim: (c) =>
      s.aim({
        ...c,
        payees: c.payees.map((p) => ({ ...p, node: shiftN(p.node) })),
        mine: c.mine.map(toEngineId),
      }),
    clearAim: () => s.clearAim(),
    app: (c) => s.app({ ...c, nodes: c.nodes.map(toEngineId) }),
    links: (c) =>
      s.links({
        added: c.added.map(([a, b]) => [a + 1, b + 1]),
        removed: c.removed.map(([a, b]) => [a + 1, b + 1]),
      }),
    summary: (c) => s.summary(c),
    reorg: (c) => s.reorg(c),
    recap: (c) => s.recap(c),
  };
}

// -------------------------------------------------------------------------------------------------
// The view: what the URL asks of the globe
// -------------------------------------------------------------------------------------------------

export type GlobeFocus =
  | { kind: 'none' }
  | { kind: 'node'; key: string }
  | { kind: 'host'; ip: string }
  | { kind: 'app'; name: string }
  | { kind: 'about' };

export interface GlobeFilterParams {
  tier?: string | undefined;
  cc?: string | undefined;
  org?: string | undefined;
  ver?: string | undefined;
  arcane?: boolean | undefined;
  watched?: boolean | undefined;
}

export interface GlobeView {
  focus: GlobeFocus;
  ambient: boolean;
  /** Node keys from `?sel=` (ip:port or ids). */
  sel: readonly string[];
  filter: GlobeFilterParams;
  /** `?l=` layers, for example `nodes,mesh.flow,-labels`. */
  layers: string | undefined;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Derives the globe's view from a router location (pure). */
export function globeViewFromLocation(pathname: string, search: Record<string, unknown>): GlobeView {
  const seg = pathname.split('/').filter(Boolean);
  let focus: GlobeFocus = { kind: 'none' };
  if (seg[0] === 'node' && seg[1]) focus = { kind: 'node', key: decode(seg[1]) };
  else if (seg[0] === 'host' && seg[1]) focus = { kind: 'host', ip: decode(seg[1]) };
  else if (seg[0] === 'app' && seg[1]) focus = { kind: 'app', name: decode(seg[1]) };
  else if (seg[0] === 'about') focus = { kind: 'about' };
  const str = (v: unknown) =>
    typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;
  const flag = (v: unknown) =>
    v === true || v === 'true' || v === '1'
      ? true
      : v === false || v === 'false' || v === '0'
        ? false
        : undefined;
  const sel = str(search.sel);
  return {
    focus,
    ambient: seg[0] === 'ambient',
    sel: sel ? sel.split(',').filter(Boolean).slice(0, 50) : [],
    filter: {
      tier: str(search.tier),
      cc: str(search.cc),
      org: str(search.org),
      ver: str(search.ver),
      arcane: flag(search.arcane),
      watched: flag(search.watched),
    },
    layers: str(search.l),
  };
}

const sameFilter = (a: GlobeFilterParams, b: GlobeFilterParams) =>
  a.tier === b.tier &&
  a.cc === b.cc &&
  a.org === b.org &&
  a.ver === b.ver &&
  a.arcane === b.arcane &&
  a.watched === b.watched;

const sameFocus = (a: GlobeFocus, b: GlobeFocus) => JSON.stringify(a) === JSON.stringify(b);

// -------------------------------------------------------------------------------------------------
// Columns
// -------------------------------------------------------------------------------------------------

/** Store status codes (unknown, confirmed, started, dos, offline, expired, departed) to the engine's. */
const ENGINE_STATUS = [0, 1, 2, 4, 3, 3, 3] as const;
const ENGINE_OFFLINE = 3;

/** The IP part of an endpoint (`1.2.3.4:16127`, `[2001:db8::1]:16127`). */
export function ipOf(endpoint: string): string {
  if (endpoint.startsWith('[')) {
    const end = endpoint.indexOf(']');
    return end > 0 ? endpoint.slice(1, end) : endpoint;
  }
  const i = endpoint.lastIndexOf(':');
  return i > 0 && endpoint.indexOf(':') === i ? endpoint.slice(0, i) : endpoint;
}

/** Interns host IPs to small ids so the engine keeps one host's nodes together in a stack. */
class HostIds {
  private readonly map = new Map<string, number>();
  of(endpoint: string): number {
    if (!endpoint) return 0;
    const ip = ipOf(endpoint);
    let id = this.map.get(ip);
    if (id === undefined) {
      id = this.map.size + 1;
      this.map.set(ip, id);
    }
    return id;
  }
}

/** The engine status of row `i`: unreachable nodes draw as offline. */
function engineStatus(t: NodeTable, i: number): number {
  if (t.reachable[i] === Reach.No) return ENGINE_OFFLINE;
  return ENGINE_STATUS[t.status[i] ?? 0] ?? 0;
}

/** Copies rows of the node table into engine columns (all rows when `rows` is null). */
export function columnsFromTable(
  t: NodeTable,
  rows: readonly number[] | null,
  hosts: HostIdsLike,
): NodeColumns {
  const n = rows ? rows.length : t.count;
  const cols: NodeColumns = {
    ids: new Uint32Array(n),
    lat: new Float32Array(n),
    lon: new Float32Array(n),
    tier: new Uint8Array(n),
    status: new Uint8Array(n),
    flags: new Uint8Array(n),
    loc: new Uint32Array(n),
    host: new Uint32Array(n),
  };
  for (let k = 0; k < n; k++) {
    const i = rows ? rows[k]! : k;
    cols.ids[k] = toEngineId(t.ids[i]!);
    cols.lat[k] = t.lat[i]!;
    cols.lon[k] = t.lon[i]!;
    cols.tier[k] = t.tier[i]!;
    cols.status[k] = engineStatus(t, i);
    cols.flags[k] = t.flags[i]!;
    cols.loc[k] = t.loc[i]!;
    cols.host![k] = hosts.of(t.endpoint(i));
  }
  return cols;
}

interface HostIdsLike {
  of(endpoint: string): number;
}

// -------------------------------------------------------------------------------------------------
// Filters
// -------------------------------------------------------------------------------------------------

const TIER_BIT: Record<string, number> = { cumulus: 1 << 1, nimbus: 1 << 2, stratus: 1 << 3 };

/**
 * The engine filter for the URL's filter params: tiers and ArcaneOS are bit masks; country,
 * provider, FluxOS version and the watchlist become an id allow-list (engine ids).
 */
export function filterFor(
  p: GlobeFilterParams,
  t: NodeTable,
  watched: readonly number[],
): { filter: NodeFilter | null; allow: number[] | null } {
  const f: NodeFilter = {};
  let any = false;
  if (p.tier) {
    let mask = 0;
    for (const name of p.tier.toLowerCase().split(',')) mask |= TIER_BIT[name.trim()] ?? 0;
    if (mask) {
      f.tiers = mask;
      any = true;
    }
  }
  if (p.arcane === true) {
    f.requireFlags = NodeFlag.Arcane;
    any = true;
  } else if (p.arcane === false) {
    f.excludeFlags = NodeFlag.Arcane;
    any = true;
  }
  const cc = p.cc
    ? new Set(
        p.cc
          .toUpperCase()
          .split(',')
          .map((s) => s.trim()),
      )
    : null;
  const orgs = p.org
    ? p.org
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
    : null;
  const vers = p.ver ? new Set(p.ver.split(',').map((s) => s.trim())) : null;
  const watch = p.watched ? new Set(watched) : null;
  let allow: number[] | null = null;
  if (cc || orgs || vers || watch) {
    allow = [];
    for (let i = 0; i < t.count; i++) {
      if (cc && !cc.has(t.countryCode(i))) continue;
      if (orgs) {
        const o = t.orgName(i).toLowerCase();
        if (!orgs.some((x) => x && o.includes(x))) continue;
      }
      if (vers && !vers.has(t.fluxOs(i))) continue;
      if (watch && !watch.has(t.ids[i]!)) continue;
      allow.push(toEngineId(t.ids[i]!));
    }
    any = true;
  }
  return { filter: any ? f : null, allow };
}

/** Mesh mode from the `l` layers param; the design's default is the selection's peers. */
export function meshModeFor(layers: string | undefined): 'off' | 'selection' | 'flow' {
  for (const raw of (layers ?? '').split(',')) {
    const l = raw.trim();
    if (l === '-mesh' || l === 'mesh.off') return 'off';
    if (l === 'mesh.flow') return 'flow';
    if (l === 'mesh.sel' || l === 'mesh') return 'selection';
  }
  return 'selection';
}

// -------------------------------------------------------------------------------------------------
// The binding
// -------------------------------------------------------------------------------------------------

/** What the globe asks the app to do (the router turns these into navigations). */
export type GlobeIntent =
  | { kind: 'selectNode'; id: number; key: string }
  | { kind: 'clearSelection' }
  | { kind: 'openAbout'; key: boolean }
  | { kind: 'wake' };

/** Hover state for tooltips (node ids are store ids). */
export type GlobeHover =
  | { kind: 'node'; id: number; key: string; info: PickInfo }
  | { kind: 'moon'; x: number; y: number; r: number };

export interface GlobeBindingDeps {
  store: NetworkStore;
  /** `runtime.setEffectSink`. */
  setEffectSink(sink: EffectSink | null): void;
  /** Node ids (store ids) of an app's running instances (the app detail API). */
  appInstances?(name: string): Promise<readonly number[]>;
  onIntent(intent: GlobeIntent): void;
  onHover?(hover: GlobeHover | null): void;
  /** Timers (injectable for tests). */
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export interface GlobeBinding {
  /** Applies the URL's view (call on every location change; unchanged parts are skipped). */
  setView(view: GlobeView): void;
  /** The home control: back to the home view (explore only). */
  home(): void;
  /** Watched nodes (store ids): the engine's dashed ring, and the `watched` filter. */
  setWatched(ids: readonly number[]): void;
  /** The canonical key of a node for URLs: `ip:port`, else the id. */
  keyOf(id: number): string;
  /** A node id for a URL key (id or `ip:port`), or null. */
  resolveKey(key: string): number | null;
  /** The site of a host IP (first located node on it), for tethers and the camera. */
  hostSite(ip: string): { lat: number; lon: number } | null;
  /**
   * The archive view (time machine). While a node table is set the engine shows it instead of the
   * live nodes: live node and mesh changes are held back, effects are detached and the moon's status
   * is `archive`. Setting another table swaps the picture (nodes join and leave with the engine's
   * cross-fade); `null` leaves the archive and brings the live table, mesh, filter and effects back.
   */
  setArchive(table: NodeTable | null): void;
  dispose(): void;
}

/** Focus routes that fly the camera; leaving one for the bare globe goes home. */
const CAMERA_FOCUS = new Set<GlobeFocus['kind']>(['node', 'host', 'app']);

/** Altitude (globe radii) the camera flies to for a host, close enough for the stack to fan out. */
export const HOST_ALT = 0.22;

export function bindGlobe(engine: GlobeTarget, deps: GlobeBindingDeps): GlobeBinding {
  const store = deps.store;
  const t = store.nodes;
  const hosts = new HostIds();
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as number));
  const timers = new Set<unknown>();
  let disposed = false;
  let engineHasNodes = false;
  let chainSeeded = false;
  let view: GlobeView | null = null;
  let watched: readonly number[] = [];
  /** Store id the engine has selected (null for none). */
  let selected: number | null = null;
  let shownApp: string | null = null;
  let flownHost: string | null = null;
  let appRequest = 0;
  /** A past node table on screen (time machine), or null while the globe follows the live store. */
  let archive: NodeTable | null = null;

  const keyOf = (id: number): string => {
    const i = t.indexOf(id);
    const ep = i >= 0 ? t.endpoint(i) : '';
    return ep || String(id);
  };

  const resolveKey = (key: string): number | null => {
    const k = key.trim();
    if (/^\d+$/.test(k)) {
      const id = Number(k);
      return t.has(id) ? id : null;
    }
    for (let i = 0; i < t.count; i++) if (t.endpoint(i) === k) return t.ids[i]!;
    return null;
  };

  const hostRows = (ip: string): number[] => {
    const rows: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const ep = t.endpoint(i);
      if (ep && ipOf(ep) === ip) rows.push(i);
    }
    return rows;
  };

  const hostSite = (ip: string): { lat: number; lon: number } | null => {
    for (const i of hostRows(ip)) {
      const lat = t.lat[i]!;
      const lon = t.lon[i]!;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
    return null;
  };

  // ---- nodes ------------------------------------------------------------------------------

  const loadAll = () => {
    const cols = columnsFromTable(t, null, hosts);
    engine.setNodes(cols, { animate: engineHasNodes, intro: !engineHasNodes });
    engineHasNodes = true;
  };

  const loadMesh = () => {
    const m = store.meshEdges();
    const a = new Uint32Array(m.a.length);
    const b = new Uint32Array(m.b.length);
    for (let i = 0; i < a.length; i++) {
      a[i] = m.a[i]! + 1;
      b[i] = m.b[i]! + 1;
    }
    engine.setMesh(a, b);
  };

  const relocate = (ids: number[]) => {
    // The engine cannot move a node: it leaves at once and comes back at its new site once the
    // engine has reaped the old slot (it reaps every 250 ms).
    engine.updateNodes({ removedIds: ids.map(toEngineId), animate: false });
    const h = later(() => {
      timers.delete(h);
      if (disposed) return;
      const rows = ids.map((id) => t.indexOf(id)).filter((i) => i >= 0);
      if (rows.length) engine.updateNodes({ added: columnsFromTable(t, rows, hosts) });
    }, 400);
    timers.add(h);
  };

  const VISIBLE_FIELDS = NodeField.Tier | NodeField.Status | NodeField.Flags | NodeField.Reachable;

  const applyNodeChanges = (nc: NonNullable<StoreChange['nodes']>) => {
    if (nc.reloaded || !engineHasNodes) {
      loadAll();
      return;
    }
    const delta: NodeDelta = {};
    if (nc.removed.length) {
      // A node removed and re-added in the same batch is in `added` too; the engine revives it.
      delta.removedIds = nc.removed.map(toEngineId);
    }
    if (nc.added.length) {
      const rows: number[] = [];
      for (const id of new Set(nc.added)) {
        const i = t.indexOf(id);
        if (i >= 0) rows.push(i);
      }
      if (rows.length) delta.added = columnsFromTable(t, rows, hosts);
    }
    const moved: number[] = [];
    if (nc.changed.length && nc.fields & (VISIBLE_FIELDS | NodeField.Geo)) {
      const ids: number[] = [];
      const tier: number[] = [];
      const status: number[] = [];
      const flags: number[] = [];
      for (const id of new Set(nc.changed)) {
        const i = t.indexOf(id);
        if (i < 0) continue;
        const info = engine.nodeInfo(toEngineId(id));
        if (nc.fields & NodeField.Geo) {
          const lat = t.lat[i]!;
          const lon = t.lon[i]!;
          if (info && (!sameCoord(info.lat, lat) || !sameCoord(info.lon, lon))) {
            moved.push(id);
            continue;
          }
        }
        if (nc.fields & VISIBLE_FIELDS) {
          // `fields` is a union over the batch, and a block re-ranks a whole tier, so most ids here
          // may carry bookkeeping only: forward just what the engine does not already show.
          const st = engineStatus(t, i);
          if (info && info.tier === t.tier[i] && info.status === st && info.flags === t.flags[i]) continue;
          ids.push(toEngineId(id));
          tier.push(t.tier[i]!);
          status.push(st);
          flags.push(t.flags[i]!);
        }
      }
      if (ids.length) delta.changed = { ids, tier, status, flags };
    }
    if (delta.added || delta.removedIds || delta.changed) engine.updateNodes(delta);
    if (moved.length) relocate(moved);
  };

  const onChange = (change: StoreChange) => {
    if (disposed) return;
    // The archive owns the engine's nodes: live changes are not applied (leaving it reloads them).
    if (archive) return;
    let nodesMoved = false;
    if (change.nodes) {
      applyNodeChanges(change.nodes);
      nodesMoved = change.nodes.structural || (change.nodes.fields & VISIBLE_FIELDS) !== 0;
    }
    if (change.mesh) {
      const mc = change.mesh;
      if (mc.reloaded) loadMesh();
      else if (mc.added.length || mc.removed.length) {
        engine.updateMesh({
          addA: mc.added.map((e) => e[0] + 1),
          addB: mc.added.map((e) => e[1] + 1),
          removeA: mc.removed.map((e) => e[0] + 1),
          removeB: mc.removed.map((e) => e[1] + 1),
        });
      }
    }
    if (!chainSeeded && store.loaded && change.slices & Slice.Blocks) seedChain();
    if (view) {
      if (change.nodes?.reloaded) {
        // A fresh snapshot: keys may resolve now, and allow-lists see the new rows.
        applyFocus(true);
        applyFilter();
      } else if (nodesMoved && needsAllowList(view.filter)) applyFilter();
      else if (change.nodes?.structural && selected === null) applyFocus(false);
    }
  };

  const seedChain = () => {
    const blocks = store.blocks.toArray();
    if (!blocks.length) return;
    chainSeeded = true;
    // The ring is newest first: the last dozen blocks.
    engine.seedMoonChain(blocks.slice(0, 12).map((b) => ({ height: b.height, time: b.timeMs })));
  };

  // ---- view -------------------------------------------------------------------------------

  const needsAllowList = (p: GlobeFilterParams) => !!(p.cc || p.org || p.ver || p.watched);

  const applyFilter = () => {
    if (!view) return;
    const { filter, allow } = filterFor(view.filter, archive ?? t, watched);
    engine.setFilter(filter, allow);
  };

  const targetSelection = (): number | null => {
    if (!view) return null;
    if (view.focus.kind === 'node') return resolveKey(view.focus.key);
    for (const k of view.sel) {
      const id = resolveKey(k);
      if (id !== null) return id;
    }
    return null;
  };

  const applyFocus = (force: boolean) => {
    if (!view || !store.loaded) return;
    const f = view.focus;
    const want = targetSelection();
    if (want !== selected || force) {
      if (want !== selected) {
        engine.select(want === null ? null : toEngineId(want), {
          fly: f.kind === 'node' && want !== null,
          silent: true,
        });
      }
      selected = want;
    }
    // App constellation
    const app = f.kind === 'app' ? f.name : null;
    if (app !== shownApp) {
      shownApp = app;
      const req = ++appRequest;
      if (app === null) engine.clearAppConstellation();
      else if (deps.appInstances) {
        deps.appInstances(app).then(
          (ids) => {
            if (disposed || req !== appRequest) return;
            const known = ids.filter((id) => t.has(id)).map(toEngineId);
            engine.showAppConstellation(known, { name: app, fly: true });
          },
          () => {
            // The app API failed: no constellation; the window shows the error.
          },
        );
      }
    }
    // Host: fly to its site so the stack fans out.
    const host = f.kind === 'host' ? f.ip : null;
    if (host !== flownHost) {
      const site = host ? hostSite(host) : null;
      if (host === null || site) flownHost = host;
      if (site) void engine.flyTo(site.lat, site.lon, HOST_ALT);
    }
  };

  const setView = (next: GlobeView) => {
    if (disposed) return;
    const prev = view;
    view = next;
    if (!prev || prev.ambient !== next.ambient) engine.setMode(next.ambient ? 'ambient' : 'explore');
    // Leaving ambient re-asserts the URL's layers: the director runs its own mesh flow and restores
    // what it saved on entry, which need not be what this URL asks for.
    const leftAmbient = !!prev?.ambient && !next.ambient;
    if (!prev || prev.layers !== next.layers || leftAmbient) engine.setMeshMode(meshModeFor(next.layers));
    if (!prev || !sameFilter(prev.filter, next.filter)) applyFilter();
    if (!prev || !sameFocus(prev.focus, next.focus) || prev.sel.join(',') !== next.sel.join(','))
      applyFocus(false);
    // Back to the bare globe from a route that moved the camera (a node, a host, an app): home.
    if (prev && !next.ambient && next.focus.kind === 'none' && CAMERA_FOCUS.has(prev.focus.kind))
      void engine.home();
  };

  const setWatched = (ids: readonly number[]) => {
    watched = ids;
    engine.setWatched(ids.map(toEngineId));
    if (view?.filter.watched) applyFilter();
  };

  /** Stops holding the moon in its archive state (frame listener). */
  let releaseMoon: (() => void) | null = null;

  const setArchive = (table: NodeTable | null) => {
    if (disposed) return;
    if (table) {
      const entering = archive === null;
      archive = table;
      if (entering) {
        // The present stops talking to the globe: no live effects, no mesh, and the moon knows.
        deps.setEffectSink(null);
        engine.setMoonStatus('archive');
        // The canvas sets the moon's status whenever the live feed flips between live, late and
        // offline; while the archive shows, that must not bring the ring back.
        releaseMoon = engine.on('frame', () => engine.setMoonStatus('archive'));
        engine.setMesh(new Uint32Array(0), new Uint32Array(0));
        if (selected !== null) {
          engine.select(null, { silent: true });
          selected = null;
        }
      }
      engine.setNodes(columnsFromTable(table, null, hosts), { animate: engineHasNodes, intro: false });
      engineHasNodes = true;
      applyFilter();
      return;
    }
    if (archive === null) return;
    archive = null;
    releaseMoon?.();
    releaseMoon = null;
    engine.setMoonStatus('live');
    deps.setEffectSink(shiftSink(engine.sink));
    loadAll();
    if (store.mesh.size) loadMesh();
    applyFilter();
    if (!chainSeeded && store.loaded) seedChain();
  };

  // ---- engine events ----------------------------------------------------------------------

  const offs = [
    engine.on('select', (p) => {
      if (!p) {
        if (selected !== null) {
          selected = null;
          deps.onIntent({ kind: 'clearSelection' });
        }
        return;
      }
      if (p.isCluster) return; // a hub: the engine flies in so the stack unfurls
      const id = fromEngineId(p.id);
      selected = id;
      deps.onIntent({ kind: 'selectNode', id, key: keyOf(id) });
    }),
    engine.on('hover', (p) => {
      if (!deps.onHover) return;
      if (!p) deps.onHover(null);
      else {
        const id = fromEngineId(p.id);
        deps.onHover({ kind: 'node', id, key: keyOf(id), info: p });
      }
    }),
    engine.on('moonhover', (m) => deps.onHover?.(m.on ? { kind: 'moon', x: m.x, y: m.y, r: m.r } : null)),
    engine.on('moonclick', (m) => deps.onIntent({ kind: 'openAbout', key: m.key === true })),
    engine.on('wake', () => deps.onIntent({ kind: 'wake' })),
  ];

  // ---- start ------------------------------------------------------------------------------

  engine.setMoon({ mode: 'auto' });
  deps.setEffectSink(shiftSink(engine.sink));
  const unsubscribe = store.subscribe(onChange);
  if (store.loaded) {
    loadAll();
    if (store.mesh.size) loadMesh();
    seedChain();
  }

  return {
    setView,
    home() {
      if (!disposed && !view?.ambient) void engine.home();
    },
    setWatched,
    keyOf,
    resolveKey,
    hostSite,
    setArchive,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const off of offs) off();
      releaseMoon?.();
      releaseMoon = null;
      for (const h of timers) cancel(h);
      timers.clear();
      deps.setEffectSink(null);
    },
  };
}

function sameCoord(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) < 1e-4;
}

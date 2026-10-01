// Lab data: the real network snapshot (IP-free fixture) and a synthetic generator that scales the
// same structure up to 15k nodes. Both yield columnar typed arrays ready for `engine.setNodes`.

import { Rng, DEG, geoDistance } from '../engine/math';
import type { NodeColumns } from '../engine/types';
import { PLACES, type Place } from './gazetteer';

export interface LabApps {
  names: string[];
  /** offsets[i]..offsets[i+1] index into instances (node ids). */
  offsets: Uint32Array;
  instances: Uint32Array;
}

export interface LabData {
  label: string;
  source: 'real' | 'synthetic';
  cols: NodeColumns;
  meshA: Uint32Array;
  meshB: Uint32Array;
  apps: LabApps;
  tip: number;
  hosts: number;
  /** Optional strings for tooltips (real data only). */
  orgs?: string[];
  orgIdx?: Uint16Array;
  countries?: { name: string; code: string }[];
  countryIdx?: Uint16Array;
}

interface SnapshotMeta {
  tip: number;
  count: number;
  hosts: number;
  layout: Record<string, { offset: number; length: number; type: string }>;
  countries: { name: string; code: string }[];
  orgs: string[];
  apps: string[];
  generated: string;
}

function view<T extends ArrayBufferView>(buf: ArrayBuffer, l: { offset: number; length: number; type: string }): T {
  const ctors: Record<string, new (b: ArrayBuffer, o: number, n: number) => ArrayBufferView> = {
    Uint32Array, Float32Array, Uint8Array, Uint16Array,
  };
  return new ctors[l.type](buf, l.offset, l.length) as T;
}

/** Loads the real-network snapshot built by scripts/build-fixture.mjs. */
export async function loadRealSnapshot(base: string): Promise<LabData> {
  const [meta, buf] = await Promise.all([
    fetch(`${base}data/flux-snapshot.json`).then((r) => r.json() as Promise<SnapshotMeta>),
    fetch(`${base}data/flux-snapshot.bin`).then((r) => r.arrayBuffer()),
  ]);
  const L = meta.layout;
  const cols: NodeColumns = {
    ids: view<Uint32Array>(buf, L.ids),
    lat: view<Float32Array>(buf, L.lat),
    lon: view<Float32Array>(buf, L.lon),
    tier: view<Uint8Array>(buf, L.tier),
    status: view<Uint8Array>(buf, L.status),
    flags: view<Uint8Array>(buf, L.flags),
    loc: view<Uint32Array>(buf, L.loc),
    host: view<Uint32Array>(buf, L.host),
  };
  const observedA = view<Uint32Array>(buf, L.meshA);
  const observedB = view<Uint32Array>(buf, L.meshB);
  const { a, b } = buildMesh(cols, observedA, observedB, { meanOut: 7, seed: 11 });
  return {
    label: `Flux network, ${meta.generated.slice(0, 10)}`,
    source: 'real',
    cols,
    meshA: a,
    meshB: b,
    apps: {
      names: meta.apps,
      offsets: view<Uint32Array>(buf, L.appOffsets),
      instances: view<Uint32Array>(buf, L.appInstances),
    },
    tip: meta.tip,
    hosts: meta.hosts,
    orgs: meta.orgs,
    orgIdx: view<Uint16Array>(buf, L.org),
    countries: meta.countries,
    countryIdx: view<Uint16Array>(buf, L.country),
  };
}

// ---- mesh synthesis ----------------------------------------------------------------------

interface MeshOpts {
  /** Mean outbound peers per node (undirected degree is about double). */
  meanOut: number;
  seed: number;
}

/**
 * Synthesizes P2P edges with realistic structure, keeping any observed edges: each node draws peers
 * biased toward its own datacenter (same location), then near, then anywhere (long-haul). The mix
 * mirrors a live sample of the network: about 10 percent co-located, 7 percent same country, 42
 * percent same continent, and 41 percent intercontinental.
 */
export function buildMesh(cols: NodeColumns, observedA: Uint32Array | null, observedB: Uint32Array | null, o: MeshOpts): { a: Uint32Array; b: Uint32Array } {
  const n = cols.ids.length;
  const rng = new Rng(o.seed);
  const idToIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) idToIdx.set(cols.ids[i], i);

  // Group by location.
  const locOf = new Map<number, number>();
  const locNodes: number[][] = [];
  const locLat: number[] = [];
  const locLon: number[] = [];
  const nodeLoc = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = cols.loc[i];
    let li = locOf.get(key);
    if (li === undefined) {
      li = locNodes.length;
      locOf.set(key, li);
      locNodes.push([]);
      locLat.push(cols.lat[i]);
      locLon.push(cols.lon[i]);
    }
    locNodes[li].push(i);
    nodeLoc[i] = li;
  }
  const L = locNodes.length;
  // Nearest locations per location (by great-circle distance), ignoring unlocated.
  const M = 28;
  const near: Int32Array[] = new Array(L);
  const order = new Int32Array(L);
  for (let a = 0; a < L; a++) {
    if (!Number.isFinite(locLat[a])) {
      near[a] = new Int32Array(0);
      continue;
    }
    const dists = new Float32Array(L);
    for (let b = 0; b < L; b++) {
      dists[b] = Number.isFinite(locLat[b]) && a !== b ? geoDistance(locLat[a], locLon[a], locLat[b], locLon[b]) : 9;
      order[b] = b;
    }
    const idx = Array.from(order).sort((x, y) => dists[x] - dists[y]).slice(0, Math.min(M, L - 1));
    near[a] = Int32Array.from(idx);
  }

  const seen = new Set<number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const add = (i: number, j: number): boolean => {
    if (i === j) return false;
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const key = lo * 262144 + hi;
    if (seen.has(key)) return false;
    seen.add(key);
    ea.push(cols.ids[lo]);
    eb.push(cols.ids[hi]);
    return true;
  };

  if (observedA && observedB) {
    for (let k = 0; k < observedA.length; k++) {
      const i = idToIdx.get(observedA[k]);
      const j = idToIdx.get(observedB[k]);
      if (i !== undefined && j !== undefined) add(i, j);
    }
  }

  for (let i = 0; i < n; i++) {
    const out = Math.max(2, Math.min(18, Math.round(o.meanOut + rng.gauss() * 2.4)));
    const li = nodeLoc[i];
    for (let k = 0; k < out; k++) {
      const r = rng.next();
      let j = -1;
      if (r < 0.1 && locNodes[li].length > 1) {
        j = locNodes[li][rng.int(locNodes[li].length)];
      } else if (r < 0.17 && near[li].length > 0) {
        const nl = near[li][rng.int(Math.min(6, near[li].length))];
        j = locNodes[nl][rng.int(locNodes[nl].length)];
      } else if (r < 0.59 && near[li].length > 0) {
        const nl = near[li][rng.int(near[li].length)];
        j = locNodes[nl][rng.int(locNodes[nl].length)];
      } else {
        j = rng.int(n);
      }
      if (j >= 0) add(i, j);
    }
  }
  return { a: Uint32Array.from(ea), b: Uint32Array.from(eb) };
}

// ---- synthetic network -------------------------------------------------------------------

/** Relative hub weights (datacenter cities where Flux concentrates). Others share a long tail. */
const HUB_WEIGHT: Record<string, number> = {
  Helsinki: 12, Falkenstein: 8, Frankfurt: 6.4, Copenhagen: 5, Nuremberg: 4.4, Paris: 3.2, Warsaw: 2.2, Raleigh: 2.2,
  Vancouver: 2.2, Springfield: 1.8, Taganrog: 1.8, Roubaix: 1.8, Gravelines: 1.3, Beauharnois: 1.5, Ashburn: 1.7,
  Madison: 1.1, Amsterdam: 1.4, London: 1.5, Dallas: 1.1, Chicago: 1.1, 'New York': 1.1, 'Los Angeles': 1.0, Tokyo: 0.9,
  Singapore: 0.9, Sydney: 0.7, 'Sao Paulo': 0.7, Dubai: 0.7, Manama: 0.8, Moscow: 0.7, Kyiv: 0.7, Stockholm: 0.6,
  Oslo: 0.7, Madrid: 0.6, Milan: 0.6, Zurich: 0.5, Vienna: 0.5, Prague: 0.5, 'Hong Kong': 0.6, Seoul: 0.6, Riga: 0.6,
  Toronto: 0.6, Montreal: 0.6, Miami: 0.6, Seattle: 0.5, Atlanta: 0.5, Mumbai: 0.4, Johannesburg: 0.4, Istanbul: 0.4,
  Santiago: 0.5, 'Buenos Aires': 0.4, Bucharest: 0.4, Sofia: 0.3, Tallinn: 0.4, Vilnius: 0.3,
};

export function synthesize(count: number, seed = 1): LabData {
  const rng = new Rng(seed);
  const weights = PLACES.map((p) => HUB_WEIGHT[p.name] ?? 0.12 + rng.next() * 0.22);
  const total = weights.reduce((a, b) => a + b, 0);
  const cdf = new Float64Array(weights.length);
  let acc = 0;
  weights.forEach((w, i) => {
    acc += w / total;
    cdf[i] = acc;
  });
  const pick = (): Place => {
    const r = rng.next();
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return PLACES[lo];
  };

  const ids = new Uint32Array(count);
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  const tier = new Uint8Array(count);
  const status = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const loc = new Uint32Array(count);
  const host = new Uint32Array(count);
  const locKey = new Map<string, number>();

  // First assign places, then sort by location so hosts (UPnP groups) are contiguous.
  const places = new Array<Place>(count);
  for (let i = 0; i < count; i++) places[i] = pick();
  const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => (places[a].name < places[b].name ? -1 : places[a].name > places[b].name ? 1 : 0));
  let hostId = 0;
  let left = 0;
  let prev = '';
  for (let k = 0; k < count; k++) {
    const i = idx[k];
    const p = places[i];
    ids[k] = k + 1;
    // Co-located (datacenter centroid) most of the time; home nodes scatter around the metro.
    const exact = (HUB_WEIGHT[p.name] ?? 0) > 0.9 ? 0.86 : 0.55;
    let la = p.lat;
    let lo = p.lon;
    if (rng.next() > exact) {
      la += rng.gauss() * 0.22;
      lo += (rng.gauss() * 0.22) / Math.max(0.3, Math.cos(la * DEG));
      la = Math.max(-84, Math.min(84, la));
    }
    lat[k] = la;
    lon[k] = lo;
    const key = `${la.toFixed(2)},${lo.toFixed(2)}`;
    let li = locKey.get(key);
    if (li === undefined) {
      li = locKey.size;
      locKey.set(key, li);
    }
    loc[k] = li;
    const r = rng.next();
    tier[k] = r < 0.5 ? 1 : r < 0.74 ? 2 : 3;
    status[k] = rng.next() < 0.985 ? 1 : 2;
    flags[k] = (rng.next() < 0.3 ? 1 : 0) | (rng.next() < 0.38 ? 16 : 0) | (rng.next() < 0.55 ? 64 : 0) | (rng.next() < 0.03 ? 128 : 0);
    // UPnP hosts: runs of up to 8 nodes behind one IP.
    if (left === 0 || p.name !== prev) {
      hostId++;
      left = 1 + Math.min(7, Math.floor(-Math.log(1 - rng.next() * 0.97) / 0.85));
    }
    host[k] = hostId;
    left--;
    prev = p.name;
  }
  const cols: NodeColumns = { ids, lat, lon, tier, status, flags, loc, host };
  const { a, b } = buildMesh(cols, null, null, { meanOut: 7, seed: seed + 7 });

  // Apps: a power law of instance counts over random, loosely clustered nodes.
  const appCount = Math.max(60, Math.floor(count / 16));
  const names: string[] = [];
  const offsets = new Uint32Array(appCount + 1);
  const inst: number[] = [];
  const prefixes = ['flux', 'nova', 'atlas', 'relay', 'vault', 'pulse', 'orbit', 'lumen', 'forge', 'mint', 'echo', 'delta'];
  for (let i = 0; i < appCount; i++) {
    names.push(`${prefixes[i % prefixes.length]}${Math.floor(rng.next() * 900 + 100)}`);
    offsets[i] = inst.length;
    const n = Math.max(2, Math.min(100, Math.floor(2 / Math.pow(1 - rng.next() * 0.985, 0.72))));
    const anchor = rng.int(count);
    for (let k = 0; k < n; k++) {
      const j = rng.next() < 0.45 ? Math.min(count - 1, Math.max(0, anchor + rng.int(1200) - 600)) : rng.int(count);
      inst.push(ids[j]);
    }
  }
  offsets[appCount] = inst.length;

  return {
    label: `Synthetic network, ${count.toLocaleString('en-US')} nodes`,
    source: 'synthetic',
    cols,
    meshA: a,
    meshB: b,
    apps: { names, offsets, instances: Uint32Array.from(inst) },
    tip: 2997000,
    hosts: hostId,
  };
}

/** Node ids of app `i`, deduplicated. */
export function appInstances(apps: LabApps, i: number): Uint32Array {
  const s = apps.instances.subarray(apps.offsets[i], apps.offsets[i + 1]);
  return Uint32Array.from(new Set(s));
}

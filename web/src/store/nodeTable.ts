// Columnar node table: typed arrays decoded from nodes.bin (zero-copy until the first insert),
// an id -> row index map, and in-place delta application. Rows are unordered after deltas:
// removal swaps the last row into the hole (O(1)), so consumers must key by id or re-read `ids`
// when `structureVersion` changes.

import type { StringTable } from '../api/bin/container';
import type { NodeChange } from '../api/generated/NodeChange';
import type { NodeLite } from '../api/generated/NodeLite';
import { COUNTRY_SEP, type Locations, type NodesBin, statusCode, tierCode } from '../api/nodesBin';

/** Field bits reported in change sets, so consumers can skip work they do not need. */
export const NodeField = {
  Tier: 1 << 0,
  Status: 1 << 1,
  Flags: 1 << 2,
  Geo: 1 << 3,
  Org: 1 << 4,
  Rank: 1 << 5,
  LastPaid: 1 << 6,
  LastConfirmed: 1 << 7,
  AppCount: 1 << 8,
  Endpoint: 1 << 9,
  Version: 1 << 10,
  Reachable: 1 << 11,
  Hardware: 1 << 12,
} as const;

/** `reachable` column values. */
export const Reach = { Unknown: 0, Yes: 1, No: 2 } as const;

/**
 * A string table with appended entries: the decoded base stays lazy; entries interned after the
 * snapshot (new countries, orgs, versions, endpoints) go to `extra`.
 */
export class InternTable {
  private readonly base: StringTable;
  private readonly extra: string[] = [];
  private map: Map<string, number> | null = null;
  private readonly key: (entry: string) => string;

  constructor(base: StringTable, key: (entry: string) => string = (s) => s) {
    this.base = base;
    this.key = key;
  }

  get length(): number {
    return this.base.length + this.extra.length;
  }

  get(i: number): string {
    if (i < this.base.length) return this.base.get(i);
    return this.extra[i - this.base.length] ?? '';
  }

  /** Index of the entry whose key is `k`, appending `entry` when absent. Index 0 means unknown. */
  intern(k: string, entry: string = k): number {
    if (!k) return 0;
    if (!this.map) {
      this.map = new Map();
      for (let i = 1; i < this.length; i++) {
        const kk = this.key(this.get(i));
        if (kk && !this.map.has(kk)) this.map.set(kk, i);
      }
    }
    const hit = this.map.get(k);
    if (hit !== undefined) return hit;
    const idx = this.length;
    this.extra.push(entry);
    this.map.set(k, idx);
    return idx;
  }
}

const countryKey = (entry: string) => {
  const i = entry.indexOf(COUNTRY_SEP);
  return i < 0 ? entry : entry.slice(0, i);
};

export interface LocationInfo {
  lat: number;
  lon: number;
  country: number;
  nodeCount: number;
  city: string;
}

/** LOCATIONS with live node counts and clusters appended for newly located nodes. */
export class LocationTable {
  private readonly base: Locations;
  private readonly extra: LocationInfo[] = [];
  private readonly countDelta = new Map<number, number>();
  private keyMap: Map<string, number> | null = null;

  constructor(base: Locations) {
    this.base = base;
  }

  get length(): number {
    return this.base.length + this.extra.length;
  }

  info(i: number): LocationInfo | undefined {
    if (i < 0 || i >= this.length) return undefined;
    if (i >= this.base.length) return this.extra[i - this.base.length];
    return {
      lat: this.base.lat(i),
      lon: this.base.lon(i),
      country: this.base.country(i),
      nodeCount: this.base.nodeCount(i) + (this.countDelta.get(i) ?? 0),
      city: this.base.city(i),
    };
  }

  nodeCount(i: number): number {
    if (i >= this.base.length) return this.extra[i - this.base.length]?.nodeCount ?? 0;
    return this.base.nodeCount(i) + (this.countDelta.get(i) ?? 0);
  }

  adjust(i: number, by: number): void {
    if (i >= this.base.length) {
      const e = this.extra[i - this.base.length];
      if (e) e.nodeCount += by;
    } else {
      this.countDelta.set(i, (this.countDelta.get(i) ?? 0) + by);
    }
  }

  private static key(lat: number, lon: number, country: number): string {
    return `${Math.round(lat * 100)}:${Math.round(lon * 100)}:${country}`;
  }

  /** Cluster for a coordinate (same 0.01 degree cell and country), appending one when new. */
  locate(lat: number, lon: number, country: number): number {
    if (Number.isNaN(lat) || Number.isNaN(lon)) return 0;
    if (!this.keyMap) {
      this.keyMap = new Map();
      for (let i = 1; i < this.base.length; i++) {
        const k = LocationTable.key(this.base.lat(i), this.base.lon(i), this.base.country(i));
        if (!this.keyMap.has(k)) this.keyMap.set(k, i);
      }
    }
    const k = LocationTable.key(lat, lon, country);
    const hit = this.keyMap.get(k);
    if (hit !== undefined) return hit;
    const idx = this.length;
    this.extra.push({ lat, lon, country, nodeCount: 0, city: '' });
    this.keyMap.set(k, idx);
    return idx;
  }
}

type Column = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array;

export class NodeTable {
  count = 0;
  capacity = 0;
  ids: Uint32Array = new Uint32Array(0);
  lat: Float32Array = new Float32Array(0);
  lon: Float32Array = new Float32Array(0);
  tier: Uint8Array = new Uint8Array(0);
  status: Uint8Array = new Uint8Array(0);
  flags: Uint8Array = new Uint8Array(0);
  loc: Uint32Array = new Uint32Array(0);
  country: Uint16Array = new Uint16Array(0);
  org: Uint16Array = new Uint16Array(0);
  appCount: Uint16Array = new Uint16Array(0);
  /** Rank plus one; 0 = not queued. */
  rank: Uint32Array = new Uint32Array(0);
  lastPaid: Uint32Array = new Uint32Array(0);
  cores: Uint16Array = new Uint16Array(0);
  ramGb: Uint16Array = new Uint16Array(0);
  ssdGb: Uint32Array = new Uint32Array(0);
  version: Uint16Array = new Uint16Array(0);
  /** Height of the last confirm seen live (not part of nodes.bin); 0 = unknown. */
  lastConfirmed: Uint32Array = new Uint32Array(0);
  /** `Reach` values from sweeps and WatchProbe. */
  reachable: Uint8Array = new Uint8Array(0);
  /** >= 0: index into the snapshot's ips table; < 0: -(k + 1) into `endpointsExtra`. */
  endpointRef: Int32Array = new Int32Array(0);

  private ipsBase: StringTable | null = null;
  private endpointsExtra: string[] = [];
  countries!: InternTable;
  orgs!: InternTable;
  versions!: InternTable;
  locations!: LocationTable;
  private index = new Map<number, number>();
  /** Snapshot seq of the loaded nodes.bin. */
  snapshotSeq = 0;
  generatedMs = 0;

  static fromSnapshot(bin: NodesBin): NodeTable {
    const t = new NodeTable();
    t.load(bin);
    return t;
  }

  private columns(): Column[] {
    return [
      this.ids,
      this.lat,
      this.lon,
      this.tier,
      this.status,
      this.flags,
      this.loc,
      this.country,
      this.org,
      this.appCount,
      this.rank,
      this.lastPaid,
      this.cores,
      this.ramGb,
      this.ssdGb,
      this.version,
      this.lastConfirmed,
      this.reachable,
      this.endpointRef,
    ];
  }

  load(bin: NodesBin): void {
    const n = bin.count;
    this.count = n;
    this.capacity = n;
    this.ids = bin.ids;
    this.lat = bin.lat;
    this.lon = bin.lon;
    this.tier = bin.tier;
    this.status = bin.status;
    this.flags = bin.flagsCol;
    this.loc = bin.loc;
    this.country = bin.country;
    this.org = bin.org;
    this.appCount = bin.appCount;
    this.rank = bin.rank;
    this.lastPaid = bin.lastPaid;
    this.cores = bin.cores;
    this.ramGb = bin.ramGb;
    this.ssdGb = bin.ssdGb;
    this.version = bin.version;
    this.lastConfirmed = new Uint32Array(n);
    this.reachable = new Uint8Array(n);
    this.endpointRef = new Int32Array(n);
    for (let i = 0; i < n; i++) this.endpointRef[i] = i;
    this.ipsBase = bin.ips;
    this.endpointsExtra = [];
    this.countries = new InternTable(bin.countries, countryKey);
    this.orgs = new InternTable(bin.orgs);
    this.versions = new InternTable(bin.versions);
    this.locations = new LocationTable(bin.locations);
    this.index = new Map();
    for (let i = 0; i < n; i++) this.index.set(bin.ids[i]!, i);
    this.snapshotSeq = bin.seq;
    this.generatedMs = bin.generatedMs;
  }

  /** Row index of node `id`, or -1. */
  indexOf(id: number): number {
    return this.index.get(id) ?? -1;
  }

  has(id: number): boolean {
    return this.index.has(id);
  }

  endpoint(i: number): string {
    const ref = this.endpointRef[i];
    if (ref === undefined) return '';
    if (ref >= 0) return this.ipsBase?.get(ref) ?? '';
    return this.endpointsExtra[-ref - 1] ?? '';
  }

  setEndpoint(i: number, ep: string | null): void {
    this.endpointsExtra.push(ep ?? '');
    this.endpointRef[i] = -this.endpointsExtra.length;
  }

  /** ISO country code of row `i` ('' when unknown). */
  countryCode(i: number): string {
    return countryKey(this.countries.get(this.country[i] ?? 0));
  }

  orgName(i: number): string {
    return this.orgs.get(this.org[i] ?? 0);
  }

  fluxOs(i: number): string {
    return this.versions.get(this.version[i] ?? 0);
  }

  /** Subarray views trimmed to `count` (capacity may exceed it). */
  view<K extends keyof NodeTable>(k: K): NodeTable[K] {
    const col = this[k];
    if (ArrayBuffer.isView(col) && 'subarray' in col) {
      return (col as unknown as Column).subarray(0, this.count) as unknown as NodeTable[K];
    }
    return col;
  }

  private grow(min: number): void {
    const cap = Math.max(64, Math.ceil(min * 1.25));
    const re = <T extends Column>(a: T, fill?: number): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a.subarray(0, this.count));
      if (fill !== undefined) b.fill(fill, this.count);
      return b;
    };
    this.ids = re(this.ids);
    this.lat = re(this.lat, Number.NaN);
    this.lon = re(this.lon, Number.NaN);
    this.tier = re(this.tier);
    this.status = re(this.status);
    this.flags = re(this.flags);
    this.loc = re(this.loc);
    this.country = re(this.country);
    this.org = re(this.org);
    this.appCount = re(this.appCount);
    this.rank = re(this.rank);
    this.lastPaid = re(this.lastPaid);
    this.cores = re(this.cores);
    this.ramGb = re(this.ramGb);
    this.ssdGb = re(this.ssdGb);
    this.version = re(this.version);
    this.lastConfirmed = re(this.lastConfirmed);
    this.reachable = re(this.reachable);
    this.endpointRef = re(this.endpointRef);
    this.capacity = cap;
  }

  /** Inserts or overwrites a node from a live `NodeLite`. Returns its row index. */
  upsert(n: NodeLite): number {
    let i = this.index.get(n.id);
    if (i === undefined) {
      if (this.count >= this.capacity) this.grow(this.count + 1);
      i = this.count++;
      this.index.set(n.id, i);
      this.ids[i] = n.id;
      this.cores[i] = 0;
      this.ramGb[i] = 0;
      this.ssdGb[i] = 0;
      this.version[i] = 0;
      this.lastConfirmed[i] = 0;
      this.reachable[i] = Reach.Unknown;
      this.loc[i] = 0;
    } else {
      this.locations.adjust(this.loc[i]!, -1);
    }
    this.tier[i] = tierCode(n.tier);
    this.status[i] = statusCode(n.status);
    this.flags[i] = n.flags;
    this.lat[i] = n.lat ?? Number.NaN;
    this.lon[i] = n.lon ?? Number.NaN;
    this.country[i] = n.country_code
      ? this.countries.intern(n.country_code, n.country_code + COUNTRY_SEP)
      : 0;
    this.org[i] = n.org ? this.orgs.intern(n.org) : 0;
    this.appCount[i] = n.app_count;
    this.rank[i] = n.rank === null ? 0 : n.rank + 1;
    this.lastPaid[i] = n.last_paid_height ?? 0;
    this.setEndpoint(i, n.endpoint);
    this.loc[i] = this.locations.locate(this.lat[i]!, this.lon[i]!, this.country[i]!);
    this.locations.adjust(this.loc[i]!, 1);
    return i;
  }

  /** Removes node `id` (swap-remove). Returns false when unknown. */
  remove(id: number): boolean {
    const i = this.index.get(id);
    if (i === undefined) return false;
    this.locations.adjust(this.loc[i]!, -1);
    const last = this.count - 1;
    if (i !== last) {
      for (const col of this.columns()) col[i] = col[last]!;
      this.index.set(this.ids[i]!, i);
    }
    this.index.delete(id);
    this.count = last;
    return true;
  }

  /** Applies changed fields to an existing node. Returns the field bits touched, or -1 when unknown. */
  applyChange(c: NodeChange): number {
    const i = this.index.get(c.id);
    if (i === undefined) return -1;
    let f = 0;
    if (c.tier !== undefined) {
      this.tier[i] = tierCode(c.tier);
      f |= NodeField.Tier;
    }
    if (c.status !== undefined) {
      this.status[i] = statusCode(c.status);
      f |= NodeField.Status;
    }
    if (c.flags !== undefined) {
      this.flags[i] = c.flags;
      f |= NodeField.Flags;
    }
    if (c.rank !== undefined) {
      // `null` is the explicit unranked signal (stored 0 = not queued).
      this.rank[i] = c.rank === null ? 0 : c.rank + 1;
      f |= NodeField.Rank;
    }
    if (c.last_paid_height !== undefined) {
      this.lastPaid[i] = c.last_paid_height;
      f |= NodeField.LastPaid;
    }
    if (c.last_confirmed_height !== undefined) {
      this.lastConfirmed[i] = c.last_confirmed_height;
      f |= NodeField.LastConfirmed;
    }
    if (c.app_count !== undefined) {
      this.appCount[i] = c.app_count;
      f |= NodeField.AppCount;
    }
    if (c.endpoint !== undefined) {
      this.setEndpoint(i, c.endpoint);
      f |= NodeField.Endpoint;
    }
    if (c.org !== undefined) {
      this.org[i] = this.orgs.intern(c.org);
      f |= NodeField.Org;
    }
    if (c.flux_os !== undefined) {
      this.version[i] = this.versions.intern(c.flux_os);
      f |= NodeField.Version;
    }
    if (c.reachable !== undefined) {
      this.reachable[i] = c.reachable ? Reach.Yes : Reach.No;
      f |= NodeField.Reachable;
    }
    if (c.lat !== undefined || c.lon !== undefined || c.country_code !== undefined) {
      if (c.lat !== undefined) this.lat[i] = c.lat;
      if (c.lon !== undefined) this.lon[i] = c.lon;
      if (c.country_code !== undefined) {
        this.country[i] = this.countries.intern(c.country_code, c.country_code + COUNTRY_SEP);
      }
      const next = this.locations.locate(this.lat[i]!, this.lon[i]!, this.country[i]!);
      if (next !== this.loc[i]) {
        this.locations.adjust(this.loc[i]!, -1);
        this.locations.adjust(next, 1);
        this.loc[i] = next;
      }
      f |= NodeField.Geo;
    }
    return f;
  }
}

// Decoder for `GET /api/v1/nodes.bin` (magic FXAT, version 1): the columnar node snapshot that feeds
// the globe and the tables. Layout: crates/atlas-core/src/codec/README.md.
//
// Fixed-width columns are zero-copy typed-array views over the response buffer. String tables are
// decoded lazily. Unknown sections are ignored; missing optional columns are defaulted (NaN
// coordinates, zeros, empty strings) so the server may drop columns without breaking clients.
// A missing column means the producer did not record it (for example `/timeline/state` has no
// ranks): `present` tells a defaulted column apart from real zeros, and readers must treat an
// absent column as unknown, never as 0.

import {
  BinFormatError,
  type Container,
  columnView,
  DType,
  noteUnknown,
  ORIGIN_KIND,
  readContainer,
  readOrigin,
  type SnapshotOrigin,
  StringTable,
  stringSection,
} from './bin/container';
import type { NodeStatus } from './generated/NodeStatus';
import type { Tier } from './generated/Tier';

export const NODES_MAGIC = 'FXAT';

/** Section kinds of nodes.bin. */
export const NodeSection = {
  Ids: 1,
  Lat: 2,
  Lon: 3,
  Tier: 4,
  Status: 5,
  Flags: 6,
  Loc: 7,
  Country: 8,
  Org: 9,
  AppCount: 10,
  Rank: 11,
  LastPaid: 12,
  Cores: 13,
  RamGb: 14,
  SsdGb: 15,
  Version: 16,
  /** Collateral outpoint per row (struct, 36 bytes each): the stable node key. */
  Outpoints: 17,
  Ips: 32,
  Countries: 33,
  Orgs: 34,
  Versions: 35,
  Locations: 36,
  /** Which server built the file (struct, 16 bytes). */
  Origin: ORIGIN_KIND,
} as const;

const KNOWN = new Set<number>(Object.values(NodeSection));

/** The dtype each known column is read with; a column stored with another dtype is skipped. */
const EXPECTED_DTYPE: Record<number, number> = {
  [NodeSection.Ids]: DType.U32,
  [NodeSection.Lat]: DType.F32,
  [NodeSection.Lon]: DType.F32,
  [NodeSection.Tier]: DType.U8,
  [NodeSection.Status]: DType.U8,
  [NodeSection.Flags]: DType.U8,
  [NodeSection.Loc]: DType.U32,
  [NodeSection.Country]: DType.U16,
  [NodeSection.Org]: DType.U16,
  [NodeSection.AppCount]: DType.U16,
  [NodeSection.Rank]: DType.U32,
  [NodeSection.LastPaid]: DType.U32,
  [NodeSection.Cores]: DType.U16,
  [NodeSection.RamGb]: DType.U16,
  [NodeSection.SsdGb]: DType.U32,
  [NodeSection.Version]: DType.U16,
  [NodeSection.Outpoints]: DType.Struct,
  [NodeSection.Ips]: DType.Strings,
  [NodeSection.Countries]: DType.Strings,
  [NodeSection.Orgs]: DType.Strings,
  [NodeSection.Versions]: DType.Strings,
  [NodeSection.Locations]: DType.Struct,
  [NodeSection.Origin]: DType.Struct,
};

/** Section kinds actually readable from `c`: unknown kinds, and known kinds with their dtype. */
function presentKinds(c: Container): Set<number> {
  const out = new Set<number>();
  for (const [kind, e] of c.sections) {
    const want = EXPECTED_DTYPE[kind];
    if (want === undefined || want === e.dtype) out.add(kind);
  }
  return out;
}

/** Bits of the `flags` column (and of `NodeLite.flags`). */
export const NodeFlag = {
  HasApps: 0x01,
  Ipv6: 0x02,
  NonDefaultPort: 0x04,
  GeoApprox: 0x08,
  Arcane: 0x10,
  Enterprise: 0x20,
  RecentlyPaid: 0x40,
  New24h: 0x80,
} as const;

/** Wire codes of the `tier` column, index = code. */
export const TIER_CODES: readonly Tier[] = ['unknown', 'cumulus', 'nimbus', 'stratus'];
/** Wire codes of the `status` column, index = code. */
export const STATUS_CODES: readonly NodeStatus[] = [
  'unknown',
  'confirmed',
  'started',
  'dos',
  'offline',
  'expired',
  'departed',
];

export function tierCode(t: Tier): number {
  const i = TIER_CODES.indexOf(t);
  return i < 0 ? 0 : i;
}

export function statusCode(s: NodeStatus): number {
  const i = STATUS_CODES.indexOf(s);
  return i < 0 ? 0 : i;
}

/** Separator between country code and name in the COUNTRIES table. */
export const COUNTRY_SEP = '\u001f';

/** Splits a COUNTRIES entry (`DE\u001fGermany`) into code and name. */
export function splitCountry(entry: string): { code: string; name: string } {
  const i = entry.indexOf(COUNTRY_SEP);
  return i < 0 ? { code: entry, name: '' } : { code: entry.slice(0, i), name: entry.slice(i + 1) };
}

/**
 * LOCATIONS: co-located clusters. Entry 0 is "unknown location". The 16-byte records are read
 * through strided typed-array views (no copy); city names are a lazy string table.
 */
export class Locations {
  readonly length: number;
  private readonly f32: Float32Array;
  private readonly u16: Uint16Array;
  private readonly u32: Uint32Array;
  readonly cities: StringTable;

  constructor(n: number, f32: Float32Array, u16: Uint16Array, u32: Uint32Array, cities: StringTable) {
    this.length = n;
    this.f32 = f32;
    this.u16 = u16;
    this.u32 = u32;
    this.cities = cities;
  }

  static empty(): Locations {
    const f32 = new Float32Array([Number.NaN, Number.NaN, 0, 0]);
    return new Locations(1, f32, new Uint16Array(8), new Uint32Array(4), StringTable.empty(1));
  }

  static read(buffer: ArrayBuffer, offset: number, byteLen: number): Locations {
    if (byteLen < 4) throw new BinFormatError('LOCATIONS: truncated');
    const n = new DataView(buffer, offset, 4).getUint32(0, true);
    const recBytes = n * 16;
    if (4 + recBytes > byteLen) throw new BinFormatError('LOCATIONS: records exceed the section');
    const base = offset + 4;
    const f32 = new Float32Array(buffer, base, n * 4);
    const u16 = new Uint16Array(buffer, base, n * 8);
    const u32 = new Uint32Array(buffer, base, n * 4);
    const cities = StringTable.read(buffer, base + recBytes, byteLen - 4 - recBytes, 'LOCATIONS cities');
    return new Locations(n, f32, u16, u32, cities);
  }

  lat(i: number): number {
    return this.f32[i * 4] ?? Number.NaN;
  }
  lon(i: number): number {
    return this.f32[i * 4 + 1] ?? Number.NaN;
  }
  /** Index into COUNTRIES. */
  country(i: number): number {
    return this.u16[i * 8 + 4] ?? 0;
  }
  nodeCount(i: number): number {
    return this.u32[i * 4 + 3] ?? 0;
  }
  city(i: number): string {
    return this.cities.get(i);
  }
}

const OUTPOINT_BYTES = 36;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * OUTPOINTS: the collateral outpoint (`txid:vout`) per row, read through a zero-copy view of the
 * 36-byte records. Strings are built on first access per row and cached. Without the section
 * every row reads as `''` (unknown).
 */
export class Outpoints {
  readonly length: number;
  private readonly bytes: Uint8Array;
  private readonly dv: DataView | null;
  private readonly cache: (string | undefined)[];

  constructor(n: number, bytes: Uint8Array) {
    this.length = n;
    this.bytes = bytes;
    this.dv = bytes.byteLength > 0 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    this.cache = new Array(n);
  }

  static empty(n: number): Outpoints {
    return new Outpoints(n, new Uint8Array(0));
  }

  static read(buffer: ArrayBuffer, offset: number, byteLen: number, count: number): Outpoints {
    if (byteLen !== count * OUTPOINT_BYTES) {
      throw new BinFormatError(`OUTPOINTS: ${byteLen} bytes, expected ${count * OUTPOINT_BYTES}`);
    }
    return new Outpoints(count, new Uint8Array(buffer, offset, byteLen));
  }

  /** True when the file carried outpoints. */
  get known(): boolean {
    return this.dv !== null;
  }

  /** `txid:vout` of row `i`, or `''` when unknown. */
  get(i: number): string {
    if (!this.dv || i < 0 || i >= this.length) return '';
    const hit = this.cache[i];
    if (hit !== undefined) return hit;
    const at = i * OUTPOINT_BYTES;
    let hex = '';
    for (let k = 0; k < 32; k++) hex += HEX[this.bytes[at + k]!];
    const s = `${hex}:${this.dv.getUint32(at + 32, true)}`;
    this.cache[i] = s;
    return s;
  }
}

export interface NodesBin {
  seq: number;
  generatedMs: number;
  flags: number;
  count: number;
  ids: Uint32Array;
  /** Degrees; NaN = unknown location. */
  lat: Float32Array;
  lon: Float32Array;
  tier: Uint8Array;
  status: Uint8Array;
  flagsCol: Uint8Array;
  /** Index into `locations` (0 = unknown). */
  loc: Uint32Array;
  /** Index into `countries` (0 = unknown). */
  country: Uint16Array;
  /** Index into `orgs` (0 = unknown). */
  org: Uint16Array;
  appCount: Uint16Array;
  /** Payment-queue rank plus one; 0 = not queued. */
  rank: Uint32Array;
  /** Height of the last payment; 0 = never. */
  lastPaid: Uint32Array;
  cores: Uint16Array;
  ramGb: Uint16Array;
  ssdGb: Uint32Array;
  /** Index into `versions` (FluxOS; 0 = unknown). */
  version: Uint16Array;
  /** `ip:port` per row (`[v6]:port`), empty when unknown. */
  ips: StringTable;
  countries: StringTable;
  orgs: StringTable;
  versions: StringTable;
  locations: Locations;
  /** Collateral outpoint per row (the stable key); every row `''` when the file has none. */
  outpoints: Outpoints;
  /** The server that built the file, or null when the file has no ORIGIN (older servers). */
  origin: SnapshotOrigin | null;
  /** Section kinds present in the file that were skipped. */
  unknownSections: number[];
  /**
   * Every section kind present in the file. A known column missing from it was not recorded by
   * the producer: its defaulted values (zeros, NaN, empty strings) mean "unknown".
   */
  present: ReadonlySet<number>;
}

/** True when `bin` carries column `kind` (a `NodeSection`); false means "not recorded". */
export function hasColumn(bin: Pick<NodesBin, 'present'>, kind: number): boolean {
  return bin.present.has(kind);
}

function nanColumn(n: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(Number.NaN);
  return a;
}

/** Decodes a nodes.bin buffer. Throws `BinFormatError` on a malformed or incompatible file. */
export function decodeNodesBin(input: ArrayBuffer | ArrayBufferView): NodesBin {
  const c: Container = readContainer(input, NODES_MAGIC);
  noteUnknown(c, KNOWN);
  const n = c.header.count;
  const ids = columnView(c, NodeSection.Ids, DType.U32, Uint32Array);
  if (!ids) throw new BinFormatError('nodes.bin: the ids column is required');

  const locSection = c.sections.get(NodeSection.Locations);
  const locations =
    locSection && locSection.dtype === DType.Struct
      ? Locations.read(c.buffer, locSection.offset, locSection.byteLen)
      : Locations.empty();

  const opSection = c.sections.get(NodeSection.Outpoints);
  const outpoints =
    opSection && opSection.dtype === DType.Struct
      ? Outpoints.read(c.buffer, opSection.offset, opSection.byteLen, n)
      : Outpoints.empty(n);

  const ips = stringSection(c, NodeSection.Ips) ?? StringTable.empty(n);
  if (ips.length !== n) throw new BinFormatError(`nodes.bin: ips has ${ips.length} entries, expected ${n}`);

  return {
    seq: c.header.seq,
    generatedMs: c.header.generatedMs,
    flags: c.header.flags,
    count: n,
    ids,
    lat: columnView(c, NodeSection.Lat, DType.F32, Float32Array) ?? nanColumn(n),
    lon: columnView(c, NodeSection.Lon, DType.F32, Float32Array) ?? nanColumn(n),
    tier: columnView(c, NodeSection.Tier, DType.U8, Uint8Array) ?? new Uint8Array(n),
    status: columnView(c, NodeSection.Status, DType.U8, Uint8Array) ?? new Uint8Array(n),
    flagsCol: columnView(c, NodeSection.Flags, DType.U8, Uint8Array) ?? new Uint8Array(n),
    loc: columnView(c, NodeSection.Loc, DType.U32, Uint32Array) ?? new Uint32Array(n),
    country: columnView(c, NodeSection.Country, DType.U16, Uint16Array) ?? new Uint16Array(n),
    org: columnView(c, NodeSection.Org, DType.U16, Uint16Array) ?? new Uint16Array(n),
    appCount: columnView(c, NodeSection.AppCount, DType.U16, Uint16Array) ?? new Uint16Array(n),
    rank: columnView(c, NodeSection.Rank, DType.U32, Uint32Array) ?? new Uint32Array(n),
    lastPaid: columnView(c, NodeSection.LastPaid, DType.U32, Uint32Array) ?? new Uint32Array(n),
    cores: columnView(c, NodeSection.Cores, DType.U16, Uint16Array) ?? new Uint16Array(n),
    ramGb: columnView(c, NodeSection.RamGb, DType.U16, Uint16Array) ?? new Uint16Array(n),
    ssdGb: columnView(c, NodeSection.SsdGb, DType.U32, Uint32Array) ?? new Uint32Array(n),
    version: columnView(c, NodeSection.Version, DType.U16, Uint16Array) ?? new Uint16Array(n),
    ips,
    countries: stringSection(c, NodeSection.Countries) ?? StringTable.empty(1),
    orgs: stringSection(c, NodeSection.Orgs) ?? StringTable.empty(1),
    versions: stringSection(c, NodeSection.Versions) ?? StringTable.empty(1),
    locations,
    outpoints,
    origin: readOrigin(c),
    unknownSections: c.unknownKinds,
    present: presentKinds(c),
  };
}

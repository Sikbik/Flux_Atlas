// Decoders for the Atlas server's binary snapshots, ported from web/src/api (bin/container.ts,
// nodesBin.ts, meshBin.ts) so the lab stays standalone. The wire format is authoritative in the
// server's crates/atlas-core/src/codec/README.md; this port reads exactly what the web app reads.
//
//   nodes.bin (magic FXAT)  the columnar node snapshot: ids, positions, tiers, status, flags, the
//                           co-location clusters with their city names, countries, providers
//   mesh.bin  (magic FXMS)  undirected peer links, a < b

const DType = { U8: 1, U16: 2, U32: 3, I32: 4, F32: 5, F64: 6, U64: 7, Strings: 16, Struct: 17 } as const;
const HEADER_BYTES = 32;
const SECTION_ENTRY_BYTES = 12;
const FORMAT_VERSION = 1;

export class BinFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinFormatError';
  }
}

interface SectionEntry {
  kind: number;
  dtype: number;
  offset: number;
  byteLen: number;
}
interface Container {
  buffer: ArrayBuffer;
  header: { magic: string; version: number; flags: number; seq: number; generatedMs: number; count: number; sectionCount: number };
  sections: Map<number, SectionEntry>;
}

function readContainer(input: ArrayBuffer, expectedMagic: string): Container {
  const buffer = input;
  const len = buffer.byteLength;
  if (len < HEADER_BYTES) throw new BinFormatError(`truncated: ${len} bytes is shorter than the header`);
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== expectedMagic) throw new BinFormatError(`bad magic ${JSON.stringify(magic)}, expected ${expectedMagic}`);
  const version = dv.getUint16(4, true);
  if (version !== FORMAT_VERSION) throw new BinFormatError(`unsupported format version ${version}`);
  const header = {
    magic,
    version,
    flags: dv.getUint16(6, true),
    seq: Number(dv.getBigUint64(8, true)),
    generatedMs: Number(dv.getBigUint64(16, true)),
    count: dv.getUint32(24, true),
    sectionCount: dv.getUint32(28, true),
  };
  const tableEnd = HEADER_BYTES + header.sectionCount * SECTION_ENTRY_BYTES;
  if (tableEnd > len) throw new BinFormatError('truncated section table');
  const sections = new Map<number, SectionEntry>();
  for (let i = 0; i < header.sectionCount; i++) {
    const at = HEADER_BYTES + i * SECTION_ENTRY_BYTES;
    const e: SectionEntry = { kind: dv.getUint16(at, true), dtype: dv.getUint16(at + 2, true), offset: dv.getUint32(at + 4, true), byteLen: dv.getUint32(at + 8, true) };
    if (e.offset % 8 !== 0) throw new BinFormatError(`section ${e.kind} is not 8-byte aligned`);
    if (e.offset < tableEnd || e.offset + e.byteLen > len) throw new BinFormatError(`section ${e.kind} lies outside the buffer`);
    if (!sections.has(e.kind)) sections.set(e.kind, e);
  }
  return { buffer, header, sections };
}

type TypedCtor<T> = { new (buffer: ArrayBuffer, byteOffset: number, length: number): T; BYTES_PER_ELEMENT: number };

function columnView<T>(c: Container, kind: number, dtype: number, Ctor: TypedCtor<T>): T | undefined {
  const s = c.sections.get(kind);
  if (!s || s.dtype !== dtype) return undefined;
  const expected = c.header.count * Ctor.BYTES_PER_ELEMENT;
  if (s.byteLen !== expected) throw new BinFormatError(`column ${kind}: ${s.byteLen} bytes, expected ${expected} for ${c.header.count} rows`);
  return new Ctor(c.buffer, s.offset, c.header.count);
}

const utf8 = new TextDecoder('utf-8');

/** `u32 n`, `u32 offsets[n + 1]`, UTF-8 blob; strings decode lazily. */
export class StringTable {
  readonly length: number;
  private readonly offsets: Uint32Array;
  private readonly blob: Uint8Array;
  private readonly cache: (string | undefined)[];
  constructor(offsets: Uint32Array, blob: Uint8Array) {
    this.offsets = offsets;
    this.blob = blob;
    this.length = Math.max(0, offsets.length - 1);
    this.cache = new Array(this.length);
  }
  static empty(n = 0): StringTable {
    return new StringTable(new Uint32Array(n + 1), new Uint8Array(0));
  }
  static read(buffer: ArrayBuffer, offset: number, maxBytes: number, what: string): StringTable {
    if (maxBytes < 4) throw new BinFormatError(`${what}: truncated string table`);
    const n = new DataView(buffer, offset, 4).getUint32(0, true);
    const offsBytes = (n + 1) * 4;
    if (4 + offsBytes > maxBytes) throw new BinFormatError(`${what}: offsets exceed the section`);
    const offsets = new Uint32Array(buffer, offset + 4, n + 1);
    const blobLen = offsets[n] ?? 0;
    if (4 + offsBytes + blobLen > maxBytes) throw new BinFormatError(`${what}: blob exceeds the section`);
    return new StringTable(offsets, new Uint8Array(buffer, offset + 4 + offsBytes, blobLen));
  }
  get(i: number): string {
    if (i < 0 || i >= this.length) return '';
    const hit = this.cache[i];
    if (hit !== undefined) return hit;
    const a = this.offsets[i] ?? 0;
    const b = this.offsets[i + 1] ?? a;
    const s = a === b ? '' : utf8.decode(this.blob.subarray(a, b));
    this.cache[i] = s;
    return s;
  }
}

function stringSection(c: Container, kind: number): StringTable | undefined {
  const s = c.sections.get(kind);
  if (!s || s.dtype !== DType.Strings) return undefined;
  return StringTable.read(c.buffer, s.offset, s.byteLen, `section ${kind}`);
}

// ---- nodes.bin ---------------------------------------------------------------------------------------

const NodeSection = { Ids: 1, Lat: 2, Lon: 3, Tier: 4, Status: 5, Flags: 6, Loc: 7, Country: 8, Org: 9, AppCount: 10, Rank: 11, LastPaid: 12, Ips: 32, Countries: 33, Orgs: 34, Locations: 36 } as const;

/** Bits of the `flags` column. */
export const NodeFlagBit = { HasApps: 0x01, Ipv6: 0x02, NonDefaultPort: 0x04, GeoApprox: 0x08, Arcane: 0x10, Enterprise: 0x20, RecentlyPaid: 0x40, New24h: 0x80 } as const;

export const TIER_CODES = ['unknown', 'cumulus', 'nimbus', 'stratus'] as const;
export type TierName = (typeof TIER_CODES)[number];
/** Store status codes (unknown, confirmed, started, dos, offline, expired, departed) to the engine's (design: unreachable draws as offline). */
export const ENGINE_STATUS = [0, 1, 2, 4, 3, 3, 3] as const;

const COUNTRY_SEP = '\u001f';
/** Splits a COUNTRIES entry (`DE\u001fGermany`) into code and name. */
export function splitCountry(entry: string): { code: string; name: string } {
  const i = entry.indexOf(COUNTRY_SEP);
  return i < 0 ? { code: entry, name: '' } : { code: entry.slice(0, i), name: entry.slice(i + 1) };
}

/** LOCATIONS: co-located clusters of nodes, with their city names. Entry 0 is "unknown location". */
export class Locations {
  readonly length: number;
  private readonly f32: Float32Array;
  private readonly u16: Uint16Array;
  private readonly u32: Uint32Array;
  private readonly cities: StringTable;
  constructor(length: number, f32: Float32Array, u16: Uint16Array, u32: Uint32Array, cities: StringTable) {
    this.length = length;
    this.f32 = f32;
    this.u16 = u16;
    this.u32 = u32;
    this.cities = cities;
  }
  static empty(): Locations {
    return new Locations(1, new Float32Array([NaN, NaN, 0, 0]), new Uint16Array(8), new Uint32Array(4), StringTable.empty(1));
  }
  static read(buffer: ArrayBuffer, offset: number, byteLen: number): Locations {
    if (byteLen < 4) throw new BinFormatError('LOCATIONS: truncated');
    const n = new DataView(buffer, offset, 4).getUint32(0, true);
    const recBytes = n * 16;
    if (4 + recBytes > byteLen) throw new BinFormatError('LOCATIONS: records exceed the section');
    const base = offset + 4;
    return new Locations(n, new Float32Array(buffer, base, n * 4), new Uint16Array(buffer, base, n * 8), new Uint32Array(buffer, base, n * 4), StringTable.read(buffer, base + recBytes, byteLen - 4 - recBytes, 'LOCATIONS cities'));
  }
  lat(i: number): number {
    return this.f32[i * 4] ?? NaN;
  }
  lon(i: number): number {
    return this.f32[i * 4 + 1] ?? NaN;
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

export interface NodesBin {
  seq: number;
  generatedMs: number;
  count: number;
  ids: Uint32Array;
  lat: Float32Array;
  lon: Float32Array;
  tier: Uint8Array;
  status: Uint8Array;
  flagsCol: Uint8Array;
  loc: Uint32Array;
  country: Uint16Array;
  org: Uint16Array;
  appCount: Uint16Array;
  rank: Uint32Array;
  lastPaid: Uint32Array;
  ips: StringTable;
  countries: StringTable;
  orgs: StringTable;
  locations: Locations;
}

const nanColumn = (n: number): Float32Array => new Float32Array(n).fill(NaN);

export function decodeNodesBin(input: ArrayBuffer): NodesBin {
  const c = readContainer(input, 'FXAT');
  const n = c.header.count;
  const ids = columnView(c, NodeSection.Ids, DType.U32, Uint32Array);
  if (!ids) throw new BinFormatError('nodes.bin: the ids column is required');
  const loc = c.sections.get(NodeSection.Locations);
  return {
    seq: c.header.seq,
    generatedMs: c.header.generatedMs,
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
    ips: stringSection(c, NodeSection.Ips) ?? StringTable.empty(n),
    countries: stringSection(c, NodeSection.Countries) ?? StringTable.empty(1),
    orgs: stringSection(c, NodeSection.Orgs) ?? StringTable.empty(1),
    locations: loc && loc.dtype === DType.Struct ? Locations.read(c.buffer, loc.offset, loc.byteLen) : Locations.empty(),
  };
}

// ---- mesh.bin ----------------------------------------------------------------------------------------

export interface MeshBin {
  seq: number;
  generatedMs: number;
  count: number;
  /** NodeId of the lower endpoint. */
  a: Uint32Array;
  /** NodeId of the higher endpoint. */
  b: Uint32Array;
  flags: Uint8Array;
}

export function decodeMeshBin(input: ArrayBuffer): MeshBin {
  const c = readContainer(input, 'FXMS');
  const a = columnView(c, 1, DType.U32, Uint32Array);
  const b = columnView(c, 2, DType.U32, Uint32Array);
  if (!a || !b) throw new BinFormatError('mesh.bin: the a and b columns are required');
  return { seq: c.header.seq, generatedMs: c.header.generatedMs, count: c.header.count, a, b, flags: columnView(c, 3, DType.U8, Uint8Array) ?? new Uint8Array(c.header.count) };
}

/** Base64 to a fresh, 8-byte aligned ArrayBuffer (the typed-array views need alignment). */
export function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return buf;
}

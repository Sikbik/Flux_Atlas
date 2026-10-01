// Sectioned binary container shared by nodes.bin (FXAT) and mesh.bin (FXMS).
// Authoritative layout: crates/atlas-core/src/codec/README.md.
//
// Everything is little-endian and every section starts on an 8-byte boundary, so fixed-width
// columns are exposed as typed-array views over the fetched buffer without copying. Unknown section
// kinds and unknown dtypes are skipped: that is how the format evolves without a version bump.

export const DType = {
  U8: 1,
  U16: 2,
  U32: 3,
  I32: 4,
  F32: 5,
  F64: 6,
  U64: 7,
  Strings: 16,
  Struct: 17,
} as const;
export type DTypeCode = (typeof DType)[keyof typeof DType];

export const HEADER_BYTES = 32;
export const SECTION_ENTRY_BYTES = 12;
export const FORMAT_VERSION = 1;

export interface ContainerHeader {
  magic: string;
  version: number;
  flags: number;
  seq: number;
  generatedMs: number;
  count: number;
  sectionCount: number;
}

export interface SectionEntry {
  kind: number;
  dtype: number;
  /** Absolute byte offset into the buffer (a multiple of 8). */
  offset: number;
  /** Length without padding. */
  byteLen: number;
}

export interface Container {
  buffer: ArrayBuffer;
  header: ContainerHeader;
  /** Sections by kind (the first occurrence wins). */
  sections: Map<number, SectionEntry>;
  /** Kinds present in the file that this decoder does not understand. */
  unknownKinds: number[];
}

export class BinFormatError extends Error {
  override name = 'BinFormatError';
}

const ELEMENT_BYTES: Partial<Record<number, number>> = {
  [DType.U8]: 1,
  [DType.U16]: 2,
  [DType.U32]: 4,
  [DType.I32]: 4,
  [DType.F32]: 4,
  [DType.F64]: 8,
  [DType.U64]: 8,
};

/** Element size of a fixed-width dtype, or undefined for variable-width and unknown dtypes. */
export function elementBytes(dtype: number): number | undefined {
  return ELEMENT_BYTES[dtype];
}

/**
 * Returns an ArrayBuffer whose byte 0 is the first byte of `input`, copying only when a view
 * would otherwise be misaligned (for example a Node Buffer slice from a pool).
 */
export function alignedBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const { buffer, byteOffset, byteLength } = input;
  if (byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer) return buffer;
  const copy = new ArrayBuffer(byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer, byteOffset, byteLength));
  return copy;
}

/** Parses and validates the header and section table. Does not touch section contents. */
export function readContainer(input: ArrayBuffer | ArrayBufferView, expectedMagic: string): Container {
  const buffer = alignedBuffer(input);
  const len = buffer.byteLength;
  if (len < HEADER_BYTES) throw new BinFormatError(`truncated: ${len} bytes is shorter than the header`);
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== expectedMagic)
    throw new BinFormatError(`bad magic ${JSON.stringify(magic)}, expected ${expectedMagic}`);
  const version = dv.getUint16(4, true);
  if (version !== FORMAT_VERSION) {
    throw new BinFormatError(`unsupported format version ${version} (this client reads ${FORMAT_VERSION})`);
  }
  const header: ContainerHeader = {
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
  const unknownKinds: number[] = [];
  for (let i = 0; i < header.sectionCount; i++) {
    const at = HEADER_BYTES + i * SECTION_ENTRY_BYTES;
    const entry: SectionEntry = {
      kind: dv.getUint16(at, true),
      dtype: dv.getUint16(at + 2, true),
      offset: dv.getUint32(at + 4, true),
      byteLen: dv.getUint32(at + 8, true),
    };
    if (entry.offset % 8 !== 0) throw new BinFormatError(`section ${entry.kind} is not 8-byte aligned`);
    if (entry.offset < tableEnd || entry.offset + entry.byteLen > len) {
      throw new BinFormatError(`section ${entry.kind} lies outside the buffer`);
    }
    if (!sections.has(entry.kind)) sections.set(entry.kind, entry);
  }
  return { buffer, header, sections, unknownKinds };
}

type TypedCtor<T> = {
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
  BYTES_PER_ELEMENT: number;
};

/**
 * A zero-copy view of a fixed-width column, or undefined when the section is absent or has a
 * different dtype (an unknown encoding of a known kind is skipped, never misread).
 */
export function columnView<T>(
  c: Container,
  kind: number,
  dtype: DTypeCode,
  Ctor: TypedCtor<T>,
): T | undefined {
  const s = c.sections.get(kind);
  if (!s || s.dtype !== dtype) return undefined;
  const expected = c.header.count * Ctor.BYTES_PER_ELEMENT;
  if (s.byteLen !== expected) {
    throw new BinFormatError(
      `column ${kind}: ${s.byteLen} bytes, expected ${expected} for ${c.header.count} rows`,
    );
  }
  return new Ctor(c.buffer, s.offset, c.header.count);
}

const utf8 = new TextDecoder('utf-8');

/**
 * A string table decoded lazily: `u32 n`, `u32 offsets[n + 1]`, UTF-8 blob. Strings are decoded
 * on first access and cached.
 */
export class StringTable {
  readonly length: number;
  private readonly offsets: Uint32Array;
  private readonly blob: Uint8Array;
  private readonly cache: (string | undefined)[];

  constructor(offsets: Uint32Array, blob: Uint8Array) {
    this.length = Math.max(0, offsets.length - 1);
    this.offsets = offsets;
    this.blob = blob;
    this.cache = new Array(this.length);
  }

  /** An empty table with `n` empty strings. */
  static empty(n = 0): StringTable {
    return new StringTable(new Uint32Array(n + 1), new Uint8Array(0));
  }

  /** Reads a table that starts at absolute byte `offset` and spans at most `maxBytes`. */
  static read(buffer: ArrayBuffer, offset: number, maxBytes: number, what: string): StringTable {
    if (maxBytes < 4) throw new BinFormatError(`${what}: truncated string table`);
    const n = new DataView(buffer, offset, 4).getUint32(0, true);
    const offsBytes = (n + 1) * 4;
    if (4 + offsBytes > maxBytes) throw new BinFormatError(`${what}: offsets exceed the section`);
    if ((offset + 4) % 4 !== 0) throw new BinFormatError(`${what}: misaligned offsets`);
    const offsets = new Uint32Array(buffer, offset + 4, n + 1);
    const blobLen = offsets[n] ?? 0;
    if (4 + offsBytes + blobLen > maxBytes) throw new BinFormatError(`${what}: blob exceeds the section`);
    for (let i = 0; i < n; i++) {
      if ((offsets[i] ?? 0) > (offsets[i + 1] ?? 0)) throw new BinFormatError(`${what}: offsets decrease`);
    }
    const blob = new Uint8Array(buffer, offset + 4 + offsBytes, blobLen);
    return new StringTable(offsets, blob);
  }

  /** String `i`; empty for out-of-range indices. */
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

  /** Decodes every entry (use sparingly on large tables). */
  toArray(): string[] {
    const out = new Array<string>(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.get(i);
    return out;
  }
}

/** Reads a string-table section of `kind`, or undefined when absent / not a string table. */
export function stringSection(c: Container, kind: number): StringTable | undefined {
  const s = c.sections.get(kind);
  if (!s || s.dtype !== DType.Strings) return undefined;
  return StringTable.read(c.buffer, s.offset, s.byteLen, `section ${kind}`);
}

/** Records the kinds this decoder skipped, for diagnostics. */
export function noteUnknown(c: Container, known: ReadonlySet<number>): void {
  for (const kind of c.sections.keys()) if (!known.has(kind)) c.unknownKinds.push(kind);
}

/** Section kind of ORIGIN, shared by nodes.bin, mesh.bin and `/timeline/state`. */
export const ORIGIN_KIND = 48;
const ORIGIN_BYTES = 16;

/**
 * Which server built a file: the process start epoch and the data directory's instance id (16
 * lowercase hex digits, the form of `ServerInfo.instance`). Node ids and seqs are local to one
 * origin (ARCHITECTURE 8.1), so files and live messages of two origins are never combined.
 */
export interface SnapshotOrigin {
  startedMs: number;
  instance: string;
}

/** Reads the ORIGIN section, or null when the file has none (older servers, test fixtures). */
export function readOrigin(c: Container): SnapshotOrigin | null {
  const s = c.sections.get(ORIGIN_KIND);
  if (!s || s.dtype !== DType.Struct) return null;
  if (s.byteLen < ORIGIN_BYTES) throw new BinFormatError(`ORIGIN: ${s.byteLen} bytes, expected 16`);
  const dv = new DataView(c.buffer, s.offset, ORIGIN_BYTES);
  return {
    startedMs: Number(dv.getBigUint64(0, true)),
    instance: dv.getBigUint64(8, true).toString(16).padStart(16, '0'),
  };
}

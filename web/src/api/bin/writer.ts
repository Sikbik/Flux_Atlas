// Minimal encoder for the sectioned container, used by tests (synthetic files, unknown-section
// tolerance, mesh fixtures) and benchmarks. The server's encoder is authoritative; this mirrors it.

import { DType, HEADER_BYTES, SECTION_ENTRY_BYTES } from './container';

export interface SectionSpec {
  kind: number;
  dtype: number;
  bytes: Uint8Array;
}

const pad8 = (n: number) => (n + 7) & ~7;

export function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Encodes a string table section body (`u32 n`, `u32 offsets[n+1]`, blob). */
export function stringTableBytes(strings: readonly string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts = strings.map((s) => enc.encode(s));
  const blobLen = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(4 + (strings.length + 1) * 4 + blobLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, strings.length, true);
  let off = 0;
  let at = 4 + (strings.length + 1) * 4;
  parts.forEach((p, i) => {
    dv.setUint32(4 + i * 4, off, true);
    out.set(p, at);
    at += p.length;
    off += p.length;
  });
  dv.setUint32(4 + strings.length * 4, off, true);
  return out;
}

export interface LocationSpec {
  lat: number;
  lon: number;
  country: number;
  nodeCount: number;
  city: string;
}

/** Encodes a LOCATIONS struct section body. */
export function locationsBytes(locs: readonly LocationSpec[]): Uint8Array {
  const table = stringTableBytes(locs.map((l) => l.city));
  const out = new Uint8Array(4 + locs.length * 16 + table.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, locs.length, true);
  locs.forEach((l, i) => {
    const at = 4 + i * 16;
    dv.setFloat32(at, l.lat, true);
    dv.setFloat32(at + 4, l.lon, true);
    dv.setUint16(at + 8, l.country, true);
    dv.setUint16(at + 10, 0, true);
    dv.setUint32(at + 12, l.nodeCount, true);
  });
  out.set(table, 4 + locs.length * 16);
  return out;
}

export function encodeContainer(
  magic: string,
  opts: { seq: number; generatedMs: number; count: number; version?: number; flags?: number },
  sections: readonly SectionSpec[],
): ArrayBuffer {
  const tableEnd = pad8(HEADER_BYTES + sections.length * SECTION_ENTRY_BYTES);
  let at = tableEnd;
  const offsets = sections.map((s) => {
    const o = at;
    at = pad8(at + s.bytes.length);
    return o;
  });
  const buf = new ArrayBuffer(at);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint16(4, opts.version ?? 1, true);
  dv.setUint16(6, opts.flags ?? 0, true);
  dv.setBigUint64(8, BigInt(opts.seq), true);
  dv.setBigUint64(16, BigInt(opts.generatedMs), true);
  dv.setUint32(24, opts.count, true);
  dv.setUint32(28, sections.length, true);
  sections.forEach((s, i) => {
    const e = HEADER_BYTES + i * SECTION_ENTRY_BYTES;
    dv.setUint16(e, s.kind, true);
    dv.setUint16(e + 2, s.dtype, true);
    dv.setUint32(e + 4, offsets[i] ?? 0, true);
    dv.setUint32(e + 8, s.bytes.length, true);
    u8.set(s.bytes, offsets[i] ?? 0);
  });
  return buf;
}

/** Row-oriented description of a node for synthetic nodes.bin files. */
export interface SyntheticNode {
  id: number;
  lat?: number;
  lon?: number;
  tier?: number;
  status?: number;
  flags?: number;
  loc?: number;
  country?: number;
  org?: number;
  appCount?: number;
  rank?: number;
  lastPaid?: number;
  ip?: string;
}

/** Builds a nodes.bin with every standard column for `nodes`, plus optional extra sections. */
export function encodeSyntheticNodesBin(
  nodes: readonly SyntheticNode[],
  opts: {
    seq?: number;
    generatedMs?: number;
    countries?: string[];
    orgs?: string[];
    versions?: string[];
    locations?: LocationSpec[];
    extra?: SectionSpec[];
  } = {},
): ArrayBuffer {
  const n = nodes.length;
  const col = <T extends ArrayBufferView>(make: (n: number) => T, fill: (a: T, i: number) => void) => {
    const a = make(n);
    for (let i = 0; i < n; i++) fill(a, i);
    return bytesOf(a);
  };
  const sections: SectionSpec[] = [
    {
      kind: 1,
      dtype: DType.U32,
      bytes: col(
        (k) => new Uint32Array(k),
        (a, i) => (a[i] = nodes[i]!.id),
      ),
    },
    {
      kind: 2,
      dtype: DType.F32,
      bytes: col(
        (k) => new Float32Array(k),
        (a, i) => (a[i] = nodes[i]!.lat ?? Number.NaN),
      ),
    },
    {
      kind: 3,
      dtype: DType.F32,
      bytes: col(
        (k) => new Float32Array(k),
        (a, i) => (a[i] = nodes[i]!.lon ?? Number.NaN),
      ),
    },
    {
      kind: 4,
      dtype: DType.U8,
      bytes: col(
        (k) => new Uint8Array(k),
        (a, i) => (a[i] = nodes[i]!.tier ?? 1),
      ),
    },
    {
      kind: 5,
      dtype: DType.U8,
      bytes: col(
        (k) => new Uint8Array(k),
        (a, i) => (a[i] = nodes[i]!.status ?? 1),
      ),
    },
    {
      kind: 6,
      dtype: DType.U8,
      bytes: col(
        (k) => new Uint8Array(k),
        (a, i) => (a[i] = nodes[i]!.flags ?? 0),
      ),
    },
    {
      kind: 7,
      dtype: DType.U32,
      bytes: col(
        (k) => new Uint32Array(k),
        (a, i) => (a[i] = nodes[i]!.loc ?? 0),
      ),
    },
    {
      kind: 8,
      dtype: DType.U16,
      bytes: col(
        (k) => new Uint16Array(k),
        (a, i) => (a[i] = nodes[i]!.country ?? 0),
      ),
    },
    {
      kind: 9,
      dtype: DType.U16,
      bytes: col(
        (k) => new Uint16Array(k),
        (a, i) => (a[i] = nodes[i]!.org ?? 0),
      ),
    },
    {
      kind: 10,
      dtype: DType.U16,
      bytes: col(
        (k) => new Uint16Array(k),
        (a, i) => (a[i] = nodes[i]!.appCount ?? 0),
      ),
    },
    {
      kind: 11,
      dtype: DType.U32,
      bytes: col(
        (k) => new Uint32Array(k),
        (a, i) => (a[i] = nodes[i]!.rank ?? 0),
      ),
    },
    {
      kind: 12,
      dtype: DType.U32,
      bytes: col(
        (k) => new Uint32Array(k),
        (a, i) => (a[i] = nodes[i]!.lastPaid ?? 0),
      ),
    },
    { kind: 32, dtype: DType.Strings, bytes: stringTableBytes(nodes.map((x) => x.ip ?? '')) },
    { kind: 33, dtype: DType.Strings, bytes: stringTableBytes(opts.countries ?? ['']) },
    { kind: 34, dtype: DType.Strings, bytes: stringTableBytes(opts.orgs ?? ['']) },
    { kind: 35, dtype: DType.Strings, bytes: stringTableBytes(opts.versions ?? ['']) },
    {
      kind: 36,
      dtype: DType.Struct,
      bytes: locationsBytes(
        opts.locations ?? [{ lat: Number.NaN, lon: Number.NaN, country: 0, nodeCount: 0, city: '' }],
      ),
    },
    ...(opts.extra ?? []),
  ];
  return encodeContainer(
    'FXAT',
    { seq: opts.seq ?? 1, generatedMs: opts.generatedMs ?? 0, count: n },
    sections,
  );
}

/** Builds a mesh.bin from edge triples. */
export function encodeMeshBin(
  edges: readonly [number, number, number][],
  opts: { seq?: number; generatedMs?: number; extra?: SectionSpec[]; withFlags?: boolean } = {},
): ArrayBuffer {
  const a = Uint32Array.from(edges.map((e) => e[0]));
  const b = Uint32Array.from(edges.map((e) => e[1]));
  const f = Uint8Array.from(edges.map((e) => e[2]));
  const sections: SectionSpec[] = [
    { kind: 1, dtype: DType.U32, bytes: bytesOf(a) },
    { kind: 2, dtype: DType.U32, bytes: bytesOf(b) },
  ];
  if (opts.withFlags !== false) sections.push({ kind: 3, dtype: DType.U8, bytes: bytesOf(f) });
  sections.push(...(opts.extra ?? []));
  return encodeContainer(
    'FXMS',
    { seq: opts.seq ?? 1, generatedMs: opts.generatedMs ?? 0, count: edges.length },
    sections,
  );
}

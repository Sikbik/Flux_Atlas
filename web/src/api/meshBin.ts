// Decoder for `GET /api/v1/mesh.bin` (magic FXMS, version 1): undirected P2P edges, deduplicated,
// `a < b`, sorted by (a, b). Same sectioned container as nodes.bin.

import {
  BinFormatError,
  columnView,
  DType,
  noteUnknown,
  ORIGIN_KIND,
  readContainer,
  readOrigin,
  type SnapshotOrigin,
} from './bin/container';

export const MESH_MAGIC = 'FXMS';

export const MeshSection = {
  A: 1,
  B: 2,
  Flags: 3,
  /** Which server built the file (struct, 16 bytes). */
  Origin: ORIGIN_KIND,
} as const;

const KNOWN = new Set<number>(Object.values(MeshSection));

/** Bits of the edge `flags` column. */
export const MeshFlag = {
  Bidirectional: 0x01,
  CrossContinent: 0x02,
} as const;

export interface MeshBin {
  seq: number;
  generatedMs: number;
  count: number;
  /** NodeId of the lower endpoint. */
  a: Uint32Array;
  /** NodeId of the higher endpoint. */
  b: Uint32Array;
  flags: Uint8Array;
  /** The server that built the file, or null when the file has no ORIGIN (older servers). */
  origin: SnapshotOrigin | null;
  unknownSections: number[];
}

/** Decodes a mesh.bin buffer. Throws `BinFormatError` on a malformed or incompatible file. */
export function decodeMeshBin(input: ArrayBuffer | ArrayBufferView): MeshBin {
  const c = readContainer(input, MESH_MAGIC);
  noteUnknown(c, KNOWN);
  const a = columnView(c, MeshSection.A, DType.U32, Uint32Array);
  const b = columnView(c, MeshSection.B, DType.U32, Uint32Array);
  if (!a || !b) throw new BinFormatError('mesh.bin: the a and b columns are required');
  return {
    seq: c.header.seq,
    generatedMs: c.header.generatedMs,
    count: c.header.count,
    a,
    b,
    flags: columnView(c, MeshSection.Flags, DType.U8, Uint8Array) ?? new Uint8Array(c.header.count),
    origin: readOrigin(c),
    unknownSections: c.unknownKinds,
  };
}

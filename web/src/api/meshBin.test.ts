import { describe, expect, it } from 'vitest';
import { BinFormatError, DType } from './bin/container';
import { bytesOf, encodeMeshBin, stringTableBytes } from './bin/writer';
import { decodeMeshBin, MeshFlag } from './meshBin';

describe('mesh.bin', () => {
  const edges: [number, number, number][] = [
    [0, 1, MeshFlag.Bidirectional],
    [0, 7, 0],
    [2, 3, MeshFlag.Bidirectional | MeshFlag.CrossContinent],
  ];

  it('decodes edges as zero-copy views', () => {
    const buf = encodeMeshBin(edges, { seq: 77, generatedMs: 1234 });
    const m = decodeMeshBin(buf);
    expect(m.seq).toBe(77);
    expect(m.generatedMs).toBe(1234);
    expect(m.count).toBe(3);
    expect(Array.from(m.a)).toEqual([0, 0, 2]);
    expect(Array.from(m.b)).toEqual([1, 7, 3]);
    expect(Array.from(m.flags)).toEqual([1, 0, 3]);
    expect(m.a.buffer).toBe(buf);
  });

  it('defaults flags and ignores unknown sections', () => {
    const extra = [
      { kind: 9, dtype: DType.F32, bytes: bytesOf(new Float32Array([0.5, 0.25, 1])) },
      { kind: 10, dtype: DType.Strings, bytes: stringTableBytes(['x']) },
    ];
    const m = decodeMeshBin(encodeMeshBin(edges, { extra, withFlags: false }));
    expect(Array.from(m.flags)).toEqual([0, 0, 0]);
    expect(m.unknownSections.sort()).toEqual([10, 9]);
  });

  it('reads ORIGIN and tolerates its absence', () => {
    const origin = { startedMs: 1_790_796_400_000, instance: '00c0ffee1234abcd' };
    const m = decodeMeshBin(encodeMeshBin(edges, { origin }));
    expect(m.origin).toEqual(origin);
    expect(m.unknownSections).toEqual([]);
    expect(decodeMeshBin(encodeMeshBin(edges)).origin).toBeNull();
  });

  it('handles an empty mesh', () => {
    const m = decodeMeshBin(encodeMeshBin([]));
    expect(m.count).toBe(0);
    expect(m.a.length).toBe(0);
  });

  it('rejects the nodes magic', () => {
    const buf = encodeMeshBin(edges);
    new DataView(buf).setUint8(1, 'A'.charCodeAt(0));
    expect(() => decodeMeshBin(buf)).toThrow(BinFormatError);
  });
});

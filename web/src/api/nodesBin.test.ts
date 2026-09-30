import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BinFormatError, DType } from './bin/container';
import { bytesOf, encodeContainer, encodeSyntheticNodesBin, stringTableBytes } from './bin/writer';
import { decodeNodesBin, NodeSection, splitCountry } from './nodesBin';

// Golden files written by the Rust test `golden_nodes_bin` (crates/atlas-core/tests).
const goldenDir = new URL('../../../crates/atlas-core/tests/golden/', import.meta.url);
const goldenBin = readFileSync(new URL('nodes.bin', goldenDir));
const expected = JSON.parse(readFileSync(new URL('nodes.expected.json', goldenDir), 'utf8'));

const nullIfNaN = (x: number) => (Number.isNaN(x) ? null : x);

describe('nodes.bin golden fixture', () => {
  const d = decodeNodesBin(goldenBin);

  it('matches the header', () => {
    expect(goldenBin.byteLength).toBe(expected.byte_len);
    expect(d.count).toBe(expected.count);
    expect(d.seq).toBe(expected.seq);
    expect(d.generatedMs).toBe(expected.generated_ms);
    expect(d.flags).toBe(expected.flags);
    expect(d.unknownSections).toEqual([]);
  });

  it('matches the first five rows of every column', () => {
    expected.first5.forEach((row: Record<string, number | string | null>, i: number) => {
      expect({
        id: d.ids[i],
        lat: nullIfNaN(d.lat[i]!),
        lon: nullIfNaN(d.lon[i]!),
        tier: d.tier[i],
        status: d.status[i],
        flags: d.flagsCol[i],
        loc: d.loc[i],
        country: d.country[i],
        org: d.org[i],
        app_count: d.appCount[i],
        rank: d.rank[i],
        last_paid: d.lastPaid[i],
        cores: d.cores[i],
        ram_gb: d.ramGb[i],
        ssd_gb: d.ssdGb[i],
        version: d.version[i],
        ip: d.ips.get(i),
      }).toEqual(row);
    });
  });

  it('matches the string tables', () => {
    expect(d.countries.toArray()).toEqual(expected.countries);
    expect(d.orgs.toArray()).toEqual(expected.orgs);
    expect(d.versions.toArray()).toEqual(expected.versions);
    expect(splitCountry(d.countries.get(4))).toEqual({ code: 'DE', name: 'Germany' });
  });

  it('matches every location', () => {
    expect(d.locations.length).toBe(expected.locations.length);
    expected.locations.forEach(
      (
        l: { lat: number | null; lon: number | null; country: number; node_count: number; city: string },
        i: number,
      ) => {
        expect(nullIfNaN(d.locations.lat(i))).toBe(l.lat);
        expect(nullIfNaN(d.locations.lon(i))).toBe(l.lon);
        expect(d.locations.country(i)).toBe(l.country);
        expect(d.locations.nodeCount(i)).toBe(l.node_count);
        expect(d.locations.city(i)).toBe(l.city);
      },
    );
  });

  it('matches the whole-column checks', () => {
    const sum = (a: ArrayLike<number>) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i]!;
      return s;
    };
    const c = expected.checks;
    expect(sum(d.ids)).toBe(c.sum_ids);
    expect(sum(d.rank)).toBe(c.sum_rank);
    expect(sum(d.lastPaid)).toBe(c.sum_last_paid);
    expect(sum(d.loc)).toBe(c.sum_loc);
    expect(sum(d.appCount)).toBe(c.sum_app_count);
    expect(sum(d.flagsCol)).toBe(c.sum_flags);
    expect(Array.from(d.lat).filter((x) => !Number.isNaN(x)).length).toBe(c.located);
    expect([1, 2, 3].map((t) => Array.from(d.tier).filter((x) => x === t).length)).toEqual(c.tier_counts);
  });

  it('exposes columns as zero-copy views over one buffer', () => {
    const buf = new Uint8Array(goldenBin).slice().buffer;
    const z = decodeNodesBin(buf);
    expect(z.ids.buffer).toBe(buf);
    expect(z.lat.buffer).toBe(buf);
    expect(z.rank.buffer).toBe(buf);
    const section = expected.sections.find((s: { kind: number }) => s.kind === NodeSection.Lat);
    expect(z.lat.byteOffset).toBe(section.offset);
  });

  it('agrees with the section table', () => {
    const dv = new DataView(new Uint8Array(goldenBin).buffer);
    const n = dv.getUint32(28, true);
    const got = [];
    for (let i = 0; i < n; i++) {
      const at = 32 + i * 12;
      got.push({
        kind: dv.getUint16(at, true),
        dtype: dv.getUint16(at + 2, true),
        offset: dv.getUint32(at + 4, true),
        byte_len: dv.getUint32(at + 8, true),
      });
    }
    expect(got).toEqual(expected.sections);
  });
});

describe('nodes.bin evolution rules', () => {
  const nodes = [
    { id: 3, lat: 50.1, lon: 8.6, tier: 1, country: 1, ip: '1.2.3.4:16127', loc: 1 },
    { id: 9, tier: 3, ip: '[2001:db8::1]:16137', flags: 0x06 },
  ];
  const opts = {
    countries: ['', 'DE\u001fGermany'],
    locations: [
      { lat: Number.NaN, lon: Number.NaN, country: 0, nodeCount: 1, city: '' },
      { lat: 50.1, lon: 8.6, country: 1, nodeCount: 1, city: 'Frankfurt' },
    ],
  };

  it('ignores unknown section kinds, including unknown dtypes', () => {
    const extra = [
      { kind: 200, dtype: DType.U32, bytes: bytesOf(new Uint32Array([7, 7])) },
      { kind: 201, dtype: 99, bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      { kind: 202, dtype: DType.Strings, bytes: stringTableBytes(['future', 'column']) },
    ];
    const d = decodeNodesBin(encodeSyntheticNodesBin(nodes, { ...opts, extra }));
    expect(d.unknownSections.sort()).toEqual([200, 201, 202]);
    expect(Array.from(d.ids)).toEqual([3, 9]);
    expect(d.ips.get(1)).toBe('[2001:db8::1]:16137');
    expect(d.locations.city(1)).toBe('Frankfurt');
    expect(splitCountry(d.countries.get(d.country[0]!)).code).toBe('DE');
  });

  it('skips a known kind encoded with an unexpected dtype', () => {
    // Only ids plus a lat column encoded as f64: lat must default to NaN, not be misread.
    const buf = encodeContainer('FXAT', { seq: 5, generatedMs: 1, count: 2 }, [
      { kind: 1, dtype: DType.U32, bytes: bytesOf(new Uint32Array([1, 2])) },
      { kind: 2, dtype: DType.F64, bytes: bytesOf(new Float64Array([1, 2])) },
    ]);
    const d = decodeNodesBin(buf);
    expect(Number.isNaN(d.lat[0]!)).toBe(true);
    expect(d.seq).toBe(5);
  });

  it('defaults missing optional columns', () => {
    const buf = encodeContainer('FXAT', { seq: 1, generatedMs: 1, count: 3 }, [
      { kind: 1, dtype: DType.U32, bytes: bytesOf(new Uint32Array([4, 5, 6])) },
    ]);
    const d = decodeNodesBin(buf);
    expect(d.count).toBe(3);
    expect(Array.from(d.lon).every(Number.isNaN)).toBe(true);
    expect(Array.from(d.rank)).toEqual([0, 0, 0]);
    expect(d.ips.get(2)).toBe('');
    expect(d.countries.get(0)).toBe('');
    expect(d.locations.length).toBe(1);
    expect(Number.isNaN(d.locations.lat(0))).toBe(true);
  });

  it('rejects a bad magic, a newer version and truncated files', () => {
    const good = encodeSyntheticNodesBin(nodes, opts);
    const badMagic = good.slice(0);
    new DataView(badMagic).setUint8(0, 0x58);
    expect(() => decodeNodesBin(badMagic)).toThrow(BinFormatError);
    const v2 = good.slice(0);
    new DataView(v2).setUint16(4, 2, true);
    expect(() => decodeNodesBin(v2)).toThrow(/version 2/);
    expect(() => decodeNodesBin(good.slice(0, 20))).toThrow(BinFormatError);
    expect(() => decodeNodesBin(good.slice(0, good.byteLength - 16))).toThrow(BinFormatError);
  });

  it('requires the ids column', () => {
    const buf = encodeContainer('FXAT', { seq: 1, generatedMs: 1, count: 1 }, [
      { kind: 2, dtype: DType.F32, bytes: bytesOf(new Float32Array([1])) },
    ]);
    expect(() => decodeNodesBin(buf)).toThrow(/ids/);
  });

  it('copies a misaligned input instead of failing', () => {
    const good = new Uint8Array(encodeSyntheticNodesBin(nodes, opts));
    const shifted = new Uint8Array(good.length + 3);
    shifted.set(good, 3);
    const d = decodeNodesBin(shifted.subarray(3));
    expect(Array.from(d.ids)).toEqual([3, 9]);
  });
});

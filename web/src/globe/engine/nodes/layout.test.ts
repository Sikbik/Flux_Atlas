import { describe, expect, it } from 'vitest';
import { DEG } from '../math';
import type { NodeColumns } from '../types';
import { computeLayout, fanPosition, type LayoutParams } from './layout';
import { FAN_GROUP_ARC, NodeStore } from './store';

const KM = 1 / 6371;

/** `n` nodes at one coordinate, as columns (loc = cluster id). */
function columns(sites: { loc: number; lat: number; lon: number; n: number; host?: number }[]): NodeColumns {
  const total = sites.reduce((a, s) => a + s.n, 0);
  const cols: NodeColumns = {
    ids: new Uint32Array(total),
    lat: new Float32Array(total),
    lon: new Float32Array(total),
    tier: new Uint8Array(total),
    status: new Uint8Array(total),
    flags: new Uint8Array(total),
    loc: new Uint32Array(total),
    host: new Uint32Array(total),
  };
  let k = 0;
  for (const s of sites) {
    for (let i = 0; i < s.n; i++, k++) {
      cols.ids[k] = k + 1;
      cols.lat[k] = s.lat;
      cols.lon[k] = s.lon;
      cols.tier[k] = 1 + (k % 3);
      cols.status[k] = 1;
      cols.loc[k] = s.loc;
      cols.host![k] = s.host ?? 1 + (k % 5);
    }
  }
  return cols;
}

/** Degrees of latitude for a distance in km. */
const degLat = (km: number) => km / 111.19;

function params(over: Partial<LayoutParams> = {}): LayoutParams {
  return {
    belt: false,
    fan: 1,
    spacing: 1.4 * KM,
    spireScale: 1,
    minTower: 2,
    pxPerRad: 1e5,
    dt: 1,
    ...over,
  };
}

function load(sites: Parameters<typeof columns>[0]): NodeStore {
  const s = new NodeStore(64);
  s.addColumns(columns(sites), -1e9);
  return s;
}

/** Great-circle distance between two display positions (unit sphere + lift), km. */
function distKm(pos: Float32Array, a: number, b: number): number {
  const ax = pos[a * 4]!;
  const ay = pos[a * 4 + 1]!;
  const az = pos[a * 4 + 2]!;
  const bx = pos[b * 4]!;
  const by = pos[b * 4 + 1]!;
  const bz = pos[b * 4 + 2]!;
  const dot = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
  return Math.acos(Math.min(1, dot)) * 6371;
}

function minPairKm(store: NodeStore, slots: number[]): number {
  let m = Infinity;
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) m = Math.min(m, distKm(store.pos, slots[i]!, slots[j]!));
  }
  return m;
}

describe('fan groups', () => {
  it('puts clusters of one site into a single fan and leaves distant ones alone', () => {
    const s = load([
      { loc: 10, lat: 49.45, lon: 11.07, n: 30 },
      { loc: 11, lat: 49.4525, lon: 11.0725, n: 20 }, // about 0.3 km away: the same site
      { loc: 12, lat: 49.45 + degLat(40), lon: 11.07, n: 10 }, // another site
    ]);
    const [a, b, c] = [0, 1, 2];
    expect(s.cFan[a]).toBe(a);
    expect(s.cFan[b]).toBe(a);
    expect(s.cFan[c]).toBe(c);
    expect(s.cFanNext[a]).toBe(50);
    expect(s.cFanNext[c]).toBe(10);
    // Every node has its own place in its site's spiral.
    const ranksA = new Set<number>();
    const ranksC = new Set<number>();
    for (let slot = 0; slot < s.high; slot++) {
      const g = s.cFan[s.cluster[slot]!]!;
      (g === a ? ranksA : ranksC).add(s.fanRank[slot]!);
    }
    expect(ranksA.size).toBe(50);
    expect(Math.max(...ranksA)).toBe(49);
    expect(ranksC.size).toBe(10);
  });

  it('groups by arc, not by exact coordinates', () => {
    const inside = degLat(5 * 0.9);
    const outside = degLat(5 * 1.2);
    const s = load([
      { loc: 1, lat: 10, lon: 20, n: 3 },
      { loc: 2, lat: 10 + inside, lon: 20, n: 3 },
      { loc: 3, lat: 10 + outside + 1, lon: 20, n: 3 },
    ]);
    expect(s.cFan[1]).toBe(0);
    expect(s.cFan[2]).toBe(2);
    expect(FAN_GROUP_ARC).toBeCloseTo(5 * KM, 9);
  });

  it('fans a coincident pair as one sunflower: no markers on markers', () => {
    const s = load([
      { loc: 1, lat: 49.45, lon: 11.07, n: 60 },
      { loc: 2, lat: 49.4525, lon: 11.0725, n: 40 },
    ]);
    computeLayout(s, params());
    const slots = Array.from({ length: s.high }, (_, i) => i);
    // A golden-angle spiral keeps neighbours about 1.9 spacings apart on average and never closer than
    // roughly 1.3; two separate spirals on the same centre would drop well below one spacing.
    expect(minPairKm(s, slots)).toBeGreaterThan(1.4 * 0.9);
  });

  it('moves a lone neighbour into the site fan instead of leaving it on top of the hub', () => {
    const s = load([
      { loc: 1, lat: 55.68, lon: 12.53, n: 40 },
      { loc: 2, lat: 55.68 + degLat(2.5), lon: 12.53, n: 1 },
    ]);
    computeLayout(s, params());
    const lone = s.high - 1;
    const slots = Array.from({ length: s.high }, (_, i) => i);
    expect(minPairKm(s, slots)).toBeGreaterThan(1.4 * 0.9);
    // It sits on the spiral at its fan rank (ranks follow the host order), not at its own coordinate.
    const base = s.cDir.subarray(0, 3);
    const p = s.pos.subarray(lone * 4, lone * 4 + 3);
    const dot = (base[0]! * p[0]! + base[1]! * p[1]! + base[2]! * p[2]!) / Math.hypot(p[0]!, p[1]!, p[2]!);
    const expected = Math.sqrt(s.fanRank[lone]! + 0.5) * 1.4;
    expect(s.fanRank[lone]).toBeLessThan(41);
    expect(Math.acos(Math.min(1, dot)) * 6371).toBeCloseTo(expected, 0);
  });

  it('keeps stacks per cluster: the global layout does not change', () => {
    const s = load([
      { loc: 1, lat: 49.45, lon: 11.07, n: 30 },
      { loc: 2, lat: 49.4525, lon: 11.0725, n: 20 },
    ]);
    computeLayout(s, params({ fan: 0 }));
    for (let slot = 0; slot < s.high; slot++) {
      const c = s.cluster[slot]!;
      const r = Math.hypot(s.pos[slot * 4]!, s.pos[slot * 4 + 1]!, s.pos[slot * 4 + 2]!);
      const expected = 1.0012 + s.cHeight[c]! * ((s.rank[slot]! + 0.5) / s.cNext[c]!);
      expect(r).toBeCloseTo(expected, 5);
      // The column stands on the cluster's own base, never on the group's.
      const dot =
        (s.dir[slot * 3]! * s.pos[slot * 4]! +
          s.dir[slot * 3 + 1]! * s.pos[slot * 4 + 1]! +
          s.dir[slot * 3 + 2]! * s.pos[slot * 4 + 2]!) /
        r;
      expect(dot).toBeCloseTo(1, 6);
    }
  });

  it('keeps a node with no neighbours exactly where it is', () => {
    const s = load([{ loc: 1, lat: 35.68, lon: 139.69, n: 1 }]);
    computeLayout(s, params());
    const lat = 35.68 * DEG;
    const lon = 139.69 * DEG;
    const r = 1.0012;
    expect(s.pos[0]).toBeCloseTo(Math.cos(lat) * Math.sin(lon) * r, 5);
    expect(s.pos[1]).toBeCloseTo(Math.sin(lat) * r, 5);
    expect(s.pos[2]).toBeCloseTo(Math.cos(lat) * Math.cos(lon) * r, 5);
    expect(s.pos[3]).toBe(1);
  });

  it('fanPosition lands where the layout draws a fully fanned node', () => {
    const s = load([
      { loc: 1, lat: 49.45, lon: 11.07, n: 60 },
      { loc: 2, lat: 49.4525, lon: 11.0725, n: 40 },
      { loc: 3, lat: 48.86, lon: 2.35, n: 25 },
    ]);
    computeLayout(s, params());
    const out = new Float32Array(3);
    for (let slot = 0; slot < s.high; slot++) {
      fanPosition(s, slot, 1.4 * KM, out);
      const r = Math.hypot(s.pos[slot * 4]!, s.pos[slot * 4 + 1]!, s.pos[slot * 4 + 2]!);
      expect(s.pos[slot * 4]! / r).toBeCloseTo(out[0]!, 4);
      expect(s.pos[slot * 4 + 1]! / r).toBeCloseTo(out[1]!, 4);
      expect(s.pos[slot * 4 + 2]! / r).toBeCloseTo(out[2]!, 4);
    }
  });

  it('keeps a host contiguous in the shared spiral', () => {
    const s = load([
      { loc: 1, lat: 49.45, lon: 11.07, n: 12, host: 7 },
      { loc: 2, lat: 49.4525, lon: 11.0725, n: 12, host: 3 },
    ]);
    // Two hosts across two clusters: each host's fan ranks form one run.
    const byHost = new Map<number, number[]>();
    for (let slot = 0; slot < s.high; slot++) {
      const h = s.host[slot]!;
      byHost.set(h, [...(byHost.get(h) ?? []), s.fanRank[slot]!]);
    }
    for (const ranks of byHost.values()) {
      ranks.sort((a, b) => a - b);
      expect(ranks[ranks.length - 1]! - ranks[0]!).toBe(ranks.length - 1);
    }
  });

  it('a node arriving later joins the end of its site spiral', () => {
    const s = load([{ loc: 1, lat: 49.45, lon: 11.07, n: 5 }]);
    const slot = s.add({ id: 99, lat: 49.4525, lon: 11.0725, tier: 1, status: 1, flags: 0, loc: 2 }, 0);
    expect(s.cFan[s.cluster[slot]!]).toBe(0);
    expect(s.fanRank[slot]).toBe(5);
    expect(s.cFanNext[0]).toBe(6);
  });
});

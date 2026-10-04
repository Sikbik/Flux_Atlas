import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitBorders, type TopoTopology } from './assets';
import {
  ADMIN1_FADE,
  ADMIN1_GAIN,
  ADMIN1_LEVELS,
  ADMIN1_PREFETCH_PPR,
  Admin1Decoder,
  admin1Fade,
  admin1Levels,
  decodeAdmin1,
  decodeAdmin1Async,
  GLSL_ADMIN1,
  MAX_STEP_DEG,
  wantsAdmin1,
} from './borders';

const publicData = (name: string): Buffer => readFileSync(join(process.cwd(), 'public', 'data', name));

// ---------------------------------------------------------------------------------------------
// The zoom fade
// ---------------------------------------------------------------------------------------------

describe('admin-1 zoom fade', () => {
  it('is absent at the global view and complete once the camera is down', () => {
    // The home view sits near 400 CSS px per radian (a 1600 x 900 screen at range 3.6).
    for (let l = 0; l < ADMIN1_LEVELS; l++) {
      expect(admin1Fade(l, 400)).toBe(0);
      expect(admin1Fade(l, ADMIN1_FADE[l]!.from)).toBe(0);
      expect(admin1Fade(l, ADMIN1_FADE[l]!.to)).toBe(1);
      expect(admin1Fade(l, ADMIN1_FADE[l]!.to * 10)).toBe(1);
    }
    expect(admin1Levels(400)).toBe(0);
    expect(admin1Levels(30000)).toBe(ADMIN1_LEVELS);
  });

  it('rises smoothly and monotonically with zoom, with no step anywhere', () => {
    for (let l = 0; l < ADMIN1_LEVELS; l++) {
      let prev = 0;
      let maxStep = 0;
      for (let ppr = 300; ppr <= 40000; ppr *= 1.01) {
        const f = admin1Fade(l, ppr);
        expect(f).toBeGreaterThanOrEqual(prev);
        maxStep = Math.max(maxStep, f - prev);
        prev = f;
      }
      // A 1% change in distance never moves a level by more than a few hundredths.
      expect(maxStep).toBeLessThan(0.05);
    }
  });

  it('brings the coarse levels in first and the fine ones later', () => {
    for (let l = 1; l < ADMIN1_LEVELS; l++) {
      expect(ADMIN1_FADE[l]!.from).toBeGreaterThan(ADMIN1_FADE[l - 1]!.from);
      expect(ADMIN1_FADE[l]!.to).toBeGreaterThan(ADMIN1_FADE[l - 1]!.to);
      expect(ADMIN1_GAIN[l]!).toBeLessThanOrEqual(ADMIN1_GAIN[l - 1]!);
      // At every zoom a finer level is never further in than a coarser one.
      for (let ppr = 300; ppr <= 40000; ppr *= 1.05) {
        expect(admin1Fade(l, ppr)).toBeLessThanOrEqual(admin1Fade(l - 1, ppr) + 1e-9);
      }
    }
    expect(admin1Levels(ADMIN1_FADE[0]!.from + 1)).toBe(1);
    expect(admin1Levels(ADMIN1_FADE[1]!.from + 1)).toBe(2);
    expect(admin1Levels(ADMIN1_FADE[3]!.from + 1)).toBe(4);
  });

  it('ignores a zoom that is not a number, and fetches the file before the first level shows', () => {
    expect(admin1Fade(0, 0)).toBe(0);
    expect(admin1Fade(0, Number.NaN)).toBe(0);
    expect(admin1Fade(9, 5000)).toBe(0);
    expect(wantsAdmin1(400)).toBe(false);
    expect(wantsAdmin1(ADMIN1_PREFETCH_PPR)).toBe(true);
    expect(ADMIN1_PREFETCH_PPR).toBeLessThan(ADMIN1_FADE[0]!.from);
  });

  it('the GLSL carries the same constants as the mirror', () => {
    for (const f of ADMIN1_FADE) {
      expect(GLSL_ADMIN1).toContain(f.from.toFixed(1));
      expect(GLSL_ADMIN1).toContain(f.to.toFixed(1));
    }
    for (const g of ADMIN1_GAIN) expect(GLSL_ADMIN1).toContain(g.toFixed(3));
    expect(GLSL_ADMIN1).toContain('float admin1Fade(float level, float ppr)');
    expect(GLSL_ADMIN1).toContain('float admin1Gain(float level)');
  });
});

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/** The same encoding scripts/borders-admin1.mjs writes: lines of [lon, lat] degrees per level. */
function encodeAdmin1(levels: number[][][][], units = 1000): Uint8Array {
  const out: number[] = [0x46, 0x58, 0x41, 0x31, levels.length, 0, units & 0xff, units >> 8];
  const varint = (v: number): void => {
    let x = v;
    while (x >= 0x80) {
      out.push((x & 0x7f) | 0x80);
      x = Math.floor(x / 128);
    }
    out.push(x);
  };
  const zig = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1);
  for (const lines of levels) varint(lines.length);
  let px = 0;
  let py = 0;
  for (const lines of levels) {
    for (const line of lines) {
      varint(line.length);
      let x = px;
      let y = py;
      line.forEach(([lon, lat], i) => {
        const qx = Math.round((lon! + 180) * units);
        const qy = Math.round((lat! + 90) * units);
        varint(zig(qx - x));
        varint(zig(qy - y));
        x = qx;
        y = qy;
        if (i === 0) {
          px = qx;
          py = qy;
        }
      });
    }
  }
  return Uint8Array.from(out);
}

describe('admin-1 file decoder', () => {
  it('turns lines into segments, level by level, with the length of each line so far', () => {
    const lvl0 = [
      [
        [-100, 40],
        [-99.75, 40],
        [-99.75, 40.25],
      ],
    ];
    const lvl1 = [
      [
        [10, 50],
        [10.25, 50],
      ],
      [
        [11, 51],
        [11, 51.25],
        [11.25, 51.25],
      ],
    ];
    const d = decodeAdmin1(encodeAdmin1([lvl0, lvl1]));
    expect(d.lines).toBe(3);
    // Level 0 has 2 segments, level 1 has 1 + 2.
    expect(Array.from(d.levelEnds)).toEqual([2, 5]);
    expect(d.seg.length).toBe(5 * 4);
    // lat0, lon0, lat1, lon1 of the first segment.
    expect(Array.from(d.seg.subarray(0, 4))).toEqual([40, -100, 40, -99.75]);
    expect(Array.from(d.seg.subarray(4, 8))).toEqual([40, -99.75, 40.25, -99.75]);
    // The lines are not joined to each other: the next level starts where its own line starts.
    expect(Array.from(d.seg.subarray(8, 12))).toEqual([50, 10, 50, 10.25]);
    expect(Array.from(d.seg.subarray(12, 16))).toEqual([51, 11, 51.25, 11]);
    // Arc length: it starts at 0 on every line and grows along it, in radians.
    const deg = Math.PI / 180;
    expect(d.arc[0]).toBe(0);
    expect(d.arc[1]).toBeCloseTo(0.25 * Math.cos(40 * deg) * deg, 6);
    expect(d.arc[2]).toBeCloseTo(d.arc[1]!, 7);
    expect(d.arc[3]).toBeCloseTo(d.arc[1]! + 0.25 * deg, 6);
    expect(d.arc[4]).toBe(0); // the first segment of the second line
    expect(d.arc[6]).toBe(0); // and of the third
  });

  it('cuts a long straight piece so that a chord never dips under the surface', () => {
    // Seven degrees along a parallel: a chord that long would sink 0.0011 radii at its middle.
    const d = decodeAdmin1(
      encodeAdmin1([
        [
          [
            [-110, 41],
            [-103, 41],
          ],
        ],
      ]),
    );
    const n = d.seg.length / 4;
    expect(n).toBeGreaterThanOrEqual(Math.ceil((7 * Math.cos(41 * (Math.PI / 180))) / MAX_STEP_DEG));
    for (let i = 0; i < n; i++) {
      // Every piece stays on the parallel and is short; consecutive pieces meet end to start.
      expect(d.seg[i * 4]).toBeCloseTo(41, 4);
      expect(d.seg[i * 4 + 2]).toBeCloseTo(41, 4);
      expect(Math.abs(d.seg[i * 4 + 3]! - d.seg[i * 4 + 1]!)).toBeLessThanOrEqual(
        MAX_STEP_DEG / Math.cos(41 * (Math.PI / 180)) + 1e-4,
      );
      if (i > 0) {
        expect(d.seg[i * 4 + 1]).toBeCloseTo(d.seg[(i - 1) * 4 + 3]!, 4);
        expect(d.arc[i * 2]).toBeCloseTo(d.arc[(i - 1) * 2 + 1]!, 6);
      }
    }
    expect(d.seg[1]).toBeCloseTo(-110, 4);
    expect(d.seg[(n - 1) * 4 + 3]).toBeCloseTo(-103, 4);
  });

  it('keeps the levels apart when one of them has no lines', () => {
    const d = decodeAdmin1(
      encodeAdmin1([
        [],
        [
          [
            [0, 0],
            [0.1, 0],
          ],
        ],
        [],
      ]),
    );
    expect(Array.from(d.levelEnds)).toEqual([0, 1, 1]);
  });

  it('can be read a slice at a time, with the same result as in one go', async () => {
    const levels = [
      [
        [
          [-100, 40],
          [-99.75, 40],
          [-99.75, 40.25],
        ],
        [
          [-90, 30],
          [-80, 30], // ten degrees: cut into pieces
        ],
      ],
      [
        [
          [10, 50],
          [10.25, 50],
        ],
      ],
    ];
    const bytes = encodeAdmin1(levels);
    const whole = decodeAdmin1(bytes);
    const dec = new Admin1Decoder(bytes);
    expect(dec.done).toBe(false);
    expect(() => dec.result()).toThrow('not finished');
    let steps = 0;
    while (!dec.step(2)) steps++;
    expect(steps).toBeGreaterThan(2);
    const sliced = dec.result();
    expect(Array.from(sliced.seg)).toEqual(Array.from(whole.seg));
    expect(Array.from(sliced.arc)).toEqual(Array.from(whole.arc));
    expect(Array.from(sliced.levelEnds)).toEqual(Array.from(whole.levelEnds));
    expect(sliced.lines).toBe(whole.lines);
    const later = await decodeAdmin1Async(bytes, 2);
    expect(Array.from(later.seg)).toEqual(Array.from(whole.seg));
  });

  it('reads the real file in slices of about a millisecond, and the same either way', async () => {
    const bytes = publicData('admin1-lines.bin');
    const whole = decodeAdmin1(bytes);
    const dec = new Admin1Decoder(bytes);
    let slices = 1;
    while (!dec.step(6000)) slices++;
    // A hundred thousand points in many small slices, not one long one.
    expect(slices).toBeGreaterThan(20);
    const sliced = dec.result();
    expect(sliced.seg.length).toBe(whole.seg.length);
    expect(sliced.seg.every((v, i) => v === whole.seg[i])).toBe(true);
    expect(sliced.arc.every((v, i) => v === whole.arc[i])).toBe(true);
    const viaPromise = await decodeAdmin1Async(bytes);
    expect(viaPromise.levelEnds).toEqual(whole.levelEnds);
  });

  it('refuses a file that is not one, or that stops short', () => {
    expect(() => decodeAdmin1(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow('not an admin-1');
    const good = encodeAdmin1([
      [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    ]);
    expect(() => decodeAdmin1(good.subarray(0, good.length - 2))).toThrow();
    expect(() => decodeAdmin1(new Uint8Array(0))).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// The committed asset
// ---------------------------------------------------------------------------------------------

/** A coarse grid over segments, for "is anything of this set within r degrees of here". */
class Grid {
  private readonly cells = new Map<number, number[]>();
  private readonly cell = 0.5;
  constructor(private readonly s: Float32Array) {
    for (let i = 0; i < s.length / 4; i++) {
      const lat0 = s[i * 4]!;
      const lon0 = s[i * 4 + 1]!;
      const lat1 = s[i * 4 + 2]!;
      const lon1 = s[i * 4 + 3]!;
      const x0 = Math.floor(Math.min(lon0, lon1) / this.cell);
      const x1 = Math.floor(Math.max(lon0, lon1) / this.cell);
      const y0 = Math.floor(Math.min(lat0, lat1) / this.cell);
      const y1 = Math.floor(Math.max(lat0, lat1) / this.cell);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = x * 100000 + y;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  /** Ground distance (degrees) from a point to the nearest segment, looking only a cell around. */
  nearest(lat: number, lon: number): number {
    const kx = Math.cos((lat * Math.PI) / 180);
    let best = 1e9;
    const cx = Math.floor(lon / this.cell);
    const cy = Math.floor(lat / this.cell);
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        for (const i of this.cells.get((cx + ix) * 100000 + (cy + iy)) ?? []) {
          const ax = (this.s[i * 4 + 1]! - lon) * kx;
          const ay = this.s[i * 4]! - lat;
          const bx = (this.s[i * 4 + 3]! - lon) * kx;
          const by = this.s[i * 4 + 2]! - lat;
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
          best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
        }
      }
    }
    return best;
  }
}

describe('the committed admin-1 asset', () => {
  const bytes = publicData('admin1-lines.bin');
  const d = decodeAdmin1(bytes);
  const n = d.seg.length / 4;

  it('is compact: well under the budget raw', () => {
    // The target is about 400 KB gzip; the file is already varint-packed, so raw is the figure that matters here.
    expect(bytes.length).toBeLessThan(450_000);
    expect(bytes.length).toBeGreaterThan(100_000);
  });

  it('holds every detail level, coarse levels small and fine ones numerous', () => {
    expect(d.levelEnds.length).toBe(ADMIN1_LEVELS);
    let prev = 0;
    for (const e of d.levelEnds) {
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
    expect(prev).toBe(n);
    // About 8,800 lines and 110 thousand segments: a draw count that stays modest even with all of it in.
    expect(d.lines).toBeGreaterThan(5000);
    expect(n).toBeGreaterThan(80_000);
    expect(n).toBeLessThan(160_000);
  });

  it('keeps every vertex on the planet and every line in one piece', () => {
    let breaks = 0;
    for (let i = 0; i < n; i++) {
      const lat0 = d.seg[i * 4]!;
      const lon0 = d.seg[i * 4 + 1]!;
      const lat1 = d.seg[i * 4 + 2]!;
      const lon1 = d.seg[i * 4 + 3]!;
      expect(lat0).toBeGreaterThanOrEqual(-90);
      expect(lat1).toBeLessThanOrEqual(90);
      expect(Math.abs(lon0)).toBeLessThanOrEqual(180);
      expect(Math.abs(lon1)).toBeLessThanOrEqual(180);
      // No segment spans an ocean: every piece is short on the ground (the file's longest are cut).
      const ground = Math.hypot(lat1 - lat0, (lon1 - lon0) * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180)));
      expect(ground).toBeLessThanOrEqual(MAX_STEP_DEG * 1.01);
      if (i > 0) {
        const joined = d.seg[(i - 1) * 4 + 2] === lat0 && d.seg[(i - 1) * 4 + 3] === lon0;
        if (!joined) breaks++;
        // The line's length so far continues through a joint and starts again at a break (a line that
        // happens to start where the one before it ended may do either).
        if (!joined) expect(d.arc[i * 2]).toBe(0);
        else {
          const continues = Math.abs(d.arc[i * 2]! - d.arc[(i - 1) * 2 + 1]!) < 1e-5;
          expect(continues || d.arc[i * 2] === 0).toBe(true);
        }
      }
    }
    // Every break is the start of a line: that is the decoder's split of the file into lines. (A line that
    // starts exactly where the one before it ends has no break, so there can be fewer, never more.)
    expect(breaks).toBeLessThanOrEqual(d.lines - 1);
    expect(breaks).toBeGreaterThan(d.lines * 0.9);
  });

  it('never repeats a segment', () => {
    const q = (v: number): number => Math.round(v * 1000);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const a = `${q(d.seg[i * 4]!)},${q(d.seg[i * 4 + 1]!)}`;
      const b = `${q(d.seg[i * 4 + 2]!)},${q(d.seg[i * 4 + 3]!)}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('draws nothing the coastline or a country border already draws', () => {
    const topo = JSON.parse(publicData('countries-50m.json').toString('utf8')) as TopoTopology;
    const drawn = splitBorders(topo);
    // Coast and borders are disjoint sets of the same topology (the split), and these lines are neither.
    const all = new Float32Array(drawn.coast.length + drawn.border.length);
    all.set(drawn.coast, 0);
    all.set(drawn.border, drawn.coast.length);
    const grid = new Grid(all);
    // A segment that lies along a drawn line has its ends and its middle within a hair of it. Ends that
    // meet the coast or a border (where a state line stops) are not that: only a stretch counts.
    const NEAR = 0.004;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const lat0 = d.seg[i * 4]!;
      const lon0 = d.seg[i * 4 + 1]!;
      const lat1 = d.seg[i * 4 + 2]!;
      const lon1 = d.seg[i * 4 + 3]!;
      const len = Math.hypot(lat1 - lat0, (lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180));
      if (len < 0.02) continue;
      if (
        grid.nearest(lat0, lon0) < NEAR &&
        grid.nearest(lat1, lon1) < NEAR &&
        grid.nearest((lat0 + lat1) / 2, (lon0 + lon1) / 2) < NEAR
      )
        along++;
    }
    // Two of 113,000 (the last two kilometres of a line that ends at a border).
    expect(along).toBeLessThan(n * 0.0002);
  });
});

// ---------------------------------------------------------------------------------------------
// The country split
// ---------------------------------------------------------------------------------------------

describe('country topology split', () => {
  // Two unit squares side by side. Arc 0 is the shared edge (used by both), arcs 1 and 2 are the rest of
  // each square (used once). Delta-coded, quantized: scale 1, translate (0, 0).
  const topo: TopoTopology = {
    type: 'Topology',
    transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [
      [
        [1, 0],
        [0, 1],
      ],
      [
        [1, 1],
        [-1, 0],
        [0, -1],
      ],
      [
        [1, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    ],
    objects: {
      countries: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', arcs: [[0, 1]] },
          { type: 'Polygon', arcs: [[2, ~0]] },
        ],
      },
    },
  };

  it('puts the arc two countries share in the border set and the rest in the coast set', () => {
    const s = splitBorders(topo);
    expect(s.border.length / 4).toBe(1);
    expect(s.coast.length / 4).toBe(2 + 3);
    // lat0, lon0, lat1, lon1 of the shared edge: (x 1, y 0) to (x 1, y 1).
    expect(Array.from(s.border)).toEqual([0, 1, 1, 1]);
    // Nothing in both sets.
    const key = (a: Float32Array, i: number): string =>
      `${a[i * 4]},${a[i * 4 + 1]},${a[i * 4 + 2]},${a[i * 4 + 3]}`;
    const border = new Set<string>();
    for (let i = 0; i < s.border.length / 4; i++) border.add(key(s.border, i));
    for (let i = 0; i < s.coast.length / 4; i++) expect(border.has(key(s.coast, i))).toBe(false);
  });

  it('gives each border segment the arc length up to it, and starts again on the next arc', () => {
    const s = splitBorders(topo);
    expect(s.borderArc.length).toBe(2);
    expect(s.borderArc[0]).toBe(0);
    expect(s.borderArc[1]).toBeCloseTo(Math.PI / 180, 6);
  });

  it('every real border segment is counted once and the real files split cleanly', () => {
    for (const name of ['countries-110m.json', 'countries-50m.json']) {
      const t = JSON.parse(publicData(name).toString('utf8')) as TopoTopology;
      const s = splitBorders(t);
      expect(s.coast.length).toBeGreaterThan(0);
      expect(s.border.length).toBeGreaterThan(0);
      expect(s.borderArc.length).toBe((s.border.length / 4) * 2);
      for (let i = 0; i < s.borderArc.length; i += 2)
        expect(s.borderArc[i + 1]!).toBeGreaterThanOrEqual(s.borderArc[i]!);
    }
  });
});

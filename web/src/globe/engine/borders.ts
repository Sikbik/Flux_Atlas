// Political lines on the globe: the compact state and province file, and the zoom that brings each of
// its detail levels in.
//
// Country borders come from the world-atlas topology (assets.ts) and are always there. State and
// province lines (Natural Earth admin-1, public domain) come from `data/admin1-lines.bin`, which
// scripts/borders-admin1.mjs builds and which spells out its own format. The build cuts every stretch
// that runs along a coastline or a country border, so these lines are internal boundaries only and
// nothing is drawn twice. It also sorts every line into one of four detail levels from Natural Earth's
// own `MIN_ZOOM`: level 0 holds the first-order divisions of large countries (US states, Canadian
// provinces), level 3 the finest municipal lines. Each level fades in at its own zoom (`ADMIN1_FADE`),
// so a dense country never turns into a mesh from far away and the picture stays a map, not a net.
//
// The zoom is measured like the lens (lens.ts): in CSS pixels per radian at the shaded point, so a
// bigger screen brings the lines in earlier, the way its texels get bigger earlier, and a pitched
// camera keeps its far field plain.

const DEG = Math.PI / 180;

/** The detail levels of the admin-1 file. */
export const ADMIN1_LEVELS = 4;

/** Pixels per radian where each level starts to appear and where it is fully in. Finer levels come later. */
export const ADMIN1_FADE: readonly { readonly from: number; readonly to: number }[] = [
  { from: 900, to: 1900 },
  { from: 1700, to: 3200 },
  { from: 3300, to: 5800 },
  { from: 6500, to: 11000 },
];

/** How strong each level's lines are against the coarsest: the finest are the quietest. */
export const ADMIN1_GAIN: readonly number[] = [1, 0.9, 0.78, 0.66];

/** The file is fetched once the camera is this close (a little before the first level shows), so it is there in time. */
export const ADMIN1_PREFETCH_PPR = 640;

const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** CPU mirror of `admin1Fade` in GLSL: how far `level` has come in at `ppr` CSS pixels per radian (0 to 1). */
export function admin1Fade(level: number, ppr: number): number {
  const f = ADMIN1_FADE[level];
  if (!f || !(ppr > 0)) return 0;
  return smooth01(Math.log(ppr / f.from) / Math.log(f.to / f.from));
}

/** How many levels, from the coarsest, can show at `ppr`: the draw only needs that many. */
export function admin1Levels(ppr: number): number {
  let n = 0;
  for (let l = 0; l < ADMIN1_LEVELS; l++) if (admin1Fade(l, ppr) > 0) n = l + 1;
  return n;
}

/** True once the camera is close enough that the admin-1 file should be on its way. */
export const wantsAdmin1 = (ppr: number): boolean => ppr >= ADMIN1_PREFETCH_PPR;

const list = (get: (l: number) => number): string =>
  Array.from({ length: ADMIN1_LEVELS }, (_, l) => get(l).toFixed(1)).join(', ');

/**
 * GLSL: `admin1Fade(level, ppr)` and `admin1Gain(level)`, built from the constants above so the shader and
 * the CPU mirror cannot drift apart.
 */
export const GLSL_ADMIN1 = /* glsl */ `
const float ADMIN1_FROM[${ADMIN1_LEVELS}] = float[${ADMIN1_LEVELS}](${list((l) => ADMIN1_FADE[l]!.from)});
const float ADMIN1_TO[${ADMIN1_LEVELS}] = float[${ADMIN1_LEVELS}](${list((l) => ADMIN1_FADE[l]!.to)});
const float ADMIN1_GAIN[${ADMIN1_LEVELS}] = float[${ADMIN1_LEVELS}](${ADMIN1_GAIN.map((g) => g.toFixed(3)).join(', ')});
float admin1Fade(float level, float ppr) {
  int i = int(level + 0.5);
  float t = log(max(ppr, 1.0) / ADMIN1_FROM[i]) / log(ADMIN1_TO[i] / ADMIN1_FROM[i]);
  return smoothstep(0.0, 1.0, t);
}
float admin1Gain(float level) { return ADMIN1_GAIN[int(level + 0.5)]; }
`;

// ---------------------------------------------------------------------------------------------
// The admin-1 file
// ---------------------------------------------------------------------------------------------

/** A decoded admin-1 file: segments of straight (in latitude and longitude) pieces, the coarsest level first. */
export interface Admin1Lines {
  /** lat0, lon0, lat1, lon1 in degrees, four floats per segment. */
  seg: Float32Array;
  /** The line's length in radians up to each segment's start and end, two floats per segment. */
  arc: Float32Array;
  /** `levelEnds[k]` is the index one past the last segment of level k (level k starts where k - 1 ends). */
  levelEnds: Uint32Array;
  /** Lines in the file. */
  lines: number;
}

/** Pieces longer than this (degrees) are cut, so a chord never dips under the surface the line rides on. */
export const MAX_STEP_DEG = 0.5;

/**
 * Reads the file written by scripts/borders-admin1.mjs in steps, so a page can spread the work over several
 * frames (`decodeAdmin1Async`) instead of stalling one: it parses the points, then writes the segments.
 * `step` does about `budget` points of work and says whether it is finished. Throws on anything else.
 */
export class Admin1Decoder {
  private readonly b: Uint8Array;
  private readonly units: number;
  private readonly levels: number;
  private readonly counts: number[] = [];
  private o = 8;
  // Phase one: the points of every line, flat.
  private readonly px: Int32Array;
  private readonly py: Int32Array;
  private readonly cs: Float32Array;
  private readonly pieces: Uint16Array;
  private readonly lineLen: number[] = [];
  private readonly lineLevel: number[] = [];
  private n = 0;
  private level = 0;
  private inLevel = 0;
  private fx = 0;
  private fy = 0;
  private total = 0;
  // Phase two: the segments.
  private seg: Float32Array | null = null;
  private arc: Float32Array | null = null;
  private levelEnds: Uint32Array | null = null;
  private line = 0;
  private at = 0;
  private w = 0;
  private parsed = false;

  constructor(data: ArrayBuffer | Uint8Array) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (b.length < 8 || b[0] !== 0x46 || b[1] !== 0x58 || b[2] !== 0x41 || b[3] !== 0x31) {
      throw new Error('admin1: not an admin-1 line file');
    }
    this.b = b;
    this.levels = b[4]!;
    this.units = b[6]! | (b[7]! << 8);
    if (this.levels < 1 || this.levels > 16 || this.units === 0) throw new Error('admin1: bad header');
    for (let i = 0; i < this.levels; i++) this.counts.push(this.varint());
    // Every point takes at least two bytes, so this many is enough.
    const cap = Math.max(16, Math.floor((b.length - this.o) / 2) + 2);
    this.px = new Int32Array(cap);
    this.py = new Int32Array(cap);
    this.cs = new Float32Array(cap);
    this.pieces = new Uint16Array(cap);
    this.inLevel = this.counts[0] ?? 0;
  }

  private varint(): number {
    const b = this.b;
    let v = 0;
    let m = 1;
    for (;;) {
      if (this.o >= b.length) throw new Error('admin1: truncated');
      const byte = b[this.o++]!;
      v += (byte & 0x7f) * m;
      if (byte < 0x80) return v;
      m *= 128;
    }
  }

  get done(): boolean {
    return this.parsed && this.line >= this.lineLen.length;
  }

  /** Does about `budget` points of work; true once everything is decoded. */
  step(budget: number): boolean {
    if (!this.parsed) this.parseSome(budget);
    else this.emitSome(budget);
    return this.done;
  }

  private parseSome(budget: number): void {
    const { px, py, cs, pieces, units } = this;
    const stop = this.n + budget;
    while (this.n < stop) {
      while (this.inLevel === 0) {
        if (++this.level >= this.levels) {
          this.finishParse();
          return;
        }
        this.inLevel = this.counts[this.level]!;
      }
      this.inLevel--;
      const len = this.varint();
      if (len < 2 || this.n + len > px.length) throw new Error('admin1: bad line');
      let x = this.fx;
      let y = this.fy;
      const at = this.n;
      for (let i = 0; i < len; i++) {
        const zx = this.varint();
        const zy = this.varint();
        x += zx % 2 === 0 ? zx / 2 : -(zx + 1) / 2;
        y += zy % 2 === 0 ? zy / 2 : -(zy + 1) / 2;
        px[at + i] = x;
        py[at + i] = y;
        cs[at + i] = Math.cos((y / units - 90) * DEG);
        if (i === 0) {
          this.fx = x;
          this.fy = y;
        } else {
          // How many pieces this segment is cut into (a long chord would dip under the surface).
          const dlat = (y - py[at + i - 1]!) / units;
          const dlon = ((x - px[at + i - 1]!) / units) * cs[at + i - 1]!;
          const m = Math.max(1, Math.ceil(Math.hypot(dlat, dlon) / MAX_STEP_DEG));
          pieces[at + i - 1] = m;
          this.total += m;
        }
      }
      this.n += len;
      this.lineLen.push(len);
      this.lineLevel.push(this.level);
    }
  }

  private finishParse(): void {
    this.parsed = true;
    this.seg = new Float32Array(this.total * 4);
    this.arc = new Float32Array(this.total * 2);
    this.levelEnds = new Uint32Array(this.levels);
  }

  private emitSome(budget: number): void {
    const { px, py, cs, pieces, units } = this;
    const seg = this.seg!;
    const arc = this.arc!;
    const stop = this.w + budget;
    while (this.line < this.lineLen.length && this.w < stop) {
      const len = this.lineLen[this.line]!;
      let run = 0;
      for (let i = 0; i < len - 1; i++) {
        const j = this.at + i;
        const la0 = py[j]! / units - 90;
        const lo0 = px[j]! / units - 180;
        const la1 = py[j + 1]! / units - 90;
        const lo1 = px[j + 1]! / units - 180;
        const m = pieces[j]!;
        const c = cs[j]!;
        for (let p = 0; p < m; p++) {
          // The ends of a piece are the file's own points where they are, so neighbours meet exactly.
          const t0 = p / m;
          const t1 = (p + 1) / m;
          const a0 = p === 0 ? la0 : la0 + (la1 - la0) * t0;
          const o0 = p === 0 ? lo0 : lo0 + (lo1 - lo0) * t0;
          const a1 = p === m - 1 ? la1 : la0 + (la1 - la0) * t1;
          const o1 = p === m - 1 ? lo1 : lo0 + (lo1 - lo0) * t1;
          const ds = Math.hypot(a1 - a0, (o1 - o0) * c) * DEG;
          const w = this.w++;
          seg[w * 4] = a0;
          seg[w * 4 + 1] = o0;
          seg[w * 4 + 2] = a1;
          seg[w * 4 + 3] = o1;
          arc[w * 2] = run;
          run += ds;
          arc[w * 2 + 1] = run;
        }
      }
      this.at += len;
      this.levelEnds![this.lineLevel[this.line]!] = this.w;
      this.line++;
    }
  }

  /** The decoded lines, once `step` has said it is done. */
  result(): Admin1Lines {
    if (!this.done) throw new Error('admin1: not finished');
    const ends = this.levelEnds!;
    // A level without lines ends where the one before it does.
    for (let l = 1; l < ends.length; l++) if (ends[l]! < ends[l - 1]!) ends[l] = ends[l - 1]!;
    return { seg: this.seg!, arc: this.arc!, levelEnds: ends, lines: this.lineLen.length };
  }
}

/** Reads the whole file at once (tests, tools). */
export function decodeAdmin1(data: ArrayBuffer | Uint8Array): Admin1Lines {
  const d = new Admin1Decoder(data);
  while (!d.step(Number.POSITIVE_INFINITY));
  return d.result();
}

/** Gives the event loop back to the page for a moment. */
function breathe(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      r();
    };
    ch.port2.postMessage(0);
  });
}

/**
 * Reads the file a slice at a time, handing the event loop back between slices, so the globe keeps
 * drawing while the lines arrive: a slice is about a millisecond.
 */
export async function decodeAdmin1Async(data: ArrayBuffer | Uint8Array, slice = 6000): Promise<Admin1Lines> {
  const d = new Admin1Decoder(data);
  while (!d.step(slice)) await breathe();
  return d.result();
}

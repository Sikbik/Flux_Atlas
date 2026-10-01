// Edge geometry for the light that runs along a control's border: pure, DOM-free, unit-tested.
//
// An `Outline` is a closed clockwise polyline (screen coordinates, y down) with cumulative arc
// length. A comet is then a sequence of keyframes (position and heading) sampled along it, so the
// whole effect is a pair of transform animations on tiny elements: compositor work, no layout, and
// the head turns every corner (rounded or chamfered) exactly.

export interface Pt {
  x: number;
  y: number;
}

/** A point on an outline with the heading (radians, continuous after unwrapping) of travel. */
export interface Frame {
  x: number;
  y: number;
  a: number;
}

const TAU = Math.PI * 2;

export class Outline {
  readonly pts: readonly Pt[];
  /** cum[i] is the arc length from the start to pts[i]; cum[n] is the full perimeter. */
  readonly cum: readonly number[];
  readonly length: number;

  constructor(pts: readonly Pt[]) {
    // Drop consecutive duplicates (a zero radius corner emits its point twice).
    const clean: Pt[] = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) clean.push(p);
    }
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first && last && clean.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6)
      clean.pop();
    this.pts = clean;
    const cum: number[] = [0];
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]!;
      const b = clean[(i + 1) % clean.length]!;
      cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.cum = cum;
    this.length = cum[cum.length - 1] ?? 0;
  }

  /** The point at arc length `s` from the start (wraps around) and the heading of travel there. */
  at(s: number): Frame {
    const n = this.pts.length;
    if (n < 2 || this.length <= 0) return { x: this.pts[0]?.x ?? 0, y: this.pts[0]?.y ?? 0, a: 0 };
    let d = s % this.length;
    if (d < 0) d += this.length;
    // Binary search for the segment whose range holds d.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid - 1;
    }
    const a = this.pts[lo]!;
    const b = this.pts[(lo + 1) % n]!;
    const seg = this.cum[lo + 1]! - this.cum[lo]!;
    const t = seg > 0 ? (d - this.cum[lo]!) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Nearest point on the outline to (x, y): its arc length and the distance to it. */
  project(x: number, y: number): { s: number; dist: number } {
    const n = this.pts.length;
    let best = { s: 0, dist: Number.POSITIVE_INFINITY };
    for (let i = 0; i < n; i++) {
      const a = this.pts[i]!;
      const b = this.pts[(i + 1) % n]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const dist = Math.hypot(x - px, y - py);
      if (dist < best.dist) best = { s: this.cum[i]! + Math.sqrt(len2) * t, dist };
    }
    return best;
  }
}

export type Radii = readonly [tl: number, tr: number, br: number, bl: number];

/** CSS border-radius scaling: when two radii on a side overflow it, all radii shrink together. */
export function fitRadii(w: number, h: number, r: Radii): Radii {
  const [tl, tr, br, bl] = r;
  const f = Math.min(
    1,
    tl + tr > 0 ? w / (tl + tr) : 1,
    bl + br > 0 ? w / (bl + br) : 1,
    tl + bl > 0 ? h / (tl + bl) : 1,
    tr + br > 0 ? h / (tr + br) : 1,
  );
  return [tl * f, tr * f, br * f, bl * f];
}

/**
 * A rounded rectangle, clockwise, starting where the top edge meets the top-right corner and shrunk
 * by `inset` on every side. `step` is the arc sampling angle.
 */
export function roundedRect(w: number, h: number, radii: Radii, inset = 0, step = Math.PI / 12): Outline {
  const [tl, tr, br, bl] = fitRadii(w, h, radii).map((r) => Math.max(0, r - inset)) as [
    number,
    number,
    number,
    number,
  ];
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const pts: Pt[] = [];
  // A corner is its square vertex when the radius is zero, otherwise a quarter arc from `from`.
  const corner = (cx: number, cy: number, r: number, from: number, vx: number, vy: number) => {
    if (r <= 0) {
      pts.push({ x: vx, y: vy });
      return;
    }
    const steps = Math.max(2, Math.ceil(Math.PI / 2 / step));
    for (let i = 0; i <= steps; i++) {
      const a = from + ((Math.PI / 2) * i) / steps;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  corner(x1 - tr, y0 + tr, tr, -Math.PI / 2, x1, y0);
  corner(x1 - br, y1 - br, br, 0, x1, y1);
  corner(x0 + bl, y1 - bl, bl, Math.PI / 2, x0, y1);
  corner(x0 + tl, y0 + tl, tl, Math.PI, x0, y0);
  return new Outline(pts);
}

/** Moves every edge of a clockwise convex polygon inward by `d` (miter joins). */
export function insetPolygon(pts: readonly Pt[], d: number): Pt[] {
  const n = pts.length;
  if (d === 0 || n < 3) return [...pts];
  // Offset lines: for edge i (pts[i] -> pts[i+1]) the inward normal of a clockwise polygon is (-dy, dx).
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { px: a.x + nx * d, py: a.y + ny * d, dx: dx / len, dy: dy / len, nx, ny };
  });
  return pts.map((v, i) => {
    const prev = lines[(i + n - 1) % n]!;
    const next = lines[i]!;
    const cross = prev.dx * next.dy - prev.dy * next.dx;
    if (Math.abs(cross) < 1e-9) return { x: v.x + next.nx * d, y: v.y + next.ny * d };
    // Intersection of the two offset lines.
    const t = ((next.px - prev.px) * next.dy - (next.py - prev.py) * next.dx) / cross;
    return { x: prev.px + prev.dx * t, y: prev.py + prev.dy * t };
  });
}

export function polygonOutline(pts: readonly Pt[], inset = 0): Outline {
  return new Outline(insetPolygon(pts, inset));
}

// ---- CSS parsing -----------------------------------------------------------------------------

function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function term(t: string, ref: number): number | null {
  const s = t.trim();
  if (s === '0') return 0;
  let m = /^(-?\d*\.?\d+)px$/i.exec(s);
  if (m) return Number(m[1]);
  m = /^(-?\d*\.?\d+)%$/.exec(s);
  if (m) return (ref * Number(m[1])) / 100;
  return null;
}

/** A CSS length, percentage or `calc(a +/- b ...)` of those, resolved against `ref` pixels. */
export function parseLength(token: string, ref: number): number | null {
  const s = token.trim();
  const calc = /^calc\((.*)\)$/i.exec(s);
  if (!calc) return term(s, ref);
  const parts = calc[1]!.split(/\s+/);
  let total = 0;
  let sign = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i % 2 === 1) {
      if (p === '+') sign = 1;
      else if (p === '-') sign = -1;
      else return null;
    } else {
      const v = term(p, ref);
      if (v === null) return null;
      total += sign * v;
    }
  }
  return total;
}

/** Parses a computed `clip-path: polygon(...)` into pixel points for a box of w by h. */
export function parsePolygon(css: string, w: number, h: number): Pt[] | null {
  const m = /^polygon\((.*)\)$/is.exec(css.trim());
  if (!m) return null;
  const items = splitTop(m[1]!, /,/);
  if (items[0] && /^(nonzero|evenodd)$/i.test(items[0])) items.shift();
  const pts: Pt[] = [];
  for (const item of items) {
    const [xs, ys, ...rest] = splitTop(item, /\s/);
    if (xs === undefined || ys === undefined || rest.length) return null;
    const x = parseLength(xs, w);
    const y = parseLength(ys, h);
    if (x === null || y === null) return null;
    pts.push({ x, y });
  }
  return pts.length >= 3 ? pts : null;
}

/** One computed corner radius ("10px", "50%", "10px 6px") as a single pixel radius. */
export function parseRadius(value: string, w: number, h: number): number {
  const parts = value.trim().split(/\s+/);
  const a = parseLength(parts[0] ?? '0', w);
  const b = parseLength(parts[1] ?? parts[0] ?? '0', h);
  return Math.max(0, Math.min(a ?? 0, b ?? a ?? 0));
}

// ---- comets ----------------------------------------------------------------------------------

/**
 * Samples a comet's path: `count + 1` frames from arc length `s0`, moving `travel` pixels in
 * direction `dir` (+1 clockwise, -1 counter-clockwise). The heading is the direction of travel and
 * is unwrapped so interpolating between frames never spins the long way round.
 */
export function cometFrames(o: Outline, s0: number, dir: 1 | -1, travel: number, count: number): Frame[] {
  const frames: Frame[] = [];
  let prev = 0;
  for (let i = 0; i <= count; i++) {
    const f = o.at(s0 + (dir * travel * i) / count);
    let a = dir === 1 ? f.a : f.a + Math.PI;
    if (i > 0) {
      while (a - prev > Math.PI) a -= TAU;
      while (a - prev < -Math.PI) a += TAU;
    }
    prev = a;
    frames.push({ x: f.x, y: f.y, a });
  }
  return frames;
}

/** Keyframe count for a path of `travel` pixels: about one per 4 px, between 8 and 48. */
export function frameCount(travel: number): number {
  return Math.max(8, Math.min(48, Math.ceil(travel / 4)));
}

// ---- easing and trails -----------------------------------------------------------------------

export interface Bezier {
  /** Progress (0..1) at time fraction `t`. */
  at(t: number): number;
  /** The time fraction at which the progress reaches `v` (the curve must be monotone in y). */
  inverse(v: number): number;
}

/** A CSS cubic-bezier(x1, y1, x2, y2) timing function, evaluated and inverted in JS. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Bezier {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (u: number) => ((ax * u + bx) * u + cx) * u;
  const Y = (u: number) => ((ay * u + by) * u + cy) * u;
  const solve = (f: (u: number) => number, target: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    at: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Y(solve(X, t))),
    inverse: (v) => (v <= 0 ? 0 : v >= 1 ? 1 : X(solve(Y, v))),
  };
}

/** Parses a `cubic-bezier(a, b, c, d)` string. */
export function parseBezier(css: string): Bezier | null {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(
    css.trim(),
  );
  return m ? cubicBezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])) : null;
}

/** A frame with its time offset (0..1) in the animation. */
export interface TimedFrame extends Frame {
  offset: number;
}

/**
 * Keyframes for one segment of a comet's trail. The head travels `travel` px along the outline from
 * `s0` in direction `dir`, timed by `ease`. A segment that trails `lag` px behind the head waits at
 * the start until the head has moved `lag` px, then follows the same path, so a chain of segments
 * with growing lags bends around every corner like one long tail.
 *
 * A frame is where the segment's centre is and which way it points: along the chord from the point
 * `reach` px behind it on the path to the point `reach` px ahead of it, so a straight element of
 * length 2 * `reach` is inscribed in the outline (it leaves a curve by the sagitta of that chord,
 * under a pixel for a short reach) instead of sticking out tangentially at a corner. Samples are
 * spaced `step` px along the path (not in time), so linear interpolation between them stays on it.
 */
export function trailFrames(
  o: Outline,
  s0: number,
  dir: 1 | -1,
  travel: number,
  lag: number,
  ease: Bezier,
  reach: number,
  step = 5,
): TimedFrame[] {
  const dist = travel - lag;
  if (dist <= 0 || travel <= 0) return [];
  const frames: TimedFrame[] = [];
  const push = (d: number, offset: number) => {
    const at = o.at(s0 + dir * d);
    let a = dir === 1 ? at.a : at.a + Math.PI;
    if (reach > 0) {
      const back = o.at(s0 + dir * (d - reach));
      const fore = o.at(s0 + dir * (d + reach));
      a = Math.atan2(fore.y - back.y, fore.x - back.x);
    }
    const prev = frames[frames.length - 1];
    if (prev) {
      while (a - prev.a > Math.PI) a -= TAU;
      while (a - prev.a < -Math.PI) a += TAU;
    }
    frames.push({ x: at.x, y: at.y, a, offset });
  };
  // Waiting at the start until the head has covered the lag.
  const t0 = lag > 0 ? ease.inverse(lag / travel) : 0;
  if (t0 > 0) push(0, 0);
  const n = Math.max(2, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const d = (dist * i) / n;
    let t = i === 0 ? t0 : ease.inverse((d + lag) / travel);
    const prev = frames[frames.length - 1];
    if (prev && t <= prev.offset) t = Math.min(1, prev.offset + 1e-4);
    push(d, t);
  }
  // The last sample lands exactly on the end of the animation.
  const last = frames[frames.length - 1];
  if (last) last.offset = 1;
  return frames;
}

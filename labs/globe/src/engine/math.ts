// Small allocation-free math helpers. Everything here is safe to call per frame.

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
/** Golden angle, radians. Drives the phyllotaxis fan-out of stacked nodes. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const saturate = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number): number => (b === a ? 0 : (x - a) / (b - a));

export function smoothstep(a: number, b: number, x: number): number {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. `lambda` is 1/seconds-ish. */
/**
 * Arc altitude (in globe radii) for a hop of `ang` radians: `a0` for any real hop (faded in over the
 * first 17 degrees so neighbours do not spike) plus `a1` scaled by the fraction of a half turn.
 */
export function arcLift(ang: number, a0: number, a1: number): number {
  return a0 * smoothstep(0, 0.3, ang) + a1 * (ang / Math.PI);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function wrapPi(a: number): number {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapPi(target - current) * (1 - Math.exp(-lambda * dt));
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
export const easeInOutQuint = (t: number): number => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const easeInOutSine = (t: number): number => -(Math.cos(PI * t) - 1) / 2;
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Unit vector for lat/lon degrees, written to `out[o..o+2]`. +Y north, lon 0 toward +Z, lon 90E toward +X. */
export function latLonToXyz(latDeg: number, lonDeg: number, out: Float32Array | number[], o = 0): void {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  out[o] = c * Math.sin(lo);
  out[o + 1] = Math.sin(la);
  out[o + 2] = c * Math.cos(lo);
}

export function xyzToLatLon(x: number, y: number, z: number, out: { lat: number; lon: number }): void {
  const l = Math.hypot(x, y, z) || 1;
  out.lat = Math.asin(clamp(y / l, -1, 1)) * RAD;
  out.lon = Math.atan2(x, z) * RAD;
}

/** Central angle between two unit vectors, radians. */
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const d = ax * bx + ay * by + az * bz;
  if (d > 0.9999) {
    // acos loses precision near 0, use the cross product length instead.
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    return Math.asin(clamp(Math.hypot(cx, cy, cz), 0, 1));
  }
  return Math.acos(clamp(d, -1, 1));
}

/** Haversine-ish great-circle distance for lat/lon degrees, in radians. */
export function geoDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Integer hash to uint32 (lowbias32). Deterministic jitter without an RNG object. */
export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash to [0, 1). */
export function hash01(x: number): number {
  return hash32(x) / 4294967296;
}

/** Mulberry32 PRNG. Small, fast, seedable. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Standard normal (Box-Muller, one sample per call). */
  gauss(): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** Next power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

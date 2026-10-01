// The easter egg: a handlebar moustache drawn in light across the planet, with a nod to stache.beer.
//
// The outline is original: two mirrored runs of cubic Bezier segments, flattened to a polyline and
// laid onto the sphere around a center point (east along the tangent plane for x, north for y). It
// reuses the ribbon pool (one short free-point arc per segment, staggered so the stroke draws
// itself), so it costs nothing when it is not playing.

import type { RibbonLayer } from '../layers/ribbons';
import { RibbonStyle } from '../layers/ribbons';
import { DEG } from '../math';

// Right half, in a 200 x 80 box centered on x = 100. Each row is [c1x, c1y, c2x, c2y, x, y]; the path
// starts at (100, 31) and ends at (100, 47).
const START = [100, 31];
const SEGMENTS: number[][] = [
  [112, 22, 130, 21, 144, 29],
  [152, 33, 161, 38, 169, 33],
  [177, 28, 181, 19, 178, 11],
  [187, 16, 192, 29, 185, 42],
  [177, 57, 154, 61, 138, 54],
  [124, 49, 112, 47, 100, 47],
];

const PER_SEGMENT = 9;

let cached: Float32Array | null = null;

/** The outline as flat (u, v) pairs in [-1, 1] x [-0.5, 0.5]: right half first, then the mirrored left half. */
export function moustacheOutline(): Float32Array {
  if (cached) return cached;
  const pts: number[] = [];
  const half: number[] = [START[0], START[1]];
  let px = START[0];
  let py = START[1];
  for (const s of SEGMENTS) {
    for (let i = 1; i <= PER_SEGMENT; i++) {
      const t = i / PER_SEGMENT;
      const m = 1 - t;
      const x = m * m * m * px + 3 * m * m * t * s[0] + 3 * m * t * t * s[2] + t * t * t * s[4];
      const y = m * m * m * py + 3 * m * m * t * s[1] + 3 * m * t * t * s[3] + t * t * t * s[5];
      half.push(x, y);
    }
    px = s[4];
    py = s[5];
  }
  // Right half from the top notch around to the bottom center, then the left half back up.
  for (let i = 0; i < half.length; i += 2) pts.push((half[i] - 100) / 100, -(half[i + 1] - 39) / 100);
  for (let i = half.length - 2; i >= 0; i -= 2) pts.push(-(half[i] - 100) / 100, -(half[i + 1] - 39) / 100);
  cached = new Float32Array(pts);
  return cached;
}

/** The same outline as an SVG path (for the overlay's stamp). */
export const MOUSTACHE_SVG_PATH =
  'M100,31 C112,22 130,21 144,29 C152,33 161,38 169,33 C177,28 181,19 178,11 C187,16 192,29 185,42 C177,57 154,61 138,54 C124,49 112,47 100,47 ' +
  'C88,47 76,49 62,54 C46,61 23,57 15,42 C8,29 13,16 22,11 C19,19 23,28 31,33 C39,38 48,33 56,29 C70,21 88,22 100,31';

/**
 * Draws the moustache around (lat, lon). `halfWidth` is the angular half width in radians. Returns
 * the number of ribbon segments added.
 */
export function drawMoustache(ribbons: RibbonLayer, lat: number, lon: number, halfWidth: number, time: number, color: { r: number; g: number; b: number }, intensity = 1.5): number {
  const o = moustacheOutline();
  const la = lat * DEG;
  const lo = lon * DEG;
  // Tangent basis: east and north at the center.
  const bx = Math.cos(la) * Math.sin(lo);
  const by = Math.sin(la);
  const bz = Math.cos(la) * Math.cos(lo);
  const ex = Math.cos(lo);
  const ez = -Math.sin(lo);
  const nx = -Math.sin(la) * Math.sin(lo);
  const ny = Math.cos(la);
  const nz = -Math.sin(la) * Math.cos(lo);
  const n = o.length / 2;
  const R = 1.006;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = o[i * 2] * halfWidth;
    const v = o[i * 2 + 1] * halfWidth;
    let x = bx + ex * u + nx * v;
    let y = by + ny * v;
    let z = bz + ez * u + nz * v;
    const l = Math.hypot(x, y, z);
    x = (x / l) * R;
    y = (y / l) * R;
    z = (z / l) * R;
    px[i] = x;
    py[i] = y;
    pz[i] = z;
  }
  let count = 0;
  // The stroke starts at the top notch, runs out along the right half, and closes through the left.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const start = time + (i / n) * 1.9;
    const idx = ribbons.addFree(px[i], py[i], pz[i], px[j], py[j], pz[j], RibbonStyle.Arc, start, 0.14, 6.2 - (i / n) * 1.9, 0.0006, 2.2, color.r, color.g, color.b, intensity);
    if (idx >= 0) count++;
  }
  return count;
}

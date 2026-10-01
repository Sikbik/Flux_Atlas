// Layout: where each node is drawn, as a function of how far the camera is.
//
// Far away, co-located nodes stack into a column (a "spire") whose height grows with the count:
// the honest picture of a datacenter hub. Close up, the same nodes peel off the column one by one
// and settle onto the surface in a sunflower (phyllotaxis) disc, so every node is individually
// visible and pickable. The blend is per node and staggered by rank, so zooming feels like the
// stack unfurling rather than a global cross-fade.

import { clamp, GOLDEN_ANGLE, smoothstep } from '../math';
import { NO_CLUSTER, type NodeStore } from './store';

export interface LayoutParams {
  /** Draw unlocated nodes as an orbital belt (otherwise they are hidden). */
  belt: boolean;
  /** 0 = everything stacked, 1 = everything fanned out. */
  fan: number;
  /** Angular spacing of the fan-out spiral, radians. */
  spacing: number;
  spireScale: number;
  /**
   * Smallest hub that gets a tower at the current zoom (the design: top 60 sites at Z0, hubs of 8 or
   * more at Z1, every shared site closer in). Smaller hubs stack flat and draw as a single point.
   */
  minTower: number;
  /** Screen pixels per radian on the surface at the camera target (for density-aware dimming). */
  pxPerRad: number;
  dt: number;
}

const SURFACE = 0.0012;
const MAX_DISC = 0.02;
const STAGGER = 0.55;

/** Height of a hub's spire in globe radii. */
export function spireHeight(n: number): number {
  if (n < 2) return 0;
  return Math.min(0.27, 0.011 + 0.0068 * Math.sqrt(n));
}

/**
 * Brightness of each node while stacked. The column's total light grows only with the logarithm of
 * the count (the spire ribbon carries the hub's presence), so a thousand additive dots never white
 * out. Fanned-out nodes return to full brightness.
 */
export function stackDim(n: number): number {
  if (n <= 1) return 1;
  const total = 1.1 + 0.32 * Math.log2(n);
  return Math.min(1, total / n);
}

/**
 * Writes display positions (x, y, z, dim) for every live or dying slot. Also eases the per-cluster
 * spire heights. Returns true while something is still animating (so the caller keeps re-running).
 */
export function computeLayout(store: NodeStore, p: LayoutParams): boolean {
  let animating = false;
  const { pos, dir, cluster, rank, fanRank, alive, cFan, cFanNext, cDir } = store;

  // Ease spire heights toward their targets (live node count, filtered).
  const k = 1 - Math.exp(-6 * p.dt);
  for (let c = 0; c < store.clusterCount; c++) {
    const count = store.cPass[c]!;
    const lod = smoothstep(p.minTower * 0.5, p.minTower, count);
    const target = spireHeight(count) * p.spireScale * lod;
    const cur = store.cHeight[c]!;
    if (Math.abs(target - cur) > 1e-4) {
      store.cHeight[c] = cur + (target - cur) * k;
      animating = true;
    } else {
      store.cHeight[c] = target;
    }
  }

  for (let s = 0; s < store.high; s++) {
    const o = s * 4;
    if (alive[s] === 0) {
      pos[o + 3] = 0;
      continue;
    }
    const bx = dir[s * 3]!;
    const by = dir[s * 3 + 1]!;
    const bz = dir[s * 3 + 2]!;
    const c = cluster[s]!;
    if (c === NO_CLUSTER) {
      const r = 1.3;
      pos[o] = bx * r;
      pos[o + 1] = by * r;
      pos[o + 2] = bz * r;
      pos[o + 3] = p.belt ? 0.5 : 0;
      continue;
    }
    const n = Math.max(1, store.cLive[c]!);
    const span = Math.max(1, store.cNext[c]!);
    const kr = rank[s]!;
    // The fan is shared by every cluster of the site (see FAN_GROUP_ARC): one spiral, one centre.
    const g = cFan[c]!;
    const fanSpan = Math.max(1, cFanNext[g]!);
    if (n === 1 && span === 1 && fanSpan === 1) {
      const r = 1 + SURFACE;
      pos[o] = bx * r;
      pos[o + 1] = by * r;
      pos[o + 2] = bz * r;
      pos[o + 3] = 1;
      continue;
    }
    const H = store.cHeight[c]!;
    const f = smoothstep(0, 1, clamp((p.fan - STAGGER * (kr / span)) / (1 - STAGGER), 0, 1));
    const rStack = 1 + SURFACE + H * ((kr + 0.5) / span);
    // Inside a drawn tower the tower carries the hub's light; the stacked dots recede to a quarter.
    const sd = stackDim(n) * (1 - 0.72 * smoothstep(p.minTower * 0.5, p.minTower, store.cPass[c]!));
    if (f <= 0.0005) {
      pos[o] = bx * rStack;
      pos[o + 1] = by * rStack;
      pos[o + 2] = bz * rStack;
      pos[o + 3] = sd;
      continue;
    }
    // Fan: geodesic offset on the surface along a golden-angle spiral, centred on the site's first cluster.
    const kf = fanRank[s]!;
    const sp = Math.min(p.spacing, MAX_DISC / Math.sqrt(fanSpan));
    const rad = Math.sqrt(kf + 0.5) * sp;
    const th = kf * GOLDEN_ANGLE;
    const ax = g === c ? bx : cDir[g * 3]!;
    const ay = g === c ? by : cDir[g * 3 + 1]!;
    const az = g === c ? bz : cDir[g * 3 + 2]!;
    // A big hub squeezed into its disc overlaps its own nodes; dim them so the disc reads as a
    // field of points instead of a white blob (full brightness once neighbours are 6 px apart).
    const spPx = sp * p.pxPerRad;
    const dense = clamp(spPx / 6.0, 0.22, 1);
    // Tangent basis at A: E = (az, 0, -ax)/|..|, Nn = A x E
    let ex = az;
    let ez = -ax;
    const el = Math.hypot(ex, ez);
    if (el < 1e-6) {
      ex = 1;
      ez = 0;
    } else {
      ex /= el;
      ez /= el;
    }
    const nx = ay * ez;
    const ny = az * ex - ax * ez;
    const nz = -ay * ex;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const tx = ex * ct + nx * st;
    const ty = ny * st;
    const tz = ez * ct + nz * st;
    const cr = Math.cos(rad);
    const sr = Math.sin(rad);
    const fx = ax * cr + tx * sr;
    const fy = ay * cr + ty * sr;
    const fz = az * cr + tz * sr;
    // Blend stack and fan positions (direction and radius separately).
    let dx = bx + (fx - bx) * f;
    let dy = by + (fy - by) * f;
    let dz = bz + (fz - bz) * f;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const rr = rStack + (1 + SURFACE - rStack) * f;
    pos[o] = dx * rr;
    pos[o + 1] = dy * rr;
    pos[o + 2] = dz * rr;
    pos[o + 3] = (sd + (1 - sd) * f * f) * (1 + (dense - 1) * f);
    if (f < 0.999) animating = true;
  }
  return animating;
}

/** Fan position of a slot at a given spacing, used for camera targets. Writes x,y,z to out. */
export function fanPosition(store: NodeStore, slot: number, spacing: number, out: Float32Array): void {
  const bx = store.dir[slot * 3]!;
  const by = store.dir[slot * 3 + 1]!;
  const bz = store.dir[slot * 3 + 2]!;
  const c = store.cluster[slot]!;
  if (c === NO_CLUSTER) {
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
    return;
  }
  const g = store.cFan[c]!;
  const fanSpan = Math.max(1, store.cFanNext[g]!);
  const kf = store.fanRank[slot]!;
  const sp = Math.min(spacing, MAX_DISC / Math.sqrt(fanSpan));
  const rad = Math.sqrt(kf + 0.5) * sp;
  const th = kf * GOLDEN_ANGLE;
  const ax = g === c ? bx : store.cDir[g * 3]!;
  const ay = g === c ? by : store.cDir[g * 3 + 1]!;
  const az = g === c ? bz : store.cDir[g * 3 + 2]!;
  let ex = az;
  let ez = -ax;
  const el = Math.hypot(ex, ez);
  if (el < 1e-6) {
    ex = 1;
    ez = 0;
  } else {
    ex /= el;
    ez /= el;
  }
  const nx = ay * ez;
  const ny = az * ex - ax * ez;
  const nz = -ay * ex;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const cr = Math.cos(rad);
  const sr = Math.sin(rad);
  out[0] = ax * cr + (ex * ct + nx * st) * sr;
  out[1] = ay * cr + ny * st * sr;
  out[2] = az * cr + (ez * ct + nz * st) * sr;
}

// CPU picking. Projecting 15k points costs about a tenth of a millisecond, needs no readback, and
// matches exactly what is drawn because it reads the same display positions the GPU does. A node is
// hit when the pointer is inside its on-screen radius; when several overlap, the nearest to the
// camera wins. Spire columns are hit as line segments.

import * as THREE from 'three';
import type { CameraRig } from '../camera';
import { NO_CLUSTER, type NodeStore } from './store';

const _vp = new THREE.Matrix4();

export interface PickResult {
  slot: number;
  cluster: number;
  /** True when the hit is a spire column rather than a single node. */
  column: boolean;
  x: number;
  y: number;
}

/** CSS-pixel diameter of a node's core at rest (mirrors the vertex shader). */
export function tierSizePx(tier: number): number {
  return tier === 3 ? 3.9 : tier === 2 ? 3.1 : 2.5;
}

export class Picker {
  constructor(
    private readonly store: NodeStore,
    private readonly rig: CameraRig,
  ) {}

  /**
   * @param px pointer x, CSS pixels
   * @param py pointer y, CSS pixels
   * @param nodeScale global node size multiplier
   * @param nodeWorld current world-space node radius (radians)
   */
  pick(
    px: number,
    py: number,
    cssW: number,
    cssH: number,
    nodeScale: number,
    nodeWorld: number,
    out: PickResult,
  ): boolean {
    const cam = this.rig.camera;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const e = _vp.elements;
    const s = this.store;
    const pos = s.pos;
    const cp = this.rig.position;
    const projCss = this.rig.projScale;
    let best = -1;
    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;
    const cx0 = cp.x;
    const cy0 = cp.y;
    const cz0 = cp.z;
    for (let i = 0; i < s.high; i++) {
      if (s.alive[i] !== 1) continue;
      const o = i * 4;
      if (pos[o + 3]! <= 0) continue;
      const x = pos[o]!;
      const y = pos[o + 1]!;
      const z = pos[o + 2]!;
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0.001) continue;
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
      const sx = (nx * 0.5 + 0.5) * cssW;
      const sy = (0.5 - ny * 0.5) * cssH;
      const dx = sx - px;
      const dy = sy - py;
      if (dx > 36 || dx < -36 || dy > 36 || dy < -36) continue;
      const tier = s.tier[i]!;
      const base = tierSizePx(tier) * nodeScale;
      const worldPx = (nodeWorld * (0.9 + 0.2 * tier) * 2 * projCss) / cw;
      const core = Math.max(base, Math.min(worldPx, base * 7));
      const rad = core * 0.5 + 5.5;
      const d2 = dx * dx + dy * dy;
      if (d2 > rad * rad) continue;
      // Occlusion: does the segment camera -> node dip inside the planet?
      const vx = x - cx0;
      const vy = y - cy0;
      const vz = z - cz0;
      const vv = vx * vx + vy * vy + vz * vz;
      let t = -(cx0 * vx + cy0 * vy + cz0 * vz) / vv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = cx0 + vx * t;
      const qy = cy0 + vy * t;
      const qz = cz0 + vz * t;
      if (qx * qx + qy * qy + qz * qz < 0.992) continue;
      // Score: normalised distance, with depth as a tiebreaker toward the camera.
      const score = Math.sqrt(d2) / rad + cw * 0.0005;
      if (score < bestScore) {
        bestScore = score;
        best = i;
        bestX = sx;
        bestY = sy;
      }
    }
    if (best >= 0) {
      out.slot = best;
      out.cluster = s.cluster[best]!;
      out.column = false;
      out.x = bestX;
      out.y = bestY;
      return true;
    }
    return false;
  }

  /** Spire hit test: distance from the pointer to each visible column. */
  pickColumn(px: number, py: number, cssW: number, cssH: number, fan: number, out: PickResult): boolean {
    const cam = this.rig.camera;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const e = _vp.elements;
    const s = this.store;
    const cp = this.rig.position;
    const yb = Math.min(1, Math.max(0, (fan - 0.225) / 0.55));
    let best = -1;
    let bestD = 9;
    for (let c = 0; c < s.clusterCount; c++) {
      if (s.cLive[c]! < 2) continue;
      const H = s.cHeight[c]!;
      if (H * (1 - yb) < 0.004) continue;
      const bx = s.cDir[c * 3]!;
      const by = s.cDir[c * 3 + 1]!;
      const bz = s.cDir[c * 3 + 2]!;
      // Skip clusters on the far side of the planet (dot(B, C) > 1 means the base is over the horizon).
      if (bx * cp.x + by * cp.y + bz * cp.z < 0.97) continue;
      const r0 = 1.0012 + H * yb;
      const r1 = 1.0012 + H;
      const w0 = e[3] * bx * r0 + e[7] * by * r0 + e[11] * bz * r0 + e[15];
      const w1 = e[3] * bx * r1 + e[7] * by * r1 + e[11] * bz * r1 + e[15];
      if (w0 <= 0.001 || w1 <= 0.001) continue;
      const x0 = (((e[0] * bx * r0 + e[4] * by * r0 + e[8] * bz * r0 + e[12]) / w0) * 0.5 + 0.5) * cssW;
      const y0 = (0.5 - ((e[1] * bx * r0 + e[5] * by * r0 + e[9] * bz * r0 + e[13]) / w0) * 0.5) * cssH;
      const x1 = (((e[0] * bx * r1 + e[4] * by * r1 + e[8] * bz * r1 + e[12]) / w1) * 0.5 + 0.5) * cssW;
      const y1 = (0.5 - ((e[1] * bx * r1 + e[5] * by * r1 + e[9] * bz * r1 + e[13]) / w1) * 0.5) * cssH;
      const sx = x1 - x0;
      const sy = y1 - y0;
      const l2 = sx * sx + sy * sy;
      let t = l2 > 1e-6 ? ((px - x0) * sx + (py - y0) * sy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x0 + sx * t - px;
      const dy = y0 + sy * t - py;
      const d = Math.sqrt(dx * dx + dy * dy) - 2.5 - 0.6 * Math.log2(s.cLive[c]!);
      if (d < bestD) {
        bestD = d;
        best = c;
        out.x = x0 + sx * t;
        out.y = y0 + sy * t;
      }
    }
    if (best < 0 || bestD > 7) return false;
    out.cluster = best;
    out.slot = s.cRep[best]!;
    out.column = true;
    return true;
  }

  static get noCluster(): number {
    return NO_CLUSTER;
  }
}

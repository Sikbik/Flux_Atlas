// The mesh veil: a rolling sample of the real P2P links, drawn as low, dim arcs that fade in, live
// for a while and fade out again. Showing every edge at once (thousands of arcs sharing a handful of
// hubs) is a hairball; showing a living subset keeps the web legible, stays inside the ribbon pool,
// and is honest about what it is: real links, sampled over time.
//
// Direct peer-link events bypass the sampling (a new link is always shown, with a spark), and
// selected or watched nodes always show all of their links through the engine's held ribbons.

import type { CameraRig } from '../camera';
import type { RibbonLayer } from '../layers/ribbons';
import { RibbonStyle } from '../layers/ribbons';
import { hash01, smoothstep } from '../math';
import type { Fx } from '../fx';
import type { MeshStore } from './mesh';
import type { NodeStore } from './store';

const MAX_ACTIVE = 4096;

export class MeshVeil {
  /** Whole layer on/off. */
  enabled = true;
  /** Links on screen at once at full quality (scaled by density). */
  target = 380;
  /** Seconds a link stays up on average. */
  meanLife = 26;
  /** Peak intensity (alpha, design `mesh-flow-alpha` times a gain). */
  intensity = 0.1;
  /** Scene multiplier (the ambient web scene turns the veil up). */
  gain = 1;
  private readonly active = new Int32Array(MAX_ACTIVE);
  private activeN = 0;
  private acc = 0;
  private seed = 0x2545f491;
  private readonly sp = { x: 0, y: 0, visible: false, depth: 0 };

  constructor(
    private readonly store: NodeStore,
    private readonly mesh: MeshStore,
    private readonly links: RibbonLayer,
    private readonly fx: Fx,
    private readonly rig: CameraRig,
  ) {}

  get count(): number {
    return this.activeN;
  }

  private rand(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  /** Forget every tracked link (the ribbon pool is cleared by the caller). */
  reset(): void {
    this.activeN = 0;
    this.acc = 0;
  }

  /** A random live, displayed edge for packets to travel along, or -1. */
  pickActive(): number {
    for (let tries = 0; tries < 6 && this.activeN > 0; tries++) {
      const e = this.active[Math.floor(this.rand() * this.activeN)];
      if (this.mesh.alive[e] && this.links.isActive(this.mesh.link[e], this.mesh.linkStart[e])) return e;
    }
    return -1;
  }

  /** Registers an edge that the engine has just drawn itself (direct peer-link events). */
  track(e: number): void {
    if (this.activeN < MAX_ACTIVE) this.active[this.activeN++] = e;
  }

  private inView(slot: number, w: number, h: number): boolean {
    const s = this.store;
    const sp = this.sp;
    if (!this.rig.project(s.pos[slot * 4], s.pos[slot * 4 + 1], s.pos[slot * 4 + 2], w, h, sp)) return false;
    return sp.x > -w * 0.25 && sp.x < w * 1.25 && sp.y > -h * 0.25 && sp.y < h * 1.25;
  }

  update(dt: number, time: number, density: number, viewW: number, viewH: number, color: { r: number; g: number; b: number }): void {
    const mesh = this.mesh;
    const store = this.store;
    // Prune entries whose ribbon finished or whose edge disappeared.
    let n = 0;
    for (let i = 0; i < this.activeN; i++) {
      const e = this.active[i];
      if (mesh.alive[e] && this.links.isActive(mesh.link[e], mesh.linkStart[e])) this.active[n++] = e;
      else if (mesh.alive[e]) mesh.link[e] = -1;
    }
    this.activeN = n;
    if (!this.enabled || mesh.live === 0) return;

    // Fewer arcs as the camera comes in: each one is huge on screen.
    const zoomF = 0.22 + 0.78 * smoothstep(0.4, 2.2, this.rig.lodRange);
    const want = Math.min(MAX_ACTIVE - 64, this.target * density * zoomF);
    // Steady state: replace links at target / meanLife per second; top up faster when starved.
    const rate = Math.max(want / this.meanLife, (want - this.activeN) * 0.9);
    this.acc += Math.min(rate, 90) * dt;
    if (this.acc > 40) this.acc = 40;
    if (this.activeN >= want) {
      this.acc = Math.min(this.acc, 1);
      return;
    }
    mesh.resolve(store);
    const range = this.rig.lodRange;
    // Short edges are sub-pixel at orbit distance; let them appear as the camera comes in.
    const minAng = Math.min(0.06, 0.013 * range);
    const near = range < 1.6;
    let guard = 0;
    while (this.acc >= 1 && guard++ < 40 && this.activeN < want) {
      this.acc -= 1;
      for (let tries = 0; tries < 10; tries++) {
        const e = Math.floor(this.rand() * mesh.high);
        if (!mesh.alive[e]) continue;
        if (mesh.link[e] >= 0 && this.links.isActive(mesh.link[e], mesh.linkStart[e])) continue;
        const a = mesh.sa[e];
        const b = mesh.sb[e];
        if (a === 0xffffffff || b === 0xffffffff) continue;
        if (store.alive[a] !== 1 || store.alive[b] !== 1) continue;
        if (store.id[a] !== mesh.ida[e] || store.id[b] !== mesh.idb[e]) continue;
        if (!this.fx.visible(a) && !this.fx.visible(b)) continue;
        const d = store.dir;
        const dot = d[a * 3] * d[b * 3] + d[a * 3 + 1] * d[b * 3 + 1] + d[a * 3 + 2] * d[b * 3 + 2];
        const ang = Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot);
        if (ang < minAng) continue;
        if (near && !this.inView(a, viewW, viewH) && !this.inView(b, viewW, viewH)) continue;
        // Favor the long hauls that make the web read; keep a scatter of short ones.
        if (this.rand() > 0.3 + 0.7 * Math.min(1, ang / 0.7)) continue;
        this.show(e, a, b, ang, time, color);
        break;
      }
    }
  }

  private show(e: number, a: number, b: number, ang: number, time: number, color: { r: number; g: number; b: number }): void {
    const mesh = this.mesh;
    const life = this.meanLife * (0.55 + 0.9 * this.rand());
    const fadeIn = 1.4 + 1.6 * this.rand();
    // Cross-continent links are brighter (design: 1.6x).
    const boost = 0.75 + 0.85 * Math.min(1, ang / 0.9);
    const idx = this.links.add(a, b, RibbonStyle.Link, time, fadeIn, life, -1, 0.9, color.r, color.g, color.b, this.intensity * this.gain * boost);
    if (idx < 0) return;
    mesh.link[e] = idx;
    mesh.linkStart[e] = Math.fround(time);
    this.track(e);
  }

  /** Draws one specific edge now (used by direct peer-link events). Returns the ribbon index or -1. */
  showEdge(e: number, time: number, fadeIn: number, color: { r: number; g: number; b: number }, boost = 1.6): number {
    const mesh = this.mesh;
    const a = mesh.sa[e];
    const b = mesh.sb[e];
    if (a === 0xffffffff || b === 0xffffffff) return -1;
    const life = this.meanLife * (0.9 + 0.6 * hash01(e * 13 + 5));
    const idx = this.links.add(a, b, RibbonStyle.Link, time, fadeIn, life, -1, 1.0, color.r, color.g, color.b, this.intensity * this.gain * boost);
    if (idx < 0) return -1;
    mesh.link[e] = idx;
    mesh.linkStart[e] = Math.fround(time);
    this.track(e);
    return idx;
  }
}

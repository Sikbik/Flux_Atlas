// Ambient gossip traffic. The P2P mesh is real, so a sampled subset of its links carries animated
// packets: a living picture of the network talking to itself. Packets ride the links the veil is
// currently showing (so every streak has a filament under it), and a selected node's own links carry
// the densest traffic: outbound links send from the node, inbound links send toward it.
//
// This is the baseline "breath" between events. Block-driven floods come from the choreographer.

import type { CameraRig } from './camera';
import type { Fx } from './fx';
import type { MeshStore } from './nodes/mesh';
import type { NodeStore } from './nodes/store';
import type { MeshVeil } from './nodes/veil';

export class Traffic {
  /** Packets per second across the visible hemisphere (scaled by mesh density). */
  rate = 56;
  /** Extra packets per second per selected node, along its own links. */
  focusRate = 14;
  /** Network-wide flow traffic. */
  enabled = true;
  /** Packets along the selection's own links. */
  focusEnabled = true;
  private acc = 0;
  private accFocus = 0;
  private seed = 0x9e3779b9;
  private readonly col = { r: 0.6, g: 0.8, b: 1 };

  constructor(
    private readonly store: NodeStore,
    private readonly mesh: MeshStore,
    private readonly fx: Fx,
    _rig: CameraRig,
    private readonly veil: MeshVeil,
  ) {}

  private rand(): number {
    // xorshift32
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, density: number, selectedSlot: number, reduced: boolean): void {
    const mesh = this.mesh;
    if (mesh.live === 0) return;
    const s = this.store;
    const fx = this.fx;
    const c = fx.color('mesh');
    this.col.r = c.r;
    this.col.g = c.g;
    this.col.b = c.b;

    if (this.enabled) {
      // Reduced motion (design 6.6): nothing travels. The veil of links still fades in and out.
      const rate = reduced ? 0 : this.rate * density;
      this.acc += rate * dt;
      if (this.acc > 40) this.acc = 40;
      mesh.resolve(s);
      let guard = 0;
      while (this.acc >= 1 && guard++ < 48) {
        this.acc -= 1;
        const e = this.veil.pickActive();
        if (e < 0) break;
        const a = mesh.sa[e]!;
        const b = mesh.sb[e]!;
        if (a === 0xffffffff || b === 0xffffffff) continue;
        if (s.alive[a] !== 1 || s.alive[b] !== 1) continue;
        if (!fx.visible(a) && !fx.visible(b)) continue;
        // Packets flow from the dialing side to the accepting side.
        if (mesh.fwd[e] === 1) this.launch(a, b);
        else this.launch(b, a);
      }
    }

    // Focus traffic along the selection's own links.
    if (this.focusEnabled && selectedSlot >= 0 && s.alive[selectedSlot] === 1) {
      this.accFocus = reduced ? 0 : this.accFocus + this.focusRate * dt;
      if (this.accFocus > 12) this.accFocus = 12;
      mesh.buildAdjacency(s, 400);
      const [lo, hi] = mesh.range(selectedSlot);
      const deg = hi - lo;
      let g2 = 0;
      while (this.accFocus >= 1 && deg > 0 && g2++ < 12) {
        this.accFocus -= 1;
        const k = lo + Math.floor(this.rand() * deg);
        const t = mesh.neighbours[k]!;
        if (s.alive[t] !== 1) continue;
        const e = mesh.neighbourEdges[k]!;
        if (mesh.isOutbound(e, selectedSlot)) this.launch(selectedSlot, t);
        else this.launch(t, selectedSlot);
      }
    } else {
      this.accFocus = 0;
    }
  }

  private launch(a: number, b: number): void {
    const d = this.store.dir;
    const dot = d[a * 3]! * d[b * 3]! + d[a * 3 + 1]! * d[b * 3 + 1]! + d[a * 3 + 2]! * d[b * 3 + 2]!;
    const ang = Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot);
    const travel = 0.8 + 1.5 * ang;
    const c = this.col;
    this.fx.packetRaw(a, b, c.r * 1.2, c.g * 1.2, c.b * 1.2, travel, 2.0, 1.0);
  }
}

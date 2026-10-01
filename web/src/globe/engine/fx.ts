// Visual effect primitives used by the choreographer and the engine's own API. Everything is a thin
// write into a preallocated pool or uniform; nothing here allocates.

import * as THREE from 'three';
import type { Activity } from './activity';
import type { CameraRig } from './camera';
import { BeamEase, BeamKind, type BeamLayer } from './layers/beams';
import { ANCHOR_BASE, RayKind, type RayLayer } from './layers/rays';
import { type RibbonLayer, RibbonStyle } from './layers/ribbons';
import type { RingLayer } from './layers/rings';
import { NO_CLUSTER, type NodeStore } from './nodes/store';
import type { SharedUniforms } from './uniforms';

const _c = new THREE.Color();
const _tint = new THREE.Color('#92ADE5');
const _rgb = { r: 0, g: 0, b: 0 };
/** Handles at or above this refer to screen-space beams, below it to world-space rays. */
const BEAM_HANDLE = 100000;

export interface FxTargets {
  store: NodeStore;
  rings: RingLayer;
  arcs: RibbonLayer;
  packets: RibbonLayer;
  links: RibbonLayer;
  rays: RayLayer;
  beams: BeamLayer;
  u: SharedUniforms;
  rig: CameraRig;
  activity?: Activity;
}

export type ColorRef =
  | 'block'
  | 'accent'
  | 'constellation'
  | 'mesh'
  | 'alert'
  | 'watch'
  | 'cumulus'
  | 'nimbus'
  | 'stratus'
  | 'shock'
  | 'shockHot'
  | 'aim'
  | 'install'
  | 'risk'
  | 'emission'
  | 'mine'
  | 'off';

export class Fx {
  /** Engine clock, seconds. Updated by the engine each frame. */
  time = 0;
  /** cos of the horizon angle for the current camera distance (nodes beyond are hidden). */
  horizonCos = 0.3;
  readonly camDir = new THREE.Vector3(0, 0, 1);
  reduced = false;
  /** True while the moon follows the camera: the relay draws screen-space beams; in the sky it draws world-space rays. */
  companion = true;
  private readonly cb = new Float32Array(9);
  private waveIdx = 0;
  private readonly waveT = new Float32Array(4).fill(-1);
  private readonly waveDur = new Float32Array(4).fill(1.6);

  constructor(private readonly t: FxTargets) {}

  // ---- helpers ----------------------------------------------------------------------------

  /** Is the node on the camera-facing side of the planet (with a little margin)? */
  visible(slot: number): boolean {
    const d = this.t.store.dir;
    const c = this.camDir;
    const dot = d[slot * 3]! * c.x + d[slot * 3 + 1]! * c.y + d[slot * 3 + 2]! * c.z;
    return dot > this.horizonCos - 0.05;
  }

  color(ref: ColorRef, out: THREE.Color = _c): THREE.Color {
    const u = this.t.u;
    switch (ref) {
      case 'block':
        return out.copy(u.uBlock.value);
      case 'accent':
        return out.copy(u.uAccent.value);
      case 'constellation':
        return out.copy(u.uConstellation.value);
      case 'mesh':
        return out.copy(u.uMesh.value);
      case 'alert':
        return out.copy(u.uAlert.value);
      case 'watch':
        return out.copy(u.uWatch.value);
      case 'shock':
        return out.copy(u.uShock.value);
      case 'shockHot':
        return out.copy(u.uShockHot.value);
      case 'aim':
        return out.copy(u.uAim.value);
      case 'install':
        return out.copy(u.uInstall.value);
      case 'risk':
        return out.copy(u.uRisk.value);
      case 'emission':
        return out.copy(u.uEmission.value);
      case 'mine':
        return out.copy(u.uMine.value);
      case 'off':
        return out.copy(u.uOff.value);
      case 'cumulus':
        return out.copy(u.uTierColor.value[1]!);
      case 'nimbus':
        return out.copy(u.uTierColor.value[2]!);
      default:
        return out.copy(u.uTierColor.value[3]!);
    }
  }

  tierColor(tier: number, out: THREE.Color = _c): THREE.Color {
    return out.copy(this.t.u.uTierColor.value[tier >= 1 && tier <= 3 ? tier : 0]!);
  }

  // ---- node-level -------------------------------------------------------------------------

  /** Brightens a node and emits a small echo ring from it. Decays on the GPU. */
  flash(slot: number, amp: number): void {
    const s = this.t.store;
    const i = slot * 2;
    const age = this.time - s.flash[i]!;
    const cur = age < 3 ? s.flash[i + 1]! * Math.exp(-age * 2.4) : 0;
    s.flash[i] = this.time;
    s.flash[i + 1] = Math.max(amp, cur * 0.6 + amp * 0.6);
    s.markFlash(slot);
    const act = this.t.activity;
    if (act) act.hit(s.dir[slot * 3]!, s.dir[slot * 3 + 1]!, s.dir[slot * 3 + 2]!, amp);
  }

  // ---- rings ------------------------------------------------------------------------------

  ring(
    slot: number,
    kind: number,
    c: THREE.Color,
    maxRad: number,
    dur: number,
    intensity: number,
    seed = 0,
  ): number {
    return this.t.rings.add(slot, kind, this.time, dur, maxRad, c.r, c.g, c.b, intensity, seed);
  }

  /** Ends a long-lived ring early. */
  endRing(i: number, start: number, fade = 0.5): void {
    this.t.rings.end(i, start, this.time, fade);
  }

  /** The design's aim alpha (how strongly a pre-aimed reticle reads). */
  aimAlpha(): number {
    return this.t.u.uAimAlpha.value;
  }

  /** A pixel-sized ring: radius grows from `px0` to `px1` CSS pixels, constant at any zoom. */
  ringPx(
    slot: number,
    kind: number,
    c: THREE.Color,
    px0: number,
    px1: number,
    dur: number,
    intensity: number,
    seed = 0,
    delay = 0,
  ): number {
    return this.t.rings.add(slot, kind, this.time + delay, dur, -px1, c.r, c.g, c.b, intensity, seed, px0);
  }

  ringAt(
    x: number,
    y: number,
    z: number,
    kind: number,
    c: THREE.Color,
    maxRad: number,
    dur: number,
    intensity: number,
  ): number {
    return this.t.rings.addFree(x, y, z, kind, this.time, dur, maxRad, c.r, c.g, c.b, intensity);
  }

  // ---- ribbons ----------------------------------------------------------------------------

  /** A vertical pillar of light above a node. */
  beamUp(
    slot: number,
    c: THREE.Color,
    lift: number,
    dur: number,
    life: number,
    widthPx: number,
    intensity = 1.3,
  ): number {
    return this.t.arcs.add(
      slot,
      slot,
      RibbonStyle.Beam,
      this.time,
      dur,
      life,
      lift,
      widthPx,
      c.r,
      c.g,
      c.b,
      intensity,
    );
  }

  /** A luminous arc between two nodes with a head that flies from A to B over `dur` seconds. */
  arc(
    slotA: number,
    slotB: number,
    c: THREE.Color,
    dur: number,
    life: number,
    widthPx: number,
    intensity = 1.2,
    lift = -1,
    delay = 0,
  ): number {
    return this.t.arcs.add(
      slotA,
      slotB,
      RibbonStyle.Arc,
      this.time + delay,
      dur,
      life,
      lift,
      widthPx,
      c.r,
      c.g,
      c.b,
      intensity,
    );
  }

  /** A payment comet: eased head with a 14% trail, flying A to B over `dur` seconds. */
  comet(
    slotA: number,
    slotB: number,
    c: THREE.Color,
    dur: number,
    widthPx: number,
    intensity: number,
    lift: number,
    delay = 0,
  ): number {
    return this.t.arcs.add(
      slotA,
      slotB,
      RibbonStyle.Comet,
      this.time + delay,
      dur,
      dur + 0.05,
      lift,
      widthPx,
      c.r,
      c.g,
      c.b,
      intensity,
    );
  }

  /** A faint persistent trace along the same route as a comet, so the path stays readable. */
  trace(
    slotA: number,
    slotB: number,
    c: THREE.Color,
    dur: number,
    life: number,
    widthPx: number,
    intensity: number,
    lift: number,
    delay = 0,
  ): number {
    return this.t.arcs.add(
      slotA,
      slotB,
      RibbonStyle.Arc,
      this.time + delay,
      dur,
      life,
      lift,
      widthPx,
      c.r,
      c.g,
      c.b,
      intensity,
    );
  }

  /** Start time of the most recently added arc (for fade-out guards). */
  arcStart(delay = 0): number {
    return this.time + delay;
  }

  /** A gossip packet: a short bright streak travelling from A to B. */
  packet(
    slotA: number,
    slotB: number,
    c: THREE.Color,
    travel: number,
    widthPx = 2.2,
    intensity = 1.3,
    delay = 0,
  ): number {
    return this.t.packets.add(
      slotA,
      slotB,
      RibbonStyle.Packet,
      this.time + delay,
      travel,
      travel + 0.3,
      -1,
      widthPx,
      c.r,
      c.g,
      c.b,
      intensity,
    );
  }

  /** Packet with raw rgb, for hot paths that keep their own color. */
  packetRaw(
    slotA: number,
    slotB: number,
    r: number,
    g: number,
    b: number,
    travel: number,
    widthPx: number,
    intensity: number,
  ): number {
    return this.t.packets.add(
      slotA,
      slotB,
      RibbonStyle.Packet,
      this.time,
      travel,
      travel + 0.3,
      -1,
      widthPx,
      r,
      g,
      b,
      intensity,
    );
  }

  // ---- moon rays --------------------------------------------------------------------------

  /** Slot id of one of the moon's anchors (0..3 pieces, 4 the center), for `ray`. */
  moonAnchor(k: number): number {
    return ANCHOR_BASE + k;
  }

  /**
   * A beam between two endpoints (node slots or moon anchors): a bright head flies from A to B over
   * `dur` seconds and leaves the conduit lit behind it until `life`. The color runs from `a` at the
   * start to `b` at the end.
   */
  ray(
    slotA: number,
    slotB: number,
    a: THREE.Color,
    b: THREE.Color,
    dur: number,
    life: number,
    widthPx: number,
    intensity: number,
    delay = 0,
  ): number {
    return this.t.rays.add(
      slotA,
      slotB,
      RayKind.Beam,
      this.time + delay,
      dur,
      life,
      widthPx,
      a.r,
      a.g,
      a.b,
      b.r,
      b.g,
      b.b,
      intensity,
    );
  }

  /** A faint dashed guide line (the pre-aim from the moon to a payee). */
  guide(
    slotA: number,
    slotB: number,
    a: THREE.Color,
    b: THREE.Color,
    dur: number,
    life: number,
    widthPx: number,
    intensity: number,
    delay = 0,
  ): number {
    return this.t.rays.add(
      slotA,
      slotB,
      RayKind.Guide,
      this.time + delay,
      dur,
      life,
      widthPx,
      a.r,
      a.g,
      a.b,
      b.r,
      b.g,
      b.b,
      intensity,
    );
  }

  endRay(i: number, start: number, fade = 0.6): void {
    if (this.t.rays.isActive(i, start)) this.t.rays.fadeOut(i, this.time, fade);
  }

  // ---- the moon relay (design 6.4 I, 7.10.5) --------------------------------------------------

  /** Writes a color's display-referred sRGB triple into `cb`, mixed toward white by `white`. */
  private put(c: THREE.Color, o: number, white = 0): void {
    c.getRGB(_rgb, THREE.SRGBColorSpace);
    this.cb[o] = _rgb.r + (1 - _rgb.r) * white;
    this.cb[o + 1] = _rgb.g + (1 - _rgb.g) * white;
    this.cb[o + 2] = _rgb.b + (1 - _rgb.b) * white;
  }

  /**
   * The uplink: a lifted arc from the producer up to the moon. A white head with a Blue Wave trail
   * (30% of the path) flies for `travel` seconds, ease-in-out, bulging 22% away from the planet.
   */
  uplink(producer: number, delay: number, travel: number): void {
    const red = this.reduced;
    if (this.companion) {
      this.put(this.t.u.uShock.value, 0);
      this.put(this.t.u.uShock.value, 3, 0.4);
      this.cb[6] = this.cb[7] = this.cb[8] = 1;
      this.t.beams.add(
        producer,
        ANCHOR_BASE + 4,
        BeamKind.Beam,
        this.time + delay,
        red ? 0.38 : travel,
        (red ? 0.38 : travel) + (red ? 0.5 : 0.52),
        red ? BeamEase.Static : BeamEase.InOut,
        0.22,
        0.1,
        0,
        0.3,
        0,
        red ? 6 : 13,
        red ? 3 : 5.8,
        red ? 1.4 : 2.6,
        1,
        this.cb,
      );
      return;
    }
    this.color('block', _c);
    this.ray(producer, this.moonAnchor(0), _c, _tint, travel + 0.3, travel + 2.0, 2.8, 1.6, delay);
  }

  /**
   * A downlink: from a moon piece to a payee, in the tier color (tier, 22% toward white, 60% toward
   * white). It leaves the moon fast and settles onto the node (ease-out-cubic), bulging 16%.
   */
  downlink(piece: number, slot: number, tier: THREE.Color, delay: number, travel: number): void {
    const red = this.reduced;
    if (this.companion) {
      this.put(tier, 0);
      this.put(tier, 3, 0.22);
      this.put(tier, 6, 0.6);
      this.t.beams.add(
        ANCHOR_BASE + piece,
        slot,
        BeamKind.Beam,
        this.time + delay,
        red ? 0.42 : travel,
        (red ? 0.42 : travel) + 0.6,
        red ? BeamEase.Static : BeamEase.OutCubic,
        0.16,
        0,
        0.025,
        0.28,
        0,
        red ? 6 : 12,
        red ? 3 : 5.4,
        red ? 1.4 : 2.3,
        1,
        this.cb,
      );
      return;
    }
    this.color('shockHot', _c);
    this.ray(this.moonAnchor(piece), slot, _c, tier, travel, travel + 1.4, 2.3, 1.8, delay);
  }

  /**
   * The moon's pre-aim: a faint dotted line from a piece to a payee who is known one block ahead.
   * It brightens from 12% to 42% over the last 5 s before `etaAt` (engine seconds). Returns a handle
   * for `endGuide`, or -1.
   */
  aimGuide(piece: number, slot: number, tier: THREE.Color, life: number, etaAt: number): number {
    if (this.companion) {
      this.put(tier, 0);
      this.put(tier, 3);
      this.put(tier, 6);
      const i = this.t.beams.add(
        ANCHOR_BASE + piece,
        slot,
        BeamKind.Guide,
        this.time,
        1,
        life,
        BeamEase.InOut,
        0.14,
        0,
        0,
        0,
        etaAt,
        1,
        1,
        1,
        1,
        this.cb,
      );
      return i < 0 ? -1 : i + BEAM_HANDLE;
    }
    this.color('shockHot', _c);
    return this.guide(this.moonAnchor(piece), slot, _c, tier, 1.6, life, 1.2, 0.34 * this.aimAlpha());
  }

  endGuide(handle: number, start: number, fade = 0.5): void {
    if (handle >= BEAM_HANDLE) {
      const i = handle - BEAM_HANDLE;
      if (this.t.beams.isActive(i, start)) this.t.beams.fadeOut(i, this.time, fade);
    } else if (handle >= 0) this.endRay(handle, start, fade);
  }

  // ---- global -----------------------------------------------------------------------------

  /**
   * Launches a shockwave across the surface from a unit direction: an ease-out-cubic front that
   * reaches `reach` radians after `dur` seconds (the design's Beat: 62 degrees in 1.7 s). `delay`
   * starts it later (the reward-cut block's second ring follows the first by 400 ms).
   */
  waveFrom(x: number, y: number, z: number, strength: number, reach = 1.0821, dur = 1.7, delay = 0): void {
    // Reduced motion: no shockwave (design 7.10.5).
    if (this.reduced) return;
    const i = this.waveIdx;
    this.waveIdx = (this.waveIdx + 1) & 3;
    const u = this.t.u;
    u.uWave.value[i]!.set(x, y, z, this.time + delay);
    u.uWaveP.value[i]!.set(reach, dur, strength, 0.01);
    this.waveT[i] = this.time + delay;
    this.waveDur[i] = dur;
  }

  /** Retires finished waves and keeps every front a constant screen width (radians per CSS pixel at the near surface). */
  updateWaves(): void {
    const u = this.t.u;
    const radPerPx =
      (Math.max(0.02, this.t.rig.distance - 1) * u.uPxScale.value) / Math.max(1, u.uProjScale.value);
    u.uRevealPx.value = radPerPx;
    for (let i = 0; i < 4; i++) {
      if (this.waveT[i]! < 0) continue;
      const age = this.time - this.waveT[i]!;
      if (age > this.waveDur[i]! + 0.05) {
        this.waveT[i] = -1;
        u.uWave.value[i]!.w = -1;
        continue;
      }
      u.uWaveP.value[i]!.w = radPerPx;
    }
  }

  shake(amount: number): void {
    if (!this.reduced) this.t.rig.addShake(amount);
  }

  nodeDir(slot: number, out: { x: number; y: number; z: number }): void {
    const d = this.t.store.dir;
    out.x = d[slot * 3]!;
    out.y = d[slot * 3 + 1]!;
    out.z = d[slot * 3 + 2]!;
  }

  get noCluster(): number {
    return NO_CLUSTER;
  }
}

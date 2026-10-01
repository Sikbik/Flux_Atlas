// The chain: the moon leaves a small hexagon on its orbit for every block it seals, so the orbit carries
// the recent history of the real chain: one bead per real block, placed at the moon's angle at the moment
// of the seal. Nothing here is decoration; a bead exists because a block was sealed.
//
// The orbit itself is never drawn. Motion is implied by two things:
//
//   the wake   a comet's tail, not an orbit segment: it starts at the moon's trailing edge (not behind the whole
//              mark), is brightest and widest right there and thins hard to nothing about 26 degrees back
//              (DPR-aware, from the moon's own on-screen size). A thin white-hot core inside a Flux blue
//              body inside a soft glow. A slow shimmer of light flows backward along it, and when a block is
//              sealed a pulse of light runs down its length.
//   the beads  tiny glowing hexagons, one per sealed block. Born with a white flash, they fall back
//              behind the moon with a slight tumble, cooling from white to Flux blue and fading like
//              embers. Never evenly spaced (each block has its own size, scatter and fall) and never a
//              ring: at most a handful are alive at once.
//
// The ribbon is real screen-space geometry (the vertex shader widens it in pixels from the moon's size on
// screen); the beads are camera-facing quads with an analytic hexagon outline. Both fade to nothing before
// the planet's limb hides them, so nothing is cut by the depth test. Everything is CPU-filled every frame
// (a dozen beads, a wake of a few dozen vertices) and never allocates.

import * as THREE from 'three';
import { clamp, smoothstep } from '../math';
import type { SharedUniforms } from '../uniforms';

const MAX_BEADS = 24;
const BLUE = '#2B61D1';
const BLUE_LIGHT = '#86A1DA';

export interface ChainBlock {
  height: number;
  /** UTC milliseconds the block was sealed (places the bead at the moon's angle at that moment). */
  time: number;
}

/** A stable 0..1 hash of a block height: each bead's own size, scatter and tumble. */
export function beadHash(height: number, salt: number): number {
  let x = (Math.imul(height | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/** How far a bead of this age has fallen back behind its seal angle, radians of orbit: quick at first, settling. */
export function beadDrag(age: number): number {
  return 0.13 * (1 - Math.exp(-age / 42));
}

/**
 * How far an ember has been kicked out of the moon, 0 at birth to 1 once it is clear of the body (a second and a half,
 * decelerating). A bead born at the moon's centre would sit behind its blocks for ten seconds, a fragment of a hexagon
 * between two pieces; this carries it out into the wake while its flash is still bright.
 */
export function beadKick(age: number): number {
  const t = clamp(age / 1.5, 0, 1);
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/** The bead's tumble in the screen plane, radians: it turns a little as it is born, then settles. */
export function beadTumble(seed: number, age: number): number {
  return (seed - 0.5) * 0.9 + 0.8 * (seed > 0.5 ? 1 : -1) * (1 - Math.exp(-age / 14));
}

const easeOutBack = (t: number): number => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// ---- the beads -----------------------------------------------------------------------------------------

const BEAD_VERT = /* glsl */ `
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uSize;
in vec3 aPos;
in vec4 aFx;     // alpha, birth flash, age 0..1, tumble (radians)
in vec2 aSeed;   // size factor, hash
out vec2 vP;
out vec4 vFx;
out float vVis;
void main() {
  float s = uSize * aSeed.x * (1.0 + 0.5 * aFx.y) * mix(1.0, 0.55, aFx.z);
  float cr = cos(aFx.w);
  float sr = sin(aFx.w);
  vP = vec2(cr * position.x + sr * position.y, -sr * position.x + cr * position.y) * 1.5;
  vFx = aFx;
  vec3 w = aPos + (uCamRight * position.x + uCamUp * position.y) * s * 1.5;
  // Behind the planet's limb the bead has faded out before the depth test would cut it.
  vec3 D = aPos - cameraPosition;
  float tt = clamp(-dot(cameraPosition, D) / max(dot(D, D), 1e-4), 0.0, 1.0);
  vVis = smoothstep(1.0, 1.07, length(cameraPosition + D * tt));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const BEAD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColorHi;
in vec2 vP;
in vec4 vFx;
in float vVis;
// Distance in a pointy-top hexagon of circumradius 1.
float hexSdf(vec2 p) {
  p = abs(p);
  return max(p.x, dot(p, vec2(0.5, 0.8660254))) - 0.8660254;
}
void main() {
  float d = hexSdf(vP);
  float px = fwidth(d) + 1e-4;                       // one pixel in glyph units
  float age = vFx.z;
  // The outline: a line a little over a pixel wide at any size, thinner as the bead ages.
  float lw = max(0.1 * (1.0 - 0.45 * age), 1.35 * px);
  float stroke = 1.0 - smoothstep(0.0, px * 1.2, abs(d + lw * 0.5) - lw * 0.5);
  // A second, smaller hexagon inside it, and a soft core: a block within the block.
  float d2 = hexSdf(vP * 2.1) / 2.1;
  float inner = (1.0 - smoothstep(0.0, px * 1.2, abs(d2 + lw * 0.35) - lw * 0.3)) * 0.45;
  float core = exp(-dot(vP, vP) * 7.0);
  float halo = exp(-dot(vP, vP) * 2.2) * 0.18;
  float fl = vFx.y;
  // Hot white at birth, Flux light blue after, Flux blue as it dies.
  vec3 hue = mix(uColorHi, uColor, smoothstep(0.1, 0.9, age));
  vec3 col = hue * (stroke * 1.35 + inner + core * 0.55 + halo) * vFx.x;
  col += vec3(1.0) * (stroke * 0.9 + inner * 0.5 + core * 1.2) * fl * 1.5;
  col *= vVis;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the wake ------------------------------------------------------------------------------------------

// A camera-facing ribbon whose width is set in pixels from the moon's size on screen, so it reads the same
// at any distance and device pixel ratio, and thins to nothing along its length.
const WAKE_VERT = /* glsl */ `
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uHeadW;      // half width at the moon, world units
uniform vec2 uWidthPx;     // clamp of the head's half width, CSS px (min, max)
in vec3 aPrev;
in vec3 aNext;
in vec2 aSU;   // side (-1, 1), position along the wake (0 at the moon, 1 at the tail)
out vec3 vSU;  // side, along, energy (thin parts keep their light when widened to a pixel)
out float vVis;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vec4 ca = projectionMatrix * viewMatrix * vec4(aNext, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(aPrev, 1.0);
  vec2 d = (ca.xy / max(ca.w, 1e-3) - cb.xy / max(cb.w, 1e-3)) * uViewport * 0.5;
  float len = length(d);
  vec2 dirS = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirS.y, dirS.x);
  float u = aSU.y;
  float head = clamp(uHeadW * uProjScale / max(c.w, 1e-3), uWidthPx.x * uPxScale, uWidthPx.y * uPxScale);
  float w = head * pow(max(1.0 - u, 0.0), 1.5);
  float wEff = max(w, 1.6 * uPxScale);
  gl_Position = c;
  gl_Position.xy += perp * aSU.x * wEff * 2.0 / uViewport * c.w;
  vSU = vec3(aSU, clamp(w / wEff, 0.0, 1.0));
  // Fade out before the planet's limb would hide the ribbon.
  vec3 D = position - cameraPosition;
  float tt = clamp(-dot(cameraPosition, D) / max(dot(D, D), 1e-4), 0.0, 1.0);
  vVis = smoothstep(1.0, 1.07, length(cameraPosition + D * tt));
}`;

const WAKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uTime;
uniform float uPulse;     // seconds since the last seal (negative: none)
uniform float uMotion;    // 0 under reduced motion
in vec3 vSU;
in float vVis;
void main() {
  float a = abs(vSU.x);
  float u = vSU.y;
  // Across: a thin hot core, a Flux light blue body, a soft glow that dies before the ribbon's edge.
  float core = exp(-a * a / 0.03);
  float body = exp(-a * a / 0.14);
  float glow = exp(-a * a / 0.6) * (1.0 - smoothstep(0.6, 1.0, a));
  // Along: brightest at the moon's trailing edge, thinning hard to nothing; a slow shimmer of light flows backward.
  float taper = pow(max(1.0 - u, 0.0), 2.8) * smoothstep(0.0, 0.07, u);
  float flow = 1.0 + 0.35 * uMotion * sin(6.2831853 * (u * 1.8 - uTime * 0.5)) * (0.3 + 0.7 * u);
  // On a seal a pulse of light runs down the wake.
  float pu = clamp(uPulse / 0.9, 0.0, 1.0);
  float pulse = uPulse >= 0.0 ? exp(-pow((u - pu * 0.9) / 0.1, 2.0)) * (1.0 - smoothstep(0.55, 1.0, pu)) : 0.0;
  float k = taper * flow * vSU.z * vVis * uAlpha;
  vec3 col = vec3(1.0) * core * (1.7 * pow(max(1.0 - u, 0.0), 2.2) + pulse * 1.3);
  col += uColor * body * (0.5 + pulse * 0.7);
  col += uColor2 * glow * 0.55;
  col += vec3(1.0) * glow * pulse * 0.2;
  gl_FragColor = vec4(col * k, 1.0);
}`;

/** Length of the wake along the orbit from its root at the moon's trailing edge, radians (about 26 degrees). */
const WAKE_RAD = 0.46;
const WAKE_SEGMENTS = 56;

interface Bead {
  /** Angle on the sky orbit (world mode). */
  theta: number;
  /** Angle on the companion's ellipse (screen mode). */
  phase: number;
  birth: number;
  height: number;
  /** Per-bead size factor (0.78 to 1.18) and a second hash for its scatter and tumble. */
  sizeK: number;
  seed: number;
}

export class MoonChain {
  readonly group = new THREE.Group();
  enabled = true;
  /** False while the moon follows the camera: the chain keeps recording but is not drawn. */
  shown = true;
  /** Seconds a bead lives: it shrinks and fades over this long (the moon sets it from the orbit's period). */
  life = 168;
  private readonly beads: Bead[] = [];
  private readonly pos = new Float32Array(MAX_BEADS * 3);
  private readonly fx = new Float32Array(MAX_BEADS * 4);
  private readonly seedA = new Float32Array(MAX_BEADS * 2);
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly fxAttr: THREE.InstancedBufferAttribute;
  private readonly seedAttr: THREE.InstancedBufferAttribute;
  private readonly beadGeom = new THREE.InstancedBufferGeometry();
  private readonly beadMat: THREE.ShaderMaterial;
  private readonly _c = new THREE.Vector3();
  private readonly _o = new THREE.Vector3();
  private readonly _n = new THREE.Vector3();
  private readonly wakeGeom = new THREE.BufferGeometry();
  private readonly wakeMat: THREE.ShaderMaterial;
  private readonly wakePos = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakePrev = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakeNext = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakeAttrs: THREE.BufferAttribute[] = [];
  private readonly wakeMesh: THREE.Mesh;
  /** The newest bead's birth flash, 0..1 (for `flash`). */
  private lastFlash = 0;

  constructor(u: SharedUniforms) {
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.beadGeom.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.beadGeom.setIndex([0, 1, 2, 0, 2, 3]);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.fxAttr = new THREE.InstancedBufferAttribute(this.fx, 4);
    this.seedAttr = new THREE.InstancedBufferAttribute(this.seedA, 2);
    for (const a of [this.posAttr, this.fxAttr, this.seedAttr]) a.setUsage(THREE.DynamicDrawUsage);
    this.beadGeom.setAttribute('aPos', this.posAttr);
    this.beadGeom.setAttribute('aFx', this.fxAttr);
    this.beadGeom.setAttribute('aSeed', this.seedAttr);
    this.beadGeom.instanceCount = 0;
    this.beadMat = new THREE.ShaderMaterial({
      vertexShader: BEAD_VERT,
      fragmentShader: BEAD_FRAG,
      uniforms: {
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
        uSize: { value: 0.045 },
        uColor: { value: new THREE.Color(BLUE) },
        uColorHi: { value: new THREE.Color(BLUE_LIGHT) },
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Additive light never touches alpha: the moon's exempt mask (see post.ts) lives there.
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beads = new THREE.Mesh(this.beadGeom, this.beadMat);
    beads.frustumCulled = false;
    beads.renderOrder = 11;

    // The wake: two vertices per sample (one per side), a strip of indexed triangles.
    const su = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k <= WAKE_SEGMENTS; k++) {
      su.set([-1, k / WAKE_SEGMENTS], k * 4);
      su.set([1, k / WAKE_SEGMENTS], k * 4 + 2);
      if (k < WAKE_SEGMENTS) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const mk = (name: string, arr: Float32Array, size: number, dynamic: boolean): void => {
      const at = new THREE.BufferAttribute(arr, size);
      if (dynamic) {
        at.setUsage(THREE.DynamicDrawUsage);
        this.wakeAttrs.push(at);
      }
      this.wakeGeom.setAttribute(name, at);
    };
    mk('position', this.wakePos, 3, true);
    mk('aPrev', this.wakePrev, 3, true);
    mk('aNext', this.wakeNext, 3, true);
    mk('aSU', su, 2, false);
    this.wakeGeom.setIndex(idx);
    this.wakeMat = new THREE.ShaderMaterial({
      vertexShader: WAKE_VERT,
      fragmentShader: WAKE_FRAG,
      uniforms: {
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uTime: u.uTime,
        uHeadW: { value: 0.1 },
        uWidthPx: { value: new THREE.Vector2(2.2, 8) },
        uColor: { value: new THREE.Color(BLUE_LIGHT) },
        uColor2: { value: new THREE.Color(BLUE) },
        uAlpha: { value: 1 },
        uPulse: { value: -1 },
        uMotion: { value: 1 },
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Additive light never touches alpha: the moon's exempt mask (see post.ts) lives there.
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wakeMesh = new THREE.Mesh(this.wakeGeom, this.wakeMat);
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.renderOrder = 11;
    this.wakeMesh.visible = false;
    this.group.add(beads, this.wakeMesh);
  }

  get count(): number {
    return this.beads.length;
  }

  /** The beads, oldest first, for hosts that want to label them. */
  blocks(): readonly { height: number; theta: number; birth: number }[] {
    return this.beads;
  }

  private make(theta: number, phase: number, birth: number, height: number): Bead {
    return { theta, phase, birth, height, sizeK: 0.78 + 0.4 * beadHash(height, 1), seed: beadHash(height, 2) };
  }

  /** A block was sealed: drop a bead at the moon's current angles (sky orbit and companion ellipse). `now` is the engine clock in seconds. */
  add(theta: number, phase: number, height: number, now: number): void {
    this.beads.push(this.make(theta, phase, now, height));
    if (this.beads.length > MAX_BEADS) this.beads.shift();
  }

  /** The chain took another road: the newest `n` beads come off the orbit. */
  drop(n: number): void {
    this.beads.length = Math.max(0, this.beads.length - Math.max(0, n));
  }

  /**
   * Seeds the chain from recent history: each block lands at the moon's angle at its own time.
   * `angleAt` maps UTC milliseconds to a sky-orbit angle and `phaseAt` to a companion-ellipse angle;
   * `nowMs`/`now` tie wall time to the engine clock.
   */
  seed(blocks: readonly ChainBlock[], angleAt: (ms: number) => number, phaseAt: (ms: number) => number, nowMs: number, now: number): void {
    this.beads.length = 0;
    const sorted = [...blocks].sort((a, b) => a.time - b.time).slice(-MAX_BEADS);
    for (const b of sorted) this.beads.push(this.make(angleAt(b.time), phaseAt(b.time), now - (nowMs - b.time) / 1000, b.height));
  }

  /**
   * The beads as the companion draws them (design 7.10.3), eight floats each: the angle on the ellipse
   * (already fallen back by its drag), its age as a fraction of `lifeS` (0 fresh, 1 gone), the birth flash
   * (1 to 0 over about 1.5 s), the radius in CSS pixels (small, settling smaller as it ages), then the
   * tumble (radians), the scatter off the path (-1..1), the size hash and the age in seconds. Returns how
   * many were written (at most `max`). Beads older than their life are skipped.
   */
  companionBeads(now: number, lifeS: number, out: Float32Array, max: number): number {
    const B = this.beads;
    let n = 0;
    for (let i = 0; i < B.length && n < max; i++) {
      const age = now - B[i].birth;
      if (age > lifeS) continue;
      const f = age / lifeS;
      const fl = Math.exp(-Math.max(age, 0) / 0.8);
      const o = n * 8;
      // The companion lap is shorter than the sky's: scale the fall-back to the lap's share of the orbit.
      out[o] = B[i].phase - beadDrag(age * (210 / Math.max(lifeS, 1)));
      out[o + 1] = f;
      out[o + 2] = fl;
      out[o + 3] = (5.2 + 2.6 * fl) * B[i].sizeK * (1 - 0.45 * smoothstep(0, 1, f));
      out[o + 4] = beadTumble(B[i].seed, age);
      out[o + 5] = (beadHash(B[i].height, 3) - 0.5) * 2;
      out[o + 6] = B[i].seed;
      out[o + 7] = age;
      n++;
    }
    return n;
  }

  clear(): void {
    this.beads.length = 0;
    this.beadGeom.instanceCount = 0;
    this.wakeMesh.visible = false;
  }

  /**
   * Fills the buffers for this frame. `e1`/`e2` are the orbit's basis, `orbit` its radius, `moonTheta` the
   * moon's angle. `wakeA` scales the wake (it brightens when a block is sealed), `pulse` is the time since
   * the last seal in seconds (negative: none) and `motion` is 0 under reduced motion; `alpha` fades the whole
   * trail (the moon lifting into the sky, or returning to the camera; the wake, which is attached to the mark, only
   * shows over the last 28% of that).
   */
  update(now: number, e1: THREE.Vector3, e2: THREE.Vector3, orbit: number, moonTheta: number, moonSize: number, wakeA = 1, alpha = 1, pulse = -1, motion = 1): void {
    const show = this.enabled && this.shown;
    this.group.visible = show;
    if (!show) {
      this.beadGeom.instanceCount = 0;
      this.wakeMesh.visible = false;
      return;
    }
    this.beadMat.uniforms.uSize.value = moonSize * 0.078; // a bead is about a seventh of the moon's height across (a fifth at birth)
    let nb = 0;
    const life = this.life;
    const B = this.beads;
    // Drop the beads that have lived out their time.
    while (B.length > 0 && now - B[0].birth > life) B.shift();
    // Never more than a handful: the freshest few carry the light, the rest are already embers.
    const visOf = (age: number): number => 1 - smoothstep(0.12 * life, life, age);
    let newest = 0;
    const kickRad = (0.62 * moonSize) / orbit;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const age = Math.max(0, now - b.birth);
      const f = clamp(age / life, 0, 1);
      // A bead is born with a pop (it grows in with a little overshoot) and a white flash that cools.
      const appear = motion > 0 ? easeOutBack(clamp(age / 0.32, 0, 1)) : smoothstep(0, 0.3, age);
      const a = visOf(age) * alpha * smoothstep(0, 0.12, age);
      const flash = Math.exp(-age / 0.9) * alpha;
      newest = Math.max(newest, flash);
      // It falls back along the orbit, slowing down, and drifts a little off the path (an ember, not a bead on a string).
      const th = b.theta - beadDrag(age) - kickRad * (motion > 0 ? beadKick(age) : 1);
      this.point(th, e1, e2, orbit, this._c);
      this._o.copy(this._c).normalize();
      this._n.copy(e1).cross(e2).normalize();
      const scatter = (b.seed - 0.5) * 2 * (0.1 + 0.5 * f) * moonSize * 0.3;
      const lift = (beadHash(b.height, 3) - 0.5) * 2 * (0.1 + 0.5 * f) * moonSize * 0.3;
      this._c.addScaledVector(this._n, scatter).addScaledVector(this._o, lift);
      this.pos[nb * 3] = this._c.x;
      this.pos[nb * 3 + 1] = this._c.y;
      this.pos[nb * 3 + 2] = this._c.z;
      this.fx[nb * 4] = a;
      this.fx[nb * 4 + 1] = flash;
      this.fx[nb * 4 + 2] = f;
      this.fx[nb * 4 + 3] = beadTumble(b.seed, age) * motion;
      this.seedA[nb * 2] = b.sizeK * appear;
      this.seedA[nb * 2 + 1] = b.seed;
      nb++;
    }
    this.lastFlash = newest;
    this.beadGeom.instanceCount = nb;
    this.posAttr.needsUpdate = true;
    this.fxAttr.needsUpdate = true;
    this.seedAttr.needsUpdate = true;

    // The wake: a tapering ribbon behind the moon along the orbit. It starts at the moon's body (which
    // hides its root) and runs `WAKE_RAD` back. It belongs to the moon: while the mark is still flying in from the
    // companion's place (or back to it) it would hang at the mark's destination, so it only shows over the last of the blend.
    const wakeAlpha = wakeA * smoothstep(0.72, 1, alpha);
    this.wakeMesh.visible = wakeAlpha > 0.002;
    const wu = this.wakeMat.uniforms;
    wu.uAlpha.value = wakeAlpha;
    wu.uPulse.value = motion > 0 ? pulse : -1;
    wu.uMotion.value = motion;
    wu.uHeadW.value = moonSize * 0.07;
    // The root sits at the moon's trailing edge: the pieces hide its first few percent, and nothing of it crosses the mark.
    const start = (0.42 * moonSize) / orbit;
    const P = this.wakePos;
    for (let k = 0; k <= WAKE_SEGMENTS; k++) {
      const th = moonTheta - start - (WAKE_RAD * k) / WAKE_SEGMENTS;
      this.point(th, e1, e2, orbit, this._c);
      const o = k * 6;
      P[o] = P[o + 3] = this._c.x;
      P[o + 1] = P[o + 4] = this._c.y;
      P[o + 2] = P[o + 5] = this._c.z;
    }
    for (let k = 0; k <= WAKE_SEGMENTS; k++) {
      // The path runs back in time as k grows; the ribbon only needs a consistent tangent.
      const kp = Math.max(0, k - 1);
      const kn = Math.min(WAKE_SEGMENTS, k + 1);
      const o = k * 6;
      for (let j = 0; j < 3; j++) {
        this.wakePrev[o + j] = this.wakePrev[o + 3 + j] = P[kp * 6 + j];
        this.wakeNext[o + j] = this.wakeNext[o + 3 + j] = P[kn * 6 + j];
      }
    }
    for (const at of this.wakeAttrs) at.needsUpdate = true;
  }

  private point(theta: number, e1: THREE.Vector3, e2: THREE.Vector3, r: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(theta) * r;
    const s = Math.sin(theta) * r;
    return out.set(e1.x * c + e2.x * s, e1.y * c + e2.y * s, e1.z * c + e2.z * s);
  }

  /** Brightness helper for hosts (0 = no chain activity, 1 = a fresh seal). */
  get flash(): number {
    return clamp(this.lastFlash, 0, 1);
  }

  dispose(): void {
    this.beadGeom.dispose();
    this.beadMat.dispose();
    this.wakeGeom.dispose();
    this.wakeMat.dispose();
  }
}

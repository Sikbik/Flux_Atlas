// The chain: the moon leaves a small hexagon on its orbit for every block it seals, so the orbit carries
// the recent history of the real chain: one bead per real block, spaced by real time (the moon's angle
// at the moment of the seal), shrinking and fading as the block ages until it is gone. Nothing here is
// decoration; a bead exists because a block was sealed.
//
// The orbit itself is never drawn. Motion is implied: the moon trails a short tapering wake (a thin
// additive ribbon, about 28 degrees of the path, fading to nothing) and the beads fall back along the
// path behind it, shrinking and fading until they are gone.
//
// Beads are flat hexagons (the symbol's own shape) drawn as billboards in Flux blue with a white flash
// at birth. Both draw calls are CPU-filled every frame (a dozen beads, a wake of a few dozen vertices)
// and never allocate.

import * as THREE from 'three';
import { clamp, smoothstep } from '../math';
import type { SharedUniforms } from '../uniforms';

const MAX_BEADS = 24;
const BLUE = '#2B61D1';

export interface ChainBlock {
  height: number;
  /** UTC milliseconds the block was sealed (places the bead at the moon's angle at that moment). */
  time: number;
}

const BEAD_VERT = /* glsl */ `
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uSize;
in vec3 aPos;
in vec3 aFx;   // alpha, flash, age 0..1
out vec2 vP;
out vec3 vFx;
void main() {
  vP = position.xy;
  vFx = aFx;
  float s = uSize * (1.0 + 0.9 * aFx.y) * mix(1.0, 0.5, aFx.z);
  vec3 w = aPos + (uCamRight * position.x + uCamUp * position.y) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const BEAD_FRAG = /* glsl */ `
uniform vec3 uColor;
in vec2 vP;
in vec3 vFx;
// Distance in a pointy-top hexagon of circumradius 1.
float hexSdf(vec2 p) {
  p = abs(p);
  return max(p.x, dot(p, vec2(0.5, 0.8660254))) - 0.8660254;
}
void main() {
  float d = hexSdf(vP);
  float aa = fwidth(d) * 1.2 + 1e-3;
  float ring = smoothstep(-0.2 - aa, -0.2, d) * (1.0 - smoothstep(-0.02, -0.02 + aa, d));
  float fill = (1.0 - smoothstep(-0.02, -0.02 + aa, d)) * 0.16;
  float core = exp(-dot(vP, vP) * 9.0) * 0.5;
  float a = vFx.x;
  vec3 col = uColor * (ring * 1.5 + fill + core * 0.6) * a;
  col += vec3(1.0) * (ring * 0.9 + core) * vFx.y * 1.4;
  gl_FragColor = vec4(col, 1.0);
}`;

// The wake: a camera-facing ribbon of constant pixel width that tapers along its length.
const WAKE_VERT = /* glsl */ `
uniform vec2 uViewport;
uniform float uPxScale;
in vec3 aPrev;
in vec3 aNext;
in vec2 aSU;   // side (-1, 1), position along the wake (0 at the moon, 1 at the tail)
out vec2 vSU;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vec4 ca = projectionMatrix * viewMatrix * vec4(aNext, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(aPrev, 1.0);
  vec2 d = (ca.xy / max(ca.w, 1e-3) - cb.xy / max(cb.w, 1e-3)) * uViewport * 0.5;
  float len = length(d);
  vec2 dirS = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirS.y, dirS.x);
  float widthPx = mix(6.0, 0.8, aSU.y) * uPxScale;
  gl_Position = c;
  gl_Position.xy += perp * aSU.x * widthPx * 2.0 / uViewport * c.w;
  vSU = aSU;
}`;

const WAKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
in vec2 vSU;
void main() {
  float side = abs(vSU.x);
  float u = vSU.y;
  // It emerges from behind the moon and thins out to nothing.
  float fade = pow(1.0 - u, 1.7) * smoothstep(0.0, 0.1, u);
  float core = 1.0 - smoothstep(0.0, 0.32, side);
  float soft = 1.0 - smoothstep(0.1, 1.0, side);
  vec3 col = uColor * (0.55 * core + 0.2 * soft * soft) * fade;
  col += vec3(1.0) * core * 0.4 * pow(1.0 - u, 3.2) * smoothstep(0.0, 0.1, u);
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;

/** Length of the wake along the orbit, radians (about 28 degrees). */
const WAKE_RAD = 0.49;
const WAKE_SEGMENTS = 40;

interface Bead {
  /** Angle on the sky orbit (world mode). */
  theta: number;
  /** Angle on the companion's ellipse (screen mode). */
  phase: number;
  birth: number;
  height: number;
}

export class MoonChain {
  readonly group = new THREE.Group();
  enabled = true;
  /** False while the moon follows the camera: the chain keeps recording but is not drawn. */
  shown = true;
  /** Seconds a bead lives: it shrinks and fades over this long (the moon sets it from the orbit's period). */
  life = 210;
  private readonly beads: Bead[] = [];
  private readonly pos = new Float32Array(MAX_BEADS * 3);
  private readonly fx = new Float32Array(MAX_BEADS * 3);
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly fxAttr: THREE.InstancedBufferAttribute;
  private readonly beadGeom = new THREE.InstancedBufferGeometry();
  private readonly beadMat: THREE.ShaderMaterial;
  private readonly _c = new THREE.Vector3();
  private readonly wakeGeom = new THREE.BufferGeometry();
  private readonly wakeMat: THREE.ShaderMaterial;
  private readonly wakePos = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakePrev = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakeNext = new Float32Array((WAKE_SEGMENTS + 1) * 2 * 3);
  private readonly wakeAttrs: THREE.BufferAttribute[] = [];
  private readonly wakeMesh: THREE.Mesh;

  constructor(u: SharedUniforms) {
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.beadGeom.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.beadGeom.setIndex([0, 1, 2, 0, 2, 3]);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.fxAttr = new THREE.InstancedBufferAttribute(this.fx, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.fxAttr.setUsage(THREE.DynamicDrawUsage);
    this.beadGeom.setAttribute('aPos', this.posAttr);
    this.beadGeom.setAttribute('aFx', this.fxAttr);
    this.beadGeom.instanceCount = 0;
    this.beadMat = new THREE.ShaderMaterial({
      vertexShader: BEAD_VERT,
      fragmentShader: BEAD_FRAG,
      uniforms: {
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
        uSize: { value: 0.045 },
        uColor: { value: new THREE.Color(BLUE) },
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
        uColor: { value: new THREE.Color('#86a1da') },
        uAlpha: { value: 1 },
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

  /** A block was sealed: drop a bead at the moon's current angles (sky orbit and companion ellipse). `now` is the engine clock in seconds. */
  add(theta: number, phase: number, height: number, now: number): void {
    this.beads.push({ theta, phase, birth: now, height });
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
  seed(
    blocks: readonly ChainBlock[],
    angleAt: (ms: number) => number,
    phaseAt: (ms: number) => number,
    nowMs: number,
    now: number,
  ): void {
    this.beads.length = 0;
    const sorted = [...blocks].sort((a, b) => a.time - b.time).slice(-MAX_BEADS);
    for (const b of sorted)
      this.beads.push({
        theta: angleAt(b.time),
        phase: phaseAt(b.time),
        birth: now - (nowMs - b.time) / 1000,
        height: b.height,
      });
  }

  /**
   * The beads as the companion draws them (design 7.10.3): per bead the angle on the ellipse, its age
   * as a fraction of `lifeS` (0 fresh, 1 gone), the birth flash (1 to 0 over 1.1 s) and the radius in
   * CSS pixels (8.4 settling to 5.4 while fresh, shrinking to 2.8 as it ages). Returns how many were
   * written (at most `max`). Beads older than their life are skipped.
   */
  companionBeads(now: number, lifeS: number, out: Float32Array, max: number): number {
    const B = this.beads;
    let n = 0;
    for (let i = 0; i < B.length && n < max; i++) {
      const age = now - B[i]!.birth;
      if (age > lifeS) continue;
      const f = age / lifeS;
      const fl = age < 1.1 ? 1 - age / 1.1 : 0;
      out[n * 4] = B[i]!.phase;
      out[n * 4 + 1] = f;
      out[n * 4 + 2] = fl;
      out[n * 4 + 3] = (5.4 + 3.0 * fl * fl) * (1 - 0.48 * smoothstep(0, 1, f));
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
   * moon's angle. `wakeA` scales the wake (it brightens when a block is sealed); `alpha` fades the whole
   * trail (the moon lifting into the sky, or returning to the camera).
   */
  update(
    now: number,
    e1: THREE.Vector3,
    e2: THREE.Vector3,
    orbit: number,
    moonTheta: number,
    moonSize: number,
    wakeA = 1,
    alpha = 1,
  ): void {
    const show = this.enabled && this.shown;
    this.group.visible = show;
    if (!show) {
      this.beadGeom.instanceCount = 0;
      this.wakeMesh.visible = false;
      return;
    }
    this.beadMat.uniforms.uSize!.value = moonSize * 0.14; // a bead is a little over a quarter of the moon's height across
    let nb = 0;
    const life = this.life;
    const B = this.beads;
    // Drop the beads that have lived out their time.
    while (B.length > 0 && now - B[0]!.birth > life) B.shift();
    const visOf = (age: number): number => 1 - smoothstep(0.2 * life, life, age);
    for (let i = 0; i < B.length; i++) {
      const b = B[i]!;
      const age = now - b.birth;
      const a = visOf(age) * alpha;
      const flash = Math.exp(-age * 0.7) * (age < 6 ? 1 : 0) * alpha;
      this.point(b.theta, e1, e2, orbit, this._c);
      this.pos[nb * 3] = this._c.x;
      this.pos[nb * 3 + 1] = this._c.y;
      this.pos[nb * 3 + 2] = this._c.z;
      this.fx[nb * 3] = a;
      this.fx[nb * 3 + 1] = flash;
      this.fx[nb * 3 + 2] = clamp(age / life, 0, 1);
      nb++;
    }
    this.beadGeom.instanceCount = nb;
    this.posAttr.needsUpdate = true;
    this.fxAttr.needsUpdate = true;

    // The wake: a short tapering ribbon behind the moon along the orbit. It starts just behind the moon's
    // body and runs `WAKE_RAD` back.
    this.wakeMesh.visible = alpha > 0.002;
    this.wakeMat.uniforms.uAlpha!.value = wakeA * alpha;
    const start = (0.5 * moonSize) / orbit;
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
        this.wakePrev[o + j] = this.wakePrev[o + 3 + j] = P[kp * 6 + j]!;
        this.wakeNext[o + j] = this.wakeNext[o + 3 + j] = P[kn * 6 + j]!;
      }
    }
    for (const at of this.wakeAttrs) at.needsUpdate = true;
  }

  private point(
    theta: number,
    e1: THREE.Vector3,
    e2: THREE.Vector3,
    r: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const c = Math.cos(theta) * r;
    const s = Math.sin(theta) * r;
    return out.set(e1.x * c + e2.x * s, e1.y * c + e2.y * s, e1.z * c + e2.z * s);
  }

  /** Brightness helper for hosts (0 = no chain activity, 1 = a fresh seal). */
  get flash(): number {
    return this.beads.length ? clamp(this.fx[(this.beads.length - 1) * 3 + 1]!, 0, 1) : 0;
  }

  dispose(): void {
    this.beadGeom.dispose();
    this.beadMat.dispose();
    this.wakeGeom.dispose();
    this.wakeMat.dispose();
  }
}

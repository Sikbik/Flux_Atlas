// The chain: the moon leaves a small hexagon on its orbit for every block it seals, and a hairline
// joins each one to the last. So the orbit carries the recent history of the real chain: one bead
// per real block, spaced by real time (the moon's angle at the moment of the seal), fading as the
// block ages until the moon comes back around. Nothing here is decoration; a bead exists because a
// block was sealed.
//
// Beads are flat hexagons (the symbol's own shape) drawn as billboards in Flux blue with a white
// flash at birth; links are 1px lines along the orbit. The newest link runs from the last bead to
// the moon itself, so the chain visibly grows as the moon moves.
//
// Both draw calls are CPU-filled every frame (a dozen beads, a few hundred vertices) and never
// allocate.

import * as THREE from 'three';
import { clamp, smoothstep } from '../math';
import type { SharedUniforms } from '../uniforms';

const MAX_BEADS = 24;
const ARC_SEGMENTS = 14;
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
in vec3 aFx;   // alpha, flash, seed
out vec2 vP;
out vec3 vFx;
void main() {
  vP = position.xy;
  vFx = aFx;
  float s = uSize * (1.0 + 0.9 * aFx.y);
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

const LINE_VERT = /* glsl */ `
in float aA;
out float vA;
void main() {
  vA = aA;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
in float vA;
void main() {
  gl_FragColor = vec4(uColor * vA, 1.0);
}`;

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
  /** Seconds a bead lives (one lap of the default orbit and a bit more). */
  life = 460;
  private readonly beads: Bead[] = [];
  private readonly pos = new Float32Array(MAX_BEADS * 3);
  private readonly fx = new Float32Array(MAX_BEADS * 3);
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly fxAttr: THREE.InstancedBufferAttribute;
  private readonly beadGeom = new THREE.InstancedBufferGeometry();
  private readonly beadMat: THREE.ShaderMaterial;
  private readonly lineGeom = new THREE.BufferGeometry();
  private readonly lineMat: THREE.ShaderMaterial;
  private readonly linePos = new Float32Array((MAX_BEADS + 1) * ARC_SEGMENTS * 2 * 3);
  private readonly lineA = new Float32Array((MAX_BEADS + 1) * ARC_SEGMENTS * 2);
  private readonly linePosAttr: THREE.BufferAttribute;
  private readonly lineAAttr: THREE.BufferAttribute;
  private readonly _c = new THREE.Vector3();

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

    this.linePosAttr = new THREE.BufferAttribute(this.linePos, 3);
    this.lineAAttr = new THREE.BufferAttribute(this.lineA, 1);
    this.linePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineAAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineGeom.setAttribute('position', this.linePosAttr);
    this.lineGeom.setAttribute('aA', this.lineAAttr);
    this.lineGeom.setDrawRange(0, 0);
    this.lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: { uColor: { value: new THREE.Color(BLUE) } },
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
    });
    const lines = new THREE.LineSegments(this.lineGeom, this.lineMat);
    lines.frustumCulled = false;
    lines.renderOrder = 11;
    this.group.add(lines, beads);
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
   * CSS pixels (8.4 settling to 5.4). Returns how many were written (at most `max`). Beads older than
   * their life are dropped first.
   */
  companionBeads(now: number, lifeS: number, out: Float32Array, max: number): number {
    const B = this.beads;
    let n = 0;
    for (let i = 0; i < B.length && n < max; i++) {
      const age = now - B[i]!.birth;
      if (age > lifeS) continue;
      const fl = age < 1.1 ? 1 - age / 1.1 : 0;
      out[n * 4] = B[i]!.phase;
      out[n * 4 + 1] = age / lifeS;
      out[n * 4 + 2] = fl;
      out[n * 4 + 3] = 5.4 + 3.0 * fl * fl;
      n++;
    }
    return n;
  }

  clear(): void {
    this.beads.length = 0;
    this.beadGeom.instanceCount = 0;
    this.lineGeom.setDrawRange(0, 0);
  }

  /** Fills the buffers for this frame. `e1`/`e2` are the orbit's basis, `orbit` its radius, `moonTheta` the moon's angle. */
  update(
    now: number,
    e1: THREE.Vector3,
    e2: THREE.Vector3,
    orbit: number,
    moonTheta: number,
    moonSize: number,
  ): void {
    const visible = this.enabled && this.shown && this.beads.length > 0;
    this.group.visible = this.enabled && this.shown;
    if (!visible) {
      this.beadGeom.instanceCount = 0;
      this.lineGeom.setDrawRange(0, 0);
      return;
    }
    this.beadMat.uniforms.uSize!.value = moonSize * 0.14; // a bead is a little over a quarter of the moon's height across
    let nb = 0;
    let nv = 0;
    const life = this.life;
    const B = this.beads;
    // Drop the beads that have lived out their time.
    while (B.length > 0 && now - B[0]!.birth > life) B.shift();
    for (let i = 0; i < B.length; i++) {
      const b = B[i]!;
      const age = now - b.birth;
      const fade = 1 - smoothstep(life * 0.72, life, age);
      const a = (0.2 + 0.8 * Math.exp(-age / 150)) * fade;
      const flash = Math.exp(-age * 0.7) * (age < 6 ? 1 : 0);
      this.point(b.theta, e1, e2, orbit, this._c);
      this.pos[nb * 3] = this._c.x;
      this.pos[nb * 3 + 1] = this._c.y;
      this.pos[nb * 3 + 2] = this._c.z;
      this.fx[nb * 3] = a;
      this.fx[nb * 3 + 1] = flash;
      this.fx[nb * 3 + 2] = (b.height % 97) / 97;
      nb++;
      // Link from the previous bead (or, for the newest, onward to the moon).
      const next = i + 1 < B.length ? B[i + 1]!.theta : moonTheta;
      const nextAge = i + 1 < B.length ? now - B[i + 1]!.birth : 0;
      const t0 = b.theta;
      let t1 = next;
      // Keep the arc the short way forward (the moon travels toward increasing angle).
      while (t1 < t0) t1 += Math.PI * 2;
      if (t1 - t0 > Math.PI * 1.6) continue; // a stale gap: no link
      const la = Math.min(
        a,
        (0.2 + 0.8 * Math.exp(-nextAge / 150)) * (1 - smoothstep(life * 0.72, life, nextAge)),
      );
      const live = i + 1 >= B.length;
      for (let k = 0; k < ARC_SEGMENTS; k++) {
        const ta = t0 + ((t1 - t0) * k) / ARC_SEGMENTS;
        const tb = t0 + ((t1 - t0) * (k + 1)) / ARC_SEGMENTS;
        this.point(ta, e1, e2, orbit, this._c);
        this.linePos[nv * 3] = this._c.x;
        this.linePos[nv * 3 + 1] = this._c.y;
        this.linePos[nv * 3 + 2] = this._c.z;
        this.lineA[nv] = la * (live ? 0.25 + 0.75 * (1 - k / ARC_SEGMENTS) : 0.45) * 0.55;
        nv++;
        this.point(tb, e1, e2, orbit, this._c);
        this.linePos[nv * 3] = this._c.x;
        this.linePos[nv * 3 + 1] = this._c.y;
        this.linePos[nv * 3 + 2] = this._c.z;
        this.lineA[nv] = la * (live ? 0.25 + 0.75 * (1 - (k + 1) / ARC_SEGMENTS) : 0.45) * 0.55;
        nv++;
      }
    }
    this.beadGeom.instanceCount = nb;
    this.posAttr.needsUpdate = true;
    this.fxAttr.needsUpdate = true;
    this.lineGeom.setDrawRange(0, nv);
    this.linePosAttr.needsUpdate = true;
    this.lineAAttr.needsUpdate = true;
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
    this.lineGeom.dispose();
    this.lineMat.dispose();
  }
}

// Ray layer: the beams that run between the planet and the Flux moon.
//
// A ray joins two endpoints. Each is either a node (a slot in the position texture, so it follows
// the node as stacks fan out) or one of the moon's anchors (a uniform the moon rewrites every
// frame, so the beam stays glued to a piece as the moon travels its orbit). The route is
// `relayPath` (moon/relay.ts): it leaves the planet straight up like a space elevator, arcs round it
// on a fan of shells to the moon's direction and meets the moon along its own radial line, so it can
// never cut through the planet whatever the pose. The planet hides the part of a beam that is behind
// it analytically and softly (moon/occlusion.ts), the same way it hides the moon: a beam to a moon on the
// far side goes over the limb and disappears behind the disc. Drawn as a constant-pixel-width ribbon,
// evaluated on the GPU, one instance per ray.
//
// Two kinds: a beam (a travelling head that lights the conduit behind it) and a guide (faint
// dashes that march along the path; the pre-aim line for a payee that is known one block ahead).

import * as THREE from 'three';
import { PLANET_VIS_GLSL } from '../moon/occlusion';
import { RELAY_PATH_GLSL } from '../moon/relay';
import { GLSL_CONSTANTS, GLSL_POS_TEX } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';

export const RayKind = { Beam: 0, Guide: 1 } as const;

/** Slot numbers at or above this refer to the moon's anchors (base + anchor index). */
export const ANCHOR_BASE = 1000000;

const SEGMENTS = 96;

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_POS_TEX}
${RELAY_PATH_GLSL}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamUp;
uniform vec4 uAnchor[8];
in vec2 aSeg;     // t along the strip, side (-1 / +1)
in vec4 aEnds;    // slot A, slot B, unused, width px
in vec4 aTimes;   // start, duration, life, kind
in vec4 aColA;    // rgb at the start, intensity
in vec4 aColB;    // rgb at the end, lit-trail fraction
out vec4 vCol;
out vec4 vInfo;   // x = along the drawn part (1 at the head), y = side, z = path param, w = kind
out float vHead;
out float vLen;   // path length in device pixels
out vec3 vWorld;  // the route's point on the centre line, for the planet's occlusion

vec3 endpoint(float slot) {
  if (slot > 999999.5) return uAnchor[int(slot - 1000000.0 + 0.5)].xyz;
  return fetchPos(slot).xyz;
}
float easeInOut(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5; }

void main() {
  float start = aTimes.x;
  float dur = max(aTimes.y, 0.001);
  float life = aTimes.z;
  float kind = aTimes.w;
  float age = uTime - start;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec3 A = endpoint(aEnds.x);
  vec3 B = endpoint(aEnds.y);
  float head = clamp(age / dur, 0.0, 1.0);
  float hd = kind < 0.5 ? easeInOut(head) : head;
  float fadeOut = 1.0 - smoothstep(max(life - 0.8, 0.0), life, age);
  float fadeIn = smoothstep(0.0, 0.25, age);
  float tt = aSeg.x;
  float t = tt * hd;
  vec3 P = relayPath(A, B, t, uCamUp);
  vec3 Pa = relayPath(A, B, clamp(t + 0.01, 0.0, 1.0), uCamUp);
  vec3 Pb = relayPath(A, B, clamp(t - 0.01, 0.0, 1.0), uCamUp);
  vec4 c = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 ca = projectionMatrix * viewMatrix * vec4(Pa, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(Pb, 1.0);
  if (c.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec2 d = (ca.xy / max(ca.w, 1e-3) - cb.xy / max(cb.w, 1e-3)) * uViewport * 0.5;
  float len = length(d);
  vec2 dirS = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirS.y, dirS.x);
  float widthPx = aEnds.w * uPxScale;
  // Beams taper toward the head; guides stay hairline.
  if (kind < 0.5) widthPx *= mix(0.55, 1.0, tt);
  gl_Position = c;
  gl_Position.xy += perp * aSeg.y * widthPx * 2.0 / uViewport * c.w;
  // The route's length: its arc round the planet and its climb.
  float rA = max(length(A), 1e-3);
  float rB = max(length(B), 1e-3);
  float ang = acos(clamp(dot(A, B) / (rA * rB), -1.0, 1.0));
  float arc = length(vec2(ang * 0.5 * (rA + rB), rB - rA));
  float pathPx = arc * uProjScale / max(length(0.5 * (A + B) - uCamPos), 0.3);
  vec3 col = mix(aColA.rgb, aColB.rgb, smoothstep(0.0, 0.55, t));
  vCol = vec4(col * aColA.a * fadeOut * fadeIn, 1.0);
  vInfo = vec4(tt, aSeg.y, t, kind);
  vHead = head;
  vLen = pathPx;
  vWorld = P;
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${PLANET_VIS_GLSL}
uniform float uTime;
in vec4 vCol;
in vec4 vInfo;
in float vHead;
in float vLen;
in vec3 vWorld;
void main() {
  float vis = planetVis(vWorld);
  if (vis < 0.002) discard;
  float side = abs(vInfo.y);
  float across = 1.0 - smoothstep(0.25, 1.0, side);
  float core = 1.0 - smoothstep(0.0, 0.5, side);
  vec3 tint = vCol.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, vec3(lum), 0.72);
  vec3 col;
  // Lengths along the beam are device pixels; the patterns are designed in CSS pixels.
  float px = vInfo.z * vLen / uPxScale;
  if (vInfo.w < 0.5) {
    float drawing = 1.0 - smoothstep(0.9, 1.0, vHead);
    float headGlow = exp(-pow((1.0 - vInfo.x) * 8.0, 2.0)) * drawing;
    float body = 0.22 + 0.78 * pow(vInfo.x, 2.2);
    // A few packets ride the conduit after the head has passed.
    float pk = pow(0.5 + 0.5 * sin(px * 0.11 - uTime * 6.0), 6.0) * 0.5;
    col = tint * (across * 0.55 * body + core * 0.5 * body + core * pk * 0.35) + hot * core * headGlow * 2.6 + hot * across * headGlow * 0.5;
  } else {
    float reveal = smoothstep(0.0, 1.0, vInfo.x);
    float dash = 1.0 - smoothstep(0.38, 0.46, abs(fract(px / 10.0 - uTime * 0.55) - 0.5) * 1.0);
    col = tint * (0.4 * across + 0.6 * core) * dash * (0.5 + 0.5 * reveal);
  }
  gl_FragColor = vec4(col * vis, 1.0);
}`;

export class RayLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly ends: Float32Array;
  private readonly times: Float32Array;
  private readonly colA: Float32Array;
  private readonly colB: Float32Array;
  private readonly bufs: THREE.InstancedBufferAttribute[] = [];
  private high = 0;
  count = 0;
  private dirty = false;

  constructor(u: SharedUniforms, capacity = 48, renderOrder = 42) {
    this.capacity = capacity;
    const n = (SEGMENTS + 1) * 2;
    const seg = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      seg.set([t, -1], i * 4);
      seg.set([t, 1], i * 4 + 2);
      if (i < SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aSeg', new THREE.BufferAttribute(seg, 2));
    this.geometry.setIndex(idx);
    this.ends = new Float32Array(capacity * 4);
    this.times = new Float32Array(capacity * 4);
    this.colA = new Float32Array(capacity * 4);
    this.colB = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.times[i * 4 + 2] = -1;
    const mk = (arr: Float32Array, name: string): void => {
      const b = new THREE.InstancedBufferAttribute(arr, 4);
      b.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, b);
      this.bufs.push(b);
    };
    mk(this.ends, 'aEnds');
    mk(this.times, 'aTimes');
    mk(this.colA, 'aColA');
    mk(this.colB, 'aColB');
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPosTex: u.uPosTex,
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uTime: u.uTime,
        uCamPos: u.uCamPos,
        uCamUp: u.uCamUp,
        uAnchor: u.uAnchor,
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
      // The planet hides a beam analytically (planetVis), so no depth test: no fight with the atmosphere.
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  /**
   * Adds a ray. Endpoints are node slots or `ANCHOR_BASE + k`. `trail` is reserved (the conduit is
   * always lit behind the head). Returns the ray index or -1 when the pool is full.
   */
  add(
    a: number,
    b: number,
    kind: number,
    start: number,
    dur: number,
    life: number,
    widthPx: number,
    ar: number,
    ag: number,
    ab: number,
    br: number,
    bg: number,
    bb: number,
    intensity: number,
  ): number {
    let i = -1;
    for (let k = 0; k < this.high; k++) {
      if (this.times[k * 4 + 2]! < 0) {
        i = k;
        break;
      }
    }
    if (i < 0) {
      if (this.high >= this.capacity) return -1;
      i = this.high++;
    }
    const e = i * 4;
    this.ends[e] = a;
    this.ends[e + 1] = b;
    this.ends[e + 2] = 0;
    this.ends[e + 3] = widthPx;
    this.times[e] = start;
    this.times[e + 1] = dur;
    this.times[e + 2] = life;
    this.times[e + 3] = kind;
    this.colA[e] = ar;
    this.colA[e + 1] = ag;
    this.colA[e + 2] = ab;
    this.colA[e + 3] = intensity;
    this.colB[e] = br;
    this.colB[e + 1] = bg;
    this.colB[e + 2] = bb;
    this.colB[e + 3] = 1;
    this.count++;
    this.dirty = true;
    return i;
  }

  /** Starts fading a ray out now. */
  fadeOut(i: number, time: number, fade = 0.6): void {
    if (i < 0 || i >= this.high || this.times[i * 4 + 2]! < 0) return;
    const age = time - this.times[i * 4]!;
    this.times[i * 4 + 2] = Math.min(this.times[i * 4 + 2]!, age + fade);
    this.dirty = true;
  }

  isActive(i: number, start: number): boolean {
    return i >= 0 && i < this.high && this.times[i * 4 + 2]! >= 0 && this.times[i * 4] === Math.fround(start);
  }

  update(time: number): void {
    const t = this.times;
    for (let i = 0; i < this.high; i++) {
      const life = t[i * 4 + 2]!;
      if (life >= 0 && time > t[i * 4]! + life + 0.05) {
        t[i * 4 + 2] = -1;
        this.count--;
        this.dirty = true;
      }
    }
    let h = this.high;
    while (h > 0 && t[(h - 1) * 4 + 2]! < 0) h--;
    this.high = h;
    if (this.dirty) {
      for (const b of this.bufs) b.needsUpdate = true;
      this.dirty = false;
    }
    this.geometry.instanceCount = this.high;
    this.mesh.visible = this.high > 0;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.times[i * 4 + 2] = -1;
    this.high = 0;
    this.count = 0;
    this.dirty = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

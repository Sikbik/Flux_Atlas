// Ring layer: expanding rings, ignite flashes, implosions, impact marks and long-lived target
// brackets, all drawn as quads lying on the surface (or at a node's height inside a stack). Each
// instance is 12 floats; the GPU fetches the anchor node's current position by slot.

import * as THREE from 'three';
import { GLSL_LENS } from '../lens';
import { GLSL_CONSTANTS, GLSL_POS_TEX } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';

export const RingKind = {
  Pulse: 0,
  Ignite: 1,
  Implode: 2,
  Shimmer: 3,
  Impact: 4,
  Producer: 5,
  /** Pre-aim reticle on a next payee: a thin ring with four ticks, breathing, constant pixel size. */
  Target: 6,
  /** Spinning 240 degree arc on an installing app instance. */
  Install: 7,
  Tick: 8,
  /** Selection beacon: two ring pulses offset by half a period, repeating while the node is selected. */
  Select: 9,
  /** Co-host marker: a steady 1 px ring (radius set by the start pixel size) held while a node is selected. */
  Host: 10,
} as const;

// A positive max radius is in globe radii; a negative one is in CSS pixels, constant at any zoom
// (the design specifies its rings in pixels). `aKind.y` is the start radius in pixels for pixel rings.
const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_POS_TEX}
${GLSL_LENS}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uTime;
uniform float uReduced;
in vec4 aRing;   // slot (negative = free), start, duration, max radius (rad, or -px)
in vec4 aColor;  // rgb, intensity
in vec4 aKind;   // kind, start radius px, seed, unused
in vec3 aPos;    // free anchor
out vec2 vUv;
out vec4 vColor;
out vec4 vP;     // x = age fraction, y = thickness (fraction of radius), z = seed, w = radius in px
out vec4 vQ;     // x = seconds remaining, y = age, z = rotation, w = px per radius unit
flat out float vKind;

void main() {
  float age = uTime - aRing.y;
  float dur = aRing.z;
  if (age < 0.0 || age > dur) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  float kind = aKind.x;
  float u = age / dur;
  vec3 P;
  if (aRing.x < -0.5) P = aPos;
  else {
    vec4 p = fetchPos(aRing.x);
    if (p.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
    P = p.xyz;
  }
  float pr = length(P);
  vec3 B = P / pr;
  vec3 E = normalize(vec3(B.z, 0.0, -B.x) + vec3(1e-6, 0.0, 0.0));
  vec3 N = cross(B, E);
  // Up close the lens (lens.ts) is on: a block of ground fills the screen, so the small lift that keeps a
  // ring off the surface from afar would float it a whole marker away from its node. It rides at the node's own height.
  float lz = lensZoom(length(P - cameraPosition), uProjScale / max(uPxScale, 1e-4));

  float e;
  float env = 1.0;
  float remaining = dur - age;
  float fastAim = (kind > 5.5 && kind < 6.5 && remaining < 5.0) ? 1.0 : 0.0;
  if (kind > 5.5 && kind < 6.5) {
    // Reticle: fades in over 400 ms, holds, fades out at the end (when the beams land it collapses).
    e = 1.0;
    env = smoothstep(0.0, 0.4, age) * (1.0 - smoothstep(dur - 0.45, dur, age)) * (1.0 + 0.15 * fastAim);
  } else if (kind > 8.5) {
    // Selection beacon and co-host rings: held for as long as the node stays selected, then a
    // short fade once the engine ends them (their duration is cut to now + fade).
    e = 0.0;
    env = smoothstep(0.0, 0.4, remaining);
  } else if (kind > 6.5 && kind < 7.5) {
    e = 1.0;
    env = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(dur - 0.4, dur, age));
  } else if (kind > 1.5 && kind < 2.5) {
    e = 1.0 - u; e = e * e * (0.4 + 0.6 * e);
    env = 1.0 - smoothstep(0.7, 1.0, u);
  } else {
    e = 1.0 - pow(1.0 - u, 3.0);
    env = 1.0 - smoothstep(0.35, 1.0, u);
  }
  // Up close the co-host ring is a quiet outline: the selected marker stays the brightest thing on screen.
  if (kind > 9.5) env *= mix(1.0, 0.72, lz);
  vec4 cc = projectionMatrix * viewMatrix * vec4(P, 1.0);
  float w = max(cc.w, 1e-3);
  float R;
  float Rpx;
  float maxRad = aRing.w;
  if (maxRad < 0.0) {
    // Pixel rings. Select pulses and the aim reticle run their own clocks.
    float pxr = -maxRad;
    if (kind > 8.5 && kind < 9.5) pxr = 26.0;
    float breath = 1.0;
    if (kind > 5.5 && kind < 6.5) {
      float period = mix(2.4, 0.8, fastAim);
      breath = 1.0 + 0.12 * (0.5 + 0.5 * sin(age * TAU / period)) * (1.0 - uReduced);
    }
    Rpx = ((kind > 8.5 && kind < 9.5) ? pxr : mix(aKind.y, pxr, e)) * uPxScale * breath;
    // The co-host ring clears a marker that has grown up close.
    if (kind > 9.5) Rpx *= mix(1.0, 2.2, lz);
    Rpx = max(Rpx, 1.5 * uPxScale);
    R = Rpx * w / uProjScale;
  } else {
    R = max(maxRad * e, 1e-5);
    Rpx = R * uProjScale / w;
    // Always at least a few pixels so tiny rings stay visible from far away.
    float minPx = 6.0 * uPxScale;
    if (Rpx < minPx) { R *= minPx / max(Rpx, 1e-3); Rpx = minPx; }
  }
  float ext = (kind > 8.5 && kind < 9.5) ? 1.0 : 1.32;
  vec3 Q = normalize(B + (E * position.x + N * position.y) * R * ext) * (pr + 0.0006 * (1.0 - lz));
  gl_Position = projectionMatrix * viewMatrix * vec4(Q, 1.0);
  vUv = position.xy * ext;
  float thick = clamp(3.0 * uPxScale / Rpx, 0.03, 0.45);
  vColor = vec4(aColor.rgb * aColor.a * env, 1.0);
  vP = vec4(u, thick, aKind.z, Rpx);
  float rot = fastAim > 0.5 ? (1.0 - remaining / 5.0) * 1.5708 * (1.0 - uReduced) : 0.0;
  vQ = vec4(remaining, age, rot, uPxScale / Rpx);
  vKind = kind;
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
uniform float uReduced;
in vec2 vUv;
in vec4 vColor;
in vec4 vP;
in vec4 vQ;
flat in float vKind;

float ringAt(float q, float radius, float width) {
  float d = (q - radius) / width;
  return exp(-d * d);
}

void main() {
  float q = length(vUv);
  float k = vKind;
  float lim = (k > 8.5 && k < 9.5) ? 1.0 : 1.32;
  if (q > lim) discard;
  vec3 c = vColor.rgb;
  float th = vP.y;
  float u = vP.x;
  float s = 0.0;
  if (k < 0.5) {                      // pulse
    s = ringAt(q, 1.0, th) * 1.4 + exp(-q * q * 5.0) * 0.12 * (1.0 - u);
  } else if (k < 1.5) {               // ignite: flash then ring
    float fl = exp(-q * q * 9.0) * exp(-u * 4.5) * 2.2;
    s = fl + ringAt(q, 1.0, th * 1.3) * 1.2 + ringAt(q, 0.62, th) * 0.6 * (1.0 - u);
  } else if (k < 2.5) {               // implode
    s = ringAt(q, 1.0, th * 1.4) * 1.3 + exp(-q * q * 14.0) * u * 0.9;
  } else if (k < 3.5) {               // shimmer (crawl re-check)
    s = ringAt(q, 1.0, th * 2.4) * 0.55 + exp(-q * q * 6.0) * 0.12;
  } else if (k < 4.5) {               // impact: payee pulse
    s = ringAt(q, 1.0, th) * 1.6 + ringAt(q, 0.62 * (0.4 + u), th * 0.9) * 1.1 + exp(-q * q * 12.0) * exp(-u * 3.0) * 2.0;
  } else if (k < 5.5) {               // producer: triple ring, bright heart
    s = ringAt(q, 1.0, th) * 1.5 + ringAt(q, 0.72 * (0.3 + 0.7 * u), th * 1.1) * 1.0 + ringAt(q, 0.44 * (0.2 + 0.8 * u), th * 1.2) * 0.8
      + exp(-q * q * 10.0) * exp(-u * 2.6) * 3.0;
  } else if (k < 6.5) {               // aim reticle: 1px ring, four 4px ticks, tier color
    float a = atan(vUv.y + 1e-5, vUv.x + 1e-5) - vQ.z;
    float tickMask = pow(abs(cos(a * 2.0)), 36.0);
    float tickLen = 4.0 * vQ.w;
    float ticks = tickMask * smoothstep(0.93, 1.0, q) * (1.0 - smoothstep(1.0 + tickLen, 1.0 + tickLen + 0.04, q));
    float ringW = th * 0.34;
    s = ringAt(q, 1.0, ringW) * 1.05 + ticks * 1.15 + exp(-q * q * 9.0) * 0.06;
  } else if (k < 7.5) {               // install: a 240 degree arc spinning once per 0.9 s
    float a = atan(vUv.y + 1e-5, vUv.x + 1e-5) - uTime * (TAU / 0.9) * (1.0 - 0.8 * uReduced);
    float sweep = mod(a + PI * 4.0, TAU);
    float arc = smoothstep(0.0, 0.25, sweep) * (1.0 - smoothstep(4.19 - 0.25, 4.19, sweep));
    s = ringAt(q, 1.0, th * 0.9) * arc * 1.5 + ringAt(q, 1.0, th * 1.4) * 0.12;
  } else if (k < 8.5) {               // tick: a tiny blip
    s = exp(-q * q * 10.0) * 1.3 * (1.0 - u) + ringAt(q, 1.0, th * 1.4) * 0.6;
  } else if (k > 9.5) {               // co-host: one steady 1 px ring
    s = ringAt(q, 1.0, 0.85 * vQ.w) * 1.0 + exp(-q * q * 10.0) * 0.06;
  } else {                            // select: two pulses per 2.4 s, half a period apart, 10 to 26 px
    float per = 2.4;
    float t1 = fract(vQ.y / per);
    float t2 = fract(vQ.y / per + 0.5);
    // vUv spans the maximum pulse radius (26 px); map the radii of each pulse into that frame.
    float r1 = (10.0 + 16.0 * (1.0 - pow(1.0 - t1, 2.5))) / 26.0;
    float r2 = (10.0 + 16.0 * (1.0 - pow(1.0 - t2, 2.5))) / 26.0;
    float w1 = 0.045;
    float a1 = (1.0 - t1) * (1.0 - t1);
    float a2 = (1.0 - t2) * (1.0 - t2);
    float fadeIn = smoothstep(0.0, 0.3, vQ.y);
    s = (ringAt(q, r1, w1) * a1 + ringAt(q, r2, w1) * a2) * 1.3 * fadeIn;
  }
  gl_FragColor = vec4(c * s, 1.0);
}`;

export class RingLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly ring: Float32Array;
  private readonly color: Float32Array;
  private readonly kind: Float32Array;
  private readonly pos: Float32Array;
  private readonly bufs: THREE.InstancedBufferAttribute[] = [];
  private readonly free: Uint32Array;
  private freeN = 0;
  high = 0;
  count = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -1;

  constructor(u: SharedUniforms, capacity: number) {
    this.capacity = capacity;
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.ring = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    this.kind = new Float32Array(capacity * 4);
    this.pos = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.ring[i * 4 + 2] = -1;
    const mk = (arr: Float32Array, size: number, name: string): void => {
      const b = new THREE.InstancedBufferAttribute(arr, size);
      b.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, b);
      this.bufs.push(b);
    };
    mk(this.ring, 4, 'aRing');
    mk(this.color, 4, 'aColor');
    mk(this.kind, 4, 'aKind');
    mk(this.pos, 3, 'aPos');
    this.geometry.instanceCount = 0;
    this.free = new Uint32Array(capacity);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPosTex: u.uPosTex,
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uTime: u.uTime,
        uReduced: u.uReduced,
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
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 35;
    this.mesh.visible = false;
  }

  private take(): number {
    if (this.freeN > 0) return this.free[--this.freeN]!;
    if (this.high >= this.capacity) return -1;
    return this.high++;
  }

  private touch(i: number): void {
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  /** Adds a ring anchored at a node slot. Returns the index or -1 when full. */
  add(
    slot: number,
    kind: number,
    start: number,
    dur: number,
    maxRad: number,
    r: number,
    g: number,
    b: number,
    intensity: number,
    seed = 0,
    startPx = 0,
  ): number {
    const i = this.take();
    if (i < 0) return -1;
    const o = i * 4;
    this.ring[o] = slot;
    this.ring[o + 1] = start;
    this.ring[o + 2] = dur;
    this.ring[o + 3] = maxRad;
    this.color[o] = r;
    this.color[o + 1] = g;
    this.color[o + 2] = b;
    this.color[o + 3] = intensity;
    this.kind[o] = kind;
    this.kind[o + 1] = startPx;
    this.kind[o + 2] = seed;
    this.touch(i);
    this.count++;
    return i;
  }

  addFree(
    x: number,
    y: number,
    z: number,
    kind: number,
    start: number,
    dur: number,
    maxRad: number,
    r: number,
    g: number,
    b: number,
    intensity: number,
  ): number {
    const i = this.add(-1, kind, start, dur, maxRad, r, g, b, intensity);
    if (i < 0) return -1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    return i;
  }

  /** Ends a long-lived ring early (e.g. a target lock that resolved). */
  end(i: number, start: number, time: number, fade = 0.5): void {
    if (i < 0 || i >= this.high) return;
    const o = i * 4;
    if (this.ring[o + 1] !== Math.fround(start) || this.ring[o + 2]! < 0) return;
    this.ring[o + 2] = Math.min(this.ring[o + 2]!, time - this.ring[o + 1]! + fade);
    this.touch(i);
  }

  update(time: number): void {
    const r = this.ring;
    for (let i = 0; i < this.high; i++) {
      const dur = r[i * 4 + 2]!;
      if (dur >= 0 && time > r[i * 4 + 1]! + dur + 0.05) {
        r[i * 4 + 2] = -1;
        this.free[this.freeN++] = i;
        this.count--;
        this.touch(i);
      }
    }
    let h = this.high;
    while (h > 0 && r[(h - 1) * 4 + 2]! < 0) h--;
    if (h !== this.high) {
      this.high = h;
      this.freeN = 0;
      for (let i = 0; i < h; i++) if (r[i * 4 + 2]! < 0) this.free[this.freeN++] = i;
    }
    if (this.dirtyHi >= this.dirtyLo) {
      const lo = this.dirtyLo;
      const n = Math.min(this.dirtyHi, this.capacity - 1) - lo + 1;
      for (const b of this.bufs) {
        const s = b.itemSize;
        b.clearUpdateRanges();
        b.addUpdateRange(lo * s, n * s);
        b.needsUpdate = true;
      }
      this.dirtyLo = Infinity;
      this.dirtyHi = -1;
    }
    this.geometry.instanceCount = this.high;
    this.mesh.visible = this.high > 0;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.ring[i * 4 + 2] = -1;
    this.high = 0;
    this.freeN = 0;
    this.count = 0;
    this.touch(0);
    this.touch(this.capacity - 1);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

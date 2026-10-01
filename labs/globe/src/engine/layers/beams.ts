// Beams of the moon relay (design 6.4 I and 7.10.5): screen-space curves between a node (or a moon
// piece) and another, because the companion moon is not on the sphere.
//
// A beam is a quadratic curve in pixels that bulges away from the planet's middle. A bright head
// flies along it and drags a trail of a chosen fraction of the path; the trail is three passes of
// decreasing width (the design's ribbon: wide and faint, medium, thin and hot) that taper toward
// the tail, over a 1 px hairline of the whole route. An endpoint on the far side of the planet is
// drawn at the limb point toward it. Dotted guides (the pre-aim lines from a moon piece to a
// payee who is known one block ahead) use the same curve with a dash pattern.
//
// One instance per beam; the vertex shader fetches the node's display position from the position
// texture (so beams follow fanning stacks) or a moon anchor from a uniform, and builds the strip.
// All colors here are display-referred sRGB (the design's canvas arithmetic) and are converted to
// linear on output.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_POS_TEX } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';
import { ANCHOR_BASE } from './rays';

export const BeamKind = { Beam: 0, Guide: 1 } as const;
/** Head motion: ease-in-out (the uplink), ease-out-cubic (a downlink), none (reduced motion: the whole route at once). */
export const BeamEase = { InOut: 0, OutCubic: 1, Static: 2 } as const;

const SEGMENTS = 64;

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_POS_TEX}
uniform vec2 uCss;
uniform float uPxScale;
uniform float uTime;
uniform vec4 uPlanet;       // center x, y (CSS px), radius (px), camera distance (globe radii)
uniform vec3 uCamDir;       // unit vector from the planet's center toward the camera
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec4 uAnchor[8];
in vec2 aSeg;     // t along the strip, side (-1 / +1)
in vec4 aEnds;    // slot A, slot B, bulge, kind
in vec4 aTimes;   // start, travel, life, ease
in vec4 aLift;    // lift A, lift B (globe radii), trail fraction, eta time (guides)
in vec4 aW;       // widths of the three passes (px), alpha
in vec4 aC0;
in vec4 aC1;
in vec4 aC2;
out vec2 vPx;
out float vAcross;
out float vT;
flat out vec2 vHeadPx;
flat out vec4 vA;      // head, trail, alpha, kind
flat out vec4 vW;
flat out vec3 vC0;
flat out vec3 vC1;
flat out vec3 vC2;
flat out float vLen;
flat out float vEta;

vec2 toPx(vec4 c) { return vec2(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5) * uCss; }

// A node's place on screen, or the limb point toward it when it is on the far side of the planet.
// Returns false when the node is gone.
bool endpoint(float slot, float lift, out vec2 px, out bool far) {
  far = false;
  if (slot > 999999.5) {
    vec3 P = uAnchor[int(slot - 1000000.0 + 0.5)].xyz;
    px = toPx(projectionMatrix * viewMatrix * vec4(P, 1.0));
    return true;
  }
  vec4 pp = fetchPos(slot);
  if (pp.w <= 0.0) return false;
  float r = length(pp.xyz);
  vec3 dir = pp.xyz / r;
  float cosA = clamp(dot(dir, uCamDir), -1.0, 1.0);
  float limit = acos(1.0 / max(uPlanet.w, 1.0001)) + (r > 1.0 ? acos(1.0 / r) : 0.0);
  if (acos(cosA) <= limit + 0.0005) {
    px = toPx(projectionMatrix * viewMatrix * vec4(dir * (r + lift), 1.0));
    return true;
  }
  vec3 perp = dir - uCamDir * cosA;
  vec2 d = vec2(dot(perp, uCamRight), -dot(perp, uCamUp));
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0, -1.0);
  px = uPlanet.xy + d * uPlanet.z;
  far = true;
  return true;
}

float easeInOut(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5; }

void main() {
  float start = aTimes.x;
  float travel = max(aTimes.y, 0.001);
  float life = aTimes.z;
  float ease = aTimes.w;
  float age = uTime - start;
  float kind = aEnds.w;
  vec2 A;
  vec2 B;
  bool farA;
  bool farB;
  if (age < 0.0 || age > life || !endpoint(aEnds.x, aLift.x, A, farA) || !endpoint(aEnds.y, aLift.y, B, farB) || (kind > 0.5 && (farA || farB))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 AB = B - A;
  float L = max(length(AB), 1.0);
  vec2 M = 0.5 * (A + B);
  vec2 n = vec2(-AB.y, AB.x) / L;
  if (dot(n, M - uPlanet.xy) < 0.0) n = -n;
  vec2 C = M + n * (L * aEnds.z + 10.0);

  float u = age / life;
  float tu = travel / life;
  float hd = clamp(age / travel, 0.0, 1.0);
  float head = 1.0;
  float fade = 1.0;
  float trail = aLift.z;
  if (kind > 0.5) {
    // Dotted guide: fades in over 400 ms; brightens toward the moment the block is expected.
    float eta = max(0.0, aLift.w - uTime);
    fade = smoothstep(0.0, 0.4, age) * (0.12 + 0.3 * (1.0 - clamp(eta / 5.0, 0.0, 1.0))) * aW.w;
    if (u > 0.85) fade *= 1.0 - smoothstep(0.85, 1.0, u);
  } else if (ease < 0.5) {
    head = easeInOut(hd);
    fade = (1.0 - smoothstep(tu, 1.0, u)) * aW.w;
  } else if (ease < 1.5) {
    head = (1.0 - pow(1.0 - hd, 3.0)) * 0.985 + 0.015 * hd;
    fade = (1.0 - smoothstep(tu, 1.0, u)) * aW.w;
  } else {
    // Reduced motion: the whole route fades in and out with no head.
    head = 1.0;
    trail = 1.0;
    fade = smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.55, 1.0, u)) * aW.w;
  }

  float t = aSeg.x;
  vec2 P = (1.0 - t) * (1.0 - t) * A + 2.0 * (1.0 - t) * t * C + t * t * B;
  vec2 tang = 2.0 * (1.0 - t) * (C - A) + 2.0 * t * (B - C);
  float tl = max(length(tang), 1e-4);
  vec2 nn = vec2(-tang.y, tang.x) / tl;
  float hw = 0.5 * max(aW.x, max(aW.y, aW.z)) + 2.0;
  if (kind > 0.5) hw = 2.0;
  vec2 hp = (1.0 - head) * (1.0 - head) * A + 2.0 * (1.0 - head) * head * C + head * head * B;
  // Near the head the strip swells into the halo's footprint (radius 26 px).
  if (kind < 0.5 && ease < 1.5) {
    float dpx = abs(t - head) * L * 1.06;
    if (dpx < 26.0) hw = max(hw, sqrt(max(0.0, 26.0 * 26.0 - dpx * dpx)) + 1.0);
  }
  vec2 px = P + nn * aSeg.y * hw;
  gl_Position = vec4(px.x / uCss.x * 2.0 - 1.0, 1.0 - px.y / uCss.y * 2.0, 0.0, 1.0);
  vPx = px;
  vAcross = aSeg.y * hw;
  vT = t;
  vHeadPx = hp;
  vA = vec4(head, trail, fade, kind + (ease > 1.5 ? 2.0 : 0.0));
  vW = aW;
  vC0 = aC0.rgb;
  vC1 = aC1.rgb;
  vC2 = aC2.rgb;
  vLen = L * 1.06;
  vEta = aLift.w;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uPxScale;
uniform float uTime;
in vec2 vPx;
in float vAcross;
in float vT;
flat in vec2 vHeadPx;
flat in vec4 vA;
flat in vec4 vW;
flat in vec3 vC0;
flat in vec3 vC1;
flat in vec3 vC2;
flat in float vLen;
flat in float vEta;

float aaw() { return 0.8 / uPxScale; }
float band(float d, float w) { return 1.0 - smoothstep(w * 0.5 - aaw(), w * 0.5 + aaw(), d); }
vec3 srgbToLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
// The head sprites (design): a soft halo 52 px wide and a hot core 12 px wide.
float haloG(float t) {
  if (t >= 1.0) return 0.0;
  if (t < 0.15) return mix(1.0, 0.6, t / 0.15);
  if (t < 0.4) return mix(0.6, 0.14, (t - 0.15) / 0.25);
  return mix(0.14, 0.0, (t - 0.4) / 0.6);
}
float coreG(float t) {
  if (t >= 1.0) return 0.0;
  if (t < 0.4) return mix(1.0, 0.9, t / 0.4);
  if (t < 0.7) return mix(0.9, 0.3, (t - 0.4) / 0.3);
  return mix(0.3, 0.0, (t - 0.7) / 0.3);
}

void main() {
  float d = abs(vAcross);
  float head = vA.x;
  float trail = vA.y;
  float a = vA.z;
  float kind = vA.w;
  vec3 col = vec3(0.0);
  if (kind > 0.5 && kind < 1.5) {
    // Dotted guide: 1 px, 2 px dashes with 5 px gaps, in the tier color.
    float dash = 1.0 - smoothstep(2.0 - aaw(), 2.0 + aaw(), mod(vT * vLen, 7.0));
    col += vC0 * a * band(d, 1.0) * dash;
  } else {
    float t0 = max(0.0, head - trail);
    float span = max(head - t0, 1e-4);
    // The whole route as a hairline, then the lit trail behind the head.
    col += vC1 * 0.26 * a * band(d, 1.0);
    if (vT >= t0 && vT <= head) {
      float k = clamp((vT - t0) / span, 0.0, 1.0);
      float kk = pow(k, 1.5);
      float wf = 0.35 + 0.65 * k;
      col += vC0 * 0.10 * kk * a * band(d, vW.x * wf);
      col += vC1 * 0.40 * kk * a * band(d, vW.y * wf);
      col += vC2 * 1.00 * kk * a * band(d, vW.z * wf);
    }
    if (kind < 1.5) {
      float dh = length(vPx - vHeadPx);
      col += vec3(0.81, 0.855, 0.94) * haloG(dh / 26.0) * a;
      col += vec3(1.0) * coreG(dh / 6.0) * a;
    }
  }
  gl_FragColor = vec4(srgbToLin(clamp(col, 0.0, 1.0)), 1.0);
}`;

export class BeamLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly ends: Float32Array;
  private readonly times: Float32Array;
  private readonly lift: Float32Array;
  private readonly wid: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly c2: Float32Array;
  private readonly bufs: THREE.InstancedBufferAttribute[] = [];
  private high = 0;
  count = 0;
  private dirty = false;
  private readonly planet = new THREE.Vector4(0, 0, 100, 4);
  private readonly camDir = new THREE.Vector3(0, 0, 1);

  constructor(u: SharedUniforms, capacity = 48) {
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
    this.lift = new Float32Array(capacity * 4);
    this.wid = new Float32Array(capacity * 4);
    this.c0 = new Float32Array(capacity * 4);
    this.c1 = new Float32Array(capacity * 4);
    this.c2 = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.times[i * 4 + 2] = -1;
    const mk = (arr: Float32Array, name: string): void => {
      const b = new THREE.InstancedBufferAttribute(arr, 4);
      b.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, b);
      this.bufs.push(b);
    };
    mk(this.ends, 'aEnds');
    mk(this.times, 'aTimes');
    mk(this.lift, 'aLift');
    mk(this.wid, 'aW');
    mk(this.c0, 'aC0');
    mk(this.c1, 'aC1');
    mk(this.c2, 'aC2');
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPosTex: u.uPosTex,
        uPxScale: u.uPxScale,
        uTime: u.uTime,
        uAnchor: u.uAnchor,
        uCss: { value: new THREE.Vector2(1, 1) },
        uPlanet: { value: this.planet },
        uCamDir: { value: this.camDir },
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Per-frame view: CSS viewport, the planet's on-screen disc, the camera's distance and direction. */
  setView(cssW: number, cssH: number, planetX: number, planetY: number, planetR: number, camDist: number, cam: THREE.Vector3): void {
    (this.material.uniforms.uCss.value as THREE.Vector2).set(cssW, cssH);
    this.planet.set(planetX, planetY, planetR, camDist);
    this.camDir.copy(cam).normalize();
  }

  /**
   * Adds a beam. Endpoints are node slots or `ANCHOR_BASE + k`. `colors` are three sRGB triples
   * (9 numbers). Returns the beam index or -1 when the pool is full.
   */
  add(
    a: number, b: number, kind: number, start: number, travel: number, life: number, ease: number,
    bulge: number, liftA: number, liftB: number, trail: number, eta: number,
    w0: number, w1: number, w2: number, alpha: number,
    colors: ArrayLike<number>,
  ): number {
    let i = -1;
    for (let k = 0; k < this.high; k++) {
      if (this.times[k * 4 + 2] < 0) { i = k; break; }
    }
    if (i < 0) {
      if (this.high >= this.capacity) return -1;
      i = this.high++;
    }
    const e = i * 4;
    this.ends[e] = a;
    this.ends[e + 1] = b;
    this.ends[e + 2] = bulge;
    this.ends[e + 3] = kind;
    this.times[e] = start;
    this.times[e + 1] = travel;
    this.times[e + 2] = life;
    this.times[e + 3] = ease;
    this.lift[e] = liftA;
    this.lift[e + 1] = liftB;
    this.lift[e + 2] = trail;
    this.lift[e + 3] = eta;
    this.wid[e] = w0;
    this.wid[e + 1] = w1;
    this.wid[e + 2] = w2;
    this.wid[e + 3] = alpha;
    for (let c = 0; c < 3; c++) {
      this.c0[e + c] = colors[c];
      this.c1[e + c] = colors[3 + c];
      this.c2[e + c] = colors[6 + c];
    }
    this.count++;
    this.dirty = true;
    return i;
  }

  /** Starts fading a beam out now. */
  fadeOut(i: number, time: number, fade = 0.5): void {
    if (i < 0 || i >= this.high || this.times[i * 4 + 2] < 0) return;
    const age = time - this.times[i * 4];
    this.times[i * 4 + 2] = Math.min(this.times[i * 4 + 2], age + fade);
    this.dirty = true;
  }

  isActive(i: number, start: number): boolean {
    return i >= 0 && i < this.high && this.times[i * 4 + 2] >= 0 && this.times[i * 4] === Math.fround(start);
  }

  update(time: number): void {
    const t = this.times;
    for (let i = 0; i < this.high; i++) {
      const life = t[i * 4 + 2];
      if (life >= 0 && time > t[i * 4] + life + 0.05) {
        t[i * 4 + 2] = -1;
        this.count--;
        this.dirty = true;
      }
    }
    let h = this.high;
    while (h > 0 && t[(h - 1) * 4 + 2] < 0) h--;
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

export { ANCHOR_BASE };

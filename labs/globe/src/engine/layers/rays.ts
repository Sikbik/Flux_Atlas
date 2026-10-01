// Ray layer: the beams that run between the planet and the Flux moon.
//
// A ray joins two endpoints. Each is either a node (a slot in the position texture, so it follows
// the node as stacks fan out) or one of the moon's anchors (a uniform the moon rewrites every
// frame, so the beam stays glued to a piece as the moon drifts along its orbit). The path is a
// cubic curve that leaves the planet radially, like a space elevator, and meets the moon along its
// own radial line; if the straight route would dip into the planet it bows outward.
//
// A beam is a streak of light, not a line: a white-hot head flies the route and drags a short tail that
// thins to nothing (about 30 percent of the path, in the tier's color), over a faint hairline of the
// whole route that drains away once the head has arrived. Two draws per layer, both evaluated on the
// GPU from the same instance data: a constant-pixel-width ribbon for the tail and a camera-facing sprite
// for the head (a hot core, a soft halo and a fine four-point star). Where the planet's limb would hide
// the beam it has faded out first, so nothing is cut by the depth test; the first few percent of a
// route that starts on the surface fade in from the ground.
//
// Kinds: a beam (an uplink: ease-in-out), a downlink (leaves fast, settles: ease-out-cubic), a guide
// (faint dashes that march along the path; the pre-aim line for a payee that is known one block ahead)
// and a drift (the dev fund's pulse: a gently bowed route between two points in space, no node).

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_POS_TEX } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';

/**
 * Kinds. `Still` is added to a kind (reduced motion): no head flies; the end of the route, the tail a flight would have
 * left at its arrival, is lit at once (a comet frozen at its destination), fades in and holds, then fades out. (Lighting the
 * whole route drew a long thin ellipse around the planet in the wide shot.)
 */
export const RayKind = { Beam: 0, Guide: 1, Down: 2, Drift: 3, Still: 4 } as const;

/** Slot numbers at or above this refer to the moon's anchors (base + anchor index). */
export const ANCHOR_BASE = 1000000;

const SEGMENTS = 72;

/** The route and the head, shared by the ribbon and the sprite. */
const COMMON = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_POS_TEX}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec4 uAnchor[8];
in vec4 aEnds;    // slot A, slot B, unused, half width px
in vec4 aTimes;   // start, flight, life, kind
in vec4 aColA;    // rgb at the start, intensity
in vec4 aColB;    // rgb at the end, unused

vec3 endpoint(float slot) {
  if (slot > 999999.5) return uAnchor[int(slot - 1000000.0 + 0.5)].xyz;
  return fetchPos(slot).xyz;
}
vec3 bez(vec3 P0, vec3 P1, vec3 P2, vec3 P3, float t) {
  float u = 1.0 - t;
  return u * u * u * P0 + 3.0 * u * u * t * P1 + 3.0 * u * t * t * P2 + t * t * t * P3;
}
float easeInOut(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5; }
float easeOutCubic(float x) { return 1.0 - pow(1.0 - x, 3.0); }

void route(out vec3 A, out vec3 P1, out vec3 P2, out vec3 B, out float L) {
  A = endpoint(aEnds.x);
  B = endpoint(aEnds.y);
  L = max(length(B - A), 1e-3);
  vec3 aHat = A / max(length(A), 1e-3);
  vec3 bHat = B / max(length(B), 1e-3);
  // Leave the planet radially; meet the moon along its radial line, from the planet side.
  float sa = length(A) > 1.35 ? -1.0 : 1.0;
  float sb = length(B) > 1.35 ? -1.0 : 1.0;
  float h = 0.33 * L;
  P1 = A + aHat * h * sa;
  P2 = B + bHat * h * sb;
  if ((aTimes.w > 2.5 && aTimes.w < 3.5) || aTimes.w > 6.5) {
    // A drift between two points in space: a gentle sideways bow instead of the radial elevator.
    vec3 side = normalize(cross(B - A, uCamPos - A) + vec3(1e-6));
    P1 = mix(A, B, 0.33) + side * 0.16 * L;
    P2 = mix(A, B, 0.66) + side * 0.10 * L;
    return;
  }
  // Keep the route clear of the planet: bow the middle outward when it would graze the surface.
  vec3 M = (A + 3.0 * P1 + 3.0 * P2 + B) * 0.125;
  float ml = length(M);
  if (ml < 1.09) {
    vec3 out_ = (M / max(ml, 1e-3)) * (1.09 - ml) * (8.0 / 6.0);
    P1 += out_;
    P2 += out_;
  }
}

// How far the head has come along the route, 0..1 (an uplink eases in and out; a downlink leaves fast and settles).
float headAt(float age, float dur, float kind) {
  float p = clamp(age / dur, 0.0, 1.0);
  // A downlink never quite stalls: a fifth of its way is at constant speed, so it lands moving instead of hovering.
  return kind > 1.5 ? easeOutCubic(p) * 0.8 + 0.2 * p : easeInOut(p);
}

// 1 where the point is in clear sight of the camera, fading to 0 just before the planet's limb (or the
// surface itself) would hide it: the beam is gone before the depth test could cut it.
float clearSight(vec3 P) {
  vec3 D = P - uCamPos;
  float tt = clamp(-dot(uCamPos, D) / max(dot(D, D), 1e-4), 0.0, 1.0);
  return smoothstep(1.0, 1.045, length(uCamPos + D * tt));
}
`;

const VERT = /* glsl */ `
${COMMON}
in vec2 aSeg;     // t along the strip, side (-1 / +1)
out vec4 vCol;
out vec4 vInfo;   // x = along the lit tail (0 at its end, 1 at the head), y = side, z = path param, w = kind
out vec2 vRoute;  // route hairline strength, route length in px

void main() {
  float start = aTimes.x;
  float dur = max(aTimes.y, 0.001);
  float life = aTimes.z;
  bool still = aTimes.w > 3.5;
  float kind = still ? aTimes.w - 4.0 : aTimes.w;
  float age = uTime - start;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec3 A; vec3 P1; vec3 P2; vec3 B; float L;
  route(A, P1, P2, B, L);
  float pathPx = L * uProjScale / max(length(0.5 * (A + B) - uCamPos), 0.3);
  float guide = kind > 0.5 && kind < 1.5 ? 1.0 : 0.0;
  float hd = guide > 0.5 ? clamp(age / dur, 0.0, 1.0) : (still ? 1.0 : headAt(age, dur, kind));
  float post = max(age - dur, 0.0);
  // The lit tail: about 30 percent of the route, never shorter than 70 px nor longer than 340 px; once the head has
  // arrived the tail drains into the end of the route.
  float trailT = clamp(0.34, 80.0 * uPxScale / max(pathPx, 1.0), 380.0 * uPxScale / max(pathPx, 1.0));
  float tailT = hd < 1.0 ? max(hd - trailT, 0.0) : (1.0 - trailT) + trailT * smoothstep(0.0, 0.34, post);
  if (still) tailT = 1.0 - trailT;
  float headT = max(min(hd, 1.0), 1e-3);
  float tt = aSeg.x;
  float t = tt * headT;
  float k = clamp((t - tailT) / max(headT - tailT, 1e-3), 0.0, 1.0);
  vec3 P = bez(A, P1, P2, B, t);
  vec3 Pa = bez(A, P1, P2, B, clamp(t + 0.015, 0.0, 1.0));
  vec3 Pb = bez(A, P1, P2, B, clamp(t - 0.015, 0.0, 1.0));
  vec4 c = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 ca = projectionMatrix * viewMatrix * vec4(Pa, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(Pb, 1.0);
  if (c.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec2 d = (ca.xy / max(ca.w, 1e-3) - cb.xy / max(cb.w, 1e-3)) * uViewport * 0.5;
  float len = length(d);
  vec2 dirS = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirS.y, dirS.x);
  // The tail thins to nothing at its end; a hairline marks the rest of the route. Guides stay hairline.
  float wBase = aEnds.w * 1.7 * uPxScale;
  float lineW = (guide > 0.5 ? 0.9 : 0.6) * uPxScale;
  // The head end is round, not cut square (the sprite covers the very tip), and the tail narrows as it drains.
  float cx = clamp((k - 0.86) / 0.14, 0.0, 1.0);
  float cap = sqrt(max(1.0 - cx * cx, 0.0));
  float drain = still ? 1.0 : 1.0 - smoothstep(0.02, 0.32, post);
  float w = max(lineW, guide > 0.5 ? 0.0 : wBase * pow(k, 0.8) * cap * (0.35 + 0.65 * drain));
  gl_Position = c;
  gl_Position.xy += perp * aSeg.y * w * 2.0 / uViewport * c.w;
  float fadeIn = smoothstep(0.0, still ? 0.22 : 0.07, age);
  float fadeOut = 1.0 - smoothstep(max(life - 0.45, dur + 0.25), life, age);
  // The route's own light: a hairline while the head flies, draining away once it has arrived.
  // (It cools with distance behind the head, so the route reads as an afterglow, never as a wire drawn across the planet.)
  float route = guide > 0.5 ? 1.0 : (0.14 * exp(-(headT - t) * 3.2) * (1.0 - smoothstep(0.0, 0.6, post)));
  float sight = clearSight(P) * smoothstep(0.0, 0.05, t + (guide > 0.5 ? 0.05 : 0.0));
  vec3 col = mix(aColA.rgb, aColB.rgb, smoothstep(0.0, 0.55, t));
  vCol = vec4(col * aColA.a * fadeIn * fadeOut * sight * (guide > 0.5 ? 1.0 : mix(1.0, drain, step(0.0001, post))), 1.0);
  vInfo = vec4(k, aSeg.y, t, kind);
  vRoute = vec2(route, pathPx);
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
in vec4 vCol;
in vec4 vInfo;
in vec2 vRoute;
void main() {
  float side = abs(vInfo.y);
  vec3 tint = vCol.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, vec3(lum), 0.72);
  vec3 col;
  if (vInfo.w > 0.5 && vInfo.w < 1.5) {
    // A guide: dashes marching toward the payee.
    float reveal = smoothstep(0.0, 1.0, vInfo.x);
    float px = vInfo.z * vRoute.y;
    float dash = 1.0 - smoothstep(0.38, 0.46, abs(fract(px / 10.0 - uTime * 0.55) - 0.5));
    float across = 1.0 - smoothstep(0.25, 1.0, side);
    float core = 1.0 - smoothstep(0.0, 0.5, side);
    col = tint * (0.4 * across + 0.6 * core) * dash * (0.5 + 0.5 * reveal);
  } else {
    // The tail: bright toward the head, thinning to nothing; the hairline of the route under it.
    float k = vInfo.x;
    float across = exp(-side * side * 3.4);
    float core = exp(-side * side * 15.0);
    float lit = pow(k, 1.35);
    float line = exp(-side * side * 2.6);
    col = tint * (across * 1.0 + core * 0.8) * lit + hot * core * pow(k, 4.0) * 2.6 + tint * line * vRoute.x;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// The head: a sprite that follows it, in CSS pixels, so it is the same size at any distance.
const HEAD_VERT = /* glsl */ `
${COMMON}
out vec2 vQ;
out vec4 vCol;
out vec2 vTime;   // age (s), seconds since arrival

void main() {
  float start = aTimes.x;
  float dur = max(aTimes.y, 0.001);
  float kind = aTimes.w;
  float age = uTime - start;
  // (A guide has no head, and neither does a still ray: reduced motion lights the end of the route at once.)
  if (age < 0.0 || age > dur + 0.22 || (kind > 0.5 && kind < 1.5) || kind > 3.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  vec3 A; vec3 P1; vec3 P2; vec3 B; float L;
  route(A, P1, P2, B, L);
  float hd = headAt(age, dur, kind);
  vec3 P = bez(A, P1, P2, B, hd);
  // A head that leaves or lands on the moon sits at a point inside a piece: lift it toward the camera (it does not
  // move on screen) so the light shows on the face instead of sinking into the glass.
  P += normalize(uCamPos - P) * 0.045;
  vec4 c = projectionMatrix * viewMatrix * vec4(P, 1.0);
  if (c.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  float R = 32.0 * uPxScale;
  gl_Position = c;
  gl_Position.xy += position.xy * R * 2.0 / uViewport * c.w;
  vQ = position.xy;
  float post = max(age - dur, 0.0);
  float fade = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.0, 0.16, post));
  float sight = clearSight(P) * smoothstep(0.0, 0.05, hd);
  vec3 col = mix(aColA.rgb, aColB.rgb, smoothstep(0.0, 0.55, hd));
  vCol = vec4(col * aColA.a * fade * sight, 1.0);
  vTime = vec2(age, post);
}`;

const HEAD_FRAG = /* glsl */ `
in vec2 vQ;
in vec4 vCol;
in vec2 vTime;
void main() {
  vec2 p = vQ * 32.0;                 // CSS px from the head
  float r = length(p);
  vec3 tint = vCol.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, vec3(lum), 0.8);
  float halo = exp(-r * r / 130.0) * 0.8 + exp(-r / 14.0) * 0.16;
  float core = exp(-r * r / 8.0) * 3.6;
  // A fine four-point star: brightest as the beam leaves and as it lands.
  float arm = exp(-abs(p.x) / 8.5) * exp(-p.y * p.y / 0.5) + exp(-abs(p.y) / 8.5) * exp(-p.x * p.x / 0.5);
  float flare = 0.4 + 0.6 * max(exp(-vTime.x / 0.12), exp(-vTime.y / 0.08));
  vec3 col = tint * halo + hot * (core + arm * 0.7 * flare);
  col *= 1.0 - smoothstep(0.82, 1.0, length(vQ));
  gl_FragColor = vec4(col, 1.0);
}`;

export class RayLayer {
  /** The ribbon and the head sprites of every ray. */
  readonly mesh: THREE.Group;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly headGeometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly headMaterial: THREE.ShaderMaterial;
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
    this.headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.headGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.ends = new Float32Array(capacity * 4);
    this.times = new Float32Array(capacity * 4);
    this.colA = new Float32Array(capacity * 4);
    this.colB = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.times[i * 4 + 2] = -1;
    const mk = (arr: Float32Array, name: string): void => {
      const b = new THREE.InstancedBufferAttribute(arr, 4);
      b.setUsage(THREE.DynamicDrawUsage);
      // The ribbon and the head read the same instance data.
      this.geometry.setAttribute(name, b);
      this.headGeometry.setAttribute(name, b);
      this.bufs.push(b);
    };
    mk(this.ends, 'aEnds');
    mk(this.times, 'aTimes');
    mk(this.colA, 'aColA');
    mk(this.colB, 'aColB');
    this.geometry.instanceCount = 0;
    this.headGeometry.instanceCount = 0;

    const uniforms = {
      uPosTex: u.uPosTex,
      uViewport: u.uViewport,
      uPxScale: u.uPxScale,
      uProjScale: u.uProjScale,
      uTime: u.uTime,
      uCamPos: u.uCamPos,
      uAnchor: u.uAnchor,
    };
    const additive = {
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
    } as const;
    this.material = new THREE.ShaderMaterial({
      ...additive,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      // Pulled a hair toward the camera, so a route that starts on the surface does not fight the planet's own depth.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.headMaterial = new THREE.ShaderMaterial({ ...additive, vertexShader: HEAD_VERT, fragmentShader: HEAD_FRAG, uniforms });
    const ribbon = new THREE.Mesh(this.geometry, this.material);
    ribbon.frustumCulled = false;
    ribbon.renderOrder = renderOrder;
    const head = new THREE.Mesh(this.headGeometry, this.headMaterial);
    head.frustumCulled = false;
    head.renderOrder = renderOrder + 0.5;
    this.mesh = new THREE.Group();
    this.mesh.add(ribbon, head);
    this.mesh.visible = false;
  }

  /**
   * Adds a ray. Endpoints are node slots or `ANCHOR_BASE + k`; `widthPx` is the tail's half width at the
   * head, CSS px; `dur` is the head's flight and `life` how long the whole ray stays in the pool.
   * Returns the ray index or -1 when the pool is full.
   */
  add(
    a: number, b: number, kind: number, start: number, dur: number, life: number, widthPx: number,
    ar: number, ag: number, ab: number, br: number, bg: number, bb: number, intensity: number,
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
    this.headGeometry.instanceCount = this.high;
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
    this.headGeometry.dispose();
    this.material.dispose();
    this.headMaterial.dispose();
  }
}

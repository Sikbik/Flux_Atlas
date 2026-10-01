// Ribbon layer: arcs, gossip packets, beams and faint mesh links, all as instanced screen-space
// ribbons evaluated entirely on the GPU. An instance only stores the two node slots it connects
// (or two free points) plus timing; the vertex shader fetches the nodes' current display positions
// from the position texture, builds the great-circle arc, and expands it to a constant pixel width.
// That keeps thousands of moving packets at a few bytes each and makes them follow nodes as the
// stacks fan out.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_POS_TEX } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';

/** Arc: progressive solid arc. Packet: linear comet. Beam: vertical pillar. Link: faint mesh veil. Dashed: inbound peer. Comet: eased payment beam. Tree: low constellation edge with gaps at the nodes. */
export const RibbonStyle = { Arc: 0, Packet: 1, Beam: 2, Link: 3, Dashed: 4, Comet: 5, Tree: 6 } as const;

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_POS_TEX}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uTime;
uniform float uFocus;
uniform vec3 uCamPos;
in vec2 aSeg;     // t along the strip, side (-1 / +1)
in vec4 aEnds;    // slot A, slot B (negative = free endpoint), lift (negative = auto), width px
in vec4 aTimes;   // start, duration, life, style
in vec4 aColor;   // rgb, intensity
in vec3 aPosA;
in vec3 aPosB;
out vec4 vColor;
out vec4 vInfo;   // x = along strip, y = side, z = arc distance (radians), w = style
out float vHead;
out float vScale; // pixels per radian along the arc (for dash patterns)

vec3 endpoint(float slot, vec3 fallback) {
  if (slot < -0.5) return fallback;
  vec4 p = fetchPos(slot);
  return p.w > 0.0 ? p.xyz : fallback;
}

// Mesh-style arcs hug the globe: 0.008R for a short hop up to about 0.11R for an antipodal one.
float autoLift(float w) { return 0.008 + 0.1 * (w / PI); }

vec3 curvePoint(float t, vec3 A, vec3 B, float lift, float style, float w) {
  float ra = length(A);
  float rb = length(B);
  vec3 a = A / ra;
  vec3 b = B / rb;
  if (style > 1.5 && style < 2.5) return a * (ra + lift * t);
  vec3 dir = w < 1e-3 ? a : (sin((1.0 - t) * w) * a + sin(t * w) * b) / sin(w);
  float arcLift = lift >= 0.0 ? lift : autoLift(w);
  float r = mix(ra, rb, t) + arcLift * 4.0 * t * (1.0 - t);
  return dir * r;
}

float easeInOut(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5; }

void main() {
  float start = aTimes.x;
  float dur = max(aTimes.y, 0.001);
  float life = aTimes.z;
  float style = aTimes.w;
  float age = uTime - start;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  vec3 A = endpoint(aEnds.x, aPosA);
  vec3 B = endpoint(aEnds.y, aPosB);
  vec3 a = normalize(A);
  vec3 b = normalize(B);
  float w = min(acos(clamp(dot(a, b), -1.0, 1.0)), 3.1);
  float lift = aEnds.z;
  float tt = aSeg.x;
  float head = clamp(age / dur, 0.0, 1.0);
  float fadeOut = 1.0 - smoothstep(max(life - 0.9, 0.0), life, age);
  float intensity = aColor.a;
  float t;
  float widthPx = aEnds.w * uPxScale;
  float pxLen = max(w * uProjScale / max(length(A - uCamPos), 0.5), 1.0);
  if (style < 0.5 || (style > 3.5 && style < 4.5)) {
    // Arc (solid) and dashed arc: drawn progressively from A to B, then held.
    t = tt * head;
  } else if (style > 5.5) {
    // Tree edge: a low line that stops 6px short of each node.
    float gapT = min(0.4, 6.0 * uPxScale / pxLen);
    t = mix(gapT, 1.0 - gapT, tt * head);
  } else if (style < 1.5 || style > 4.5) {
    // Packet (linear) and comet (ease-in-out): a bright streak with a 14% trail. Gossip packets
    // also cap the streak at about 34px so a long haul does not become a laser.
    float tail = style > 4.5 ? 0.14 : clamp(34.0 * uPxScale / pxLen, 0.015, 0.14);
    float hd = style > 4.5 ? easeInOut(head) : head;
    float h = hd * (1.0 + tail);
    float t1 = clamp(h, 0.0, 1.0);
    float t0 = clamp(h - tail, 0.0, 1.0);
    t = mix(t0, t1, tt);
    widthPx *= mix(0.25, 1.0, tt);
    fadeOut = head >= 1.0 ? 0.0 : 1.0;
  } else if (style < 2.5) {
    t = tt * head;
    widthPx *= mix(1.0, 0.35, tt);
  } else {
    // Link veil: fades in over 'dur', thins toward the hubs so dense regions never saturate.
    t = tt;
    intensity *= smoothstep(0.0, 1.0, head) * pow(max(sin(PI * tt), 0.0), 0.55);
  }
  vec3 P = curvePoint(t, A, B, lift, style, w);
  float dt = 0.02;
  vec3 Pa = curvePoint(clamp(t + dt, 0.0, 1.0), A, B, lift, style, w);
  vec3 Pb = curvePoint(clamp(t - dt, 0.0, 1.0), A, B, lift, style, w);
  vec4 c = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 ca = projectionMatrix * viewMatrix * vec4(Pa, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(Pb, 1.0);
  if (c.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  vec2 d = (ca.xy / max(ca.w, 1e-3) - cb.xy / max(cb.w, 1e-3)) * uViewport * 0.5;
  float len = length(d);
  vec2 dirS = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirS.y, dirS.x);
  gl_Position = c;
  gl_Position.xy += perp * aSeg.y * widthPx * 2.0 / uViewport * c.w;
  vColor = vec4(aColor.rgb * intensity * fadeOut, 1.0);
  vInfo = vec4(tt, aSeg.y, t * w, style);
  vHead = head;
  vScale = uProjScale / c.w;
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
uniform vec3 uHot;
in vec4 vColor;
in vec4 vInfo;
in float vHead;
in float vScale;
void main() {
  float side = abs(vInfo.y);
  float across = 1.0 - smoothstep(0.3, 1.0, side);
  float core = 1.0 - smoothstep(0.0, 0.55, side);
  float style = vInfo.w;
  vec3 tint = vColor.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, uHot * lum, 0.78);
  vec3 col;
  if (style < 0.5 || style > 5.5) {
    // Solid arc: a soft glow with a slow travelling shimmer, brighter toward the destination.
    float flow = 0.42 + 0.58 * pow(0.5 + 0.5 * sin(vInfo.z * 42.0 - uTime * 3.2), 3.0);
    float drawing = 1.0 - smoothstep(0.85, 1.0, vHead);
    float headGlow = exp(-pow((1.0 - vInfo.x) * 7.0, 2.0)) * drawing;
    float toward = 0.55 + 0.45 * vInfo.x;
    col = tint * (across * 0.5 * flow + core * 0.42) * toward + hot * headGlow * 2.0 * core;
  } else if (style < 1.5) {
    float f = pow(vInfo.x, 2.0);
    float headDot = exp(-pow((1.0 - vInfo.x) * 5.0, 2.0));
    col = tint * across * f * 1.6 + hot * core * headDot * 1.6;
  } else if (style < 2.5) {
    col = tint * across * (1.0 - vInfo.x * 0.8) * 1.1 + hot * core * (1.0 - vInfo.x) * 1.4;
  } else if (style < 3.5) {
    col = tint * across;
  } else if (style < 4.5) {
    // Dashed arc (inbound peers): 2px dash, 4px gap along the arc.
    float px = vInfo.z * vScale;
    float dash = 1.0 - smoothstep(0.15, 0.19, abs(fract(px / 6.0) - 0.5));
    float drawing = 1.0 - smoothstep(0.9, 1.0, vHead);
    col = tint * (across * 0.75 + core * 0.3) * dash * (0.45 + 0.55 * vInfo.x) + hot * exp(-pow((1.0 - vInfo.x) * 7.0, 2.0)) * drawing * core * 1.2;
  } else {
    // Comet: hot white head, cool tail.
    float f = pow(vInfo.x, 1.6);
    float headDot = exp(-pow((1.0 - vInfo.x) * 4.0, 2.0));
    col = tint * across * f * 1.5 + hot * core * headDot * 2.0 + hot * across * headDot * 0.6;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class RibbonLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly ends: Float32Array;
  private readonly times: Float32Array;
  private readonly color: Float32Array;
  private readonly posA: Float32Array;
  private readonly posB: Float32Array;
  private readonly bufs: THREE.InstancedBufferAttribute[] = [];
  private readonly free: Uint32Array;
  private freeN = 0;
  high = 0;
  count = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -1;

  constructor(
    u: SharedUniforms,
    capacity: number,
    segments: number,
    renderOrder = 40,
  ) {
    this.capacity = capacity;
    // Strip geometry: (segments + 1) * 2 vertices.
    const n = (segments + 1) * 2;
    const seg = new Float32Array(n * 2);
    const pos = new Float32Array(n * 3);
    const idx: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      seg.set([t, -1], i * 4);
      seg.set([t, 1], i * 4 + 2);
      if (i < segments) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); // required by three; unused
    this.geometry.setAttribute('aSeg', new THREE.BufferAttribute(seg, 2));
    this.geometry.setIndex(idx);

    this.ends = new Float32Array(capacity * 4);
    this.times = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    this.posA = new Float32Array(capacity * 3);
    this.posB = new Float32Array(capacity * 3);
    this.times.fill(0);
    for (let i = 0; i < capacity; i++) this.times[i * 4 + 2] = -1; // life < 0: inactive
    const mk = (arr: Float32Array, size: number, name: string): void => {
      const b = new THREE.InstancedBufferAttribute(arr, size);
      b.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, b);
      this.bufs.push(b);
    };
    mk(this.ends, 4, 'aEnds');
    mk(this.times, 4, 'aTimes');
    mk(this.color, 4, 'aColor');
    mk(this.posA, 3, 'aPosA');
    mk(this.posB, 3, 'aPosB');
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
        uFocus: u.uFocus,
        uHot: u.uBlock,
        uCamPos: u.uCamPos,
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
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  private take(): number {
    if (this.freeN > 0) return this.free[--this.freeN];
    if (this.high >= this.capacity) return -1;
    return this.high++;
  }

  private touch(i: number): void {
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  /** Adds a ribbon between two node slots. Returns its index or -1 if the pool is full. */
  add(
    slotA: number,
    slotB: number,
    style: number,
    start: number,
    dur: number,
    life: number,
    lift: number,
    widthPx: number,
    r: number,
    g: number,
    b: number,
    intensity: number,
  ): number {
    const i = this.take();
    if (i < 0) return -1;
    const e = i * 4;
    this.ends[e] = slotA;
    this.ends[e + 1] = slotB;
    this.ends[e + 2] = lift;
    this.ends[e + 3] = widthPx;
    this.times[e] = start;
    this.times[e + 1] = dur;
    this.times[e + 2] = life;
    this.times[e + 3] = style;
    this.color[e] = r;
    this.color[e + 1] = g;
    this.color[e + 2] = b;
    this.color[e + 3] = intensity;
    this.touch(i);
    this.count++;
    return i;
  }

  /** Adds a ribbon between two free points (unit-sphere positions scaled by radius). */
  addFree(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    style: number, start: number, dur: number, life: number, lift: number, widthPx: number,
    r: number, g: number, b: number, intensity: number,
  ): number {
    const i = this.add(-1, -1, style, start, dur, life, lift, widthPx, r, g, b, intensity);
    if (i < 0) return -1;
    this.posA[i * 3] = ax;
    this.posA[i * 3 + 1] = ay;
    this.posA[i * 3 + 2] = az;
    this.posB[i * 3] = bx;
    this.posB[i * 3 + 1] = by;
    this.posB[i * 3 + 2] = bz;
    return i;
  }

  /** Starts fading a ribbon out now. */
  fadeOut(i: number, time: number, fade = 0.6): void {
    if (i < 0 || i >= this.high) return;
    const e = i * 4;
    const age = time - this.times[e];
    if (this.times[e + 2] < 0) return;
    this.times[e + 2] = Math.min(this.times[e + 2], age + fade);
    this.touch(i);
  }

  /** Changes the lift of a live ribbon (a pillar that follows the zoom). No-op if the slot was reused. */
  setLift(i: number, start: number, lift: number): void {
    if (!this.isActive(i, start)) return;
    this.ends[i * 4 + 2] = lift;
    this.touch(i);
  }

  /** Is this slot still an active ribbon with the same start time (guards against reuse)? */
  isActive(i: number, start: number): boolean {
    return i >= 0 && i < this.high && this.times[i * 4 + 2] >= 0 && this.times[i * 4] === Math.fround(start);
  }

  /** Retires finished ribbons and uploads what changed. */
  update(time: number): void {
    const t = this.times;
    for (let i = 0; i < this.high; i++) {
      const life = t[i * 4 + 2];
      if (life >= 0 && time > t[i * 4] + life + 0.05) {
        t[i * 4 + 2] = -1;
        this.free[this.freeN++] = i;
        this.count--;
        this.touch(i);
      }
    }
    // Shrink the draw range past trailing inactive entries.
    let h = this.high;
    while (h > 0 && t[(h - 1) * 4 + 2] < 0) h--;
    if (h !== this.high) {
      this.high = h;
      // Rebuild the free list without the trimmed tail.
      this.freeN = 0;
      for (let i = 0; i < h; i++) if (t[i * 4 + 2] < 0) this.free[this.freeN++] = i;
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
    for (let i = 0; i < this.capacity; i++) this.times[i * 4 + 2] = -1;
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

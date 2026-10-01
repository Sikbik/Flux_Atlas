// The moon's screen-space dressing (design 7.10.3): the glow, the block clock (a hexagon that fills
// over the block interval), the receive rings, the hover circle, the white bloom behind a firing
// piece, the dashed outlines of the pieces still on their way during the boot, the dotted orbit and the chain of sealed blocks on it (a bead per block, a hairline between
// them, the newest link running to the moon). Two additive quads, no geometry to speak of:
// everything is a distance field evaluated in CSS pixels, so the lines keep their designed widths
// at any size or device pixel ratio.

import * as THREE from 'three';
import { TAU } from '../math';
import type { GlobeTokens } from '../tokens';
import type { Orbit } from './placement';

const QUAD_VERT = /* glsl */ `
uniform vec2 uCenter;
uniform vec2 uCss;
uniform vec2 uHalf;
out vec2 vPx;
void main() {
  vec2 px = uCenter + position.xy * uHalf;
  vPx = px;
  gl_Position = vec4(px.x / uCss.x * 2.0 - 1.0, 1.0 - px.y / uCss.y * 2.0, 0.0, 1.0);
}`;

const HUD_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uCenter;
uniform float uS;
uniform float uK;
uniform float uPxScale;
uniform vec3 uGlowCol;
uniform vec3 uRingCol;
uniform float uGlowA;
uniform float uFlash;
uniform float uHover;
uniform float uBeat;
uniform float uRingA;
uniform float uRingFlash;
uniform float uRecv;
uniform float uLite;
uniform float uPieceF[4];
uniform vec2 uPieceP[4];
uniform vec2 uPoly[32];       // the four outlines, in symbol units
uniform float uPolyCum[32];   // arc length up to each vertex, symbol units
uniform vec2 uPieceB[4];      // first vertex, vertex count
uniform float uOut[4];        // dashed outline alpha (boot: a piece that has not landed yet)
uniform vec4 uSkew;
in vec2 vPx;

const float PI = 3.14159265;

float aaw() { return 0.8 / uPxScale; }
float band(float d, float w) { return 1.0 - smoothstep(w * 0.5 - aaw(), w * 0.5 + aaw(), d); }

// The glow sprite's radial stops (alpha), as in the design: 0.95, 0.5, 0.16, 0.04, 0.
float glowGrad(float t) {
  if (t >= 1.0) return 0.0;
  if (t < 0.22) return mix(0.95, 0.5, t / 0.22);
  if (t < 0.5) return mix(0.5, 0.16, (t - 0.22) / 0.28);
  if (t < 0.78) return mix(0.16, 0.04, (t - 0.5) / 0.28);
  return mix(0.04, 0.0, (t - 0.78) / 0.22);
}
// The white halo sprite: 1, 0.45, 0.1, 0.
float haloGrad(float t) {
  if (t >= 1.0) return 0.0;
  if (t < 0.28) return mix(1.0, 0.45, t / 0.28);
  if (t < 0.6) return mix(0.45, 0.1, (t - 0.28) / 0.32);
  return mix(0.1, 0.0, (t - 0.6) / 0.4);
}
float easeOutExpo(float t) { return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t); }

vec2 symPx(vec2 v) { return vec2(uSkew.x * v.x + uSkew.y * v.y, -(uSkew.z * v.x + uSkew.w * v.y)) * uK; }

vec2 hexVert(int k, float rho) {
  float a = (-90.0 + 60.0 * float(k)) * 0.01745329;
  return rho * vec2(cos(a), sin(a));
}

void main() {
  vec2 p = vPx - uCenter;
  float r = length(p);
  vec3 col = vec3(0.0);

  if (uLite < 0.5) {
    // Glow: a Blue Wave sprite 3.3 heights wide; on a flash a white halo 2 heights wide joins it.
    col += uGlowCol * glowGrad(r / (uS * 1.65)) * uGlowA;
    col += vec3(1.0) * haloGrad(r / uS) * 0.55 * uFlash;
    // The firing piece blooms white behind its face (never a tier color).
    for (int i = 0; i < 4; i++) {
      float pf = uPieceF[i];
      if (pf > 0.002) col += vec3(1.0) * haloGrad(length(p - uPieceP[i]) / (170.0 * uK)) * 0.7 * pf;
    }
  }

  // Boot: until a piece lands its outline is drawn dashed in the light blue, so the shape shows being filled.
  for (int k = 0; k < 4; k++) {
    float oa = uOut[k];
    if (oa < 0.004) continue;
    int st = int(uPieceB[k].x + 0.5);
    int n = int(uPieceB[k].y + 0.5);
    float best = 1e9;
    float at = 0.0;
    for (int j = 0; j < 8; j++) {
      if (j >= n) break;
      int j1 = j + 1 >= n ? 0 : j + 1;
      vec2 a = symPx(uPoly[st + j]);
      vec2 b = symPx(uPoly[st + j1]);
      vec2 ab = b - a;
      float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float dd = length(p - (a + ab * t));
      if (dd < best) {
        best = dd;
        at = (uPolyCum[st + j] + t * length(uPoly[st + j1] - uPoly[st + j])) * uK;
      }
    }
    float dash = 1.0 - smoothstep(5.0 - aaw(), 5.0 + aaw(), mod(at, 9.0));
    col += uRingCol * 0.9 * oa * band(best, 1.3) * dash;
  }

  // The block clock: a pointy-top hexagon, circumradius 0.70 of the height.
  if (uRingA > 0.002) {
    float rho = 0.70 * uS;
    float m = max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.8660254))), abs(dot(p, vec2(0.5, -0.8660254)))));
    float d = abs(m - rho * 0.8660254);
    // Position along the perimeter, clockwise from the top vertex (0..1).
    float phi = mod(atan(p.y, p.x) + PI * 0.5, 2.0 * PI);
    float sector = floor(phi / (PI / 3.0));
    float al = phi - sector * (PI / 3.0);
    float sp = (sector + 0.5 + 0.8660254 * tan(al - PI / 6.0)) / 6.0;
    float prog = clamp(uBeat, 0.0, 1.0);
    float on = prog >= 0.9995 ? 1.0 : 1.0 - smoothstep(prog - 0.0025, prog + 0.0025, sp);
    col += uRingCol * 0.16 * uRingA * band(d, 1.1);
    col += uRingCol * (0.22 + 0.4 * uRingFlash) * uRingA * band(d, 5.0) * on;
    col += uRingCol * (0.85 + 0.15 * uRingFlash) * uRingA * band(d, 1.7) * on;
    // A white dot rides the head of the stroke.
    float pk = prog * 6.0;
    int k0 = int(floor(min(pk, 5.9999)));
    vec2 head = mix(hexVert(k0, rho), hexVert(k0 == 5 ? 0 : k0 + 1, rho), pk - float(k0));
    col += vec3(1.0) * uRingA * (1.0 - smoothstep(2.3 - aaw(), 2.3 + aaw(), length(p - head)));
  }

  // Two thin rings leave the moon when it receives a block.
  if (uRecv >= 0.0 && uRecv <= 1.0) {
    float u = uRecv;
    float rr = uS * (0.55 + 1.5 * easeOutExpo(u));
    col += uRingCol * 0.7 * (1.0 - u) * band(abs(r - rr), 1.6 * (1.0 - u) + 0.5);
    col += vec3(1.0) * 0.45 * (1.0 - u) * band(abs(r - rr * 0.86), 0.8);
  }

  // Hover: a white hairline circle of radius 0.86 heights.
  col += vec3(1.0) * 0.5 * uHover * band(abs(r - 0.86 * uS), 1.0);

  gl_FragColor = vec4(col, 1.0);
}`;

const ORBIT_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uOrb;
uniform vec2 uRot;
uniform float uPhase;
uniform float uPxScale;
uniform vec3 uEdge;
uniform vec3 uEdgeHi;
uniform float uGuideA;
uniform float uChainA;
uniform int uBeadN;
uniform vec4 uBead[24];   // phase on the ellipse, age 0..1, birth flash 0..1, radius (px)
in vec2 vPx;

const float TAU = 6.2831853;
float aaw() { return 0.8 / uPxScale; }
float band(float d, float w) { return 1.0 - smoothstep(w * 0.5 - aaw(), w * 0.5 + aaw(), d); }
// Pointy-top hexagon of circumradius r.
float hexD(vec2 p, float r) {
  p = abs(p);
  return max(p.x, dot(p, vec2(0.5, 0.8660254))) - 0.8660254 * r;
}

void main() {
  vec2 p = vPx - uOrb.xy;
  vec2 q = vec2(p.x * uRot.x + p.y * uRot.y, -p.x * uRot.y + p.y * uRot.x);
  float a = uOrb.z;
  float b = uOrb.w;
  float f = q.x * q.x / (a * a) + q.y * q.y / (b * b) - 1.0;
  vec2 g = 2.0 * vec2(q.x / (a * a), q.y / (b * b));
  float d = abs(f) / max(length(g), 1e-5);
  if (d > 14.0) discard;
  float th = atan(q.y / b, q.x / a);
  vec3 col = vec3(0.0);
  // A dotted hairline along the whole path: 1.5 px dashes with 7 px gaps, Flux light blue at 16%.
  float arc = th * 0.5 * (a + b);
  float dash = 1.0 - smoothstep(1.5 - aaw(), 1.5 + aaw(), mod(arc, 8.5));
  col += uEdgeHi * 0.16 * band(d, 1.0) * dash * uGuideA;

  // The chain: a link between consecutive beads (a 1.1 px hairline, 50% fresh to 10% old), the newest
  // link running from the last bead to the moon, and a flat hexagon for every sealed block.
  if (uBeadN > 0 && uChainA > 0.002) {
    for (int i = 0; i < 24; i++) {
      if (i >= uBeadN) break;
      float t0 = uBead[i].x;
      float t1 = i + 1 < uBeadN ? uBead[i + 1].x : uPhase;
      float span = mod(t1 - t0, TAU);
      if (span < 4.0 && mod(th - t0, TAU) <= span) col += uEdgeHi * mix(0.5, 0.1, uBead[i].y) * band(d, 1.1) * uChainA;
      // The bead itself.
      float c0 = cos(t0) * a;
      float s0 = sin(t0) * b;
      vec2 c = uOrb.xy + vec2(c0 * uRot.x - s0 * uRot.y, c0 * uRot.y + s0 * uRot.x);
      float r = uBead[i].w;
      float hd = hexD(vPx - c, r);
      if (hd < 2.0) {
        float fill = 1.0 - smoothstep(-aaw(), aaw(), hd);
        float edge = band(abs(hd + 0.65), 1.3);
        float ageF = uBead[i].y;
        float fl = uBead[i].z;
        col += uEdge * mix(0.6, 0.2, ageF) * fill * uChainA;
        col += uEdgeHi * mix(1.0, 0.4, ageF) * edge * uChainA;
        // Born with a white flash that settles.
        col += vec3(1.0) * fl * (0.55 * fill + 0.6 * edge) * uChainA;
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface HudState {
  cssW: number;
  cssH: number;
  pxScale: number;
  x: number;
  y: number;
  /** Symbol height in CSS pixels, and pixels per mark unit. */
  s: number;
  k: number;
  glowA: number;
  flash: number;
  hover: number;
  beat: number;
  ringA: number;
  ringFlash: number;
  /** Receive-ring progress 0..1, or negative when idle. */
  recv: number;
  lite: boolean;
  pieceFlash: ArrayLike<number>;
  /** Piece centers relative to the moon's center, CSS pixels (x, y pairs). */
  piecePx: ArrayLike<number>;
  orbit: Orbit;
  phase: number;
  guideA: number;
  /** 0..1 for the chain of beads (off in the lite tier and under reduced motion). */
  chainA: number;
  /** The chain, from `MoonChain.companionBeads`: four floats per bead. */
  beads: Float32Array;
  beadN: number;
  /** Dashed outline alpha per piece (boot), in this mesh's piece order. */
  outline: ArrayLike<number>;
  skew: THREE.Vector4;
  /** 0..1 fade for everything (the moon lifting into the sky, or hidden). */
  alpha: number;
}

const additive = {
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
} as const;

export class MoonHud {
  readonly orbit: THREE.Mesh;
  readonly glow: THREE.Mesh;
  private readonly hudMat: THREE.ShaderMaterial;
  private readonly orbMat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly pieceF = new Float32Array(4);
  private readonly outF = new Float32Array(4);
  private readonly pieceP = [0, 1, 2, 3].map(() => new THREE.Vector2());

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.hudMat = new THREE.ShaderMaterial({
      ...additive,
      vertexShader: QUAD_VERT,
      fragmentShader: HUD_FRAG,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uCss: { value: new THREE.Vector2(1, 1) },
        uHalf: { value: new THREE.Vector2(100, 100) },
        uS: { value: 65 },
        uK: { value: 0.2 },
        uPxScale: { value: 1 },
        uGlowCol: { value: new THREE.Color('#2b61d1') },
        uRingCol: { value: new THREE.Color('#86a1da') },
        uGlowA: { value: 0 },
        uFlash: { value: 0 },
        uHover: { value: 0 },
        uBeat: { value: 0 },
        uRingA: { value: 1 },
        uRingFlash: { value: 0 },
        uRecv: { value: -1 },
        uLite: { value: 0 },
        uPieceF: { value: this.pieceF },
        uPieceP: { value: this.pieceP },
        uPoly: { value: Array.from({ length: 32 }, () => new THREE.Vector2()) },
        uPolyCum: { value: new Float32Array(32) },
        uPieceB: { value: [0, 1, 2, 3].map(() => new THREE.Vector2()) },
        uOut: { value: this.outF },
        uSkew: { value: new THREE.Vector4(1, 0, 0, 1) },
      },
    });
    this.orbMat = new THREE.ShaderMaterial({
      ...additive,
      vertexShader: QUAD_VERT,
      fragmentShader: ORBIT_FRAG,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uCss: { value: new THREE.Vector2(1, 1) },
        uHalf: { value: new THREE.Vector2(1, 1) },
        uOrb: { value: new THREE.Vector4() },
        uRot: { value: new THREE.Vector2(1, 0) },
        uPhase: { value: 0 },
        uPxScale: { value: 1 },
        uEdge: { value: new THREE.Color('#2b61d1') },
        uEdgeHi: { value: new THREE.Color('#86a1da') },
        uGuideA: { value: 1 },
        uChainA: { value: 1 },
        uBeadN: { value: 0 },
        uBead: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
      },
    });
    this.glow = new THREE.Mesh(this.geo, this.hudMat);
    this.orbit = new THREE.Mesh(this.geo, this.orbMat);
    for (const m of [this.glow, this.orbit]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
    }
    this.orbit.renderOrder = 1;
    this.glow.renderOrder = 2;
  }

  /** The symbol's outlines (from the mesh), for the boot's dashed outlines. */
  setShape(poly: Float32Array, pieces: { start: number; n: number }[]): void {
    const u = this.hudMat.uniforms;
    const pv = u.uPoly!.value as THREE.Vector2[];
    const cum = u.uPolyCum!.value as Float32Array;
    const pb = u.uPieceB!.value as THREE.Vector2[];
    pieces.forEach((pc, k) => {
      pb[k]!.set(pc.start, pc.n);
      let acc = 0;
      for (let j = 0; j < pc.n; j++) {
        const i = pc.start + j;
        pv[i]!.set(poly[i * 2]!, poly[i * 2 + 1]!);
        cum[i] = acc;
        const i1 = pc.start + ((j + 1) % pc.n);
        acc += Math.hypot(poly[i1 * 2]! - poly[i * 2]!, poly[i1 * 2 + 1]! - poly[i * 2 + 1]!);
      }
    });
  }

  setTokens(t: GlobeTokens): void {
    (this.hudMat.uniforms.uGlowCol!.value as THREE.Color).set(t.moonGlow);
    (this.hudMat.uniforms.uRingCol!.value as THREE.Color).set(t.moonRing);
    (this.orbMat.uniforms.uEdge!.value as THREE.Color).set(t.moonEdge);
    (this.orbMat.uniforms.uEdgeHi!.value as THREE.Color).set(t.moonEdgeHi);
  }

  update(s: HudState, showOrbit: boolean): void {
    const h = this.hudMat.uniforms;
    (h.uCenter!.value as THREE.Vector2).set(s.x, s.y);
    (h.uCss!.value as THREE.Vector2).set(s.cssW, s.cssH);
    const half = 2.15 * s.s;
    (h.uHalf!.value as THREE.Vector2).set(half, half);
    h.uS!.value = s.s;
    h.uK!.value = s.k;
    h.uPxScale!.value = s.pxScale;
    h.uGlowA!.value = s.glowA * s.alpha;
    h.uFlash!.value = s.flash * s.alpha;
    h.uHover!.value = s.hover * s.alpha;
    h.uBeat!.value = s.beat;
    h.uRingA!.value = s.ringA * s.alpha;
    h.uRingFlash!.value = s.ringFlash;
    h.uRecv!.value = s.recv;
    h.uLite!.value = s.lite ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      this.pieceF[i] = s.pieceFlash[i]! * s.alpha;
      this.outF[i] = s.outline[i]!;
      this.pieceP[i]!.set(s.piecePx[i * 2]!, s.piecePx[i * 2 + 1]!);
    }
    (h.uSkew!.value as THREE.Vector4).copy(s.skew);
    this.glow.visible = s.alpha > 0.002;

    this.orbit.visible = showOrbit && s.alpha > 0.002;
    if (this.orbit.visible) {
      const o = this.orbMat.uniforms;
      (o.uCenter!.value as THREE.Vector2).set(s.cssW * 0.5, s.cssH * 0.5);
      (o.uCss!.value as THREE.Vector2).set(s.cssW, s.cssH);
      (o.uHalf!.value as THREE.Vector2).set(s.cssW * 0.5, s.cssH * 0.5);
      (o.uOrb!.value as THREE.Vector4).set(s.orbit.cx, s.orbit.cy, s.orbit.a, s.orbit.b);
      (o.uRot!.value as THREE.Vector2).set(s.orbit.cs, s.orbit.sn);
      o.uPhase!.value = ((s.phase % TAU) + TAU) % TAU;
      o.uPxScale!.value = s.pxScale;
      o.uGuideA!.value = s.guideA * s.alpha;
      o.uChainA!.value = s.chainA * s.alpha;
      const n = Math.min(24, s.beadN);
      o.uBeadN!.value = n;
      const arr = o.uBead!.value as THREE.Vector4[];
      for (let i = 0; i < n; i++)
        arr[i]!.set(s.beads[i * 4]!, s.beads[i * 4 + 1]!, s.beads[i * 4 + 2]!, s.beads[i * 4 + 3]!);
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.hudMat.dispose();
    this.orbMat.dispose();
  }
}

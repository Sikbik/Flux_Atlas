// The moon's screen-space dressing (design 7.10.3): the glow, the block clock (a hexagon that fills
// over the block interval), the receive rings, the hover circle, the white bloom behind a firing
// piece, and the dashed outlines of the pieces still on their way during the boot. One additive quad,
// no geometry to speak of: everything is a distance field evaluated in CSS pixels, so the lines keep
// their designed widths at any size or device pixel ratio. The quad follows the moon's projected
// centre and size, and each pixel of it asks the planet (planetVisPx) whether the moon's plane is
// behind the disc there, so the glow and the ring are cut by the limb exactly as the body is. The
// moon's trail (the wake and the chain of beads) is world-space geometry and lives in chain.ts.

import * as THREE from 'three';
import type { GlobeTokens } from '../tokens';
import type { SharedUniforms } from '../uniforms';
import { PLANET_VIS_GLSL, PLANET_VIS_PLANE_GLSL } from './occlusion';

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
${PLANET_VIS_GLSL}
${PLANET_VIS_PLANE_GLSL}
uniform vec2 uCss;
uniform float uOcc;           // 0 in front of everything (the boot), 1 hidden by the planet like any world object
uniform vec2 uCenter;
uniform float uS;
uniform float uK;
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

vec2 symPx(vec2 v) { return vec2(v.x, -v.y) * uK; }

vec2 hexVert(int k, float rho) {
  float a = (-90.0 + 60.0 * float(k)) * 0.01745329;
  return rho * vec2(cos(a), sin(a));
}

void main() {
  vec2 p = vPx - uCenter;
  float r = length(p);
  vec3 col = vec3(0.0);
  // The planet hides what is behind its disc: this plane is the moon's, facing the camera.
  float vis = mix(1.0, planetVisPx(vPx, uCss), uOcc);
  if (vis < 0.002) discard;

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

  gl_FragColor = vec4(col * vis, 1.0);
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
  /** Dashed outline alpha per piece (boot), in this mesh's piece order. */
  outline: ArrayLike<number>;
  /** 0..1 fade for everything (the sky look taking over, the moon appearing, or hidden). */
  alpha: number;
  /** Distance from the camera to the moon's centre along the view axis (world units), for the planet's occlusion. */
  depth: number;
  /** 0..1: how much the planet may hide the dressing (the boot symbol is in front of everything). */
  occlusion: number;
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
  readonly glow: THREE.Mesh;
  private readonly hudMat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly pieceF = new Float32Array(4);
  private readonly outF = new Float32Array(4);
  private readonly pieceP = [0, 1, 2, 3].map(() => new THREE.Vector2());

  constructor(u: SharedUniforms) {
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
        uPxScale: u.uPxScale,
        uCamPos: u.uCamPos,
        uProjScale: u.uProjScale,
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
        uCamBack: u.uCamBack,
        uTanHalfFov: u.uTanHalfFov,
        uAspect: u.uAspect,
        uViewShift: u.uViewShift,
        uMoonDepth: { value: 4 },
        uOcc: { value: 1 },
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
      },
    });
    this.glow = new THREE.Mesh(this.geo, this.hudMat);
    this.glow.frustumCulled = false;
    this.glow.matrixAutoUpdate = false;
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
  }

  update(s: HudState): void {
    const h = this.hudMat.uniforms;
    (h.uCenter!.value as THREE.Vector2).set(s.x, s.y);
    (h.uCss!.value as THREE.Vector2).set(s.cssW, s.cssH);
    const half = 2.15 * s.s;
    (h.uHalf!.value as THREE.Vector2).set(half, half);
    h.uS!.value = s.s;
    h.uK!.value = s.k;
    h.uMoonDepth!.value = s.depth;
    h.uOcc!.value = s.occlusion;
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
    this.glow.visible = s.alpha > 0.002;
  }

  dispose(): void {
    this.geo.dispose();
    this.hudMat.dispose();
  }
}

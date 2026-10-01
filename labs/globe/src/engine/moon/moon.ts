// The Flux moon: the brand symbol, extruded, as the chain itself.
//
// Its four pieces are the four official outlines. Every real block passes through them: a beam
// climbs from the producer and seals the moon, then the moon pays out, one tier per piece (small
// hexagon Cumulus, big hexagon Nimbus, cap Stratus; the slanted bar is the dev fund). The
// choreographer drives that; this class owns the object.
//
// Two modes share one mesh (design 7.10.12):
//
//   companion  The design's moon (docs/design 7.10): locked to the camera, never behind the planet,
//              constant size, on a tilted ellipse clamped to the free area of the viewport. It is
//              drawn after everything else with the book's tonal faces (white, light grey, grey),
//              Blue Wave walls, a block clock ring and a soft glow, so it is on screen at every
//              landing in every pose. The interactive shell runs in this mode.
//   orbit      A sculpture in the sky: dark glass with Flux blue light inside, lit by the same sun as
//              the planet (real phases), on an inclined orbit, free to pass behind the planet. Ambient
//              mode and the cinematic moon shots (earthrise, eclipse, follow) run in this mode.
//
// `placement: 'auto'` picks companion in explore and orbit in ambient; `'companion'` or `'orbit'`
// force one. A cinematic shot always lifts the moon into orbit. The switch is a blend over 900 ms
// (position, pixel size, light and look interpolate; the depth test stays off until it lands).
// Brand rules hold in both: the mesh is exactly the official outline,
// light is Flux blue and white, no tier color ever touches the logo, pieces may move apart and lock
// back together but are never recolored or stretched, and the mark gets no border.

import * as THREE from 'three';
import type { SharedUniforms } from '../uniforms';
import { TAU, DEG, clamp, damp, easeInOutCubic, easeOutCubic, lerp, smoothstep } from '../math';
import type { GlobeTokens } from '../tokens';
import { MoonChain, type ChainBlock } from './chain';
import { MoonHud } from './hud';
import { layoutCompanion, makePlacement, PARKED_PHASE, PARKED_PHASE_AMBIENT, phaseRate, type Inset, type Placement } from './placement';
import { buildSymbol, Piece, type SymbolModel } from './symbol';

/** `auto`: companion in explore, orbit in ambient. `world` is the older name of `orbit`. */
export type MoonPlacement = 'auto' | 'companion' | 'orbit' | 'world';
/** What the chain is doing, for the moon's glow and ring (design 7.10.11). */
export type MoonStatus = 'live' | 'late' | 'offline' | 'archive';

export interface MoonOptions {
  enabled: boolean;
  /** 'auto' (default): follows the camera in explore, orbits in the sky in ambient. 'companion' and 'orbit' force one mode. */
  placement: MoonPlacement;
  /** Size multiplier for the companion (the phone uses 0.86). */
  scale: number;
  /** Extra clearance under the top bar, CSS pixels (companion). */
  padTop: number;
  /** Flat, cheap rendering for the lite tier: tonal faces only, no extrusion, glow or sweep. */
  lite: boolean;
  /** World mode: height of the symbol in globe radii. */
  size: number;
  /** World mode: orbit radius in globe radii. */
  orbit: number;
  /** World mode: inclination to the equator, degrees. */
  inclination: number;
  /** World mode: longitude of the ascending node, degrees. */
  node: number;
  /** World mode: seconds per orbit. */
  period: number;
  /** World mode: fixed orbital phase in degrees (freezes the moon); null follows the clock. */
  phase: number | null;
  /** World mode: assembly breathing, 0..1. Reduced motion forces 0. */
  breath: number;
  /** World mode: inner light multiplier. */
  glow: number;
  /** Faint guide lines from the moon to the next block's payees. */
  guides: boolean;
  /** World mode: the chain, a hexagon left on the orbit for every sealed block. */
  chain: boolean;
}

export const DEFAULT_MOON: MoonOptions = {
  enabled: true,
  placement: 'auto',
  scale: 1,
  padTop: 56,
  lite: false,
  size: 0.36,
  orbit: 2.05,
  inclination: 27,
  node: -20,
  period: 420,
  phase: null,
  breath: 0.3,
  glow: 1,
  guides: true,
  chain: true,
};

/** Everything the moon needs to know about the view, each frame. */
export interface MoonView {
  camera: THREE.PerspectiveCamera;
  /** The rig's up vector (the world-mode moon stays upright against it). */
  up: THREE.Vector3;
  cssW: number;
  cssH: number;
  pxScale: number;
  projScale: number;
  /** The planet's on-screen radius in CSS pixels. */
  planetR: number;
  /** Camera distance to the planet's surface in globe radii. */
  surf: number;
  inset: Inset;
}

/** The moon as the UI sees it (design 7.12 `moonState`). */
export interface MoonState {
  x: number;
  y: number;
  /** Symbol height, CSS pixels (includes the depth cue and hover growth). */
  s: number;
  /** Clearance radius: 0.74 of the base height. */
  r: number;
  /** -1 far to +1 near. */
  z: number;
  visible: boolean;
  hover: boolean;
  /** Radians along the orbit. */
  phase: number;
}

/** Boot assembly (design 7.10.9): the symbol drawn by the same code, then lifted into orbit. */
export interface MoonBoot {
  /** Arrival 0..1 of each piece in the order bar, cap, big hexagon, small hexagon. */
  pieces: [number, number, number, number];
  /** 0 assembled at (cx, cy), 1 in orbit. */
  lift: number;
  cx: number;
  cy: number;
  size: number;
  /** The "whole" flash, 0..1. */
  white?: number;
  flat?: number;
  depth?: number;
  glow?: number;
  ring?: number;
  alpha?: number;
}

const SYM_H = 322.975;

/** sRGB components 0..1 of a #rrggbb color (the tonal look is arithmetic in display space, like the design's canvas). */
function hexS(hex: string): THREE.Vector3 {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Flux Brand Book v2.0: Flux blue and the tonal blues of the tonal symbol variant (world mode).
const BLUE = '#2B61D1';
const BLUE_MID = '#547FD9';
const BLUE_LIGHT = '#92ADE5';

// ---- shaders ------------------------------------------------------------------------------

const BODY_VERT = /* glsl */ `
in float aPiece;
uniform vec3 uOff[4];
uniform vec4 uPieceA[4];     // centroid xy, radius, front z
uniform vec2 uObl;           // oblique extrusion: where the back lands relative to the front (symbol units)
uniform vec4 uSkew;          // sway as a shear: x' = dot(uSkew.xy, p.xy), y' = dot(uSkew.zw, p.xy)
out vec3 vW;
out vec3 vNW;
out vec3 vNL;
out vec3 vL;
out float vT;
flat out float vPiece;
void main() {
  int pc = int(aPiece + 0.5);
  vec3 p = position + uOff[pc];
  float fz = max(uPieceA[pc].w, 1.0);
  float t = clamp((fz - position.z) / (2.0 * fz), 0.0, 1.0);   // 0 at the front face, 1 at the back
  p.xy += uObl * t;
  p.xy = vec2(dot(uSkew.xy, p.xy), dot(uSkew.zw, p.xy));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vNL = normal;
  vNW = normalize(mat3(modelMatrix) * normal);
  vL = position;
  vT = t;
  vPiece = aPiece;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BODY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uSunLocal;      // sun direction in the moon's local frame
uniform vec3 uCamPos;
uniform vec3 uCamLocal;
uniform mat3 uRot;
uniform float uTime;
uniform float uGlow;
uniform float uEdge;
uniform float uHover;
uniform float uFlare[4];
uniform vec4 uSeal;          // x = seconds since the seal (negative: none), y = strength, zw = origin (local xy)
uniform vec3 uOff[4];
uniform vec4 uPieceA[4];     // centroid xy, radius, front z
uniform vec2 uPieceB[4];     // polygon start, vertex count
uniform vec2 uPoly[32];
uniform vec3 uBlue;
uniform vec3 uBlueMid;
uniform vec3 uBlueLight;
uniform vec2 uLatticeOrigin;
// Tonal look (design 7.10.3). All colors here are display-referred sRGB.
uniform float uLook;         // 0 glass, 1 tonal
uniform float uFlat;         // 1 = flat white symbol (boot), no depth
uniform float uLite;
uniform float uFlash;        // the receive flash
uniform float uMark;         // CSS pixels per symbol unit
uniform float uVis[4];       // per-piece visibility (boot arrival), dithered
uniform vec3 uFaceS[4];
uniform vec3 uEdgeS;
uniform vec3 uEdgeHiS;
in vec3 vW;
in vec3 vNW;
in vec3 vNL;
in vec3 vL;
in float vT;
flat in float vPiece;

// Ordered (Bayer) dither for the boot's fade-in: a clean halftone instead of static.
float bayer4(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(p, 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Distance from p to the polygon outline, and the outward normal of the nearest edge.
// (The polygon is counter-clockwise, so an edge a->b has outward normal (dy, -dx).)
vec3 edgeInfo(vec2 p, int s, int n) {
  float d = 1e9;
  vec2 nrm = vec2(0.0, 1.0);
  for (int i = 0; i < 14; i++) {
    if (i >= n) break;
    vec2 a = uPoly[s + i];
    vec2 b = uPoly[s + (i + 1 == n ? 0 : i + 1)];
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float dd = length(pa - ba * h);
    if (dd < d) {
      d = dd;
      nrm = vec2(ba.y, -ba.x) / max(length(ba), 1e-4);
    }
  }
  return vec3(d, nrm);
}

// Hexagonal lattice. x = border line, y = cell spark, z = distance from the cell border.
const vec2 HS = vec2(1.0, 1.7320508);
vec4 hexCoords(vec2 uv) {
  vec4 hC = floor(vec4(uv, uv - vec2(0.5, 1.0)) / HS.xyxy) + 0.5;
  vec4 h = vec4(uv - hC.xy * HS, uv - (hC.zw + 0.5) * HS);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, HS * 0.5), p.x);
}
vec3 hexLayer(vec2 p, float cell, float t) {
  vec2 q = ((p - uLatticeOrigin) / cell).yx;   // pointy-top like the symbol's hexagons
  vec4 h = hexCoords(q);
  float e = 0.5 - hexDist(h.xy);
  float aa = fwidth(e) * 1.25 + 1e-4;
  float line = 1.0 - smoothstep(0.0, 0.04 + aa, e);
  float rnd = hash12(h.zw);
  float ph = fract(rnd * 7.13 + t * (0.045 + 0.06 * rnd));
  float spark = pow(smoothstep(0.93, 1.0, ph), 2.0);
  return vec3(line, spark, e);
}

// The planet's shadow on a point, with a soft penumbra.
float earthShadow(vec3 P, vec3 S) {
  float t = -dot(P, S);
  if (t <= 0.0) return 1.0;
  float d = sqrt(max(dot(P, P) - t * t, 0.0));
  return smoothstep(0.96, 1.14, d);
}

vec3 srgbToLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// ---- world mode: dark glass with Flux blue light inside --------------------------------------
vec3 glass(int pc, int ps, int pn, float front, float back, float sideK, float bevK) {
  vec4 pa = uPieceA[pc];
  vec3 tone = pc == 1 ? uBlueLight : (pc == 2 ? uBlueMid : uBlue);
  vec3 white = vec3(1.0);

  vec3 S = normalize(uSunDir);
  vec3 V = normalize(uCamPos - vW);
  vec3 toPlanet = -normalize(vW);

  // A domed front face, so highlights sweep across it instead of flashing on and off.
  vec2 fromC = (vL.xy - pa.xy) / max(pa.z, 1.0);
  vec3 Nl = normalize(vNL + vec3(fromC * 0.34 * front, 0.0));
  vec3 N = normalize(uRot * Nl);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  float sunLit = earthShadow(vW, S);
  float nl = max(dot(N, S), 0.0) * sunLit;
  vec3 Hh = normalize(S + V);
  float nh = max(dot(N, Hh), 0.0);
  float dayFace = 0.5 + 0.5 * dot(normalize(vW), S);

  vec3 col = vec3(0.0025, 0.0035, 0.009); // obsidian
  float fl = uFlare[pc];

  // The seal: a ring of light crossing the faces from the point where the block arrived.
  float ring = 0.0;
  if (uSeal.x >= 0.0) {
    float dist = length(vL.xy - uSeal.zw);
    ring = exp(-pow((dist - uSeal.x * 520.0) / 30.0, 2.0)) * uSeal.y * (1.0 - smoothstep(0.35, 1.3, uSeal.x));
  }

  if (front > 0.001) {
    vec3 ei = edgeInfo(vL.xy, ps, pn);
    float inner = ei.x;
    // Rim light is lighting, not an outline: edges facing the sun catch it, the others stay blue.
    vec2 Ls = normalize(uSunLocal.xy + vec2(1e-4, 0.0));
    float facing = pow(clamp(dot(ei.yz, Ls) * 0.5 + 0.5, 0.0, 1.0), 2.6);
    float along = smoothstep(-1.1, 1.1, dot(fromC, Ls));
    float edgeLit = (0.05 + 0.95 * facing) * (0.35 + 0.65 * along) * (0.45 + 0.55 * sunLit);
    float rimLine = exp(-inner / 1.15);
    float rimPool = exp(-inner / 9.0);

    // Dark glass with a blue light deep inside: parallax lattice on two planes below the surface.
    vec3 Vl = normalize(uCamLocal - (vL + uOff[pc]));
    float zz = max(Vl.z, 0.3);
    vec3 l0 = hexLayer(vL.xy - Vl.xy / zz * 12.0, 15.5, uTime);
    vec3 l1 = hexLayer(vL.xy - Vl.xy / zz * 40.0 + vec2(7.0, 4.0), 26.0, uTime * 0.7 + 3.0);
    float latMask = smoothstep(3.0, 16.0, inner);
    // A soft glow pooled under the glass, strongest toward the middle of each block.
    float pool = exp(-dot(fromC, fromC) * 2.6);
    vec3 f = tone * (0.05 + 0.13 * pool) * uGlow;
    float wv = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(dot(vL.xy, vec2(0.021, 0.013)) - uTime * 0.9 + float(pc) * 1.7), 3.0);
    f += tone * (l0.x * 0.3 * wv + l1.x * 0.1) * latMask * uGlow * (1.0 + ring * 8.0);
    f += mix(tone, white, 0.5) * l0.y * l0.x * 1.4 * latMask;      // a cell that lights its borders
    f += tone * l0.y * smoothstep(0.0, 0.3, l0.z) * 0.22 * latMask; // and a faint fill
    f += tone * rimPool * (0.35 + 0.65 * edgeLit) * 0.85 * uGlow;
    f += mix(tone, white, 0.82) * rimLine * (0.22 + 1.5 * edgeLit + 0.45 * uHover) * uEdge;
    f += white * ring * 0.55 * (0.3 + 0.7 * latMask);
    f *= 1.0 + 2.2 * fl;
    f += mix(tone, white, 0.6) * fl * (0.16 + 0.5 * latMask * (l0.x + 0.4));
    // A slow reflection that sweeps the glass now and then.
    float sw = dot(vL.xy, normalize(vec2(0.62, 0.78))) - (mod(uTime * 34.0, 900.0) - 330.0);
    f += mix(tone, white, 0.6) * exp(-sw * sw / 520.0) * 0.16;
    // Sheen of the sun on the dome.
    f += white * pow(nh, 70.0) * 0.1 * sunLit;
    f += white * pow(nh, 14.0) * 0.015 * sunLit;
    col += f * front;
  }
  if (bevK > 0.001) {
    vec3 b = mix(tone, white, 0.7) * (0.05 + 1.5 * nl + 0.3 * fres + 0.3 * uHover) * uEdge;
    b += white * pow(nh, 40.0) * 1.8 * sunLit;
    b *= 1.0 + 2.4 * fl;
    col += b * bevK;
  }
  if (sideK > 0.001) {
    // Walls of the glass: obsidian, with the blue light leaking out along the edge and a sun glint.
    vec3 s = tone * (0.012 + 0.16 * fres) * uGlow;
    s += white * pow(nh, 60.0) * 0.8 * sunLit;
    s += mix(tone, white, 0.5) * fl * 0.35;
    col += s * sideK;
  }
  if (back > 0.001) col += tone * (0.03 + 0.2 * fres) * back;

  // Reflected glow of the planet (blue) and a hint of earthshine on the side that faces it.
  vec3 R = reflect(-V, N);
  float earth = max(dot(R, toPlanet), 0.0);
  col += vec3(0.16, 0.3, 0.75) * pow(earth, 5.0) * (0.25 + 0.75 * dayFace) * (0.06 + 0.55 * fres) * 0.5;
  col += tone * 0.04 * max(dot(N, toPlanet), 0.0) * dayFace;

  col *= 1.0 + 0.2 * uHover;
  return col;
}

// ---- companion: the book's tonal symbol, lit from the top left (display-referred) -------------
vec3 tonal(int pc, int ps, int pn, float front, float bevK, float sideK) {
  float pf = clamp(uFlare[pc], 0.0, 1.0);
  float fm = clamp(max(pf * 0.9, uFlash * 0.8), 0.0, 1.0);
  vec3 col = vec3(0.0);
  // Side walls: Blue Wave light at the lip, Flux blue deeper, darkened toward black at the back.
  if (sideK > 0.001) {
    vec3 wall = mix(mix(uEdgeHiS, uEdgeS, smoothstep(0.0, 0.4, vT)), vec3(0.0), 0.62 * vT);
    col += wall * sideK;
  }
  float faceW = front + bevK;
  if (faceW > 0.001) {
    vec2 mc = vec2(vL.x + 139.857, 161.4875 - vL.y);   // the mark's own coordinates (y down)
    vec3 face = mix(uFaceS[pc], vec3(1.0), uFlat);
    face = mix(face, vec3(1.0), fm);
    float detail = (1.0 - uLite) * (1.0 - smoothstep(0.35, 0.6, uFlat));
    if (detail > 0.001) {
      // One light at the top left: a white wash fading out by 42% along the diagonal, deep blue at the far corner.
      vec2 g0 = vec2(20.0, 10.0);
      vec2 gv = vec2(240.0, 310.0);
      float gt = clamp(dot(mc - g0, gv) / dot(gv, gv), 0.0, 1.0);
      float hiA = 0.30 * (1.0 - gt / 0.42) * step(gt, 0.42);
      face = mix(face, vec3(1.0), hiA * detail);
      float u = clamp((gt - 0.42) / 0.58, 0.0, 1.0);
      vec3 shadeC = mix(vec3(1.0), vec3(0.0, 0.0314, 0.1569), u);
      face = mix(face, shadeC, 0.34 * u * detail);
      // A diagonal specular sweep crossing the faces every 12 seconds.
      float sweep = mod(uTime * 0.14, 1.7) - 0.35;
      vec2 a0 = vec2(sweep * 300.0 - 80.0, sweep * 330.0 - 80.0);
      float sp = dot(mc - a0, vec2(160.0, 160.0)) / dot(vec2(160.0, 160.0), vec2(160.0, 160.0));
      float band = 0.5 * max(0.0, 1.0 - abs(2.0 * sp - 1.0));
      face = mix(face, vec3(1.0), band * detail);
      // The bevel stroke: Blue Wave light blue at 60%, turning white while the piece fires.
      vec3 ei = edgeInfo(vL.xy, ps, pn);
      float w = max(0.8, 1.15 / max(uMark, 1e-3)) * (1.0 + 0.8 * pf);
      float aa = 0.8 / max(uMark, 1e-3);
      float sa = 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, ei.x);
      vec3 sc = mix(uEdgeHiS, vec3(1.0), pf);
      face = mix(face, sc, sa * (0.6 + 0.4 * pf) * detail);
    }
    col += face * faceW;
  }
  return col;
}

void main() {
  int pc = int(vPiece + 0.5);
  // A piece on its way in fades by dithering (the body is opaque).
  float vis = uVis[pc];
  if (vis < 0.999 && bayer4(gl_FragCoord.xy) > vis) discard;
  int ps = int(uPieceB[pc].x + 0.5);
  int pn = int(uPieceB[pc].y + 0.5);

  float az = abs(vNL.z);
  float faceK = smoothstep(0.86, 0.985, az);
  float front = faceK * step(0.0, vNL.z);
  float back = faceK - front;
  float sideK = 1.0 - smoothstep(0.12, 0.55, az);
  float bevK = clamp(1.0 - faceK - sideK, 0.0, 1.0);

  vec3 col = vec3(0.0);
  if (uLook < 0.999) col += glass(pc, ps, pn, front, back, sideK, bevK) * (1.0 - uLook);
  if (uLook > 0.001) col += srgbToLin(tonal(pc, ps, pn, front, bevK, sideK)) * uLook;
  // Alpha is the exempt mask: where the moon is final color, the composite skips tone mapping.
  gl_FragColor = vec4(col, 1.0 - uLook);
}`;

const BILLBOARD_VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
out vec2 vP;
void main() {
  vP = position.xy;
  vec3 w = uCenter + (uCamRight * position.x + uCamUp * position.y) * uRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
in vec2 vP;
void main() {
  float r = length(vP);
  float w = max(1.0 - r * r, 0.0);
  float g = (exp(-r * r * 6.0) * 0.5 + exp(-r * 2.6) * 0.16) * w * w;
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}`;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _y = new THREE.Vector3();
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pc = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const smoother = (x: number): number => x * x * x * (x * (x * 6 - 15) + 10);

/** Where each piece arrives from (symbol units, y up), in the design's order: bar, cap, big hexagon, small hexagon. */
const BOOT_FROM = [
  [40, -200],
  [0, 240],
  [230, -30],
  [-200, -40],
];
const easeOutBack = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

export class Moon {
  /** World-space part (main scene): the orbit, the chain, the sky glow, and the body when in the sky. */
  readonly group = new THREE.Group();
  /** Screen-space part (drawn after everything, with its own depth): the body and its dressing when it follows the camera. */
  readonly overlay = new THREE.Group();
  readonly opts: MoonOptions;
  /** World position of the center as drawn (globe radii). */
  readonly pos = new THREE.Vector3();
  /** World position on the orbit, whatever is drawn. */
  readonly orbitPos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** World units per symbol unit, as drawn. */
  unit = 0.001;
  /** Bounding radius in world units, as drawn. */
  radius = 0.2;
  /** 0..1, how close the pointer is (engine sets it on hover). */
  hover = 0;
  hoverTarget = 0;
  /** 0..1: dims the inner light so the moon goes dark, for silhouette shots (the eclipse). */
  dim = 0;
  /** Static, for reduced motion: no orbit, no sway, parked upper right. */
  reduced = false;
  /** Sway of the orientation about the camera-facing pose, radians (world mode). */
  sway = 0.32;
  /** Shrink when the standard camera gets close, so the moon never swallows the frame (world mode). */
  nearShrink = true;
  /** Seconds along the orbit (follows the clock unless `phase` is set). */
  clock = 0;
  /** The companion layout in CSS pixels (valid while `companionWeight` is above zero). */
  readonly layout: Placement = makePlacement();
  /** Radians along the companion's ellipse. */
  phase = PARKED_PHASE;
  /** The block clock, 0..1 across the block interval. */
  beat = 0;
  status: MoonStatus = 'live';
  /** The ring turns emission white in the last blocks before the reward cut. */
  emission = false;
  /** Pressed state (design 7.10.11): scale 0.96 for 80 ms. */
  private pressT = 0;
  private ambientNow = false;
  private readonly beadBuf = new Float32Array(24 * 4);
  private readonly outlineBuf = new Float32Array(4);
  /** Boot assembly state (design 7.10.9), null when the moon is just the moon. */
  boot: MoonBoot | null = null;

  readonly model: SymbolModel;
  /** The ring of recent blocks the moon has sealed. */
  readonly chain: MoonChain;
  readonly hud = new MoonHud();
  private theta = 0;
  private now = 0;
  private readonly body: THREE.Mesh;
  private readonly seam: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly seamMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly off: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly flareV = new Float32Array(4);
  private readonly flareT0 = new Float32Array(4).fill(-1e9);
  private readonly flareDur = new Float32Array(4).fill(0.34);
  private readonly flareAmp = new Float32Array(4);
  private readonly vis = new Float32Array(4).fill(1);
  private readonly kick = new Float32Array(4);
  private readonly dir: THREE.Vector3[] = [];
  private readonly amp = [40, 34, 18, 28];
  private readonly zdir = [1, 0.6, -0.5, 0.15];
  private readonly lag = [0, 0.012, 0.03, 0.05];
  private sealT = -1;
  private sealStrength = 0;
  private recvT = -1;
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private lastCycle = -1;
  private placed = false;
  private spread = 0;
  private scaleNow = 1;
  private lightTotal = 0;
  private mixW = 0;
  private lifted = false;
  private inOverlay = true;
  private tk: GlobeTokens | null = null;
  private readonly faceS = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly piecePx = new Float32Array(8);
  private readonly skew = new THREE.Vector4(1, 0, 0, 1);
  private markPx = 0.2;
  private flash = 0;
  private readonly stateOut: MoonState = { x: 0, y: 0, s: 60, r: 44, z: 0, visible: false, hover: false, phase: 0 };

  constructor(private readonly u: SharedUniforms, opts: Partial<MoonOptions> = {}) {
    this.opts = { ...DEFAULT_MOON, ...opts };
    this.model = buildSymbol();
    const m = this.model;
    this.clock = (Date.now() / 1000) % this.opts.period;
    this.mixW = this.opts.placement === 'orbit' || this.opts.placement === 'world' ? 1 : 0;

    for (const p of m.pieces) {
      const l = Math.hypot(p.cx, p.cy) || 1;
      this.dir.push(new THREE.Vector3(p.cx / l, p.cy / l, 0));
    }

    const poly = new Float32Array(64);
    const pieceA: THREE.Vector4[] = [];
    const pieceB: THREE.Vector2[] = [];
    let start = 0;
    for (const p of m.pieces) {
      const n = p.poly.length / 2;
      poly.set(p.poly, start * 2);
      pieceA.push(new THREE.Vector4(p.cx, p.cy, p.radius, p.front));
      pieceB.push(new THREE.Vector2(start, n));
      start += n;
    }
    const polyV: THREE.Vector2[] = [];
    for (let i = 0; i < 32; i++) polyV.push(new THREE.Vector2(poly[i * 2], poly[i * 2 + 1]));
    this.hud.setShape(poly, pieceB.map((b) => ({ start: b.x, n: b.y })));
    // Lattice origin at the big hexagon's center, so cell borders line up with its edges.
    const big = m.pieces[Piece.BigHex];

    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        uSunDir: u.uSunDir,
        uSunLocal: { value: new THREE.Vector3(0, 0, 1) },
        uCamPos: u.uCamPos,
        uCamLocal: { value: new THREE.Vector3() },
        uRot: { value: new THREE.Matrix3() },
        uTime: u.uTime,
        uGlow: { value: 1 },
        uEdge: { value: 1 },
        uHover: { value: 0 },
        uFlare: { value: this.flareV },
        uSeal: { value: new THREE.Vector4(-1, 0, 0, 0) },
        uOff: { value: this.off },
        uPieceA: { value: pieceA },
        uPieceB: { value: pieceB },
        uPoly: { value: polyV },
        uBlue: { value: new THREE.Color(BLUE) },
        uBlueMid: { value: new THREE.Color(BLUE_MID) },
        uBlueLight: { value: new THREE.Color(BLUE_LIGHT) },
        uLatticeOrigin: { value: new THREE.Vector2(big.cx, big.cy) },
        uObl: { value: new THREE.Vector2() },
        uSkew: { value: this.skew },
        uLook: { value: 1 },
        uFlat: { value: 0 },
        uLite: { value: 0 },
        uFlash: { value: 0 },
        uMark: { value: 0.2 },
        uVis: { value: this.vis },
        uFaceS: { value: this.faceS },
        uEdgeS: { value: hexS('#2b61d1') },
        uEdgeHiS: { value: hexS('#86a1da') },
      },
      // In the transparent list so it draws after the atmosphere pass (which ignores depth), but
      // opaque in every other way: no blending, writes depth.
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.body = new THREE.Mesh(m.geometry, this.bodyMat);
    this.body.matrixAutoUpdate = false;
    this.body.frustumCulled = false;
    this.body.renderOrder = 4;

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const mkBillboard = (intensity: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: BILLBOARD_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
          uCenter: { value: new THREE.Vector3() },
          uRadius: { value: 1 },
          uCamRight: u.uCamRight,
          uCamUp: u.uCamUp,
          uColor: { value: new THREE.Color(BLUE) },
          uIntensity: { value: intensity },
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
    this.seamMat = mkBillboard(0.2);
    this.haloMat = mkBillboard(0.1);
    this.seam = new THREE.Mesh(quad, this.seamMat);
    this.halo = new THREE.Mesh(quad, this.haloMat);
    for (const mesh of [this.seam, this.halo]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
    }
    this.seam.renderOrder = 11.5; // behind the pieces, in front of the atmosphere
    this.halo.renderOrder = 12.5;
    this.chain = new MoonChain(u);
    this.chain.enabled = this.opts.chain;
    this.group.add(this.seam, this.halo, this.chain.group);
    this.overlay.add(this.hud.orbit, this.hud.glow);
    this.placeBody(this.mixW < 0.999);
    this.group.visible = this.opts.enabled;
    this.overlay.visible = this.opts.enabled;
    this.setOrbit();
  }

  /** Moves the body between the overlay (drawn last, in front of everything) and the main scene (depth-tested, can hide behind the planet). */
  private placeBody(overlay: boolean): void {
    this.inOverlay = overlay;
    (overlay ? this.overlay : this.group).add(this.body);
    this.body.renderOrder = overlay ? 4 : 12;
  }

  get enabled(): boolean {
    return this.opts.enabled;
  }

  /** 1 while the moon follows the camera, 0 when it sits in the sky. */
  get companionWeight(): number {
    return 1 - this.mixW;
  }

  /** True while the moon is drawn as a companion (the relay uses screen-space curves then). */
  get isCompanion(): boolean {
    return this.opts.enabled && this.mixW < 0.5;
  }

  get inSky(): boolean {
    return this.mixW > 0.5;
  }

  set(opts: Partial<MoonOptions>): void {
    Object.assign(this.opts, opts);
    this.group.visible = this.opts.enabled;
    this.overlay.visible = this.opts.enabled;
    this.chain.enabled = this.opts.chain;
    this.setOrbit();
  }

  setTokens(t: GlobeTokens): void {
    this.tk = t;
    // Face colors in the order of this mesh's pieces: bar, small hexagon, big hexagon, cap.
    this.faceS[Piece.Parallelogram].copy(hexS(t.moonSpark));
    this.faceS[Piece.SmallHex].copy(hexS(t.moonCumulus));
    this.faceS[Piece.BigHex].copy(hexS(t.moonNimbus));
    this.faceS[Piece.Cap].copy(hexS(t.moonStratus));
    const bu = this.bodyMat.uniforms;
    (bu.uEdgeS.value as THREE.Vector3).copy(hexS(t.moonEdge));
    (bu.uEdgeHiS.value as THREE.Vector3).copy(hexS(t.moonEdgeHi));
    this.hud.setTokens(t);
  }

  /** The pointer went down on the moon: it dips to 0.96 for 80 ms. */
  press(): void {
    this.pressT = 0.08;
  }

  /** Seconds the companion takes per lap (halved in ambient, where it is a companion at all). */
  private get lapSeconds(): number {
    return (this.tk ? this.tk.moonOrbitS : 240) * (this.ambientNow ? 0.5 : 1);
  }

  /** Lifts the moon into the sky (true) or brings it back to the camera (false), with a blend. */
  lift(on: boolean): void {
    this.lifted = on;
  }

  private setOrbit(): void {
    const i = this.opts.inclination * DEG;
    const w = this.opts.node * DEG;
    // Equatorial basis tilted by the inclination about x, then turned about the pole by the node.
    this.e1.set(1, 0, 0);
    this.e2.set(0, Math.sin(i), Math.cos(i));
    _q.setFromAxisAngle(AY, w);
    this.e1.applyQuaternion(_q);
    this.e2.applyQuaternion(_q);
  }

  /** Unit normal of the orbit plane (north-ish), for camera work. */
  orbitNormal(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.e1).cross(this.e2).normalize();
  }

  /** The orbit angle (radians) at a UTC time, on the shared clock every viewer has. */
  angleAtUtc(ms: number): number {
    return (TAU * ((ms / 1000) % this.opts.period)) / this.opts.period;
  }

  /** Puts recent blocks on the orbit, each at the moon's angle when it was sealed. */
  seedChain(blocks: readonly ChainBlock[]): void {
    // On the companion's ellipse a block sealed `age` seconds ago sits `age / lap` of a lap behind the moon.
    const lap = this.lapSeconds;
    const phase = this.phase;
    const nowMs = Date.now();
    this.chain.seed(blocks, (ms) => this.angleAtUtc(ms), (ms) => phase - ((nowMs - ms) / 1000) * (TAU / lap), nowMs, this.now);
  }

  /** World orbit position at `ahead` seconds from now (used by the director to frame future shots). */
  positionAt(ahead: number, out: THREE.Vector3): THREE.Vector3 {
    const o = this.opts;
    const th = o.phase !== null ? o.phase * DEG : (TAU * (this.clock + (this.reduced ? 0 : ahead))) / o.period;
    return out.copy(this.e1).multiplyScalar(Math.cos(th) * o.orbit).addScaledVector(this.e2, Math.sin(th) * o.orbit);
  }

  /** Light one piece white. `strength` 1 is a full flash; `dur` is the envelope in seconds (design: 0.34). */
  flare(piece: number, strength = 1, dur = 0.34): void {
    if (piece < 0 || piece > 3) return;
    const d = lerp(dur, Math.max(dur, 0.7), this.mixW);
    const u = (this.now - this.flareT0[piece]) / this.flareDur[piece];
    const cur = u >= 0 && u <= 1 ? this.flareAmp[piece] * Math.sin(Math.PI * u) : 0;
    if (strength < cur && u < 0.6) return;
    this.flareT0[piece] = this.now;
    this.flareDur[piece] = d;
    this.flareAmp[piece] = strength;
    this.kick[piece] = Math.max(this.kick[piece], strength * 0.7 * this.mixW);
  }

  flareAll(strength = 1, dur = 0.7): void {
    for (let k = 0; k < 4; k++) this.flare(k, strength, dur);
  }

  /**
   * The block reached the moon. Every piece flashes white and two rings leave it (companion), or a
   * ring of light crosses the faces and all pieces flare (in the sky). A bead is left on the orbit.
   * `height` is the block's height (for the chain).
   */
  seal(strength = 1, height = 0): void {
    this.chain.add(this.theta, this.phase, height, this.now);
    this.recvT = 0;
    this.sealT = 0;
    this.sealStrength = strength;
    if (this.mixW > 0.5) {
      this.flareAll(0.55 * strength, 0.7);
      for (let k = 0; k < 4; k++) this.kick[k] = Math.max(this.kick[k], 0.4 * strength);
    }
  }

  /** World position of an anchor: pieces 0..3 (as drawn, with sway), or 4 for the center. */
  anchor(k: number, out: THREE.Vector3): THREE.Vector3 {
    if (k >= 4) return out.copy(this.pos);
    const p = this.model.pieces[k];
    const x = p.cx + this.off[k].x;
    const y = p.cy + this.off[k].y;
    _a.set(this.skew.x * x + this.skew.y * y, this.skew.z * x + this.skew.w * y, p.front * 0.5 + this.off[k].z);
    return out.copy(_a).multiplyScalar(this.unit).applyQuaternion(this.quat).add(this.pos);
  }

  /** A piece's center relative to the moon's center, in CSS pixels (companion layout). */
  piecePixels(k: number, out: { x: number; y: number }): void {
    out.x = this.piecePx[k * 2];
    out.y = this.piecePx[k * 2 + 1];
  }

  /** Pieces are separated this much right now (0 locked, 1 fully apart). */
  get separation(): number {
    return this.spread;
  }

  /** Total light in the moon right now (for the halo and for other systems). */
  get light(): number {
    return this.lightTotal;
  }

  /** The moon as the UI sees it (design 7.12 `moonState`). The object is reused. */
  state(): MoonState {
    const s = this.stateOut;
    const L = this.layout;
    s.x = L.x;
    s.y = L.y;
    s.s = L.s;
    s.r = L.r;
    s.z = L.z;
    s.visible = this.opts.enabled && !this.boot;
    s.hover = this.hoverTarget > 0.5;
    s.phase = this.phase;
    return s;
  }

  update(dt: number, time: number, view: MoonView, opt: { rate: number; free: boolean; ambient: boolean }): void {
    const o = this.opts;
    if (!o.enabled) return;
    this.now = time;
    this.ambientNow = opt.ambient;
    const cam = view.camera;
    const reduced = this.reduced;
    const boot = this.boot;

    // Which mode: the companion in explore, the sky in ambient; a cinematic shot always lifts it into the sky.
    // The switch is a 900 ms blend with an ease-in-out shape (design 7.10.12).
    // Reduced motion has no orbit to ride (design 6.6): the moon stays a parked companion, always on screen.
    const forced = o.placement === 'orbit' || o.placement === 'world' ? 1 : o.placement === 'companion' ? 0 : opt.ambient && !reduced ? 1 : 0;
    const target = this.lifted ? 1 : forced;
    if (!this.placed) this.mixW = target;
    else this.mixW += clamp(target - this.mixW, -dt / 0.9, dt / 0.9);
    if (Math.abs(this.mixW - target) < 0.0005) this.mixW = target;
    const e = smoother(clamp(this.mixW, 0, 1));
    const overlay = this.mixW < 0.999;
    if (overlay !== this.inOverlay) this.placeBody(overlay);

    // ---- the orbit in the sky (always kept: the chain and the cinematic shots use it) ----
    if (o.phase === null && !reduced) this.clock += dt * opt.rate;
    this.positionAt(0, this.orbitPos);
    this.theta = o.phase !== null ? o.phase * DEG : (TAU * this.clock) / o.period;
    if (reduced && o.phase === null) {
      // A reduced-motion viewer gets a still moon, parked low right of the planet in the default view.
      this.theta = 5.76;
      this.orbitPos.copy(this.e1).multiplyScalar(Math.cos(this.theta) * o.orbit).addScaledVector(this.e2, Math.sin(this.theta) * o.orbit);
    }

    // ---- the companion's ellipse ----
    const tk = this.tk;
    const hov = this.hover;
    if (reduced) this.phase = opt.ambient ? PARKED_PHASE_AMBIENT : PARKED_PHASE;
    else if (!boot) this.phase += dt * phaseRate((tk ? tk.moonOrbitS : 240) * (opt.ambient ? 0.5 : 1), hov);
    const L = layoutCompanion(
      {
        w: view.cssW,
        h: view.cssH,
        inset: view.inset,
        planetR: view.planetR,
        size: tk ? tk.moonSize : 0.072,
        min: tk ? tk.moonSizeMin : 48,
        max: tk ? tk.moonSizeMax : 104,
        tiltDeg: tk ? tk.moonTilt : 22,
        // (The companion layout already makes the ambient moon 1.35 times larger, which is what design 6.6 asks of a parked one.)
        scale: o.scale,
        padTop: o.padTop,
        ambient: opt.ambient,
      },
      this.phase,
      hov,
      this.layout,
    );
    // Boot: the symbol sits where the boot puts it, then arcs into the orbit.
    if (this.pressT > 0) this.pressT = Math.max(0, this.pressT - dt);
    let bx = L.x;
    let by = L.y;
    let bs = L.s * (this.pressT > 0 ? 0.96 : 1);
    let flat = 0;
    let depthK = 1;
    let glowK = 1;
    let ringK = 1;
    let alphaK = 1;
    let white = 0;
    let lift = 1;
    if (boot) {
      lift = clamp(boot.lift, 0, 1);
      const be = easeInOutCubic(lift);
      bx = boot.cx + (L.x - boot.cx) * be;
      // The lift arcs, rising 12% of the viewport height mid-flight; reduced motion has no arc.
      by = boot.cy + (L.y - boot.cy) * be - (reduced ? 0 : Math.sin(Math.PI * be) * view.cssH * 0.12);
      bs = boot.size + (L.s - boot.size) * be;
      flat = boot.flat ?? 1 - be;
      depthK = boot.depth ?? be;
      glowK = boot.glow ?? be;
      ringK = boot.ring ?? be;
      alphaK = boot.alpha ?? 1;
      white = boot.white ?? 0;
    }
    if (o.lite) {
      depthK = 0;
      glowK = 0;
    }
    this.markPx = bs / SYM_H;

    // ---- pose: the companion (in front of the camera at the ellipse's pixel) ----
    _v.set((bx / view.cssW) * 2 - 1, 1 - (by / view.cssH) * 2, 0.5).unproject(cam);
    _f.copy(_v).sub(cam.position).normalize();
    _c.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const dc = Math.max(0.006, 0.5 * Math.max(view.surf, 0.012));
    _pc.copy(cam.position).addScaledVector(_f, dc);
    const zc = Math.max(dc * _f.dot(_c), 1e-4);
    const unitC = (bs / SYM_H) * (zc / view.projScale);
    _qc.copy(cam.quaternion);

    // ---- pose: the sculpture in the sky ----
    _pw.copy(this.orbitPos);
    _f.copy(cam.position).sub(_pw);
    const dist = _f.length();
    const shrink = this.nearShrink && !opt.free ? clamp(dist / 2.4, 0.5, 1) : 1;
    // From far away (the wide landing shot) it grows a little, so it stays a presence in the frame.
    const far = 1 + 0.45 * smoothstep(4.2, 8.2, dist);
    this.scaleNow = damp(this.scaleNow, shrink * far, 3, dt);
    if (!this.placed) this.scaleNow = shrink * far;
    const unitW = (o.size / this.model.height) * this.scaleNow;
    // Orientation: face the camera, upright, with a slow sway that shows the thickness of the blocks.
    const F = _f.divideScalar(Math.max(dist, 1e-4));
    _r.copy(view.up).cross(F);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    _y.copy(F).cross(_r);
    _m.makeBasis(_r, _y, F);
    _q.setFromRotationMatrix(_m);
    const yaw = reduced ? 0.28 : this.sway * Math.sin(time * 0.09 + 0.6) + 0.08;
    const pitch = reduced ? 0.1 : this.sway * 0.42 * Math.sin(time * 0.061 + 2.1);
    _q2.setFromAxisAngle(AY, yaw);
    _q.multiply(_q2);
    _q2.setFromAxisAngle(AX, pitch);
    _q.multiply(_q2);
    _qw.copy(_q);

    // ---- blend ----
    this.pos.copy(_pc).lerp(_pw, e);
    this.unit = Math.exp(lerp(Math.log(unitC), Math.log(unitW), e));
    _q.copy(_qc).slerp(_qw, e);
    if (!this.placed || this.quat.angleTo(_q) > 1.3 || e < 0.999) this.quat.copy(_q);
    else this.quat.slerp(_q, 1 - Math.exp(-2.4 * dt));
    this.radius = this.model.radius * this.unit * 0.92;

    // The sway of the companion is a shear of the symbol plane (the design's transform).
    const sway = reduced ? 0 : boot ? Math.sin(time * 0.23) * 0.2 * easeInOutCubic(lift) : Math.sin(time * 0.23) * 0.2;
    this.skew.set(lerp(Math.cos(sway), 1, e), lerp(-0.25 * Math.sin(sway), 0, e), 0, 1);

    // Breathing assembly (sky only): locked most of the time, a slow drift apart, a quick lock with a tick of light.
    const breath = (reduced ? 0 : opt.ambient ? Math.max(o.breath, 0.9) : o.breath) * e;
    const T = 15;
    let sAvg = 0;
    const alphaBoot = alphaK;
    const hovSep = hov * e;
    for (let k = 0; k < 4; k++) {
      const u = (((time + this.lag[k] * T) / T) % 1 + 1) % 1;
      let s = 0;
      if (u >= 0.5 && u < 0.8) s = easeInOutCubic((u - 0.5) / 0.3);
      else if (u >= 0.8 && u < 0.88) s = 1;
      else if (u >= 0.88) s = 1 - easeOutCubic((u - 0.88) / 0.12);
      s = Math.max(s * breath, hovSep * 0.55);
      sAvg += s / 4;
      const a = this.amp[k] * s + this.kick[k] * 9;
      this.off[k].copy(this.dir[k]).multiplyScalar(a);
      this.off[k].z = this.zdir[k] * 14 * s + this.kick[k] * 4 * this.zdir[k];
      this.vis[k] = 1;
      this.outlineBuf[k] = 0;
      if (boot) {
        // The design's order is bar, cap, big hexagon, small hexagon; this mesh's is bar, small, big, cap.
        const bi = k === Piece.Parallelogram ? 0 : k === Piece.Cap ? 1 : k === Piece.BigHex ? 2 : 3;
        const p = clamp(boot.pieces[bi], 0, 1);
        this.outlineBuf[k] = 1 - smoothstep(0.82, 1.0, p);
        const r = reduced ? 0 : 1 - easeOutBack(p);
        this.off[k].x += BOOT_FROM[bi][0] * r;
        this.off[k].y += BOOT_FROM[bi][1] * r;
        // `alpha` fades the whole symbol through the same ordered dither (the reduced-motion boot cross-fades with it).
        this.vis[k] = (reduced ? smoothstep(0, 0.5, p) : smoothstep(0, 0.1, p)) * alphaBoot;
      }
    }
    this.spread = sAvg;
    const cycle = Math.floor(time / T);
    if (!reduced && breath > 0.05 && this.lastCycle >= 0 && cycle !== this.lastCycle) this.flareAll(0.22 * breath + 0.05, 0.7);
    this.lastCycle = cycle;

    // Envelopes.
    let lt = 0;
    const kk = Math.exp(-dt / 0.22);
    for (let k = 0; k < 4; k++) {
      const u = (time - this.flareT0[k]) / this.flareDur[k];
      const v = u >= 0 && u <= 1 ? this.flareAmp[k] * Math.sin(Math.PI * u) : 0;
      this.flareV[k] = v;
      this.kick[k] *= kk;
      lt += v;
    }
    this.lightTotal = lt;
    if (this.sealT >= 0) {
      this.sealT += dt;
      if (this.sealT > 1.6) this.sealT = -1;
    }
    let recv = -1;
    let flash = 0;
    let ringFlash = 0;
    if (this.recvT >= 0) {
      this.recvT += dt;
      const u = this.recvT / 0.9;
      if (u > 1) this.recvT = -1;
      else {
        recv = reduced ? -1 : u;
        flash = Math.sin(Math.PI * clamp(u * 1.25, 0, 1)) * (reduced ? 0.6 : 1);
        ringFlash = 1 - u;
      }
    }
    this.flash = Math.max(flash, white);
    this.hover = damp(this.hover, this.hoverTarget, 9, dt);

    // ---- uniforms: the body ----
    _c.set(this.unit, this.unit, this.unit);
    this.body.matrix.compose(this.pos, this.quat, _c);
    this.body.matrixWorld.copy(this.body.matrix);
    this.body.matrixWorldNeedsUpdate = false;
    _m3.setFromMatrix4(_m.makeRotationFromQuaternion(this.quat));
    const bu = this.bodyMat.uniforms;
    (bu.uRot.value as THREE.Matrix3).copy(_m3);
    const cl = bu.uCamLocal.value as THREE.Vector3;
    cl.copy(cam.position).sub(this.pos).applyQuaternion(_q2.copy(this.quat).invert()).divideScalar(this.unit);
    (bu.uSunLocal.value as THREE.Vector3).copy(this.u.uSunDir.value).applyQuaternion(_q2.copy(this.quat).invert());
    const lit = 1 - 0.88 * this.dim;
    bu.uGlow.value = o.glow * lit * (0.92 + 0.08 * Math.sin(time * 0.7));
    bu.uEdge.value = 1 + 0.12 * Math.sin(time * 0.43 + 1.0);
    bu.uHover.value = this.hover * e;
    const seal = bu.uSeal.value as THREE.Vector4;
    const big0 = this.model.pieces[Piece.Parallelogram];
    seal.set(this.sealT, this.sealStrength * e, big0.cx, big0.cy);
    const depthL = (tk ? tk.moonDepth : 0.14) * SYM_H * depthK * (1 - flat);
    (bu.uObl.value as THREE.Vector2).set(0.62 * depthL * (1 - e), -0.78 * depthL * (1 - e));
    // Look: tonal in front of the camera, glass in the sky (a transition blends them).
    bu.uLook.value = 1 - e;
    bu.uFlat.value = flat;
    bu.uLite.value = o.lite ? 1 : 0;
    bu.uFlash.value = this.flash;
    bu.uMark.value = this.markPx;
    this.body.visible = alphaK > 0.002;

    // Anchors for the ray layer, and the pieces' places on screen.
    const anchors = this.u.uAnchor.value;
    for (let k = 0; k < 4; k++) {
      this.anchor(k, _v);
      anchors[k].set(_v.x, _v.y, _v.z, 1);
      const p = this.model.pieces[k];
      const x = p.cx + this.off[k].x;
      const y = p.cy + this.off[k].y;
      this.piecePx[k * 2] = (this.skew.x * x + this.skew.y * y) * this.markPx;
      this.piecePx[k * 2 + 1] = -(this.skew.z * x + this.skew.w * y) * this.markPx;
    }
    anchors[4].set(this.pos.x, this.pos.y, this.pos.z, 1);

    // ---- the companion's dressing ----
    const late = this.status === 'late' || this.status === 'offline';
    const glowScale = late ? 0.25 / 0.55 : 1;
    const glowTok = tk ? tk.moonGlowAlpha : 0.55;
    const beat = clamp(this.beat, 0, 1);
    const ringShown = this.status === 'archive' ? 0 : ringK;
    const last3 = smoothstep(0.88, 0.93, beat) * (this.status === 'live' ? 1 : 0);
    this.hud.update(
      {
        cssW: view.cssW,
        cssH: view.cssH,
        pxScale: view.pxScale,
        x: bx,
        y: by,
        s: bs,
        k: this.markPx,
        glowA: glowTok * glowK * glowScale * (0.85 + 0.15 * Math.sin(time * 1.3) + 0.4 * this.hover + 0.5 * this.flash),
        flash: this.flash,
        hover: this.hover,
        beat: reduced ? Math.floor(beat * 30) / 30 : beat,
        ringA: ringShown * (1 + 0.2 * last3) * (this.emission ? 1.25 : 1),
        ringFlash,
        recv,
        lite: o.lite,
        pieceFlash: this.flareV,
        piecePx: this.piecePx,
        orbit: L.orbit,
        phase: this.phase,
        guideA: 1,
        chainA: reduced || o.lite || !o.chain ? 0 : 1,
        beads: this.beadBuf,
        outline: this.outlineBuf,
        skew: this.skew,
        beadN: reduced || o.lite || !o.chain ? 0 : this.chain.companionBeads(time, (tk ? tk.moonOrbitS : 240) * 1.15, this.beadBuf, 24),
        alpha: (1 - e) * alphaK,
      },
      !reduced && !boot && !o.lite,
    );

    // ---- the sky's dressing: glow billboards and the chain ----
    const sky = e > 0.002;
    this.seam.visible = this.halo.visible = sky;
    if (sky) {
      const hu = this.haloMat.uniforms;
      (hu.uCenter.value as THREE.Vector3).copy(this.pos);
      hu.uRadius.value = this.radius * 2.3;
      hu.uIntensity.value = (0.11 + 0.55 * Math.min(1.5, lt * 0.5) + 0.12 * this.spread + 0.1 * this.hover) * o.glow * (1 - 0.8 * this.dim) * e;
      const su = this.seamMat.uniforms;
      _v.copy(F).multiplyScalar(-this.model.pieces[Piece.BigHex].depth * 0.3 * this.unit).add(this.pos);
      (su.uCenter.value as THREE.Vector3).copy(_v);
      su.uRadius.value = this.radius * 0.95;
      su.uIntensity.value = (0.1 + 0.9 * this.spread + 0.6 * Math.min(1.5, lt * 0.5)) * o.glow * (1 - 0.8 * this.dim) * e;
    }
    this.chain.shown = sky;
    // The chain of sealed blocks on the orbit (it keeps recording while the moon follows the camera).
    this.chain.update(time, this.e1, this.e2, o.orbit, this.theta, o.size);
    this.placed = true;
  }

  dispose(): void {
    this.chain.dispose();
    this.hud.dispose();
    this.model.geometry.dispose();
    this.bodyMat.dispose();
    this.seamMat.dispose();
    this.haloMat.dispose();
    this.seam.geometry.dispose();
  }
}

// The Flux moon: the brand symbol, extruded, as the chain itself.
//
// Its four pieces are the four official outlines. Every real block passes through them: a beam
// climbs from the producer and seals the moon, then the moon pays out, one tier per piece (small
// hexagon Cumulus, big hexagon Nimbus, cap Stratus; the slanted bar is the dev fund). The
// choreographer drives that; this class owns the object.
//
// The moon is a real object in the planet's frame (design 7.10.4). It rides a circular orbit around the
// planet's centre whose position is a function of UTC time and nothing else (orbit.ts): panning, tilting
// and zooming the camera never move it along its path, every viewer sees it in the same place, and it
// goes behind the planet and comes round again. Two shapes of that orbit share one clock:
//
//   shell  The compact ring of the interactive shell, sized and rolled for the screen so the whole lap
//          fits the free area at the home zoom. The moon wears the book's tonal faces (white, light grey,
//          grey) with Blue Wave walls, a block clock ring and a soft glow.
//   sky    The wide, steeper orbit of the screensaver and the cinematic moon shots (earthrise, eclipse,
//          follow): dark glass with Flux blue light inside, lit by the same sun as the planet.
//
// `placement: 'auto'` picks the shell in explore and the sky in ambient; a cinematic shot always lifts
// the moon into the sky. The change is a blend of the orbit's parameters over 900 ms: the moon swings from
// one ring to the other without ever leaving an orbit. Brand rules hold in both: the mesh is exactly the
// official outline, light is Flux blue and white, no tier color touches the logo, pieces may move apart
// and lock back together but are never recolored or stretched, and the mark gets no border.
//
// Drawing. The moon turns to the camera (parallel to the image plane, upright against screen-up, with a
// slow sway that shows the blocks' thickness) at its true place and perspective size. Everything it owns
// is drawn in the overlay pass (a fresh depth buffer, after the planet and the bloom's source), so the
// planet's own depth never cuts it; the planet hides it analytically instead (occlusion.ts): softly at
// the limb, with no popping and no fight with the atmosphere. The pass draws, back to front: the glow and
// the block clock (hud.ts), the wake and the beads of the chain (chain.ts), the body, and a mask that
// keeps the tonal colors exact through the tone mapping (post.ts, "exempt mask").

import * as THREE from 'three';
import { clamp, DEG, damp, easeInOutCubic, easeOutCubic, lerp, smoothstep, TAU, wrapPi } from '../math';
import type { GlobeTokens } from '../tokens';
import type { SharedUniforms } from '../uniforms';
import { type ChainBlock, MoonChain } from './chain';
import { MoonHud } from './hud';
import { PLANET_VIS_GLSL } from './occlusion';
import {
  angleAtUtc,
  blendShape,
  compactOrbit,
  copyShape,
  type Inset,
  MIN_MOON_PX,
  ORBIT_PERIOD_S,
  type OrbitShape,
  orbitBasis,
  orbitNormal,
  orbitPoint,
  planetVisibility,
  SKY_ORBIT,
} from './orbit';
import { buildSymbol, Piece, type SymbolModel } from './symbol';

/** `auto`: the shell ring in explore, the sky orbit in ambient. `companion` is the older name of `compact`, `orbit` and `world` of `sky`. */
export type MoonPlacement = 'auto' | 'compact' | 'sky' | 'companion' | 'orbit' | 'world';
/** What the chain is doing, for the moon's glow and ring (design 7.10.11). */
export type MoonStatus = 'live' | 'late' | 'offline' | 'archive';

export interface MoonOptions {
  enabled: boolean;
  /** 'auto' (default): the shell ring in explore, the sky orbit in ambient. The others force one. */
  placement: MoonPlacement;
  /** Size multiplier (the phone uses 0.86). */
  scale: number;
  /** Kept for hosts that still pass it; the orbit is sized to the screen now. */
  padTop: number;
  /** Flat, cheap rendering for the lite tier: tonal faces only, no extrusion, glow or sweep. */
  lite: boolean;
  /** Sky orbit: height of the symbol in globe radii. */
  size: number;
  /** Sky orbit: radius in globe radii. */
  orbit: number;
  /** Sky orbit: inclination to the equator, degrees. */
  inclination: number;
  /** Sky orbit: longitude of the ascending node, degrees. */
  node: number;
  /** Seconds per orbit. Every viewer must use the same value for the moon to be in the same place for all. */
  period: number;
  /** Fixed orbital angle in degrees (freezes the moon); null follows the UTC clock. */
  phase: number | null;
  /** Sky: assembly breathing, 0..1. Reduced motion forces 0. */
  breath: number;
  /** Sky: inner light multiplier. */
  glow: number;
  /** Faint guide lines from the moon to the next block's payees. */
  guides: boolean;
  /** The chain: a hexagon left on the orbit for every sealed block, and the wake. */
  chain: boolean;
}

export const DEFAULT_MOON: MoonOptions = {
  enabled: true,
  placement: 'auto',
  scale: 1,
  padTop: 56,
  lite: false,
  size: SKY_ORBIT.size,
  orbit: SKY_ORBIT.radius,
  inclination: SKY_ORBIT.inclination / DEG,
  node: SKY_ORBIT.node / DEG,
  period: ORBIT_PERIOD_S,
  phase: null,
  breath: 0.3,
  glow: 1,
  guides: true,
  chain: true,
};

/** Everything the moon needs to know about the view, each frame. */
export interface MoonView {
  camera: THREE.PerspectiveCamera;
  /** The rig's up vector. */
  up: THREE.Vector3;
  cssW: number;
  cssH: number;
  pxScale: number;
  projScale: number;
  /** The planet's on-screen radius in CSS pixels. */
  planetR: number;
  /** Camera distance to the planet's surface in globe radii. */
  surf: number;
  /** The free area's insets this frame (eased by the engine when docked windows come and go). */
  inset: Inset;
  /** Where the inset is heading; the shell ring is fitted to this and glides there. `inset` when omitted. */
  insetGoal?: Inset;
}

/** What the engine tells the moon each frame besides the view. */
export interface MoonFrame {
  /** How many times faster than real time the world clock runs (1 live). */
  rate: number;
  /** A free (cinematic) camera is on: the moon is not held to a size range. */
  free: boolean;
  ambient: boolean;
  /** The world's UTC time in milliseconds (the sun's clock); the real clock when omitted. */
  utcMs?: number;
}

/** The moon as the UI sees it (design 7.12 `moonState`). */
export interface MoonState {
  /** Where the moon's centre is on screen, CSS px (it follows its place on the orbit, behind the planet too). */
  x: number;
  y: number;
  /** Symbol height, CSS pixels (includes the depth cue and hover growth). */
  s: number;
  /** Clearance radius: 0.74 of the height. */
  r: number;
  /** -1 far to +1 near. */
  z: number;
  /** On screen (in front of the camera and inside the viewport), whether or not the planet hides it right now. */
  visible: boolean;
  /** 0 hidden behind the planet, 1 in the clear. The moon takes the pointer only above 0.6. */
  vis: number;
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

/** Where the moon is on screen this frame, for the engine's pointer tests. */
export interface MoonScreen {
  x: number;
  y: number;
  /** Symbol height, CSS px. */
  s: number;
  /** Hit radius, CSS px. */
  r: number;
  /** Distance along the view axis, world units. */
  depth: number;
  /** Planet visibility at the moon's centre, 0..1. */
  vis: number;
  onScreen: boolean;
  /** The pointer can take it: on screen and clear of the planet. */
  hit: boolean;
}

const SYM_H = 322.975;
/** A bead lives this fraction of a lap: it shrinks and fades over about 145 degrees of the path behind the moon. */
const TRAIL_LIFE = 0.4;

/** sRGB components 0..1 of a #rrggbb color (the tonal look is arithmetic in display space, like the design's canvas). */
function hexS(hex: string): THREE.Vector3 {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Flux Brand Book v2.0: Flux blue and the tonal blues of the tonal symbol variant (sky look).
const BLUE = '#2B61D1';
const BLUE_MID = '#547FD9';
const BLUE_LIGHT = '#92ADE5';

// ---- shaders ------------------------------------------------------------------------------

const BODY_VERT = /* glsl */ `
in float aPiece;
uniform vec3 uOff[4];
uniform vec4 uPieceA[4];     // centroid xy, radius, front z
uniform vec2 uObl;           // oblique extrusion: where the back lands relative to the front (symbol units)
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
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vNL = normal;
  vNW = normalize(mat3(modelMatrix) * normal);
  vL = position;
  vT = t;
  vPiece = aPiece;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// How much of a fragment shows: the planet hides what is behind it (softly at the limb), the boot fades a
// piece in through an ordered dither, and the whole moon fades with `uAlpha`. -1 drops the fragment.
const COVER_GLSL = /* glsl */ `
${PLANET_VIS_GLSL}
uniform float uAlpha;
uniform float uOcc;          // 0 in front of everything (the boot), 1 hidden by the planet like any world object
uniform float uVis[4];       // per-piece visibility (boot arrival), dithered
in vec3 vW;
flat in float vPiece;

// Ordered (Bayer) dither for the boot's fade-in: a clean halftone instead of static.
float bayer4(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(p, 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
float coverage() {
  int pc = int(vPiece + 0.5);
  float v = uVis[pc];
  if (v < 0.999 && bayer4(gl_FragCoord.xy) > v) return -1.0;
  return uAlpha * mix(1.0, planetVis(vW), uOcc);
}`;

const BODY_FRAG = /* glsl */ `
precision highp float;
${COVER_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunLocal;      // sun direction in the moon's local frame
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
uniform vec3 uFaceS[4];
uniform vec3 uEdgeS;
uniform vec3 uEdgeHiS;
in vec3 vNW;
in vec3 vNL;
in vec3 vL;
in float vT;

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

// ---- sky look: dark glass with Flux blue light inside ----------------------------------------
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

// ---- shell look: the book's tonal symbol, lit from the top left (display-referred) ------------
// The sun still touches it, lightly: the walls and the edges that face the sun catch a little more light,
// and in the planet's shadow the faces cool a little toward the deep blue of the symbol's own gradient and the
// highlights ease (never to black: the mark stays the mark).
vec3 tonal(int pc, int ps, int pn, float front, float bevK, float sideK) {
  float pf = clamp(uFlare[pc], 0.0, 1.0);
  float fm = clamp(max(pf * 0.9, uFlash * 0.8), 0.0, 1.0);
  vec3 S = normalize(uSunDir);
  float lit = earthShadow(vW, S);
  float shade = (1.0 - lit) * 0.16 * (1.0 - uFlat);
  const vec3 deep = vec3(0.0, 0.0314, 0.1569);
  vec3 col = vec3(0.0);
  // Side walls: Blue Wave light at the lip, Flux blue deeper, darkened toward black at the back.
  if (sideK > 0.001) {
    vec3 wall = mix(mix(uEdgeHiS, uEdgeS, smoothstep(0.0, 0.4, vT)), vec3(0.0), 0.62 * vT);
    float wl = max(dot(normalize(vNW), S), 0.0) * lit * (1.0 - uFlat);
    wall = mix(wall, uEdgeHiS, 0.55 * wl * (1.0 - 0.6 * vT));
    wall = mix(wall, deep * 0.5, shade * 2.0);
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
      face = mix(face, vec3(1.0), hiA * detail * (0.55 + 0.45 * lit));
      float u = clamp((gt - 0.42) / 0.58, 0.0, 1.0);
      vec3 shadeC = mix(vec3(1.0), deep, u);
      face = mix(face, shadeC, 0.34 * u * detail);
      // A diagonal specular sweep crossing the faces every 12 seconds.
      float sweep = mod(uTime * 0.14, 1.7) - 0.35;
      vec2 a0 = vec2(sweep * 300.0 - 80.0, sweep * 330.0 - 80.0);
      float sp = dot(mc - a0, vec2(160.0, 160.0)) / dot(vec2(160.0, 160.0), vec2(160.0, 160.0));
      float band = 0.5 * max(0.0, 1.0 - abs(2.0 * sp - 1.0));
      face = mix(face, vec3(1.0), band * detail * (0.55 + 0.45 * lit));
      // The bevel stroke: Blue Wave light blue at 60%, turning white while the piece fires. Its width is
      // a hairline of CSS pixels and its edge is anti-aliased in device pixels.
      vec3 ei = edgeInfo(vL.xy, ps, pn);
      float px = max(uMark * uPxScale, 1e-3);          // device pixels per symbol unit
      float w = max(0.8, 1.15 / max(uMark, 1e-3)) * (1.0 + 0.8 * pf);
      float aa = 0.75 / px;
      float sa = 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, ei.x);
      vec3 sc = mix(uEdgeHiS, vec3(1.0), pf);
      // The edge that faces the sun catches a thin rim of light: strongest when the sun is to the side or behind.
      vec2 Ls = normalize(uSunLocal.xy + vec2(1e-4, 0.0));
      float facing = pow(clamp(dot(ei.yz, Ls) * 0.5 + 0.5, 0.0, 1.0), 3.0);
      float side = clamp(length(uSunLocal.xy), 0.0, 1.0);
      float rim = (1.0 - smoothstep(0.0, 3.2 / px, ei.x)) * facing * (0.2 + 0.8 * side) * lit;
      sc = mix(sc, vec3(1.0), 0.7 * rim);
      face = mix(face, sc, clamp(sa * (0.6 + 0.4 * pf) + 0.45 * rim, 0.0, 1.0) * detail);
    }
    face = mix(face, deep, shade);
    col += face * faceW;
  }
  return col;
}

void main() {
  float cv = coverage();
  if (cv < 0.003) discard;
  int pc = int(vPiece + 0.5);
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
  gl_FragColor = vec4(col, cv);
}`;

// The exempt mask (post.ts): where the moon is final color the composite skips tone mapping. The body is
// alpha blended (the planet fades it at the limb), so the mask is a pass of its own that takes the alpha
// channel down by the same coverage and leaves the color alone.
const MASK_FRAG = /* glsl */ `
precision highp float;
${COVER_GLSL}
uniform float uLook;
void main() {
  float cv = coverage();
  if (cv < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, cv * uLook);
}`;

const BILLBOARD_VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
out vec2 vP;
out vec3 vWorld;
void main() {
  vP = position.xy;
  vec3 w = uCenter + (uCamRight * position.x + uCamUp * position.y) * uRadius;
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
${PLANET_VIS_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
in vec2 vP;
in vec3 vWorld;
void main() {
  float r = length(vP);
  float w = max(1.0 - r * r, 0.0);
  float g = (exp(-r * r * 6.0) * 0.5 + exp(-r * 2.6) * 0.16) * w * w;
  gl_FragColor = vec4(uColor * g * uIntensity * planetVis(vWorld), 1.0);
}`;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
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
const easeOutBack = (t: number): number => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

const NO_INSET = { left: 0, right: 0, top: 0, bottom: 0 };

/** A soft ceiling: `x` unchanged well below `cap`, approaching it from below. */
const softCap = (x: number, cap: number): number => x / (1 + (x / cap) ** 4) ** 0.25;

/**
 * One step of a critically damped spring toward `goal` (exact for any `dt`, so it is safe on a long frame).
 * `vel[i]` carries the velocity between steps. It leaves rest gently and arrives without overshoot.
 */
function spring(x: number, goal: number, vel: Float64Array, i: number, w: number, dt: number): number {
  const d = x - goal;
  const a = vel[i]! + w * d;
  const k = Math.exp(-w * dt);
  vel[i] = (a - w * (d + a * dt)) * k;
  return goal + (d + a * dt) * k;
}

export class Moon {
  /** World-space part (main scene). Empty: everything the moon draws is in the overlay pass. */
  readonly group = new THREE.Group();
  /** Everything the moon draws: drawn after the planet, with its own depth. */
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
  /** Sway of the orientation about the camera-facing pose, radians. */
  sway = 0.26;
  /** The block clock, 0..1 across the block interval. */
  beat = 0;
  status: MoonStatus = 'live';
  /** The ring turns emission white in the last blocks before the reward cut. */
  emission = false;
  /** Boot assembly state (design 7.10.9), null when the moon is just the moon. */
  boot: MoonBoot | null = null;
  /** Where the moon is on screen this frame (the engine's pointer tests read it). */
  readonly screen: MoonScreen = { x: 0, y: 0, s: 60, r: 36, depth: 4, vis: 1, onScreen: false, hit: false };
  /** The orbit as drawn this frame: the shell and the sky blended. */
  readonly shape: OrbitShape = { radius: 1.5, inclination: 0.2, node: 0, size: 0.2 };

  readonly model: SymbolModel;
  /** The ring of recent blocks the moon has sealed. */
  readonly chain: MoonChain;
  readonly hud: MoonHud;
  /** The orbit's in-plane basis as drawn this frame. */
  readonly e1 = new THREE.Vector3(1, 0, 0);
  readonly e2 = new THREE.Vector3(0, 0, 1);
  private theta = 0;
  private now = 0;
  private pressT = 0;
  private readonly outlineBuf = new Float32Array(4);
  private readonly body: THREE.Mesh;
  private readonly mask: THREE.Mesh;
  private readonly seam: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly maskMat: THREE.ShaderMaterial;
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
  private lastCycle = -1;
  private placed = false;
  private spread = 0;
  private farK = 1;
  private lightTotal = 0;
  private mixW = 0;
  private lifted = false;
  private tk: GlobeTokens | null = null;
  private readonly faceS = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private readonly piecePx = new Float32Array(8);
  private markPx = 0.2;
  private flash = 0;
  /** -1 on the far side of the planet from the camera, +1 on the near side. */
  private zCue = 0;
  // The clock: the world's UTC time, advanced by the frame's dt and gently pulled to the source so a
  // coarse or jittery timer never shows as a stutter.
  private clockMs = 0;
  private clockSet = false;
  private rateNow = 1;
  // The shapes.
  private readonly shell: OrbitShape = { radius: 1.5, inclination: 0.2, node: 0, size: 0.2 };
  /** The ring `compactOrbit` wants for the current viewport; `shell` eases to it. */
  private readonly shellGoal: OrbitShape = { radius: 1.5, inclination: 0.2, node: 0, size: 0.2 };
  private readonly skyShape: OrbitShape = { ...SKY_ORBIT };
  private readonly shellV = new Float64Array(4);
  private shellKey = '';
  private shellAt = -1;
  // Eased gates (everything that appears or changes mode fades or glides; nothing pops).
  private trailK = 0;
  private capK = 1;
  // Reduced motion: the moon sits still at a seat on its orbit. If the planet is turned so that the seat is
  // hidden or off screen, it takes a new seat with a cross-fade (never a flight).
  private parkOn = false;
  private parkTheta = 0;
  private parkFade = 1;
  private parkHidden = 0;
  private parkSwap = false;
  private readonly stateOut: MoonState = {
    x: 0,
    y: 0,
    s: 60,
    r: 44,
    z: 0,
    visible: false,
    vis: 1,
    hover: false,
    phase: 0,
  };

  constructor(
    private readonly u: SharedUniforms,
    opts: Partial<MoonOptions> = {},
  ) {
    this.opts = { ...DEFAULT_MOON, ...opts };
    this.model = buildSymbol();
    this.hud = new MoonHud(u);
    const m = this.model;
    this.mixW = this.skyWanted(false) ? 1 : 0;
    compactOrbit(1600, 900, this.shellGoal);
    copyShape(this.shellGoal, this.shell);
    copyShape(this.shell, this.shape);

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
    this.hud.setShape(
      poly,
      pieceB.map((b) => ({ start: b.x, n: b.y })),
    );
    // Lattice origin at the big hexagon's center, so cell borders line up with its edges.
    const big = m.pieces[Piece.BigHex]!;

    // Uniforms both passes read (the mask shares the cover uniforms with the body).
    const cover = {
      uCamPos: u.uCamPos,
      uProjScale: u.uProjScale,
      uPxScale: u.uPxScale,
      uAlpha: { value: 1 },
      uOcc: { value: 1 },
      uVis: { value: this.vis },
      uOff: { value: this.off },
      uPieceA: { value: pieceA },
      uObl: { value: new THREE.Vector2() },
      uLook: { value: 1 },
    };

    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        ...cover,
        uSunDir: u.uSunDir,
        uSunLocal: { value: new THREE.Vector3(0, 0, 1) },
        uCamLocal: { value: new THREE.Vector3() },
        uRot: { value: new THREE.Matrix3() },
        uTime: u.uTime,
        uGlow: { value: 1 },
        uEdge: { value: 1 },
        uHover: { value: 0 },
        uFlare: { value: this.flareV },
        uSeal: { value: new THREE.Vector4(-1, 0, 0, 0) },
        uPieceB: { value: pieceB },
        uPoly: { value: polyV },
        uBlue: { value: new THREE.Color(BLUE) },
        uBlueMid: { value: new THREE.Color(BLUE_MID) },
        uBlueLight: { value: new THREE.Color(BLUE_LIGHT) },
        uLatticeOrigin: { value: new THREE.Vector2(big.cx, big.cy) },
        uFlat: { value: 0 },
        uLite: { value: 0 },
        uFlash: { value: 0 },
        uMark: { value: 0.2 },
        uFaceS: { value: this.faceS },
        uEdgeS: { value: hexS('#2b61d1') },
        uEdgeHiS: { value: hexS('#86a1da') },
      },
      // Alpha blended, so the planet can fade it at the limb; depth is written, so the blocks sort among
      // themselves. The alpha channel is left alone here (the mask pass owns it).
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: MASK_FRAG,
      uniforms: cover,
      transparent: true,
      blending: THREE.CustomBlending,
      // The color is untouched; the alpha channel is multiplied by what the moon does not cover.
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.body = new THREE.Mesh(m.geometry, this.bodyMat);
    this.mask = new THREE.Mesh(m.geometry, this.maskMat);
    for (const mesh of [this.body, this.mask]) {
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
    }
    this.body.renderOrder = 4;
    this.mask.renderOrder = 4.5;

    const quad = new THREE.BufferGeometry();
    quad.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
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
          uCamPos: u.uCamPos,
          uProjScale: u.uProjScale,
          uPxScale: u.uPxScale,
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
        depthTest: false,
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
    this.halo.renderOrder = 2.5;
    this.seam.renderOrder = 3.5; // behind the pieces
    this.chain = new MoonChain(u);
    this.chain.enabled = this.opts.chain;
    this.chain.life = TRAIL_LIFE * this.opts.period;
    // Back to front: the glow and the clock, the halo, the wake and the beads, the seam, the body, its mask.
    this.overlay.add(this.hud.glow, this.halo, this.chain.group, this.seam, this.body, this.mask);
    this.overlay.visible = this.opts.enabled;
  }

  get enabled(): boolean {
    return this.opts.enabled;
  }

  /** 1 while the moon is on the sky orbit, 0 on the shell ring. */
  get skyWeight(): number {
    return this.mixW;
  }

  /** The orbit angle the moon is at, radians. */
  get angle(): number {
    return this.theta;
  }

  /** The period of a lap, seconds. */
  get period(): number {
    return this.opts.period;
  }

  set(opts: Partial<MoonOptions>): void {
    Object.assign(this.opts, opts);
    this.overlay.visible = this.opts.enabled;
    this.chain.enabled = this.opts.chain;
    this.chain.life = TRAIL_LIFE * this.opts.period;
  }

  setTokens(t: GlobeTokens): void {
    this.tk = t;
    // Face colors in the order of this mesh's pieces: bar, small hexagon, big hexagon, cap.
    this.faceS[Piece.Parallelogram]!.copy(hexS(t.moonSpark));
    this.faceS[Piece.SmallHex]!.copy(hexS(t.moonCumulus));
    this.faceS[Piece.BigHex]!.copy(hexS(t.moonNimbus));
    this.faceS[Piece.Cap]!.copy(hexS(t.moonStratus));
    const bu = this.bodyMat.uniforms;
    (bu.uEdgeS!.value as THREE.Vector3).copy(hexS(t.moonEdge));
    (bu.uEdgeHiS!.value as THREE.Vector3).copy(hexS(t.moonEdgeHi));
    this.hud.setTokens(t);
  }

  /** The pointer went down on the moon: it dips to 0.96 for 80 ms. */
  press(): void {
    this.pressT = 0.08;
  }

  /** Lifts the moon onto the sky orbit (true) or brings it back to the shell ring (false), with a blend. */
  lift(on: boolean): void {
    this.lifted = on;
  }

  /** True when the options ask for the sky orbit in this mode. */
  private skyWanted(ambient: boolean): boolean {
    const p = this.opts.placement;
    if (p === 'sky' || p === 'orbit' || p === 'world') return true;
    if (p === 'compact' || p === 'companion') return false;
    return ambient && !this.reduced;
  }

  /** Unit normal of the orbit plane (north-ish), for camera work. */
  orbitNormal(out: THREE.Vector3): THREE.Vector3 {
    orbitNormal(this.e1, this.e2, out);
    return out;
  }

  /** The orbit angle (radians) at a UTC time, on the shared clock every viewer has. */
  angleAtUtc(ms: number): number {
    return angleAtUtc(ms, this.opts.period);
  }

  /** The UTC time the moon runs on now (milliseconds): the world clock, smoothed. */
  utcNow(): number {
    return this.clockSet ? this.clockMs : Date.now();
  }

  /** Puts recent blocks on the orbit, each at the moon's angle when it was sealed. */
  seedChain(blocks: readonly ChainBlock[]): void {
    this.chain.seed(blocks, (ms) => this.angleAtUtc(ms), this.utcNow(), this.now);
  }

  /** World orbit position at `ahead` seconds from now (used by the director to frame future shots). */
  positionAt(ahead: number, out: THREE.Vector3): THREE.Vector3 {
    const o = this.opts;
    const moving = o.phase === null && !this.reduced;
    const th = this.theta + (moving ? (TAU * ahead * this.rateNow) / Math.max(1, o.period) : 0);
    orbitPoint(this.e1, this.e2, this.shape.radius, th, out);
    return out;
  }

  /** Light one piece white. `strength` 1 is a full flash; `dur` is the envelope in seconds (design: 0.34). */
  flare(piece: number, strength = 1, dur = 0.34): void {
    if (piece < 0 || piece > 3) return;
    const d = lerp(dur, Math.max(dur, 0.7), this.mixW);
    const u = (this.now - this.flareT0[piece]!) / this.flareDur[piece]!;
    const cur = u >= 0 && u <= 1 ? this.flareAmp[piece]! * Math.sin(Math.PI * u) : 0;
    if (strength < cur && u < 0.6) return;
    this.flareT0[piece] = this.now;
    this.flareDur[piece] = d;
    this.flareAmp[piece] = strength;
    this.kick[piece] = Math.max(this.kick[piece]!, strength * 0.7 * this.mixW);
  }

  flareAll(strength = 1, dur = 0.7): void {
    for (let k = 0; k < 4; k++) this.flare(k, strength, dur);
  }

  /**
   * The block reached the moon. Every piece flashes white and two rings leave it (shell), or a ring of
   * light crosses the faces and all pieces flare (sky). A bead is left on the orbit.
   * `height` is the block's height (for the chain).
   */
  seal(strength = 1, height = 0): void {
    this.chain.add(this.theta, height, this.now);
    this.recvT = 0;
    this.sealT = 0;
    this.sealStrength = strength;
    if (this.mixW > 0.5) {
      this.flareAll(0.55 * strength, 0.7);
      for (let k = 0; k < 4; k++) this.kick[k] = Math.max(this.kick[k]!, 0.4 * strength);
    }
  }

  /** World position of an anchor: pieces 0..3 (as drawn, with sway), or 4 for the center. */
  anchor(k: number, out: THREE.Vector3): THREE.Vector3 {
    if (k >= 4) return out.copy(this.pos);
    const p = this.model.pieces[k]!;
    _a.set(p.cx + this.off[k]!.x, p.cy + this.off[k]!.y, p.front * 0.5 + this.off[k]!.z);
    return out.copy(_a).multiplyScalar(this.unit).applyQuaternion(this.quat).add(this.pos);
  }

  /** A piece's center relative to the moon's center, in CSS pixels. */
  piecePixels(k: number, out: { x: number; y: number }): void {
    out.x = this.piecePx[k * 2]!;
    out.y = this.piecePx[k * 2 + 1]!;
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
    const sc = this.screen;
    s.x = sc.x;
    s.y = sc.y;
    s.s = sc.s;
    s.r = 0.74 * sc.s;
    s.z = this.zCue;
    s.visible = this.opts.enabled && !this.boot && sc.onScreen;
    s.vis = sc.vis;
    s.hover = this.hoverTarget > 0.5;
    s.phase = this.theta;
    return s;
  }

  /**
   * The orbit the shell uses for a viewport. `compactOrbit` searches a little (about 1.7 ms), so its answer
   * is cached by size and asked for at most every 100 ms during a live resize; the ring glides to it
   * (about 0.2 s), so a resized window or a turned phone never makes the moon jump.
   */
  private fitShell(w: number, h: number, ins: Inset, dt: number, time: number): void {
    const key = `${Math.round(w)}x${Math.round(h)}:${Math.round(ins.left)},${Math.round(ins.right)},${Math.round(ins.top)},${Math.round(ins.bottom)}`;
    if (key !== this.shellKey && w >= 64 && h >= 64 && (!this.placed || time - this.shellAt > 0.1)) {
      this.shellKey = key;
      this.shellAt = time;
      compactOrbit(w, h, this.shellGoal, ins);
    }
    const s = this.shell;
    const g = this.shellGoal;
    const v = this.shellV;
    if (!this.placed) {
      copyShape(g, s);
      v.fill(0);
      return;
    }
    // A critically damped spring (exact for any dt): it starts from rest, so the ring never lurches.
    const rate = 9;
    s.radius = spring(s.radius, g.radius, v, 0, rate, dt);
    s.inclination = spring(s.inclination, g.inclination, v, 1, rate, dt);
    s.node = spring(s.node, s.node + wrapPi(g.node - s.node), v, 2, rate, dt);
    s.size = spring(s.size, g.size, v, 3, rate, dt);
  }

  /** Advances the world clock by this frame and pulls it to the source, so a coarse timer does not show as steps. */
  private stepClock(dt: number, rate: number, utcMs: number | undefined): void {
    const target = utcMs ?? Date.now();
    if (!this.clockSet || Math.abs(target - this.clockMs) > 2000 + 1000 * Math.abs(rate)) {
      this.clockMs = target;
      this.clockSet = true;
      return;
    }
    this.clockMs += dt * 1000 * rate;
    this.clockMs += (target - this.clockMs) * (1 - Math.exp(-dt / 1.2));
  }

  /**
   * Where reduced motion seats the moon: the angle at which the camera sees it in the clear and inside the
   * free area, nearest the place the design wants it (the upper right of the planet, beside it in the
   * screensaver, where the counters own the upper right). The shape and basis are this frame's.
   */
  private seat(view: MoonView, ambient: boolean): number {
    const cam = view.camera;
    const shape = this.shape;
    _v.set(0, 0, 0).project(cam);
    const cx = (_v.x * 0.5 + 0.5) * view.cssW;
    const cy = (-_v.y * 0.5 + 0.5) * view.cssH;
    const R = Math.max(view.planetR, 1);
    const tx = cx + (ambient ? 1.55 : 1.45) * R;
    const ty = cy - (ambient ? 0.1 : 0.35) * R;
    const ins = ambient ? NO_INSET : view.inset;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = -1;
    let bestD = Infinity;
    let any = -1;
    let anyD = Infinity;
    for (let k = 0; k < 360; k++) {
      const th = k * DEG;
      orbitPoint(this.e1, this.e2, shape.radius, th, _c);
      _d.copy(_c).sub(cam.position);
      const depth = _d.dot(_f);
      if (depth < 0.3 || planetVisibility(cam.position, _c) < 0.999) continue;
      _v.copy(_c).project(cam);
      const x = (_v.x * 0.5 + 0.5) * view.cssW;
      const y = (-_v.y * 0.5 + 0.5) * view.cssH;
      const d = Math.hypot(x - tx, y - ty);
      // The whole symbol, not just its centre, must be clear: in front of the planet, or beside its disc by
      // the symbol's own radius.
      const half = 0.5 * Math.max(MIN_MOON_PX, (shape.size * view.projScale) / depth) * this.opts.scale;
      const front = _c.dot(cam.position) > 0;
      if (!front && Math.hypot(x - cx, y - cy) < R + half + 8) continue;
      if (d < anyD) {
        anyD = d;
        any = th;
      }
      const inside =
        x >= ins.left + half + 10 &&
        x <= view.cssW - ins.right - half - 10 &&
        y >= ins.top + half + 10 &&
        y <= view.cssH - ins.bottom - half - 10;
      if (inside && d < bestD) {
        bestD = d;
        best = th;
      }
    }
    return best >= 0 ? best : any >= 0 ? any : this.parkTheta;
  }

  update(dt: number, time: number, view: MoonView, opt: MoonFrame): void {
    const o = this.opts;
    if (!o.enabled) {
      this.screen.onScreen = false;
      this.screen.hit = false;
      return;
    }
    this.now = time;
    const cam = view.camera;
    const reduced = this.reduced;
    const boot = this.boot;
    const tk = this.tk;

    // ---- which orbit: the shell ring or the sky orbit (a 900 ms blend of the orbit's parameters) ----
    const target = this.lifted ? 1 : this.skyWanted(opt.ambient) ? 1 : 0;
    if (!this.placed) this.mixW = target;
    else this.mixW += clamp(target - this.mixW, -dt / 0.9, dt / 0.9);
    if (Math.abs(this.mixW - target) < 0.0005) this.mixW = target;
    const e = smoother(clamp(this.mixW, 0, 1));

    this.fitShell(view.cssW, view.cssH, view.insetGoal ?? view.inset, dt, time);
    this.skyShape.radius = o.orbit;
    this.skyShape.inclination = o.inclination * DEG;
    this.skyShape.node = o.node * DEG;
    this.skyShape.size = o.size;
    blendShape(this.shell, this.skyShape, e, this.shape);
    const shape = this.shape;
    orbitBasis(shape.inclination, shape.node, this.e1, this.e2);

    // ---- where on the orbit: the UTC clock, nothing else ----
    this.rateNow = opt.rate;
    const park = reduced && o.phase === null;
    let th: number;
    if (o.phase !== null) th = o.phase * DEG;
    else if (park) {
      if (!this.parkOn) {
        // Entering reduced motion: the moon stays where it is while it is in view, else it takes a seat.
        this.parkOn = true;
        this.parkFade = 1;
        this.parkHidden = 0;
        this.parkSwap = false;
        this.parkTheta =
          this.placed && this.screen.onScreen && this.screen.vis > 0.5
            ? this.theta
            : this.seat(view, opt.ambient);
      }
      th = this.parkTheta;
    } else {
      this.parkOn = false;
      this.stepClock(dt, opt.rate, opt.utcMs);
      th = angleAtUtc(this.clockMs, o.period);
    }
    this.theta = th;
    orbitPoint(this.e1, this.e2, shape.radius, th, this.orbitPos);
    const P = this.orbitPos;

    // ---- the camera's frame, and where the orbit point is in it ----
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _d.copy(P).sub(cam.position);
    const dist = _d.length();
    const depthW = _d.dot(_f);
    let ox = view.cssW / 2;
    let oy = view.cssH / 2;
    if (depthW > 0.02) {
      _v.copy(P).project(cam);
      if (Number.isFinite(_v.x) && Number.isFinite(_v.y)) {
        ox = (_v.x * 0.5 + 0.5) * view.cssW;
        oy = (-_v.y * 0.5 + 0.5) * view.cssH;
      }
    }

    // ---- size: true perspective, kept legible far away and from swallowing the frame near ----
    if (this.pressT > 0) this.pressT = Math.max(0, this.pressT - dt);
    this.hover = damp(this.hover, this.hoverTarget, 9, dt);
    // From far away (the wide landing shot) it grows a little, so it stays a presence in the frame.
    const far = 1 + 0.45 * smoothstep(4.2, 8.2, dist) * e;
    this.farK = this.placed ? damp(this.farK, far, 3, dt) : far;
    const dSafe = Math.max(depthW, 0.02);
    const pxPer = view.projScale / dSafe;
    // The floor is a legibility and touch-target floor: the phone's smaller scale does not lower it.
    const minPx = MIN_MOON_PX;
    const maxPx = clamp(0.26 * Math.min(view.cssW, view.cssH), 110, 240) * o.scale;
    let px = Math.max(shape.size * o.scale * this.farK * pxPer, minPx);
    // A free shot (the moon portrait, the earthrise) lifts the cap, and the cap returns with it: eased, never a jump.
    const capGoal = opt.free ? 0 : 1;
    this.capK = this.placed ? damp(this.capK, capGoal, 5, dt) : capGoal;
    if (this.capK > 0.001) px = lerp(px, softCap(px, maxPx), this.capK);
    // Hover grows it a touch and a press dips it (design 7.10.11).
    px *= (1 + 0.08 * this.hover) * (this.pressT > 0 ? 0.96 : 1);
    // It fades out as the camera comes right up to it, so it never clips the near plane.
    const nearFade = smoothstep(0.04, 0.3, depthW);

    // ---- boot: the symbol sits where the boot puts it, then arcs into its place on the orbit ----
    let bx = ox;
    let by = oy;
    let bs = px;
    let depthB = dSafe;
    let be = 1;
    let flat = 0;
    let depthK = 1;
    let glowK = 1;
    let ringK = 1;
    let alphaK = 1;
    let white = 0;
    if (boot) {
      be = easeInOutCubic(clamp(boot.lift, 0, 1));
      bx = lerp(boot.cx, ox, be);
      // The lift arcs, rising 12% of the viewport height mid-flight; reduced motion has no arc.
      by = lerp(boot.cy, oy, be) - (reduced ? 0 : Math.sin(Math.PI * be) * view.cssH * 0.12);
      bs = lerp(boot.size, px, be);
      depthB = lerp(Math.max(0.006, 0.5 * Math.max(view.surf, 0.012)), dSafe, be);
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
    if (park) alphaK *= this.parkFade;
    // World position: the orbit point itself, or (while the boot's symbol is still a screen object) the
    // point under its pixel at its own depth. The two meet exactly at the end of the lift.
    if (boot && be < 1) {
      _v.set((bx / view.cssW) * 2 - 1, 1 - (by / view.cssH) * 2, 0.5).unproject(cam);
      _d.copy(_v).sub(cam.position).normalize();
      const along = Math.max(_d.dot(_f), 1e-3);
      this.pos.copy(cam.position).addScaledVector(_d, depthB / along);
    } else this.pos.copy(P);
    this.unit = ((bs / SYM_H) * depthB) / view.projScale;
    this.radius = this.model.radius * this.unit * 0.92;
    this.markPx = bs / SYM_H;
    // The planet may hide it, except while the boot's symbol is a flat screen object.
    const occ = boot ? smoothstep(0.55, 1, be) : 1;
    const visC = planetVisibility(cam.position, this.pos);
    this.zCue = clamp((cam.position.length() - dist) / Math.max(shape.radius, 0.1), -1, 1);

    // ---- orientation: parallel to the image plane, upright against screen-up, with a slow sway ----
    const swayK = reduced ? 0 : boot ? be : 1;
    const yaw = reduced ? 0.2 : (this.sway * Math.sin(time * 0.09 + 0.6) + 0.08) * swayK;
    const pitch = reduced ? 0.08 : this.sway * 0.42 * Math.sin(time * 0.061 + 2.1) * swayK;
    _q.copy(cam.quaternion);
    _q2.setFromAxisAngle(AY, yaw);
    _q.multiply(_q2);
    _q2.setFromAxisAngle(AX, pitch);
    _q.multiply(_q2);
    this.quat.copy(_q);

    // Breathing assembly (sky only): locked most of the time, a slow drift apart, a quick lock with a tick of light.
    const breath = (reduced ? 0 : opt.ambient ? Math.max(o.breath, 0.9) : o.breath) * e;
    const T = 15;
    let sAvg = 0;
    const hovSep = this.hover * e;
    for (let k = 0; k < 4; k++) {
      const u = ((((time + this.lag[k]! * T) / T) % 1) + 1) % 1;
      let s = 0;
      if (u >= 0.5 && u < 0.8) s = easeInOutCubic((u - 0.5) / 0.3);
      else if (u >= 0.8 && u < 0.88) s = 1;
      else if (u >= 0.88) s = 1 - easeOutCubic((u - 0.88) / 0.12);
      s = Math.max(s * breath, hovSep * 0.55);
      sAvg += s / 4;
      const a = this.amp[k]! * s + this.kick[k]! * 9;
      this.off[k]!.copy(this.dir[k]!).multiplyScalar(a);
      this.off[k]!.z = this.zdir[k]! * 14 * s + this.kick[k]! * 4 * this.zdir[k]!;
      this.vis[k] = 1;
      this.outlineBuf[k] = 0;
      if (boot) {
        // The design's order is bar, cap, big hexagon, small hexagon; this mesh's is bar, small, big, cap.
        const bi = k === Piece.Parallelogram ? 0 : k === Piece.Cap ? 1 : k === Piece.BigHex ? 2 : 3;
        const p = clamp(boot.pieces[bi], 0, 1);
        this.outlineBuf[k] = 1 - smoothstep(0.82, 1.0, p);
        const r = reduced ? 0 : 1 - easeOutBack(p);
        this.off[k]!.x += BOOT_FROM[bi]![0]! * r;
        this.off[k]!.y += BOOT_FROM[bi]![1]! * r;
        // `alpha` fades the whole symbol through the same ordered dither (the reduced-motion boot cross-fades with it).
        this.vis[k] = reduced ? smoothstep(0, 0.5, p) : smoothstep(0, 0.1, p);
      }
    }
    this.spread = sAvg;
    const cycle = Math.floor(time / T);
    if (!reduced && breath > 0.05 && this.lastCycle >= 0 && cycle !== this.lastCycle)
      this.flareAll(0.22 * breath + 0.05, 0.7);
    this.lastCycle = cycle;

    // Envelopes.
    let lt = 0;
    const kk = Math.exp(-dt / 0.22);
    for (let k = 0; k < 4; k++) {
      const u = (time - this.flareT0[k]!) / this.flareDur[k]!;
      const v = u >= 0 && u <= 1 ? this.flareAmp[k]! * Math.sin(Math.PI * u) : 0;
      this.flareV[k] = v;
      this.kick[k]! *= kk;
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

    // ---- uniforms: the body and its mask ----
    _c.set(this.unit, this.unit, this.unit);
    this.body.matrix.compose(this.pos, this.quat, _c);
    this.body.matrixWorld.copy(this.body.matrix);
    this.body.matrixWorldNeedsUpdate = false;
    this.mask.matrix.copy(this.body.matrix);
    this.mask.matrixWorld.copy(this.body.matrix);
    this.mask.matrixWorldNeedsUpdate = false;
    _m3.setFromMatrix4(_m.makeRotationFromQuaternion(this.quat));
    const bu = this.bodyMat.uniforms;
    (bu.uRot!.value as THREE.Matrix3).copy(_m3);
    _q2.copy(this.quat).invert();
    (bu.uCamLocal!.value as THREE.Vector3)
      .copy(cam.position)
      .sub(this.pos)
      .applyQuaternion(_q2)
      .divideScalar(this.unit);
    (bu.uSunLocal!.value as THREE.Vector3).copy(this.u.uSunDir.value).applyQuaternion(_q2);
    const lit = 1 - 0.88 * this.dim;
    bu.uGlow!.value = o.glow * lit * (0.92 + 0.08 * Math.sin(time * 0.7));
    bu.uEdge!.value = 1 + 0.12 * Math.sin(time * 0.43 + 1.0);
    bu.uHover!.value = this.hover * e;
    const seal = bu.uSeal!.value as THREE.Vector4;
    const big0 = this.model.pieces[Piece.Parallelogram]!;
    seal.set(this.sealT, this.sealStrength * e, big0.cx, big0.cy);
    const depthL = (tk ? tk.moonDepth : 0.14) * SYM_H * depthK * (1 - flat);
    // The tonal faces carry their thickness as an oblique extrusion toward the lower right (the design's
    // light is at the top left); in the sky the sway shows it in true perspective instead.
    (bu.uObl!.value as THREE.Vector2).set(0.62 * depthL * (1 - e), -0.78 * depthL * (1 - e));
    // Look: tonal on the shell, glass in the sky (a transition blends them).
    bu.uLook!.value = 1 - e;
    bu.uFlat!.value = flat;
    bu.uLite!.value = o.lite ? 1 : 0;
    bu.uFlash!.value = this.flash;
    bu.uMark!.value = this.markPx;
    bu.uAlpha!.value = alphaK * nearFade;
    bu.uOcc!.value = occ;
    const shown = alphaK * nearFade > 0.002;
    this.body.visible = this.mask.visible = shown;

    // Anchors for the ray layer, and the pieces' places on screen.
    const anchors = this.u.uAnchor.value;
    for (let k = 0; k < 4; k++) {
      this.anchor(k, _v);
      anchors[k]!.set(_v.x, _v.y, _v.z, 1);
      const p = this.model.pieces[k]!;
      this.piecePx[k * 2] = (p.cx + this.off[k]!.x) * this.markPx;
      this.piecePx[k * 2 + 1] = -(p.cy + this.off[k]!.y) * this.markPx;
    }
    anchors[4]!.set(this.pos.x, this.pos.y, this.pos.z, 1);

    // ---- the glow, the block clock and the rings ----
    const late = this.status === 'late' || this.status === 'offline';
    const glowScale = late ? 0.25 / 0.55 : 1;
    const glowTok = tk ? tk.moonGlowAlpha : 0.55;
    const beat = clamp(this.beat, 0, 1);
    const ringShown = this.status === 'archive' ? 0 : ringK;
    const last3 = smoothstep(0.88, 0.93, beat) * (this.status === 'live' ? 1 : 0);
    this.hud.update({
      cssW: view.cssW,
      cssH: view.cssH,
      pxScale: view.pxScale,
      x: bx,
      y: by,
      s: bs,
      k: this.markPx,
      glowA:
        glowTok *
        glowK *
        glowScale *
        (0.85 + 0.15 * Math.sin(time * 1.3) + 0.4 * this.hover + 0.5 * this.flash),
      flash: this.flash,
      hover: this.hover,
      beat: reduced ? Math.floor(beat * 30) / 30 : beat,
      ringA: ringShown * (1 + 0.2 * last3) * (this.emission ? 1.25 : 1),
      ringFlash,
      recv,
      lite: o.lite,
      pieceFlash: this.flareV,
      piecePx: this.piecePx,
      outline: this.outlineBuf,
      alpha: (1 - e) * alphaK * nearFade,
      depth: depthB,
      occlusion: occ,
    });

    // ---- the sky's glow: billboards behind and between the pieces ----
    const sky = e > 0.002 && shown;
    this.seam.visible = this.halo.visible = sky;
    if (sky) {
      const hu = this.haloMat.uniforms;
      (hu.uCenter!.value as THREE.Vector3).copy(this.pos);
      hu.uRadius!.value = this.radius * 2.3;
      hu.uIntensity!.value =
        (0.11 + 0.55 * Math.min(1.5, lt * 0.5) + 0.12 * this.spread + 0.1 * this.hover) *
        o.glow *
        (1 - 0.8 * this.dim) *
        e *
        alphaK *
        nearFade;
      const su = this.seamMat.uniforms;
      // Behind the body, away from the camera.
      _v.copy(_f)
        .multiplyScalar(this.model.pieces[Piece.BigHex]!.depth * 0.3 * this.unit)
        .add(this.pos);
      (su.uCenter!.value as THREE.Vector3).copy(_v);
      su.uRadius!.value = this.radius * 0.95;
      su.uIntensity!.value =
        (0.1 + 0.9 * this.spread + 0.6 * Math.min(1.5, lt * 0.5)) *
        o.glow *
        (1 - 0.8 * this.dim) *
        e *
        alphaK *
        nearFade;
    }

    // ---- the chain: the wake and a bead for every block, on the real orbit ----
    // The trail fades in once the boot has landed and after reduced motion ends, and out when either begins.
    const trailGoal = reduced || boot ? 0 : nearFade;
    this.trailK = this.placed ? damp(this.trailK, trailGoal, 3.2, dt) : trailGoal;
    const trailA = this.trailK;
    this.chain.update(
      time,
      this.e1,
      this.e2,
      shape.radius,
      th,
      this.unit * SYM_H,
      (1 + 0.8 * this.flash) * (o.lite ? 0 : 1),
      trailA,
      clamp(bs / 65, 0.6, 1.8),
    );

    // ---- where it is on screen, for the pointer, the proxy and the tethers ----
    const sc = this.screen;
    sc.x = bx;
    sc.y = by;
    sc.s = bs;
    sc.r = Math.max(22, 0.6 * bs);
    sc.depth = depthB;
    sc.vis = visC;
    sc.onScreen =
      depthW > 0.05 &&
      bx > -sc.r &&
      bx < view.cssW + sc.r &&
      by > -sc.r &&
      by < view.cssH + sc.r &&
      nearFade > 0.2;
    sc.hit = sc.onScreen && !boot && visC > 0.6 && this.parkFade > 0.5;
    this.placed = true;

    // ---- reduced motion: a seat out of sight is given up (fade, new seat, fade in), after half a second ----
    if (park) {
      const inView = sc.onScreen && visC > 0.5;
      this.parkHidden = inView ? 0 : this.parkHidden + dt;
      if (!this.parkSwap && this.parkHidden > 0.5) this.parkSwap = true;
      if (this.parkSwap) {
        this.parkFade -= dt / 0.25;
        if (this.parkFade <= 0) {
          this.parkFade = 0;
          this.parkTheta = this.seat(view, opt.ambient);
          this.parkSwap = false;
          this.parkHidden = 0;
        }
      } else if (this.parkFade < 1) this.parkFade = Math.min(1, this.parkFade + dt / 0.25);
    }
  }

  dispose(): void {
    this.chain.dispose();
    this.hud.dispose();
    this.model.geometry.dispose();
    this.bodyMat.dispose();
    this.maskMat.dispose();
    this.seamMat.dispose();
    this.haloMat.dispose();
    this.seam.geometry.dispose();
  }
}

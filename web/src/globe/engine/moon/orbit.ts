// The Flux moon's world orbit (design 7.10.4): pure math, nothing here touches three.js or the DOM.
//
// The moon is a real object in the planet's frame. Its position is a function of UTC time and nothing
// else: the camera never moves it along its path. The orbit is a circle around the planet's centre,
// prograde (it travels east, like the planet turns), described by its radius, inclination to the
// equator and the longitude of its ascending node. The sun moves around this frame, so an orbit that
// is fixed here sees every phase of light over a day.
//
//   position(t) = radius * (cos(theta) * e1 + sin(theta) * e2),   theta = 2 pi * (t mod period) / period
//
// Every viewer computes the same theta from the same UTC clock, so every viewer sees the moon in the
// same place; the beads of the chain (one per sealed block) are placed with the same function at the
// time the block was sealed.
//
// Two shapes are blended by the moon: the compact orbit of the shell, shaped and sized for the screen so
// that the whole lap fits the free area at the default zoom, and the wide orbit of the sky (ambient mode
// and the cinematic shots).

import { computeFraming, DEFAULT_FRAMING, type FramingSpec } from '../framing';
import { clamp, DEG, lerp, TAU, wrapPi } from '../math';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Docked UI, CSS pixels: the parts of the viewport the moon's lap should stay out of. */
export interface Inset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What defines an orbit besides its period. Angles in radians, lengths in globe radii. */
export interface OrbitShape {
  /** Distance from the planet's centre to the moon's centre. */
  radius: number;
  /** Angle between the orbit plane and the equator. */
  inclination: number;
  /** Longitude of the ascending node (where the moon crosses the equator going north). */
  node: number;
  /** Height of the symbol, as drawn at the planet's depth by a camera looking at the planet's centre. */
  size: number;
}

/** One lap, seconds. Beads are placed by `angleAtUtc`, so a lap that is a whole number of blocks lines them up. */
export const ORBIT_PERIOD_S = 240;

/** The planet's disc is faded over this band outside its limb (globe radii), the atmosphere's depth. */
export const LIMB_BAND = 0.035;

/** The camera the shell frames at first load (CameraRig's constructor, GlobeEngine's portrait framing). */
export const HOME = { lat: 18, lon: 10, range: 3.6, rangePortrait: 2.85 } as const;

/**
 * The sky orbit of ambient mode and the cinematic shots: wider, bigger and steeper. It is the plane the
 * lab's sky orbit always used (27 degrees, node 250 in this file's convention), so the moon shots frame
 * what they were composed for.
 */
export const SKY_ORBIT: OrbitShape = {
  radius: 2.05,
  inclination: 27 * DEG,
  node: 250 * DEG,
  size: 0.36,
};

// ---- the orbit's geometry -------------------------------------------------------------------------

export function copyShape(a: OrbitShape, out: OrbitShape): OrbitShape {
  out.radius = a.radius;
  out.inclination = a.inclination;
  out.node = a.node;
  out.size = a.size;
  return out;
}

/** `out = a + (b - a) * t`, parameter by parameter (every blend of two orbits is itself a valid circle). */
export function blendShape(a: OrbitShape, b: OrbitShape, t: number, out: OrbitShape): OrbitShape {
  out.radius = lerp(a.radius, b.radius, t);
  out.inclination = lerp(a.inclination, b.inclination, t);
  // The node turns the short way round.
  out.node = a.node + wrapPi(b.node - a.node) * t;
  out.size = lerp(a.size, b.size, t);
  return out;
}

/**
 * The in-plane basis of an orbit: `e1` points at the ascending node (on the equator), `e2` a quarter
 * turn ahead (east and north of it), so theta runs east. The orbit normal is `e1 x e2`.
 */
export function orbitBasis(inclination: number, node: number, e1: V3, e2: V3): void {
  const sn = Math.sin(node);
  const cn = Math.cos(node);
  const ci = Math.cos(inclination);
  const si = Math.sin(inclination);
  // e1: the node on the equator, longitude `node` (lon 0 is +Z, lon 90E is +X).
  e1.x = sn;
  e1.y = 0;
  e1.z = cn;
  // e2: east at the node, tilted north by the inclination.
  e2.x = cn * ci;
  e2.y = si;
  e2.z = -sn * ci;
}

/** The moon's centre at angle `theta` (radians) on an orbit with basis `e1`, `e2` and radius `r`. */
export function orbitPoint(e1: V3, e2: V3, r: number, theta: number, out: V3): V3 {
  const c = Math.cos(theta) * r;
  const s = Math.sin(theta) * r;
  out.x = e1.x * c + e2.x * s;
  out.y = e1.y * c + e2.y * s;
  out.z = e1.z * c + e2.z * s;
  return out;
}

/** Unit normal of the orbit plane (the direction a prograde orbit turns about, north-ish). */
export function orbitNormal(e1: V3, e2: V3, out: V3): V3 {
  out.x = e1.y * e2.z - e1.z * e2.y;
  out.y = e1.z * e2.x - e1.x * e2.z;
  out.z = e1.x * e2.y - e1.y * e2.x;
  return out;
}

/** The orbit angle at a UTC time (milliseconds): the same for every viewer. In [0, 2 pi). */
export function angleAtUtc(utcMs: number, periodS = ORBIT_PERIOD_S, phase0 = 0): number {
  // Reduce in seconds first: the fraction of a lap keeps its precision this way.
  const into = (utcMs / 1000) % periodS;
  const lap = (into < 0 ? into + periodS : into) / periodS;
  return (((TAU * lap + phase0) % TAU) + TAU) % TAU;
}

/** The UTC time (milliseconds) of the last moment at or before `nowMs` when the moon was at angle `theta`. */
export function utcAtAngle(theta: number, nowMs: number, periodS = ORBIT_PERIOD_S, phase0 = 0): number {
  const behind = (((angleAtUtc(nowMs, periodS, phase0) - theta) % TAU) + TAU) % TAU;
  return nowMs - (behind / TAU) * periodS * 1000;
}

// ---- the planet hides what is behind it -----------------------------------------------------------

/**
 * How much of a point the planet leaves visible from `cam`, 0 to 1 (the CPU twin of `PLANET_VIS_GLSL`
 * in occlusion.ts). A point in front of the planet's centre plane is always visible; one behind it fades
 * over `band` (globe radii) outside the limb and is hidden behind the disc. The ray is measured to the
 * point's own distance, so the moon passing between the camera and the planet is never affected.
 */
export function planetVisibility(cam: V3, p: V3, band = LIMB_BAND): number {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const tf = Math.hypot(dx, dy, dz);
  if (tf < 1e-6) return 1;
  const rx = dx / tf;
  const ry = dy / tf;
  const rz = dz / tf;
  const tc = -(cam.x * rx + cam.y * ry + cam.z * rz);
  if (tc >= tf) return 1;
  const qx = cam.x + rx * tc;
  const qy = cam.y + ry * tc;
  const qz = cam.z + rz * tc;
  const b = Math.hypot(qx, qy, qz);
  const t = clamp((b - 1) / Math.max(band, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---- the compact orbit of the shell, shaped and sized for the screen ------------------------------

/** The shell's design radius: a ring around the planet, 0.5 radii above its surface. */
export const SHELL_RADIUS = 1.5;

/** The moon never gets smaller than this on screen (CSS px tall), so it stays legible far from the camera. */
export const MIN_MOON_PX = 40;

/**
 * The ring as the home camera sees it: its roll (the angle of its long axis above horizontal on screen),
 * its opening (how far the plane is tipped toward the camera) and the moon's size, for a landscape and a
 * portrait screen. Landscape rolls it a little ("/": the moon rises on the right); other screens turn it
 * as far as they need to for the whole lap to fit (`compactOrbit`).
 */
export const SHELL_ROLL = { landscape: 11 * DEG } as const;
export const SHELL_OPEN = { landscape: 13 * DEG, portrait: 18 * DEG } as const;
export const SHELL_SIZE = { landscape: 0.2, portrait: 0.235 } as const;
const ROLLS = [11, 20, 30, 40, 50, 60, 70, 80, 90].map((d) => d * DEG);

/**
 * The shell's chrome with nothing open, by layout: the dock at the left, the top bar, and the block rail
 * and status bar below (desktop); the header over the globe and the tab bar under it (phone, under 720
 * px wide). The compact orbit is sized to what these leave free. Windows opening later do not resize it:
 * the globe slides in the free area and the moon goes with it, as one system.
 */
export const CHROME = {
  desktop: { left: 80, right: 0, top: 52, bottom: 154 },
  phone: { left: 0, right: 0, top: 96, bottom: 64 },
} as const satisfies Record<string, Inset>;

/** The chrome insets the compact orbit is sized to for a viewport width. */
export function chromeFor(w: number): Inset {
  return w < 720 ? CHROME.phone : CHROME.desktop;
}

/** How far a screen is toward portrait: 0 landscape (from 1.15 wide), 1 portrait (under 0.8, where the engine reframes). */
export function portraitness(aspect: number): number {
  const t = clamp((1.15 - aspect) / (1.15 - 0.8), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The orbit plane that the home camera sees as a ring rolled by `roll` (radians, the angle of its long
 * axis above horizontal on screen; 90 degrees is upright) and opened by `open` (radians, the angle
 * between the line of sight and the plane: 0 is edge on, 90 face on). Writes the plane as an
 * inclination and a node; the direction of travel is prograde.
 */
export function planeFromHome(roll: number, open: number, out: { inclination: number; node: number }): void {
  const la = HOME.lat * DEG;
  const lo = HOME.lon * DEG;
  const cl = Math.cos(la);
  const sl = Math.sin(la);
  const co = Math.cos(lo);
  const so = Math.sin(lo);
  // T toward the camera, E to its right, N up on screen (CameraRig.frameFromLatLon).
  const tx = cl * so;
  const ty = sl;
  const tz = cl * co;
  const ex = co;
  const ez = -so;
  const nx = -sl * so;
  const ny = cl;
  const nz = -sl * co;
  // m: the short axis of the ring on screen; the plane's normal is n = sin(open) T + cos(open) m.
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const mx = -sr * ex + cr * nx;
  const my = cr * ny;
  const mz = -sr * ez + cr * nz;
  const sOpen = Math.sin(open);
  const cOpen = Math.cos(open);
  let px = sOpen * tx + cOpen * mx;
  let py = sOpen * ty + cOpen * my;
  let pz = sOpen * tz + cOpen * mz;
  // Prograde: the normal is on the north side.
  if (py < 0) {
    px = -px;
    py = -py;
    pz = -pz;
  }
  out.inclination = Math.atan2(Math.hypot(px, pz), py);
  // The line of nodes is y x n = (nz, 0, -nx) / sin(i); the node is its longitude.
  out.node = Math.atan2(pz, -px);
}

/**
 * The camera at first load for a screen, as plain numbers: the planet's centre is `(cx, cy)`, `f` is the
 * focal length in pixels, `T` the unit vector from the planet's centre to the camera, `E` and `N` the
 * camera's right and up. It mirrors CameraRig (home pose, 34 degree field of view widened on portrait
 * screens) and the engine's framing (framing.ts: the planet centred in the free area and the lens
 * widened until its envelope clears the chrome); orbit.test.ts checks it against a real rig.
 */
export interface HomeView {
  w: number;
  h: number;
  f: number;
  cx: number;
  cy: number;
  dist: number;
  /** The planet's radius on screen at the home zoom, CSS px. */
  planetR: number;
  T: V3;
  E: V3;
  N: V3;
}

export function homeView(w: number, h: number, inset: Inset, spec: FramingSpec = DEFAULT_FRAMING): HomeView {
  const aspect = w / h;
  const baseFov = 34;
  const fovAspect =
    aspect < 1 ? clamp((2 * Math.atan(Math.tan((baseFov * DEG) / 2) / aspect)) / DEG, baseFov, 66) : baseFov;
  const tanBase = Math.tan((fovAspect * DEG) / 2);
  const range = aspect < 0.8 ? HOME.rangePortrait : HOME.range;
  const fr = computeFraming({ w, h, inset, tanHalfFov: tanBase, homeRange: range }, spec);
  const la = HOME.lat * DEG;
  const lo = HOME.lon * DEG;
  const cl = Math.cos(la);
  const sl = Math.sin(la);
  const co = Math.cos(lo);
  const so = Math.sin(lo);
  return {
    w,
    h,
    // The framing widens the lens: tan(fov / 2) is divided by the fit.
    f: (0.5 * h * fr.fit) / tanBase,
    cx: fr.cx,
    cy: fr.cy,
    dist: 1 + range,
    planetR: fr.homeRadius,
    T: { x: cl * so, y: sl, z: cl * co },
    E: { x: co, y: 0, z: -so },
    N: { x: -sl * so, y: cl, z: -sl * co },
  };
}

/** Where a world point is on screen from the home camera (CSS px) and its depth along the view axis. */
export function projectHome(v: HomeView, p: V3, out: { x: number; y: number; depth: number }): void {
  const dx = p.x - v.T.x * v.dist;
  const dy = p.y - v.T.y * v.dist;
  const dz = p.z - v.T.z * v.dist;
  const depth = -(dx * v.T.x + dy * v.T.y + dz * v.T.z);
  out.depth = depth;
  out.x = v.cx + (v.f * (dx * v.E.x + dy * v.E.y + dz * v.E.z)) / depth;
  out.y = v.cy - (v.f * (dx * v.N.x + dy * v.N.y + dz * v.N.z)) / depth;
}

const _p: V3 = { x: 0, y: 0, z: 0 };
const _s = { x: 0, y: 0, depth: 0 };
const _e1: V3 = { x: 0, y: 0, z: 0 };
const _e2: V3 = { x: 0, y: 0, z: 0 };

/**
 * How far (CSS px) the moon sticks out of the free area at its worst point of a lap, seen from the home
 * camera; 0 when the whole lap fits. The moon's size is the shape's, at its depth, never under `MIN_MOON_PX`.
 */
export function lapOverflow(v: HomeView, shape: OrbitShape, inset: Inset, margin = 10): number {
  orbitBasis(shape.inclination, shape.node, _e1, _e2);
  const L = inset.left + margin;
  const R = v.w - inset.right - margin;
  const T = inset.top + margin;
  const B = v.h - inset.bottom - margin;
  let over = 0;
  for (let k = 0; k < 360; k++) {
    orbitPoint(_e1, _e2, shape.radius, (k / 360) * TAU, _p);
    projectHome(v, _p, _s);
    const r = 0.5 * Math.max(MIN_MOON_PX, (shape.size * v.f) / _s.depth);
    over = Math.max(over, L - (_s.x - r), _s.x + r - R, T - (_s.y - r), _s.y + r - B);
  }
  return Math.max(0, over);
}

/**
 * The largest radius up to `shape.radius` (and not under `floor`) at which the whole lap fits the free
 * area at the default zoom. A wide screen keeps the design radius; a squarer or taller one shrinks it.
 */
export function fitRadius(w: number, h: number, shape: OrbitShape, inset: Inset, floor = 1.06): number {
  const v = homeView(w, h, inset);
  const trial: OrbitShape = { ...shape };
  // A pixel more margin than the tests ask for, so sampling the lap cannot miss its worst point.
  const margin = 11;
  trial.radius = shape.radius;
  if (lapOverflow(v, trial, inset, margin) <= 0) return shape.radius;
  let lo = floor;
  let hi = shape.radius;
  for (let i = 0; i < 12; i++) {
    const mid = 0.5 * (lo + hi);
    trial.radius = mid;
    if (lapOverflow(v, trial, inset, margin) <= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The compact orbit for a viewport. The ring is rolled and sized so the whole lap fits what the shell's
 * chrome leaves free at the default zoom: the design's landscape ring wherever it fits at full size,
 * and otherwise the smallest turn (up to upright) that lets the ring keep the most radius. A phone gets
 * a tall ring, a squarer window a leaning one. Writes `out`.
 */
export function compactOrbit(w: number, h: number, out: OrbitShape): OrbitShape {
  const p = portraitness(w / Math.max(1, h));
  const open = lerp(SHELL_OPEN.landscape, SHELL_OPEN.portrait, p);
  const inset = chromeFor(w);
  out.size = lerp(SHELL_SIZE.landscape, SHELL_SIZE.portrait, p);
  out.radius = SHELL_RADIUS;
  let bestRoll = ROLLS[0]!;
  let best = -1;
  const fits: number[] = [];
  for (const roll of ROLLS) {
    planeFromHome(roll, open, out);
    const r = fitRadius(w, h, out, inset, 1.0);
    fits.push(r);
    if (r > best) {
      best = r;
      bestRoll = roll;
    }
  }
  // The smallest roll that is nearly as good as the best: the design's own ring wherever it fits.
  for (let i = 0; i < ROLLS.length; i++) {
    if (fits[i]! >= best - 0.03) {
      bestRoll = ROLLS[i]!;
      break;
    }
  }
  planeFromHome(bestRoll, open, out);
  out.radius = Math.max(1.06, fitRadius(w, h, out, inset, 1.06));
  return out;
}

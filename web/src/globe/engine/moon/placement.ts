// Where the moon sits when it is a companion of the camera (design 7.10.4).
//
// The moon is not in the world: it does not turn with the planet and is never behind it, so every
// landing is visible in every pose, even zoomed in on a city. Its path is a tilted ellipse around the
// middle of the free area (the viewport minus docked UI), sized from the planet's on-screen radius
// and then scaled down until the whole ellipse fits inside the free area. Pure functions; nothing
// here touches three.js.

import { clamp, DEG, TAU } from '../math';

/** Docked UI, in CSS pixels: the parts of the viewport the moon must stay out of. */
export interface Inset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlacementInput {
  /** Viewport, CSS pixels. */
  w: number;
  h: number;
  inset: Inset;
  /** The planet's on-screen radius, CSS pixels. */
  planetR: number;
  /** Symbol height as a fraction of the short side, with pixel limits (tokens). */
  size: number;
  min: number;
  max: number;
  tiltDeg: number;
  /** Host multiplier (the phone uses 0.86). */
  scale: number;
  /** Extra clearance under the top bar, CSS pixels. */
  padTop: number;
  ambient: boolean;
}

export interface Orbit {
  cx: number;
  cy: number;
  a: number;
  b: number;
  cs: number;
  sn: number;
}

export interface Placement {
  /** Center and symbol height in CSS pixels; `r` is the clearance radius (0.74 of the base height). */
  x: number;
  y: number;
  s: number;
  r: number;
  /** -1 far to +1 near: the depth cue, sin(phase). */
  z: number;
  orbit: Orbit;
}

export function makePlacement(): Placement {
  return { x: 0, y: 0, s: 60, r: 44, z: 0, orbit: { cx: 0, cy: 0, a: 1, b: 1, cs: 1, sn: 0 } };
}

/** The ellipse is turned this much in the screen plane. */
export const ORBIT_ROLL = -16 * DEG;

/**
 * Lays the moon out for a given orbital phase (radians) and hover amount (0..1). Writes into `out`.
 * The numbers are the design's: axes 1.32 R and 1.32 R cos(tilt), 6 percent leniency when fitting the
 * free area, a 0.74-height clearance around the moon, and fallbacks when the free area gets tiny.
 */
export function layoutCompanion(i: PlacementInput, phase: number, hover: number, out: Placement): Placement {
  const base = clamp(i.size * Math.min(i.w, i.h), i.min, i.max) * i.scale * (i.ambient ? 1.35 : 1);
  const r = base * 0.74;
  const inset = i.inset;
  const padT = i.ambient ? 28 : Math.max(inset.top, 52) + i.padTop;
  const padB = i.ambient ? 28 : inset.bottom + 12;
  const padL = i.ambient ? 28 : inset.left + 14;
  const padR = i.ambient ? 28 : inset.right + 14;
  let x0 = padL + r;
  let x1 = i.w - padR - r;
  let y0 = padT + r;
  let y1 = i.h - padB - r;
  const minSpan = 2 * r + 40;
  if (x1 - x0 < minSpan) {
    x0 = 30 + r;
    x1 = i.w - 30 - r;
  }
  if (y1 - y0 < minSpan) {
    y0 = 60 + r;
    y1 = i.h - 40 - r;
  }
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cs = Math.cos(ORBIT_ROLL);
  const sn = Math.sin(ORBIT_ROLL);
  const a0 = i.planetR * 1.32;
  const b0 = a0 * Math.cos(i.tiltDeg * DEG);
  let a = Math.min(a0, hw * 1.06);
  let b = Math.min(b0, hh * 1.06);
  const hx = Math.sqrt(a * a * cs * cs + b * b * sn * sn);
  const hy = Math.sqrt(a * a * sn * sn + b * b * cs * cs);
  const q = Math.min(1, hw / Math.max(hx, 1e-3), hh / Math.max(hy, 1e-3));
  a *= q;
  b *= q;
  const ex = a * Math.cos(phase);
  const ey = b * Math.sin(phase);
  const z = Math.sin(phase);
  out.x = cx + ex * cs - ey * sn;
  out.y = cy + ex * sn + ey * cs;
  out.z = z;
  out.s = base * (1 + 0.06 * z) * (1 + 0.08 * hover);
  out.r = r;
  const o = out.orbit;
  o.cx = cx;
  o.cy = cy;
  o.a = a;
  o.b = b;
  o.cs = cs;
  o.sn = sn;
  return out;
}

/** A point on the orbit ellipse at phase `th`, CSS pixels. */
export function orbitAt(o: Orbit, th: number, out: { x: number; y: number }): void {
  const ex = o.a * Math.cos(th);
  const ey = o.b * Math.sin(th);
  out.x = o.cx + ex * o.cs - ey * o.sn;
  out.y = o.cy + ex * o.sn + ey * o.cs;
}

/** Reduced motion parks the moon where its phase puts it at first load: upper right. */
export const PARKED_PHASE = -0.95;
/** In the ambient screensaver the upper right belongs to the counters; a parked moon sits right of the planet instead. */
export const PARKED_PHASE_AMBIENT = -0.3;

/** Phase advance per second for a lap of `lapSeconds`, slowed while hovered (to 15 percent). */
export function phaseRate(lapSeconds: number, hover: number): number {
  return (TAU / lapSeconds) * (1 - 0.85 * hover);
}

// Framing: where the planet sits on screen and how big it is at the home zoom, from the viewport
// and the part of it the app's chrome leaves free (the inset). Pure math, unit-tested
// (framing.test.ts); the engine evaluates it every frame from the tweened inset.
//
// The contract (design 3.2, robustness brief G3):
//   - At the home zoom the planet's drawn envelope (radius times `envelope`: the atmosphere's glow
//     and the hub towers) keeps `clearTop` from the top of the free area, `clearBottom` from its
//     bottom (the block rail) and `clearSide` from its sides. When it would not, the lens widens
//     (`fit` below 1) until it does. The lens never narrows past the design's size (`fit` <= 1).
//   - The planet is centred horizontally in the free area and sits a little above its vertical
//     centre (the optical centre: `lift` of the free height, at most `maxLift` px), within the slack
//     the clearances leave; a planet that had to shrink sits exactly between them.
//   - `sideRoom` reserves horizontal room for the moon's orbit: the free half-width must hold
//     `sideRoom` planet radii.
//
// `fit` is applied as a field-of-view change (tan(fov/2) / fit), so every screen-space consumer
// (picking, labels, shaders) that already reads the camera's fov stays consistent, and user zoom
// keeps its meaning: it scales the framed planet like before.

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FramingSpec {
  /** CSS px between the envelope and the top of the free area (under the top bar). */
  clearTop: number;
  /** CSS px between the envelope and the bottom of the free area (above the block rail). */
  clearBottom: number;
  /** CSS px between the envelope and the sides of the free area. */
  clearSide: number;
  /** Optical lift: the centre sits this fraction of the free height above the free area's centre... */
  lift: number;
  /** ...but never more than this many CSS px. */
  maxLift: number;
  /** The planet's drawn envelope as a multiple of its radius (atmosphere glow, hub towers). */
  envelope: number;
  /** Planet radii the free half-width must hold (the moon's orbit); 0 disables it. */
  sideRoom: number;
  /** The lens never widens past this (the planet never shrinks below this fraction of its design size). */
  minFit: number;
}

export const DEFAULT_FRAMING: FramingSpec = {
  clearTop: 24,
  clearBottom: 32,
  clearSide: 24,
  lift: 0.025,
  maxLift: 24,
  envelope: 1.1,
  sideRoom: 0,
  minFit: 0.5,
};

export interface FramingInput {
  /** Viewport, CSS px. */
  w: number;
  h: number;
  inset: Insets;
  /** tan(vertical fov / 2) of the unfitted lens (the aspect-adjusted base fov). */
  tanHalfFov: number;
  /** Camera range (globe radii above the surface) of the home view. */
  homeRange: number;
  /** 0..1: how much of the framing applies (0 is the plain centred view the ambient director composes for). */
  weight?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Framing {
  /** The free area, CSS px. */
  free: Rect;
  /** Where the planet's centre goes, CSS px. */
  cx: number;
  cy: number;
  /** The centre's offset from the viewport centre (the camera's view shift), CSS px. */
  shiftX: number;
  shiftY: number;
  /** Lens factor (<= 1): tan(fov/2) is divided by it. */
  fit: number;
  /** The planet's projected radius at the home zoom with this framing, CSS px. */
  homeRadius: number;
}

/** Projected radius (CSS px) of the unit sphere seen from `range` above its surface, centred, through a lens of `tanHalfFov` on a viewport `h` tall. */
export function planetRadiusPx(h: number, tanHalfFov: number, range: number): number {
  const d = 1 + Math.max(1e-4, range);
  return (0.5 * h) / tanHalfFov / Math.sqrt(d * d - 1);
}

export function computeFraming(i: FramingInput, spec: FramingSpec = DEFAULT_FRAMING): Framing {
  const wgt = i.weight === undefined ? 1 : Math.min(1, Math.max(0, i.weight));
  const w = Math.max(1, i.w);
  const h = Math.max(1, i.h);
  const left = Math.max(0, i.inset.left);
  const right = Math.max(0, i.inset.right);
  const top = Math.max(0, i.inset.top);
  const bottom = Math.max(0, i.inset.bottom);
  const fw = Math.max(1, w - left - right);
  const fh = Math.max(1, h - top - bottom);
  const free: Rect = { x: left, y: top, w: fw, h: fh };

  const r0 = planetRadiusPx(h, i.tanHalfFov, i.homeRange);
  // The largest radius whose envelope fits between the clearances (size first)...
  const env = Math.max(1, spec.envelope);
  const vRoom = (fh - spec.clearTop - spec.clearBottom) / 2;
  const hRoom = fw / 2 - spec.clearSide;
  const rMax = Math.min(vRoom / env, hRoom / Math.max(env, spec.sideRoom));
  let fit = r0 > 0 && Number.isFinite(rMax) ? rMax / r0 : 1;
  fit = Math.min(1, Math.max(spec.minFit, fit));
  fit = 1 + (fit - 1) * wgt;
  const r = r0 * fit;

  // ...then the optical lift, within whatever slack the clearances leave. When the planet had to
  // shrink there is none, and it sits exactly between the clearances.
  const cx = left + fw / 2;
  const e = env * r * wgt;
  const geo = top + fh / 2;
  const want = geo - Math.min(spec.lift * fh, spec.maxLift) * wgt;
  const lo = top + spec.clearTop * wgt + e;
  const hi = top + fh - spec.clearBottom * wgt - e;
  const cy = lo <= hi ? Math.min(hi, Math.max(lo, want)) : (lo + hi) / 2;

  return {
    free,
    cx,
    cy,
    shiftX: cx - w / 2,
    shiftY: cy - h / 2,
    fit,
    homeRadius: r,
  };
}

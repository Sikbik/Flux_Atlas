// The lens: how close the camera is to the ground, as the basemap and the node markers see it.
//
// Up close the planet's own light (a magnified city-lights texture, the haze over the day side, a
// lattice dot the size of the screen) is brighter and bigger than the data it is supposed to carry.
// The lens is one number, 0 to 1, that every basemap layer and the node markers read to give way to
// the nodes: 0 at the global and regional views (nothing changes there), 1 once a texel is bigger
// than a node. It is measured in CSS pixels per radian at the shaded point, so it follows the
// distance to that very point: a pitched camera keeps its far field (the horizon) and only the
// ground near the camera gives way, and a bigger screen starts earlier, which is when its blobs do.
//
// This module is the one place the ramp is defined: the GLSL below and the CPU mirror share its
// constants, and `lens.test.ts` pins the mirror.

/** CSS pixels per radian where the lens starts to act (the camera range is about 0.8 at 1472 px/radian). */
export const LENS_PPR_FAR = 1800;
/** CSS pixels per radian where it is fully on (about 16 times closer: range 0.05). */
export const LENS_PPR_NEAR = 28800;

const LOG_SPAN = Math.log(LENS_PPR_NEAR / LENS_PPR_FAR);

function smooth01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** CPU mirror of `lensZoom` in GLSL: the lens at `pprCss` CSS pixels per radian. */
export function lensZoom(pprCss: number): number {
  if (!(pprCss > 0)) return 0;
  return smooth01(Math.log(pprCss / LENS_PPR_FAR) / LOG_SPAN);
}

/** The lens for a camera `dist` globe radii from the surface point, with `projScaleCss` CSS pixels per unit at distance 1. */
export function lensAtDistance(projScaleCss: number, dist: number): number {
  return lensZoom(projScaleCss / Math.max(dist, 1e-4));
}

/**
 * GLSL: `lensZoom(camDist, pprScale)` with `pprScale` = `uProjScale / uPxScale` (CSS pixels per unit at
 * distance 1), and `lensVignette(ndc, aspect, edge)`, the soft focus falloff that is 1 at the focus point
 * and eases to `edge` toward the corners. `ndc` is relative to the focus (NDC minus `uViewShift`).
 * Pure functions with explicit arguments, so a material never has a uniform declared twice.
 */
export const GLSL_LENS = /* glsl */ `
float lensZoom(float camDist, float pprScale) {
  float ppr = pprScale / max(camDist, 1e-4);
  return smoothstep(0.0, 1.0, log(ppr * ${(1 / LENS_PPR_FAR).toFixed(8)}) * ${(1 / LOG_SPAN).toFixed(8)});
}
float lensVignette(vec2 ndc, float aspect, float edge) {
  vec2 q = vec2(ndc.x * aspect, ndc.y);
  return mix(1.0, edge, smoothstep(0.35, 1.9, length(q)));
}
`;

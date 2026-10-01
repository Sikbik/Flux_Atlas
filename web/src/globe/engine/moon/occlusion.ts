// How the planet hides things that are behind it, analytically.
//
// Everything the moon owns lives in the overlay pass (drawn after the planet, with a fresh depth
// buffer), so the planet's own depth never cuts it. That is what keeps the moon from popping at the
// limb and from z-fighting with the atmosphere (a fullscreen ray-march with no depth of its own): the
// planet is a unit sphere, so whether a point is behind it, and by how much, is a closed-form ray test.
// A point behind the planet's centre plane fades smoothly over a thin band outside the limb (the depth
// of the atmosphere) and is hidden behind the disc; anything in front of that plane is untouched.
//
// `planetVisibility` in orbit.ts is the CPU twin of `planetVis` below; they are tested against each
// other's contract (hidden behind the disc, 1 in front, continuous across the limb) in orbit.test.ts.

import { LIMB_BAND } from './orbit';

/** Visibility of a world point: `planetVis(P)`. Needs `uCamPos`, `uProjScale` and `uPxScale` (the shared uniforms). */
export const PLANET_VIS_GLSL = /* glsl */ `
uniform vec3 uCamPos;
uniform float uProjScale;
uniform float uPxScale;
float planetVisRay(vec3 ro, vec3 rd, float tf) {
  float tc = -dot(ro, rd);
  if (tc >= tf) return 1.0;
  float b = length(ro + rd * tc);
  // The band never gets thinner than two device pixels, so the edge stays anti-aliased at any zoom.
  float camD = length(ro);
  float pxPerR = uProjScale / sqrt(max(camD * camD - 1.0, 0.01));
  float band = max(${LIMB_BAND.toFixed(4)}, 2.0 / max(pxPerR, 1.0));
  return smoothstep(1.0, 1.0 + band, b);
}
float planetVis(vec3 P) {
  vec3 d = P - uCamPos;
  float tf = length(d);
  return planetVisRay(uCamPos, d / max(tf, 1e-5), tf);
}
`;

/**
 * Visibility of the point a screen pixel shows on a plane facing the camera at `uMoonDepth` (distance
 * along the view axis): for the moon's screen-space dressing, which is a quad in CSS pixels. Needs
 * `PLANET_VIS_GLSL` and the shared camera uniforms.
 */
export const PLANET_VIS_PLANE_GLSL = /* glsl */ `
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamBack;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uViewShift;
uniform float uMoonDepth;
float planetVisPx(vec2 cssPx, vec2 cssSize) {
  vec2 ndc = vec2(cssPx.x / cssSize.x * 2.0 - 1.0, 1.0 - cssPx.y / cssSize.y * 2.0) - uViewShift;
  vec3 rd = normalize(uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov) - uCamBack);
  float tf = uMoonDepth / max(dot(rd, -uCamBack), 1e-3);
  return planetVisRay(uCamPos, rd, tf);
}
`;

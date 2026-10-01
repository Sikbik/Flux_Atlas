// The route a relay beam takes between the planet and the moon, in world space.
//
// A beam leaves the planet like a space elevator, straight up from its node; arcs over to the moon's
// direction along the great circle between them, climbing to clear the planet when the moon is far
// round the other side; and arrives at the moon along its own radial line, from the planet's side. The
// route lives on a fan of shells around the planet, so it can never cut through it, whatever the pose:
//
//   P(s) = r(s) * (a cos phi(s) + t sin phi(s)),   phi(s) = theta * smootherstep(s)
//
// where a and b are the unit directions of the two endpoints, theta the angle between them and t the
// tangent at `a` toward `b`. `r(s)` rises from the planet-side endpoint's radius to the moon-side one
// with an ease-out (steep at the planet); a wide hop hugs the planet and climbs only near the moon, where
// the planet hides it, so the visible part of the route stays low. When the endpoints are opposite
// the plane is not defined; it is then the one that goes over the top of the view (`hint`, the camera's
// up vector), so a beam to a moon behind the planet rises over the limb on screen.
//
// `relayPoint` is the CPU twin of `RELAY_PATH_GLSL`; keep them identical (relay.test.ts checks the
// twin's guarantees: endpoints, clearance, continuity, no NaN at the antipode).

import type { V3 } from './orbit';

export const RELAY_PATH_GLSL = /* glsl */ `
vec3 relayPath(vec3 A, vec3 B, float s, vec3 hint) {
  s = clamp(s, 0.0, 1.0);
  float rA = max(length(A), 1e-3);
  float rB = max(length(B), 1e-3);
  vec3 a = A / rA;
  vec3 b = B / rB;
  float c = clamp(dot(a, b), -1.0, 1.0);
  vec3 tb = b - a * c;
  float sinT = length(tb);
  float theta = atan(sinT, c);
  // The side to go round when the endpoints are (nearly) opposite: over the top of the view.
  vec3 ref = abs(a.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 u = hint - a * dot(hint, a);
  float ul = length(u);
  u = ul > 1e-3 ? u / ul : normalize(cross(a, ref));
  float k = c < 0.0 ? 1.0 - smoothstep(0.02, 0.35, sinT) : 0.0;
  vec3 u2 = dot(u, tb) >= 0.0 ? u : -u;
  vec3 tt = tb + u2 * k;
  float tl = length(tt);
  vec3 th = tl > 1e-5 ? tt / tl : u2;
  float f = s * s * s * (s * (s * 6.0 - 15.0) + 10.0);
  float phi = theta * f;
  vec3 dir = a * cos(phi) + th * sin(phi);
  float rLow = min(rA, rB);
  float rHigh = max(rA, rB);
  float x = rA <= rB ? s : 1.0 - s;
  // The radius profile. A short hop climbs with an ease-out (steep at the planet, like an elevator). A hop
  // to the far side of the planet hugs it instead (a plateau just above the surface that clears it) and
  // only climbs to the moon late, where the planet hides it: the part of the route that crosses the limb in
  // view stays low and on screen, and the beam reads as going round the planet to a moon behind it.
  float rNear = rLow + (rHigh - rLow) * (1.0 - (1.0 - x) * (1.0 - x));
  float plateau = clamp(max(1.10, rLow + 0.12), rLow, rHigh);
  float xr = min(x / 0.2, 1.0);
  float rFar = mix(rLow, plateau, 1.0 - (1.0 - xr) * (1.0 - xr)) + (rHigh - plateau) * smoothstep(0.4, 1.0, x);
  vec3 P = dir * mix(rNear, rFar, smoothstep(1.35, 2.5, theta));
  // Leaning toward the camera's side near the antipode bends the route a little off b; this puts the
  // end exactly on B again, with no change to either end's direction.
  return P + (B - (a * cos(theta) + th * sin(theta)) * rB) * f;
}
`;

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The point at parameter `s` (0 at A, 1 at B) of the route from A to B. `hint` is the camera's up vector. Writes `out`. */
export function relayPoint(A: V3, B: V3, s: number, hint: V3, out: V3): V3 {
  s = Math.min(1, Math.max(0, s));
  const rA = Math.max(Math.hypot(A.x, A.y, A.z), 1e-3);
  const rB = Math.max(Math.hypot(B.x, B.y, B.z), 1e-3);
  const ax = A.x / rA;
  const ay = A.y / rA;
  const az = A.z / rA;
  const bx = B.x / rB;
  const by = B.y / rB;
  const bz = B.z / rB;
  const c = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const tbx = bx - ax * c;
  const tby = by - ay * c;
  const tbz = bz - az * c;
  const sinT = Math.hypot(tbx, tby, tbz);
  const theta = Math.atan2(sinT, c);
  // u: the hint's component perpendicular to a (the way round when the endpoints are opposite).
  const hd = hint.x * ax + hint.y * ay + hint.z * az;
  let ux = hint.x - ax * hd;
  let uy = hint.y - ay * hd;
  let uz = hint.z - az * hd;
  const ul = Math.hypot(ux, uy, uz);
  if (ul > 1e-3) {
    ux /= ul;
    uy /= ul;
    uz /= ul;
  } else {
    // a x ref, with ref the world axis a is least aligned with.
    const rx = Math.abs(ax) < 0.9 ? 1 : 0;
    const rz = rx === 1 ? 0 : 1;
    ux = ay * rz;
    uy = az * rx - ax * rz;
    uz = -ay * rx;
    const l = Math.hypot(ux, uy, uz) || 1;
    ux /= l;
    uy /= l;
    uz /= l;
  }
  const k = c < 0 ? 1 - sstep(0.02, 0.35, sinT) : 0;
  const sgn = ux * tbx + uy * tby + uz * tbz >= 0 ? 1 : -1;
  const ttx = tbx + ux * sgn * k;
  const tty = tby + uy * sgn * k;
  const ttz = tbz + uz * sgn * k;
  const tl = Math.hypot(ttx, tty, ttz);
  let hx: number;
  let hy: number;
  let hz: number;
  if (tl > 1e-5) {
    hx = ttx / tl;
    hy = tty / tl;
    hz = ttz / tl;
  } else {
    hx = ux * sgn;
    hy = uy * sgn;
    hz = uz * sgn;
  }
  const f = s * s * s * (s * (s * 6 - 15) + 10);
  const phi = theta * f;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const rLow = Math.min(rA, rB);
  const rHigh = Math.max(rA, rB);
  const x = rA <= rB ? s : 1 - s;
  const rNear = rLow + (rHigh - rLow) * (1 - (1 - x) * (1 - x));
  const plateau = Math.min(rHigh, Math.max(rLow, Math.max(1.1, rLow + 0.12)));
  const xr = Math.min(x / 0.2, 1);
  const rFar = rLow + (plateau - rLow) * (1 - (1 - xr) * (1 - xr)) + (rHigh - plateau) * sstep(0.4, 1.0, x);
  const w = sstep(1.35, 2.5, theta);
  const r = rNear + (rFar - rNear) * w;
  // Leaning toward the hint near the antipode bends the route a little off B; this puts the end exactly
  // on B again, with no change to either end's direction.
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  out.x = (ax * cp + hx * sp) * r + (B.x - (ax * ct + hx * st) * rB) * f;
  out.y = (ay * cp + hy * sp) * r + (B.y - (ay * ct + hy * st) * rB) * f;
  out.z = (az * cp + hz * sp) * r + (B.z - (az * ct + hz * st) * rB) * f;
  return out;
}

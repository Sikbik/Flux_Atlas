// Camera work for the reel: poses as plain data, and the helpers that build them.
//
// Every shot is a free camera: a position, a point it looks at, an up vector and a field of view. The
// rig is told the pose each frame with no blending, so the picture is exactly the function of time that
// the shot describes. World space is the engine's: the planet is the unit sphere at the origin, +Y is
// north, longitude 0 faces +Z.

import * as THREE from 'three';
import type { CameraRig } from '../../engine/camera';
import { DEG, clamp, lerp } from '../../engine/math';

export interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  up: THREE.Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
}

export const newPose = (): Pose => ({ pos: new THREE.Vector3(0, 0, 6), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 34 });

export function copyPose(a: Pose, out: Pose): Pose {
  out.pos.copy(a.pos);
  out.look.copy(a.look);
  out.up.copy(a.up);
  out.fov = a.fov;
  return out;
}

/** Unit vector for lat/lon degrees (+Y north, lon 0 toward +Z, 90E toward +X). */
export function dirOf(lat: number, lon: number, out: THREE.Vector3): THREE.Vector3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return out.set(c * Math.sin(lo), Math.sin(la), c * Math.cos(lo));
}

const _T = new THREE.Vector3();
const _E = new THREE.Vector3();
const _N = new THREE.Vector3();
const _U = new THREE.Vector3();

/**
 * The standard rig's way of describing a view, as a free pose: the camera looks at the surface point
 * (lat, lon) from `range` globe radii away, tilted `tilt` radians off the vertical, with screen-up
 * turned `heading` radians from north. `lift` raises the look-at point above the surface.
 */
export function surfacePose(lat: number, lon: number, heading: number, range: number, tilt: number, fov: number, out: Pose, lift = 0): Pose {
  const la = lat * DEG;
  const lo = lon * DEG;
  const cl = Math.cos(la);
  const sl = Math.sin(la);
  const co = Math.cos(lo);
  const so = Math.sin(lo);
  _T.set(cl * so, sl, cl * co);
  _E.set(co, 0, -so);
  _N.set(-sl * so, cl, -sl * co);
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  _U.copy(_N).multiplyScalar(ch).addScaledVector(_E, sh);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  out.look.copy(_T).multiplyScalar(1 + lift);
  out.pos.copy(_T).multiplyScalar(1 + lift + range * ct).addScaledVector(_U, -range * st);
  out.up.copy(_U).multiplyScalar(ct).addScaledVector(_T, st);
  out.fov = fov;
  return out;
}

/** Interpolates two poses (position and look-at linearly, up by direction, fov linearly). */
export function mixPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.pos.copy(a.pos).lerp(b.pos, t);
  out.look.copy(a.look).lerp(b.look, t);
  out.up.copy(a.up).lerp(b.up, t).normalize();
  out.fov = lerp(a.fov, b.fov, t);
  return out;
}

/**
 * Hands a pose to the rig for this frame: the free camera tracks it exactly (no blend, no glide) and the
 * field of view follows. Call before `engine.stepFrame`.
 */
export function applyPose(rig: CameraRig, p: Pose): void {
  rig.setFree(p.pos, p.look, p.up, 1e6, 1e6);
  rig.snapFree(true);
  const fov = clamp(p.fov, 8, 80);
  rig.baseFov = fov;
  rig.fovV = fov;
  rig.camera.fov = fov;
}

/** Rotates `v` about the unit `axis` by `angle` radians, in place. */
export function rotateAbout(v: THREE.Vector3, axis: THREE.Vector3, angle: number): THREE.Vector3 {
  return v.applyAxisAngle(axis, angle);
}

/** Smooth 0..1 ramp (Hermite). */
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Smoother 0..1 ramp (Perlin quintic): zero first and second derivative at both ends, for camera speed. */
export const sstep5 = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeOut3 = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn3 = (t: number): number => Math.pow(clamp(t, 0, 1), 3);
export const easeInOut3 = (t: number): number => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};
export { DEG, clamp, lerp };

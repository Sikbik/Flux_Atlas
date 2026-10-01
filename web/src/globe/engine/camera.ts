// Camera rig.
//
// The camera is described by a target point on the globe surface and how it is viewed from:
//
//   frame   orientation of the local frame at the target (right, up-on-ground, outward normal)
//   range   distance from camera to target, in globe radii
//   tilt    angle between the view axis and the surface normal (0 looks straight down)
//
// A quaternion frame (instead of lat/lon/heading) means there is no pole singularity and dragging
// rotates the globe exactly like grabbing a ball: the point under the pointer stays under it.
//
// Motion is spring-damped toward a desired pose, so programmatic moves (the ambient director) and
// interactive ones (drag inertia, wheel zoom) share one smooth path. Flights are explicit tweens.

import * as THREE from 'three';
import {
  angleBetween,
  clamp,
  DEG,
  damp,
  easeInOutCubic,
  hash01,
  lerp,
  smoothstep,
  TAU,
  wrapPi,
} from './math';

const MIN_RANGE = 0.012;
const MAX_RANGE = 9;
const MAX_TILT = 1.32;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _ll = { lat: 0, lon: 0, heading: 0 };

export interface FlyOptions {
  /** Seconds. Default derives from the distance covered. */
  duration?: number;
  tilt?: number;
  /** Bearing of screen-up in radians. Default keeps north up. */
  heading?: number;
  /** Extra zoom-out during long flights (0..1). Default 1. */
  arc?: number;
  ease?: (t: number) => number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 50);

  // Actual pose
  private readonly q = new THREE.Quaternion();
  range = 3.6;
  tilt = 0;
  // Desired pose (springs pull the actual pose toward it)
  private readonly qD = new THREE.Quaternion();
  rangeD = 3.6;
  tiltD = 0;

  /** Angular velocity of the frame in world space, rad/s. Decays on its own (inertia). */
  private readonly omega = new THREE.Vector3();
  inertia = 3.2;

  /** Reduced motion (design 6.6): flights take 400 ms with a plain ease and no altitude arc. */
  reduced = false;

  /** Spring rates (1/s). Low = cinematic, high = snappy. */
  springPos = 7;
  springRange = 6;
  springTilt = 6;

  aspect = 1;
  viewportH = 900;
  viewportW = 1600;
  /** The planet's shift from the viewport center, CSS pixels (the globe is centered in the free area). */
  shiftX = 0;
  shiftY = 0;
  /** Vertical fov in degrees, recomputed from the aspect. */
  baseFov = 34;
  fovV = 34;

  // Flight tween state
  private flying = false;
  private flyT = 0;
  private flyDur = 1;
  private readonly flyQ0 = new THREE.Quaternion();
  private readonly flyQ1 = new THREE.Quaternion();
  private flyR0 = 1;
  private flyR1 = 1;
  private flyTilt0 = 0;
  private flyTilt1 = 0;
  private flyLift = 0;
  private flyEase: (t: number) => number = easeInOutCubic;
  private flyResolve: ((done: boolean) => void) | null = null;

  // Camera shake (trauma model)
  private trauma = 0;
  shakeScale = 1;

  // Derived, read by the engine
  readonly position = new THREE.Vector3();
  readonly viewDir = new THREE.Vector3();
  readonly target = new THREE.Vector3(0, 0, 1);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);
  distance = 4.6;
  /** Pixels per world unit at distance 1 from the camera (perspective scale). */
  projScale = 1;
  /** Range used for level-of-detail decisions: the spring range, blended toward the real altitude while a free shot is on. */
  lodRange = 3.6;

  // Free camera: cinematic shots that look at something other than the globe surface (the moon, the
  // limb against the sun). The standard pose keeps running underneath, so releasing the free camera
  // blends back to wherever the standard camera is.
  readonly freePos = new THREE.Vector3(0, 0, 6);
  readonly freeLook = new THREE.Vector3();
  readonly freeUp = new THREE.Vector3(0, 1, 0);
  freeBlend = 0;
  private freeTarget = 0;
  freeRate = 2.2;
  /** How fast the free pose itself follows its target (1/s); low values glide between shots, high values track per-frame targets. */
  freeGlide = 6;
  private readonly freePosC = new THREE.Vector3(0, 0, 6);
  private readonly freeLookC = new THREE.Vector3();
  private readonly freeUpC = new THREE.Vector3(0, 1, 0);
  /** Extra depth behind the planet that must not be clipped (the moon's orbit). */
  farExtra = 0;
  /** A sphere the near plane must not cut (the moon). */
  readonly protectCenter = new THREE.Vector3();
  protectRadius = 0;

  // Grab state
  private grabbing = false;
  private readonly grabPoint = new THREE.Vector3();
  private lastGrabT = 0;

  constructor() {
    this.setPose(18, 10, 0, 3.6, 0, true);
  }

  // ---- pose helpers -----------------------------------------------------------------------

  /** Builds a frame quaternion from lat/lon degrees and heading radians. */
  static frameFromLatLon(lat: number, lon: number, heading: number, out: THREE.Quaternion): THREE.Quaternion {
    const la = lat * DEG;
    const lo = lon * DEG;
    const cl = Math.cos(la);
    const sl = Math.sin(la);
    const co = Math.cos(lo);
    const so = Math.sin(lo);
    _v0.set(cl * so, sl, cl * co); // T
    _v1.set(co, 0, -so); // E
    _v2.set(-sl * so, cl, -sl * co); // N
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    _v3.copy(_v2).multiplyScalar(ch).addScaledVector(_v1, sh); // up on ground
    _v4.copy(_v3).cross(_v0); // right = up x T
    _m.makeBasis(_v4, _v3, _v0);
    return out.setFromRotationMatrix(_m);
  }

  /** Jump immediately to a pose (also resets desired pose and velocity). */
  setPose(lat: number, lon: number, heading: number, range: number, tilt: number, instant = true): void {
    CameraRig.frameFromLatLon(lat, lon, heading, this.qD);
    this.rangeD = clamp(range, MIN_RANGE, MAX_RANGE);
    this.tiltD = clamp(tilt, 0, MAX_TILT);
    if (instant) {
      this.q.copy(this.qD);
      this.range = this.rangeD;
      this.tilt = this.tiltD;
      this.omega.set(0, 0, 0);
      this.cancelFlight(false);
    }
  }

  /** Set the desired pose, to be approached by the springs. */
  setDesired(lat: number, lon: number, heading: number, range: number, tilt: number): void {
    CameraRig.frameFromLatLon(lat, lon, heading, this.qD);
    this.rangeD = clamp(range, MIN_RANGE, MAX_RANGE);
    this.tiltD = clamp(tilt, 0, MAX_TILT);
  }

  /** Current target lat/lon/heading (degrees, degrees, radians). */
  getLatLonHeading(out: { lat: number; lon: number; heading: number }, desired = false): void {
    const q = desired ? this.qD : this.q;
    _v0.set(0, 0, 1).applyQuaternion(q); // T
    _v3.set(0, 1, 0).applyQuaternion(q); // up on ground
    out.lat = Math.asin(clamp(_v0.y, -1, 1)) / DEG;
    out.lon = Math.atan2(_v0.x, _v0.z) / DEG;
    const cl = Math.cos(out.lat * DEG);
    const sl = Math.sin(out.lat * DEG);
    const co = Math.cos(out.lon * DEG);
    const so = Math.sin(out.lon * DEG);
    // heading = atan2(up . E, up . N)
    out.heading = Math.atan2(_v3.x * co - _v3.z * so, _v3.x * -sl * so + _v3.y * cl + _v3.z * -sl * co);
  }

  get isFlying(): boolean {
    return this.flying;
  }

  // ---- flights ----------------------------------------------------------------------------

  flyTo(lat: number, lon: number, range: number, opts: FlyOptions = {}): Promise<boolean> {
    const tiltT = clamp(opts.tilt ?? 0, 0, MAX_TILT);
    const headT = opts.heading ?? 0;
    CameraRig.frameFromLatLon(lat, lon, headT, this.flyQ1);
    return this.startFlight(this.flyQ1, clamp(range, MIN_RANGE, MAX_RANGE), tiltT, opts);
  }

  /** Fly to an explicit frame quaternion (used by the director to keep heading continuity). */
  flyToFrame(q: THREE.Quaternion, range: number, tilt: number, opts: FlyOptions = {}): Promise<boolean> {
    return this.startFlight(q, clamp(range, MIN_RANGE, MAX_RANGE), clamp(tilt, 0, MAX_TILT), opts);
  }

  private startFlight(
    qTarget: THREE.Quaternion,
    range: number,
    tilt: number,
    opts: FlyOptions,
  ): Promise<boolean> {
    this.cancelFlight(false);
    this.flyQ0.copy(this.q);
    if (qTarget !== this.flyQ1) this.flyQ1.copy(qTarget);
    // Shortest arc.
    if (this.flyQ0.dot(this.flyQ1) < 0) {
      this.flyQ1.set(-this.flyQ1.x, -this.flyQ1.y, -this.flyQ1.z, -this.flyQ1.w);
    }
    this.flyR0 = this.range;
    this.flyR1 = range;
    this.flyTilt0 = this.tilt;
    this.flyTilt1 = tilt;
    _v0.set(0, 0, 1).applyQuaternion(this.flyQ0);
    _v1.set(0, 0, 1).applyQuaternion(this.flyQ1);
    const ang = angleBetween(_v0.x, _v0.y, _v0.z, _v1.x, _v1.y, _v1.z);
    const zoomLog = Math.abs(Math.log(this.flyR1 / this.flyR0));
    // The design's flight: 900 ms up to 2,600 ms, scaled by the angle covered (120 degrees or more is the
    // full 2,600 ms); a long zoom with little travel still takes a moment longer.
    const natural = clamp(0.9 + 1.7 * Math.min(1, ang / (120 * DEG)) + zoomLog * 0.2, 0.9, 2.6);
    this.flyDur = this.reduced ? 0.4 : (opts.duration ?? natural);
    // Long hops rise toward a higher vantage point, then descend (van Wijk style zoom-out). Not when reduced.
    const arc = this.reduced ? 0 : (opts.arc ?? 1);
    this.flyLift =
      arc *
      Math.max(0, Math.min(ang * 1.25, 2.6) * Math.max(0.35, Math.min(this.flyR0, this.flyR1) * 0.6) * 1.15);
    this.flyEase = opts.ease ?? easeInOutCubic;
    this.flyT = 0;
    this.flying = true;
    this.omega.set(0, 0, 0);
    return new Promise((res) => {
      this.flyResolve = res;
    });
  }

  cancelFlight(resolveValue = false): void {
    if (!this.flying) return;
    this.flying = false;
    const r = this.flyResolve;
    this.flyResolve = null;
    // Leave the springs at the flight's current pose.
    this.qD.copy(this.q);
    this.rangeD = this.range;
    this.tiltD = this.tilt;
    r?.(resolveValue);
  }

  // ---- free camera -------------------------------------------------------------------------

  /** Puts the camera at `pos` looking at `look`. Blends in over about 1/rate seconds, then tracks exactly. */
  setFree(pos: THREE.Vector3, look: THREE.Vector3, up?: THREE.Vector3, rate = 2.2, glide = 6): void {
    this.freePos.copy(pos);
    this.freeLook.copy(look);
    if (up) this.freeUp.copy(up);
    else this.freeUp.set(0, 1, 0);
    if (this.freeBlend < 0.0005 && this.freeTarget === 0) {
      // Starting a shot from the standard camera: the pose begins at its target and the blend does the travelling.
      this.freePosC.copy(this.freePos);
      this.freeLookC.copy(this.freeLook);
      this.freeUpC.copy(this.freeUp);
    }
    this.freeTarget = 1;
    this.freeRate = rate;
    this.freeGlide = glide;
  }

  /** Releases the free camera: blends back to the standard pose. */
  releaseFree(rate = 2.2): void {
    this.freeTarget = 0;
    this.freeRate = rate;
  }

  /** True while a free shot is on or blending out. */
  get isFree(): boolean {
    return this.freeTarget > 0 || this.freeBlend > 0.002;
  }

  /** Jump the free blend (no transition) to fully on or fully off. */
  snapFree(on: boolean): void {
    this.freeTarget = on ? 1 : 0;
    this.freeBlend = on ? 1 : 0;
    if (on) {
      this.freePosC.copy(this.freePos);
      this.freeLookC.copy(this.freeLook);
      this.freeUpC.copy(this.freeUp);
    }
  }

  // ---- interaction ------------------------------------------------------------------------

  /** Begin grabbing the globe at NDC (x, y). Returns false if the ray misses (still grabs the limb). */
  grabStart(ndcX: number, ndcY: number, now: number): void {
    this.cancelFlight(false);
    this.grabbing = true;
    this.omega.set(0, 0, 0);
    this.rayToSphere(ndcX, ndcY, this.grabPoint);
    this.lastGrabT = now;
  }

  /** Move the grab to NDC (x, y): rotates the frame so the grabbed point follows the pointer. */
  grabMove(ndcX: number, ndcY: number, now: number): void {
    if (!this.grabbing) return;
    this.updateCameraMatrices(false); // ensure ray origin is for the current pose
    this.rayToSphere(ndcX, ndcY, _v0);
    _q0.setFromUnitVectors(_v0, this.grabPoint); // maps hit -> grab point
    // Apply to actual and desired poses.
    this.q.premultiply(_q0).normalize();
    this.qD.copy(this.q);
    // Angular velocity for inertia (axis * angle / dt).
    const dt = Math.max(1 / 240, (now - this.lastGrabT) / 1000);
    this.lastGrabT = now;
    const angle = 2 * Math.acos(clamp(_q0.w, -1, 1));
    if (angle > 1e-6) {
      const s = Math.sqrt(Math.max(1e-12, 1 - _q0.w * _q0.w));
      _v1.set(_q0.x / s, _q0.y / s, _q0.z / s).multiplyScalar(angle / dt);
      this.omega.lerp(_v1, 0.35);
    } else {
      this.omega.multiplyScalar(0.7);
    }
  }

  grabEnd(): void {
    this.grabbing = false;
    // Cap velocity so flicks do not become spinning tops.
    const max = 4.5 * clamp(this.range / 3, 0.2, 1);
    if (this.omega.length() > max) this.omega.setLength(max);
  }

  get isGrabbing(): boolean {
    return this.grabbing;
  }

  /** Zoom by a multiplicative factor on the desired range. */
  zoomBy(factor: number): void {
    this.cancelFlight(false);
    this.rangeD = clamp(this.rangeD * factor, MIN_RANGE, MAX_RANGE);
  }

  /** Orbit: change heading (about the target normal) and tilt. */
  orbitBy(dHeading: number, dTilt: number): void {
    this.cancelFlight(false);
    if (dHeading !== 0) {
      _v0.set(0, 0, 1).applyQuaternion(this.qD);
      _q0.setFromAxisAngle(_v0, -dHeading);
      this.qD.premultiply(_q0).normalize();
      this.q.copy(this.qD);
    }
    this.tiltD = clamp(this.tiltD + dTilt, 0, MAX_TILT);
  }

  /** Nudge the target by angular velocity (used by the ambient director for slow drift). */
  rotateBy(axis: THREE.Vector3, angle: number): void {
    _q0.setFromAxisAngle(axis, angle);
    this.qD.premultiply(_q0).normalize();
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Ease the camera heading back to north-up (screen up = north), used after drags. */
  relaxHeading(dt: number, strength = 1.2): void {
    this.getLatLonHeading(_ll, true);
    const dh = wrapPi(0 - _ll.heading) * (1 - Math.exp(-strength * dt));
    if (Math.abs(dh) < 1e-5) return;
    _v0.set(0, 0, 1).applyQuaternion(this.qD);
    _q0.setFromAxisAngle(_v0, -dh);
    this.qD.premultiply(_q0).normalize();
  }

  // ---- per-frame update -------------------------------------------------------------------

  /** Moves the planet's center on screen by (x, y) CSS pixels without changing the view direction: a window offset on the projection. */
  setViewShift(x: number, y: number): void {
    this.shiftX = x;
    this.shiftY = y;
  }

  /** The shift in NDC (what the fullscreen passes subtract from their pixel coordinate). */
  get shiftNdcX(): number {
    return (2 * this.shiftX) / Math.max(1, this.viewportW);
  }
  get shiftNdcY(): number {
    return (-2 * this.shiftY) / Math.max(1, this.viewportH);
  }

  setViewport(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.viewportH = h;
    this.viewportW = w;
    // Keep the globe fully visible on portrait screens by widening the vertical fov.
    if (this.aspect < 1) {
      const halfH = Math.atan(Math.tan((this.baseFov * DEG) / 2) / this.aspect);
      this.fovV = clamp((halfH * 2) / DEG, this.baseFov, 66);
    } else {
      this.fovV = this.baseFov;
    }
    this.camera.fov = this.fovV;
    this.camera.aspect = this.aspect;
  }

  update(dt: number, time: number): void {
    dt = Math.min(dt, 0.1);
    if (this.flying) {
      this.flyT += dt / this.flyDur;
      const t = clamp(this.flyT, 0, 1);
      const e = this.flyEase(t);
      this.q.slerpQuaternions(this.flyQ0, this.flyQ1, e);
      const logR = lerp(Math.log(this.flyR0), Math.log(this.flyR1), e);
      const hump = this.reduced ? 0 : Math.sin(Math.PI * t);
      this.range = clamp(Math.exp(logR) + this.flyLift * hump * hump, MIN_RANGE, MAX_RANGE);
      this.tilt = lerp(this.flyTilt0, this.flyTilt1, e) * (1 - 0.6 * hump * hump);
      this.qD.copy(this.q);
      this.rangeD = this.flyR1;
      this.tiltD = this.flyTilt1;
      if (this.flyT >= 1) {
        this.flying = false;
        this.q.copy(this.flyQ1);
        this.qD.copy(this.flyQ1);
        this.range = this.flyR1;
        this.tilt = this.flyTilt1;
        const r = this.flyResolve;
        this.flyResolve = null;
        r?.(true);
      }
    } else {
      // Inertia
      if (!this.grabbing) {
        const speed = this.omega.length();
        if (speed > 1e-4) {
          _q0.setFromAxisAngle(_v0.copy(this.omega).normalize(), speed * dt);
          this.qD.premultiply(_q0).normalize();
          this.omega.multiplyScalar(Math.exp(-this.inertia * dt));
        } else if (speed > 0) {
          this.omega.set(0, 0, 0);
        }
      }
      if (!this.grabbing) {
        const k = 1 - Math.exp(-this.springPos * dt);
        this.q.slerp(this.qD, k);
      }
      this.range = Math.exp(damp(Math.log(this.range), Math.log(this.rangeD), this.springRange, dt));
      this.tilt = damp(this.tilt, this.tiltD, this.springTilt, dt);
    }
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - dt * 1.4);
    if (this.freeTarget > 0 || this.freeBlend > 0) {
      const g = 1 - Math.exp(-this.freeGlide * dt);
      this.freePosC.lerp(this.freePos, g);
      this.freeLookC.lerp(this.freeLook, g);
      this.freeUpC.lerp(this.freeUp, g);
    }
    if (this.freeBlend !== this.freeTarget) {
      this.freeBlend = damp(this.freeBlend, this.freeTarget, this.freeRate, dt);
      if (Math.abs(this.freeBlend - this.freeTarget) < 0.002) this.freeBlend = this.freeTarget;
    }
    this.updateCameraMatrices(true, time);
  }

  // ---- camera matrices ----------------------------------------------------------------------

  private updateCameraMatrices(withShake: boolean, time = 0): void {
    const cam = this.camera;
    // Frame axes
    _v0.set(0, 0, 1).applyQuaternion(this.q); // T
    _v1.set(0, 1, 0).applyQuaternion(this.q); // ground up
    _v2.set(1, 0, 0).applyQuaternion(this.q); // right
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    // Camera position
    this.position
      .copy(_v0)
      .addScaledVector(_v0, this.range * ct)
      .addScaledVector(_v1, -this.range * st);
    // View basis: d = -ct*T + st*up; camera up = st*T + ct*up; back = -d
    _v3.copy(_v1).multiplyScalar(ct).addScaledVector(_v0, st); // camera up
    _v4.copy(_v0).multiplyScalar(ct).addScaledVector(_v1, -st); // back
    this.viewDir.copy(_v4).negate();
    this.target.copy(_v0);
    this.right.copy(_v2);
    this.up.copy(_v3);
    this.distance = this.position.length();
    this.lodRange = this.range;

    if (this.freeBlend > 0.0005) {
      const fb = this.freeBlend * this.freeBlend * (3 - 2 * this.freeBlend);
      _v0.copy(this.position).lerp(this.freePosC, fb);
      _v1.copy(this.target).lerp(this.freeLookC, fb);
      _v3.copy(this.up).lerp(this.freeUpC, fb);
      if (_v3.lengthSq() < 1e-8) _v3.set(0, 1, 0);
      _v3.normalize();
      _v4.copy(_v0).sub(_v1);
      if (_v4.lengthSq() < 1e-8) _v4.set(0, 0, 1);
      _v4.normalize();
      _v2.copy(_v3).cross(_v4);
      if (_v2.lengthSq() < 1e-8) _v2.set(1, 0, 0);
      _v2.normalize();
      _v3.copy(_v4).cross(_v2);
      this.position.copy(_v0);
      this.target.copy(_v1);
      this.viewDir.copy(_v4).negate();
      this.right.copy(_v2);
      this.up.copy(_v3);
      this.distance = this.position.length();
      this.lodRange = this.range + (Math.max(0.05, this.distance - 1) - this.range) * fb;
    }

    if (withShake && this.trauma > 0 && this.shakeScale > 0) {
      const a = this.trauma * this.trauma * 0.012 * this.shakeScale;
      const sx = (hash01(Math.floor(time * 60)) - 0.5) * 2;
      const sy = (hash01(Math.floor(time * 60) + 9173) - 0.5) * 2;
      _v3.addScaledVector(_v2, sx * a);
      this.position.addScaledVector(_v2, sx * a * this.range).addScaledVector(_v3, sy * a * this.range);
    }

    _m.makeBasis(_v2, _v3, _v4);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.position.copy(this.position);
    // Clip planes hug the scene: near just in front of the closest surface, far past the planet.
    const surf = Math.max(0.002, this.distance - 1);
    let near = clamp(surf * 0.3, 0.0015, 1.6);
    if (this.protectRadius > 0) {
      const gap = this.position.distanceTo(this.protectCenter) - this.protectRadius;
      near = Math.min(near, Math.max(0.002, gap * 0.5));
    }
    cam.near = near;
    cam.far = this.distance + 1.6 + this.farExtra;
    cam.updateMatrixWorld(true);
    if (Math.abs(this.shiftX) > 0.01 || Math.abs(this.shiftY) > 0.01) {
      cam.setViewOffset(
        this.viewportW,
        this.viewportH,
        -this.shiftX,
        -this.shiftY,
        this.viewportW,
        this.viewportH,
      );
    } else if (cam.view !== null) {
      cam.clearViewOffset();
    }
    cam.updateProjectionMatrix();
    this.projScale = (0.5 * this.viewportH) / Math.tan((this.fovV * DEG) / 2);
  }

  /** Ray through NDC (x,y) intersected with the unit sphere; misses fall back to the limb. */
  private rayToSphere(ndcX: number, ndcY: number, out: THREE.Vector3): void {
    const cam = this.camera;
    // Direction in camera space
    const t = Math.tan((this.fovV * DEG) / 2);
    _v3.set((ndcX - this.shiftNdcX) * t * this.aspect, (ndcY - this.shiftNdcY) * t, -1).normalize();
    // To world via camera orientation
    _v3.applyQuaternion(cam.quaternion);
    const o = cam.position;
    const b = o.dot(_v3);
    const c = o.lengthSq() - 1;
    const disc = b * b - c;
    if (disc >= 0) {
      const tt = -b - Math.sqrt(disc);
      out.copy(o).addScaledVector(_v3, tt).normalize();
    } else {
      // Closest point on the ray to the origin, pushed out to the limb.
      const tt = -b;
      out.copy(o).addScaledVector(_v3, tt);
      if (out.lengthSq() < 1e-8) out.copy(_v3).negate();
      out.normalize();
    }
  }

  /** Hit test a ray against the sphere without the limb fallback. Returns the unit hit point or null. */
  pickSurface(ndcX: number, ndcY: number, out: THREE.Vector3): boolean {
    const cam = this.camera;
    const t = Math.tan((this.fovV * DEG) / 2);
    _v3
      .set((ndcX - this.shiftNdcX) * t * this.aspect, (ndcY - this.shiftNdcY) * t, -1)
      .normalize()
      .applyQuaternion(cam.quaternion);
    const o = cam.position;
    const b = o.dot(_v3);
    const disc = b * b - (o.lengthSq() - 1);
    if (disc < 0) return false;
    const tt = -b - Math.sqrt(disc);
    if (tt < 0) return false;
    out.copy(o).addScaledVector(_v3, tt).normalize();
    return true;
  }

  /** Projects a world point to CSS pixels. Returns false when behind the camera or over the horizon. */
  project(
    x: number,
    y: number,
    z: number,
    widthCss: number,
    heightCss: number,
    out: { x: number; y: number; visible: boolean; depth: number },
  ): boolean {
    const cam = this.camera;
    _v4.set(x, y, z);
    // Horizon test: a point at radius r stays visible slightly past the surface horizon.
    const r = Math.hypot(x, y, z) || 1;
    const cosA = clamp(_v4.dot(this.position) / (r * this.distance), -1, 1);
    const limit = Math.acos(clamp(1 / this.distance, 0, 1)) + (r > 1 ? Math.acos(1 / r) : 0);
    out.visible = Math.acos(cosA) <= limit + 0.0005;
    _v4.applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    if (!Number.isFinite(_v4.x)) {
      out.visible = false;
      return false;
    }
    out.x = (_v4.x * 0.5 + 0.5) * widthCss;
    out.y = (-_v4.y * 0.5 + 0.5) * heightCss;
    out.depth = _v4.z;
    if (_v4.z > 1 || _v4.z < -1) out.visible = false;
    return out.visible;
  }

  /** How much zoom detail should be shown: 0 far overview, 1 very close. */
  get closeness(): number {
    return 1 - smoothstep(0.25, 3.2, this.range);
  }
}

/** Frames `count` surface points so they fit on screen. Returns the camera range needed. */
export function rangeToFit(angularRadius: number, fovV: number, aspect: number, margin = 1.25): number {
  const halfV = (fovV * DEG) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const half = Math.min(halfV, halfH) / margin;
  // Camera at distance D from the origin looking at the cap center; the cap edge has angle rho.
  const rho = Math.min(angularRadius, 1.45);
  const D = Math.cos(rho) + Math.sin(rho) / Math.tan(half);
  return clamp(D - 1, 0.05, MAX_RANGE);
}

export { TAU };

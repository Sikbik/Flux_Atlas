// Camera work for the Flux moon. Each function turns the moon's current state (and the sun) into a
// free camera pose: a position, a point to look at and an up vector. The ambient director calls
// them every frame while a moon scene plays, and `engine.viewMoon` uses the same code for explore
// mode, so the shots are identical either way.
//
//   portrait    a hero view of the moon with the planet behind it
//   earthrise   the camera sits just beyond the moon and tilts down, so the planet rises behind it
//   eclipse     a locked-off frame on the night side: the moon crosses the sun-lit limb, silhouetted
//               against the glow of the atmosphere (planned once from where the moon will be)
//   follow      the camera rides along with the moon, the planet filling the frame below
//
// Everything is scratch-vector math, no allocation per frame.

import * as THREE from 'three';
import { DEG, clamp, easeInOutSine, lerp } from '../math';
import type { Moon } from '../moon/moon';

export type MoonShotKind = 'portrait' | 'earthrise' | 'eclipse' | 'follow';

export interface ShotPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  up: THREE.Vector3;
}

const _o = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

/** Local frame of the moon: o outward from the planet, n the orbit normal, v the direction of travel. */
function frame(moon: Moon): void {
  _o.copy(moon.pos).normalize();
  moon.orbitNormal(_n);
  _v.copy(_n).cross(_o).normalize();
}

export class MoonShots {
  readonly pose: ShotPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  /** The camera's field of view, so a shot can place its subject on screen. The engine keeps these current. */
  fovV = 34;
  aspect = 16 / 9;

  /**
   * Aims the camera so `target` lands at (x, y) on screen in normalized device coordinates (x right,
   * y up, both -1..1). The ambient overlay owns the lower corners and the top left, so the subject
   * of a shot sits in the middle band and to the right.
   */
  private compose(p: ShotPose, target: THREE.Vector3, x: number, y: number): void {
    const tanV = Math.tan((this.fovV * DEG) / 2);
    const tanH = tanV * this.aspect;
    _f.copy(target).sub(p.pos);
    const dist = _f.length();
    _f.divideScalar(Math.max(dist, 1e-4));
    _r.copy(_f).cross(p.up);
    if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0);
    _r.normalize();
    _u.copy(_r).cross(_f);
    _f.addScaledVector(_r, -x * tanH).addScaledVector(_u, -y * tanV).normalize();
    p.look.copy(p.pos).addScaledVector(_f, dist);
  }

  // Eclipse plan (static camera).
  private readonly eCam = new THREE.Vector3();
  private readonly eLook = new THREE.Vector3();
  private readonly eUp = new THREE.Vector3(0, 1, 0);
  private eRange = 4.3;

  /** A view of the moon from `dist` world units, `az` degrees around from straight outward, `el` degrees above the orbit plane. */
  portrait(moon: Moon, az = 30, el = 12, dist = 1.15): ShotPose {
    frame(moon);
    const ca = Math.cos(az * DEG);
    const sa = Math.sin(az * DEG);
    const ce = Math.cos(el * DEG);
    const se = Math.sin(el * DEG);
    const p = this.pose;
    p.pos.copy(moon.pos).addScaledVector(_o, dist * ce * ca).addScaledVector(_v, dist * ce * sa).addScaledVector(_n, dist * se);
    p.up.copy(_n);
    this.compose(p, moon.pos, 0.1, 0.04);
    return p;
  }

  /**
   * Earth rising behind the moon. `t` is 0 at the start of the shot, 1 at the end. Screen-up is
   * straight away from the planet, so the planet is always below the moon. The camera sits close to
   * the moon and swings from well off to one side (the moon against open sky) toward the line
   * through the planet (the moon in front of its disc): the limb climbs up the frame, passes behind
   * the moon, and the planet ends up filling the background.
   */
  earthrise(moon: Moon, t: number): ShotPose {
    const e = easeInOutSine(clamp(t, 0, 1));
    frame(moon);
    const al = lerp(52, 9, e) * DEG;
    const d = lerp(1.3, 1.05, e);
    const p = this.pose;
    p.pos.copy(moon.pos).addScaledVector(_o, d * Math.cos(al)).addScaledVector(_v, d * Math.sin(al)).addScaledVector(_n, d * 0.12);
    p.up.copy(_o);
    this.compose(p, moon.pos, lerp(0.3, 0.18, e), lerp(0.14, 0.06, e));
    return p;
  }

  /**
   * The camera rides with the moon, swinging slowly to either side of straight above it, screen-up
   * away from the planet, so the planet fills the frame below and its terminator and city lights
   * scroll past.
   */
  follow(moon: Moon, seconds: number): ShotPose {
    frame(moon);
    const a = 0.5 * Math.sin(seconds * 0.11 + 0.8);
    const d = 1.1;
    const p = this.pose;
    // Mostly outward, leaning back along the orbit, with a swing about the radial axis.
    p.pos.copy(moon.pos)
      .addScaledVector(_o, d * 0.72)
      .addScaledVector(_v, -d * 0.62 * Math.cos(a))
      .addScaledVector(_n, d * 0.62 * Math.sin(a));
    p.up.copy(_o);
    this.compose(p, moon.pos, 0.24, 0.28);
    return p;
  }

  /**
   * Plans an eclipse shot for a moon that will be at `mid` seconds from now. Every candidate camera
   * puts the moon exactly on the planet's limb at mid-shot (the angle between "toward the planet"
   * and "toward the moon" equals the limb's angular radius, solved per camera azimuth around the
   * moon's direction), so the moon really crosses the limb. Among those, the best has the sun at
   * the side (a bright limb and a half-lit moon), the moon on the sun's side of the disc, and its
   * motion running across the limb rather than along it. Returns a cost (lower is better; above
   * about 1.2 the shot is not worth playing).
   */
  planEclipse(moon: Moon, sun: THREE.Vector3, mid: number, range?: number): number {
    // Planning runs once per scene, so it may allocate.
    const m = moon.positionAt(mid, new THREE.Vector3());
    const vel = moon.positionAt(mid + 1, new THREE.Vector3()).sub(m).normalize();
    const mh = m.clone().normalize();
    const Rm = m.length();
    const ref = Math.abs(mh.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = ref.clone().cross(mh).normalize();
    const w = mh.clone().cross(u).normalize();
    const dir = new THREE.Vector3();
    const cam = new THREE.Vector3();
    const toMoon = new THREE.Vector3();
    const vImg = new THREE.Vector3();
    const rImg = new THREE.Vector3();
    const sImg = new THREE.Vector3();
    let best = Infinity;
    const ranges = range ? [range] : [3.3, 3.8, 4.4];
    for (const D of ranges) {
      const limb = Math.asin(1.04 / D);
      for (let azd = 0; azd < 360; azd += 6) {
        const az = azd * DEG;
        const perp = _a.copy(u).multiplyScalar(Math.cos(az)).addScaledVector(w, Math.sin(az));
        // Solve the camera's angle from the moon's direction so the moon sits on the limb.
        let bestG = -1;
        let bestErr = 1e9;
        for (let gd = 2; gd <= 70; gd += 0.5) {
          const g = gd * DEG;
          const th = Math.atan2(Rm * Math.sin(g), D - Rm * Math.cos(g));
          const err = Math.abs(th - limb);
          if (err < bestErr) {
            bestErr = err;
            bestG = g;
          }
        }
        if (bestG < 0 || bestErr > 0.6 * DEG) continue;
        dir.copy(mh).multiplyScalar(Math.cos(bestG)).addScaledVector(perp, Math.sin(bestG)).normalize();
        cam.copy(dir).multiplyScalar(D);
        toMoon.copy(m).sub(cam);
        const distMoon = toMoon.length();
        if (distMoon > D - 0.5) continue; // the moon must be in front of the planet
        let cost = 2.8 * Math.max(0, Math.abs(dir.dot(sun)) - 0.35);
        rImg.copy(m).addScaledVector(dir, -m.dot(dir));
        sImg.copy(sun).addScaledVector(dir, -sun.dot(dir));
        const rl = rImg.length();
        const sl = sImg.length();
        const litSide = rl > 1e-4 && sl > 1e-4 ? rImg.dot(sImg) / (rl * sl) : 0;
        cost += 1.0 * (1 - litSide);
        vImg.copy(vel).addScaledVector(dir, -vel.dot(dir));
        const vl = vImg.length();
        cost += 0.6 * (1 - (vl > 1e-4 && rl > 1e-4 ? Math.abs(vImg.dot(rImg)) / (vl * rl) : 0));
        if (vl < 0.25) cost += 0.5; // the moon must visibly move
        if (cost < best) {
          best = cost;
          this.eCam.copy(cam);
          this.eRange = D;
        }
      }
    }
    // The limb crossing is where the moon will be at mid-shot; that point is framed right of center.
    this.eLook.copy(m);
    moon.orbitNormal(this.eUp);
    return best;
  }

  /**
   * The wide landing shot: the camera frames the producer, the moon and the payees at once, with the
   * producer-to-moon axis horizontal on screen so the uplink reads left to right. `pts` are the
   * producer first, then the payees, as points on the planet. The moon is taken where it will be
   * `ahead` seconds from now (when the block seals). Returns a static pose. Plans once per block.
   */
  planWide(moon: Moon, pts: readonly THREE.Vector3[], ahead: number, fovV: number, aspect: number): ShotPose {
    const M = moon.positionAt(ahead, new THREE.Vector3());
    const Ph = pts[0].clone().normalize();
    const Mh = M.clone().normalize();
    const tanV = Math.tan((fovV * DEG) / 2);
    const tanH = tanV * aspect;
    const c = new THREE.Vector3();
    const r = new THREE.Vector3();
    const up = new THREE.Vector3();
    const v = new THREE.Vector3();
    const all = [...pts, M];
    let D = 4;
    // Lean toward the moon (so it is large and in front) as far as the producer stays visible.
    const weights = [2.4, 1.7, 1.25, 0.95];
    for (let attempt = 0; attempt < weights.length; attempt++) {
      c.copy(Mh).multiplyScalar(weights[attempt]).add(Ph);
      for (let i = 1; i < pts.length; i++) c.addScaledVector(pts[i].clone().normalize(), 0.35);
      if (c.lengthSq() < 0.09) {
        c.copy(Ph).cross(Mh);
        if (c.lengthSq() < 1e-6) c.set(0, 1, 0).cross(Ph);
      }
      c.normalize();
      // Screen-right runs from the producer toward the moon, flattened into the image plane.
      r.copy(M).sub(Ph);
      r.addScaledVector(c, -r.dot(c));
      if (r.lengthSq() < 1e-6) r.set(1, 0, 0).addScaledVector(c, -c.x);
      r.normalize();
      up.copy(c).cross(r);
      D = 9.2;
      for (let d = 3.2; d < 9.2; d += 0.2) {
        let ok = true;
        for (const X of all) {
          v.copy(X).addScaledVector(c, -d);
          const z = -v.dot(c);
          if (z < 0.05 || Math.abs(v.dot(r) / z) > 0.74 * tanH || Math.abs(v.dot(up) / z) > 0.74 * tanV) {
            ok = false;
            break;
          }
        }
        if (ok) {
          D = d;
          break;
        }
      }
      // The producer must face the camera, and the whole route must fit at a sensible distance.
      if (Ph.dot(c) > 1 / D + 0.12 && D < 7.4) break;
    }
    const p = this.pose;
    p.pos.copy(c).multiplyScalar(D);
    p.look.set(0, 0, 0).addScaledVector(M, 0.12).addScaledVector(Ph, 0.12);
    p.up.copy(up);
    return p;
  }

  /** The planned eclipse, with a very slow push-in. `t` runs 0..1. */
  eclipse(t: number): ShotPose {
    const p = this.pose;
    p.pos.copy(this.eCam).multiplyScalar(1 - 0.05 * t);
    p.up.copy(this.eUp);
    this.compose(p, this.eLook, 0.16, 0.06);
    return p;
  }

  get eclipseRange(): number {
    return this.eRange;
  }
}

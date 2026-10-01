import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEG, TAU } from '../math';
import { createSharedUniforms } from '../uniforms';
import { flareAttack, flareShape, Moon, type MoonFrame, type MoonView } from './moon';
import {
  angleAtUtc,
  compactOrbit,
  ORBIT_PERIOD_S,
  type OrbitShape,
  orbitBasis,
  orbitPoint,
  type V3,
} from './orbit';

const W = 1600;
const H = 900;
const TAN = Math.tan((17 * Math.PI) / 180);
const PROJ = (0.5 * H) / TAN;
const T0 = Date.UTC(2026, 8, 30, 3, 0, 0);

/** A camera `dist` from the planet's centre looking at it from direction `dir`, north up. */
function camera(dir: V3, dist = 4.6): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(34, W / H, 0.01, 40);
  const d = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  cam.position.copy(d).multiplyScalar(dist);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function viewOf(cam: THREE.PerspectiveCamera): MoonView {
  return {
    camera: cam,
    up: new THREE.Vector3(0, 1, 0),
    cssW: W,
    cssH: H,
    pxScale: 1,
    projScale: PROJ,
    planetR: 290,
    surf: cam.position.length() - 1,
    inset: { left: 80, right: 0, top: 52, bottom: 154 },
  };
}

const frame = (utcMs: number, over: Partial<MoonFrame> = {}): MoonFrame => ({
  rate: 1,
  free: false,
  ambient: false,
  utcMs,
  ...over,
});

const HOME_DIR = {
  x: Math.cos(18 * DEG) * Math.sin(10 * DEG),
  y: Math.sin(18 * DEG),
  z: Math.cos(18 * DEG) * Math.cos(10 * DEG),
};

function fresh(opts = {}): Moon {
  return new Moon(createSharedUniforms(), opts);
}

/** Runs one frame and returns the moon's world position (copied). */
function step(
  m: Moon,
  cam: THREE.PerspectiveCamera,
  utc: number,
  dt = 0,
  time = 0,
  f: Partial<MoonFrame> = {},
): V3 {
  m.update(dt, time, viewOf(cam), frame(utc, f));
  return { x: m.pos.x, y: m.pos.y, z: m.pos.z };
}

describe('the Flux moon is a world object', () => {
  it('is at the place the UTC clock gives it, whatever the camera does', () => {
    const m = fresh();
    const cams = [
      camera(HOME_DIR),
      camera({ x: 1, y: 0.2, z: 0 }),
      camera({ x: -0.4, y: -0.8, z: -1 }, 3.1),
      camera({ x: 0, y: 1, z: 0.02 }, 6),
    ];
    const first = step(m, cams[0]!, T0);
    for (const cam of cams) {
      const p = step(m, cam, T0);
      expect(p.x).toBeCloseTo(first.x, 9);
      expect(p.y).toBeCloseTo(first.y, 9);
      expect(p.z).toBeCloseTo(first.z, 9);
    }
    // And it is exactly the orbit's point for that instant.
    const e1 = { x: 0, y: 0, z: 0 };
    const e2 = { x: 0, y: 0, z: 0 };
    orbitBasis(m.shape.inclination, m.shape.node, e1, e2);
    const want = orbitPoint(e1, e2, m.shape.radius, angleAtUtc(T0, ORBIT_PERIOD_S), { x: 0, y: 0, z: 0 });
    expect(first.x).toBeCloseTo(want.x, 9);
    expect(first.y).toBeCloseTo(want.y, 9);
    expect(first.z).toBeCloseTo(want.z, 9);
  });

  it('shows two viewers the same place at the same instant, and the same one a lap later', () => {
    const a = fresh();
    const b = fresh();
    const pa = step(a, camera(HOME_DIR), T0);
    const pb = step(b, camera({ x: -1, y: 0.3, z: 0.5 }), T0);
    expect(pa.x).toBeCloseTo(pb.x, 9);
    expect(pa.z).toBeCloseTo(pb.z, 9);
    const c = fresh();
    const pc = step(c, camera(HOME_DIR), T0 + ORBIT_PERIOD_S * 1000 * 7);
    expect(pc.x).toBeCloseTo(pa.x, 6);
    expect(pc.y).toBeCloseTo(pa.y, 6);
    expect(pc.z).toBeCloseTo(pa.z, 6);
  });

  it('travels its orbit as the clock runs and a full lap closes', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    let prev = step(m, cam, T0);
    const r = m.shape.radius;
    let travelled = 0;
    const N = 240;
    for (let k = 1; k <= N; k++) {
      // One second at a time, with the frame's own dt, like the engine does.
      const p = step(m, cam, T0 + k * 1000, 1, k);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(r, 6);
      travelled += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      prev = p;
    }
    const start = step(fresh(), cam, T0);
    expect(prev.x).toBeCloseTo(start.x, 3);
    expect(prev.y).toBeCloseTo(start.y, 3);
    expect(prev.z).toBeCloseTo(start.z, 3);
    // 240 s of one lap: close to the circumference.
    expect(travelled).toBeGreaterThan(TAU * r * 0.99);
    expect(travelled).toBeLessThan(TAU * r * 1.001);
  });

  it('moves smoothly when the timer is coarse (no steps from a 100 ms clock)', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    step(m, cam, T0);
    const steps: number[] = [];
    let prev = m.angle;
    for (let k = 1; k <= 600; k++) {
      const t = T0 + (k * 1000) / 60;
      // A browser that rounds its clock to 100 ms.
      const coarse = Math.floor(t / 100) * 100;
      step(m, cam, coarse, 1 / 60, k / 60);
      let d = m.angle - prev;
      if (d < -Math.PI) d += TAU;
      steps.push(d);
      prev = m.angle;
    }
    const nominal = TAU / ORBIT_PERIOD_S / 60;
    for (const d of steps.slice(60)) {
      expect(d).toBeGreaterThan(nominal * 0.5);
      expect(d).toBeLessThan(nominal * 1.5);
    }
  });

  it('puts the moon behind the planet for a camera on the far side, and fades it softly', () => {
    const m = fresh();
    const p = step(m, camera(HOME_DIR), T0);
    const away = { x: -p.x, y: -p.y, z: -p.z };
    step(m, camera(away), T0);
    expect(m.screen.vis).toBe(0);
    expect(m.screen.hit).toBe(false);
    // The same camera nearer the moon's side sees it in the clear.
    step(m, camera(p), T0);
    expect(m.screen.vis).toBe(1);
    expect(m.screen.onScreen).toBe(true);
    expect(m.screen.hit).toBe(true);
    // Swinging the camera from the moon's side to the far side takes it through every value between, in
    // a thin band at the limb, with no jump anywhere.
    const seen = new Set<number>();
    let prev = 1;
    let biggestJump = 0;
    for (let a = 0; a <= 180; a += 0.02) {
      const th = a * DEG;
      // Rotate the moon's direction about the vertical axis.
      const d = {
        x: p.x * Math.cos(th) + p.z * Math.sin(th),
        y: p.y,
        z: -p.x * Math.sin(th) + p.z * Math.cos(th),
      };
      step(m, camera(d), T0);
      seen.add(Math.round(m.screen.vis * 10));
      biggestJump = Math.max(biggestJump, Math.abs(m.screen.vis - prev));
      prev = m.screen.vis;
    }
    expect(seen.has(0)).toBe(true);
    expect(seen.has(10)).toBe(true);
    expect(seen.size).toBeGreaterThan(7);
    expect(biggestJump).toBeLessThan(0.06);
  });

  it('is bigger on the near side of the planet than on the far side (true perspective)', () => {
    const m = fresh();
    const p = step(m, camera(HOME_DIR), T0);
    step(m, camera(p), T0);
    const near = m.screen.s;
    step(m, camera({ x: -p.x, y: -p.y, z: -p.z }), T0);
    const far = m.screen.s;
    expect(near).toBeGreaterThan(far * 1.4);
    // Never under the legibility floor and never a banner.
    expect(far).toBeGreaterThanOrEqual(40);
    expect(near).toBeLessThan(0.26 * H + 1);
  });

  it('keeps the symbol upright against screen-up, whatever the camera does', () => {
    const m = fresh();
    for (const dir of [HOME_DIR, { x: 1, y: 0.1, z: 0 }, { x: 0.2, y: -0.7, z: -1 }]) {
      const cam = camera(dir);
      step(m, cam, T0);
      // The symbol's up axis, in the camera's frame, stays vertical to within the sway.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quat);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      expect(up.angleTo(camUp)).toBeLessThan(0.2);
      // And its front faces the camera.
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quat);
      const toCam = new THREE.Vector3().copy(cam.position).sub(m.pos).normalize();
      expect(front.dot(toCam)).toBeGreaterThan(0.9);
    }
  });
});

describe('the moon in the sky and in reduced motion', () => {
  it('blends from the shell ring to the sky orbit without ever leaving an orbit', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    step(m, cam, T0);
    const shell = { ...m.shape };
    expect(m.skyWeight).toBe(0);
    m.lift(true);
    let last = shell.radius;
    for (let k = 1; k <= 70; k++) {
      step(m, cam, T0 + k * 16, 0.016, k * 0.016);
      // Every blend is a circle around the planet.
      expect(Math.hypot(m.pos.x, m.pos.y, m.pos.z)).toBeCloseTo(m.shape.radius, 6);
      expect(m.shape.radius).toBeGreaterThanOrEqual(last - 1e-9);
      last = m.shape.radius;
    }
    expect(m.skyWeight).toBe(1);
    expect(m.shape.radius).toBeCloseTo(m.opts.orbit, 9);
    expect(m.shape.radius).toBeGreaterThan(shell.radius);
  });

  it('parks the moon in view, upper right of the planet, and holds it still', () => {
    const m = fresh();
    m.reduced = true;
    const cam = camera(HOME_DIR);
    const a = step(m, cam, T0, 0.016, 0);
    const sa = { ...m.screen };
    const b = step(m, cam, T0 + 90_000, 0.016, 90);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
    expect(sa.vis).toBe(1);
    expect(sa.onScreen).toBe(true);
    // Upper right of the planet's centre on screen.
    expect(sa.x).toBeGreaterThan(W / 2);
    expect(sa.y).toBeLessThan(H / 2);
    // No trail of beads while parked.
    expect(m.chain.group.visible).toBe(false);
  });

  it('keeps the moon where it is when reduced motion starts while it is in view', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    // Running: the moon at its UTC place, in view.
    step(m, cam, T0 + 20_000, 0.016, 0);
    expect(m.screen.hit).toBe(true);
    const a = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
    m.reduced = true;
    const b = step(m, cam, T0 + 20_016, 0.016, 0.016);
    expect(b.x).toBeCloseTo(a.x, 2);
    expect(b.y).toBeCloseTo(a.y, 2);
    expect(b.z).toBeCloseTo(a.z, 2);
    const c = step(m, cam, T0 + 200_000, 0.016, 0.032);
    expect(c.x).toBeCloseTo(b.x, 9);
    expect(c.z).toBeCloseTo(b.z, 9);
  });

  it('takes a new seat, with no flight, when the planet is turned so that the old one stays hidden', () => {
    const m = fresh();
    m.reduced = true;
    const a = step(m, camera(HOME_DIR), T0, 0.016, 0);
    // The camera goes round to the far side: the moon is behind the planet.
    const far = camera({ x: -a.x, y: -a.y, z: -a.z });
    let t = 0;
    let prev = a;
    let jumps = 0;
    let hiddenFrames = 0;
    for (let k = 0; k < 150; k++) {
      t += 0.016;
      const p = step(m, far, T0, 0.016, t);
      if (Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) > 1e-6) jumps++;
      if (m.screen.vis < 0.5) hiddenFrames++;
      prev = p;
    }
    // One re-seat (a single jump of the seat while it is faded out), after about half a second of hiding.
    expect(jumps).toBe(1);
    expect(hiddenFrames).toBeGreaterThan(20);
    expect(hiddenFrames).toBeLessThan(60);
    // Seated again in view, clear of the planet.
    expect(m.screen.vis).toBe(1);
    expect(m.screen.onScreen).toBe(true);
    expect(m.screen.hit).toBe(true);
  });
});

describe('nothing about the moon pops', () => {
  it('glides to a new ring when the window changes shape, and lands on the ring that size wants', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    step(m, cam, T0, 0, 0);
    const wide = { ...m.shape };
    // The window becomes a phone: a different ring, reached over a fraction of a second.
    const view = viewOf(cam);
    view.cssW = 390;
    view.cssH = 844;
    view.inset = { left: 0, right: 0, top: 52, bottom: 150 };
    let prev = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
    let biggest = 0;
    let first = -1;
    let t = 0;
    for (let k = 0; k < 150; k++) {
      t += 1 / 60;
      m.update(1 / 60, t, view, frame(T0 + t * 1000, { rate: 1 }));
      const d = Math.hypot(m.pos.x - prev.x, m.pos.y - prev.y, m.pos.z - prev.z);
      if (first < 0) first = d;
      biggest = Math.max(biggest, d);
      prev = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
    }
    // The orbit changed, with no step: it leaves rest gently (the first frame barely moves) and the
    // biggest frame-to-frame move is a swing of a few percent of the way, never a jump.
    const goal: OrbitShape = { radius: 0, inclination: 0, node: 0, size: 0 };
    compactOrbit(390, 844, goal);
    expect(
      Math.abs(goal.inclination - wide.inclination) + Math.abs(goal.radius - wide.radius),
    ).toBeGreaterThan(0.05);
    expect(first).toBeLessThan(0.01);
    expect(biggest).toBeLessThan(0.07);
    expect(m.shape.radius).toBeCloseTo(goal.radius, 2);
    expect(m.shape.inclination).toBeCloseTo(goal.inclination, 2);
  });

  it('eases the size cap away and back with the free camera instead of jumping', () => {
    // Frozen on its orbit, so only the cap moves the size.
    const m = fresh({ phase: 40 });
    const p = step(m, camera(HOME_DIR), T0);
    // A camera a third of a radius from the moon: far bigger than the cap, so the cap is what shows.
    const len = Math.hypot(p.x, p.y, p.z);
    const near = camera(p, len + 0.35);
    step(m, near, T0, 0, 0);
    const capped = m.screen.s;
    expect(capped).toBeLessThan(0.26 * H + 1);
    const sizes: number[] = [];
    let t = 0;
    for (let k = 0; k < 140; k++) {
      t += 1 / 60;
      step(m, near, T0, 1 / 60, t, { free: true });
      sizes.push(m.screen.s);
    }
    // Grows steadily: no frame adds more than a tenth of what the camera is about to reveal.
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]! - 1e-6);
      expect(sizes[i]! - sizes[i - 1]!).toBeLessThan(0.1 * (sizes[sizes.length - 1]! - capped));
    }
    expect(sizes[sizes.length - 1]!).toBeGreaterThan(capped * 2.5);
    // And back again, just as gently.
    let shrink = sizes[sizes.length - 1]!;
    for (let k = 0; k < 140; k++) {
      t += 1 / 60;
      step(m, near, T0, 1 / 60, t, { free: false });
      expect(shrink - m.screen.s).toBeLessThan(0.1 * (sizes[sizes.length - 1]! - capped));
      shrink = m.screen.s;
    }
    expect(m.screen.s).toBeCloseTo(capped, 0);
  });

  it('fades the wake in when reduced motion ends, and out when it begins', () => {
    const m = fresh();
    m.reduced = true;
    const cam = camera(HOME_DIR);
    step(m, cam, T0, 0, 0);
    const wake = (): number => m.chain.wakeAlpha;
    expect(wake()).toBe(0);
    m.reduced = false;
    const seen: number[] = [];
    let t = 0;
    for (let k = 0; k < 120; k++) {
      t += 1 / 60;
      step(m, cam, T0 + t * 1000, 1 / 60, t);
      seen.push(wake());
    }
    expect(seen[0]!).toBeLessThan(0.1 * seen[seen.length - 1]!);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-9);
      expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.08 * seen[seen.length - 1]!);
    }
    expect(seen[seen.length - 1]!).toBeGreaterThan(0.05);
    m.reduced = true;
    let last = seen[seen.length - 1]!;
    for (let k = 0; k < 120; k++) {
      t += 1 / 60;
      step(m, cam, T0 + t * 1000, 1 / 60, t);
      const w = wake();
      expect(w).toBeLessThanOrEqual(last + 1e-9);
      expect(last - w).toBeLessThan(0.1 * seen[seen.length - 1]!);
      last = w;
    }
    expect(last).toBe(0);
  });
});

describe('a piece flare is crisp, and overlapping flares build on each other', () => {
  it('ignites in about five frames and then dies away, whatever its length', () => {
    for (const dur of [0.34, 0.5, 0.7, 0.9]) {
      const a = flareAttack(dur);
      expect(a).toBeGreaterThanOrEqual(0.1);
      expect(a).toBeLessThanOrEqual(0.35);
      // About 85 ms of ignition (clamped for the very short and very long runs).
      if (dur >= 0.25 && dur <= 0.85) expect(a * dur).toBeCloseTo(0.085, 3);
      expect(flareShape(0, a)).toBe(0);
      expect(flareShape(a, a)).toBeCloseTo(1, 12);
      expect(flareShape(1, a)).toBeCloseTo(0, 12);
      // Continuous across the peak and monotonic on both sides.
      expect(flareShape(a - 1e-6, a)).toBeCloseTo(flareShape(a + 1e-6, a), 4);
      let prev = 0;
      for (let u = 0.01; u <= a; u += 0.01) {
        expect(flareShape(Math.min(u, a), a)).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = flareShape(Math.min(u, a), a);
      }
      for (let u = a + 0.01; u <= 1; u += 0.01) {
        expect(flareShape(u, a)).toBeLessThanOrEqual(prev + 1e-12);
        prev = flareShape(u, a);
      }
    }
  });

  it('ramps its light over several frames instead of jumping, and never dips when it is retriggered', () => {
    const m = fresh({ phase: 40 });
    const cam = camera(HOME_DIR);
    step(m, cam, T0, 0, 0);
    const light: number[] = [];
    let t = 0;
    const frame = (): void => {
      t += 1 / 60;
      step(m, cam, T0, 1 / 60, t);
      light.push(m.light);
    };
    m.flare(0, 0.5, 0.34);
    for (let k = 0; k < 6; k++) frame();
    // A stronger flare while the first is still burning: the light carries on up from where it was.
    m.flare(0, 1, 0.34);
    for (let k = 0; k < 40; k++) frame();
    // The ignition took several frames: no single step is most of the way up.
    expect(Math.max(...light.slice(0, 5))).toBeLessThan(0.5 + 1e-6);
    expect(light[0]!).toBeLessThan(0.5);
    // At the retrigger the light does not dip: from the frame it was struck it climbs on to the new peak
    // (the first flare was already past its own peak and falling, so a restart from zero would show as a drop).
    const peak = light.indexOf(Math.max(...light));
    expect(peak).toBeGreaterThan(6);
    for (let k = 6; k <= peak; k++) expect(light[k]!).toBeGreaterThanOrEqual(light[k - 1]! - 1e-9);
    expect(Math.max(...light)).toBeGreaterThan(0.95);
    // And it ends dark.
    expect(light[light.length - 1]!).toBeLessThan(0.2);
  });
});

describe('a seal pushes the pieces out and they settle back', () => {
  /** How far piece 1 (the small hexagon) is from its seat, in CSS px, for each of 40 frames after a seal. */
  function recoil(reduced: boolean, art?: 'marble' | 'dotmatrix' | 'neon'): number[] {
    const m = fresh({ phase: 40 });
    m.reduced = reduced;
    if (art) m.setArt(art, true);
    m.lift(true);
    const cam = camera(HOME_DIR);
    // Settle into the sky (the shell's tonal logo stays assembled; only the sky moon recoils).
    for (let k = 0; k < 80; k++) step(m, cam, T0, 1 / 60, 0);
    const out = { x: 0, y: 0 };
    m.piecePixels(1, out);
    const x0 = out.x;
    const y0 = out.y;
    m.seal(1, 5);
    const d: number[] = [];
    for (let k = 0; k < 40; k++) {
      step(m, cam, T0, 1 / 60, 0);
      m.piecePixels(1, out);
      d.push(Math.hypot(out.x - x0, out.y - y0));
    }
    return d;
  }

  it('arrives over a few frames, never in one, and settles back', () => {
    const d = recoil(false);
    const peak = Math.max(...d);
    expect(peak).toBeGreaterThan(1);
    // The first frame is about half the push, not all of it.
    expect(d[0]!).toBeLessThan(0.65 * peak);
    expect(d[0]!).toBeGreaterThan(0.2 * peak);
    // The biggest single-frame step is well under the whole push (no teleport).
    let step1 = 0;
    for (let k = 1; k < d.length; k++) step1 = Math.max(step1, Math.abs(d[k]! - d[k - 1]!));
    expect(Math.max(step1, d[0]!)).toBeLessThan(0.65 * peak);
    // And it ends where it began.
    expect(d[d.length - 1]!).toBeLessThan(0.15 * peak);
  });

  it('has no recoil at all in reduced motion, and half as much for the hologram', () => {
    expect(Math.max(...recoil(true))).toBeLessThan(1e-6);
    const marble = Math.max(...recoil(false, 'marble'));
    const holo = Math.max(...recoil(false, 'dotmatrix'));
    expect(holo).toBeGreaterThan(0.3 * marble);
    expect(holo).toBeLessThan(0.75 * marble);
  });
});

describe('the block beat and the chain', () => {
  it('leaves a bead on the orbit where the moon is when a block is sealed', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    step(m, cam, T0 + 12_345, 0, 5);
    m.seal(1, 777);
    expect(m.chain.count).toBe(1);
    expect(m.chain.blocks()[0]!.theta).toBeCloseTo(m.angle, 12);
    expect(m.chain.blocks()[0]!.height).toBe(777);
  });

  it('seeds the chain from block times with the same clock the moon runs on', () => {
    const m = fresh();
    const cam = camera(HOME_DIR);
    step(m, cam, T0, 0, 0);
    const blocks = [
      { height: 1, time: T0 - 90_000 },
      { height: 2, time: T0 - 60_000 },
      { height: 3, time: T0 - 30_000 },
    ];
    m.seedChain(blocks);
    const beads = m.chain.blocks();
    expect(beads.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(beads[i]!.theta).toBeCloseTo(angleAtUtc(blocks[i]!.time, ORBIT_PERIOD_S), 9);
    }
    // A block sealed 30 s ago is an eighth of a lap behind the moon.
    const behind = (m.angle - beads[2]!.theta + TAU) % TAU;
    expect(behind / TAU).toBeCloseTo(30 / ORBIT_PERIOD_S, 3);
  });

  it('gives the relay its endpoints in world space: the centre and the four pieces', () => {
    const u = createSharedUniforms();
    const m = new Moon(u, {});
    const cam = camera(HOME_DIR);
    m.update(0, 0, viewOf(cam), frame(T0));
    const a = u.uAnchor.value;
    expect(a[4]!.x).toBeCloseTo(m.pos.x, 9);
    expect(a[4]!.y).toBeCloseTo(m.pos.y, 9);
    expect(a[4]!.z).toBeCloseTo(m.pos.z, 9);
    for (let k = 0; k < 4; k++) {
      expect(a[k]!.w).toBe(1);
      // Each piece is within the moon's own bounds, in front of the centre toward the camera.
      const d = Math.hypot(a[k]!.x - m.pos.x, a[k]!.y - m.pos.y, a[k]!.z - m.pos.z);
      expect(d).toBeLessThan(m.radius * 1.05);
    }
  });

  it('tells the UI where the moon is on screen, hidden or not, and takes the pointer only in the clear', () => {
    const m = fresh();
    const p = step(m, camera(HOME_DIR), T0);
    const s = m.state();
    expect(s.visible).toBe(true);
    expect(s.vis).toBe(1);
    expect(s.s).toBeGreaterThan(40);
    expect(s.r).toBeCloseTo(0.74 * s.s, 9);
    expect(s.phase).toBeCloseTo(m.angle, 12);
    // The planet in the way: the proxy still follows, but the pointer cannot take it.
    step(m, camera({ x: -p.x, y: -p.y, z: -p.z }), T0);
    const h = m.state();
    expect(h.vis).toBe(0);
    expect(h.visible).toBe(true);
    expect(m.screen.hit).toBe(false);
  });
});

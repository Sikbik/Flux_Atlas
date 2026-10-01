import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../camera';
import { computeFraming } from '../framing';
import { DEG, TAU } from '../math';
import {
  angleAtUtc,
  blendShape,
  CHROME,
  chromeFor,
  compactOrbit,
  copyShape,
  HOME,
  homeView,
  type Inset,
  LIMB_BAND,
  lapOverflow,
  MIN_MOON_PX,
  ORBIT_PERIOD_S,
  type OrbitShape,
  orbitBasis,
  orbitNormal,
  orbitPoint,
  planeFromHome,
  planetVisibility,
  portraitness,
  projectHome,
  SHELL_OPEN,
  SHELL_RADIUS,
  SHELL_ROLL,
  SKY_ORBIT,
  utcAtAngle,
  type V3,
} from './orbit';

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function pointAt(shape: OrbitShape, theta: number): V3 {
  const e1 = v3();
  const e2 = v3();
  orbitBasis(shape.inclination, shape.node, e1, e2);
  return orbitPoint(e1, e2, shape.radius, theta, v3());
}

const compact = (w: number, h: number): OrbitShape =>
  compactOrbit(w, h, { radius: 0, inclination: 0, node: 0, size: 0 });
const LANDSCAPE = compact(1600, 900);
const PHONE = compact(390, 844);

describe('the moon follows the clock, not the camera', () => {
  it('has one angle per UTC instant and comes round after exactly one period', () => {
    const t = Date.UTC(2026, 8, 30, 14, 3, 27, 123);
    const a = angleAtUtc(t);
    expect(angleAtUtc(t)).toBe(a);
    expect(angleAtUtc(t + ORBIT_PERIOD_S * 1000)).toBeCloseTo(a, 9);
    expect(angleAtUtc(t + 17 * ORBIT_PERIOD_S * 1000)).toBeCloseTo(a, 6);
    // A quarter lap later is a quarter turn on.
    const q = angleAtUtc(t + (ORBIT_PERIOD_S / 4) * 1000);
    expect(((q - a + TAU) % TAU) / TAU).toBeCloseTo(0.25, 9);
  });

  it('runs at 360 degrees per period and stays in [0, 2 pi)', () => {
    for (let i = 0; i < 200; i++) {
      const th = angleAtUtc(1.78e12 + i * 7919);
      expect(th).toBeGreaterThanOrEqual(0);
      expect(th).toBeLessThan(TAU);
    }
    expect(angleAtUtc(0)).toBe(0);
    expect(angleAtUtc(ORBIT_PERIOD_S * 500)).toBeCloseTo(Math.PI, 9);
  });

  it('maps a time to an angle and back (the beads of the chain)', () => {
    const now = Date.UTC(2026, 8, 30, 1, 2, 3);
    for (const ago of [0, 1, 29.7, 30, 95, 200, 239.9]) {
      const then = now - ago * 1000;
      const th = angleAtUtc(then);
      expect(utcAtAngle(th, now)).toBeCloseTo(then, 3);
    }
    // A bead sealed `ago` seconds back sits `ago / period` of a lap behind the moon.
    const th0 = angleAtUtc(now);
    const th1 = angleAtUtc(now - 60_000);
    expect(((th0 - th1 + TAU) % TAU) / TAU).toBeCloseTo(60 / ORBIT_PERIOD_S, 9);
  });
});

describe('the orbit', () => {
  it('has an orthonormal basis, the stated inclination and travels east', () => {
    for (const shape of [LANDSCAPE, PHONE, SKY_ORBIT]) {
      const e1 = v3();
      const e2 = v3();
      orbitBasis(shape.inclination, shape.node, e1, e2);
      expect(len(e1)).toBeCloseTo(1, 12);
      expect(len(e2)).toBeCloseTo(1, 12);
      expect(dot(e1, e2)).toBeCloseTo(0, 12);
      const n = orbitNormal(e1, e2, v3());
      expect(len(n)).toBeCloseTo(1, 12);
      // Prograde: the normal is on the planet's north side.
      expect(n.y).toBeGreaterThanOrEqual(-1e-12);
      expect(Math.acos(Math.min(1, n.y))).toBeCloseTo(shape.inclination, 9);
      // e1 is the ascending node: on the equator, and the moon moves north and east from it.
      expect(e1.y).toBeCloseTo(0, 12);
      expect(e2.y).toBeGreaterThanOrEqual(0);
      const east = v3(Math.cos(shape.node), 0, -Math.sin(shape.node));
      expect(dot(e2, east)).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('keeps every point of a lap at exactly the orbit radius', () => {
    for (let k = 0; k < 360; k += 7) {
      const p = pointAt(LANDSCAPE, k * DEG);
      expect(len(p)).toBeCloseTo(LANDSCAPE.radius, 12);
    }
  });

  it('reaches its stated latitude at the top of the lap and crosses the equator at the node', () => {
    const top = pointAt(LANDSCAPE, Math.PI / 2);
    expect(Math.asin(top.y / len(top))).toBeCloseTo(LANDSCAPE.inclination, 9);
    const node = pointAt(LANDSCAPE, 0);
    expect(node.y).toBeCloseTo(0, 12);
    // Longitude of the node: lon 0 is +Z and lon 90E is +X.
    const lon = Math.atan2(node.x, node.z);
    expect(Math.cos(lon)).toBeCloseTo(Math.cos(LANDSCAPE.node), 9);
    expect(Math.sin(lon)).toBeCloseTo(Math.sin(LANDSCAPE.node), 9);
  });

  it('blends two orbits into valid circles that meet both ends, turning the short way round', () => {
    const out = copyShape(LANDSCAPE, { ...LANDSCAPE });
    expect(blendShape(LANDSCAPE, SKY_ORBIT, 0, out).radius).toBe(LANDSCAPE.radius);
    expect(blendShape(LANDSCAPE, SKY_ORBIT, 1, out).radius).toBe(SKY_ORBIT.radius);
    const mid = blendShape(LANDSCAPE, SKY_ORBIT, 0.5, out);
    expect(mid.radius).toBeCloseTo((LANDSCAPE.radius + SKY_ORBIT.radius) / 2, 12);
    expect(mid.inclination).toBeCloseTo((LANDSCAPE.inclination + SKY_ORBIT.inclination) / 2, 12);
    // Nodes 350 and 10 degrees apart blend through 0, not through 180.
    const a: OrbitShape = { radius: 1, inclination: 0.2, node: 350 * DEG, size: 0.2 };
    const b: OrbitShape = { radius: 1, inclination: 0.2, node: 10 * DEG, size: 0.2 };
    const m = blendShape(a, b, 0.5, { ...a });
    expect(Math.cos(m.node)).toBeCloseTo(1, 9);
  });

  it('puts the ring where it is asked to be on the home camera: rolled and opened', () => {
    const plane = { inclination: 0, node: 0 };
    for (const [roll, open] of [
      [SHELL_ROLL.landscape, SHELL_OPEN.landscape],
      [90 * DEG, SHELL_OPEN.portrait],
      [45 * DEG, 20 * DEG],
      [0, 18 * DEG],
    ] as const) {
      planeFromHome(roll, open, plane);
      const e1 = v3();
      const e2 = v3();
      orbitBasis(plane.inclination, plane.node, e1, e2);
      const n = orbitNormal(e1, e2, v3());
      const v = homeView(1600, 900, CHROME.desktop);
      const along = (a: V3, b: V3): number => Math.abs(dot(a, b));
      // Opening: the normal makes the complement of `open` with the line of sight.
      expect(along(n, v.T)).toBeCloseTo(Math.sin(open), 9);
      // Roll: the ring's long axis is the in-plane direction perpendicular to the line of sight.
      const axis = v3(n.y * v.T.z - n.z * v.T.y, n.z * v.T.x - n.x * v.T.z, n.x * v.T.y - n.y * v.T.x);
      const l = len(axis);
      const ang = Math.atan2(dot(axis, v.N) / l, dot(axis, v.E) / l);
      // Direction along the ring's long axis is unsigned.
      const folded = Math.abs(((ang % Math.PI) + Math.PI) % Math.PI);
      const want = ((roll % Math.PI) + Math.PI) % Math.PI;
      expect(Math.min(Math.abs(folded - want), Math.PI - Math.abs(folded - want))).toBeLessThan(1e-6);
      // Always prograde.
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('turns upright for a portrait screen and stays as it is for a landscape one', () => {
    expect(portraitness(1.6)).toBe(0);
    expect(LANDSCAPE.size).toBeLessThan(PHONE.size);
    expect(portraitness(1.15)).toBe(0);
    expect(portraitness(0.8)).toBe(1);
    expect(portraitness(0.46)).toBe(1);
    let last = 0;
    for (let a = 1.15; a >= 0.8; a -= 0.01) {
      const p = portraitness(a);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe('the planet hides what is behind it, softly', () => {
  const cam = v3(0, 0, 4.6);

  it('hides a moon straight behind the planet and shows one in front or beside it', () => {
    expect(planetVisibility(cam, v3(0, 0, -1.5))).toBe(0);
    expect(planetVisibility(cam, v3(0.4, 0.3, -1.5))).toBe(0);
    expect(planetVisibility(cam, v3(0, 0, 1.5))).toBe(1);
    expect(planetVisibility(cam, v3(0, 1.5, 0))).toBe(1);
    expect(planetVisibility(cam, v3(1.5, 0, 0))).toBe(1);
  });

  it('is continuous across the limb: no pop as the moon goes behind the planet', () => {
    // Walk a moon on the far side from beside the planet to behind it, a thousandth of a radius at a time.
    let last = 1;
    let maxStep = 0;
    let sawMid = false;
    for (let x = 2.4; x >= -0.2; x -= 0.001) {
      const v = planetVisibility(cam, v3(x, 0, -1.5));
      maxStep = Math.max(maxStep, Math.abs(v - last));
      if (v > 0.05 && v < 0.95) sawMid = true;
      last = v;
    }
    expect(last).toBe(0);
    expect(sawMid).toBe(true);
    // The band is LIMB_BAND wide in the planet's own units: a step this small is invisible.
    expect(maxStep).toBeLessThan(0.07);
    expect(LIMB_BAND).toBeGreaterThan(0.02);
  });

  it('is symmetric about the limb and monotonic through it', () => {
    let prev = 0;
    for (let b = 0.9; b <= 1.1; b += 0.002) {
      // A point behind the planet whose sight line has impact parameter ~b.
      const D = 4.6;
      const z = -1.5;
      // Find x so the line from the camera to (x, 0, z) has closest approach b: x * D / (D - z) = b.
      const x = (b * (D - z)) / D;
      const v = planetVisibility(cam, v3(x, 0, z));
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('never touches a moon that is between the camera and the planet', () => {
    for (let a = 0; a < 360; a += 5) {
      const p = v3(1.5 * Math.sin(a * DEG), 0, 1.5 * Math.cos(a * DEG));
      if (p.z > 0) expect(planetVisibility(cam, p)).toBe(1);
    }
  });
});

// ---- the whole lap fits the free area at the default zoom --------------------------------------------

interface Screen {
  w: number;
  h: number;
  inset: Inset;
}

/** The camera the engine has at first load for a screen: CameraRig's home pose, the portrait zoom and the framing. */
function homeRig(s: Screen, lon: number = HOME.lon): CameraRig {
  const rig = new CameraRig();
  rig.setViewport(s.w, s.h);
  const range = s.w / s.h < 0.8 ? HOME.rangePortrait : HOME.range;
  rig.setPose(HOME.lat, lon, 0, range, 0, true);
  const fr = computeFraming({
    w: s.w,
    h: s.h,
    inset: s.inset,
    tanHalfFov: rig.tanHalfFovBase,
    homeRange: range,
  });
  rig.setViewShift(fr.shiftX, fr.shiftY);
  rig.setFit(fr.fit);
  rig.update(0, 0);
  return rig;
}

interface LapReport {
  /** Largest distance (px) any part of the moon sticks out of the free area; 0 when the lap fits. */
  overflow: number;
  /** Fraction of the lap spent behind the planet. */
  hidden: number;
  minPx: number;
  maxPx: number;
}

/** Walks a lap through a REAL camera (not the pure projection) and measures it against the free area. */
function lapOnScreen(rig: CameraRig, s: Screen, shape: OrbitShape, margin = 10): LapReport {
  const cam = rig.camera;
  const e1 = v3();
  const e2 = v3();
  orbitBasis(shape.inclination, shape.node, e1, e2);
  const p = v3();
  const q = new THREE.Vector3();
  const L = s.inset.left + margin;
  const R = s.w - s.inset.right - margin;
  const T = s.inset.top + margin;
  const B = s.h - s.inset.bottom - margin;
  let overflow = 0;
  let hidden = 0;
  let minPx = Infinity;
  let maxPx = 0;
  const N = 720;
  for (let k = 0; k < N; k++) {
    orbitPoint(e1, e2, shape.radius, (k / N) * TAU, p);
    q.set(p.x, p.y, p.z);
    const depth = q.clone().sub(cam.position).dot(rig.viewDir);
    q.applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    const x = (q.x * 0.5 + 0.5) * s.w;
    const y = (-q.y * 0.5 + 0.5) * s.h;
    const px = Math.max(MIN_MOON_PX, (shape.size * rig.projScale) / depth);
    minPx = Math.min(minPx, px);
    maxPx = Math.max(maxPx, px);
    const r = 0.5 * px;
    overflow = Math.max(overflow, L - (x - r), x + r - R, T - (y - r), y + r - B);
    if (planetVisibility(cam.position, p, LIMB_BAND) < 0.5) hidden++;
  }
  return { overflow: Math.max(0, overflow), hidden: hidden / N, minPx, maxPx };
}

/** The shape the moon actually uses for a screen. */
const shellShapeFor = compact;

describe('the pure home projection', () => {
  it('matches the engine camera at first load, landscape and portrait', () => {
    for (const [w, h] of [
      [1600, 900],
      [1920, 1080],
      [1280, 1024],
      [390, 844],
      [768, 1024],
    ] as const) {
      const inset = chromeFor(w);
      const rig = homeRig({ w, h, inset });
      const v = homeView(w, h, inset);
      expect(v.f).toBeCloseTo(rig.projScale, 6);
      expect(v.dist).toBeCloseTo(rig.distance, 9);
      const out = { x: 0, y: 0, depth: 0 };
      for (const p of [v3(1.5, 0.2, 0.3), v3(-1.2, 0.8, -0.9), v3(0, 0, 0), v3(0.3, -1.4, 0.8)]) {
        projectHome(v, p, out);
        const q = new THREE.Vector3(p.x, p.y, p.z);
        const depth = q.clone().sub(rig.camera.position).dot(rig.viewDir);
        q.applyMatrix4(rig.camera.matrixWorldInverse).applyMatrix4(rig.camera.projectionMatrix);
        expect(out.depth).toBeCloseTo(depth, 6);
        expect(out.x).toBeCloseTo((q.x * 0.5 + 0.5) * w, 4);
        expect(out.y).toBeCloseTo((-q.y * 0.5 + 0.5) * h, 4);
      }
    }
  });
});

describe('the shell orbit at the default zoom', () => {
  const landscape: [string, Screen][] = [
    ['1600 x 900', { w: 1600, h: 900, inset: CHROME.desktop }],
    ['1920 x 1080', { w: 1920, h: 1080, inset: CHROME.desktop }],
    ['2560 x 1440', { w: 2560, h: 1440, inset: CHROME.desktop }],
    ['1366 x 768', { w: 1366, h: 768, inset: CHROME.desktop }],
    ['1280 x 800', { w: 1280, h: 800, inset: CHROME.desktop }],
    ['1440 x 900', { w: 1440, h: 900, inset: CHROME.desktop }],
    ['1024 x 768', { w: 1024, h: 768, inset: CHROME.desktop }],
    ['3440 x 1440 ultrawide', { w: 3440, h: 1440, inset: CHROME.desktop }],
  ];

  for (const [name, s] of landscape) {
    it(`stays below the top bar, above the rail and right of the dock at ${name}`, () => {
      const shape = shellShapeFor(s.w, s.h);
      const r = lapOnScreen(homeRig(s), s, shape);
      expect(r.overflow).toBe(0);
      // It is a real orbit: a good part of the lap is behind the planet, most of it in view.
      expect(r.hidden).toBeGreaterThan(0.15);
      expect(r.hidden).toBeLessThan(0.42);
      // And a proper ring around the planet, not a hair above its surface.
      expect(shape.radius).toBeGreaterThan(1.3);
    });
  }

  const portrait: [string, Screen][] = [
    ['a phone, 390 x 844', { w: 390, h: 844, inset: CHROME.phone }],
    ['a small phone, 360 x 740', { w: 360, h: 740, inset: CHROME.phone }],
    ['a large phone, 430 x 932', { w: 430, h: 932, inset: CHROME.phone }],
  ];
  for (const [name, s] of portrait) {
    it(`stands upright and fits the free area on ${name}`, () => {
      const shape = shellShapeFor(s.w, s.h);
      const r = lapOnScreen(homeRig(s), s, shape, 6);
      expect(r.overflow).toBe(0);
      expect(r.hidden).toBeLessThan(0.45);
      expect(shape.radius).toBeGreaterThan(1.3);
    });
  }

  it('fits at every screen shape from a phone to an ultrawide, shrinking only where it has to', () => {
    let last = 0;
    for (const [w, h] of [
      [390, 844],
      [600, 900],
      [768, 1024],
      [820, 1000],
      [800, 800],
      [900, 800],
      [1280, 1024],
      [1600, 900],
    ] as const) {
      const inset = chromeFor(w);
      const shape = shellShapeFor(w, h);
      expect(lapOnScreen(homeRig({ w, h, inset }), { w, h, inset }, shape, 10).overflow).toBe(0);
      expect(shape.radius).toBeGreaterThanOrEqual(1.06);
      expect(shape.radius).toBeLessThanOrEqual(SHELL_RADIUS + 1e-9);
      last = shape.radius;
    }
    expect(last).toBe(SHELL_RADIUS);
  });

  it('fitRadius agrees with the real camera: a bigger radius would not fit', () => {
    const s: Screen = { w: 900, h: 800, inset: CHROME.desktop };
    const shape = shellShapeFor(s.w, s.h);
    expect(shape.radius).toBeLessThan(SHELL_RADIUS);
    const bigger = { ...shape, radius: shape.radius + 0.05 };
    expect(lapOnScreen(homeRig(s), s, bigger).overflow).toBeGreaterThan(0);
    expect(lapOverflow(homeView(s.w, s.h, s.inset), bigger, s.inset)).toBeGreaterThan(0);
  });

  it('gives a landscape screen the design ring and a phone an upright one', () => {
    // Landscape: rolled a little, the moon rising on the right, at the full design radius.
    expect(LANDSCAPE.radius).toBe(SHELL_RADIUS);
    expect(LANDSCAPE.inclination / DEG).toBeGreaterThan(8);
    expect(LANDSCAPE.inclination / DEG).toBeLessThan(16);
    // A phone: the ring stands up (a steep plane), at very nearly the full radius.
    expect(PHONE.radius).toBeGreaterThan(SHELL_RADIUS - 0.06);
    expect(PHONE.inclination / DEG).toBeGreaterThan(60);
    // A leaning ring in between keeps more of the radius than an upright one would.
    const tablet = compact(768, 1024);
    expect(tablet.inclination / DEG).toBeGreaterThan(LANDSCAPE.inclination / DEG);
    expect(tablet.radius).toBeGreaterThan(1.1);
  });

  it('keeps the moon out from under docked windows: the ring is refitted to the free area they leave', () => {
    // [width, height, insets, whether the ring made for the bare chrome would run under the windows]
    const cases: [number, number, Inset, boolean][] = [
      // The About window or an inspector docked at the right.
      [1024, 768, { left: 80, right: 488, top: 52, bottom: 154 }, true],
      [1280, 720, { left: 80, right: 488, top: 52, bottom: 154 }, false],
      [1366, 768, { left: 80, right: 488, top: 52, bottom: 154 }, false],
      [1600, 900, { left: 80, right: 488, top: 52, bottom: 154 }, false],
      // An explorer floating at the left and an inspector at the right.
      [1600, 900, { left: 520, right: 488, top: 52, bottom: 154 }, true],
      // A phone with its sheet half open.
      [390, 844, { left: 0, right: 0, top: 96, bottom: 420 }, true],
    ];
    for (const [w, h, inset, bareRuns] of cases) {
      const s: Screen = { w, h, inset };
      const name = `${w} x ${h} with ${JSON.stringify(inset)}`;
      const shape = compactOrbit(w, h, { radius: 0, inclination: 0, node: 0, size: 0 }, inset);
      expect(shape.radius).toBeGreaterThanOrEqual(1.06);
      expect(shape.radius).toBeLessThanOrEqual(SHELL_RADIUS + 1e-9);
      // Checked on a real camera, framed in the free area like the engine does.
      expect(lapOnScreen(homeRig(s), s, shape, 6).overflow, name).toBe(0);
      // The ring made for the bare chrome would run under the windows on the tighter screens.
      const bare = compactOrbit(w, h, { radius: 0, inclination: 0, node: 0, size: 0 });
      const o = lapOnScreen(homeRig(s), s, bare, 6).overflow;
      if (bareRuns) expect(o, name).toBeGreaterThan(0);
    }
  });

  it('shows the moon larger in front of the planet than behind it (perspective)', () => {
    const s = landscape[0]![1];
    const r = lapOnScreen(homeRig(s), s, shellShapeFor(s.w, s.h));
    expect(r.maxPx / r.minPx).toBeGreaterThan(1.6);
    // Legible at the far side, not a billboard banner at the near side.
    expect(r.minPx).toBeGreaterThanOrEqual(MIN_MOON_PX);
    expect(r.maxPx).toBeLessThan(110);
  });

  it('keeps most of the lap in view while the globe drifts at the default zoom', () => {
    // The idle drift turns the camera round the polar axis; the orbit may leave the free area by less than a moon's height.
    const s = landscape[0]![1];
    let worst = 0;
    for (let lon = -180; lon < 180; lon += 15) {
      worst = Math.max(worst, lapOnScreen(homeRig(s, lon), s, LANDSCAPE).overflow);
    }
    expect(worst).toBeLessThan(60);
  });
});

import { describe, expect, it } from 'vitest';
import { CameraRig, maxTiltFor, pivotDepthFor, softLimit, TILT_FAR, TILT_NEAR } from './camera';
import { computeFraming, DEFAULT_FRAMING, type Insets, planetRadiusPx } from './framing';

const TAN17 = Math.tan((17 * Math.PI) / 180);
/** The desktop frame today: top bar 52, dock 80, timeline + rail + status bar 154. */
const DESK: Insets = { left: 80, right: 0, top: 52, bottom: 154 };

function check(w: number, h: number, inset: Insets) {
  const f = computeFraming({ w, h, inset, tanHalfFov: TAN17, homeRange: 3.6 });
  const env = f.homeRadius * DEFAULT_FRAMING.envelope;
  return { f, env, railTop: h - inset.bottom };
}

describe('computeFraming', () => {
  it('reduces to the plain centred view at weight 0', () => {
    const f = computeFraming({ w: 2000, h: 1000, inset: DESK, tanHalfFov: TAN17, homeRange: 3.6, weight: 0 });
    expect(f.fit).toBe(1);
    expect(f.shiftX).toBeCloseTo((DESK.left - DESK.right) / 2, 6);
    expect(f.shiftY).toBeCloseTo((DESK.top - DESK.bottom) / 2, 6);
  });

  // The DPR list of the brief, applied to a 2560 x 1440 device: the CSS viewport shrinks or grows with the scale.
  const scales = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.333, 1.5, 1.6667, 1.75, 2, 2.25];
  for (const dpr of scales) {
    it(`keeps the envelope inside the free area with clearance at DPR ${dpr}`, () => {
      const w = Math.round(2560 / dpr);
      const h = Math.round(1440 / dpr);
      const { f, env, railTop } = check(w, h, DESK);
      // Below the top bar, above the rail (32 px), right of the dock.
      expect(f.cy - env).toBeGreaterThanOrEqual(DESK.top + DEFAULT_FRAMING.clearTop - 0.5);
      expect(f.cy + env).toBeLessThanOrEqual(railTop - DEFAULT_FRAMING.clearBottom + 0.5);
      expect(f.cx - env).toBeGreaterThanOrEqual(DESK.left);
      // Centred horizontally in the free area; never above the free area's centre by more than the lift.
      expect(f.cx).toBeCloseTo(DESK.left + (w - DESK.left) / 2, 6);
      const geo = DESK.top + (h - DESK.top - DESK.bottom) / 2;
      expect(f.cy).toBeLessThanOrEqual(geo + 1e-6);
      expect(geo - f.cy).toBeLessThanOrEqual(DEFAULT_FRAMING.maxLift + 1e-6);
      expect(f.fit).toBeLessThanOrEqual(1);
    });
  }

  it('sits a little above the free area centre when there is room', () => {
    const { f } = check(2899, 1422, DESK); // the user's screen: 2000 x 981 device px at 0.69
    const geo = DESK.top + (1422 - DESK.top - DESK.bottom) / 2;
    expect(geo - f.cy).toBeGreaterThan(4);
    expect(f.fit).toBe(1);
  });

  it('shrinks the planet for whatever rail height the frame measures', () => {
    for (const bottom of [60, 154, 220, 320]) {
      const inset = { ...DESK, bottom };
      const { f, env } = check(1600, 900, inset);
      expect(f.cy + env).toBeLessThanOrEqual(900 - bottom - DEFAULT_FRAMING.clearBottom + 0.5);
      expect(f.cy - env).toBeGreaterThanOrEqual(DESK.top + DEFAULT_FRAMING.clearTop - 0.5);
    }
  });

  it('fits a docked window on the right and keeps the moon room when asked', () => {
    const inset = { ...DESK, right: 700 };
    const f = computeFraming({ w: 1600, h: 1000, inset, tanHalfFov: TAN17, homeRange: 3.6 });
    expect(f.cx).toBeCloseTo(80 + (1600 - 80 - 700) / 2, 6);
    expect(f.homeRadius * DEFAULT_FRAMING.envelope).toBeLessThanOrEqual((1600 - 80 - 700) / 2 - 24 + 0.5);
    const moon = computeFraming(
      { w: 1600, h: 1000, inset, tanHalfFov: TAN17, homeRange: 3.6 },
      { ...DEFAULT_FRAMING, sideRoom: 1.6 },
    );
    expect(moon.homeRadius * 1.6).toBeLessThanOrEqual((1600 - 80 - 700) / 2 - 24 + 0.5);
  });

  it('never shrinks past minFit on a tiny free area', () => {
    const f = computeFraming({
      w: 400,
      h: 300,
      inset: { left: 0, right: 0, top: 52, bottom: 200 },
      tanHalfFov: TAN17,
      homeRange: 3.6,
    });
    expect(f.fit).toBe(DEFAULT_FRAMING.minFit);
    expect(Number.isFinite(f.cy)).toBe(true);
  });

  it('matches the projected radius of the unit sphere', () => {
    // 0.5 h / tan(17 deg) / sqrt(4.6^2 - 1) is the design's 36.4 % of the height.
    expect(planetRadiusPx(1000, TAN17, 3.6) / 1000).toBeCloseTo(0.3638, 3);
  });
});

describe('pitch limits', () => {
  it('allows a small pitch at the global view and a horizon tilt near the surface', () => {
    expect(maxTiltFor(3.6)).toBeCloseTo(TILT_FAR, 6);
    expect(maxTiltFor(0.05)).toBeCloseTo(TILT_NEAR, 6);
    let prev = Infinity;
    for (const r of [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6]) {
      const m = maxTiltFor(r);
      expect(m).toBeLessThanOrEqual(prev + 1e-9);
      prev = m;
    }
  });

  it('pivots about the centre at the global view and the surface up close', () => {
    expect(pivotDepthFor(3.6)).toBe(0);
    expect(pivotDepthFor(0.2)).toBe(1);
    expect(pivotDepthFor(0.9)).toBeGreaterThan(0);
    expect(pivotDepthFor(0.9)).toBeLessThan(1);
  });

  it('rubber-bands past the limits', () => {
    expect(softLimit(0.2, 0, 0.35)).toBe(0.2);
    const over = softLimit(2, 0, 0.35);
    expect(over).toBeGreaterThan(0.35);
    expect(over).toBeLessThan(0.35 + 0.07 + 1e-9);
    expect(softLimit(-1, 0, 0.35)).toBeGreaterThan(-0.07 - 1e-9);
  });
});

/** Projects the planet's centre and radius the way the engine does. */
function disc(rig: CameraRig, w: number, h: number) {
  const pt = { x: 0, y: 0, visible: false, depth: 0 };
  rig.project(0, 0, 0, w, h, pt);
  const d = Math.max(1.0002, rig.distance);
  return { x: pt.x, y: pt.y, r: rig.projScale / Math.sqrt(d * d - 1) };
}

function framedRig(w: number, h: number, inset: Insets) {
  const rig = new CameraRig();
  rig.setViewport(w, h);
  const f = computeFraming({ w, h, inset, tanHalfFov: rig.tanHalfFovBase, homeRange: 3.6 });
  rig.setViewShift(f.shiftX, f.shiftY);
  rig.setFit(f.fit);
  rig.update(1 / 60, 0);
  return { rig, f };
}

function settle(rig: CameraRig, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, t);
}

describe('CameraRig pitch keeps the framing', () => {
  for (const [w, h] of [
    [2000, 981],
    [2899, 1422],
    [1280, 800],
  ] as const) {
    it(`a maximal middle-drag pitch at ${w} x ${h} leaves the planet framed`, () => {
      const { rig, f } = framedRig(w, h, DESK);
      const before = disc(rig, w, h);
      expect(before.x).toBeCloseTo(f.cx, 0);
      expect(before.y).toBeCloseTo(f.cy, 0);
      // Drag far past every limit (the user's repro: hold the middle button and pull down).
      rig.orbitStart(0);
      for (let i = 1; i <= 120; i++) rig.orbitBy(0, 40 * 0.005, i * 16);
      // While held: the rubber band, never more than the band past the limit.
      expect(rig.tiltD).toBeLessThanOrEqual(maxTiltFor(rig.rangeD) + 0.07 + 1e-9);
      settle(rig, 0.5);
      const held = disc(rig, w, h);
      rig.orbitEnd(2000);
      settle(rig, 3);
      const after = disc(rig, w, h);
      for (const p of [held, after]) {
        expect(Math.abs(p.x - f.cx)).toBeLessThan(1);
        expect(Math.abs(p.y - f.cy)).toBeLessThan(1);
        expect(p.y + p.r * DEFAULT_FRAMING.envelope).toBeLessThanOrEqual(
          h - DESK.bottom - DEFAULT_FRAMING.clearBottom + 1,
        );
        expect(p.y - p.r).toBeGreaterThan(DESK.top);
      }
      // Released past the limit: eased back inside it.
      expect(rig.tilt).toBeLessThanOrEqual(maxTiltFor(rig.rangeD) + 1e-3);
    });
  }

  it('releases with momentum that decays, then rests', () => {
    const { rig } = framedRig(1600, 900, DESK);
    rig.orbitStart(0);
    for (let i = 1; i <= 5; i++) rig.orbitBy(0.02, 0.01, i * 16);
    rig.orbitEnd(5 * 16 + 4);
    const t0 = rig.tiltD;
    rig.update(1 / 60, 0);
    expect(rig.tiltD).toBeGreaterThan(t0); // still moving after the release
    settle(rig, 4);
    const rest = rig.tiltD;
    settle(rig, 1);
    expect(rig.tiltD).toBeCloseTo(rest, 6);
    expect(rig.tiltD).toBeLessThanOrEqual(maxTiltFor(rig.rangeD) + 1e-9);
  });

  it('eases the pitch down when zooming out from a horizon view', () => {
    const { rig } = framedRig(1600, 900, DESK);
    rig.setPose(45, 8, 0, 0.1, 1.1, true);
    rig.update(1 / 60, 0);
    rig.zoomBy(36);
    settle(rig, 0.1);
    expect(rig.tilt).toBeGreaterThan(0.6); // no snap
    settle(rig, 4);
    expect(rig.tilt).toBeLessThanOrEqual(TILT_FAR + 1e-3);
  });

  it('home eases pitch, heading and zoom back to the framing', async () => {
    const { rig, f } = framedRig(2000, 981, DESK);
    rig.setPose(30, 20, 0.8, 0.4, 1.0, true);
    rig.update(1 / 60, 0);
    const done = rig.home(3.6);
    settle(rig, 0.3);
    expect(rig.tilt).toBeGreaterThan(0.05); // under way, not a cut
    settle(rig, 1.5);
    expect(await done).toBe(true);
    expect(rig.tilt).toBeCloseTo(0, 6);
    expect(rig.range).toBeCloseTo(3.6, 6);
    const p = disc(rig, 2000, 981);
    expect(Math.abs(p.y - f.cy)).toBeLessThan(1);
    expect(p.r).toBeCloseTo(f.homeRadius, 0);
  });

  it('keeps the surface pivot and full pitch range for the ambient director', () => {
    const { rig } = framedRig(1600, 900, DESK);
    rig.framedTarget = 0;
    rig.framed = 0;
    rig.setDesired(18, 10, 0, 3.0, 0.33);
    settle(rig, 4);
    expect(rig.tilt).toBeCloseTo(0.33, 3);
    // The surface pivot: pitch lowers the planet on screen (the director's compositions rely on it).
    expect(disc(rig, 1600, 900).y).toBeGreaterThan(900 / 2 + rig.shiftY + 20);
  });
});

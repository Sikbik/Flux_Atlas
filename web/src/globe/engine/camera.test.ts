import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from './camera';
import { DEG } from './math';

const W = 1600;
const H = 900;
const DT = 1 / 60;

function rig(shiftX = -190, shiftY = -55): CameraRig {
  const r = new CameraRig();
  r.setViewport(W, H);
  r.setViewShift(shiftX, shiftY);
  r.framed = 1;
  r.framedTarget = 1;
  r.update(DT, 0);
  return r;
}

function ll(lat: number, lon: number, radius = 1): THREE.Vector3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return new THREE.Vector3(
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
    Math.cos(la) * Math.cos(lo),
  ).multiplyScalar(radius);
}

const screen = (r: CameraRig, p: THREE.Vector3) => {
  const out = { x: 0, y: 0, visible: false, depth: 0 };
  r.project(p.x, p.y, p.z, W, H, out);
  return out;
};

function settle(r: CameraRig, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += DT) {
    r.update(DT, t);
    each?.();
    r.holdAnchor(t);
  }
}

/** Zooms from the current range to `to` the way the wheel does (many small steps, the spring easing between), returning the worst screen drift of `p` from `at`. */
function zoomTo(r: CameraRig, to: number, p: () => THREE.Vector3, at: { x: number; y: number }): number {
  let worst = 0;
  let t = 0;
  const measure = () => {
    const s = screen(r, p());
    worst = Math.max(worst, Math.hypot(s.x - at.x, s.y - at.y));
  };
  while (r.rangeD > to * 1.0001) {
    r.zoomBy(Math.max(to / r.rangeD, 0.85));
    for (let k = 0; k < 4; k++, t += DT) {
      r.update(DT, t);
      r.moveAnchor(p());
      r.holdAnchor(t);
      measure();
    }
  }
  for (let k = 0; k < 240; k++, t += DT) {
    r.update(DT, t);
    r.moveAnchor(p());
    r.holdAnchor(t);
    measure();
  }
  return worst;
}

describe('CameraRig: flights land on their point', () => {
  it('puts the point exactly at the view centre (the free area centre), pitched and at mid zoom', () => {
    for (const [lat, lon, range, tilt] of [
      [34.05, -118.25, 0.5, 0.32],
      [-33.9, 151.2, 0.36, 0.32],
      [64.1, -21.9, 1.2, 0.2],
      [0, 0, 0.05, 0.9],
    ] as const) {
      const r = rig();
      let done = false;
      void r.flyTo(lat, lon, range, { tilt }).then((d) => {
        done = d;
      });
      settle(r, 3);
      expect(r.isFlying).toBe(false);
      const s = screen(r, ll(lat, lon));
      expect(s.x).toBeCloseTo(W / 2 + r.shiftX, 2);
      expect(s.y).toBeCloseTo(H / 2 + r.shiftY, 2);
      expect(done || !r.isFlying).toBe(true);
    }
  });

  it('lands on a lifted point (a node drawn above the surface)', () => {
    const r = rig();
    const p = ll(48.86, 2.35, 1.0012);
    void r.flyTo(48.86, 2.35, 0.3, { tilt: 0.32, radius: 1.0012 });
    settle(r, 3);
    const s = screen(r, p);
    expect(s.x).toBeCloseTo(W / 2 + r.shiftX, 2);
    expect(s.y).toBeCloseTo(H / 2 + r.shiftY, 2);
  });
});

describe('CameraRig: the anchor holds a point through the zoom', () => {
  it('a node off centre stays within a pixel of its screen point from range 3.6 to 0.0125', () => {
    const r = rig();
    r.setPose(30, -100, 0, 3.6, 0, true);
    r.update(DT, 0);
    const p = ll(34.05, -118.25, 1.0012);
    const at = screen(r, p);
    expect(at.visible).toBe(true);
    expect(r.setAnchor(p, 'lock')).toBe(true);
    const worst = zoomTo(r, 0.0125, () => p, at);
    expect(r.range).toBeLessThan(0.0126);
    expect(worst).toBeLessThan(1);
  });

  it('holds while the pitch rises with the zoom and the pivot sinks below the surface', () => {
    const r = rig();
    void r.flyTo(34.05, -118.25, 0.5, { tilt: 0.32 });
    settle(r, 3);
    const p = ll(34.05, -118.25);
    const at = screen(r, p);
    r.setAnchor(p, 'lock', 0, 0);
    // A pitch drag mid-zoom, then the rest of the zoom.
    r.orbitBy(0, 0.4);
    const worst = zoomTo(r, 0.0125, () => p, at);
    expect(worst).toBeLessThan(1);
    // And back out to the global view.
    const back = zoomTo(r, 3.6, () => p, at);
    expect(back).toBeLessThan(1);
  });

  it('follows a node that moves as its fan closes with the zoom (the lone-node case)', () => {
    const r = rig();
    // The node sits on a spiral whose world radius shrinks with the range (constant pixels).
    const base = ll(34.05, -118.25);
    const east = new THREE.Vector3(0, 1, 0).cross(base).normalize();
    const node = () => {
      const off = (12 * r.range) / r.projScale;
      return base.clone().applyAxisAngle(new THREE.Vector3().crossVectors(base, east).normalize(), off);
    };
    void r.flyTo(34.05, -118.25, 0.5, { tilt: 0.32 });
    settle(r, 3);
    const at = screen(r, node());
    r.setAnchor(node(), 'lock');
    const worst = zoomTo(r, 0.0125, node, at);
    expect(worst).toBeLessThan(1.5);
  });

  it('without the anchor the same zoom loses a node that the flight left off its target (the bug)', () => {
    const r = rig();
    void r.flyTo(34.05, -118.25, 0.5, { tilt: 0.32 });
    settle(r, 3);
    // 12 km off the target: what the old fly-to aimed at for a node alone at its site.
    const p = ll(34.05 + 0.11, -118.25);
    const at = screen(r, p);
    let worst = 0;
    while (r.rangeD > 0.0125) {
      r.zoomBy(0.85);
      settle(r, 0.07);
      const s = screen(r, p);
      worst = Math.max(worst, Math.hypot(s.x - at.x, s.y - at.y));
    }
    expect(worst).toBeGreaterThan(150);
  });

  it('a zoom anchor lets go once the zoom settles, and a drag lets go of a lock', () => {
    const r = rig();
    r.setPose(10, 10, 0, 1.2, 0, true);
    r.update(DT, 0);
    r.setAnchor(ll(12, 14), 'zoom');
    r.zoomBy(0.8);
    expect(r.isZooming).toBe(true);
    settle(r, 4);
    expect(r.isZooming).toBe(false);
    r.setAnchor(ll(12, 14), 'lock');
    r.grabStart(0, 0, 0);
    expect(r.anchorKind).toBe(null);
    r.grabEnd();
    r.setAnchor(ll(12, 14), 'lock');
    void r.flyTo(0, 0, 2);
    expect(r.anchorKind).toBe(null);
  });
});

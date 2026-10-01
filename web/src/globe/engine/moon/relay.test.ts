import { describe, expect, it } from 'vitest';
import { Rng } from '../math';
import type { V3 } from './orbit';
import { relayPoint } from './relay';

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const UP = v3(0, 1, 0);

function randomDir(rng: Rng): V3 {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return v3(r * Math.cos(a), r * Math.sin(a), z);
}
const scaled = (d: V3, r: number): V3 => v3(d.x * r, d.y * r, d.z * r);

describe('a relay beam between a node and the moon', () => {
  it('starts at one end and finishes at the other, whatever the pose', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 400; i++) {
      const A = scaled(randomDir(rng), rng.range(1, 1.25));
      const B = scaled(randomDir(rng), rng.range(1.35, 2.2));
      const p0 = relayPoint(A, B, 0, UP, v3());
      const p1 = relayPoint(A, B, 1, UP, v3());
      expect(len(sub(p0, A))).toBeLessThan(1e-9);
      expect(len(sub(p1, B))).toBeLessThan(1e-9);
      // And backwards (a downlink runs from the moon to the node).
      expect(len(sub(relayPoint(B, A, 0, UP, v3()), B))).toBeLessThan(1e-9);
      expect(len(sub(relayPoint(B, A, 1, UP, v3()), A))).toBeLessThan(1e-9);
    }
  });

  it('never goes through the planet, and clears it comfortably in between', () => {
    const rng = new Rng(11);
    let minMid = Infinity;
    for (let i = 0; i < 600; i++) {
      const A = scaled(randomDir(rng), rng.range(1, 1.2));
      const B = scaled(randomDir(rng), rng.range(1.4, 2.1));
      for (let k = 0; k <= 100; k++) {
        const s = k / 100;
        const p = relayPoint(A, B, s, UP, v3());
        expect(len(p)).toBeGreaterThanOrEqual(Math.min(len(A), len(B)) - 1e-9);
        if (s >= 0.12 && s <= 0.88) minMid = Math.min(minMid, len(p));
      }
    }
    expect(minMid).toBeGreaterThan(1.08);
  });

  it('is smooth: no jumps along the route and a straight radial climb when the moon is overhead', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const A = scaled(randomDir(rng), 1.02);
      const B = scaled(randomDir(rng), 1.6);
      let prev = relayPoint(A, B, 0, UP, v3());
      const total = len(sub(B, A)) + 4;
      for (let k = 1; k <= 200; k++) {
        const p = relayPoint(A, B, k / 200, UP, v3());
        // The arc is at most a few times the straight line, so a 1/200 step is a small part of it.
        expect(len(sub(p, prev))).toBeLessThan(total / 40);
        prev = p;
      }
    }
    // The moon straight above the node: the route is the radial line.
    const A = v3(0, 0, 1.0);
    const B = v3(0, 0, 1.5);
    for (let k = 0; k <= 10; k++) {
      const p = relayPoint(A, B, k / 10, UP, v3());
      expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-9);
      expect(p.z).toBeGreaterThanOrEqual(1);
      expect(p.z).toBeLessThanOrEqual(1.5);
    }
  });

  it('leaves the planet straight up and meets the moon along its own radial line', () => {
    const A = v3(0.6, 0.3, 0.74);
    const a = scaled(A, 1 / len(A));
    const B = scaled(v3(-0.5, 0.7, 0.5), 1.5 / len(v3(-0.5, 0.7, 0.5)));
    const b = scaled(B, 1 / len(B));
    const h = 1e-4;
    const d0 = sub(relayPoint(A, B, h, UP, v3()), relayPoint(A, B, 0, UP, v3()));
    const d1 = sub(relayPoint(A, B, 1, UP, v3()), relayPoint(A, B, 1 - h, UP, v3()));
    // The first step is along a (radially out), the last along b (radially out as well).
    expect(dot(d0, a) / len(d0)).toBeGreaterThan(0.999);
    expect(Math.abs(dot(d1, b)) / len(d1)).toBeGreaterThan(0.999);
  });

  it('goes over the limb, on the side of the camera up vector, to a moon on the far side', () => {
    const A = v3(0, 0, 1.0);
    const B = v3(0, 0, -1.5);
    let maxY = 0;
    for (let k = 0; k <= 200; k++) {
      const p = relayPoint(A, B, k / 200, UP, v3());
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      maxY = Math.max(maxY, p.y);
      if (k >= 30 && k <= 170) expect(len(p)).toBeGreaterThan(1.1);
    }
    // It clears the planet's disc on the way round, hugging it rather than shooting off the top of the view.
    expect(maxY).toBeGreaterThan(1.1);
    expect(maxY).toBeLessThan(1.25);
    // Slightly off the antipode on either side stays well behaved: no NaN, and a continuous route.
    for (const dx of [-0.2, -0.05, -0.001, 0, 0.001, 0.05, 0.2]) {
      const Bn = scaled(v3(dx, 0.02, -1), 1.5 / len(v3(dx, 0.02, -1)));
      let prev = relayPoint(A, Bn, 0, UP, v3());
      for (let k = 1; k <= 100; k++) {
        const p = relayPoint(A, Bn, k / 100, UP, v3());
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(len(sub(p, prev))).toBeLessThan(0.5);
        prev = p;
      }
    }
  });

  it('stays low over the planet on a wide hop and climbs only near the moon', () => {
    // A node on the near side, a moon behind the planet: radius at a third of the route is near the plateau,
    // radius over the last tenth is nearly the moon's.
    const A = v3(0.2, 0.7, 0.7);
    const B = scaled(v3(-0.3, -0.2, -0.9), 1.5 / len(v3(-0.3, -0.2, -0.9)));
    const a = scaled(A, 1 / len(A));
    expect(Math.acos(dot(a, scaled(B, 1 / len(B))))).toBeGreaterThan(2.2);
    const r = (s: number): number => len(relayPoint(a, B, s, UP, v3()));
    expect(r(0.3)).toBeLessThan(1.2);
    expect(r(0.45)).toBeLessThan(1.25);
    expect(r(0.97)).toBeGreaterThan(1.4);
    // A short hop climbs the usual way: well up by the middle.
    const C = scaled(v3(0.5, 0.7, 0.55), 1.5 / len(v3(0.5, 0.7, 0.55)));
    expect(len(relayPoint(a, C, 0.5, UP, v3()))).toBeGreaterThan(1.3);
  });

  it('survives degenerate input', () => {
    const same = relayPoint(v3(0, 0, 1), v3(0, 0, 1), 0.5, UP, v3());
    expect(Number.isFinite(same.x + same.y + same.z)).toBe(true);
    // A hint parallel to the endpoint's direction.
    const p = relayPoint(v3(0, 1, 0), v3(0, -1.5, 0), 0.5, v3(0, 1, 0), v3());
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    expect(len(p)).toBeGreaterThan(1.1);
  });
});

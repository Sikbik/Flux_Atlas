import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSharedUniforms } from '../uniforms';
import { beadDrag, beadHash, beadKick, beadTumble, MoonChain } from './chain';

describe('the chain of embers', () => {
  it('gives every block its own stable size, scatter and tumble', () => {
    for (let h = 2_997_000; h < 2_997_040; h++) {
      const a = beadHash(h, 1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      expect(beadHash(h, 1)).toBe(a);
      expect(beadHash(h, 2)).not.toBe(a);
    }
    // Spread over the unit interval, not clustered: neighbouring blocks differ.
    let sum = 0;
    const seen = new Set<number>();
    for (let h = 0; h < 2000; h++) {
      const v = beadHash(h, 3);
      sum += v;
      seen.add(Math.floor(v * 10));
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
    expect(seen.size).toBe(10);
  });

  it('kicks a newborn bead out of the moon in a second and a half, decelerating', () => {
    expect(beadKick(0)).toBe(0);
    expect(beadKick(1.5)).toBe(1);
    expect(beadKick(9)).toBe(1);
    let prev = 0;
    let prevStep = Infinity;
    for (let k = 1; k <= 30; k++) {
      const v = beadKick(k * 0.05);
      expect(v).toBeGreaterThan(prev);
      // Each step is shorter than the last: it eases out, it never lurches.
      expect(v - prev).toBeLessThanOrEqual(prevStep + 1e-12);
      prevStep = v - prev;
      prev = v;
    }
  });

  it('lets a bead fall back along the orbit, quickly at first and then settling, to a few degrees', () => {
    expect(beadDrag(0)).toBe(0);
    let prev = 0;
    for (let age = 1; age <= 400; age += 1) {
      const d = beadDrag(age);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(beadDrag(400)).toBeLessThan(0.13);
    expect(beadDrag(400)).toBeGreaterThan(0.125);
    // Not a ring: the fall-back is a small share of a lap.
    expect(beadDrag(400)).toBeLessThan(0.15);
  });

  it('tumbles a little as a bead is born and settles, with no jump in any frame', () => {
    for (const seed of [0.05, 0.3, 0.5, 0.51, 0.9]) {
      let prev = beadTumble(seed, 0);
      expect(Math.abs(prev)).toBeLessThan(0.5);
      for (let age = 1 / 60; age < 60; age += 1 / 60) {
        const t = beadTumble(seed, age);
        expect(Math.abs(t - prev)).toBeLessThan(0.02);
        prev = t;
      }
      expect(Math.abs(prev)).toBeLessThan(1.4);
    }
  });

  it('holds one bead per sealed block, in order, and sheds the newest when the chain turns back', () => {
    const chain = new MoonChain(createSharedUniforms());
    const e1 = new THREE.Vector3(1, 0, 0);
    const e2 = new THREE.Vector3(0, 0, 1);
    chain.life = 1000;
    for (let k = 0; k < 5; k++) chain.add(k * 0.4, 100 + k, k * 30);
    expect(chain.count).toBe(5);
    expect(chain.blocks().map((b) => b.height)).toEqual([100, 101, 102, 103, 104]);
    chain.update(150, e1, e2, 1.5, 2, 0.3);
    chain.drop(2);
    expect(chain.blocks().map((b) => b.height)).toEqual([100, 101, 102]);
  });

  it('seeds its beads from block times and lets old ones go as their life runs out', () => {
    const chain = new MoonChain(createSharedUniforms());
    const e1 = new THREE.Vector3(1, 0, 0);
    const e2 = new THREE.Vector3(0, 0, 1);
    chain.life = 96;
    const nowMs = 1_000_000_000;
    chain.seed(
      [
        { height: 1, time: nowMs - 200_000 },
        { height: 2, time: nowMs - 60_000 },
        { height: 3, time: nowMs - 20_000 },
      ],
      (ms) => (ms / 1000) * 0.026,
      nowMs,
      500,
    );
    expect(chain.count).toBe(3);
    // The oldest has already outlived its life: the first frame sheds it.
    chain.update(500, e1, e2, 1.5, 0, 0.3);
    expect(chain.count).toBe(2);
    // Far later nothing is left and the trail draws nothing.
    chain.update(900, e1, e2, 1.5, 0, 0.3);
    expect(chain.count).toBe(0);
  });

  it('draws a wake only while it is wanted, and fades with its alpha', () => {
    const chain = new MoonChain(createSharedUniforms());
    const e1 = new THREE.Vector3(1, 0, 0);
    const e2 = new THREE.Vector3(0, 0, 1);
    chain.update(0, e1, e2, 1.5, 1, 0.3, 1, 1);
    expect(chain.wakeAlpha).toBeCloseTo(1, 9);
    chain.update(0.1, e1, e2, 1.5, 1, 0.3, 1.5, 0.5);
    expect(chain.wakeAlpha).toBeCloseTo(0.75, 9);
    chain.update(0.2, e1, e2, 1.5, 1, 0.3, 1, 0);
    expect(chain.wakeAlpha).toBe(0);
    chain.enabled = false;
    chain.update(0.3, e1, e2, 1.5, 1, 0.3, 1, 1);
    expect(chain.wakeAlpha).toBe(0);
  });
});

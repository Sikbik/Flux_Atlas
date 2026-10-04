import { describe, expect, it } from 'vitest';
import {
  Governor,
  type GovernorStep,
  SCALE_FLOOR,
  STALL_S,
  TIER_CALM_S,
  TIER_WAIT_MAX_S,
  TIER_WAIT_S,
} from './governor';

/** Feeds frames of `dt` seconds for `seconds` from `t0`; returns the time reached and every step taken. */
function run(g: Governor, seconds: number, dt: number, t0: number): { t: number; steps: GovernorStep[] } {
  const steps: GovernorStep[] = [];
  let t = t0;
  const end = t0 + seconds;
  while (t < end) {
    t += dt;
    const s = g.frame(dt, t);
    if (s) steps.push(s);
  }
  return { t, steps };
}

const FAST = 1 / 60;
const SLOW = 1 / 25;

/** Slow frames until the governor reaches `tier` at its floor scale (or gives up after `limit` seconds). */
function downTo(g: Governor, tier: string, t0: number, limit = 600): number {
  let t = t0;
  while (!(g.tier === tier && g.scale <= SCALE_FLOOR) && t - t0 < limit) {
    t += SLOW;
    g.frame(SLOW, t);
  }
  return t;
}

describe('Governor', () => {
  it('starts at its ceiling at full scale', () => {
    const g = new Governor('high');
    expect([g.tier, g.scale]).toEqual(['high', 1]);
    expect(g.forcedLite).toBe(false);
  });

  it('never steps down on stalls: minutes away, the page drawing a frame now and then', () => {
    const g = new Governor('high');
    let t = 0;
    // The window off screen: a frame every few seconds for ten minutes, then the viewer is back.
    for (let i = 0; i < 200; i++) {
      t += 3;
      expect(g.frame(3, t)).toBeNull();
    }
    // One enormous gap, then normal frames again.
    t += 600;
    expect(g.frame(600, t)).toBeNull();
    run(g, 10, FAST, t);
    expect([g.tier, g.scale]).toEqual(['high', 1]);
  });

  it('counts a frame just over the stall gap as neither slow nor calm', () => {
    const g = new Governor('high');
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += STALL_S + 0.01;
      g.frame(STALL_S + 0.01, t);
    }
    expect([g.tier, g.scale]).toEqual(['high', 1]);
  });

  it('steps the scale down on sustained slow frames, then the tier, down to the lowest', () => {
    const g = new Governor('high');
    const { steps } = run(g, 2, SLOW, 0);
    expect(steps[0]).toEqual({ tier: 'high', scale: 0.9 });
    const t = downTo(g, 'low', 2);
    expect(g.tier).toBe('low');
    expect(g.scale).toBe(SCALE_FLOOR);
    expect(g.forcedLite).toBe(true);
    // At the bottom it stays there however slow the frames are.
    run(g, 30, SLOW, t);
    expect([g.tier, g.scale]).toEqual(['low', SCALE_FLOOR]);
  });

  it('a brief hitch is not a step', () => {
    const g = new Governor('high');
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t = run(g, 0.5, SLOW, t).t;
      t = run(g, 2, FAST, t).t;
    }
    expect([g.tier, g.scale]).toEqual(['high', 1]);
  });

  it('climbs back to its ceiling once frames are calm again, and never above it', () => {
    const g = new Governor('high');
    let t = downTo(g, 'low', 0);
    expect(g.tier).toBe('low');
    const seen: string[] = [];
    for (let i = 0; i < 20 && g.tier !== 'high'; i++) {
      const r = run(g, 60, FAST, t);
      t = r.t;
      for (const s of r.steps) if (seen[seen.length - 1] !== s.tier) seen.push(s.tier);
    }
    expect(seen).toEqual(['low', 'medium', 'high']);
    expect(g.forcedLite).toBe(false);
    t = run(g, 600, FAST, t).t;
    expect([g.tier, g.scale]).toEqual(['high', 1]);
  });

  it('waits longer each time a tier bounces, up to ten minutes', () => {
    const g = new Governor('medium');
    let t = downTo(g, 'low', 0);
    const ups: number[] = [];
    const downs: number[] = [t];
    for (let bounce = 0; bounce < 6; bounce++) {
      // Calm until the tier steps up...
      while (g.tier === 'low') {
        t += FAST;
        g.frame(FAST, t);
      }
      ups.push(t);
      // ...then slow again at once: a bounce.
      t = downTo(g, 'low', t);
      downs.push(t);
    }
    const waits = ups.map((u, i) => u - (downs[i] ?? 0));
    // Each wait is at least the one before (the calm climb takes the same time each round), and they grow.
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThanOrEqual(waits[i - 1]! - 1);
    expect(waits[waits.length - 1]!).toBeGreaterThan(waits[0]! + TIER_WAIT_S);
    expect(waits[waits.length - 1]!).toBeLessThan(TIER_WAIT_MAX_S + TIER_CALM_S + 200);
  });

  it('on a device whose ceiling is the lowest tier it never forces the lite look', () => {
    const g = new Governor('low');
    run(g, 60, SLOW, 0);
    expect(g.tier).toBe('low');
    expect(g.forcedLite).toBe(false);
    run(g, 600, FAST, 60);
    expect(g.tier).toBe('low');
  });

  it('reset goes back to the ceiling at full scale and forgets the bounces', () => {
    const g = new Governor('high');
    downTo(g, 'low', 0);
    expect(g.reset()).toEqual({ tier: 'high', scale: 1 });
    expect(g.forcedLite).toBe(false);
    expect(g.reset('medium')).toEqual({ tier: 'medium', scale: 1 });
    expect(g.ceiling).toBe('medium');
  });

  it('ignores a frame with no time', () => {
    const g = new Governor('high');
    expect(g.frame(0, 1)).toBeNull();
    expect(g.frame(-1, 1)).toBeNull();
    expect(g.frame(Number.NaN, 1)).toBeNull();
  });
});

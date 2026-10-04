// The quality governor (auto quality only): on sustained slow frames it steps the render scale down, then the tier
// (high, medium, low); when frames have been comfortably fast for a while it probes the scale back up, and then the
// tier, never above the tier it started from (the device's ceiling).
//
// Only frames the page actually drew are evidence. A long gap between two frames is a stall (a window off screen on
// Wayland stops drawing without the page being hidden, a locked screen, a busy machine), not a slow GPU: it neither
// counts as slow nor as calm. Before this, the first frame after a few minutes away added minutes of "slow" time at
// once, and a handful of them walked the globe down to the lowest tier, which then never came back up.
//
// A tier that keeps bouncing (stepped up, then down again soon after) waits twice as long before its next try, up to
// ten minutes, so a machine on the edge does not flip the globe's look back and forth.

export type Tier = 'high' | 'medium' | 'low';

export interface GovernorStep {
  tier: Tier;
  /** The render scale, 0.55 to 1. */
  scale: number;
}

/** A frame slower than this (under about 51 fps) counts as slow. */
export const SLOW_FRAME_MS = 19.5;
/** Seconds of slow frames that make one step down. */
export const SLOW_LIMIT_S = 1.5;
/** A gap between two frames longer than this is a stall, not a slow frame (under 4 fps is not drawing at all). */
export const STALL_S = 0.25;
export const SCALE_FLOOR = 0.55;
const SCALE_DOWN = 0.1;
const SCALE_UP = 0.05;
/** The scale a tier change starts from (it climbs to 1 from there). */
const TIER_SCALE = 0.8;
/** Calm seconds before the scale probes up, and not sooner than this after a step down. */
const SCALE_CALM_S = 12;
const SCALE_WAIT_S = 20;
/** Calm seconds at full scale before the tier steps up. */
export const TIER_CALM_S = 30;
/** The first wait after a tier step down before the tier may step back up; doubles on each bounce. */
export const TIER_WAIT_S = 60;
export const TIER_WAIT_MAX_S = 600;
/** A tier step down this soon after a step up is a bounce. */
const BOUNCE_S = 120;

const LOWER: Record<Tier, Tier> = { high: 'medium', medium: 'low', low: 'low' };
const HIGHER: Record<Tier, Tier> = { high: 'high', medium: 'high', low: 'medium' };
const RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

const round2 = (x: number) => Math.round(x * 100) / 100;

export class Governor {
  tier: Tier;
  scale = 1;
  private slowT = 0;
  private calmT = 0;
  private lastDown = Number.NEGATIVE_INFINITY;
  private lastTierDown = Number.NEGATIVE_INFINITY;
  private lastTierUp = Number.NEGATIVE_INFINITY;
  private tierWait = TIER_WAIT_S;

  constructor(public ceiling: Tier) {
    this.tier = ceiling;
  }

  /** Back to the ceiling at full scale, with no history: a new quality level, or a look the viewer just picked. */
  reset(ceiling: Tier = this.ceiling): GovernorStep {
    this.ceiling = ceiling;
    this.tier = ceiling;
    this.scale = 1;
    this.slowT = 0;
    this.calmT = 0;
    this.lastDown = Number.NEGATIVE_INFINITY;
    this.lastTierDown = Number.NEGATIVE_INFINITY;
    this.lastTierUp = Number.NEGATIVE_INFINITY;
    this.tierWait = TIER_WAIT_S;
    return this.step();
  }

  /** One drawn frame that took `dt` seconds, at `now` (wall-clock seconds). Returns the new step when it changed. */
  frame(dt: number, now: number): GovernorStep | null {
    if (!(dt > 0)) return null;
    if (dt > STALL_S) {
      // Not drawing is not evidence either way, and what came before the gap is stale.
      this.slowT = 0;
      this.calmT = 0;
      return null;
    }
    if (dt * 1000 > SLOW_FRAME_MS) {
      this.slowT += dt;
      this.calmT = 0;
    } else {
      this.calmT += dt;
      this.slowT = Math.max(0, this.slowT - dt * 0.5);
    }

    if (this.slowT > SLOW_LIMIT_S && this.scale > SCALE_FLOOR + 0.001) {
      this.scale = Math.max(SCALE_FLOOR, round2(this.scale - SCALE_DOWN));
      this.slowT = 0;
      this.lastDown = now;
      return this.step();
    }
    if (this.slowT > SLOW_LIMIT_S && this.tier !== 'low') {
      if (now - this.lastTierUp < BOUNCE_S) this.tierWait = Math.min(TIER_WAIT_MAX_S, this.tierWait * 2);
      this.tier = LOWER[this.tier];
      this.scale = TIER_SCALE;
      this.slowT = 0;
      this.lastDown = now;
      this.lastTierDown = now;
      return this.step();
    }
    if (this.calmT > SCALE_CALM_S && this.scale < 1 && now - this.lastDown > SCALE_WAIT_S) {
      this.scale = Math.min(1, round2(this.scale + SCALE_UP));
      this.calmT = 0;
      return this.step();
    }
    if (
      this.calmT > TIER_CALM_S &&
      this.scale >= 1 &&
      RANK[this.tier] < RANK[this.ceiling] &&
      now - this.lastTierDown > this.tierWait
    ) {
      this.tier = HIGHER[this.tier];
      this.scale = TIER_SCALE;
      this.calmT = 0;
      this.lastTierUp = now;
      return this.step();
    }
    return null;
  }

  /** The governor stepped down to the lowest tier from a higher ceiling (the globe then draws its lite look). */
  get forcedLite(): boolean {
    return this.tier === 'low' && this.ceiling !== 'low';
  }

  private step(): GovernorStep {
    return { tier: this.tier, scale: this.scale };
  }
}

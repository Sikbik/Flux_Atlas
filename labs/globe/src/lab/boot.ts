// The boot (design 6.4 J), the way an app drives it: the four pieces of the Flux symbol arrive as the
// data does, the block is whole (a white flash), the planet lights in a reveal wave, and the symbol lifts
// off and becomes the moon. The engine draws every frame (`engine.setMoonBoot`, `engine.setReveal`); this
// file only decides when, from the weighted progress of the load. `bootState(t)` is a pure function of
// time, so a screenshot can drive it frame by frame, and `playBoot` runs it in real time.
//
// An app keeps the same split: derive `BootState` from its real stages (progress is the weighted
// completion of real requests), call `applyBoot` each frame, and call `engine.setMoonBoot(null)` and
// `engine.setReveal(null)` when it is over; from the next frame the engine draws the moon.

import type { GlobeEngine } from '../engine/GlobeEngine';

export interface BootState {
  /** Overall load progress, 0..1 (it never goes backwards). */
  progress: number;
  /** Seconds since all four pieces landed (negative before). Drives the 120 ms white flash. */
  whole: number;
  /** Lift-off, 0..1, over `--dur-lift` (1400 ms; 300 ms under reduced motion). */
  lift: number;
}

export interface BootOptions {
  /** Where the reveal wave starts (a node id, normally the newest block's producer). Null skips the wave. */
  origin: number | null;
  /** The symbol's size while it assembles, CSS pixels (250, or 150 on a phone). */
  size?: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The design's stage weights put each piece at a stretch of the progress bar. Order: bar, cap, big hexagon, small hexagon. */
const ARRIVE: [number, number][] = [
  [0.06, 0.14], // the bar, from below, with "Sync the chain tip"
  [0.34, 0.44], // the cap, from above, with the last third of the nodes
  [0.24, 0.34], // the big hexagon, from the right
  [0.14, 0.24], // the small hexagon, from the left
];
const WHOLE_AT = 0.44;
const REVEAL_FROM = 0.6;

/** Seconds of the demo timeline: progress 0 to 1 over 2.4 s (`--dur-boot-min`), the stream opens at 2.0 s. */
export const BOOT_LOAD_S = 2.4;
const STREAM_OPEN_S = 2.0;
const LIFT_S = 1.4;
const LIFT_REDUCED_S = 0.3;

const eased = (x: number): number => x * x * (3 - 2 * x);

/** The moment on the demo timeline when progress reaches `WHOLE_AT`: the cap lands and the block is whole. */
const T_WHOLE = ((): number => {
  let lo = 0;
  let hi = BOOT_LOAD_S;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (eased(mid / BOOT_LOAD_S) < WHOLE_AT) lo = mid;
    else hi = mid;
  }
  return hi;
})();

/** The demo timeline: what the state is `t` seconds after the boot starts. */
export function bootState(t: number, reduced = false): BootState {
  const dur = reduced ? LIFT_REDUCED_S : LIFT_S;
  return { progress: eased(clamp01(t / BOOT_LOAD_S)), whole: t - T_WHOLE, lift: clamp01((t - STREAM_OPEN_S) / dur) };
}

/** Total length of the demo timeline in seconds. */
export function bootDuration(reduced = false): number {
  return STREAM_OPEN_S + (reduced ? LIFT_REDUCED_S : LIFT_S) + 0.05;
}

/** Applies a state to the engine. Call once per frame; returns true while the boot is still running. */
export function applyBoot(engine: GlobeEngine, s: BootState, o: BootOptions): boolean {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const reduced = engine.reduced;
  if (s.lift >= 1) {
    engine.setMoonBoot(null);
    engine.setReveal(null);
    return false;
  }
  const pieces = ARRIVE.map(([a, b]) => clamp01((s.progress - a) / (b - a))) as [number, number, number, number];
  // "The block is whole": the four pieces brighten to white for 120 ms.
  const white = reduced ? 0 : s.whole >= 0 && s.whole < 0.12 ? Math.sin((Math.PI * s.whole) / 0.12) : 0;
  // Reduced motion: opacity only. The symbol fades out in place, then fades in at its orbit position.
  let alpha = 1;
  let lift = s.lift;
  if (reduced) {
    const u = s.lift * LIFT_REDUCED_S; // seconds into the 300 ms cross-fade
    alpha = u < LIFT_REDUCED_S / 2 ? 1 - u / (LIFT_REDUCED_S / 2) : (u - LIFT_REDUCED_S / 2) / (LIFT_REDUCED_S / 2);
    lift = s.lift > 0.5 ? 1 : 0;
    if (s.lift <= 0) alpha = 1;
  }
  engine.setMoonBoot({ pieces, lift, cx: W / 2, cy: H / 2, size: o.size ?? (W < 720 ? 150 : 250), white, alpha });
  // The planet lights in a reveal wave from the newest block's producer, growing with progress (60 to 100%).
  // Reduced motion has no sweeping wave: the planet is simply there once the wave would have started.
  if (o.origin !== null) {
    const wave = clamp01((s.progress - REVEAL_FROM) / (1 - REVEAL_FROM));
    if (reduced) engine.setReveal(s.progress < REVEAL_FROM ? o.origin : null, 0.02);
    else engine.setReveal(o.origin, Math.max(0.02, wave * Math.PI));
  }
  return true;
}

/** The node nearest a lat/lon, as the reveal's origin. */
export function nearestNode(engine: GlobeEngine, lat: number, lon: number): number | null {
  const s = engine.nodes;
  let best = -1;
  let bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < s.high; i++) {
    if (s.alive[i] !== 1 || !Number.isFinite(s.lat[i])) continue;
    const d = (s.lat[i] - lat) ** 2 + ((s.lon[i] - lon) * k) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best < 0 ? null : s.id[best];
}

/** Plays the demo timeline in real time. Resolves when the moon has taken over. */
export function playBoot(engine: GlobeEngine, o: BootOptions): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (): void => {
      const t = (performance.now() - t0) / 1000;
      const running = applyBoot(engine, bootState(t, engine.reduced), o);
      if (running) requestAnimationFrame(step);
      else resolve();
    };
    applyBoot(engine, bootState(0, engine.reduced), o);
    requestAnimationFrame(step);
  });
}

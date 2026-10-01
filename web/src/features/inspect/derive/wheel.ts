// Geometry of the payment wheel: one ring per tier, the queue laid around it with the payout gate at
// 12 o'clock. Positions advance clockwise toward the gate, so the whole ring turns one slot per block;
// `phase` (0 right after a block, 1 when the next is due) turns it continuously in between. All of it
// is pure, so the canvas code only draws what these functions say.

export const TAU = Math.PI * 2;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Angle of queue position `i` of `n`, clockwise from 12 o'clock, at block `phase`. The head (position 0)
 * reaches the gate (angle 0) at phase 1; the node paid by the last block sits at the gate at phase 0 and
 * drifts behind it (counter-clockwise) as the phase grows.
 */
export function slotAngle(i: number, n: number, phase = 0): number {
  if (n <= 0) return 0;
  return mod((i + 1 - phase) / n, 1) * TAU;
}

/** The queue position under an angle (clockwise from 12 o'clock): the inverse of `slotAngle`. */
export function slotAtAngle(theta: number, n: number, phase = 0): number {
  if (n <= 0) return 0;
  return mod(Math.round((mod(theta, TAU) / TAU) * n + phase - 1), n);
}

/** How many ticks a ring of `n` slots draws on a circle of `radius` px: about one per `pitch` px. */
export function binCount(n: number, radius: number, pitch = 3.1, max = 420): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.min(n, max, Math.floor((TAU * radius) / pitch)));
}

/** The tick (0..bins-1) that queue position `i` falls in, counted clockwise from the gate. */
export function binOfPosition(i: number, n: number, bins: number): number {
  if (n <= 0 || bins <= 0) return 0;
  return Math.min(bins - 1, Math.floor((mod(i + 1, n) * bins) / n));
}

export interface Shade {
  /** Tier-colour brightness of the tick: high just ahead of the gate (about to be paid), low far away. */
  run: number;
  /** White-hot brightness of the tick for nodes paid most recently (just behind the gate). */
  wake: number;
}

/** Brightness of tick `s` of `bins`: a runway into the gate and a wake behind it. */
export function tickShade(s: number, bins: number): Shade {
  if (bins <= 0) return { run: 0, wake: 0 };
  const a = (s + 0.5) / bins;
  const run = 0.2 + 0.8 * Math.exp(-a / 0.035);
  const wake = Math.exp(-(1 - a) / 0.03);
  return { run: run * (1 - 0.35 * a), wake };
}

/** Whether a point (relative to the centre) is on the tick band; the band is [inner, outer] px from it. */
export function onBand(dx: number, dy: number, inner: number, outer: number, slack = 8): boolean {
  const r = Math.hypot(dx, dy);
  return r >= inner - slack && r <= outer + slack;
}

/** Angle of a point relative to the centre, clockwise from 12 o'clock. */
export function angleOf(dx: number, dy: number): number {
  return mod(Math.atan2(dx, -dy), TAU);
}

/**
 * Horizontal position of lane tile `i` (position in the queue, -1 = just paid) in slot widths from the
 * gate: tile 0 arrives at the gate as the phase reaches 1.
 */
export function laneOffset(i: number, phase: number): number {
  return i + 1 - phase;
}

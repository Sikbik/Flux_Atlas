// The value axis of a wallet plot: round tick values from zero up to the data, and labels that carry exactly the
// precision the ticks need. Pure functions over numbers; `viz/Plot.tsx` draws them.

import { compactTickAt, niceTicks } from '../../analytics/viz/scale';

export interface Axis {
  lo: number;
  hi: number;
  ticks: number[];
  step: number;
}

/** An axis from zero to a little over `max`, with about `target` intervals. An empty or all-zero chart gets 0 to 1. */
export function axisFromZero(max: number, target = 4): Axis {
  if (!Number.isFinite(max) || max <= 0) return { lo: 0, hi: 1, ticks: [0, 0.5, 1], step: 0.5 };
  const n = niceTicks(0, max * 1.04, target);
  return { lo: n.min, hi: n.max, ticks: n.ticks, step: n.step };
}

/**
 * An axis from zero for a count of things: every tick is a whole number, however few there are (a fleet of one node
 * is not "0.5 nodes" at the half way line).
 */
export function axisCount(max: number, target = 4): Axis {
  if (!Number.isFinite(max) || max <= 0) return { lo: 0, hi: 1, ticks: [0, 1], step: 1 };
  const n = niceTicks(0, max * 1.04, target);
  if (n.step >= 1) return { lo: n.min, hi: n.max, ticks: n.ticks, step: n.step };
  const hi = Math.max(1, Math.ceil(max));
  return { lo: 0, hi, ticks: Array.from({ length: hi + 1 }, (_, i) => i), step: 1 };
}

/** An axis around data that does not start at zero (a cumulative line that begins at its first day's value). */
export function axisAround(min: number, max: number, target = 4): Axis {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return axisFromZero(0);
  const n = niceTicks(min, max, target);
  return { lo: n.min, hi: n.max, ticks: n.ticks, step: n.step };
}

/** `12.5K`, `1.2M`, `340`: an axis label for FLUX. */
export const fluxTick = (v: number, step: number): string => compactTickAt(v, step);

/** The first and last day of a daily series as the time axis: the last day gets its whole width. */
export function dayDomain(t: readonly number[], dayMs = 86_400_000): readonly [number, number] {
  if (t.length === 0) return [0, dayMs];
  return [t[0] as number, (t[t.length - 1] as number) + dayMs];
}

/** An SVG path for the top of a stacked bar with its upper corners rounded (`r` is clamped to the bar). */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (rr <= 0.01) return `M${x} ${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

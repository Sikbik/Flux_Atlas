// Shared numeric helpers for the chart components: interpolation, the easing the motion tokens
// describe (as a JS function, for animation the compositor cannot run), and number formatting that
// builds on lib/format. Pure, so every rule is unit tested without a DOM.

import { formatCompact, UNKNOWN } from '../../lib/format';

/** Linear interpolation between `a` and `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamps `t` into 0..1. */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Rounds to two decimals for SVG path data (keeps strings short and stable). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------------------------

export type EaseFn = (t: number) => number;

/**
 * A CSS cubic-bezier as a function of time: given progress `t` (0..1) it returns eased progress.
 * Newton's method with a bisection fallback, the same approach browsers use.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - t;
      if (Math.abs(err) < 1e-6) return sampleY(s);
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 24; i++) {
      const x = sampleX(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (t > x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

/** The token `--ease-out` (entering things decelerate), used when the token cannot be read. */
export const EASE_OUT_FALLBACK = cubicBezier(0.22, 1, 0.36, 1);

const CUBIC = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/;

/** Parses `cubic-bezier(a, b, c, d)` into an easing function, or null for anything else. */
export function parseCubicBezier(css: string): EaseFn | null {
  const m = CUBIC.exec(css);
  if (!m) return null;
  const [x1, y1, x2, y2] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null;
  return cubicBezier(x1, y1, x2, y2);
}

let cachedEaseOut: EaseFn | null = null;

/** The design's `--ease-out` curve as a function, read from the tokens once and cached. */
export function easeOut(): EaseFn {
  if (cachedEaseOut) return cachedEaseOut;
  let fn: EaseFn | null = null;
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    fn = parseCubicBezier(getComputedStyle(document.documentElement).getPropertyValue('--ease-out'));
  }
  cachedEaseOut = fn ?? EASE_OUT_FALLBACK;
  return cachedEaseOut;
}

// ---------------------------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------------------------

const sig3 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * A short, honest rendering of an arbitrary sample for summaries and tooltips when the caller gave
 * no formatter: three significant digits, grouped integers from a thousand up (`0.0746`, `12.3`,
 * `6,727`). Domain values (FLUX, bytes, percent) should pass their own formatter from lib/format.
 */
export function formatSample(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNKNOWN;
  return Math.abs(n) >= 1000 ? grouped.format(n) : sig3.format(n);
}

const fractionFormats = new Map<number, Intl.NumberFormat>();

function fractionFormat(decimals: number): Intl.NumberFormat {
  let f = fractionFormats.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    fractionFormats.set(decimals, f);
  }
  return f;
}

/**
 * Formats the tick labels of one axis together: one decimal count for every label (derived from the
 * tick step), grouped thousands, and compact `12.5K` / `1.2M` once the largest label reaches
 * 10,000 so the axis stays narrow. Labels on one axis never mix styles.
 */
export function formatTicks(splits: readonly number[], step: number): string[] {
  const biggest = splits.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (biggest >= 10_000) return splits.map((v) => formatCompact(v));
  const decimals = step > 0 && step < 1 ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))) : 0;
  const f = fractionFormat(decimals);
  return splits.map((v) => f.format(v));
}

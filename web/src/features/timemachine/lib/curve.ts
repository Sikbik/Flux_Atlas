// The curve under the scrubber: the number of confirmed nodes over the recorded history, drawn in a
// fixed 1000 by 100 box that the strip scales to its width (strokes keep their width with
// `vector-effect`, so scaling never thickens the line). Unknown buckets break the line; they are never
// drawn as zero.

import { fractionOf } from './time';

/** The drawing box: x runs over the strip's time range, y over the node counts. */
export const BOX = { w: 1000, h: 100 } as const;

export interface Curve {
  /** Bucket start times (ascending, unix ms). */
  t: number[];
  /** Confirmed nodes per bucket; null where the server recorded nothing. */
  nodes: (number | null)[];
  /** Chain tip height per bucket; null where unknown. */
  tip: (number | null)[];
  /** The first bucket with a known node count. */
  first: number;
  /** The smallest and largest known node counts. */
  min: number;
  max: number;
}

export interface CurveInput {
  t: readonly number[];
  nodes: readonly (number | null)[];
  tip: readonly (number | null)[];
}

const known = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/** Builds a curve from columnar data; null when fewer than two buckets carry a node count. */
export function buildCurve(input: CurveInput): Curve | null {
  const n = Math.min(input.t.length, input.nodes.length);
  const t: number[] = [];
  const nodes: (number | null)[] = [];
  const tip: (number | null)[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let first = -1;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = input.nodes[i];
    const at = input.t[i];
    if (at === undefined) continue;
    // Leading unknown buckets (before the first recording) are dropped, not drawn.
    if (first < 0 && !known(v)) continue;
    if (first < 0) first = at;
    t.push(at);
    nodes.push(known(v) ? v : null);
    const h = input.tip[i];
    tip.push(known(h) ? h : null);
    if (known(v)) {
      count++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (count < 2) return null;
  return { t, nodes, tip, first, min, max };
}

/**
 * The y domain for a curve: its range with a little air, so the line fills most of the strip's
 * height. A flat series gets a small fixed window around its level instead of a degenerate one. The
 * strip prints the range beside the curve, so a narrow scale never passes for a dramatic change.
 */
export function yDomain(min: number, max: number): [number, number] {
  const span = max - min;
  const pad = Math.max(span * 0.18, 2);
  const mid = (min + max) / 2;
  const half = Math.max(span / 2 + pad, pad * 2);
  return [mid - half, mid + half];
}

export interface CurvePaths {
  /** The line, broken at unknown buckets. */
  line: string;
  /** The same line closed down to the bottom edge, for the soft fill. */
  area: string;
}

const r = (n: number): number => Math.round(n * 100) / 100;

/**
 * SVG paths for `curve` laid over the time range `[from, to]` in the drawing box. A bucket outside the
 * range is skipped, so the same curve serves a longer or shorter strip.
 */
export function curvePaths(curve: Curve, from: number, to: number): CurvePaths {
  const [lo, hi] = yDomain(curve.min, curve.max);
  const y = (v: number) => BOX.h - ((v - lo) / (hi - lo)) * BOX.h;
  const x = (t: number) => fractionOf(t, from, to) * BOX.w;
  let line = '';
  let area = '';
  let pen = false;
  let segStart = 0;
  let segLast = 0;
  const close = () => {
    if (pen) area += `L${r(segLast)} ${BOX.h}L${r(segStart)} ${BOX.h}Z`;
    pen = false;
  };
  for (let i = 0; i < curve.t.length; i++) {
    const v = curve.nodes[i];
    const at = curve.t[i]!;
    if (!known(v) || at < from || at > to) {
      close();
      continue;
    }
    const px = x(at);
    const py = y(v);
    if (!pen) {
      line += `M${r(px)} ${r(py)}`;
      area += `M${r(px)} ${r(py)}`;
      segStart = px;
      pen = true;
    } else {
      line += `L${r(px)} ${r(py)}`;
      area += `L${r(px)} ${r(py)}`;
    }
    segLast = px;
  }
  close();
  return { line, area };
}

export interface CurveReading {
  /** The bucket the reading came from (its start, unix ms), or null before the first recording. */
  at: number | null;
  nodes: number | null;
  tip: number | null;
}

/** The last known node count and chain tip at or before `t` (the value that held at that moment). */
export function readingAt(curve: Curve, t: number): CurveReading {
  let lo = 0;
  let hi = curve.t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (curve.t[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return { at: null, nodes: null, tip: null };
  // Walk back to the last known values (a bucket can lack one of the two).
  let nodes: number | null = null;
  let tip: number | null = null;
  let at: number | null = null;
  for (let i = found; i >= 0 && (nodes === null || tip === null); i--) {
    if (nodes === null && known(curve.nodes[i])) {
      nodes = curve.nodes[i] ?? null;
      at = curve.t[i] ?? null;
    }
    if (tip === null && known(curve.tip[i])) tip = curve.tip[i] ?? null;
    // Do not reach far back: a hole longer than a few buckets means "unknown", not "the same".
    if (found - i > 3) break;
  }
  return { at, nodes, tip };
}

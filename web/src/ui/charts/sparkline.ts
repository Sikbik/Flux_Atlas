// Sparkline geometry: scaling, path building, gap handling, domain easing and the live-draw frame
// function (design 6.4 E). Everything here is pure, so the maths is unit tested without a DOM; the
// component only turns frames into SVG attributes.

import { clamp01, formatSample, lerp, r2 } from './scale';

export type SparkForm = 'line' | 'area' | 'bars';
/** One sample: a number, or null for "no value" (the line breaks there). */
export type Sample = number | null;
/** A y domain `[min, max]` in data units. */
export type Domain = readonly [number, number];

export interface SparkPoint {
  x: number;
  y: number;
}

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** True for a bar that hangs below its baseline (a negative value): its data end is the bottom. */
  down?: boolean;
}

/** The drawing box and the insets that keep marks, the end dot and its ring inside it. */
export interface SparkBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

/** Size presets: 64 by 26 in stat tiles, 120 by 34 in cards (design 8.11). */
export const SPARK_PRESETS = {
  tile: { width: 64, height: 26 },
  card: { width: 120, height: 34 },
} as const;

/** The end dot is an 8 px disc (radius 4) wearing a 2 px ring in the surface colour. */
export const DOT_RADIUS = 4;
export const DOT_RING = 2;
/** The live-draw reveal of a new segment (design 6.4 E; equals `--dur-tick`). */
export const REVEAL_MS = 420;
/** The y domain easing of the live draw. */
export const DOMAIN_MS = 300;
/** Bars are at most 24 px thick (design 5.6); a sparkline's are far thinner, but the cap holds. */
export const MAX_BAR = 24;
/** A bar's data end radius in a sparkline (design 8.11: bars with 2 px radius). */
export const BAR_RADIUS = 2;
/** The shortest drawn bar, so the smallest value still leaves a stub. */
export const MIN_BAR = 2;

const isNum = (v: Sample | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Insets for a form: line and area keep room for the end dot (when drawn); bars sit flush. */
export function sparkBox(width: number, height: number, form: SparkForm, endDot: boolean): SparkBox {
  if (form === 'bars') return { width, height, padLeft: 0, padRight: 0, padTop: 1, padBottom: 0 };
  const edge = endDot ? DOT_RADIUS + 1 : 2;
  return { width, height, padLeft: 2, padRight: edge, padTop: edge, padBottom: edge };
}

/** Number of finite samples. */
export function finiteCount(values: readonly Sample[]): number {
  let n = 0;
  for (const v of values) if (isNum(v)) n++;
  return n;
}

/** Smallest and largest finite sample, or null when there is none. */
export function extentOf(values: readonly Sample[]): Domain | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!isNum(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** True when there is nothing to draw: no samples, or none of them finite. */
export function isEmpty(values: readonly Sample[]): boolean {
  return finiteCount(values) === 0;
}

/** True when two or more samples exist and every finite one is equal: the series did not move. */
export function isFlat(values: readonly Sample[]): boolean {
  const e = extentOf(values);
  return e !== null && finiteCount(values) >= 2 && e[0] === e[1];
}

/**
 * The y domain for a series. An explicit `override` wins (widened when degenerate). Otherwise the
 * data extent; bars grow from zero so their length stays honest; a flat series is centred.
 */
export function resolveDomain(values: readonly Sample[], form: SparkForm, override?: Domain): Domain {
  if (override) {
    const [lo, hi] = override;
    return lo === hi ? [lo - 1, hi + 1] : lo < hi ? [lo, hi] : [hi, lo];
  }
  const e = extentOf(values);
  if (!e) return [0, 1];
  const [lo, hi] = e;
  if (form === 'bars') {
    if (lo === hi) return lo > 0 ? [0, lo * 2] : lo < 0 ? [lo * 2, 0] : [0, 1];
    return [Math.min(0, lo), Math.max(0, hi)];
  }
  if (lo === hi) {
    const d = Math.abs(lo) * 0.5 || 1;
    return [lo - d, hi + d];
  }
  return [lo, hi];
}

/** Interpolates one domain toward another (the y domain easing of the live draw). */
export function lerpDomain(a: Domain, b: Domain, t: number): Domain {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/** x of sample `i` of `n` across the box; a lone sample sits at the right edge ("now"). */
export function xAt(i: number, n: number, box: SparkBox): number {
  const x0 = box.padLeft;
  const x1 = box.width - box.padRight;
  if (n <= 1) return x1;
  return x0 + (i * (x1 - x0)) / (n - 1);
}

/** y for a value in a domain; larger values are higher (smaller y). Not clamped. */
export function yAt(v: number, domain: Domain, box: SparkBox): number {
  const top = box.padTop;
  const bottom = box.height - box.padBottom;
  const span = domain[1] - domain[0] || 1;
  return bottom - ((v - domain[0]) / span) * (bottom - top);
}

/** Pixel positions of every sample (null where the sample is missing). */
export function layoutPoints(
  values: readonly Sample[],
  domain: Domain,
  box: SparkBox,
): (SparkPoint | null)[] {
  const n = values.length;
  return values.map((v, i) => (isNum(v) ? { x: xAt(i, n, box), y: yAt(v, domain, box) } : null));
}

/** Splits points into runs of consecutive samples; a missing sample ends a run (the line breaks). */
export function splitRuns(points: readonly (SparkPoint | null)[]): SparkPoint[][] {
  const runs: SparkPoint[][] = [];
  let cur: SparkPoint[] = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** SVG path data for the line. Gaps start a new subpath; a lone sample becomes a zero-length stroke (a round dot). */
export function linePath(points: readonly (SparkPoint | null)[]): string {
  let d = '';
  for (const run of splitRuns(points)) {
    const [first, ...rest] = run;
    if (!first) continue;
    d += `M${r2(first.x)} ${r2(first.y)}`;
    if (rest.length === 0) d += `L${r2(first.x)} ${r2(first.y)}`;
    for (const p of rest) d += `L${r2(p.x)} ${r2(p.y)}`;
  }
  return d;
}

/** SVG path data for the area under the line, one closed polygon per run (single samples have no area). */
export function areaPath(points: readonly (SparkPoint | null)[], baseline: number): string {
  let d = '';
  for (const run of splitRuns(points)) {
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last || run.length < 2) continue;
    d += `M${r2(first.x)} ${r2(baseline)}`;
    for (const p of run) d += `L${r2(p.x)} ${r2(p.y)}`;
    d += `L${r2(last.x)} ${r2(baseline)}Z`;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------------------------

export interface BarMetrics {
  /** Distance between bar centres. */
  slot: number;
  /** Bar thickness. */
  width: number;
  /** x of the left edge of the first slot. */
  x0: number;
}

/** Bar thickness and spacing for `n` bars: a 2 px surface gap while bars stay at least 3 px thick. */
export function barMetrics(n: number, box: SparkBox): BarMetrics {
  const avail = box.width - box.padLeft - box.padRight;
  const count = Math.max(1, n);
  const slot = avail / count;
  const gap = slot - 2 >= 3 ? 2 : slot - 1 >= 2 ? 1 : 0;
  const width = Math.min(MAX_BAR, Math.max(1, slot - gap));
  return { slot, width, x0: box.padLeft };
}

/** Left edge of bar `i`: bars are centred in their slots. */
export function barX(i: number, m: BarMetrics): number {
  return m.x0 + i * m.slot + (m.slot - m.width) / 2;
}

/** Pixel rectangles for the bars (null where the sample is missing); `shift` slides them sideways. */
export function layoutBars(
  values: readonly Sample[],
  domain: Domain,
  box: SparkBox,
  metrics: BarMetrics = barMetrics(values.length, box),
  shift = 0,
): (BarRect | null)[] {
  const base = box.height - box.padBottom;
  // The baseline sits at zero when the domain spans it, otherwise at the nearest domain edge.
  const zeroY = clamp(yAt(0, domain, box), box.padTop, base);
  return values.map((v, i) => {
    if (!isNum(v)) return null;
    const vy = yAt(v, domain, box);
    const x = barX(i, metrics) + shift;
    if (v < 0) return { x, y: zeroY, w: metrics.width, h: Math.max(MIN_BAR, vy - zeroY), down: true };
    const top = Math.min(vy, zeroY - MIN_BAR);
    return { x, y: top, w: metrics.width, h: zeroY - top };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/** One closed path for a set of bars: the data end is rounded, the baseline end square. */
export function barsPath(rects: readonly (BarRect | null)[], radius = BAR_RADIUS): string {
  let d = '';
  for (const b of rects) {
    if (!b) continue;
    const r = Math.min(radius, b.w / 2, b.h);
    const x0 = r2(b.x);
    const x1 = r2(b.x + b.w);
    const top = r2(b.y);
    const bottom = r2(b.y + b.h);
    d += b.down
      ? `M${x0} ${top}V${r2(bottom - r)}Q${x0} ${bottom} ${r2(b.x + r)} ${bottom}H${r2(b.x + b.w - r)}Q${x1} ${bottom} ${x1} ${r2(bottom - r)}V${top}Z`
      : `M${x0} ${bottom}V${r2(top + r)}Q${x0} ${top} ${r2(b.x + r)} ${top}H${r2(b.x + b.w - r)}Q${x1} ${top} ${x1} ${r2(top + r)}V${bottom}Z`;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Frames: the static layout and the live-draw transition
// ---------------------------------------------------------------------------------------------

/** Everything needed to draw one moment of a sparkline. */
export interface SparkFrame {
  /** Line and area positions (empty for bars). */
  points: (SparkPoint | null)[];
  /** Bar rectangles (empty for line and area). */
  rects: (BarRect | null)[];
  /** The end dot, or null (bars have none; an empty series has none). */
  dot: SparkPoint | null;
  domain: Domain;
}

function lastFinite(points: readonly (SparkPoint | null)[]): SparkPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p) return p;
  }
  return null;
}

/** The settled frame for a series. */
export function staticFrame(
  values: readonly Sample[],
  form: SparkForm,
  box: SparkBox,
  override?: Domain,
): SparkFrame {
  const domain = resolveDomain(values, form, override);
  if (form === 'bars') {
    return { points: [], rects: layoutBars(values, domain, box), dot: null, domain };
  }
  const points = layoutPoints(values, domain, box);
  return { points, rects: [], dot: lastFinite(points), domain };
}

/** How `next` follows `prev`: `shift` (window slid by one), `grow` (one more sample), or null (anything else). */
export type SparkTransition = 'shift' | 'grow';

/** True when both series hold the same samples in the same order. */
export function sameSamples(a: readonly Sample[], b: readonly Sample[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Recognises the two live-append shapes: the caller dropped the oldest sample and added one
 * (`shift`), or only added one (`grow`). Anything else (a replaced series, several new samples)
 * redraws without animation.
 */
export function detectTransition(prev: readonly Sample[], next: readonly Sample[]): SparkTransition | null {
  if (prev.length === 0 || sameSamples(prev, next)) return null;
  if (next.length === prev.length + 1) {
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return null;
    return 'grow';
  }
  if (next.length === prev.length && next.length >= 2) {
    for (let i = 0; i < next.length - 1; i++) if (next[i] !== prev[i + 1]) return null;
    return 'shift';
  }
  return null;
}

export interface TransitionInput {
  kind: SparkTransition;
  prev: readonly Sample[];
  next: readonly Sample[];
  form: SparkForm;
  box: SparkBox;
  override?: Domain;
  /** Eased progress of the reveal and shift, 0..1 (420 ms). */
  reveal: number;
  /** Eased progress of the y domain, 0..1 (300 ms). */
  domain: number;
}

/**
 * One frame of the live draw (design 6.4 E). The new layout is the destination. The old samples
 * start where they were and slide to their new places, the new sample enters from just beyond the
 * right edge (the plot edge clips it, which is the reveal "from the last x to the new x"), the
 * oldest sample leaves past the left edge, and the y domain eases separately. The end dot stays at
 * the right edge and rides the line: its height is the line's height at that edge.
 */
export function transitionFrame(input: TransitionInput): SparkFrame {
  const { kind, prev, next, form, box, override } = input;
  const n = next.length;
  const domain = lerpDomain(
    resolveDomain(prev, form, override),
    resolveDomain(next, form, override),
    clamp01(input.domain),
  );
  const t = clamp01(input.reveal);

  if (form === 'bars') {
    const mNew = barMetrics(n, box);
    const mOld = barMetrics(prev.length, box);
    const rects = layoutBars(next, domain, box, mNew).map((r, i) => {
      if (!r) return null;
      const oldX = kind === 'shift' || i >= prev.length ? r.x + mNew.slot : barX(i, mOld);
      return { ...r, x: lerp(oldX, r.x, t) };
    });
    return { points: [], rects, dot: null, domain };
  }

  const settled = layoutPoints(next, domain, box);
  const slot = n > 1 ? xAt(1, n, box) - xAt(0, n, box) : 0;
  const points = settled.map((p, i) => {
    if (!p) return null;
    const oldX = kind === 'shift' || i >= prev.length ? p.x + slot : xAt(i, prev.length, box);
    return { x: lerp(oldX, p.x, t), y: p.y };
  });

  // The dot sits on the line at the right edge while the new sample slides in behind it.
  const edge = box.width - box.padRight;
  const last = points[n - 1];
  let dot: SparkPoint | null = null;
  if (last) {
    const before = points[n - 2];
    let y = last.y;
    if (before && last.x > before.x)
      y = lerp(before.y, last.y, clamp01((edge - before.x) / (last.x - before.x)));
    dot = { x: Math.min(last.x, edge), y: clamp(y, box.padTop, box.height - box.padBottom) };
  } else {
    dot = lastFinite(points);
  }
  return { points, rects: [], dot, domain };
}

/** Path data for a frame, ready for the SVG. */
export function framePaths(
  frame: SparkFrame,
  box: SparkBox,
): { line: string; area: string; bars: string; barLast: string } {
  const baseline = box.height;
  const rects = frame.rects;
  const lastIdx = (() => {
    for (let i = rects.length - 1; i >= 0; i--) if (rects[i]) return i;
    return -1;
  })();
  return {
    line: linePath(frame.points),
    area: areaPath(frame.points, baseline),
    bars: barsPath(rects.map((r, i) => (i === lastIdx ? null : r))),
    barLast: barsPath(rects.map((r, i) => (i === lastIdx ? r : null))),
  };
}

// ---------------------------------------------------------------------------------------------
// Accessible description
// ---------------------------------------------------------------------------------------------

export interface DescribeOptions {
  /** Formats a sample for the description (default three significant digits). */
  format?: (value: number) => string;
}

/**
 * The generated accessible name: `Trend over 12 samples, from 0.0718 to 0.0746, up 3.9 percent`.
 * A series that did not move reads `flat at ...`; missing samples are counted; nothing to draw
 * reads `No data`.
 */
export function describeSeries(values: readonly Sample[], opts: DescribeOptions = {}): string {
  const f = opts.format ?? formatSample;
  const finite = values.filter(isNum);
  if (finite.length === 0) return 'No data';
  const first = finite[0] as number;
  const last = finite[finite.length - 1] as number;
  const missing = values.length - finite.length;
  const tail = missing > 0 ? `, ${missing} missing` : '';
  if (finite.length === 1) return `One sample: ${f(first)}${tail}`;
  const base = `Trend over ${finite.length} samples`;
  const change = last - first;
  const rel = first !== 0 ? change / Math.abs(first) : null;
  if (change === 0 || (rel !== null && Math.abs(rel) < 0.0005)) return `${base}, flat at ${f(last)}${tail}`;
  const dir = change > 0 ? 'up' : 'down';
  const pct = rel === null ? '' : ` ${(Math.abs(rel) * 100).toFixed(1)} percent`;
  return `${base}, from ${f(first)} to ${f(last)}, ${dir}${pct}${tail}`;
}

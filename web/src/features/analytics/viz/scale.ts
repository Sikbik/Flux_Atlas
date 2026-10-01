// Scales, ticks and paths for the SVG charts. Pure functions, no DOM, no React.

export interface Linear {
  (v: number): number;
  invert(px: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): Linear {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))) as Linear;
  f.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  f.domain = domain;
  f.range = range;
  return f;
}

/** The "nice number" of Heckbert: a round value close to `range`. */
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export interface NiceTicks {
  ticks: number[];
  min: number;
  max: number;
  step: number;
}

/** Round tick values covering [min, max] with about `target` intervals. */
export function niceTicks(min: number, max: number, target = 5): NiceTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0], min: 0, max: 1, step: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, target), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Round to the step's precision so 0.1 + 0.2 does not leak into labels.
  const prec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(prec)));
  return { ticks, min: lo, max: hi, step };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEPS = [
  MIN,
  5 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
];

export interface TimeTick {
  t: number;
  label: string;
  /** A boundary worth emphasising (midnight, month or year start). */
  major: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function dayLabel(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Calendar ticks (UTC) between `t0` and `t1`: clock times under a day, dates, months, years. */
export function timeTicks(t0: number, t1: number, maxTicks = 6): TimeTick[] {
  if (!(t1 > t0)) return [];
  const span = t1 - t0;
  const want = Math.max(2, maxTicks);
  // Calendar steps (UTC month starts) once the span reaches `want` months.
  const months = span / (30.4375 * DAY);
  if (months >= want) {
    const years = span / (365.25 * DAY);
    let stepMonths: number;
    if (years >= want * 0.8) stepMonths = 12 * Math.ceil(years / want);
    else stepMonths = months / want > 3 ? 6 : months / want > 2 ? 3 : months / want > 1 ? 2 : 1;
    const out: TimeTick[] = [];
    const start = new Date(t0);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    for (let guard = 0; guard < 600; guard++) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      if (t >= t0 && (y * 12 + m) % stepMonths === 0) {
        out.push({ t, label: m === 0 || stepMonths >= 12 ? String(y) : MONTHS[m]!, major: m === 0 });
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }
  const step = STEPS.find((s) => span / s <= want) ?? STEPS.at(-1)!;
  const first = Math.ceil(t0 / step) * step;
  const out: TimeTick[] = [];
  for (let t = first; t <= t1; t += step) {
    const d = new Date(t);
    const midnight = t % DAY === 0;
    let label: string;
    if (step >= DAY) label = dayLabel(t);
    else if (midnight) label = dayLabel(t);
    else label = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    out.push({ t, label, major: midnight });
  }
  return out;
}

const SUFFIX = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
];

/**
 * Axis labels that carry exactly the precision the tick step needs: with a 10,000 step around ten
 * million the labels read 10.16M, 10.17M, 10.18M (not three times "10.2M").
 */
export function compactTickAt(v: number, step: number): string {
  const safeStep = step > 0 ? step : Math.abs(v) || 1;
  const a = Math.max(Math.abs(v), safeStep);
  for (const { v: base, s } of SUFFIX) {
    if (a >= base) {
      const unitStep = safeStep / base;
      let d = 0;
      while (d < 4 && Math.abs(unitStep * 10 ** d - Math.round(unitStep * 10 ** d)) > 1e-6) d++;
      return `${(v / base).toFixed(d)}${s}`;
    }
  }
  let d = 0;
  while (d < 4 && Math.abs(safeStep * 10 ** d - Math.round(safeStep * 10 ** d)) > 1e-6) d++;
  return v.toFixed(d);
}

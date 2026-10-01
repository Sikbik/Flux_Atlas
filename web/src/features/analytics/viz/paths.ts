// SVG path data for the line charts. A value that is not known lifts the pen: a gap stays a gap, it is
// never drawn through. Pure functions, no DOM, no React.

/** Two decimals keep the strings short and stable. */
const n = (v: number): string => String(Math.round(v * 100) / 100);

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The stretches of consecutive known values, as inclusive `[first, last]` index pairs. */
export function runs(ys: readonly (number | null | undefined)[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= ys.length; i++) {
    if (known(ys[i])) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/** Indices of a known value with no known neighbour: a line cannot draw it, so a dot stands for it. */
export function isolated(ys: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const [a, b] of runs(ys)) if (a === b && ys.length > 1) out.push(a);
  return out;
}

/** A polyline through `(xs[i], ys[i])`, one subpath per run of known values (a lone value draws nothing). */
export function linePath(xs: readonly number[], ys: readonly (number | null | undefined)[]): string {
  let d = '';
  for (const [a, b] of runs(ys)) {
    if (a === b) continue;
    for (let i = a; i <= b; i++) d += `${i === a ? 'M' : 'L'}${n(xs[i]!)} ${n(ys[i] as number)}`;
  }
  return d;
}

/** The same runs closed down to `baseline`, for the wash under a line. */
export function areaPath(
  xs: readonly number[],
  ys: readonly (number | null | undefined)[],
  baseline: number,
): string {
  let d = '';
  for (const [a, b] of runs(ys)) {
    if (a === b) continue;
    for (let i = a; i <= b; i++) d += `${i === a ? 'M' : 'L'}${n(xs[i]!)} ${n(ys[i] as number)}`;
    d += `L${n(xs[b]!)} ${n(baseline)}L${n(xs[a]!)} ${n(baseline)}Z`;
  }
  return d;
}

/** The space between two lines wherever both are known: along the upper edge, back along the lower. */
export function bandPath(
  xs: readonly number[],
  lower: readonly (number | null | undefined)[],
  upper: readonly (number | null | undefined)[],
): string {
  const both = xs.map((_, i) => (known(lower[i]) && known(upper[i]) ? 1 : null));
  let d = '';
  for (const [a, b] of runs(both)) {
    if (a === b) continue;
    for (let i = a; i <= b; i++) d += `${i === a ? 'M' : 'L'}${n(xs[i]!)} ${n(upper[i] as number)}`;
    for (let i = b; i >= a; i--) d += `L${n(xs[i]!)} ${n(lower[i] as number)}`;
    d += 'Z';
  }
  return d;
}

/** A polyline through corners, as for a step line (corners at one x make the vertical jump). */
export function cornersPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join('');
}

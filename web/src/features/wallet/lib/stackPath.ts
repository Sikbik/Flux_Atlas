// Paths for the projection's areas: a running total (a line through the end of each day, from zero at the start) or a
// daily rate (steps, one level a day), and the area between two such lines. Pure functions over pixel coordinates.

export interface Pt {
  x: number;
  y: number;
}

export type SeriesShape = 'running' | 'steps';

/**
 * The points of a series of `values` over days that begin at `dayStarts` (unix ms) and last `dayMs`.
 * `running` goes through the end of each day and starts at zero where the first day starts; `steps` holds each
 * day's level across the whole day, so a change of rate is a vertical step at midnight.
 */
export function seriesPoints(
  shape: SeriesShape,
  dayStarts: readonly number[],
  values: readonly number[],
  x: (ms: number) => number,
  y: (v: number) => number,
  dayMs = 86_400_000,
): Pt[] {
  const out: Pt[] = [];
  if (dayStarts.length === 0) return out;
  if (shape === 'running') {
    out.push({ x: x(dayStarts[0] as number), y: y(0) });
    for (let i = 0; i < dayStarts.length; i++) {
      out.push({ x: x((dayStarts[i] as number) + dayMs), y: y(values[i] as number) });
    }
    return out;
  }
  dayStarts.forEach((t, i) => {
    const level = y(values[i] as number);
    out.push({ x: x(t), y: level }, { x: x(t + dayMs), y: level });
  });
  return out;
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

/** `M x y L x y ...` through the points. */
export function linePath(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
}

/**
 * The closed outline between an upper line and a lower one (the same x positions, in the same order), or between the
 * upper line and the horizontal `baseY` when there is no lower line.
 */
export function areaPath(upper: readonly Pt[], lower: readonly Pt[] | null, baseY: number): string {
  if (upper.length === 0) return '';
  const head = linePath(upper);
  if (lower && lower.length > 0) {
    const back = [...lower]
      .reverse()
      .map((p) => `L${f(p.x)} ${f(p.y)}`)
      .join('');
    return `${head}${back}Z`;
  }
  const last = upper[upper.length - 1] as Pt;
  const first = upper[0] as Pt;
  return `${head}L${f(last.x)} ${f(baseY)}L${f(first.x)} ${f(baseY)}Z`;
}

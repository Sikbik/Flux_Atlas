import { useId, useMemo } from 'react';
import { areaPath, extent, linear, linePath } from './scale';
import './viz.css';

export interface SparklineProps {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill a gradient under the line. */
  fill?: boolean;
  /** Fit the data (default) or anchor the axis at zero. */
  zero?: boolean;
  /** The last point follows a live value: its dot breathes. */
  live?: boolean;
  /** Pass a label to make the sparkline a named image; otherwise it is decoration. */
  label?: string;
}

/** A tiny trend line with a ringed end dot. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = 'var(--viz-1)',
  fill = true,
  zero = false,
  live = false,
  label,
}: SparklineProps) {
  const gid = useId();
  const geo = useMemo(() => {
    const ex = extent(values);
    if (!ex || values.length < 2) return null;
    const pad = 4;
    let [lo, hi] = ex;
    if (zero) lo = Math.min(0, lo);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const x = linear([0, values.length - 1], [pad, width - pad]);
    const y = linear([lo, hi], [height - pad, pad]);
    const xs = values.map((_, i) => x(i));
    const ys = values.map((v) => (v === null ? null : y(v)));
    let li = values.length - 1;
    while (li > 0 && values[li] === null) li--;
    return { xs, ys, end: { x: xs[li]!, y: ys[li]! } };
  }, [values, width, height, zero]);
  return (
    <svg
      className="vz-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ ['--c' as string]: color }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {geo ? (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.32" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill ? <path d={areaPath(geo.xs, geo.ys, height - 2)} fill={`url(#${gid})`} /> : null}
          <path className="line" d={linePath(geo.xs, geo.ys)} />
          {geo.end.y !== null ? (
            <circle cx={geo.end.x} cy={geo.end.y} r="3.2" data-live={live || undefined} />
          ) : null}
        </>
      ) : (
        <line
          x1="2"
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--line-2)"
          strokeDasharray="2 3"
        />
      )}
    </svg>
  );
}

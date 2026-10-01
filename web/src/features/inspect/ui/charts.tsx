import type { CSSProperties } from 'react';

/**
 * A sparkline: a 1.6 px round-joined line, an end dot ringed in the surface colour and an optional
 * 12 percent area, in the first data series colour. A flat series draws as a flat line; no data draws
 * as a dashed baseline.
 */
export function Spark({
  values,
  w = 64,
  h = 26,
  color = 'var(--viz-1)',
  area,
  label,
}: {
  values: readonly number[];
  w?: number;
  h?: number;
  color?: string;
  area?: boolean;
  label?: string;
}) {
  if (values.length < 2) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? 'No data'}>
        <line
          x1="3"
          x2={w - 3}
          y1={h - 4}
          y2={h - 4}
          stroke="var(--line-3)"
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const range = mx - mn || 1;
  const n = values.length;
  const pts = values.map(
    (v, i) => [(i / (n - 1)) * (w - 8) + 4, h - 4 - ((v - mn) / range) * (h - 9)] as const,
  );
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[n - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" role="img" aria-label={label ?? 'Trend'}>
      {area ? (
        <path
          d={`${d} L${last[0]} ${h} L${pts[0]![0]} ${h} Z`}
          fill={color}
          opacity="var(--viz-area-alpha, 0.12)"
        />
      ) : null}
      <path d={d} stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.2" fill={color} stroke="var(--ink-1)" strokeWidth="2" />
    </svg>
  );
}

/**
 * Bars with a rounded data end and a square baseline. Heights are scaled to the largest value; the
 * newest bars can be marked hot. Heights are transforms, so a live update glides instead of jumping.
 */
export function MiniBars({
  values,
  h = 26,
  gap = 1.5,
  color = 'var(--tier, var(--viz-1))',
  hot = 0,
  label,
}: {
  /** `null` marks a day that was not observed (drawn as a faint dot, never as zero). */
  values: ReadonlyArray<number | null>;
  h?: number;
  gap?: number;
  color?: string;
  /** How many of the newest bars wear the hot colour. */
  hot?: number;
  label?: string;
}) {
  const mx = Math.max(1e-9, ...values.map((v) => v ?? 0));
  return (
    <span
      className="ix-bars"
      role="img"
      aria-label={label ?? 'Bar chart'}
      style={{ height: h, gap, display: 'flex', alignItems: 'flex-end', width: '100%' } as CSSProperties}
    >
      {values.map((v, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional (one per day)
          key={i}
          style={{
            flex: 1,
            height: '100%',
            borderRadius: '2px 2px 1px 1px',
            background: v === null ? 'var(--line-3)' : i >= values.length - hot ? 'var(--hot)' : color,
            opacity: v === null ? 0.5 : v === 0 ? 0.22 : 0.9,
            transformOrigin: 'bottom',
            transform: `scaleY(${v === null || v === 0 ? 0.05 : Math.max(0.08, v / mx)})`,
            transition: 'transform var(--dur-slow) var(--ease-out-expo)',
          }}
        />
      ))}
    </span>
  );
}

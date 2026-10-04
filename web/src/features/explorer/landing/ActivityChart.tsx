// One chain figure over time, on the plot the wallet's charts stand on: a bar a day in a short range, an area and a line
// in a long one, a log scale when the series spans orders of magnitude, the day still running drawn lighter or dashed (it
// is not a whole day), and a marker where Proof of Node began. Read it with the pointer or the arrow keys; "Show data"
// lists the same numbers as text.

import { type CSSProperties, type ReactNode, useCallback, useMemo } from 'react';
import { areaPath, linePath } from '../../analytics/viz/paths';
import { type Axis, roundedTop } from '../../wallet/lib/plotAxis';
import { LegendKey, Plot, type PlotGeo, type PlotTip } from '../../wallet/viz/Plot';
import type { DailyRange } from './api';
import {
  completeValues,
  DAY_MS,
  dayStamp,
  linearAxisFor,
  logAxisFor,
  logTickText,
  METRICS,
  PON_ACTIVATION_MS,
  pointLabel,
  type SeriesFrame,
  summaryOf,
} from './lib/daily';

/** A range with at most this many points is drawn as bars; a longer one as an area. */
const BAR_MAX = 120;

const COLOR = 'var(--viz-1)';
const color: CSSProperties = { '--c': COLOR } as CSSProperties;

export interface ActivityChartProps {
  frame: SeriesFrame;
  scale: 'linear' | 'log';
  range: DailyRange;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function ActivityChart({ frame, scale, range }: ActivityChartProps) {
  const info = METRICS[frame.metric];
  const { t, v, span, running, trimmed } = frame;
  const n = t.length;
  const dayMs = span * DAY_MS;
  const log = scale === 'log';

  // The values as they are drawn: a power of ten on a log scale, where a day with none has no place and is a gap.
  const y = useMemo(
    () => v.map((x) => (x === null ? null : log ? (x > 0 ? Math.log10(x) : null) : x)),
    [v, log],
  );
  const axis = useMemo<Axis>(() => {
    if (!log) return linearAxisFor(frame);
    const a = logAxisFor(completeValues(frame));
    return { lo: a.lo, hi: a.hi, ticks: a.ticks, step: a.step };
  }, [frame, log]);
  const formatTick = useCallback(
    (value: number, step: number) => (log ? logTickText(value) : value === 0 ? '0' : info.tick(value, step)),
    [log, info],
  );

  const domain = useMemo<readonly [number, number]>(
    () => (n === 0 ? [0, DAY_MS] : [t[0] as number, (t[n - 1] as number) + dayMs]),
    [t, n, dayMs],
  );
  const centers = useMemo(() => t.map((x) => x + dayMs / 2), [t, dayMs]);
  const bars = n <= BAR_MAX;
  const pon = PON_ACTIVATION_MS > domain[0] && PON_ACTIVATION_MS < domain[1] ? PON_ACTIVATION_MS : null;

  const marks = useMemo(
    () => (geo: PlotGeo) => {
      if (n === 0) return null;
      const base = geo.y(axis.lo);
      const at = (x: number) => geo.y(clamp(x, axis.lo, axis.hi));
      let body: ReactNode;
      if (bars) {
        const slot = geo.plot.w / n;
        const bw = Math.max(2, slot * 0.72);
        const r = Math.min(2.5, bw / 3);
        body = t.map((tm, i) => {
          const val = y[i];
          if (val === null || val === undefined) return null;
          const top = at(val);
          const h = base - top;
          if (h < 0.5) return null;
          return (
            <path
              key={tm}
              className="wl-bar"
              d={roundedTop(geo.x(tm) + (slot - bw) / 2, top, bw, h, r)}
              style={color}
              data-running={(running && i === n - 1) || undefined}
            />
          );
        });
      } else {
        const xs = centers.map((c) => geo.x(c));
        const ys = y.map((val) => (val === null || val === undefined ? null : at(val)));
        const whole = running ? ys.map((p, i) => (i === n - 1 ? null : p)) : ys;
        const last = ys[n - 1];
        const prev = ys[n - 2];
        body = (
          <>
            <path className="wl-area" d={areaPath(xs, whole, base)} style={color} />
            <path className="wl-line" d={linePath(xs, whole)} style={color} />
            {running && last !== null && last !== undefined && prev !== null && prev !== undefined ? (
              <path
                className="wl-line"
                data-dashed
                d={`M${xs[n - 2]} ${prev}L${xs[n - 1]} ${last}`}
                style={color}
              />
            ) : null}
            {last !== null && last !== undefined ? (
              <circle
                className="wl-end"
                cx={xs[n - 1]}
                cy={last}
                r={running ? 3.5 : 4}
                style={
                  running
                    ? ({ ...color, fill: 'var(--ink-1)', stroke: COLOR, strokeWidth: 1.5 } as CSSProperties)
                    : color
                }
              />
            ) : null}
          </>
        );
      }
      const px = pon === null ? 0 : geo.x(pon);
      const flip = px > geo.plot.x + geo.plot.w - 110;
      return (
        <>
          {pon !== null ? (
            <g className="wl-mark">
              <line x1={px} x2={px} y1={geo.plot.y} y2={geo.plot.y + geo.plot.h} />
              <text x={flip ? px - 6 : px + 6} y={geo.plot.y + 12} textAnchor={flip ? 'end' : 'start'}>
                Proof of Node
              </text>
            </g>
          ) : null}
          {body}
        </>
      );
    },
    [n, axis, bars, t, y, centers, running, pon],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => ({
      x: centers.map((c) => geo.x(c)),
      y: y.map((val) => (val === null || val === undefined ? null : geo.y(clamp(val, axis.lo, axis.hi)))),
    }),
    [centers, y, axis],
  );

  const text = useCallback(
    (i: number): string => {
      const x = v[i];
      if (x === null || x === undefined) return 'Unknown';
      return `${info.value(x)}${info.unit ? ` ${info.unit}` : ''}`;
    },
    [v, info],
  );

  const tip = useCallback(
    (i: number): PlotTip => ({
      head: pointLabel(frame, i),
      aside: running && i === n - 1 ? 'today so far' : span > 1 ? 'mean of a day' : undefined,
      rows: [{ label: info.title, value: text(i), color: COLOR, dashed: running && i === n - 1 }],
    }),
    [frame, running, n, span, info, text],
  );

  const reading = useCallback(
    (i: number) => `${pointLabel(frame, i)}: ${text(i)}${running && i === n - 1 ? ', today so far' : ''}`,
    [frame, text, running, n],
  );

  const row = useCallback(
    (i: number): readonly string[] => [
      span > 1 ? `Week of ${dayStamp(t[i] as number)}` : dayStamp(t[i] as number),
      text(i),
    ],
    [t, span, text],
  );
  const table = useMemo(
    () => ({
      head: ['Date (UTC)', info.unit ? `${info.title} (${info.unit})` : info.title] as readonly string[],
      row,
    }),
    [info, row],
  );

  const note = [
    frame.trimmed ? 'Drawn as the mean of each week; the day still running is left out.' : '',
    log ? 'Log scale: each gridline is ten times the one below it.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Plot
      kind={`chain-${frame.metric}`}
      title={info.title}
      summary={summaryOf(frame, scale, range)}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={formatTick}
      height={252}
      tickSpace={n > 200 ? 120 : undefined}
      marks={marks}
      track={track}
      anchor={(i) => {
        const val = y[i];
        return val === null || val === undefined ? null : val;
      }}
      dotColor={COLOR}
      tip={tip}
      reading={reading}
      table={table}
      revealKey={`${frame.metric}:${range}:${scale}`}
      legend={
        <ul className="cp-legend" aria-label="Series">
          <LegendKey label={info.title} color={COLOR} />
          {running && !trimmed ? <LegendKey label="Today so far" color={COLOR} dashed /> : null}
        </ul>
      }
      note={note || undefined}
    />
  );
}

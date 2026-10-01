// An interactive time chart in plain SVG: lines, step lines and stacked areas over a UTC time axis.
//
// - Hover (or arrow keys on the focused plot) snaps a crosshair to the nearest point and lists every
//   series in one tooltip; values lead, names follow.
// - A selected series (a filter chosen by clicking the band, the line or its legend entry) stays
//   bright while the rest dim: the caller keeps the selection in the URL, so the globe follows.
// - Every chart has a "Show data" table twin. Tooltips enhance; they never gate.
// - Marks are thin (2 px lines), areas are washes, grid lines are solid hairlines, dots carry a
//   surface ring, and text never wears a series colour (design 5.6, dataviz marks spec).

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { formatInt, formatUtcDateTime } from '../../../lib/format';
import {
  areaPath,
  compactTickAt,
  extent,
  linear,
  linePath,
  nearestIndex,
  niceTicks,
  stack,
  timeTicks,
} from './scale';
import { useSize } from './useSize';
import './viz.css';

export interface ChartSeries {
  key: string;
  label: string;
  /** Any CSS colour, normally a token such as `var(--tier-stratus-ink)`. */
  color: string;
  values: readonly (number | null)[];
  /** Fill under a line (line and step modes). Stacked mode always fills. */
  fill?: boolean;
  width?: number;
  dashed?: boolean;
}

export interface ChartMark {
  kind: 'v' | 'h';
  /** x (unix ms) for a vertical mark, y (value) for a horizontal one. */
  at: number;
  label: string;
  tone?: 'muted' | 'accent' | 'warn';
}

export interface TimeChartProps {
  /** Accessible name and the figure's title for assistive technology. */
  title: string;
  /** One sentence describing what the chart shows. */
  summary?: string;
  t: readonly number[];
  series: readonly ChartSeries[];
  mode?: 'line' | 'step' | 'stack';
  /** Height of the whole chart including the x axis band. */
  height?: number;
  /** `0` anchors the axis at zero; `'auto'` fits the data with padding. Stacked defaults to 0. */
  yMin?: number | 'auto';
  yMax?: number;
  yFormat?: (v: number) => string;
  yTickFormat?: (v: number, step: number) => string;
  xFormat?: (t: number) => string;
  marks?: readonly ChartMark[];
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  /** A sentence for the tooltip footer when clicking selects: "Click to show these nodes on the globe". */
  selectHint?: string;
  legend?: boolean;
  /** Show the sum of a stack in the tooltip. */
  showTotal?: boolean;
  /** Hold the previous render at reduced opacity while a refetch runs. */
  stale?: boolean;
  /** The last point follows a live value: its dot breathes. */
  live?: boolean;
  /** Name for the table's unit column header, for example "nodes". */
  unit?: string;
}

const M = { left: 48, right: 14, top: 10, bottom: 26 };
const DIM = 0.22;

export function TimeChart(props: TimeChartProps) {
  const {
    title,
    summary,
    t,
    series,
    mode = 'line',
    height = 240,
    yFormat = (v: number) => formatInt(Math.round(v)),
    yTickFormat = compactTickAt,
    xFormat = (x: number) => formatUtcDateTime(x),
    marks = [],
    selected = null,
    onSelect,
    selectHint,
    stale = false,
    live = false,
    unit = '',
  } = props;
  const showLegend = props.legend ?? series.length > 1;
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrapRef);
  const clipId = useId();
  const [hover, setHover] = useState<{ i: number; py: number } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [focused, setFocused] = useState(false);
  const n = t.length;
  const stacked = mode === 'stack';

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = Math.max(10, height - M.top - M.bottom);

  const geo = useMemo(() => {
    if (width <= 0 || n === 0) return null;
    const t0 = t[0]!;
    const t1 = t[n - 1]!;
    const x = linear([t0, t1 === t0 ? t0 + 1 : t1], [M.left, M.left + plotW]);
    // Y domain.
    let lo: number;
    let hi: number;
    let tops: (number | null)[][] = [];
    let bottoms: (number | null)[][] = [];
    if (stacked) {
      const st = stack(series.map((s) => s.values));
      tops = st.tops;
      bottoms = st.bottoms;
      const ex = extent(...tops);
      lo = 0;
      hi = ex ? ex[1] : 1;
    } else {
      const ex = extent(...series.map((s) => s.values));
      lo = ex ? ex[0] : 0;
      hi = ex ? ex[1] : 1;
    }
    for (const m of marks) if (m.kind === 'h') hi = Math.max(hi, m.at);
    const yMin = props.yMin ?? (stacked ? 0 : 'auto');
    if (typeof yMin === 'number') lo = yMin;
    else if (!stacked) {
      const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.02 || 1;
      lo -= pad;
      hi += pad;
    }
    if (props.yMax !== undefined) hi = props.yMax;
    const ticks = niceTicks(lo, hi, Math.max(2, Math.round(plotH / 52)));
    const yDomain: [number, number] = [
      typeof yMin === 'number' ? Math.min(yMin, ticks.min) : ticks.min,
      ticks.max,
    ];
    const y = linear(yDomain, [M.top + plotH, M.top]);
    const xs = t.map((v) => x(v));
    return {
      x,
      y,
      xs,
      ticks: ticks.ticks.filter((v) => v >= yDomain[0] - 1e-9 && v <= yDomain[1] + 1e-9),
      tickStep: ticks.step,
      tops,
      bottoms,
      t0,
      t1,
    };
  }, [width, n, t, series, stacked, marks, plotW, plotH, props.yMin, props.yMax]);

  const paths = useMemo(() => {
    if (!geo) return null;
    const { xs, y, tops, bottoms } = geo;
    return series.map((s, k) => {
      if (stacked) {
        const top = tops[k]!.map((v) => (v === null ? null : y(v)));
        const bot = bottoms[k]!.map((v) => (v === null ? null : y(v)));
        return { area: areaPath(xs, top, bot), line: linePath(xs, top) };
      }
      const ys = s.values.map((v) => (v === null ? null : y(v)));
      const step = mode === 'step';
      return {
        area: s.fill ? areaPath(xs, ys, y(geo.y.domain[0]), { step }) : '',
        line: linePath(xs, ys, { step }),
      };
    });
  }, [geo, series, stacked, mode]);

  const xTicks = useMemo(
    () => (geo ? timeTicks(geo.t0, geo.t1, Math.max(2, Math.floor(plotW / 96))) : []),
    [geo, plotW],
  );

  // The last known point of each series, for the end dot.
  const ends = useMemo(() => {
    if (!geo) return [];
    return series.map((s, k) => {
      for (let i = n - 1; i >= 0; i--) {
        const v = stacked ? geo.tops[k]![i] : s.values[i];
        if (v !== null && v !== undefined) return { i, x: geo.xs[i]!, y: geo.y(v) };
      }
      return null;
    });
  }, [geo, series, n, stacked]);

  const move = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el || !geo) return;
      const r = el.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      const i = nearestIndex(geo.xs, px);
      setHover((h) => (h && h.i === i && Math.abs(h.py - py) < 2 ? h : { i, py }));
    },
    [geo],
  );

  // Which series the pointer is on at the hovered x: the stack band under it, or the nearest line.
  const hoverKey = useMemo(() => {
    if (!hover || !geo) return null;
    const { i, py } = hover;
    if (stacked) {
      const v = geo.y.invert(py);
      for (let k = series.length - 1; k >= 0; k--) {
        const b = geo.bottoms[k]![i];
        const tp = geo.tops[k]![i];
        if (b !== null && b !== undefined && tp !== null && tp !== undefined && v >= b && v <= tp)
          return series[k]!.key;
      }
      return null;
    }
    let best: string | null = null;
    let bestD = 28; // px: farther than this is "no series"
    series.forEach((s) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const d = Math.abs(geo.y(v) - py);
      if (d < bestD) {
        bestD = d;
        best = s.key;
      }
    });
    return best;
  }, [hover, geo, series, stacked]);

  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const cur = hover?.i ?? n - 1;
    let next = cur;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - big);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + big);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') {
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    setHover({ i: next, py: -1 });
  };

  const idx = hover?.i ?? -1;
  const valueText =
    idx >= 0
      ? `${xFormat(t[idx]!)}: ${series.map((s) => `${s.label} ${s.values[idx] === null || s.values[idx] === undefined ? 'unknown' : yFormat(s.values[idx]!)}`).join(', ')}`
      : `${title}`;

  const dim = (key: string) => (selected && selected !== key ? DIM : 1);
  const lastIdx = n - 1;
  const tipLeft = geo && idx >= 0 ? geo.xs[idx]! : 0;
  const tipOnLeft = tipLeft > width * 0.58;

  return (
    <figure className="vz-fig" data-stale={stale || undefined} aria-label={title}>
      {showLegend ? (
        <ul className="vz-legend" aria-label={`${title}: series`}>
          {series.map((s) => {
            const last = (() => {
              for (let i = n - 1; i >= 0; i--)
                if (s.values[i] !== null && s.values[i] !== undefined) return s.values[i]!;
              return null;
            })();
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className="vz-legend-item"
                  data-active={selected === s.key || undefined}
                  data-dim={(selected && selected !== s.key) || undefined}
                  aria-pressed={onSelect ? selected === s.key : undefined}
                  disabled={!onSelect}
                  onClick={() => onSelect?.(selected === s.key ? null : s.key)}
                >
                  <span className="vz-key" style={{ ['--c' as string]: s.color }} aria-hidden="true" />
                  <span className="vz-legend-name">{s.label}</span>
                  <span className="vz-legend-val tabular">{last === null ? 'Unknown' : yFormat(last)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="vz-chart" ref={wrapRef} style={{ height }}>
        {geo && paths ? (
          <>
            <svg
              className="vz-svg"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={M.left} y={M.top - 2} width={plotW} height={plotH + 4} />
                </clipPath>
              </defs>
              {/* grid and y labels */}
              <g className="vz-grid">
                {geo.ticks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + plotW} y1={geo.y(v)} y2={geo.y(v)} />
                    <text x={M.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end">
                      {yTickFormat(v, geo.tickStep)}
                    </text>
                  </g>
                ))}
              </g>
              {/* x labels */}
              <g className="vz-xaxis">
                {xTicks.map((tk) => (
                  <g key={tk.t} data-major={tk.major || undefined}>
                    <line x1={geo.x(tk.t)} x2={geo.x(tk.t)} y1={M.top + plotH} y2={M.top + plotH + 4} />
                    <text x={geo.x(tk.t)} y={M.top + plotH + 17} textAnchor="middle">
                      {tk.label}
                    </text>
                  </g>
                ))}
              </g>
              {/* data */}
              <g clipPath={`url(#${clipId})`} className="vz-data">
                {series.map((s, k) => (
                  <g key={s.key} style={{ opacity: dim(s.key) }} className="vz-series" data-key={s.key}>
                    {paths[k]!.area ? (
                      <path
                        className="vz-area"
                        d={paths[k]!.area}
                        style={{ fill: s.color, fillOpacity: stacked ? 0.3 : 'var(--viz-area-alpha)' }}
                      />
                    ) : null}
                    <path
                      className="vz-line"
                      d={paths[k]!.line}
                      style={{
                        stroke: s.color,
                        strokeWidth: s.width ?? 2,
                        strokeDasharray: s.dashed ? '2 5' : undefined,
                      }}
                    />
                  </g>
                ))}
              </g>
              {/* marks */}
              <g className="vz-marks">
                {marks.map((m) => {
                  if (m.kind === 'v') {
                    const mx = geo.x(m.at);
                    if (mx < M.left || mx > M.left + plotW) return null;
                    const flip = mx > M.left + plotW * 0.7;
                    return (
                      <g key={`v${m.at}${m.label}`} data-tone={m.tone ?? 'muted'}>
                        <line x1={mx} x2={mx} y1={M.top} y2={M.top + plotH} />
                        <text x={mx + (flip ? -6 : 6)} y={M.top + 11} textAnchor={flip ? 'end' : 'start'}>
                          {m.label}
                        </text>
                      </g>
                    );
                  }
                  const my = geo.y(m.at);
                  if (my < M.top || my > M.top + plotH) return null;
                  return (
                    <g key={`h${m.at}${m.label}`} data-tone={m.tone ?? 'muted'}>
                      <line x1={M.left} x2={M.left + plotW} y1={my} y2={my} />
                      <text x={M.left + 6} y={my - 6}>
                        {m.label}
                      </text>
                    </g>
                  );
                })}
              </g>
              {/* end dots */}
              <g className="vz-ends">
                {series.map((s, k) => {
                  const e = ends[k];
                  if (!e || idx >= 0) return null;
                  return (
                    <g key={s.key} style={{ opacity: dim(s.key) }} transform={`translate(${e.x} ${e.y})`}>
                      {live && e.i === lastIdx ? (
                        <circle className="vz-pulse" r="4" style={{ stroke: s.color }} />
                      ) : null}
                      <circle className="vz-dot" r="4" style={{ fill: s.color }} />
                    </g>
                  );
                })}
              </g>
              {/* hover layer */}
              {idx >= 0 ? (
                <g className="vz-hover">
                  <line
                    className="vz-cross"
                    x1={geo.xs[idx]}
                    x2={geo.xs[idx]}
                    y1={M.top}
                    y2={M.top + plotH}
                  />
                  {series.map((s, k) => {
                    const v = stacked ? geo.tops[k]![idx] : s.values[idx];
                    if (v === null || v === undefined) return null;
                    return (
                      <circle
                        key={s.key}
                        className="vz-dot"
                        cx={geo.xs[idx]}
                        cy={geo.y(v)}
                        r={hoverKey === s.key ? 5 : 4}
                        style={{ fill: s.color, opacity: dim(s.key) }}
                      />
                    );
                  })}
                </g>
              ) : null}
            </svg>

            {/* The focusable, pointer-aware plot: a slider over the points. */}
            <div
              className="vz-overlay"
              role="slider"
              tabIndex={0}
              aria-label={`${title}. Use the arrow keys to read values.`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={Math.max(0, idx)}
              aria-valuetext={valueText}
              data-focused={focused || undefined}
              data-selectable={(onSelect && hoverKey) || undefined}
              style={{ left: M.left, top: M.top, width: plotW, height: plotH }}
              onPointerMove={(e) => move(e.clientX, e.clientY)}
              onPointerDown={(e) => move(e.clientX, e.clientY)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                setHover(null);
              }}
              onClick={() => {
                if (onSelect && hoverKey) onSelect(selected === hoverKey ? null : hoverKey);
              }}
            />

            {idx >= 0 ? (
              <div
                className="vz-tip"
                data-side={tipOnLeft ? 'left' : 'right'}
                style={{ left: tipLeft, top: M.top + 4 }}
                role="presentation"
              >
                <div className="vz-tip-head tabular">{xFormat(t[idx]!)}</div>
                <ul>
                  {series.map((s) => {
                    const raw = s.values[idx];
                    return (
                      <li
                        key={s.key}
                        data-hot={hoverKey === s.key || undefined}
                        data-dim={(selected && selected !== s.key) || undefined}
                      >
                        <span className="vz-key" style={{ ['--c' as string]: s.color }} aria-hidden="true" />
                        <strong className="vz-tip-val tabular">
                          {raw === null || raw === undefined ? 'Unknown' : yFormat(raw)}
                        </strong>
                        <span className="vz-tip-name">{s.label}</span>
                      </li>
                    );
                  })}
                  {props.showTotal && stacked ? (
                    <li className="vz-tip-total">
                      <span className="vz-key" aria-hidden="true" />
                      <strong className="vz-tip-val tabular">
                        {(() => {
                          const top = geo.tops[series.length - 1]![idx];
                          return top === null || top === undefined ? 'Unknown' : yFormat(top);
                        })()}
                      </strong>
                      <span className="vz-tip-name">Total</span>
                    </li>
                  ) : null}
                </ul>
                {onSelect && selectHint && hoverKey ? <div className="vz-tip-hint">{selectHint}</div> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="vz-empty" role="status">
            {n === 0 ? 'No data yet' : null}
          </div>
        )}
      </div>

      <figcaption className="vz-foot">
        {summary ? <span className="vz-summary">{summary}</span> : null}
        <button
          type="button"
          className="vz-toggle"
          aria-expanded={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Hide data' : 'Show data'}
        </button>
      </figcaption>

      {showTable ? (
        <DataTable t={t} series={series} yFormat={yFormat} xFormat={xFormat} unit={unit} caption={title} />
      ) : null}
    </figure>
  );
}

const TABLE_ROWS = 96;

function DataTable({
  t,
  series,
  yFormat,
  xFormat,
  unit,
  caption,
}: {
  t: readonly number[];
  series: readonly ChartSeries[];
  yFormat: (v: number) => string;
  xFormat: (t: number) => string;
  unit: string;
  caption: string;
}) {
  const rows = useMemo(() => {
    const n = t.length;
    if (n <= TABLE_ROWS) return t.map((_, i) => i);
    const out: number[] = [];
    for (let k = 0; k < TABLE_ROWS; k++) out.push(Math.round((k * (n - 1)) / (TABLE_ROWS - 1)));
    return out.reverse();
  }, [t]);
  const thinned = t.length > TABLE_ROWS;
  const order = thinned ? rows : [...rows].reverse();
  return (
    <div className="vz-table-wrap">
      <table className="vz-table">
        <caption>
          {caption}
          {thinned ? `. Showing ${rows.length} of ${t.length} points, newest first.` : '. Newest first.'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            {series.map((s) => (
              <th scope="col" key={s.key}>
                {s.label}
                {unit ? ` (${unit})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => (
            <tr key={t[i]}>
              <th scope="row" className="tabular">
                {xFormat(t[i]!)}
              </th>
              {series.map((s) => (
                <td key={s.key} className="tabular">
                  {s.values[i] === null || s.values[i] === undefined ? 'Unknown' : yFormat(s.values[i]!)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Signed change per time bucket as bars from a zero line: up in Flux blue, down in the warm pole. A
// bar is the net change inside its bucket, so growth and loss read at a glance. Like the time chart it
// has a crosshair tooltip, arrow keys on the focused plot, and a "Show data" table twin.

import { useCallback, useMemo, useRef, useState } from 'react';
import { formatUtcDateTime } from '../../../lib/format';
import { compactTickAt, linear, niceTicks, timeTicks } from './scale';
import { useSize } from './useSize';
import './viz.css';

export interface DeltaDetail {
  label: string;
  value: string;
  /** Any CSS colour for the key swatch. */
  color?: string;
}

export interface DeltaBarsProps {
  title: string;
  summary?: string;
  /** Start of each bucket, unix ms, ascending and evenly spaced by `stepMs`. */
  t: readonly number[];
  stepMs: number;
  /** Net change per bucket; null where unknown. */
  values: readonly (number | null)[];
  height?: number;
  unit?: string;
  /** Extra lines in the tooltip for one bucket (for example the change per tier). */
  detail?: (i: number) => readonly DeltaDetail[];
}

const M = { left: 48, right: 14, top: 10, bottom: 26 };

const signed = (v: number): string =>
  `${v > 0 ? '+' : v < 0 ? '-' : ''}${new Intl.NumberFormat('en-US').format(Math.abs(v))}`;

function roundedEnd(x: number, y0: number, y1: number, w: number, r: number): string {
  // A bar from the zero line y0 to y1; the far end (y1) is rounded, the zero end is square.
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  const rr = Math.min(r, w / 2, h);
  if (y1 < y0) {
    return `M${x} ${y0}V${y1 + rr}Q${x} ${y1} ${x + rr} ${y1}H${x + w - rr}Q${x + w} ${y1} ${x + w} ${y1 + rr}V${y0}Z`;
  }
  return `M${x} ${y0}V${y1 - rr}Q${x} ${y1} ${x + rr} ${y1}H${x + w - rr}Q${x + w} ${y1} ${x + w} ${y1 - rr}V${y0}Z`;
}

export function DeltaBars({
  title,
  summary,
  t,
  stepMs,
  values,
  height = 240,
  unit = '',
  detail,
}: DeltaBarsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrapRef);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const n = t.length;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = Math.max(10, height - M.top - M.bottom);

  const geo = useMemo(() => {
    if (width <= 0 || n === 0) return null;
    const known = values.filter((v): v is number => v !== null);
    const lo = Math.min(0, ...known);
    const hi = Math.max(0, ...known);
    const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi, Math.max(2, Math.round(plotH / 52)));
    const y = linear([Math.min(lo, ticks.min), ticks.max], [M.top + plotH, M.top]);
    const t0 = t[0]!;
    const span = n * stepMs;
    const x = linear([t0, t0 + span], [M.left, M.left + plotW]);
    const band = plotW / n;
    return { y, x, band, ticks: ticks.ticks, step: ticks.step, t0, span };
  }, [width, n, t, values, stepMs, plotW, plotH]);

  const xTicks = useMemo(
    () => (geo ? timeTicks(geo.t0, geo.t0 + geo.span, Math.max(2, Math.floor(plotW / 96))) : []),
    [geo, plotW],
  );

  const move = useCallback(
    (clientX: number) => {
      const el = wrapRef.current;
      if (!el || !geo) return;
      const px = clientX - el.getBoundingClientRect().left - M.left;
      const i = Math.max(0, Math.min(n - 1, Math.floor(px / geo.band)));
      setHover((h) => (h === i ? h : i));
    },
    [geo, n],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const cur = hover ?? n - 1;
    let next = cur;
    const big = e.shiftKey ? 7 : 1;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - big);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + big);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') {
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    setHover(next);
  };

  const hv = hover === null ? null : (values[hover] ?? null);
  const range = (i: number) =>
    `${formatUtcDateTime(t[i]!)} to ${formatUtcDateTime(t[i]! + stepMs).slice(-9)}`;
  const valueText =
    hover === null
      ? title
      : `${range(hover)}: ${hv === null ? 'unknown' : `${signed(hv)}${unit ? ` ${unit}` : ''}`}`;
  const thick = geo ? Math.min(26, Math.max(2, geo.band - 2)) : 4;
  const tipX = geo && hover !== null ? M.left + geo.band * (hover + 0.5) : 0;
  const rows = useMemo(() => t.map((_, i) => i).reverse(), [t]);

  return (
    <figure className="vz-fig" aria-label={title}>
      <div className="vz-chart" ref={wrapRef} style={{ height }}>
        {geo ? (
          <>
            <svg
              className="vz-svg"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
              focusable="false"
            >
              <g className="vz-grid">
                {geo.ticks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + plotW} y1={geo.y(v)} y2={geo.y(v)} />
                    <text x={M.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end">
                      {compactTickAt(v, geo.step)}
                    </text>
                  </g>
                ))}
              </g>
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
              <g>
                {values.map((v, i) => {
                  if (v === null) return null;
                  const cx = M.left + geo.band * (i + 0.5);
                  const y0 = geo.y(0);
                  const d = roundedEnd(cx - thick / 2, y0, geo.y(v), thick, 4);
                  return (
                    <path
                      // biome-ignore lint/suspicious/noArrayIndexKey: buckets are positional
                      key={i}
                      className="vz-delta"
                      data-sign={v >= 0 ? 'up' : 'down'}
                      data-hot={hover === i || undefined}
                      d={d}
                    />
                  );
                })}
                <line className="vz-zero" x1={M.left} x2={M.left + plotW} y1={geo.y(0)} y2={geo.y(0)} />
              </g>
              {hover !== null ? (
                <line className="vz-cross" x1={tipX} x2={tipX} y1={M.top} y2={M.top + plotH} />
              ) : null}
            </svg>

            <div
              className="vz-overlay"
              role="slider"
              tabIndex={0}
              aria-label={`${title}. Use the arrow keys to read values.`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={Math.max(0, hover ?? 0)}
              aria-valuetext={valueText}
              data-focused={focused || undefined}
              style={{ left: M.left, top: M.top, width: plotW, height: plotH }}
              onPointerMove={(e) => move(e.clientX)}
              onPointerDown={(e) => move(e.clientX)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                setHover(null);
              }}
            />

            {hover !== null ? (
              <div
                className="vz-tip"
                data-side={tipX > width * 0.58 ? 'left' : 'right'}
                style={{ left: tipX, top: M.top + 4 }}
                role="presentation"
              >
                <div className="vz-tip-head tabular">{range(hover)}</div>
                <ul>
                  <li>
                    <span
                      className="vz-key"
                      style={{ ['--c' as string]: hv !== null && hv < 0 ? 'var(--div-neg)' : 'var(--viz-1)' }}
                      aria-hidden="true"
                    />
                    <strong className="vz-tip-val tabular">{hv === null ? 'Unknown' : signed(hv)}</strong>
                    <span className="vz-tip-name">Net change</span>
                  </li>
                  {(detail?.(hover) ?? []).map((d) => (
                    <li key={d.label}>
                      <span
                        className="vz-key"
                        style={{ ['--c' as string]: d.color ?? 'var(--text-3)' }}
                        aria-hidden="true"
                      />
                      <strong className="vz-tip-val tabular">{d.value}</strong>
                      <span className="vz-tip-name">{d.label}</span>
                    </li>
                  ))}
                </ul>
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
        <div className="vz-table-wrap">
          <table className="vz-table">
            <caption>{title}. Newest first.</caption>
            <thead>
              <tr>
                <th scope="col">Bucket start (UTC)</th>
                <th scope="col">Net change{unit ? `, ${unit}` : ''}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={t[i]}>
                  <th scope="row">{formatUtcDateTime(t[i]!)}</th>
                  <td className="tabular">
                    {values[i] === null || values[i] === undefined ? 'Unknown' : signed(values[i]!)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

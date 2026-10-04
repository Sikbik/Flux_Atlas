// The plot the wallet's charts stand on: a time axis, a value axis, hairline gridlines, the marks a chart draws, and
// the way to read it. It follows the chart language of the Chain charts (a crosshair and a glass tooltip follow the
// pointer or the arrow keys, a slider over the buckets, a "Show data" table with the same numbers as text, a legend
// that toggles series, marks that draw in once) and shares their styles. Plain SVG over the design tokens; at rest
// nothing moves.

import { Table2 } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../../../ui';
import { type Avoid, placeTip } from '../../analytics/viz/avoid';
import { type Linear, linear, timeTicks } from '../../analytics/viz/scale';
import { useSize } from '../../analytics/viz/useSize';
import '../../analytics/viz/viz.css';
import '../../analytics/viz/chainPlot.css';
import './plot.css';

/** Room around the plot for the value labels, the time labels and the rim of a mark at an edge. */
export const PLOT_MARGIN = { left: 52, right: 16, top: 12, bottom: 26 } as const;

export interface PlotAxis {
  lo: number;
  hi: number;
  ticks: readonly number[];
  step: number;
}

export interface PlotGeo {
  width: number;
  height: number;
  /** The plot rectangle inside the svg. */
  plot: { x: number; y: number; w: number; h: number };
  /** Unix ms to px. */
  x: Linear;
  /** A value to px. */
  y: Linear;
}

export interface TipRow {
  label: string;
  value: string;
  /** The colour of the key mark; a row without one is context, not a series. */
  color?: string;
  dashed?: boolean;
}

export interface PlotTip {
  head: string;
  aside?: string;
  rows: TipRow[];
}

export interface PlotProps {
  /** Names the chart for tests and styles (`data-chart`). */
  kind: string;
  /** The chart's name: its figure label and its slider's name. */
  title: string;
  /** One sentence about the chart for a screen reader (and the table's caption). */
  summary: string;
  /** Unix ms of each bucket, ascending. */
  t: readonly number[];
  /** The time axis, unix ms. */
  domain: readonly [number, number];
  axis: PlotAxis;
  formatTick: (value: number, step: number) => string;
  height?: number;
  /** Room each label on the time axis gets, in px (default 74): a long window with wide labels needs more. */
  tickSpace?: number;
  /** The marks, in the plot's own pixels, drawn under the crosshair. Keep it stable (`useCallback`): it is only called again when it or the geometry changes. */
  marks: (geo: PlotGeo) => ReactNode;
  /** The line the tooltip keeps clear of, in the plot's own pixels. Keep it stable. */
  track?: (geo: PlotGeo) => Avoid;
  /** The value the crosshair's dot sits at for bucket `i`, or null for no dot. */
  anchor?: (i: number) => number | null;
  dotColor?: string;
  tip: (i: number) => PlotTip | null;
  /** What a screen reader hears when the slider lands on bucket `i`. */
  reading: (i: number) => string;
  /** The same numbers as text: column heads, and a row of cells per bucket (keep `row` stable). */
  table: { head: readonly string[]; row: (i: number) => readonly string[] };
  /** Changes when the marks should draw in again (a new range, a new unit). */
  revealKey: string;
  /** Left of the "Show data" button: the legend. */
  legend?: ReactNode;
  /** A note under the plot, before the foot (what the figures are drawn from). */
  note?: ReactNode;
  /** The bucket highlighted from outside (a legend hover), or null. */
  className?: string;
}

const M = PLOT_MARGIN;
/** Until the tooltip has been measured: about what one is, by its rows. */
const TIP_GUESS = { w: 190, base: 40, row: 22 } as const;
/** Room each label on the time axis gets: a date and the gap to the next one. */
const TICK_SPACE = 74;

/** The index of the bucket nearest `ms` in an ascending list, or -1 for none. */
export function nearestIndex(t: readonly number[], ms: number): number {
  const n = t.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && ms - (t[lo - 1] as number) <= (t[lo] as number) - ms) return lo - 1;
  return lo;
}

export function Plot({
  kind,
  title,
  summary,
  t,
  domain,
  axis,
  formatTick,
  height = 232,
  tickSpace = TICK_SPACE,
  marks,
  track,
  anchor,
  dotColor = 'var(--viz-1)',
  tip,
  reading,
  table,
  revealKey,
  legend,
  note,
  className,
}: PlotProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrapRef);
  const [own, setOwn] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState<{ w: number; h: number } | null>(null);
  const tableId = useId();
  const n = t.length;

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = Math.max(10, height - M.top - M.bottom);

  const geo = useMemo<PlotGeo | null>(() => {
    if (width <= 0) return null;
    return {
      width,
      height,
      plot: { x: M.left, y: M.top, w: plotW, h: plotH },
      x: linear([domain[0], domain[1]], [M.left, M.left + plotW]),
      y: linear([axis.lo, axis.hi], [M.top + plotH, M.top]),
    };
  }, [width, height, plotW, plotH, domain, axis.lo, axis.hi]);

  const xTicks = useMemo(
    () => timeTicks(domain[0], domain[1], Math.max(3, Math.floor(plotW / tickSpace))),
    [domain, plotW, tickSpace],
  );

  // A new window starts with nothing under the crosshair.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => {
    setOwn(null);
  }, [revealKey]);

  const ownIdx = own !== null && own < n ? own : null;

  const fromPointer = (clientX: number) => {
    const el = overlayRef.current;
    if (!el || !geo || n === 0) return;
    const px = clientX - el.getBoundingClientRect().left;
    const i = nearestIndex(t, geo.x.invert(M.left + px));
    if (i >= 0) setOwn(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (n === 0) return;
    const at = ownIdx;
    const big = e.shiftKey ? 10 : 1;
    let next: number;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = at === null ? n - 1 : Math.max(0, at - big);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
      next = at === null ? n - 1 : Math.min(n - 1, at + big);
    else if (e.key === 'PageUp') next = at === null ? n - 1 : Math.max(0, at - Math.ceil(n / 10));
    else if (e.key === 'PageDown') next = at === null ? n - 1 : Math.min(n - 1, at + Math.ceil(n / 10));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') {
      // Only a reading in progress is Escape's to end; with none, Escape still closes the window.
      if (at === null) return;
      e.stopPropagation();
      setOwn(null);
      return;
    } else return;
    e.preventDefault();
    setOwn(next);
  };

  const tipData = ownIdx === null ? null : tip(ownIdx);
  const crossX = geo && ownIdx !== null && t[ownIdx] !== undefined ? geo.x(t[ownIdx] as number) : null;
  const dotValue = ownIdx === null || !anchor ? null : anchor(ownIdx);
  const dotY = geo && dotValue !== null ? geo.y(Math.min(axis.hi, Math.max(axis.lo, dotValue))) : null;
  const markEls = useMemo(() => (geo ? marks(geo) : null), [geo, marks]);
  const avoid = useMemo(() => (geo && track ? track(geo) : undefined), [geo, track]);
  const place =
    geo && tipData && crossX !== null
      ? placeTip(
          { width: geo.width, height, top: M.top, bottom: M.bottom, left: M.left, right: M.right },
          crossX,
          dotY,
          tipSize ?? { w: TIP_GUESS.w, h: TIP_GUESS.base + TIP_GUESS.row * tipData.rows.length },
          avoid,
        )
      : null;

  // Measure the tooltip after every render it is in, before the browser paints.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) setTipSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  });

  const rowEls = useMemo(
    () =>
      showTable
        ? t
            .map((_, i) => i)
            .reverse()
            .map((i) => {
              const [first, ...rest] = table.row(i);
              return (
                <tr key={t[i]}>
                  <th scope="row">{first}</th>
                  {rest.map((c, k) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    <td key={k} className={c === 'Unknown' ? 'cp-unknown' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              );
            })
        : null,
    [showTable, t, table.row],
  );

  return (
    <figure
      className={`vz-fig cp-fig wl-plot${className ? ` ${className}` : ''}`}
      aria-label={title}
      data-chart={kind}
    >
      <p className="ui-sr-only">{summary}</p>
      <div className="vz-chart cp-chart" ref={wrapRef} style={{ height }}>
        {geo ? (
          <>
            <svg
              className="vz-svg"
              width={geo.width}
              height={height}
              viewBox={`0 0 ${geo.width} ${height}`}
              aria-hidden="true"
              focusable="false"
            >
              <g className="vz-grid">
                {axis.ticks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + plotW} y1={geo.y(v)} y2={geo.y(v)} />
                    <text x={M.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end">
                      {formatTick(v, axis.step)}
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
              <g className="cp-reveal" key={revealKey}>
                {markEls}
              </g>
              {dotY !== null && crossX !== null ? (
                <g className="cp-dot" style={{ '--c': dotColor } as CSSProperties}>
                  <circle className="cp-dot-halo" cx={crossX} cy={dotY} r={9} />
                  <circle className="cp-dot-core" cx={crossX} cy={dotY} r={4} />
                </g>
              ) : null}
            </svg>

            {crossX !== null ? (
              <div
                className="cp-cross"
                aria-hidden="true"
                style={{ left: Math.round(crossX), top: M.top, height: plotH }}
              />
            ) : null}

            <div
              ref={overlayRef}
              className="vz-overlay"
              role="slider"
              tabIndex={0}
              aria-label={`${title}. Use the arrow keys to read each point.`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={Math.max(0, ownIdx ?? 0)}
              aria-valuetext={ownIdx === null ? summary : reading(ownIdx)}
              style={{ left: M.left, top: M.top, width: plotW, height: plotH }}
              onPointerMove={(e) => fromPointer(e.clientX)}
              onPointerDown={(e) => fromPointer(e.clientX)}
              onPointerLeave={(e) => {
                // A finger lifted off the plot leaves the reading where it was; the next touch moves it.
                if (e.pointerType !== 'touch') setOwn(null);
              }}
              onKeyDown={onKey}
              onBlur={() => setOwn(null)}
            />

            {tipData && crossX !== null && place ? (
              <div
                ref={tipRef}
                className="cp-tip"
                role="presentation"
                data-side={place.side}
                data-v={place.v}
                style={
                  place.v === 'top'
                    ? { left: crossX, top: M.top + 6 }
                    : { left: crossX, bottom: M.bottom + 6 }
                }
              >
                <div className="cp-tip-head">
                  <span>{tipData.head}</span>
                  {tipData.aside ? <span>{tipData.aside}</span> : null}
                </div>
                <ul>
                  {tipData.rows.map((r) => (
                    <li key={r.label}>
                      <span
                        className="cp-key"
                        data-dashed={r.dashed || undefined}
                        data-none={r.color ? undefined : ''}
                        style={{ '--c': r.color } as CSSProperties}
                        aria-hidden="true"
                      />
                      <span className="cp-tip-name">{r.label}</span>
                      <strong className="cp-tip-val">{r.value}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {note ? <p className="wl-note wl-plot__note">{note}</p> : null}

      <figcaption className="cp-foot">
        <div className="cp-legend-slot">{legend}</div>
        <Button
          size="sm"
          variant="ghost"
          icon={Table2}
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Hide data' : 'Show data'}
        </Button>
      </figcaption>

      {showTable ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard so its rows can be scrolled
        <section id={tableId} className="vz-table-wrap" aria-label={`${title}, data`} tabIndex={0}>
          <table className="vz-table">
            <caption>{summary} Newest first.</caption>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{rowEls}</tbody>
          </table>
        </section>
      ) : null}
    </figure>
  );
}

/** A legend entry that only names a series (nothing to toggle). */
export function LegendKey({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <li>
      <span className="cp-legend-item cp-legend-static">
        <span
          className="cp-key"
          data-dashed={dashed || undefined}
          style={{ '--c': color } as CSSProperties}
          aria-hidden="true"
        />
        {label}
      </span>
    </li>
  );
}

/** A legend entry that toggles a series: its key, its name, pressed while shown. */
export function LegendToggle({
  label,
  color,
  on,
  onToggle,
  dashed,
}: {
  label: string;
  color: string;
  on: boolean;
  onToggle: () => void;
  dashed?: boolean;
}) {
  return (
    <li>
      <button type="button" className="cp-legend-item" aria-pressed={on} onClick={onToggle}>
        <span
          className="cp-key"
          data-dashed={dashed || undefined}
          style={{ '--c': color } as CSSProperties}
          aria-hidden="true"
        />
        {label}
      </button>
    </li>
  );
}

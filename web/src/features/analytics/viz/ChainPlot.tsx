// The plot both Chain charts stand on: a time axis, a value axis, hairline gridlines, the marks the
// chart draws, and the way to read it. A crosshair and a glass tooltip follow the pointer or the arrow
// keys (a slider over the buckets, like the other analytics charts), a "Show data" table carries the same
// numbers as text, and the crosshair can be shared with a second plot so two charts of one window read as
// one. Plain SVG over the design tokens; at rest nothing moves, and the marks draw in once per window.

import { Table2 } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../../../ui';
import { type AxisDomain, nearestIndex } from '../lib/chain';
import { type Avoid, placeTip } from './avoid';
import { logScale } from './logScale';
import { type Linear, linear, timeTicks } from './scale';
import { useSize } from './useSize';
import './viz.css';
import './chainPlot.css';

/** Room around the plot for the value labels, the time labels and the rim of a mark at an edge. */
export const PLOT_MARGIN = { left: 46, right: 16, top: 12, bottom: 26 } as const;

export interface PlotGeo {
  width: number;
  height: number;
  /** The plot rectangle inside the svg. */
  plot: { x: number; y: number; w: number; h: number };
  /** Unix ms to px. */
  x: Linear;
  /** A value to px (on a log axis, by its logarithm). */
  y: Linear;
}

export interface TipRow {
  label: string;
  value: string;
  /** The colour of the key mark; a row without one is context, not a series. */
  color?: string;
  /** A dashed key (the target). */
  dashed?: boolean;
  /** A caret key, the mark of a gap that runs off the chart. */
  caret?: boolean;
}

export interface Tip {
  /** The time of the bucket. */
  time: string;
  /** The block it ends at. */
  block: string;
  rows: TipRow[];
}

export interface ChainPlotProps {
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
  /** The value axis. */
  axis: AxisDomain;
  /** A label for a tick on the value axis. */
  formatTick: (value: number, step: number) => string;
  height?: number;
  /** The marks, in the plot's own pixels, drawn under the crosshair. Keep the function stable (`useCallback`): it is only called again when it or the geometry changes. */
  marks: (geo: PlotGeo) => ReactNode;
  /** The line the tooltip keeps clear of, in the plot's own pixels (it goes where the line is not). Keep it stable (`useCallback`). */
  track?: (geo: PlotGeo) => Avoid;
  /** The value the crosshair's dot sits at for bucket `i`, or null for no dot. */
  anchor: (i: number) => number | null;
  /** The dot's colour. */
  dotColor?: string;
  tip: (i: number) => Tip | null;
  /** What a screen reader hears when the slider lands on bucket `i`. */
  reading: (i: number) => string;
  /** The same numbers as text: column heads, and a row of cells per bucket (keep `row` stable). */
  table: { head: readonly string[]; row: (i: number) => readonly string[] };
  /** The bucket under the shared crosshair (this plot's or the other one's), or null. */
  cursor: number | null;
  /** Tells the other plot where this one is being read. */
  onCursor: (i: number | null) => void;
  /** Changes when the marks should draw in again: a new window. */
  revealKey: string;
  /** Left of the "Show data" button: the legend. */
  legend?: ReactNode;
}

const M = PLOT_MARGIN;
/** Until the tooltip has been measured: about what one is, by its rows. */
const TIP_GUESS = { w: 190, base: 40, row: 22 } as const;
/** Room each label on the time axis gets: a date and the gap to the next one. */
const TICK_SPACE = 74;

export function ChainPlot({
  kind,
  title,
  summary,
  t,
  domain,
  axis,
  formatTick,
  height = 224,
  marks,
  track,
  anchor,
  dotColor = 'var(--viz-1)',
  tip,
  reading,
  table,
  cursor,
  onCursor,
  revealKey,
  legend,
}: ChainPlotProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrapRef);
  const [own, setOwn] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  // How big the tooltip is, as measured: it decides where the tooltip can go.
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
      y: (axis.scale === 'log' ? logScale : linear)([axis.lo, axis.hi], [M.top + plotH, M.top]),
    };
  }, [width, height, plotW, plotH, domain, axis.lo, axis.hi, axis.scale]);

  const xTicks = useMemo(
    () => timeTicks(domain[0], domain[1], Math.max(3, Math.floor(plotW / TICK_SPACE))),
    [domain, plotW],
  );

  // A new window starts with nothing under the crosshair, this plot's or the other one's (a finger lifted
  // off a plot leaves its reading in place, so the reading can outlive the window it was taken in).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => {
    setOwn(null);
    onCursor(null);
  }, [revealKey]);

  const ownIdx = own !== null && own < n ? own : null;
  const shown = ownIdx ?? (cursor !== null && cursor < n ? cursor : null);

  const read = (i: number | null) => {
    setOwn(i);
    onCursor(i);
  };

  const fromPointer = (clientX: number) => {
    const el = overlayRef.current;
    if (!el || !geo || n === 0) return;
    const px = clientX - el.getBoundingClientRect().left;
    const i = nearestIndex(t, geo.x.invert(M.left + px));
    if (i >= 0) read(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
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
      read(null);
      return;
    } else return;
    e.preventDefault();
    read(next);
  };

  const tipData = ownIdx === null ? null : tip(ownIdx);
  const crossX = geo && shown !== null && t[shown] !== undefined ? geo.x(t[shown]) : null;
  const dotValue = shown === null ? null : anchor(shown);
  const dotY = geo && dotValue !== null ? geo.y(Math.min(axis.hi, Math.max(axis.lo, dotValue))) : null;
  // The marks and the table are drawn from the data and the geometry alone, so a pointer moving over the
  // plot (which re-renders it often) does not redraw them.
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

  // Measure the tooltip after every render it is in (before the browser paints, so nothing flashes where
  // it was first guessed): a size that changed re-places it, one that did not changes nothing.
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
    <figure className="vz-fig cp-fig" aria-label={title} data-chart={kind}>
      {/* What the chart shows, in a sentence, for a screen reader reading through the page (the slider says it again when focused). */}
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
                if (e.pointerType !== 'touch') read(null);
              }}
              onKeyDown={onKey}
              onBlur={() => read(null)}
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
                  <span>{tipData.time}</span>
                  <span>Block {tipData.block}</span>
                </div>
                <ul>
                  {tipData.rows.map((r) => (
                    <li key={r.label}>
                      <span
                        className="cp-key"
                        data-dashed={r.dashed || undefined}
                        data-caret={r.caret || undefined}
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

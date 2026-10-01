// The uPlot-backed chart. Loaded lazily by TimeSeries.tsx, never imported anywhere else, so uplot
// and its CSS stay out of every other chunk. Canvas drawing reads its colours and font from the
// design tokens once per mount (chartTheme.ts); the DOM around it (legend, tooltip, data table, live
// region) is ordinary React so it is themable, focusable and accessible.

import { Table2 } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatUtcDateTime } from '../../lib/format';
import { Button } from '../controls/Button';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { type ChartTheme, readChartTheme } from './chartTheme';
import { resolveColor, withAlpha } from './color';
import { formatTicks } from './scale';
import type { TimeSeriesProps } from './TimeSeries';
import { TimeSeriesSkeleton } from './TimeSeriesSkeleton';
import {
  cellText,
  type Formatters,
  formatXTick,
  legendNext,
  markerIndices,
  type PreparedData,
  padRange,
  placeTip,
  pointAnnouncement,
  prepareData,
  rootProps,
  sameData,
  stepIndex,
  summarize,
  tableRows,
  toAligned,
  valueFormatter,
  type YDomain,
} from './timeSeries';
import './TimeSeriesImpl.css';

const POINT = 12; // an 8 px disc plus its 2 px surface ring
const RING = 2;

interface BuildArgs {
  width: number;
  height: number;
  data: PreparedData;
  colors: string[];
  theme: ChartTheme;
  area: boolean;
  yDomain: () => YDomain | undefined;
  formats: () => Formatters;
  onCursor: (u: uPlot) => void;
}

function buildOptions(a: BuildArgs): uPlot.Options {
  const { theme, colors } = a;
  const areaFill = (color: string) => (u: uPlot) => {
    const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    g.addColorStop(0, withAlpha(color, theme.areaAlpha));
    g.addColorStop(1, withAlpha(color, 0));
    return g;
  };

  const series: uPlot.Series[] = [
    {},
    ...a.data.series.map((s, i): uPlot.Series => {
      const color = colors[i] as string;
      return {
        label: s.label,
        scale: 'y',
        stroke: color,
        width: 2,
        cap: 'round',
        fill: a.area ? areaFill(color) : undefined,
        spanGaps: false,
        points: {
          show: false,
          size: POINT,
          width: RING,
          stroke: theme.surface,
          fill: color,
          // The newest value gets the end dot; an isolated sample between gaps gets one too.
          filter: (u) => {
            const col = u.data[i + 1] as ArrayLike<number | null | undefined> | undefined;
            return col ? markerIndices(Array.from(col, (v) => v ?? null)) : null;
          },
        },
      };
    }),
  ];

  const spanMs = (u: uPlot) => ((u.scales.x?.max ?? 0) - (u.scales.x?.min ?? 0)) * 1000;

  return {
    width: a.width,
    height: a.height,
    padding: [10, 14, 0, 0],
    pxAlign: true,
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
    legend: { show: false },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    cursor: {
      show: true,
      x: true,
      y: false,
      drag: { x: false, y: false, setScale: false },
      // The crosshair snaps to the nearest sample: readers aim at a time, never at a hairline.
      move: (u, left, top) => {
        if (left < 0) return [left, top];
        const idx = u.posToIdx(left);
        const xs = u.data[0] as ArrayLike<number>;
        const x = xs[idx];
        return [x === undefined ? left : u.valToPos(x, 'x'), top];
      },
      points: {
        size: POINT,
        width: RING,
        fill: (_u, si) => colors[si - 1] ?? theme.text1,
        stroke: () => theme.surface,
      },
    },
    scales: {
      x: { time: true },
      y: {
        range: (_u, min, max) => padRange(min, max, a.yDomain()),
      },
    },
    axes: [
      {
        scale: 'x',
        side: 2,
        size: 28,
        gap: 4,
        font: theme.font,
        stroke: theme.label,
        space: 84,
        grid: { show: false },
        ticks: { show: false },
        border: { show: false },
        values: (u, splits) => {
          const span = spanMs(u);
          return splits.map((s) => formatXTick(s * 1000, span));
        },
      },
      {
        scale: 'y',
        side: 3,
        gap: 8,
        font: theme.font,
        stroke: theme.label,
        space: 44,
        grid: { stroke: theme.grid, width: 1 },
        ticks: { show: false },
        border: { show: false },
        values: (_u, splits, _ax, _space, incr) => {
          const { yFormat } = a.formats();
          return yFormat ? splits.map((v) => yFormat(v)) : formatTicks(splits, incr);
        },
      },
    ],
    series,
    hooks: {
      setCursor: [a.onCursor],
    },
  };
}

function applyVisibility(u: uPlot, visible: readonly boolean[]): void {
  u.batch(() => {
    visible.forEach((v, i) => {
      const s = u.series[i + 1];
      if (s && s.show !== v) u.setSeries(i + 1, { show: v });
    });
  });
}

interface TipProps {
  data: PreparedData;
  idx: number;
  visible: readonly boolean[];
  formats: Formatters;
  tipRef: (el: HTMLDivElement | null) => void;
}

/** The hover readout: the time, then every visible series with a colour key and its value. */
function Tip({ data, idx, visible, formats, tipRef }: TipProps) {
  const t = data.t[idx];
  const fmtTime = formats.xFormat;
  return (
    <div ref={tipRef} className="ui-ts__tip" aria-hidden="true">
      <div className="ui-ts__tip-time">{t === undefined ? '' : (fmtTime ?? formatUtcDateTime)(t)}</div>
      {data.series.map((s, i) => {
        if (visible[i] === false) return null;
        const v = s.values[idx];
        const text = cellText(v, valueFormatter(s, formats));
        return (
          <div key={s.key} className="ui-ts__tip-row" style={{ '--ui-ts-c': s.color } as CSSProperties}>
            <i className="ui-ts__tip-key" />
            <span className="ui-ts__tip-label">{s.label}</span>
            <b className="ui-ts__tip-value" data-unknown={v === null || v === undefined || undefined}>
              {text}
            </b>
          </div>
        );
      })}
    </div>
  );
}

export default function TimeSeriesImpl(props: TimeSeriesProps) {
  const {
    t,
    series,
    height = 220,
    yFormat,
    xFormat,
    yDomain,
    maxPoints,
    label,
    refreshing,
    className,
    style,
  } = props;
  const dom = rootProps(props);

  // Content-stable data: a refetch that returns the same numbers keeps the same object, so the
  // chart is not touched.
  const fresh = prepareData(t, series, maxPoints);
  const stable = useRef<PreparedData>(fresh);
  if (!sameData(stable.current, fresh)) stable.current = fresh;
  const data = stable.current;

  const multi = data.series.length >= 2;
  const area = props.area ?? !multi;
  const structure = `${data.series.map((s) => `${s.key}=${s.color}`).join('|')}#${area ? 'area' : 'line'}`;
  const formats: Formatters = { yFormat, xFormat };

  // Latest values for the uPlot callbacks, which outlive any one render.
  const dataRef = useRef(data);
  dataRef.current = data;
  const formatsRef = useRef(formats);
  formatsRef.current = formats;
  const domainRef = useRef(yDomain);
  domainRef.current = yDomain;
  const heightRef = useRef(height);
  heightRef.current = height;

  const plotRef = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);
  const tipEl = useRef<HTMLDivElement | null>(null);
  const kbIdx = useRef<number | null>(null);
  const applied = useRef<PreparedData | null>(null);
  const pending = useRef<{ raf: number; data: PreparedData | null }>({ raf: 0, data: null });

  const [overEl, setOverEl] = useState<HTMLElement | null>(null);
  const [tipIdx, setTipIdx] = useState<number | null>(null);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [announce, setAnnounce] = useState('');
  const [showData, setShowData] = useState(props.defaultShowData ?? false);
  const [veilDone, setVeilDone] = useState(false);

  const visible = data.series.map((s) => !hidden.includes(s.key));
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const visibleKey = visible.map(Number).join('');

  const hintId = useId();
  const tableId = useId();

  // Places the tooltip centred above the highest hovered point (below the lowest when there is no
  // room), so it never covers the data being read; kept inside the plot.
  const place = () => {
    const u = uRef.current;
    const el = tipEl.current;
    if (!u || !el) return;
    const idx = u.cursor.idx;
    const xs = u.data[0] as ArrayLike<number>;
    const left = u.cursor.left ?? -10;
    const open = idx !== null && idx !== undefined && left >= 0 && xs[idx] !== undefined;
    el.toggleAttribute('data-open', open);
    el.setAttribute('data-state', open ? 'open' : 'closed');
    if (!open) return;
    let top: number | null = null;
    let bottom: number | null = null;
    visibleRef.current.forEach((on, i) => {
      const v = on ? dataRef.current.series[i]?.values[idx as number] : null;
      if (typeof v !== 'number') return;
      const y = u.valToPos(v, 'y');
      top = top === null ? y : Math.min(top, y);
      bottom = bottom === null ? y : Math.max(bottom, y);
    });
    const p = placeTip({
      x: u.valToPos(xs[idx as number] as number, 'x'),
      top,
      bottom,
      tip: { width: el.offsetWidth, height: el.offsetHeight },
      plot: { width: u.over.clientWidth, height: u.over.clientHeight },
    });
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  const onCursor = (u: uPlot) => {
    const idx = u.cursor.idx;
    const left = u.cursor.left ?? -10;
    // The readout stays mounted after the first hover (it fades out by data-open), so it keeps the
    // last index it showed.
    if (idx !== null && idx !== undefined && left >= 0) setTipIdx((prev) => (prev === idx ? prev : idx));
    placeRef.current();
  };
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  // Create the chart once per structure (series set, colours, fill); everything else updates it.
  // `structure` stands for the series keys and colours; the rest is read through refs on purpose so data and formatter changes never rebuild the chart
  useLayoutEffect(() => {
    const host = plotRef.current;
    if (!host) return;
    const current = dataRef.current;
    const theme = readChartTheme(host);
    const colors = current.series.map((s) => resolveColor(host, s.color));
    const width = Math.max(1, Math.floor(host.getBoundingClientRect().width));
    const u = new uPlot(
      buildOptions({
        width,
        height: heightRef.current,
        data: current,
        colors,
        theme,
        area,
        yDomain: () => domainRef.current,
        formats: () => formatsRef.current,
        onCursor: (c) => onCursorRef.current(c),
      }),
      toAligned(current),
      host,
    );
    uRef.current = u;
    applied.current = current;
    applyVisibility(u, visibleRef.current);
    setOverEl(u.over);

    // The axis labels are drawn on the canvas: redraw once Plex Mono is certainly available.
    const fonts = document.fonts;
    if (fonts && !fonts.check(theme.font)) {
      fonts
        .load(theme.font)
        .then(() => {
          if (uRef.current === u) u.redraw(false, true);
        })
        .catch(() => {});
    }

    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const w = Math.floor(entries[0]?.contentRect.width ?? 0);
            if (w >= 1 && w !== u.width) u.setSize({ width: w, height: u.height });
          });
    ro?.observe(host);
    const queue = pending.current;
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(queue.raf);
      queue.raf = 0;
      queue.data = null;
      u.destroy();
      if (uRef.current === u) uRef.current = null;
      applied.current = null;
      setOverEl(null);
      setTipIdx(null);
    };
  }, [structure]);

  // Live append: new points go through setData on the same instance, batched into one frame.
  useEffect(() => {
    const u = uRef.current;
    if (!u || applied.current === data) return;
    const queue = pending.current;
    queue.data = data;
    if (queue.raf) return;
    queue.raf = requestAnimationFrame(() => {
      queue.raf = 0;
      const next = queue.data;
      queue.data = null;
      const chart = uRef.current;
      if (!next || !chart) return;
      applied.current = next;
      chart.setData(toAligned(next));
    });
  }, [data]);

  // `visibleKey` is the content of `visible`
  useEffect(() => {
    const u = uRef.current;
    if (u) applyVisibility(u, visibleRef.current);
  }, [visibleKey]);

  useEffect(() => {
    const u = uRef.current;
    if (u && u.height !== height) u.setSize({ width: u.width, height });
  }, [height]);

  // The tooltip's content changed: measure and place it again before paint.
  // re-place whenever the readout's content can change size
  useLayoutEffect(() => {
    placeRef.current();
  }, [tipIdx, visibleKey, overEl]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const u = uRef.current;
    if (!u) return;
    const d = dataRef.current;
    if (e.key === 'Escape') {
      if (kbIdx.current !== null) {
        e.stopPropagation();
        kbIdx.current = null;
        u.setCursor({ left: -10, top: -10 });
        setAnnounce('');
      }
      return;
    }
    const idx = stepIndex(u.cursor.idx ?? kbIdx.current, e.key, e.shiftKey, d.t.length);
    if (idx === null) return;
    e.preventDefault();
    kbIdx.current = idx;
    const x = u.valToPos((d.t[idx] as number) / 1000, 'x');
    const lead = d.series.findIndex((s, i) => visibleRef.current[i] && s.values[idx] !== null);
    const lv = lead >= 0 ? d.series[lead]?.values[idx] : null;
    const y = typeof lv === 'number' ? u.valToPos(lv, 'y') : u.over.clientHeight / 2;
    u.setCursor({ left: x, top: y });
    setAnnounce(pointAnnouncement(d, idx, formatsRef.current, visibleRef.current));
  };

  const onBlur = () => {
    const u = uRef.current;
    kbIdx.current = null;
    if (u) u.setCursor({ left: -10, top: -10 });
    setAnnounce('');
  };

  const onLegend = (i: number, e: ReactMouseEvent<HTMLButtonElement>) => {
    const next = legendNext(visible, i, e.shiftKey);
    setHidden(data.series.filter((_, k) => !next[k]).map((s) => s.key));
  };

  const summary = label ?? summarize(data, formats);
  const rows = showData ? tableRows(data, formats) : [];

  return (
    <div
      {...dom}
      className={cx('ui-ts', className)}
      data-state="ready"
      data-refreshing={refreshing || undefined}
      style={{ '--ui-ts-h': `${height}px`, ...style } as CSSProperties}
    >
      <div className="ui-ts__stage">
        {/* The plot is a picture with a text equivalent (design 10.3); arrow keys read it point by point. */}
        <div
          ref={plotRef}
          className="ui-ts__plot"
          role="img"
          aria-label={summary}
          aria-describedby={hintId}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is keyboard-readable (arrow keys move the crosshair), which is why it is focusable
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
        {veilDone ? null : (
          <div className="ui-ts__veil" onAnimationEnd={() => setVeilDone(true)}>
            <TimeSeriesSkeleton height={height} plotOnly />
          </div>
        )}
      </div>
      <span id={hintId} className="ui-sr-only">
        Use the left and right arrow keys to read each point, Home and End for the first and last.
      </span>
      <div className="ui-sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      {overEl && tipIdx !== null
        ? createPortal(
            <Tip
              data={data}
              idx={tipIdx}
              visible={visible}
              formats={formats}
              tipRef={(el) => {
                tipEl.current = el;
              }}
            />,
            overEl,
          )
        : null}
      <div className="ui-ts__foot">
        {multi ? (
          <ul className="ui-ts__legend" aria-label="Series">
            {data.series.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="ui-ts__legend-item"
                  aria-pressed={visible[i]}
                  style={{ '--ui-ts-c': s.color } as CSSProperties}
                  onClick={(e) => onLegend(i, e)}
                  title="Click to show only this series, Shift-click to show or hide it"
                  {...pressHandlers<HTMLButtonElement>()}
                >
                  <i className="ui-ts__legend-key" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={Table2}
          aria-expanded={showData}
          aria-controls={tableId}
          onClick={() => setShowData((v) => !v)}
        >
          {showData ? 'Hide data' : 'Show data'}
        </Button>
      </div>
      {showData ? (
        <section
          id={tableId}
          className="ui-ts__table-wrap"
          aria-label="Chart data"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard so its rows can be scrolled
          tabIndex={0}
        >
          <table className="ui-ts__table">
            <caption className="ui-sr-only">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">Time (UTC)</th>
                {data.series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t}>
                  <th scope="row">
                    <time dateTime={new Date(r.t).toISOString()}>{r.time}</time>
                  </th>
                  {r.cells.map((c, i) => (
                    // cells are positional, one per series
                    <td key={i} data-unknown={c === 'Unknown' || undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

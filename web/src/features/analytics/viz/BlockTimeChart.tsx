// Time per block: the mean seconds per block of each bucket as a line in Flux blue, and the target as a
// dashed step line that changes where the chain's rules did (120 s before Proof of Node, 30 s from it).
// The axis is set by the typical block and the target, so one very long gap never flattens the
// thirty-second band: a gap above the top is clipped there and the worst ones get a caret, with the real
// figure in the tooltip. Where a bucket is only a few blocks (the 24 hour window) the longest single gap of
// each one is also a faint coral band above the line; a longer bucket always holds a long gap, so there it
// would only be noise.

import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import {
  formatTickSeconds,
  gapBandWorthDrawing,
  gapCeiling,
  gapReach,
  hasValues,
  lastKnown,
  pointFacts,
  pointReading,
  spikeMarkers,
  targetStepPoints,
  WINDOW_TEXT,
} from '../lib/chain';
import type { Avoid } from './avoid';
import { ChainPlot, type PlotGeo, type Tip, type TipRow } from './ChainPlot';
import type { ChainChartProps } from './DifficultyChart';
import { EraMarks } from './EraMarks';
import { bandPath, cornersPath, isolated, linePath } from './paths';

const TABLE_HEAD = ['Time', 'Block', 'Block time', 'Longest gap', 'Target'] as const;
/** At most this many carets, however many buckets run off the chart. */
const MARKER_LIMIT = 8;

type Series = 'avg' | 'target' | 'gap';

interface Visible {
  avg: boolean;
  target: boolean;
  gap: boolean;
}

const LEGEND: { id: Series; label: string; color: string; dashed?: boolean }[] = [
  { id: 'avg', label: 'Average', color: 'var(--viz-1)' },
  { id: 'target', label: 'Target', color: 'var(--text-2)', dashed: true },
  { id: 'gap', label: 'Longest gap', color: 'var(--viz-2)' },
];

export function BlockTimeChart({ model, cursor, onCursor, height }: ChainChartProps) {
  const { frame, window, domain, blockTime: axis, segments, cut } = model;
  const cap = axis.hi;
  const hasGap = useMemo(() => hasValues(frame.blockMax), [frame]);
  const band = gapBandWorthDrawing(model.perBucket);
  const hasTarget = segments.length > 0;
  const [visible, setVisible] = useState<Visible>({ avg: true, target: true, gap: true });
  const show: Visible = { avg: visible.avg, target: visible.target && hasTarget, gap: visible.gap && hasGap };

  const ctx = useMemo(
    () => ({ window, bucketMs: model.bucketMs, segments, cap }),
    [window, model.bucketMs, segments, cap],
  );

  // The carets: the worst buckets above the top of the chart, whatever the legend leaves showing.
  const markers = useMemo(() => {
    const reach = show.gap ? gapReach(frame) : frame.blockTime;
    return spikeMarkers(reach, cap, MARKER_LIMIT, Math.max(1, Math.floor(frame.t.length / 36)));
  }, [frame, cap, show.gap]);

  const marks = useCallback(
    (g: PlotGeo) => {
      const xs = frame.t.map((ms) => g.x(ms));
      const clipY = (v: number | null) => (v === null ? null : g.y(Math.min(v, cap)));
      const meanY = frame.blockTime.map(clipY);
      const topY = gapCeiling(frame).map(clipY);
      const last = lastKnown(frame.blockTime);
      const steps = targetStepPoints(segments).map((p) => ({
        x: g.x(p.ms),
        y: g.y(Math.min(p.seconds, cap)),
      }));
      return (
        <>
          {show.gap && band ? (
            <>
              <path className="cp-band" d={bandPath(xs, meanY, topY, cut)} />
              <path className="cp-band-edge" d={linePath(xs, topY, cut)} />
            </>
          ) : null}
          <EraMarks changes={model.changes} geo={g} avoid={{ x: xs, y: meanY }} />
          {show.avg ? (
            <>
              <path className="cp-line" d={linePath(xs, meanY, cut)} />
              {isolated(meanY, cut).map((i) => (
                <circle key={i} className="cp-lone" cx={xs[i]} cy={meanY[i] ?? 0} r={2.5} />
              ))}
            </>
          ) : null}
          {/* The target over the line: where the average sits on it, its dashes still show. */}
          {show.target ? <path className="cp-target" d={cornersPath(steps)} /> : null}
          {show.avg && last >= 0 ? (
            <circle className="cp-end" cx={xs[last]} cy={meanY[last] ?? 0} r={4} />
          ) : null}
          {markers.map((i) => {
            const x = xs[i] ?? 0;
            const y = g.plot.y;
            return (
              <path key={i} className="cp-caret" d={`M${x - 5} ${y + 9}L${x + 5} ${y + 9}L${x} ${y + 1}Z`} />
            );
          })}
        </>
      );
    },
    [frame, cap, segments, cut, model.changes, markers, band, show.avg, show.target, show.gap],
  );

  const track = useCallback(
    (g: PlotGeo): Avoid => ({
      x: frame.t.map((ms) => g.x(ms)),
      y: show.avg ? frame.blockTime.map((v) => (v === null ? null : g.y(Math.min(v, cap)))) : [],
    }),
    [frame, cap, show.avg],
  );

  const anchor = useCallback(
    (i: number) => (show.avg ? (frame.blockTime[i] ?? null) : null),
    [frame, show.avg],
  );

  const tip = useCallback(
    (i: number): Tip | null => {
      const f = pointFacts(frame, i, ctx);
      if (!f) return null;
      const rows: TipRow[] = [];
      if (show.avg) rows.push({ label: 'Block time', value: f.blockTime, color: 'var(--viz-1)' });
      if (show.gap && f.longest !== null) {
        // The key is the mark the chart draws for it: the band, or the caret where it runs off the chart.
        const key = f.offChart
          ? { color: 'var(--viz-2)', caret: true }
          : band
            ? { color: 'var(--viz-2)' }
            : {};
        rows.push({ label: 'Longest gap', value: f.longest, ...key });
      }
      if (show.target && f.target !== null) {
        rows.push({ label: 'Target', value: f.target, color: 'var(--text-2)', dashed: true });
      }
      rows.push({ label: 'Difficulty', value: f.difficulty });
      return { time: f.time, block: f.height, rows };
    },
    [frame, ctx, band, show.avg, show.gap, show.target],
  );

  const reading = useCallback(
    (i: number) => {
      const f = pointFacts(frame, i, ctx);
      return f ? pointReading(f) : '';
    },
    [frame, ctx],
  );

  const row = useCallback(
    (i: number) => {
      const f = pointFacts(frame, i, ctx);
      return f ? [f.time, f.height, f.blockTime, f.longest ?? 'Unknown', f.target ?? 'Unknown'] : [];
    },
    [frame, ctx],
  );
  const table = useMemo(() => ({ head: TABLE_HEAD, row }), [row]);

  const toggle = (id: Series) =>
    setVisible((v) => {
      const next = { ...v, [id]: !v[id] };
      // One series always stays: a chart with nothing on it says nothing.
      return next.avg || next.target || next.gap ? next : v;
    });

  const legend = (
    <ul className="cp-legend" aria-label="Series">
      {LEGEND.filter((l) => (l.id === 'gap' ? hasGap : l.id === 'target' ? hasTarget : true)).map((l) => (
        <li key={l.id}>
          <button
            type="button"
            className="cp-legend-item"
            aria-pressed={show[l.id]}
            style={{ '--c': l.color } as CSSProperties}
            title="Click to show or hide this series"
            onClick={() => toggle(l.id)}
          >
            <i
              className="cp-key"
              data-dashed={l.dashed || undefined}
              data-caret={(l.id === 'gap' && !band) || undefined}
              aria-hidden="true"
            />
            {l.label}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <ChainPlot
      kind="block-time"
      title={`Time per block over ${WINDOW_TEXT[window].phrase}`}
      summary={model.summary.blockTime}
      t={frame.t}
      domain={domain}
      axis={axis}
      formatTick={(v) => formatTickSeconds(v)}
      height={height}
      marks={marks}
      track={track}
      anchor={anchor}
      tip={tip}
      reading={reading}
      table={table}
      cursor={cursor}
      onCursor={onCursor}
      revealKey={window}
      legend={legend}
    />
  );
}

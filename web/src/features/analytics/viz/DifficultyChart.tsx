// Difficulty over the window: one line in Flux blue over a faint wash, with the newest value marked. The
// line is each bucket's mean difficulty (the steadier trend; the server's end-of-bucket value without
// one). The scale is the range of the values, not pinned to zero, because what a reader wants is the
// trend; difficulty that spans orders of magnitude (the proof of work years against Proof of Node) goes on
// a log scale, said so beside the chart. A hole in the history is a hole in the line.

import { useCallback, useId, useMemo } from 'react';
import {
  type ChainModel,
  formatLogTick,
  lastKnown,
  pointFacts,
  pointReading,
  WINDOW_TEXT,
} from '../lib/chain';
import type { Avoid } from './avoid';
import { ChainPlot, type PlotGeo, type Tip, type TipRow } from './ChainPlot';
import { EraMarks } from './EraMarks';
import { areaPath, isolated, linePath } from './paths';
import { compactTickAt } from './scale';

export interface ChainChartProps {
  model: ChainModel;
  /** The bucket under the crosshair of either chart. */
  cursor: number | null;
  onCursor: (i: number | null) => void;
  height?: number;
}

export function DifficultyChart({ model, cursor, onCursor, height }: ChainChartProps) {
  const { frame, window, domain, difficulty: axis, cut, hasMean } = model;
  const gid = useId();
  const log = axis.scale === 'log';
  const ctx = useMemo(
    () => ({ window, bucketMs: model.bucketMs, segments: model.segments, cap: model.blockTime.hi }),
    [window, model.bucketMs, model.segments, model.blockTime.hi],
  );
  const level = hasMean ? 'Difficulty (mean)' : 'Difficulty';

  const marks = useCallback(
    (g: PlotGeo) => {
      const xs = frame.t.map((ms) => g.x(ms));
      const ys = frame.trend.map((v) => (v === null ? null : g.y(v)));
      const last = lastKnown(frame.trend);
      const base = g.plot.y + g.plot.h;
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0.26 }} />
              <stop offset="1" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <EraMarks changes={model.changes} geo={g} avoid={{ x: xs, y: ys }} />
          <path className="cp-area" d={areaPath(xs, ys, base, cut)} fill={`url(#${gid})`} />
          <path className="cp-line" d={linePath(xs, ys, cut)} />
          {isolated(ys, cut).map((i) => (
            <circle key={i} className="cp-lone" cx={xs[i]} cy={ys[i] ?? 0} r={2.5} />
          ))}
          {last >= 0 ? <circle className="cp-end" cx={xs[last]} cy={ys[last] ?? 0} r={4} /> : null}
        </>
      );
    },
    [frame, gid, cut, model.changes],
  );

  const track = useCallback(
    (g: PlotGeo): Avoid => ({
      x: frame.t.map((ms) => g.x(ms)),
      y: frame.trend.map((v) => (v === null ? null : g.y(v))),
    }),
    [frame],
  );

  const anchor = useCallback((i: number) => frame.trend[i] ?? null, [frame]);

  const tip = useCallback(
    (i: number): Tip | null => {
      const f = pointFacts(frame, i, ctx);
      if (!f) return null;
      const rows: TipRow[] = [
        {
          label: frame.difficultyMean[i] === null ? 'Difficulty' : level,
          value: f.difficulty,
          color: 'var(--viz-1)',
        },
      ];
      if (f.endDiffers) rows.push({ label: 'At bucket end', value: f.difficultyEnd });
      rows.push({ label: 'Block time', value: f.blockTime });
      return { time: f.time, block: f.height, rows };
    },
    [frame, ctx, level],
  );

  const reading = useCallback(
    (i: number) => {
      const f = pointFacts(frame, i, ctx);
      return f ? pointReading(f) : '';
    },
    [frame, ctx],
  );

  const head = useMemo(
    () =>
      hasMean
        ? ['Time', 'Block', level, 'At bucket end', 'Block time']
        : ['Time', 'Block', level, 'Block time'],
    [hasMean, level],
  );
  const row = useCallback(
    (i: number) => {
      const f = pointFacts(frame, i, ctx);
      if (!f) return [];
      return hasMean
        ? [f.time, f.height, f.difficulty, f.difficultyEnd, f.blockTime]
        : [f.time, f.height, f.difficulty, f.blockTime];
    },
    [frame, ctx, hasMean],
  );
  const table = useMemo(() => ({ head, row }), [head, row]);

  return (
    <ChainPlot
      kind="difficulty"
      title={`Difficulty over ${WINDOW_TEXT[window].phrase}`}
      summary={model.summary.difficulty}
      t={frame.t}
      domain={domain}
      axis={axis}
      formatTick={log ? formatLogTick : compactTickAt}
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
      legend={
        log ? (
          <span className="cp-note" title="Each gridline is a multiple of the one below it">
            Log scale
          </span>
        ) : undefined
      }
    />
  );
}

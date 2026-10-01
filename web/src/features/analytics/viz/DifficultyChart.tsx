// Difficulty over the window: one line in Flux blue over a faint wash, with the newest value marked. The
// scale is the range of the values (not pinned to zero), because what a reader wants is the trend.

import { useCallback, useId, useMemo } from 'react';
import { type ChainModel, lastKnown, pointFacts, pointReading, WINDOW_TEXT } from '../lib/chain';
import { ChainPlot, type PlotGeo, type Tip } from './ChainPlot';
import { areaPath, isolated, linePath } from './paths';
import { compactTickAt } from './scale';

export interface ChainChartProps {
  model: ChainModel;
  /** The bucket under the crosshair of either chart. */
  cursor: number | null;
  onCursor: (i: number | null) => void;
  height?: number;
}

const TABLE_HEAD = ['Time', 'Block', 'Difficulty', 'Block time'] as const;

export function DifficultyChart({ model, cursor, onCursor, height }: ChainChartProps) {
  const { frame, window, domain, difficulty: axis } = model;
  const gid = useId();
  const ctx = useMemo(
    () => ({ window, segments: model.segments, cap: model.blockTime.hi }),
    [window, model.segments, model.blockTime.hi],
  );

  const marks = useCallback(
    (g: PlotGeo) => {
      const xs = frame.t.map((ms) => g.x(ms));
      const ys = frame.difficulty.map((v) => (v === null ? null : g.y(v)));
      const last = lastKnown(frame.difficulty);
      const base = g.plot.y + g.plot.h;
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0.26 }} />
              <stop offset="1" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path className="cp-area" d={areaPath(xs, ys, base)} fill={`url(#${gid})`} />
          <path className="cp-line" d={linePath(xs, ys)} />
          {isolated(ys).map((i) => (
            <circle key={i} className="cp-lone" cx={xs[i]} cy={ys[i] ?? 0} r={2.5} />
          ))}
          {last >= 0 ? <circle className="cp-end" cx={xs[last]} cy={ys[last] ?? 0} r={4} /> : null}
        </>
      );
    },
    [frame, gid],
  );

  const anchor = useCallback((i: number) => frame.difficulty[i] ?? null, [frame]);

  const tip = useCallback(
    (i: number): Tip | null => {
      const f = pointFacts(frame, i, ctx);
      if (!f) return null;
      return {
        time: f.time,
        block: f.height,
        rows: [
          { label: 'Difficulty', value: f.difficulty, color: 'var(--viz-1)' },
          { label: 'Block time', value: f.blockTime },
        ],
      };
    },
    [frame, ctx],
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
      return f ? [f.time, f.height, f.difficulty, f.blockTime] : [];
    },
    [frame, ctx],
  );
  const table = useMemo(() => ({ head: TABLE_HEAD, row }), [row]);

  return (
    <ChainPlot
      kind="difficulty"
      title={`Difficulty over ${WINDOW_TEXT[window].phrase}`}
      summary={model.summary.difficulty}
      t={frame.t}
      domain={domain}
      axis={axis}
      formatTick={compactTickAt}
      height={height}
      marks={marks}
      anchor={anchor}
      tip={tip}
      reading={reading}
      table={table}
      cursor={cursor}
      onCursor={onCursor}
      revealKey={window}
    />
  );
}

// Apps registered and apps updated on each UTC day, as stacked bars on the plot the wallet's and the Explorer's charts
// stand on: a crosshair and a glass tooltip follow the pointer or the arrow keys, a slider reads each day aloud, and
// "Show data" lists the same numbers as a table. The day still running is not a whole day, so its bars are drawn
// lighter, its key in the legend is dashed, and the tooltip says "today so far".

import { useCallback, useMemo } from 'react';
import { formatCompact, formatInt } from '../../../lib/format';
import { axisCount, dayDomain, roundedTop } from '../../wallet/lib/plotAxis';
import { LegendKey, Plot, type PlotGeo, type PlotTip } from '../../wallet/viz/Plot';
import { DAY_MS, type DeploySeries, dayHead, deploySummary, isRunningDay } from './lib/deploy';

const CHART_H = 288;
const REGISTERED = 'var(--viz-1)';
const UPDATED = 'var(--viz-3)';

const colorOf = (c: string) => ({ '--c': c }) as React.CSSProperties;

export interface DeploymentsChartProps {
  series: DeploySeries;
  /** The server's backfill of the permanent messages has finished; until then the early days read low. */
  complete: boolean;
}

export function DeploymentsChart({ series, complete }: DeploymentsChartProps) {
  const n = series.t.length;
  const axis = useMemo(() => axisCount(Math.max(0, ...series.total)), [series.total]);
  const domain = useMemo(() => dayDomain(series.t, DAY_MS), [series.t]);
  const centers = useMemo(() => series.t.map((t) => t + DAY_MS / 2), [series.t]);

  const marks = useMemo(
    () => (geo: PlotGeo) => {
      const slot = geo.plot.w / Math.max(1, n);
      const bw = Math.max(1.5, slot * 0.74);
      const r = Math.min(2.5, bw / 3);
      const base = geo.y(0);
      return (
        <>
          {series.t.map((tm, i) => {
            const reg = series.registered[i] ?? 0;
            const upd = series.updated[i] ?? 0;
            const x = geo.x(tm) + (slot - bw) / 2;
            const yReg = geo.y(reg);
            const yTop = geo.y(reg + upd);
            const hReg = Math.max(0, base - yReg);
            const hUpd = Math.max(0, yReg - yTop);
            const running = isRunningDay(series, i) || undefined;
            return (
              <g key={tm}>
                {hReg > 0.4 ? (
                  hUpd > 0.4 ? (
                    <rect
                      className="wl-bar"
                      x={x}
                      y={yReg}
                      width={bw}
                      height={hReg}
                      style={colorOf(REGISTERED)}
                      data-running={running}
                    />
                  ) : (
                    <path
                      className="wl-bar"
                      d={roundedTop(x, yReg, bw, hReg, r)}
                      style={colorOf(REGISTERED)}
                      data-running={running}
                    />
                  )
                ) : null}
                {hUpd > 0.4 ? (
                  <path
                    className="wl-bar"
                    d={roundedTop(x, yTop, bw, hUpd, r)}
                    style={colorOf(UPDATED)}
                    data-running={running}
                  />
                ) : null}
              </g>
            );
          })}
        </>
      );
    },
    [series, n],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => ({
      x: centers.map((c) => geo.x(c)),
      y: series.total.map((v) => geo.y(v)),
    }),
    [centers, series.total],
  );

  const tip = useCallback(
    (i: number): PlotTip => {
      const running = isRunningDay(series, i);
      return {
        head: dayHead(series, i),
        aside: running ? 'today so far' : undefined,
        rows: [
          { label: 'Updated', value: formatInt(series.updated[i] ?? 0), color: UPDATED, dashed: running },
          {
            label: 'Registered',
            value: formatInt(series.registered[i] ?? 0),
            color: REGISTERED,
            dashed: running,
          },
          { label: 'Total', value: formatInt(series.total[i] ?? 0) },
        ],
      };
    },
    [series],
  );

  const reading = useCallback(
    (i: number) =>
      `${dayHead(series, i)}: ${formatInt(series.registered[i] ?? 0)} registered, ${formatInt(series.updated[i] ?? 0)} updated${isRunningDay(series, i) ? ', today so far' : ''}`,
    [series],
  );

  const row = useCallback(
    (i: number): readonly string[] => [
      dayHead(series, i) + (isRunningDay(series, i) ? ' (so far)' : ''),
      formatInt(series.registered[i] ?? 0),
      formatInt(series.updated[i] ?? 0),
      formatInt(series.total[i] ?? 0),
    ],
    [series],
  );
  const table = useMemo(
    () => ({ head: ['Date (UTC)', 'Registered', 'Updated', 'Total'] as const, row }),
    [row],
  );

  return (
    <Plot
      kind="app-deployments"
      title="Apps registered and updated per day"
      summary={deploySummary(series, complete)}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={(v) => (v === 0 ? '0' : formatCompact(v))}
      height={CHART_H}
      marks={marks}
      track={track}
      anchor={(i) => series.total[i] ?? null}
      dotColor="var(--text-1)"
      tip={tip}
      reading={reading}
      table={table}
      revealKey={`deployments:${n}`}
      legend={
        <ul className="cp-legend" aria-label="Series" data-static>
          <LegendKey label="Updated" color={UPDATED} />
          <LegendKey label="Registered" color={REGISTERED} />
          {series.running ? <LegendKey label="Today so far" color={UPDATED} dashed /> : null}
        </ul>
      }
    />
  );
}

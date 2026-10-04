// The next 365 days of earnings: the running total (or the daily rate, as steps) with the native payouts and the
// parallel assets stacked, and the reward cut marked where it lands. The unit switches between FLUX and money; money
// is valued at one price, today's or a scenario's, so the curve moves with the price control above it.

import { type CSSProperties, useMemo } from 'react';
import { formatInt } from '../../../lib/format';
import type { Money } from '../hooks/useMoney';
import { dateStamp } from '../lib/csv';
import { DAY_MS } from '../lib/money';
import { axisFromZero, fluxTick } from '../lib/plotAxis';
import type { Projection } from '../lib/projection';
import { areaPath, linePath, seriesPoints } from '../lib/stackPath';
import type { Unit } from './DailyChart';
import { LegendKey, Plot, type PlotGeo, type PlotTip, type TipRow } from './Plot';

export type ProjectionView = 'cumulative' | 'daily';

const NATIVE = 'var(--accent-300)';
const PA = 'var(--viz-1)';

const flux2 = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const colour = (c: string, extra?: CSSProperties) => ({ '--c': c, ...extra }) as CSSProperties;

function runningSum(values: readonly number[]): number[] {
  let run = 0;
  return values.map((v) => (run += v));
}

export interface ProjectionChartProps {
  proj: Projection;
  includePa: boolean;
  view: ProjectionView;
  unit: Unit;
  money: Money;
  /** One FLUX in the display currency, scenario included; null while the price is unknown. */
  price: number | null;
  revealKey: string;
}

export function ProjectionChart({
  proj,
  includePa,
  view,
  unit,
  money,
  price,
  revealKey,
}: ProjectionChartProps) {
  const n = proj.t.length;
  const scale = unit === 'flux' ? 1 : (price ?? 0);
  const shape = view === 'cumulative' ? 'running' : 'steps';

  // The two stacked layers, in the unit shown: native underneath, parallel assets on top (when they count).
  const layers = useMemo(() => {
    const nat = view === 'cumulative' ? runningSum(proj.native) : proj.native;
    const pa = view === 'cumulative' ? runningSum(proj.pa) : proj.pa;
    const native = nat.map((v) => v * scale);
    const top = nat.map((v, i) => (v + (includePa ? (pa[i] as number) : 0)) * scale);
    return { native, top, pa: pa.map((v) => (includePa ? v * scale : 0)) };
  }, [proj, view, includePa, scale]);

  const axis = useMemo(() => axisFromZero(Math.max(0, ...layers.top)), [layers.top]);
  const domain = useMemo<readonly [number, number]>(
    () => (n === 0 ? [0, DAY_MS] : [proj.t[0] as number, (proj.t[n - 1] as number) + DAY_MS]),
    [proj.t, n],
  );
  const centers = useMemo(
    () => proj.t.map((t) => (view === 'cumulative' ? t + DAY_MS : t + DAY_MS / 2)),
    [proj.t, view],
  );

  const fmt = (v: number): string => (unit === 'flux' ? flux2(v) : money.fmt(v));
  const tick = (v: number, step: number): string =>
    unit === 'flux' ? fluxTick(v, step) : money.fmt(v, { compact: true });

  const step = proj.step;
  const marks = useMemo(
    () => (geo: PlotGeo) => {
      if (n === 0) return null;
      const top = seriesPoints(shape, proj.t, layers.top, geo.x, geo.y);
      const nat = seriesPoints(shape, proj.t, layers.native, geo.x, geo.y);
      const baseY = geo.y(0);
      const end = top[top.length - 1];
      const labelX = step ? geo.x(step.t) : 0;
      const flip = labelX > geo.plot.x + geo.plot.w - 96;
      return (
        <>
          <defs>
            <pattern
              id="wl-hatch"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill="var(--viz-1)" fillOpacity="0.1" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="var(--viz-1)" strokeOpacity="0.75" strokeWidth="2" />
            </pattern>
          </defs>
          {includePa ? (
            <path className="wl-bar" data-estimate d={areaPath(top, nat, baseY)} style={colour(PA)} />
          ) : null}
          <path className="wl-area" d={areaPath(nat, null, baseY)} style={colour(NATIVE)} />
          {includePa ? (
            <path className="wl-line" d={linePath(top)} style={colour(PA, { strokeWidth: 1.5 })} />
          ) : null}
          <path className="wl-line" d={linePath(nat)} style={colour(NATIVE)} />
          {step ? (
            <g className="wl-mark">
              <line x1={labelX} x2={labelX} y1={geo.plot.y} y2={geo.plot.y + geo.plot.h} />
              <text
                x={flip ? labelX - 6 : labelX + 6}
                y={geo.plot.y + 12}
                textAnchor={flip ? 'end' : 'start'}
              >
                Reward cut
              </text>
            </g>
          ) : null}
          {end ? (
            <circle className="wl-end" cx={end.x} cy={end.y} r={4} style={colour(includePa ? PA : NATIVE)} />
          ) : null}
        </>
      );
    },
    [n, shape, proj.t, layers, includePa, step],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => ({ x: centers.map((t) => geo.x(t)), y: layers.top.map((v) => geo.y(v)) }),
    [centers, layers.top],
  );

  const summary =
    n === 0
      ? 'There is no projection yet.'
      : `Projected earnings over the next ${formatInt(n)} days: ${flux2(proj.sums.native)} FLUX of native payouts${includePa ? ` and ${flux2(proj.sums.pa)} FLUX of parallel assets` : ''}, ${flux2(proj.sums.total)} FLUX in all.${step ? ` The block reward is cut by ${Math.abs(step.change * 100).toFixed(0)}% on ${dateStamp(step.t)}, from ${flux2(step.before)} to ${flux2(step.after)} FLUX a day.` : ''}`;

  const tipAt = (i: number): PlotTip => {
    const rows: TipRow[] = [];
    if (includePa)
      rows.push({ label: 'Parallel assets (est.)', value: fmt(layers.pa[i] as number), color: PA });
    rows.push({ label: 'Native', value: fmt(layers.native[i] as number), color: NATIVE });
    if (includePa) rows.push({ label: 'Total', value: fmt(layers.top[i] as number) });
    rows.push({
      label: view === 'cumulative' ? 'That day alone' : 'Running total',
      value: fmt(
        (view === 'cumulative' ? (proj.total[i] as number) : (proj.cumulative[i] as number)) * scale,
      ),
    });
    return { head: dateStamp(proj.t[i] as number), aside: `day ${formatInt(i + 1)}`, rows };
  };

  return (
    <Plot
      kind="projection"
      title={view === 'cumulative' ? 'Projected earnings, running total' : 'Projected earnings, per day'}
      summary={summary}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={tick}
      marks={marks}
      track={track}
      anchor={(i) => layers.top[i] ?? null}
      dotColor="var(--text-1)"
      tip={tipAt}
      reading={(i) =>
        `${dateStamp(proj.t[i] as number)}: ${fmt(layers.top[i] as number)} ${unit === 'flux' ? 'FLUX' : money.currency.toUpperCase()}`
      }
      table={{
        head: [
          'Date (UTC)',
          'Native FLUX a day',
          'Parallel assets a day (est.)',
          'Running total FLUX',
          unit === 'money' ? 'Running total value' : 'Running total',
        ],
        row: (i) => [
          dateStamp(proj.t[i] as number),
          flux2(proj.native[i] as number),
          flux2(proj.pa[i] as number),
          flux2(proj.cumulative[i] as number),
          unit === 'money' && price !== null
            ? money.fmt((proj.cumulative[i] as number) * price)
            : flux2(proj.cumulative[i] as number),
        ],
      }}
      revealKey={revealKey}
      legend={
        <ul className="cp-legend" aria-label="Series">
          <LegendKey label="Native" color={NATIVE} />
          {includePa ? <LegendKey label="Parallel assets (estimated)" color={PA} /> : null}
          {step ? <LegendKey label="Reward cut" color="var(--text-2)" dashed /> : null}
        </ul>
      }
      note={
        step
          ? `On ${dateStamp(step.t)} (block ${formatInt(step.height)}) the reward falls ${Math.abs(step.change * 100).toFixed(0)}%, so the same fleet earns ${flux2(step.before)} FLUX a day before it and ${flux2(step.after)} after. A projection holds today’s nodes, queues and price; it is not a forecast.`
          : 'A projection holds today’s nodes, queues and price; it is not a forecast.'
      }
    />
  );
}

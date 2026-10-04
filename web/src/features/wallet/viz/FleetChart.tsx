// The fleet over time: how many confirmed nodes there were at the end of each UTC day, the tiers stacked in the colours
// that always mean those tiers. A legend toggles a tier to see it alone; the crosshair reads a day and says how many
// nodes it added or lost; the same numbers are in a table underneath.

import { type CSSProperties, useMemo, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { tierLabel } from '../../../ui';
import { dailyChange, describeFleet, type FleetSeries } from '../lib/activity';
import { dateStamp } from '../lib/csv';
import { DAY_MS } from '../lib/money';
import { axisCount, dayDomain } from '../lib/plotAxis';
import { areaPath, linePath, seriesPoints } from '../lib/stackPath';
import type { PayTier } from '../types';
import { TIER_COLOR } from './DailyChart';
import { LegendToggle, Plot, type PlotGeo, type PlotTip, type TipRow } from './Plot';

const colour = (c: string, extra?: CSSProperties) => ({ '--c': c, ...extra }) as CSSProperties;

const signed = (n: number): string =>
  n > 0 ? `+${formatInt(n)}` : n < 0 ? `-${formatInt(-n)}` : 'no change';

export interface FleetChartProps {
  /** The days, oldest first, at least two. */
  series: FleetSeries;
  /** The tiers that ever had a node, in stacking order (the first is at the bottom). */
  tiers: readonly PayTier[];
}

export function FleetChart({ series, tiers }: FleetChartProps) {
  const [hidden, setHidden] = useState<ReadonlySet<PayTier>>(new Set());
  const toggle = (t: PayTier) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const n = series.t.length;
  const shown = useMemo(() => tiers.filter((t) => !hidden.has(t)), [tiers, hidden]);

  // layers[k][i] is the top of the k-th shown tier on day i: the tiers below it plus its own.
  const layers = useMemo(() => {
    const out: number[][] = [];
    let acc: number[] = new Array<number>(n).fill(0);
    for (const t of shown) {
      acc = acc.map((v, i) => v + (series[t][i] as number));
      out.push(acc);
    }
    return out;
  }, [shown, series, n]);
  const tops = layers.at(-1) ?? new Array<number>(n).fill(0);

  const axis = useMemo(() => axisCount(Math.max(0, ...tops)), [tops]);
  const domain = useMemo(() => dayDomain(series.t), [series.t]);
  const centers = useMemo(() => series.t.map((t) => t + DAY_MS / 2), [series.t]);
  const change = useMemo(() => dailyChange(series), [series]);

  const marks = useMemo(
    () => (geo: PlotGeo) => {
      const base = geo.y(0);
      const lines = layers.map((top) => seriesPoints('steps', series.t, top, geo.x, geo.y));
      return (
        <>
          {shown.map((tier, k) => (
            <path
              key={tier}
              className="wl-fleetarea"
              d={areaPath(lines[k] ?? [], k === 0 ? null : (lines[k - 1] ?? null), base)}
              style={colour(TIER_COLOR[tier])}
            />
          ))}
          {shown.map((tier, k) => (
            <path
              key={`${tier}-edge`}
              className="wl-line"
              d={linePath(lines[k] ?? [])}
              style={colour(TIER_COLOR[tier], { strokeWidth: 1.5 })}
            />
          ))}
        </>
      );
    },
    [layers, shown, series.t],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => ({ x: centers.map((t) => geo.x(t)), y: tops.map((v) => geo.y(v)) }),
    [centers, tops],
  );

  const tipAt = (i: number): PlotTip => {
    const rows: TipRow[] = [...shown]
      .reverse()
      .map((t) => ({ label: tierLabel(t), value: formatInt(series[t][i] as number), color: TIER_COLOR[t] }));
    rows.push({ label: 'Nodes in all', value: formatInt(series.total[i] as number) });
    const d = change[i];
    if (d !== null && d !== undefined) rows.push({ label: 'That day', value: signed(d) });
    return {
      head: dateStamp(series.t[i] as number),
      aside: i === n - 1 ? 'today, so far' : 'end of the day',
      rows,
    };
  };

  return (
    <Plot
      kind="fleet-history"
      title="Confirmed nodes by tier"
      summary={describeFleet(series)}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={(v) => formatInt(v)}
      marks={marks}
      track={track}
      anchor={(i) => tops[i] ?? null}
      dotColor="var(--text-1)"
      tip={tipAt}
      reading={(i) => `${dateStamp(series.t[i] as number)}: ${formatInt(series.total[i] as number)} nodes`}
      table={{
        head: ['Date (UTC)', ...tiers.map((t) => tierLabel(t)), 'Nodes in all', 'Change'],
        row: (i) => [
          dateStamp(series.t[i] as number),
          ...tiers.map((t) => formatInt(series[t][i] as number)),
          formatInt(series.total[i] as number),
          change[i] === null || change[i] === undefined ? 'Unknown' : signed(change[i] as number),
        ],
      }}
      revealKey={`${n}:${tiers.join()}`}
      legend={
        <ul className="cp-legend" aria-label="Tiers">
          {[...tiers].reverse().map((t) => (
            <LegendToggle
              key={t}
              label={tierLabel(t)}
              color={TIER_COLOR[t]}
              on={!hidden.has(t)}
              onToggle={() => toggle(t)}
            />
          ))}
        </ul>
      }
      note="Each day is the number of confirmed nodes at its end; the last is today, so far."
    />
  );
}

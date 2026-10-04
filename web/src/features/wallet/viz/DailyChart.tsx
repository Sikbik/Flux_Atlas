// Daily earnings as stacked bars: one bar a UTC day, the tiers stacked in the colours that always mean those tiers, the
// parallel assets on top (hatched, because they are estimated from the run-rate and not measured). A legend toggles
// series; the crosshair reads a day; the unit switches between FLUX and money, each day valued at its own price.

import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { tierLabel } from '../../../ui';
import type { Money } from '../hooks/useMoney';
import { dateStamp } from '../lib/csv';
import { type Daily, isCompleteDay } from '../lib/earnings';
import { DAY_MS } from '../lib/money';
import { axisFromZero, dayDomain, fluxTick, roundedTop } from '../lib/plotAxis';
import type { PayTier } from '../types';
import { LegendToggle, Plot, type PlotGeo, type PlotTip, type TipRow } from './Plot';

export type Unit = 'flux' | 'money';

type SeriesId = PayTier | 'pa';

/** The colours that always mean the tiers, as a chart paints them. */
export const TIER_COLOR: Record<PayTier, string> = {
  cumulus: 'var(--tier-cumulus-ink)',
  nimbus: 'var(--tier-nimbus-ink)',
  stratus: 'var(--tier-stratus-ink)',
};
const PA_COLOR = 'var(--viz-1)';

const flux2 = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface DailyChartProps {
  daily: Daily;
  /** The tiers that earned in the range, in stacking order. */
  tiers: readonly PayTier[];
  includePa: boolean;
  unit: Unit;
  money: Money;
  /** Changes when the range does, so the marks draw in again. */
  rangeKey: string;
}

export function DailyChart({ daily, tiers, includePa, unit, money, rangeKey }: DailyChartProps) {
  const [hidden, setHidden] = useState<ReadonlySet<SeriesId>>(new Set());
  const toggle = (id: SeriesId) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const all = useMemo<{ id: SeriesId; label: string; color: string; estimate?: boolean }[]>(
    () => [
      ...tiers.map((t) => ({ id: t as SeriesId, label: tierLabel(t), color: TIER_COLOR[t] })),
      ...(includePa
        ? [{ id: 'pa' as SeriesId, label: 'Parallel assets (estimated)', color: PA_COLOR, estimate: true }]
        : []),
    ],
    [tiers, includePa],
  );
  const shown = useMemo(() => all.filter((s) => !hidden.has(s.id)), [all, hidden]);

  const n = daily.t.length;
  /** What series `s` adds to day `i`, in the unit shown (money is that day's FLUX at that day's price). */
  const amount = useCallback(
    (i: number, s: SeriesId): number => {
      const raw = s === 'pa' ? (daily.pa[i] as number) : (daily[s][i] as number);
      if (unit === 'flux') return raw;
      const p = daily.price[i];
      return p === null || p === undefined ? 0 : raw * p;
    },
    [daily, unit],
  );

  const tops = useMemo(
    () => daily.t.map((_, i) => shown.reduce((sum, s) => sum + amount(i, s.id), 0)),
    [daily.t, shown, amount],
  );
  const axis = useMemo(() => axisFromZero(Math.max(0, ...tops)), [tops]);
  const domain = useMemo(() => dayDomain(daily.t), [daily.t]);

  const fmt = (v: number): string => (unit === 'flux' ? flux2(v) : money.fmt(v));
  const tick = (v: number, step: number): string =>
    unit === 'flux' ? fluxTick(v, step) : money.fmt(v, { compact: true });

  const marks = useMemo(
    () => (geo: PlotGeo) => {
      const slot = geo.plot.w / Math.max(1, n);
      const bw = Math.max(1.5, slot * (n > 90 ? 0.8 : 0.7));
      const r = Math.min(2.5, bw / 3);
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
          {daily.t.map((t, i) => {
            const x = geo.x(t) + (slot - bw) / 2;
            let acc = 0;
            const running = !isCompleteDay(daily, i);
            return (
              <g key={t}>
                {shown.map((s, k) => {
                  const v = amount(i, s.id);
                  if (!(v > 0)) return null;
                  const y1 = geo.y(acc + v);
                  const y0 = geo.y(acc);
                  acc += v;
                  const h = Math.max(0, y0 - y1);
                  if (h < 0.4) return null;
                  const top =
                    k === shown.length - 1 || shown.slice(k + 1).every((o) => !(amount(i, o.id) > 0));
                  const style = { '--c': s.color } as CSSProperties;
                  return top ? (
                    <path
                      key={s.id}
                      className="wl-bar"
                      d={roundedTop(x, y1, bw, h, r)}
                      style={style}
                      data-estimate={s.estimate || undefined}
                      data-running={running || undefined}
                    />
                  ) : (
                    <rect
                      key={s.id}
                      className="wl-bar"
                      x={x}
                      y={y1}
                      width={bw}
                      height={h}
                      style={style}
                      data-estimate={s.estimate || undefined}
                      data-running={running || undefined}
                    />
                  );
                })}
              </g>
            );
          })}
        </>
      );
    },
    [daily, shown, amount, n],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => {
      const slot = geo.plot.w / Math.max(1, n);
      return { x: daily.t.map((t) => geo.x(t) + slot / 2), y: tops.map((v) => geo.y(v)) };
    },
    [daily.t, tops, n],
  );

  const totalFlux = daily.native.reduce((s, v) => s + v, 0);
  const summary =
    n === 0
      ? 'No earnings in this range.'
      : `Daily earnings over ${formatInt(n)} ${n === 1 ? 'day' : 'days'}, ${dateStamp(daily.t[0] as number)} to ${dateStamp(daily.t[n - 1] as number)}: ${flux2(totalFlux)} FLUX of native payouts${unit === 'money' ? `, valued each day at its own price in ${money.currency.toUpperCase()}` : ''}.`;

  const centers = useMemo(() => daily.t.map((t) => t + DAY_MS / 2), [daily.t]);

  const tipAt = (i: number): PlotTip => {
    const price = daily.price[i];
    const rows: TipRow[] = [...shown]
      .reverse()
      .map((s) => ({ label: s.label, value: fmt(amount(i, s.id)), color: s.color }));
    rows.push({ label: 'Total', value: fmt(tops[i] as number) });
    if (unit === 'money')
      rows.push({
        label: daily.approximate ? 'Price that day, approx.' : 'Price that day',
        value: price === null || price === undefined ? 'Unknown' : money.fmt(price, { digits: 4 }),
      });
    return {
      head: dateStamp(daily.t[i] as number),
      aside:
        daily.partialLast && i === n - 1
          ? 'running day'
          : daily.partialFirst && i === 0
            ? 'partial day'
            : `${formatInt(daily.payments[i] as number)} payments`,
      rows,
    };
  };

  return (
    <Plot
      kind="daily-earnings"
      title="Daily earnings by tier"
      summary={summary}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={tick}
      marks={marks}
      track={track}
      anchor={(i) => tops[i] ?? null}
      dotColor="var(--text-1)"
      tip={tipAt}
      reading={(i) =>
        `${dateStamp(daily.t[i] as number)}: ${fmt(tops[i] as number)} ${unit === 'flux' ? 'FLUX' : money.currency.toUpperCase()}`
      }
      table={{
        head: [
          'Date (UTC)',
          ...tiers.map((t) => `${tierLabel(t)} FLUX`),
          ...(includePa ? ['Parallel assets FLUX (est.)'] : []),
          'Payments',
          'Price that day',
          'Value',
        ],
        row: (i) => [
          dateStamp(daily.t[i] as number),
          ...tiers.map((t) => flux2(daily[t][i] as number)),
          ...(includePa ? [flux2(daily.pa[i] as number)] : []),
          formatInt(daily.payments[i] as number),
          daily.price[i] === null ? 'Unknown' : money.fmt(daily.price[i] as number, { digits: 4 }),
          (includePa ? daily.valueWithPa[i] : daily.value[i]) === null
            ? 'Unknown'
            : money.fmt((includePa ? daily.valueWithPa[i] : daily.value[i]) as number),
        ],
      }}
      revealKey={`${rangeKey}:${unit}:${includePa}`}
      legend={
        <ul className="cp-legend" aria-label="Series">
          {all
            .slice()
            .reverse()
            .map((s) => (
              <LegendToggle
                key={s.id}
                label={s.label}
                color={s.color}
                on={!hidden.has(s.id)}
                onToggle={() => toggle(s.id)}
              />
            ))}
        </ul>
      }
      note={
        <>
          {includePa
            ? 'The hatched part is the parallel assets, estimated from the wallet’s run-rate: the server states the pace, not each day. '
            : ''}
          {unit === 'money' && daily.approximate
            ? `Each day is valued at that day’s dollar price at today’s ${money.currency.toUpperCase()} exchange rate, so it is approximate.`
            : ''}
        </>
      }
    />
  );
}

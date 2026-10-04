// What was actually paid, day by day: the totals for the range, and the stacked daily chart. The range, the unit and the
// parallel assets switch live; the chart draws in again for a new range and stands still otherwise.
//
// Atlas keeps the payouts of the blocks it has stored, at most thirty days, and the first and last day of that window are
// partial (it begins part way through a day, and today is still running). The averages count whole days only; the
// totals count everything that was paid. A freshly started server has little or nothing, and says so.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { AnimatedNumber, SegmentedControl, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { formatDay } from '../../lib/dates';
import {
  buildDaily,
  type EarningsRange,
  effectiveRange,
  parallelRatio,
  rangesFor,
  sliceDays,
  totalsOf,
} from '../../lib/earnings';
import { flux } from '../../lib/money';
import { useWalletPrefs } from '../../prefs';
import { PAY_TIERS } from '../../types';
import { FitStat } from '../../ui/FitStat';
import { Panel } from '../../ui/Panel';
import { DailyChart, type Unit } from '../../viz/DailyChart';
import { formatFlux2 } from '../overview/Standing';

export function Realized({ unit, onUnit }: { unit: Unit; onUnit: (u: Unit) => void }) {
  const { dto, money } = useWalletCtx();
  const stored = useWalletPrefs((s) => s.earningsRange);
  const setRange = useWalletPrefs((s) => s.setEarningsRange);
  const includePa = useWalletPrefs((s) => s.includePa);
  const e = dto.earnings;

  const range = effectiveRange(stored, e.days.length);
  const options = rangesFor(e.days.length);
  const days = useMemo(() => sliceDays(e.days, range), [e.days, range]);
  const ratio = parallelRatio(flux(e.native_per_day), flux(e.pa_per_day));
  const daily = useMemo(
    () =>
      buildDaily({
        days,
        coveredFromMs: e.covered_from_ms,
        ratio,
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [days, e.covered_from_ms, ratio, money.history, money.spot, money.currency],
  );
  const totals = useMemo(() => totalsOf(daily), [daily]);
  const tiers = useMemo(() => PAY_TIERS.filter((t) => daily[t].some((v) => v > 0)), [daily]);

  if (e.days.length === 0) {
    return (
      <Panel title="Daily earnings">
        <p className="wl-note">
          No payouts are on record for this address yet. Atlas builds this history from the blocks it has
          stored, so a server that has just started has little of it. Each payout appears here, stacked by
          tier, as its block arrives.
        </p>
      </Panel>
    );
  }

  const withPa = includePa ? totals.native + totals.pa : totals.native;
  const partial: string[] = [];
  if (daily.partialFirst && e.covered_from_ms !== null) {
    partial.push(
      `the first day is partial because the stored blocks begin on ${formatDay(daily.t[0] as number)}`,
    );
  }
  if (daily.partialLast) partial.push('today is still running');

  return (
    <Panel
      title="Daily earnings"
      aside={`${formatInt(days.length)} ${days.length === 1 ? 'day' : 'days'}, UTC`}
      actions={
        <>
          <SegmentedControl
            size="sm"
            aria-label="Unit"
            value={unit}
            onChange={onUnit}
            options={[
              { value: 'flux', label: 'FLUX' },
              { value: 'money', label: money.currency.toUpperCase(), disabled: !money.ready },
            ]}
          />
          {options.length > 1 ? (
            <SegmentedControl
              size="sm"
              aria-label="Range"
              value={range}
              onChange={(v) => setRange(v as EarningsRange)}
              options={options.map((r) => ({ value: r.value, label: r.label }))}
            />
          ) : null}
        </>
      }
    >
      <StatGrid min={150}>
        <FitStat
          label="Paid in range"
          fit={formatFlux2(totals.native)}
          value={<AnimatedNumber value={totals.native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={totals.value === null ? undefined : `${money.fmt(totals.value)} at each day's price`}
        />
        <FitStat
          label="A day on average"
          fit={totals.average === null ? null : formatFlux2(totals.average)}
          value={
            totals.average === null ? null : (
              <AnimatedNumber value={totals.average} format={formatFlux2} maxHz={0} />
            )
          }
          unit="FLUX"
          caption={
            totals.average === null
              ? 'needs one whole day'
              : `over ${formatInt(totals.completeDays)} whole ${totals.completeDays === 1 ? 'day' : 'days'}`
          }
        />
        <FitStat
          label="Best day"
          fit={totals.best ? formatFlux2(totals.best.native) : null}
          value={
            totals.best ? <AnimatedNumber value={totals.best.native} format={formatFlux2} maxHz={0} /> : null
          }
          unit="FLUX"
          caption={totals.best ? formatDay(totals.best.t) : undefined}
        />
        <Stat
          label="Payments"
          value={<AnimatedNumber value={totals.payments} maxHz={0} />}
          caption={
            totals.payments > 0
              ? `${formatFlux2(totals.native / totals.payments)} FLUX each on average`
              : undefined
          }
        />
      </StatGrid>
      {includePa ? (
        <p className="wl-note">
          With parallel assets, estimated from the wallet's run-rate, this range is worth about{' '}
          <b>{formatFlux2(withPa)} FLUX</b>.
        </p>
      ) : null}
      <DailyChart
        daily={daily}
        tiers={tiers}
        includePa={includePa}
        unit={unit}
        money={money}
        rangeKey={range}
      />
      {partial.length > 0 ? (
        <p className="wl-note">Averages count whole days only: {partial.join(', and ')}.</p>
      ) : null}
    </Panel>
  );
}

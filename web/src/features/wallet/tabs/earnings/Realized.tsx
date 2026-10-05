// What was actually paid, day by day: the totals for the range, and the stacked daily chart. The range, the unit and the
// parallel assets switch live; the chart draws in again for a new range and stands still otherwise. With parallel
// assets counted (the default), each day adds what its payouts accrued on the parallel-asset chains, the server's
// figure, claimable through Flux Fusion rather than received on the main chain.
//
// Atlas keeps the payouts of the blocks it has stored, at most thirty days, and the first and last day of that window are
// partial (it begins part way through a day, and today is still running). The averages count whole days only; the
// totals count everything that was paid. A freshly started server has little or nothing, and says so.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { useUi } from '../../../../store/ui';
import { AnimatedNumber, SegmentedControl, Stat, StatGrid } from '../../../../ui';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useWalletCtx } from '../../context';
import { formatDay } from '../../lib/dates';
import {
  buildDaily,
  type EarningsRange,
  effectiveRange,
  rangesFor,
  sliceDays,
  totalsOf,
} from '../../lib/earnings';
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
  const includePa = useUi((s) => s.includePa);
  const e = dto.earnings;

  const range = effectiveRange(stored, e.days.length);
  const options = rangesFor(e.days.length);
  const days = useMemo(() => sliceDays(e.days, range), [e.days, range]);
  const daily = useMemo(
    () =>
      buildDaily({
        days,
        coveredFromMs: e.covered_from_ms,
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [days, e.covered_from_ms, money.history, money.spot, money.currency],
  );
  const totals = useMemo(() => totalsOf(daily, includePa), [daily, includePa]);
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
          <EarningsBasis
            realized
            split={{ native: totals.native, pa: totals.pa }}
            per="in range"
            money={(v) => (money.price === null ? null : money.text(v))}
          />
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
          label={includePa ? 'Earned in range' : 'Paid in range'}
          fit={formatFlux2(totals.total)}
          value={<AnimatedNumber value={totals.total} format={formatFlux2} maxHz={0} />}
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
          fit={totals.best ? formatFlux2(totals.best.amount) : null}
          value={
            totals.best ? <AnimatedNumber value={totals.best.amount} format={formatFlux2} maxHz={0} /> : null
          }
          unit="FLUX"
          caption={totals.best ? formatDay(totals.best.t) : undefined}
        />
        <Stat
          label="Payments"
          value={<AnimatedNumber value={totals.payments} maxHz={0} />}
          caption={
            totals.payments > 0
              ? `${formatFlux2(totals.native / totals.payments)} FLUX each on the main chain, on average`
              : undefined
          }
        />
      </StatGrid>
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

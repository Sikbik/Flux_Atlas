// What was actually paid, day by day: the totals for the range, and the stacked daily chart. The range, the unit and the
// parallel assets switch live; the chart draws in again for a new range and stands still otherwise.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { AnimatedNumber, SegmentedControl, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { formatDay } from '../../lib/dates';
import {
  buildDaily,
  EARNINGS_RANGES,
  type EarningsRange,
  parallelRatio,
  sliceDays,
  totalsOf,
} from '../../lib/earnings';
import { flux } from '../../lib/money';
import { useWalletPrefs } from '../../prefs';
import { PAY_TIERS } from '../../types';
import { Panel } from '../../ui/Panel';
import { DailyChart, type Unit } from '../../viz/DailyChart';
import { formatFlux2 } from '../overview/Standing';

export function Realized({ unit, onUnit }: { unit: Unit; onUnit: (u: Unit) => void }) {
  const { dto, money } = useWalletCtx();
  const range = useWalletPrefs((s) => s.earningsRange);
  const setRange = useWalletPrefs((s) => s.setEarningsRange);
  const includePa = useWalletPrefs((s) => s.includePa);
  const e = dto.earnings;

  const days = useMemo(() => sliceDays(e.days, range), [e.days, range]);
  const ratio = parallelRatio(flux(e.native_per_day), flux(e.pa_per_day));
  const daily = useMemo(
    () =>
      buildDaily({
        days,
        ratio,
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [days, ratio, money.history, money.spot, money.currency],
  );
  const totals = useMemo(() => totalsOf(daily), [daily]);
  const tiers = useMemo(() => PAY_TIERS.filter((t) => daily[t].some((v) => v > 0)), [daily]);

  if (e.days.length === 0) {
    return (
      <Panel title="Daily earnings">
        <p className="wl-note">
          Nothing has been paid to this address in the period Atlas has recorded. When a node is paid, each
          day appears here, stacked by tier.
        </p>
      </Panel>
    );
  }

  const withPa = includePa ? totals.native + totals.pa : totals.native;
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
          <SegmentedControl
            size="sm"
            aria-label="Range"
            value={range}
            onChange={(v) => setRange(v as EarningsRange)}
            options={EARNINGS_RANGES.map((r) => ({ value: r.value, label: r.label }))}
          />
        </>
      }
    >
      <StatGrid min={150}>
        <Stat
          label="Paid in range"
          value={<AnimatedNumber value={totals.native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={totals.value === null ? undefined : `${money.fmt(totals.value)} at each day's price`}
        />
        <Stat
          label="A day on average"
          value={<AnimatedNumber value={totals.average} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={daily.partialLast ? 'complete days only' : undefined}
        />
        <Stat
          label="Best day"
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
    </Panel>
  );
}

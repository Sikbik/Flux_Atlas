// What the wallet earns at its current pace, per hour, day, month or year, in FLUX and in the viewer's currency: the
// native payouts, the parallel assets that accrue beside them, and the two together. The pace is the server's
// run-rate; the last seven days beside it are what was actually paid, so the two can be checked against each other.

import { useMemo, useState } from 'react';
import { AnimatedNumber, Delta, SegmentedControl, Stat, StatGrid, Switch } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { flux, MONTH_DAYS, YEAR_DAYS } from '../../lib/money';
import { useWalletPrefs } from '../../prefs';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

type Period = 'hour' | 'day' | 'month' | 'year';

const PERIODS: readonly { value: Period; label: string; days: number; phrase: string }[] = [
  { value: 'hour', label: 'Hour', days: 1 / 24, phrase: 'per hour' },
  { value: 'day', label: 'Day', days: 1, phrase: 'per day' },
  { value: 'month', label: 'Month', days: MONTH_DAYS, phrase: 'per month' },
  { value: 'year', label: 'Year', days: YEAR_DAYS, phrase: 'per year' },
];

/** The newest `n` complete-or-running days' native total, and the `n` before them. */
export function lastDays(
  days: readonly { native: string }[],
  n: number,
): { last: number; before: number | null } {
  const tail = days.slice(-n);
  const prev = days.slice(-2 * n, -n);
  const sum = (list: readonly { native: string }[]) => list.reduce((s, d) => s + flux(d.native), 0);
  return { last: sum(tail), before: prev.length === n ? sum(prev) : null };
}

export function RunRate() {
  const { dto, money } = useWalletCtx();
  const includePa = useWalletPrefs((s) => s.includePa);
  const setIncludePa = useWalletPrefs((s) => s.setIncludePa);
  const [period, setPeriod] = useState<Period>('day');
  const spec = PERIODS.find((p) => p.value === period) ?? (PERIODS[1] as (typeof PERIODS)[number]);

  const e = dto.earnings;
  const nativeDay = flux(e.native_per_day);
  const paDay = flux(e.pa_per_day);
  const native = nativeDay * spec.days;
  const pa = paDay * spec.days;
  const total = native + (includePa ? pa : 0);

  const week = useMemo(() => lastDays(e.days, 7), [e.days]);
  const change = week.before !== null && week.before > 0 ? (week.last / week.before - 1) * 100 : null;
  const weekAvg = e.days.length > 0 ? week.last / Math.min(7, e.days.length) : 0;
  const paceVsWeek = nativeDay > 0 && weekAvg > 0 ? (weekAvg / nativeDay - 1) * 100 : null;

  const none = dto.nodes.length === 0 || (nativeDay === 0 && paDay === 0);

  return (
    <Panel
      title="Earning now"
      aside={`at the current pace, ${spec.phrase}`}
      actions={
        <SegmentedControl
          size="sm"
          aria-label="Period"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        />
      }
    >
      <StatGrid min={150} columns={2} className="wl-runrate">
        <Stat
          label="Native FLUX"
          value={none ? '0.00' : <AnimatedNumber value={native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? 'No node is earning yet' : money.text(native)}
        />
        <Stat
          label="Parallel assets"
          value={none ? '0.00' : <AnimatedNumber value={pa} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? undefined : includePa ? money.text(pa) : `${money.text(pa)}, not counted below`}
        />
        <Stat
          label={includePa ? 'Total' : 'Total, native only'}
          value={none ? '0.00' : <AnimatedNumber value={total} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? undefined : money.text(total)}
        />
        <Stat
          label="Paid, last 7 days"
          value={
            e.days.length === 0 ? null : <AnimatedNumber value={week.last} format={formatFlux2} maxHz={0} />
          }
          unit="FLUX"
          delta={
            change === null ? undefined : (
              <Delta value={change} kind="percent" decimals={1} period="vs the week before" />
            )
          }
          caption={
            e.days.length === 0
              ? undefined
              : paceVsWeek === null
                ? `${formatFlux2(weekAvg)} FLUX a day`
                : `${formatFlux2(weekAvg)} a day, ${Math.abs(paceVsWeek).toFixed(1)}% ${paceVsWeek >= 0 ? 'over' : 'under'} the pace`
          }
        />
      </StatGrid>
      <Switch
        checked={includePa}
        onChange={setIncludePa}
        label="Count parallel assets as income"
        description="They are worth what they sell for once claimed, which is not certain. This also sets the projection and the profit."
      />
    </Panel>
  );
}

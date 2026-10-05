// What the wallet earns at its current pace, per hour, day, month or year, in FLUX and in the viewer's currency: the
// main-chain payouts, the parallel assets that accrue beside them, and the two together. The pace is the server's
// run-rate; the last seven days beside it are what was actually paid (with what it accrued, on the same basis), so
// the two can be checked against each other.

import { useMemo, useState } from 'react';
import { useUi } from '../../../../store/ui';
import { AnimatedNumber, Delta, SegmentedControl, StatGrid, Switch } from '../../../../ui';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useWalletCtx } from '../../context';
import { wholeDays } from '../../lib/earnings';
import { flux, MONTH_DAYS, YEAR_DAYS } from '../../lib/money';
import { FitStat } from '../../ui/FitStat';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

type Period = 'hour' | 'day' | 'month' | 'year';

const PERIODS: readonly { value: Period; label: string; days: number; phrase: string }[] = [
  { value: 'hour', label: 'Hour', days: 1 / 24, phrase: 'per hour' },
  { value: 'day', label: 'Day', days: 1, phrase: 'per day' },
  { value: 'month', label: 'Month', days: MONTH_DAYS, phrase: 'per month' },
  { value: 'year', label: 'Year', days: YEAR_DAYS, phrase: 'per year' },
];

/**
 * What the newest `n` complete-or-running days earned, and the `n` before them: the main chain, plus what it accrued
 * in parallel assets when they count.
 */
export function lastDays(
  days: readonly { native: string; pa: string }[],
  n: number,
  includePa: boolean,
): { last: number; before: number | null } {
  const tail = days.slice(-n);
  const prev = days.slice(-2 * n, -n);
  const sum = (list: readonly { native: string; pa: string }[]) =>
    list.reduce((s, d) => s + flux(d.native) + (includePa ? flux(d.pa) : 0), 0);
  return { last: sum(tail), before: prev.length === n ? sum(prev) : null };
}

export function RunRate() {
  const { dto, money } = useWalletCtx();
  const includePa = useUi((s) => s.includePa);
  const setIncludePa = useUi((s) => s.setIncludePa);
  const [period, setPeriod] = useState<Period>('day');
  const spec = PERIODS.find((p) => p.value === period) ?? (PERIODS[1] as (typeof PERIODS)[number]);

  const e = dto.earnings;
  const nativeDay = flux(e.native_per_day);
  const paDay = flux(e.pa_per_day);
  const native = nativeDay * spec.days;
  const pa = paDay * spec.days;
  const total = native + (includePa ? pa : 0);

  // What was paid in the last seven days, as stored. The comparisons (a week against the week before, the daily
  // average against the pace) use whole days only: the window's first day and the running day are partial, and a
  // partial day would read as a drop.
  const week = useMemo(() => lastDays(e.days, 7, includePa), [e.days, includePa]);
  const whole = useMemo(() => {
    const list = wholeDays(e.days, e.covered_from_ms, Date.now());
    return { ...lastDays(list, 7, includePa), count: Math.min(7, list.length) };
  }, [e.days, e.covered_from_ms, includePa]);
  const change = whole.before !== null && whole.before > 0 ? (whole.last / whole.before - 1) * 100 : null;
  const weekAvg = whole.count > 0 ? whole.last / whole.count : 0;
  // The pace on the same basis as the week, so the two compare like with like.
  const paceDay = nativeDay + (includePa ? paDay : 0);
  const paceVsWeek = paceDay > 0 && weekAvg > 0 ? (weekAvg / paceDay - 1) * 100 : null;

  const idle = dto.nodes.length === 0;
  const none = idle || (nativeDay === 0 && paDay === 0);
  const stored = e.days.length > 0;

  return (
    <Panel
      title="Earning now"
      aside={`at the current pace, ${spec.phrase}`}
      actions={
        <>
          <EarningsBasis
            split={none ? null : { native, pa }}
            per={spec.phrase}
            money={(v) => (money.price === null ? null : money.text(v))}
          />
          <SegmentedControl
            size="sm"
            aria-label="Period"
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </>
      }
    >
      <StatGrid min={150} columns={2} className="wl-runrate">
        <FitStat
          label="Main chain"
          fit={none ? '0.00' : formatFlux2(native)}
          value={none ? '0.00' : <AnimatedNumber value={native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? 'No node is earning yet' : money.text(native)}
        />
        <FitStat
          label="Parallel assets"
          fit={none ? '0.00' : formatFlux2(pa)}
          value={none ? '0.00' : <AnimatedNumber value={pa} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? undefined : includePa ? money.text(pa) : `${money.text(pa)}, not counted below`}
        />
        <FitStat
          label={includePa ? 'Total' : 'Total, main chain only'}
          fit={none ? '0.00' : formatFlux2(total)}
          value={none ? '0.00' : <AnimatedNumber value={total} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={none ? undefined : money.text(total)}
        />
        <FitStat
          label={includePa ? 'Earned, last 7 days' : 'Paid, last 7 days'}
          fit={stored ? formatFlux2(week.last) : idle ? '0.00' : null}
          value={
            stored ? (
              <AnimatedNumber value={week.last} format={formatFlux2} maxHz={0} />
            ) : idle ? (
              '0.00'
            ) : null
          }
          unit="FLUX"
          delta={
            change === null ? undefined : (
              <Delta value={change} kind="percent" decimals={1} period="vs the week before" />
            )
          }
          caption={
            !stored
              ? idle
                ? 'No node is paid to this address'
                : 'No payment is stored yet'
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
        description="They are worth what they sell for once claimed, which is not certain. This sets every earnings figure in Atlas, here and in the operator, node and Nodes views."
      />
    </Panel>
  );
}

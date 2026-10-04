// The recent days of earnings as bars, and what they add up to. Atlas keeps the payouts of the blocks it has stored, at
// most thirty days. The full chart, the projection and the profit are the Earnings tab; this is the glance that tells
// whether it is worth opening.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { AnimatedNumber, Delta, Sparkline, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { buildDaily, isCompleteDay, parallelRatio, totalsOf } from '../../lib/earnings';
import { flux } from '../../lib/money';
import { FitStat } from '../../ui/FitStat';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

export function EarningsGlance() {
  const { dto, money, setTab } = useWalletCtx();
  const e = dto.earnings;
  const daily = useMemo(
    () =>
      buildDaily({
        days: e.days,
        coveredFromMs: e.covered_from_ms,
        ratio: parallelRatio(flux(e.native_per_day), flux(e.pa_per_day)),
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [e.days, e.covered_from_ms, e.native_per_day, e.pa_per_day, money.history, money.spot, money.currency],
  );
  const t = useMemo(() => totalsOf(daily), [daily]);

  // The shape of the whole days: the window's first day and the running one are artefacts of where it starts and
  // ends, and would draw a dip at each edge.
  const whole = useMemo(() => daily.native.filter((_, i) => isCompleteDay(daily, i)), [daily]);
  const half = Math.floor(whole.length / 2);
  const recent = whole.slice(half).reduce((s, v) => s + v, 0);
  const earlier = whole.slice(0, half).reduce((s, v) => s + v, 0);
  const change = half >= 3 && earlier > 0 ? (recent / earlier - 1) * 100 : null;
  const n = e.days.length;

  if (n === 0) {
    return (
      <Panel title="Earnings, recent days">
        <p className="wl-note">
          No payout is on record for this address yet. Atlas builds this from the blocks it has stored, so
          earnings appear here from the first one it sees.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Earnings, ${formatInt(n)} ${n === 1 ? 'day' : 'days'}`}
      aside={`${formatInt(t.payments)} ${t.payments === 1 ? 'payment' : 'payments'}, UTC`}
    >
      <StatGrid min={140} columns={2}>
        <FitStat
          label="Paid"
          fit={formatFlux2(t.native)}
          value={<AnimatedNumber value={t.native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          delta={
            change === null ? undefined : (
              <Delta value={change} kind="percent" decimals={1} period="second half vs first" />
            )
          }
          caption={t.value === null ? undefined : money.fmt(t.value)}
          spark={
            whole.length >= 2 ? (
              <Sparkline values={whole} form="area" size="tile" label="Native FLUX per whole day" />
            ) : undefined
          }
        />
        <FitStat
          label="A day on average"
          fit={t.average === null ? null : formatFlux2(t.average)}
          value={
            t.average === null ? null : <AnimatedNumber value={t.average} format={formatFlux2} maxHz={0} />
          }
          unit="FLUX"
          caption={
            t.average === null
              ? 'needs one whole day'
              : t.best
                ? `best day ${formatFlux2(t.best.native)}`
                : undefined
          }
        />
      </StatGrid>
      <button type="button" className="wl-more" onClick={() => setTab('earnings')}>
        Open earnings, projection and profit
      </button>
    </Panel>
  );
}

// The last thirty days of earnings as bars, and what they add up to. The full chart, the projection and the profit
// are the Earnings tab; this is the glance that tells whether it is worth opening.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { AnimatedNumber, Delta, Sparkline, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { buildDaily, parallelRatio, sliceDays, totalsOf } from '../../lib/earnings';
import { flux } from '../../lib/money';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

export function EarningsGlance() {
  const { dto, money, setTab } = useWalletCtx();
  const e = dto.earnings;
  const days = useMemo(() => sliceDays(e.days, '30d'), [e.days]);
  const daily = useMemo(
    () =>
      buildDaily({
        days,
        ratio: parallelRatio(flux(e.native_per_day), flux(e.pa_per_day)),
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [days, e.native_per_day, e.pa_per_day, money.history, money.spot, money.currency],
  );
  const t = useMemo(() => totalsOf(daily), [daily]);

  const half = Math.floor(daily.native.length / 2);
  const recent = daily.native.slice(half).reduce((s, v) => s + v, 0);
  const earlier = daily.native.slice(0, half).reduce((s, v) => s + v, 0);
  const change = half >= 3 && earlier > 0 ? (recent / earlier - 1) * 100 : null;

  if (e.days.length === 0) {
    return (
      <Panel title="Earnings, 30 days">
        <p className="wl-note">
          No payment has reached this wallet in the period Atlas has recorded. Earnings appear here from the
          first one.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Earnings, 30 days"
      aside={`${formatInt(days.length)} ${days.length === 1 ? 'day' : 'days'}, UTC`}
    >
      <StatGrid min={140} columns={2}>
        <Stat
          label="Paid"
          value={<AnimatedNumber value={t.native} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          delta={
            change === null ? undefined : (
              <Delta value={change} kind="percent" decimals={1} period="second half vs first" />
            )
          }
          caption={t.value === null ? undefined : money.fmt(t.value)}
          spark={<Sparkline values={daily.native} form="area" size="tile" label="Native FLUX per day" />}
        />
        <Stat
          label="A day on average"
          value={<AnimatedNumber value={t.average} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={t.best ? `best day ${formatFlux2(t.best.native)}` : undefined}
        />
      </StatGrid>
      <button type="button" className="wl-more" onClick={() => setTab('earnings')}>
        Open earnings, projection and profit
      </button>
    </Panel>
  );
}

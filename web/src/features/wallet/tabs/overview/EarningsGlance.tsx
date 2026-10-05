// The recent days of earnings as bars, and what they add up to, and the last 24 hours by block (the window the
// operator view counts, so the two agree). Atlas keeps the payouts of the blocks it has stored, at most thirty days.
// The full chart, the projection and the profit are the Earnings tab; this is the glance that tells whether it is
// worth opening.

import { useMemo } from 'react';
import { fluxToNumber, formatInt } from '../../../../lib/format';
import { useUi } from '../../../../store/ui';
import { AnimatedNumber, Delta, Sparkline, StatGrid } from '../../../../ui';
import { earnedOrNull } from '../../../earnings/basis';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useWalletCtx } from '../../context';
import { buildDaily, dayEarned, isCompleteDay, totalsOf } from '../../lib/earnings';
import { FitStat } from '../../ui/FitStat';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

export function EarningsGlance() {
  const { dto, money, setTab } = useWalletCtx();
  const includePa = useUi((s) => s.includePa);
  const e = dto.earnings;
  const daily = useMemo(
    () =>
      buildDaily({
        days: e.days,
        coveredFromMs: e.covered_from_ms,
        history: money.history,
        spot: money.spot,
        currency: money.currency,
        nowMs: Date.now(),
      }),
    [e.days, e.covered_from_ms, money.history, money.spot, money.currency],
  );
  const t = useMemo(() => totalsOf(daily, includePa), [daily, includePa]);
  const day = earnedOrNull(fluxToNumber(e.earned_24h), fluxToNumber(e.pa_earned_24h), includePa);

  // The shape of the whole days: the window's first day and the running one are artefacts of where it starts and
  // ends, and would draw a dip at each edge.
  const whole = useMemo(
    () => daily.t.flatMap((_, i) => (isCompleteDay(daily, i) ? [dayEarned(daily, i, includePa)] : [])),
    [daily, includePa],
  );
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
      actions={
        <EarningsBasis
          realized
          split={{ native: t.native, pa: t.pa }}
          per={`over ${formatInt(n)} ${n === 1 ? 'day' : 'days'}`}
          money={(v) => (money.price === null ? null : money.text(v))}
        />
      }
    >
      <StatGrid min={140} columns={3}>
        <FitStat
          label={includePa ? 'Earned' : 'Paid'}
          fit={formatFlux2(t.total)}
          value={<AnimatedNumber value={t.total} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          delta={
            change === null ? undefined : (
              <Delta value={change} kind="percent" decimals={1} period="second half vs first" />
            )
          }
          caption={t.value === null ? undefined : money.fmt(t.value)}
          spark={
            whole.length >= 2 ? (
              <Sparkline
                values={whole}
                form="area"
                size="tile"
                label={includePa ? 'FLUX earned per whole day' : 'Main-chain FLUX per whole day'}
              />
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
                ? `best day ${formatFlux2(t.best.amount)}`
                : undefined
          }
        />
        <FitStat
          label="Last 24 hours"
          fit={day === null ? null : formatFlux2(day)}
          value={day === null ? null : <AnimatedNumber value={day} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={day === null ? 'needs a whole day of blocks' : 'the last 2,880 blocks'}
        />
      </StatGrid>
      <button type="button" className="wl-more" onClick={() => setTab('earnings')}>
        Open earnings, projection and profit
      </button>
    </Panel>
  );
}

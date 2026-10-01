// The few numbers an operator opens the view for: how many nodes are fine, when the next payment
// lands, what the fleet earns a day, and what it earned over the last day, week and month.

import { formatInt } from '../../../lib/format';
import { AnimatedNumber, Section, Stat, StatGrid, tierLabel } from '../../../ui';
import type { EarnedWindow, Earnings } from '../derive/earnings';
import { etaShort } from '../derive/eta';
import type { FleetNode, FleetState } from '../derive/operator';
import { estimatePayment } from '../derive/queue';
import { useChainClock } from '../sources/live';

/**
 * Three tiles: three across when each can hold a figure with its unit, otherwise two with the third across
 * the whole row (see `.ix-trio` in operator.css).
 */
const TRIO_MIN = 156;

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEta = (s: number) => etaShort(s * 1000);

/** The soonest payment of the fleet, counting down. The only tile that re-renders every second. */
function NextPayoutStat({ next }: { next: FleetNode | null }) {
  const { tip, anchorMs, nowMs } = useChainClock();
  const est =
    next && next.position !== null && tip !== null && anchorMs !== null
      ? estimatePayment(next.position, 0, tip, anchorMs, nowMs)
      : null;
  return (
    <Stat
      label="Next payout"
      value={
        est ? <AnimatedNumber value={Math.round(est.etaMs / 1000)} format={fmtEta} roll={false} /> : null
      }
      caption={
        next && next.position !== null ? (
          <span title="An estimate: about 30 s per block">
            {next.tier === 'unknown' ? 'Place' : tierLabel(next.tier)} #{formatInt(next.position + 1)}
          </span>
        ) : (
          'Nothing in line'
        )
      }
      tier={next && next.tier !== 'unknown' ? next.tier : undefined}
    />
  );
}

export function FleetStats({
  total,
  counts,
  next,
  perDay,
}: {
  total: number;
  counts: Record<FleetState, number>;
  next: FleetNode | null;
  perDay: number | null;
}) {
  const worry = counts.risk + counts.down + counts.pending + counts.gone;
  return (
    <StatGrid min={TRIO_MIN} className="ix-trio">
      <Stat
        label="Healthy"
        value={<AnimatedNumber value={counts.ok} />}
        unit={`of ${formatInt(total)}`}
        caption={worry === 0 ? 'all confirmed' : `${formatInt(worry)} to look at`}
      />
      <NextPayoutStat next={next} />
      <Stat
        label="Per day"
        value={perDay === null ? null : <AnimatedNumber value={perDay} format={fmt2} />}
        unit="FLUX"
        caption="estimate"
      />
    </StatGrid>
  );
}

function windowCaption(w: EarnedWindow, short: string): string | undefined {
  if (w.flux === null) return undefined;
  if (w.estimate) return 'estimate';
  return w.complete ? undefined : short;
}

/** What the fleet was paid: 24 hours, 7 days and 30 days, each saying when it is an estimate or cut short. */
export function EarningsSection({
  earnings,
  pending,
  scope,
}: {
  earnings: Earnings;
  pending: boolean;
  /** Said under the figures when none is known, and why. */
  scope?: string;
}) {
  const e = earnings;
  const windows: [string, EarnedWindow][] = [
    ['24 hours', e.h24],
    ['7 days', e.d7],
    ['30 days', e.d30],
  ];
  const unknown = windows.every(([, w]) => w.flux === null);
  const notes = windows.map(([, w]) => windowCaption(w, 'since first ingest'));
  // When every figure carries the same note (a young ledger), say it once, in the heading.
  const shared = notes.every((n) => n === notes[0]) ? notes[0] : undefined;
  return (
    <Section
      title="Earnings"
      aside={pending ? undefined : (shared ?? (unknown ? undefined : 'paid to the fleet'))}
    >
      <StatGrid min={TRIO_MIN} className="ix-trio">
        {windows.map(([label, w], i) => (
          <Stat
            key={label}
            label={label}
            loading={pending}
            value={w.flux === null ? null : <AnimatedNumber value={w.flux} format={fmt2} />}
            unit="FLUX"
            caption={shared ? undefined : (notes[i] ?? (w.flux === null && scope ? scope : undefined))}
          />
        ))}
      </StatGrid>
    </Section>
  );
}

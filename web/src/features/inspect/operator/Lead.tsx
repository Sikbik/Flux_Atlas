// The few numbers an operator opens the view for: how many nodes are fine, when the next payment
// lands, what the fleet earns a day, and what it earned over the last day, week and month. Earnings are
// main chain plus the parallel assets it accrues, or main chain only, as the viewer chose; each group
// carries the marker that says which.

import { formatInt } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { AnimatedNumber, Section, Stat, StatGrid, tierLabel } from '../../../ui';
import { earnedOrNull, type PaSplit } from '../../earnings/basis';
import { EarningsBasis } from '../../earnings/EarningsBasis';
import { type EarnedWindow, type Earnings, earningTiles } from '../derive/earnings';
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
  perDay: nativePerDay,
  paPerDay,
  settling,
}: {
  total: number;
  counts: Record<FleetState, number>;
  next: FleetNode | null;
  /** Main-chain FLUX a day at today's queue lengths. */
  perDay: number | null;
  /** What that accrues a day in parallel assets. */
  paPerDay: number | null;
  /** Reachability is not known yet (see `FleetData.settling`): the healthy count would be a guess. */
  settling: boolean;
}) {
  const includePa = useUi((s) => s.includePa);
  const perDay = earnedOrNull(nativePerDay, paPerDay, includePa);
  const worry = counts.risk + counts.down + counts.pending + counts.gone;
  return (
    <StatGrid min={TRIO_MIN} className="ix-trio">
      {settling ? (
        <Stat label="Healthy" loading />
      ) : (
        <Stat
          label="Healthy"
          value={<AnimatedNumber value={counts.ok} />}
          unit={`of ${formatInt(total)}`}
          caption={worry === 0 ? 'all confirmed' : `${formatInt(worry)} to look at`}
        />
      )}
      <NextPayoutStat next={next} />
      <Stat
        label="Per day"
        value={perDay === null ? null : <AnimatedNumber value={perDay} format={fmt2} />}
        unit="FLUX"
        caption={
          <span className="eb-cap">
            <span>estimate</span>
            <EarningsBasis
              size="sm"
              split={
                nativePerDay === null || paPerDay === null ? null : { native: nativePerDay, pa: paPerDay }
              }
              per="a day"
            />
          </span>
        }
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
  split24,
  pending,
  scope,
}: {
  earnings: Earnings;
  /** The last 24 hours as main chain and parallel assets, for the marker's breakdown. */
  split24?: PaSplit | null;
  pending: boolean;
  /** Said under the figures when none is known, and why. */
  scope?: string;
}) {
  const e = earnings;
  const includePa = useUi((s) => s.includePa);
  const tiles = earningTiles([
    ['24 hours', e.h24],
    ['7 days', e.d7],
    ['30 days', e.d30],
  ]);
  const unknown = tiles.every((t) => t.window.flux === null);
  const notes = tiles.map((t) => windowCaption(t.window, 'since first ingest'));
  // When every figure carries the same note (a young ledger), say it once, in the heading.
  // A lone tile keeps its own note: a tile with no caption sits half empty.
  const shared = tiles.length > 1 && notes.every((n) => n === notes[0]) ? notes[0] : undefined;
  const three = tiles.length === 3;
  return (
    <Section
      title="Earnings"
      aside={
        pending
          ? undefined
          : (shared ?? (unknown ? undefined : includePa ? 'earned by the fleet' : 'paid to the fleet'))
      }
      actions={<EarningsBasis realized split={split24 ?? null} per="in 24 hours" />}
    >
      <StatGrid
        min={TRIO_MIN}
        columns={three ? undefined : tiles.length}
        className={three ? 'ix-trio' : undefined}
      >
        {tiles.map((t, i) => (
          <Stat
            key={t.label}
            label={t.merged ? 'Paid so far' : t.label}
            loading={pending}
            value={t.window.flux === null ? null : <AnimatedNumber value={t.window.flux} format={fmt2} />}
            unit="FLUX"
            caption={shared ? undefined : (notes[i] ?? (t.window.flux === null && scope ? scope : undefined))}
          />
        ))}
      </StatGrid>
    </Section>
  );
}

// The fleet at a glance, for whatever the filters left: how many nodes (with the tier mix drawn under the figure), how
// healthy (with the health mix), what they earn a day and who is paid next. The figures roll to their new values as the
// filters change, so narrowing the table reads as the numbers settling, not as a jump. They are not tinted: a smaller
// count after a filter is not a loss.

import { useMemo } from 'react';
import { formatInt, formatPercent, shortCollateral } from '../../../../lib/format';
import { useUi } from '../../../../store/ui';
import { AnimatedNumber, ShareBar, type ShareSegment, Stat, StatGrid } from '../../../../ui';
import { earnedOrNull } from '../../../earnings/basis';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useWalletCtx } from '../../context';
import type { RowSummary } from '../../lib/fleet';
import { Eta } from '../../ui/Eta';
import { FitStat } from '../../ui/FitStat';
import { formatFlux2 } from '../overview/Standing';

const TIER_WORD = { cumulus: 'Cumulus', nimbus: 'Nimbus', stratus: 'Stratus' } as const;

export interface StripProps {
  s: RowSummary;
  /** Nodes in the whole fleet, to say "of 208" when filters are set. */
  total: number;
}

export function Strip({ s, total }: StripProps) {
  const { money, fleet } = useWalletCtx();
  const includePa = useUi((st) => st.includePa);
  const perDay = earnedOrNull(s.perDay, s.paPerDay, includePa);
  const filtered = s.nodes !== total;
  const healthy = s.nodes === 0 ? null : s.healthy / s.nodes;

  const tiers = useMemo<ShareSegment[]>(
    () =>
      (['cumulus', 'nimbus', 'stratus'] as const).map((t) => ({
        id: t,
        label: TIER_WORD[t],
        value: s.tiers[t],
        tier: t,
      })),
    [s.tiers],
  );
  const states = useMemo<ShareSegment[]>(
    () => [
      { id: 'healthy', label: 'Healthy', value: s.healthy, color: 'var(--status-ok)' },
      { id: 'attention', label: 'Needs attention', value: s.attention, color: 'var(--status-warn)' },
      { id: 'down', label: 'Down or gone', value: s.down, color: 'var(--status-crit)' },
    ],
    [s.healthy, s.attention, s.down],
  );

  const nextNode = s.next ? fleet.rows.find((r) => r.key === s.next?.key) : undefined;
  const tierWords = (['stratus', 'nimbus', 'cumulus'] as const)
    .filter((t) => s.tiers[t] > 0)
    .map((t) => `${formatInt(s.tiers[t])} ${TIER_WORD[t]}`)
    .join(', ');
  const worry = [
    s.attention > 0 ? `${formatInt(s.attention)} need attention` : '',
    s.down > 0 ? `${formatInt(s.down)} down or gone` : '',
  ].filter(Boolean);

  return (
    <StatGrid min={140} className="wl-fstrip">
      <Stat
        label="Nodes"
        value={<AnimatedNumber value={s.nodes} format={formatInt} maxHz={0} tint={false} />}
        unit={filtered ? `of ${formatInt(total)}` : undefined}
        caption={
          <span className="wl-mix">
            {s.nodes > 0 ? (
              <ShareBar
                segments={tiers}
                legend="none"
                label="Nodes by tier"
                format={(v) => formatInt(Math.round(v))}
              />
            ) : null}
            <span>{tierWords || 'none in a tier yet'}</span>
          </span>
        }
      />
      <Stat
        label="Healthy"
        value={
          healthy === null ? null : (
            <AnimatedNumber value={healthy * 100} format={(v) => v.toFixed(0)} maxHz={0} tint={false} />
          )
        }
        unit={healthy === null ? undefined : '%'}
        caption={
          <span className="wl-mix">
            {s.nodes > 0 ? (
              <ShareBar
                segments={states}
                legend="none"
                label={`Nodes by health, ${formatPercent(healthy, 0)} healthy`}
                format={(v) => formatInt(Math.round(v))}
              />
            ) : null}
            <span>{worry.length > 0 ? worry.join(', ') : s.nodes > 0 ? 'every node is fine' : ''}</span>
          </span>
        }
      />
      <FitStat
        label="Earning a day"
        fit={perDay === null ? null : formatFlux2(perDay)}
        value={
          perDay === null ? null : (
            <AnimatedNumber value={perDay} format={formatFlux2} maxHz={0} tint={false} />
          )
        }
        unit={perDay === null ? undefined : 'FLUX'}
        caption={
          perDay === null ? (
            'tier payouts not known yet'
          ) : (
            <span className="eb-cap">
              <span>{money.text(perDay)}, an estimate</span>
              <EarningsBasis
                size="sm"
                split={s.paPerDay === null || s.perDay === null ? null : { native: s.perDay, pa: s.paPerDay }}
                per="a day"
                money={(v) => (money.price === null ? null : money.text(v))}
              />
            </span>
          )
        }
      />
      <Stat
        label="Paid next"
        value={s.next ? <Eta at={s.next.etaMs} /> : null}
        caption={
          s.next
            ? `${s.next.amount === null ? '' : `+${s.next.amount.toFixed(2)} FLUX on the main chain, `}${nextNode?.endpoint || shortCollateral(s.next.key)}`
            : s.nodes > 0
              ? 'none of these is queued'
              : undefined
        }
      />
    </StatGrid>
  );
}

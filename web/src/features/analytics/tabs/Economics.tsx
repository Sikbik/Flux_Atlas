// Economics: what a node earns. The headline is the best yearly yield on collateral across the tiers;
// the instrument is one tile per tier with the yield, FLUX per day, how often it is paid and where the
// yield lands after the next reward cut. Everything here is an estimate and says so. Earnings are main
// chain plus parallel assets (priced as FLUX), or main chain only, as the viewer chose; the marker in
// the header says which.

import { Coins } from 'lucide-react';
import { useMemo } from 'react';
import { useNetwork, usePrice, useTip } from '../../../app/context';
import { formatInt, formatPercent, parseFlux } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import {
  Chip,
  EntityLink,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  type TierName,
  tierLabel,
  ViewHeader,
} from '../../../ui';
import { EarningsBasis } from '../../earnings/EarningsBasis';
import { nextReductionHeight, payoutSchedule } from '../../explorer/lib/emission';
import { RouteLink } from '../../explorer/views/shared';
import { formatCycle, type TierInput, tierYields } from '../lib/economics';

const TIERS: readonly TierName[] = ['cumulus', 'nimbus', 'stratus'];

const flux = (amount: string | undefined): number => {
  const sats = parseFlux(amount ?? null);
  return sats === null ? 0 : Number(sats) / 1e8;
};

const perDay = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function EconomicsTab() {
  const tierStats = useNetwork((s) => s.tierStats);
  const tip = useTip();
  const price = usePrice();
  const includePa = useUi((s) => s.includePa);

  const model = useMemo(() => {
    if (tierStats.length === 0) return null;
    const inputs: TierInput[] = TIERS.map((tier) => {
      const s = tierStats.find((x) => x.tier === tier);
      return {
        tier,
        count: s?.count ?? 0,
        collateral: flux(s?.collateral),
        payout: flux(s?.payout),
        paPayout: flux(s?.pa_payout),
        cycleBlocks: s?.cycle_blocks ?? null,
      };
    });
    const cut = tip ? nextReductionHeight(tip.height) : null;
    const nextSched = cut === null ? null : payoutSchedule(cut);
    const next = nextSched
      ? {
          cumulus: Number(nextSched.cumulus) / 1e8,
          nimbus: Number(nextSched.nimbus) / 1e8,
          stratus: Number(nextSched.stratus) / 1e8,
        }
      : null;
    const rows = tierYields(inputs, next, includePa).sort((a, b) => b.apy - a.apy);
    return { rows, cut, hasCut: next !== null };
  }, [tierStats, tip, includePa]);

  if (!model) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading economics">
        <ViewHeader level={2} kind="Economics" icon={Coins} title="What a node earns" />
        <div className="ex-hero">
          <StatGrid min={220}>
            <Stat hero label="Best yearly yield on collateral" loading />
          </StatGrid>
        </div>
        <Section title="By tier">
          <Skeleton h={200} radius={12} />
        </Section>
      </div>
    );
  }
  const best = model.rows[0];
  if (!best) return null;
  const usd = price?.usd ?? null;

  return (
    <>
      <ViewHeader
        level={2}
        kind="Economics"
        icon={Coins}
        title="What a node earns"
        subtitle="The best estimated yield on collateral at today's rewards, before hosting costs and price changes."
      >
        <EarningsBasis />
        {usd !== null ? (
          <Chip mono title="The current FLUX price; dollar figures below are estimates at this price">
            FLUX ${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}
          </Chip>
        ) : null}
        {model.hasCut && model.cut !== null ? (
          <Chip title="Every payout falls by 10 percent at each reward cut">
            Next cut at block <EntityLink kind="block" value={model.cut} />, minus 10%
          </Chip>
        ) : null}
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            tier={best.tier}
            label={`Yearly yield on a ${tierLabel(best.tier)} node`}
            value={(best.apy * 100).toFixed(1)}
            unit="% a year"
            caption="an estimate, the best of the three tiers"
          />
        </StatGrid>
      </div>

      <Section title="By tier">
        <StatGrid min={200}>
          {model.rows.map((y) => (
            <Stat
              key={y.tier}
              tier={y.tier}
              label={tierLabel(y.tier)}
              value={formatPercent(y.apy)}
              unit="a year"
              caption={
                <>
                  {perDay(y.perDay)} FLUX a day
                  {usd !== null ? ` (about $${(y.perDay * usd).toFixed(2)})` : ''}, paid about every{' '}
                  {formatCycle(y.cycleHours)}, on {formatInt(y.collateral)} FLUX locked
                  {y.after ? `. ${formatPercent(y.after.apy)} after the next cut.` : '.'}
                </>
              }
            />
          ))}
        </StatGrid>
        <p className="ex-caption">
          Each block pays one node per tier. An estimate shares a tier's payouts over its payment cycle, so it
          moves with the number of nodes. <RouteLink to="/supply">See the emission schedule</RouteLink>.
        </p>
      </Section>
    </>
  );
}

// Economics: what a node earns. The headline is the best yearly yield on collateral across the tiers;
// the instrument is one row per tier with the yield as a bar, FLUX per day, how often it is paid and
// where the yield lands after the next reward cut. Everything here is an estimate and says so.

import { Coins } from 'lucide-react';
import { useMemo } from 'react';
import { useNetwork, usePrice, useTip } from '../../../app/context';
import { formatInt, formatPercent, parseFlux } from '../../../lib/format';
import { nextReductionHeight, payoutSchedule } from '../../explorer/lib/emission';
import {
  Chip,
  EntityHead,
  EntityLink,
  HeroNumber,
  RouteLink,
  Section,
  Skeleton,
  TIER_LABEL,
  TierGlyph,
  type TierName,
} from '../../explorer/parts';
import { formatCycle, type TierInput, tierYields } from '../lib/economics';
import { Meter } from '../viz/Meter';

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

  const model = useMemo(() => {
    if (tierStats.length === 0) return null;
    const inputs: TierInput[] = TIERS.map((tier) => {
      const s = tierStats.find((x) => x.tier === tier);
      return {
        tier,
        count: s?.count ?? 0,
        collateral: flux(s?.collateral),
        payout: flux(s?.payout),
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
    const rows = tierYields(inputs, next).sort((a, b) => b.apy - a.apy);
    return { rows, cut, hasCut: next !== null };
  }, [tierStats, tip]);

  if (!model) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading economics">
        <EntityHead kind="Economics" icon={Coins} title={<Skeleton w={240} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={300} radius={14} />
        </Section>
      </div>
    );
  }
  const best = model.rows[0];
  if (!best) return null;
  const maxApy = Math.max(...model.rows.map((r) => r.apy), 0.0001);
  const usd = price?.usd ?? null;

  return (
    <>
      <EntityHead
        kind="Economics"
        icon={Coins}
        status="ok"
        title={
          <HeroNumber
            whole={(best.apy * 100).toFixed(1)}
            frac="%"
            unit={`a year on a ${TIER_LABEL[best.tier]} node`}
          />
        }
        sub={
          <span>
            the best estimated yield on collateral at today's rewards, before hosting costs and price changes.
          </span>
        }
      >
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
      </EntityHead>

      <Section title="What a node earns" aside="estimates, per node">
        <ul className="an-yields" aria-label="Estimated earnings by tier">
          {model.rows.map((y) => (
            <li key={y.tier} className="an-yield" data-tier={y.tier}>
              <div className="an-yield__head">
                <span className="an-yield__tier">
                  <TierGlyph tier={y.tier} size={16} />
                  {TIER_LABEL[y.tier]}
                </span>
                <span className="an-yield__apy">
                  {formatPercent(y.apy)}
                  <small> a year</small>
                </span>
              </div>
              <Meter
                value={y.apy / maxApy}
                marker={y.after ? y.after.apy / maxApy : undefined}
                color={`var(--tier-${y.tier}-ink)`}
                label={`${TIER_LABEL[y.tier]}: ${formatPercent(y.apy)} a year${y.after ? `, ${formatPercent(y.after.apy)} after the next cut` : ''}`}
              />
              <div className="an-yield__facts">
                <span>
                  <strong className="ex-mono">{perDay(y.perDay)}</strong> FLUX a day
                  {usd !== null ? <> (about ${(y.perDay * usd).toFixed(2)})</> : null}
                </span>
                <span>on {formatInt(y.collateral)} FLUX locked</span>
                <span>paid about every {formatCycle(y.cycleHours)}</span>
                {y.after ? (
                  <span>
                    <strong className="ex-mono">{formatPercent(y.after.apy)}</strong> after the next cut
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="an-note">
          Each block pays one node per tier. An estimate shares a tier's payouts over its payment cycle, so it
          moves with the number of nodes. <RouteLink to="/supply">See the emission schedule</RouteLink>.
        </p>
      </Section>
    </>
  );
}

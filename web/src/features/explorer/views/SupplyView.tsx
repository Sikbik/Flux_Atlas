// /supply: how much FLUX exists, where it is, and the schedule that makes more. The headline is the
// total; beneath it the transparent and shielded pools against the announced (not enforced) 560M,
// the circulating figure labelled as the explorer's own, the next reward cut, and every cut after it.

import { Coins, Landmark, TrendingUp } from 'lucide-react';
import { useAddress, useSupply } from '../../../api/queries';
import { useTip } from '../../../app/context';
import { formatInt, formatSats, parseFlux } from '../../../lib/format';
import { ANNOUNCED_MAX_SUPPLY_FLUX, BLOCKS_PER_DAY, payoutSchedule } from '../lib/emission';
import { DEV_FUND_ADDRESS } from '../lib/entities';
import {
  Amount,
  Chip,
  CompactAmount,
  EntityHead,
  EntityLink,
  ErrorState,
  Freshness,
  HeroAmount,
  Section,
  Skeleton,
  Stat,
  StatGrid,
} from '../parts';
import { CutCard } from './supply/CutCard';
import { CutSchedule, DevFundChart, EmissionSection } from './supply/EmissionCharts';
import { SupplyGauge } from './supply/SupplyGauge';
import './supply/supply.css';

function SupplySkeleton() {
  return (
    <div className="ex-root" role="status" aria-busy="true" aria-label="Loading supply">
      <EntityHead kind="Supply" icon={Coins} title={<Skeleton w={300} h={46} radius={8} />} loading />
      <Section>
        <Skeleton h={90} radius={14} />
      </Section>
      <Section>
        <StatGrid>
          {[0, 1, 2, 3].map((i) => (
            <Stat key={i} label={<Skeleton w="50%" h={11} />} loading />
          ))}
        </StatGrid>
      </Section>
    </div>
  );
}

export function SupplyView() {
  const q = useSupply();
  const tip = useTip();
  const dev = useAddress(DEV_FUND_ADDRESS);
  const d = q.data;
  if (q.isPending) return <SupplySkeleton />;
  if (!d) {
    return (
      <div className="ex-root">
        <ErrorState title="Could not load the supply" onRetry={() => void q.refetch()}>
          The supply figures come from the chain explorer through this server; try again in a moment.
        </ErrorState>
      </div>
    );
  }
  const s = d.supply;
  const transparent = parseFlux(s?.transparent) ?? null;
  const shielded = parseFlux(s?.shielded) ?? null;
  const total = parseFlux(s?.total) ?? null;
  const circulating = parseFlux(s?.circulating_explorer) ?? null;
  const subsidy = parseFlux(d.reward);
  const perDay = parseFlux(d.emission_per_day);
  const t = tip ? { height: tip.height, timeMs: tip.time_ms } : null;
  const supplyFlux = total === null ? null : Number(total) / 1e8;
  const sched = s ? payoutSchedule(s.height) : null;
  const devPerDay = sched ? sched.devFundMin * BigInt(BLOCKS_PER_DAY) : null;
  return (
    <div className="ex-root">
      <EntityHead
        kind="Supply"
        icon={Coins}
        status="ok"
        aside={<Freshness label="supply" at={s?.updated_ms ?? null} cadenceMs={600_000} />}
        title={
          total === null ? (
            <span className="ex-head__word">Unknown</span>
          ) : (
            <HeroAmount sats={total} decimals={2} />
          )
        }
        sub={
          <span>
            Total supply{s ? <> at block {formatInt(s.height)}</> : null}: transparent coins plus the shielded
            pools.
          </span>
        }
      >
        {circulating !== null ? (
          <Chip title="The explorer's own circulating figure; its exclusion rule is not documented upstream">
            Circulating <CompactAmount value={circulating} unit={false} /> per explorer
          </Chip>
        ) : null}
      </EntityHead>

      <Section title="Against the announced cap" icon={TrendingUp}>
        {transparent !== null && shielded !== null ? (
          <SupplyGauge
            transparent={Number(transparent) / 1e8}
            shielded={Number(shielded) / 1e8}
            circulating={circulating === null ? null : Number(circulating) / 1e8}
            cap={ANNOUNCED_MAX_SUPPLY_FLUX}
          />
        ) : (
          <p className="ex-muted">The supply breakdown is not available yet.</p>
        )}
      </Section>

      <Section>
        <StatGrid columns={3} min={150}>
          <Stat
            label="Transparent"
            value={<CompactAmount value={transparent} unit={false} />}
            unit="FLUX"
            caption="in spendable outputs"
          />
          <Stat
            label="Shielded"
            value={<CompactAmount value={shielded} unit={false} />}
            unit="FLUX"
            caption={
              total !== null && shielded !== null && total > 0n
                ? `${((Number(shielded) / Number(total)) * 100).toFixed(2)}% of the supply`
                : undefined
            }
          />
          <Stat
            label="New FLUX a day"
            value={perDay === null ? null : <CompactAmount value={perDay} unit={false} />}
            unit="FLUX"
            caption={subsidy === null ? undefined : `${formatSats(subsidy, { decimals: 2 })} a block`}
          />
        </StatGrid>
      </Section>

      <CutCard />

      {t && supplyFlux !== null ? (
        <>
          <EmissionSection tip={t} supplyFlux={supplyFlux} />
          <Section
            title="Dev fund"
            icon={Landmark}
            collapsible
            defaultOpen={false}
            aside={
              <EntityLink kind="address" value={DEV_FUND_ADDRESS} className="ex-action">
                Open the address
              </EntityLink>
            }
          >
            <StatGrid min={170}>
              <Stat
                label="Fixed share per block"
                value={sched ? <Amount value={sched.devFundMin} decimals={2} unit={false} /> : null}
                unit="FLUX"
                caption="plus the fees of the block"
              />
              <Stat
                label="Inflow a day, at least"
                value={devPerDay === null ? null : <CompactAmount value={devPerDay} unit={false} />}
                unit="FLUX"
                caption={`${formatInt(BLOCKS_PER_DAY)} blocks`}
              />
              <Stat
                label="Received so far"
                value={dev.data ? <CompactAmount value={dev.data.received} unit={false} /> : null}
                unit="FLUX"
                loading={dev.isPending}
                caption="by the dev fund address"
              />
            </StatGrid>
            <div className="ex-gap" />
            <DevFundChart tip={t} supplyFlux={supplyFlux} />
          </Section>
          <CutSchedule tip={t} />
        </>
      ) : null}
    </div>
  );
}

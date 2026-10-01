// /supply: how much FLUX exists, where it is, and the schedule that makes more. The headline is the
// total; beneath it the transparent and shielded pools against the announced (not enforced) 560M,
// the circulating figure labelled as the explorer's own, the next reward cut, and every cut after it.

import { Coins, Landmark, TrendingUp } from 'lucide-react';
import { useAddress, useSupply } from '../../../api/queries';
import { useTip } from '../../../app/context';
import { formatCompact, formatInt, formatSats, parseFlux } from '../../../lib/format';
import {
  Amount,
  Chip,
  EntityLink,
  ErrorState,
  Freshness,
  formatAmountText,
  Section,
  ShareBar,
  Skeleton,
  Stack,
  Stat,
  StatGrid,
  ViewHeader,
} from '../../../ui';
import { ANNOUNCED_MAX_SUPPLY_FLUX, BLOCKS_PER_DAY, payoutSchedule } from '../lib/emission';
import { DEV_FUND_ADDRESS } from '../lib/entities';
import { CutCard } from './supply/CutCard';
import { CutSchedule, DevFundChart, EmissionSection } from './supply/EmissionCharts';
import './view.css';

function SupplySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading supply">
      <ViewHeader kind="Supply" icon={Coins} title="Supply" />
      <div className="ex-hero">
        <StatGrid min={150}>
          <Stat hero label="Total supply" loading />
          <Stat label="New FLUX a day" loading />
        </StatGrid>
      </div>
      <Section title="Against the announced cap">
        <Skeleton h={48} radius={8} />
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
      <ErrorState error={q.error} title="Could not load the supply" onRetry={() => void q.refetch()}>
        The supply figures come from the chain explorer through this server; try again in a moment.
      </ErrorState>
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
  const flux = (sats: bigint | null) => (sats === null ? null : Number(sats) / 1e8);
  return (
    <div>
      <ViewHeader
        kind="Supply"
        icon={Coins}
        title="Supply"
        subtitle="How much FLUX exists, where it sits, and the schedule that makes more."
        freshness={<Freshness label="supply" ts={s?.updated_ms ?? null} cadenceMs={600_000} />}
      >
        {circulating !== null ? (
          <Chip title="The explorer's own circulating figure; its exclusion rule is not documented upstream">
            Circulating {formatCompact(flux(circulating))} per explorer
          </Chip>
        ) : null}
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={170}>
          <Stat
            hero
            label="Total supply"
            value={formatAmountText(total, { decimals: 0 })}
            unit="FLUX"
            caption={
              s ? `at block ${formatInt(s.height)}: transparent coins plus the shielded pools` : undefined
            }
          />
          <Stat
            label="New FLUX a day"
            value={formatAmountText(perDay, { decimals: 0 })}
            unit="FLUX"
            caption={subsidy === null ? undefined : `${formatSats(subsidy, { decimals: 2 })} a block`}
          />
        </StatGrid>
      </div>

      <Section title="Against the announced cap" icon={TrendingUp}>
        {transparent !== null && shielded !== null ? (
          <Stack gap={5}>
            <ShareBar
              label="Supply against the announced cap"
              size="lg"
              legend="list"
              total={ANNOUNCED_MAX_SUPPLY_FLUX}
              format={(v) => `${formatCompact(v)} FLUX`}
              segments={[
                { id: 'transparent', label: 'Transparent', value: flux(transparent) },
                { id: 'shielded', label: 'Shielded pools', value: flux(shielded) },
              ]}
            />
            <p className="ex-note">
              Shares are of the announced {formatCompact(ANNOUNCED_MAX_SUPPLY_FLUX)} FLUX. The cap is
              announced, not enforced by consensus code.
            </p>
          </Stack>
        ) : (
          <p className="ex-muted">The supply breakdown is not available yet.</p>
        )}
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
            actions={
              <EntityLink kind="address" value={DEV_FUND_ADDRESS}>
                Open the address
              </EntityLink>
            }
          >
            <Stack gap={5}>
              <StatGrid min={170}>
                <Stat
                  label="Fixed share per block"
                  value={sched ? <Amount value={sched.devFundMin} decimals={2} unit={false} /> : null}
                  unit="FLUX"
                  caption="plus the fees of the block"
                />
                <Stat
                  label="Inflow a day, at least"
                  value={formatAmountText(devPerDay, { decimals: 0 })}
                  unit="FLUX"
                  caption={`${formatInt(BLOCKS_PER_DAY)} blocks`}
                />
                <Stat
                  label="Received so far"
                  value={dev.data ? formatAmountText(dev.data.received, { decimals: 0 }) : null}
                  unit="FLUX"
                  loading={dev.isPending}
                  caption="by the dev fund address"
                />
              </StatGrid>
              <DevFundChart tip={t} supplyFlux={supplyFlux} />
            </Stack>
          </Section>
          <CutSchedule tip={t} />
        </>
      ) : null}
    </div>
  );
}

// Overview: how many nodes there are right now, and how that has moved. The headline is the live node
// count; the instrument is nodes by tier over time, with the tiers as filters for the globe.

import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSummary } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import {
  AnimatedNumber,
  Chip,
  Delta,
  Row,
  Section,
  Skeleton,
  Stack,
  Stat,
  StatGrid,
  StatusChip,
  type TierName,
  TimeSeries,
  tierLabel,
  ViewHeader,
} from '../../../ui';
import { CutCard } from '../../explorer/views/supply/CutCard';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { useNodeHistory } from '../hooks/useNodeHistory';
import { knownCount, RANGES, type Range } from '../lib/metrics';
import { RangeControl } from '../views/RangeControl';

/** Cumulus first: the base tier leads the legend. */
const TIERS: readonly TierName[] = ['cumulus', 'nimbus', 'stratus'];

export function OverviewTab() {
  const summary = useSummary();
  const filter = useGlobeFilter();
  const [range, setRange] = useState<Range>('7d');
  const hist = useNodeHistory(range);

  const enough = hist.frame ? knownCount(hist.frame.v.node_count ?? []) >= 2 : false;
  const series = useMemo(() => {
    const f = hist.frame;
    if (!f) return [];
    return TIERS.map((tier) => ({
      key: tier,
      label: tierLabel(tier),
      color: `var(--tier-${tier}-ink)`,
      values: f.v[tier] ?? [],
    }));
  }, [hist.frame]);

  // Net change over the window: first known count to the live one.
  const change = useMemo(() => {
    const total = hist.frame?.v.node_count;
    if (!total) return null;
    const first = total.find((x) => x !== null) ?? null;
    const last = [...total].reverse().find((x) => x !== null) ?? null;
    return first === null || last === null ? null : last - first;
  }, [hist.frame]);

  if (!summary) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the network">
        <ViewHeader level={2} kind="Network" icon={Activity} title="Nodes" />
        <div className="ex-hero">
          <StatGrid min={220}>
            <Stat hero label="Nodes on the network" loading />
          </StatGrid>
        </div>
        <Section title="Nodes by tier">
          <Skeleton h={300} radius={12} />
        </Section>
      </div>
    );
  }

  return (
    <>
      <ViewHeader
        level={2}
        kind="Network"
        icon={Activity}
        title="Nodes"
        subtitle={`on ${formatInt(summary.host_count)} hosts in ${formatInt(summary.country_count)} countries.${
          summary.unreachable_count > 0 ? ` ${formatInt(summary.unreachable_count)} cannot be reached.` : ''
        }`}
        freshness={<StatusChip status="live" label="Live count" />}
      />

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label="Nodes on the network"
            value={<AnimatedNumber value={summary.node_count} />}
            unit="nodes"
            delta={change === null ? undefined : <Delta value={change} period={RANGES[range].label} />}
          />
        </StatGrid>
      </div>

      <Section title="Nodes by tier">
        <Stack gap={5}>
          <RangeControl value={range} onChange={setRange} />
          <TimeSeries
            label={`Number of nodes in each tier over the last ${RANGES[range].label}`}
            t={enough && hist.frame ? hist.frame.t : []}
            series={series}
            height={280}
            area={false}
            loading={hist.isPending}
            error={hist.isError && !hist.frame ? true : undefined}
            onRetry={hist.refetch}
            refreshing={hist.isFetching}
            emptyText="The server has not recorded enough history for this range yet."
          />
          <Row gap={3} wrap role="group" aria-label="Show a tier on the globe">
            <span className="ex-muted">Show on the globe</span>
            {TIERS.map((tier) => (
              <Chip key={tier} selected={filter.tier === tier} onClick={() => filter.toggle('tier', tier)}>
                {tierLabel(tier)}
              </Chip>
            ))}
          </Row>
        </Stack>
      </Section>

      <CutCard />
    </>
  );
}

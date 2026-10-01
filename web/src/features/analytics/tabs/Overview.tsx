// Overview: how many nodes there are right now, and how that has moved. The headline is the live node
// count; the instrument is nodes by tier over time, with the tiers as filters for the globe.

import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSummary } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import {
  EntityHead,
  ErrorState,
  HeroNumber,
  LiveBadge,
  Section,
  Segmented,
  type SegmentedItem,
  Skeleton,
  TIER_LABEL,
  type TierName,
} from '../../explorer/parts';
import { CutCard } from '../../explorer/views/supply/CutCard';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { useNodeHistory } from '../hooks/useNodeHistory';
import { knownCount, RANGES, type Range } from '../lib/metrics';
import { TimeChart } from '../viz/TimeChart';

const RANGE_ITEMS: readonly SegmentedItem<Range>[] = (['24h', '7d', '30d'] as const).map((id) => ({
  id,
  label: RANGES[id].label,
}));

/** Bottom to top: Cumulus (the base tier) at the foot of the stack. */
const STACK: readonly TierName[] = ['cumulus', 'nimbus', 'stratus'];

export function OverviewTab() {
  const summary = useSummary();
  const filter = useGlobeFilter();
  const [range, setRange] = useState<Range>('7d');
  const hist = useNodeHistory(range);

  const series = useMemo(() => {
    const f = hist.frame;
    if (!f) return null;
    return STACK.map((tier) => ({
      key: tier,
      label: TIER_LABEL[tier],
      color: `var(--tier-${tier}-ink)`,
      values: f.v[tier] ?? [],
    }));
  }, [hist.frame]);

  // Net change over the window: first known count to the live one.
  const delta = useMemo(() => {
    const total = hist.frame?.v.node_count;
    if (!total) return null;
    const first = total.find((x) => x !== null) ?? null;
    const last = [...total].reverse().find((x) => x !== null) ?? null;
    return first === null || last === null ? null : { change: last - first, from: first };
  }, [hist.frame]);

  if (!summary) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the network">
        <EntityHead kind="Network" icon={Activity} title={<Skeleton w={240} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={300} radius={14} />
        </Section>
      </div>
    );
  }

  return (
    <>
      <EntityHead
        kind="Network"
        icon={Activity}
        status="ok"
        aside={<LiveBadge label="Live count" />}
        title={<HeroNumber whole={formatInt(summary.node_count)} unit="nodes" />}
        sub={
          <span>
            on {formatInt(summary.host_count)} hosts in {formatInt(summary.country_count)} countries.{' '}
            {summary.unreachable_count > 0
              ? `${formatInt(summary.unreachable_count)} cannot be reached.`
              : ''}
          </span>
        }
      />

      <Section
        title="Nodes by tier"
        aside={
          delta ? (
            <span className="ex-mono" title={`From ${formatInt(delta.from)} at the start of the window`}>
              {delta.change >= 0 ? '+' : '-'}
              {formatInt(Math.abs(delta.change))} in {RANGES[range].label}
            </span>
          ) : undefined
        }
        actions={<Segmented items={RANGE_ITEMS} value={range} onChange={setRange} label="Time range" />}
      >
        {hist.isError && !series ? (
          <ErrorState title="Could not load the history" onRetry={hist.refetch} />
        ) : !series || !hist.frame ? (
          <Skeleton h={300} radius={14} />
        ) : knownCount(hist.frame.v.node_count ?? []) < 2 ? (
          <p className="ex-muted">The server has not recorded enough history for this range yet.</p>
        ) : (
          <TimeChart
            title="Nodes by tier"
            summary={`Number of nodes in each tier over the last ${RANGES[range].label}`}
            t={hist.frame.t}
            series={series}
            mode="stack"
            height={300}
            showTotal
            live
            unit="nodes"
            stale={hist.isFetching}
            selected={filter.tier}
            onSelect={(key) => filter.set('tier', key)}
            selectHint="Click to show these nodes on the globe"
          />
        )}
      </Section>

      <CutCard />
    </>
  );
}

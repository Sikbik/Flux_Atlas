// Capacity: what the nodes offer in CPU, memory and disk, and how much of it apps use. The headline is
// the CPU the network offers; each resource below is one bar split by tier, with the share held by
// running apps drawn underneath and a tick where the public app specs would take it to.

import { Cpu } from 'lucide-react';
import { useMemo } from 'react';
import type { CapacityDto } from '../../../api/generated/CapacityDto';
import { useNetworkCapacity } from '../../../api/queries';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  Card,
  Chip,
  Freshness,
  Meter,
  QueryBoundary,
  Row,
  Section,
  ShareBar,
  Skeleton,
  Stack,
  Stat,
  StatGrid,
  tierLabel,
  ViewHeader,
} from '../../../ui';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { capacityRows, formatCapacity, type ResourceRow } from '../lib/capacity';

function CapacityRow({ row }: { row: ResourceRow }) {
  return (
    <Card padding="md">
      <Stack gap={4}>
        <Row justify="between" wrap={false}>
          <span>{row.label}</span>
          <strong className="ui-mono">{formatCapacity(row.key, row.total)}</strong>
        </Row>
        <ShareBar
          label={`${row.label} capacity by tier`}
          legend="inline"
          show="both"
          format={(v) => formatCapacity(row.key, v)}
          segments={row.tiers.map((p) => ({
            id: p.tier,
            label: tierLabel(p.tier),
            value: p.value,
            tier: p.tier,
          }))}
        />
        <Meter
          label={`${row.label} in use by running apps: ${formatPercent(row.lockedShare)}; requested by app specs: ${formatPercent(row.requestedShare)}`}
          value={row.lockedShare}
          marker={row.requestedShare}
          markerLabel="Asked for by app specs"
        />
        <p className="ex-caption">
          <strong className="ui-mono">{formatPercent(row.lockedShare)}</strong> in use by running apps,{' '}
          <strong className="ui-mono">{formatPercent(row.requestedShare)}</strong> asked for by app specs.
        </p>
      </Stack>
    </Card>
  );
}

function CapacitySkeleton() {
  return (
    <div>
      <ViewHeader level={2} kind="Capacity" icon={Cpu} title="What the nodes offer" />
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="CPU the network offers" loading />
        </StatGrid>
      </div>
      <Section title="Capacity and use">
        <Skeleton h={300} radius={12} />
      </Section>
    </div>
  );
}

export function CapacityTab() {
  const q = useNetworkCapacity();
  const filter = useGlobeFilter();
  return (
    <QueryBoundary query={q} skeleton={<CapacitySkeleton />}>
      {(data) => (
        <Capacity
          data={data}
          tier={filter.tier}
          onTier={(t) => filter.toggle('tier', t)}
          updatedAt={q.dataUpdatedAt || null}
        />
      )}
    </QueryBoundary>
  );
}

function Capacity({
  data,
  tier,
  onTier,
  updatedAt,
}: {
  data: CapacityDto;
  tier: string | null;
  onTier: (tier: string) => void;
  updatedAt: number | null;
}) {
  const rows = useMemo(() => capacityRows(data), [data]);
  const [cpu, ram, ssd] = rows;
  if (!cpu || !ram || !ssd) return null;
  return (
    <>
      <ViewHeader
        level={2}
        kind="Capacity"
        icon={Cpu}
        title="What the nodes offer"
        subtitle={`${formatCapacity('ram', ram.total)} of memory and ${formatCapacity('ssd', ssd.total)} of storage across ${formatInt(data.total.nodes)} benchmarked nodes.`}
        freshness={<Freshness label="capacity" ts={updatedAt} cadenceMs={30_000} />}
      />

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label="CPU the network offers"
            value={formatInt(Math.round(cpu.total))}
            unit="cores"
            caption={`${formatPercent(cpu.lockedShare)} of cores in use by running apps`}
          />
        </StatGrid>
      </div>

      <Section title="Capacity and use">
        <Stack gap={5}>
          {rows.map((r) => (
            <CapacityRow key={r.key} row={r} />
          ))}
          <p className="ex-caption">
            Each bar shows where the capacity sits, split by tier. The line under it is what running apps
            hold; the tick is what app specs request at their target instance counts.
          </p>
          <Row gap={3} wrap role="group" aria-label="Show a tier on the globe">
            <span className="ex-muted">Show on the globe</span>
            {(['cumulus', 'nimbus', 'stratus'] as const).map((t) => (
              <Chip key={t} selected={tier === t} onClick={() => onTier(t)}>
                {tierLabel(t)}
              </Chip>
            ))}
          </Row>
        </Stack>
      </Section>
    </>
  );
}

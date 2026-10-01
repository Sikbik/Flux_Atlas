// Capacity: what the nodes offer in CPU, memory and disk, and how much of it apps use. The headline is
// the CPU the network offers; each resource below is one bar split by tier, with the share held by
// running apps drawn underneath and a tick where the public app specs would take it to.

import { Cpu } from 'lucide-react';
import { useMemo } from 'react';
import { useNetworkCapacity } from '../../../api/queries';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  Chip,
  EntityHead,
  ErrorState,
  Freshness,
  HeroNumber,
  Section,
  Skeleton,
  TIER_LABEL,
} from '../../explorer/parts';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { capacityRows, formatCapacity, type ResourceRow } from '../lib/capacity';
import { Meter } from '../viz/Meter';

function CapacityRow({
  row,
  tier,
  onTier,
}: {
  row: ResourceRow;
  tier: string | null;
  onTier: (tier: string) => void;
}) {
  return (
    <li className="an-cap">
      <div className="an-cap__top">
        <span className="an-cap__name">{row.label}</span>
        <b className="an-cap__total">{formatCapacity(row.key, row.total)}</b>
      </div>
      <fieldset className="an-cap__tiers">
        <legend className="ex-sr">{row.label} capacity by tier</legend>
        {row.tiers.map((p) => (
          <button
            key={p.tier}
            type="button"
            className="an-cap__seg"
            data-tier={p.tier}
            data-on={tier === p.tier || undefined}
            style={{ flexGrow: Math.max(p.share, 0.004) }}
            aria-pressed={tier === p.tier}
            aria-label={`${TIER_LABEL[p.tier]}: ${formatCapacity(row.key, p.value)}, ${formatPercent(p.share)} of the ${row.label.toLowerCase()}. Show ${TIER_LABEL[p.tier]} nodes on the globe.`}
            title={`${TIER_LABEL[p.tier]}: ${formatCapacity(row.key, p.value)} (${formatPercent(p.share)})`}
            onClick={() => onTier(p.tier)}
          />
        ))}
      </fieldset>
      <Meter
        value={row.lockedShare}
        marker={row.requestedShare}
        label={`${row.label} in use by running apps: ${formatPercent(row.lockedShare)}; requested by app specs: ${formatPercent(row.requestedShare)}`}
      />
      <div className="an-cap__legend">
        <span>
          <strong className="ex-mono">{formatPercent(row.lockedShare)}</strong> in use by running apps
        </span>
        <span>
          <strong className="ex-mono">{formatPercent(row.requestedShare)}</strong> asked for by app specs
        </span>
      </div>
    </li>
  );
}

export function CapacityTab() {
  const q = useNetworkCapacity();
  const filter = useGlobeFilter();
  const rows = useMemo(() => (q.data ? capacityRows(q.data) : null), [q.data]);

  if (q.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading capacity">
        <EntityHead kind="Capacity" icon={Cpu} title={<Skeleton w={260} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={300} radius={14} />
        </Section>
      </div>
    );
  }
  const data = q.data;
  if (!data || !rows) return <ErrorState title="Could not load capacity" onRetry={() => void q.refetch()} />;
  const [cpu, ram, ssd] = rows;
  if (!cpu || !ram || !ssd) return null;

  return (
    <>
      <EntityHead
        kind="Capacity"
        icon={Cpu}
        status="ok"
        aside={<Freshness label="capacity" at={q.dataUpdatedAt || null} cadenceMs={30_000} />}
        title={<HeroNumber whole={formatInt(Math.round(cpu.total))} unit="cores" />}
        sub={
          <span>
            {formatCapacity('ram', ram.total)} of memory and {formatCapacity('ssd', ssd.total)} of storage
            across {formatInt(data.total.nodes)} benchmarked nodes.
          </span>
        }
      >
        <Chip title="Share of all cores that running apps hold">
          {formatPercent(cpu.lockedShare)} of cores in use
        </Chip>
      </EntityHead>

      <Section
        title="What the network offers and what apps use"
        aside="choose a tier to show it on the globe"
      >
        <ul className="an-caps" aria-label="Capacity by resource">
          {rows.map((r) => (
            <CapacityRow key={r.key} row={r} tier={filter.tier} onTier={(t) => filter.toggle('tier', t)} />
          ))}
        </ul>
        <p className="an-note">
          Bars show where the capacity sits, split by tier. The line under each is what running apps hold; the
          tick is what app specs request at their target instance counts.
        </p>
      </Section>
    </>
  );
}

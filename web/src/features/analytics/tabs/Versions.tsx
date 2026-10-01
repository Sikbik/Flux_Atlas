// Versions: how much of the network runs the current software. The headline is the share on the most
// common version; the instrument is the adoption bars for one component, switched with the chips
// above them. FluxOS rows filter the globe (the only version the globe knows per node).

import { Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CountBucket } from '../../../api/generated/CountBucket';
import type { VersionsDto } from '../../../api/generated/VersionsDto';
import { useNetworkVersions } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import {
  BarList,
  type BarListItem,
  Chip,
  Freshness,
  QueryBoundary,
  Row,
  Section,
  Skeleton,
  Stack,
  Stat,
  StatGrid,
  ViewHeader,
} from '../../../ui';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { BAR_LABEL_COLUMN, shareText } from '../lib/concentration';

type Dim = 'flux_os' | 'daemon' | 'bench' | 'arcane' | 'os';

const DIMS: readonly { id: Dim; label: string; noun: string }[] = [
  { id: 'flux_os', label: 'FluxOS', noun: 'FluxOS' },
  { id: 'daemon', label: 'Daemon', noun: 'the Flux daemon' },
  { id: 'bench', label: 'Benchmark', noun: 'the benchmark tool' },
  { id: 'arcane', label: 'ArcaneOS', noun: 'ArcaneOS' },
  { id: 'os', label: 'System', noun: 'the operating system' },
];

const isUnknown = (b: CountBucket) => b.key === 'unknown';

/** Dotted versions compared number by number, so 8.20.0 sorts above 8.9.0. */
const compareVersions = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

function VersionsSkeleton() {
  return (
    <div>
      <ViewHeader level={2} kind="Versions" icon={Layers} title="Software versions" />
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Nodes on the most common version" loading />
        </StatGrid>
      </div>
      <Section title="Adoption">
        <Skeleton h={260} radius={12} />
      </Section>
    </div>
  );
}

export function VersionsTab() {
  const q = useNetworkVersions();
  const filter = useGlobeFilter();
  return (
    <QueryBoundary query={q} skeleton={<VersionsSkeleton />}>
      {(data) => (
        <Versions
          data={data}
          selected={filter.ver}
          onToggle={(v) => filter.toggle('ver', v)}
          updatedAt={q.dataUpdatedAt || null}
        />
      )}
    </QueryBoundary>
  );
}

function Versions({
  data,
  selected,
  onToggle,
  updatedAt,
}: {
  data: VersionsDto;
  selected: string | null;
  onToggle: (version: string) => void;
  updatedAt: number | null;
}) {
  const [dim, setDim] = useState<Dim>('flux_os');
  const meta = DIMS.find((d) => d.id === dim) ?? DIMS[0]!;
  const clickable = dim === 'flux_os';

  const model = useMemo(() => {
    const buckets = data[dim];
    const known = buckets
      .filter((b) => !isUnknown(b))
      .sort((a, b) => b.count - a.count || compareVersions(b.key, a.key));
    const unknown = buckets.filter(isUnknown);
    const items: BarListItem[] = [...known, ...unknown].map((b) => ({
      id: b.key,
      label: isUnknown(b) ? 'Unknown' : b.label,
      title: `${isUnknown(b) ? 'Version not reported' : b.label}: ${formatInt(b.count)} nodes, ${shareText(b.share)}`,
      value: b.count,
      display: formatInt(b.count),
      detail: shareText(b.share),
      color: isUnknown(b) ? 'var(--viz-other)' : undefined,
      onSelect: clickable && !isUnknown(b) ? () => onToggle(b.key) : undefined,
    }));
    return { items, top: known[0] ?? null, rest: known.slice(1), unknown: unknown[0] ?? null };
  }, [data, dim, clickable, onToggle]);

  const { top } = model;
  const others = [
    ...model.rest.slice(0, 2).map((b) => `${formatInt(b.count)} on ${b.label}`),
    ...(model.unknown ? [`${formatInt(model.unknown.count)} not reporting`] : []),
  ];

  return (
    <>
      <ViewHeader
        level={2}
        kind="Versions"
        icon={Layers}
        title="Software versions"
        subtitle={`${top ? `The most common version of ${meta.noun} is ${top.label}.` : `No ${meta.noun} versions are reported yet.`}${
          others.length > 0 ? ` Besides: ${others.join(', ')}.` : ''
        }`}
        freshness={<Freshness label="versions" ts={updatedAt} cadenceMs={30_000} />}
      />

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label={`Nodes on the most common ${meta.label} version`}
            value={top ? (top.share * 100).toFixed(1) : null}
            unit="%"
            caption={top ? `version ${top.label}` : undefined}
          />
        </StatGrid>
      </div>

      <Section title="Adoption">
        <Stack gap={5}>
          <Row gap={3} wrap role="group" aria-label="Component">
            {DIMS.map((d) => (
              <Chip key={d.id} selected={dim === d.id} onClick={() => setDim(d.id)}>
                {d.label}
              </Chip>
            ))}
          </Row>
          <BarList
            key={dim}
            label={`${meta.label} versions by node count`}
            items={model.items}
            total={model.items.reduce((s, i) => s + (i.value ?? 0), 0)}
            selectedId={clickable ? selected : null}
            limit={8}
            labelWidth={BAR_LABEL_COLUMN}
          />
          <p className="ex-caption">
            {clickable
              ? 'Choose a version to show its nodes on the globe.'
              : 'The globe can filter FluxOS versions only.'}
          </p>
        </Stack>
      </Section>
    </>
  );
}

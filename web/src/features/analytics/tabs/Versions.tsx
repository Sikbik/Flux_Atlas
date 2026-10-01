// Versions: how much of the network runs the current software. The headline is the share on the most
// common version; the instrument is the adoption bars for one component, switched with the control
// above them. FluxOS rows filter the globe (the only version the globe knows per node).

import { Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CountBucket } from '../../../api/generated/CountBucket';
import { useNetworkVersions } from '../../../api/queries';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  EntityHead,
  ErrorState,
  Freshness,
  HeroNumber,
  Section,
  Segmented,
  type SegmentedItem,
  Skeleton,
} from '../../explorer/parts';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { RankedBars, type RankedItem } from '../viz/RankedBars';

type Dim = 'flux_os' | 'daemon' | 'bench' | 'arcane' | 'os';

const DIMS: readonly (SegmentedItem<Dim> & { noun: string })[] = [
  { id: 'flux_os', label: 'FluxOS', noun: 'FluxOS' },
  { id: 'daemon', label: 'Daemon', noun: 'the Flux daemon' },
  { id: 'bench', label: 'Benchmark', noun: 'the benchmark tool' },
  { id: 'arcane', label: 'ArcaneOS', noun: 'ArcaneOS' },
  { id: 'os', label: 'System', noun: 'the operating system' },
];

const isUnknown = (b: CountBucket) => b.key === 'unknown';

/** Dotted versions compared number by number, so 8.20.0 sorts above 8.9.0. */
const compareVersions = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

export function VersionsTab() {
  const q = useNetworkVersions();
  const filter = useGlobeFilter();
  const [dim, setDim] = useState<Dim>('flux_os');
  const meta = DIMS.find((d) => d.id === dim) ?? DIMS[0]!;

  const model = useMemo(() => {
    const buckets = q.data?.[dim];
    if (!buckets) return null;
    const known = buckets
      .filter((b) => !isUnknown(b))
      .sort((a, b) => b.count - a.count || compareVersions(b.key, a.key));
    const unknown = buckets.filter(isUnknown);
    const items: RankedItem[] = [...known, ...unknown].map((b) => ({
      key: b.key,
      label: isUnknown(b) ? 'Unknown' : b.label,
      count: b.count,
      share: b.share,
      color: isUnknown(b) ? 'var(--ink-4)' : undefined,
      title: `${isUnknown(b) ? 'Version not reported' : b.label}: ${formatInt(b.count)} nodes, ${formatPercent(b.share)}`,
    }));
    const total = buckets.reduce((s, b) => s + b.count, 0);
    return { items, top: known[0] ?? null, rest: known.slice(1), unknown: unknown[0] ?? null, total };
  }, [q.data, dim]);

  if (q.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading versions">
        <EntityHead kind="Versions" icon={Layers} title={<Skeleton w={260} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={300} radius={14} />
        </Section>
      </div>
    );
  }
  if (!q.data || !model) {
    return <ErrorState title="Could not load versions" onRetry={() => void q.refetch()} />;
  }
  const { top } = model;
  const clickable = dim === 'flux_os';
  const others = [
    ...model.rest.slice(0, 2).map((b) => `${formatInt(b.count)} on ${b.label}`),
    ...(model.unknown ? [`${formatInt(model.unknown.count)} not reporting`] : []),
  ];

  return (
    <>
      <EntityHead
        kind="Versions"
        icon={Layers}
        status="ok"
        aside={<Freshness label="versions" at={q.dataUpdatedAt || null} cadenceMs={30_000} />}
        title={
          top ? (
            <HeroNumber
              whole={(top.share * 100).toFixed(1)}
              frac="%"
              unit={`run ${dim === 'os' || dim === 'arcane' ? '' : `${meta.label} `}${top.label}`}
            />
          ) : (
            <HeroNumber whole="No data" />
          )
        }
        sub={
          <span>
            of nodes are on the most common version of {meta.noun}.
            {others.length > 0 ? ` Besides: ${others.join(', ')}.` : ''}
          </span>
        }
      />

      <Section
        title="Adoption"
        aside={clickable ? 'choose a version to show it on the globe' : 'the globe can filter FluxOS only'}
        actions={<Segmented items={DIMS} value={dim} onChange={setDim} label="Component" />}
      >
        <RankedBars
          key={dim}
          items={model.items}
          label={`${meta.label} versions by node count`}
          selected={clickable ? filter.ver : null}
          onSelect={clickable ? (key) => filter.toggle('ver', key) : undefined}
          initial={8}
        />
      </Section>
    </>
  );
}

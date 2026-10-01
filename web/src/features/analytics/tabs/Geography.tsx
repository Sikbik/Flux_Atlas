// Geography: how few countries it takes to hold more than half of the network. The headline is that
// number (the Nakamoto coefficient for countries); the instrument is the ranked countries, the ones
// that together pass half drawn in colour. A row filters the globe to that country.

import { Globe2 } from 'lucide-react';
import { useMemo } from 'react';
import type { GeoBreakdownDto } from '../../../api/generated/GeoBreakdownDto';
import { useNetworkGeo } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  BarList,
  type BarListItem,
  Chip,
  Freshness,
  QueryBoundary,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  ViewHeader,
} from '../../../ui';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { BAR_LABEL_COLUMN, leaders, nameList, REST_COLOR, shareText } from '../lib/concentration';
import { hhi, hhiBand } from '../lib/stats';

const BAND_WORD = { low: 'low', moderate: 'moderate', high: 'high' } as const;

function GeographySkeleton() {
  return (
    <div>
      <ViewHeader level={2} kind="Geography" icon={Globe2} title="Countries" />
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Countries that hold more than half of all nodes" loading />
        </StatGrid>
      </div>
      <Section title="Countries by node count">
        <Skeleton h={300} radius={12} />
      </Section>
    </div>
  );
}

export function GeographyTab() {
  const q = useNetworkGeo();
  const summary = useSummary();
  const filter = useGlobeFilter();
  const selected = filter.cc && !filter.cc.includes(',') ? filter.cc.toUpperCase() : null;
  return (
    <QueryBoundary query={q} skeleton={<GeographySkeleton />}>
      {(geo) => (
        <Countries
          geo={geo}
          total={summary?.node_count ?? null}
          selected={selected}
          onToggle={(cc) => filter.toggle('cc', cc)}
          updatedAt={q.dataUpdatedAt || null}
        />
      )}
    </QueryBoundary>
  );
}

function Countries({
  geo,
  total: summaryTotal,
  selected,
  onToggle,
  updatedAt,
}: {
  geo: GeoBreakdownDto;
  total: number | null;
  selected: string | null;
  onToggle: (cc: string) => void;
  updatedAt: number | null;
}) {
  const model = useMemo(() => {
    const items = geo.countries.map((c) => ({ key: c.key, label: c.label, count: c.count, share: c.share }));
    const located = items.reduce((s, i) => s + i.count, 0);
    const total = summaryTotal ?? located + geo.unlocated;
    const lead = leaders(items, total);
    const inLead = new Set(lead.leaders.map((l) => l.key));
    return { items, total, lead, inLead, hhi: hhi([...items.map((i) => i.count), geo.unlocated]) };
  }, [geo, summaryTotal]);
  const { lead } = model;
  const band = hhiBand(model.hhi);
  const bars: BarListItem[] = model.items.map((c) => ({
    id: c.key,
    label: c.label,
    title: `${c.label}: ${formatInt(c.count)} nodes, ${shareText(c.share)}. Choose it to show these nodes on the globe.`,
    value: c.count,
    display: formatInt(c.count),
    detail: shareText(c.share),
    color: lead.reached && !model.inLead.has(c.key) ? REST_COLOR : undefined,
    onSelect: () => onToggle(c.key),
  }));

  return (
    <>
      <ViewHeader
        level={2}
        kind="Geography"
        icon={Globe2}
        title="Countries"
        subtitle={
          lead.reached
            ? `${nameList(lead.leaders.map((l) => l.label))} together hold ${formatPercent(lead.share)} of all nodes.`
            : 'The located countries together do not reach half of the nodes yet.'
        }
        freshness={<Freshness label="geography" ts={updatedAt} cadenceMs={30_000} />}
      >
        <Chip mono>{formatInt(geo.countries.length)} countries</Chip>
        {geo.unlocated > 0 ? (
          <Chip title="Nodes whose address has no known location">
            {formatInt(geo.unlocated)} not located
          </Chip>
        ) : null}
        <Chip title="Herfindahl-Hirschman index of the country shares: 0 is spread evenly, 1 is one country">
          Concentration {BAND_WORD[band]}, HHI {model.hhi.toFixed(2)}
        </Chip>
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label="Countries that hold more than half of all nodes"
            value={lead.reached ? lead.n : `${lead.n}+`}
            unit={lead.n === 1 ? 'country' : 'countries'}
            caption={lead.reached ? `${formatPercent(lead.share)} of all nodes together` : undefined}
          />
        </StatGrid>
      </div>

      <Section title="Countries by node count">
        <BarList
          label="Countries by node count"
          items={bars}
          total={model.total}
          selectedId={selected}
          limit={12}
          labelWidth={BAR_LABEL_COLUMN}
        />
        <p className="ex-caption">
          {lead.reached ? 'The coloured bars together hold more than half of all nodes. ' : ''}
          Choose a country to show its nodes on the globe.
        </p>
      </Section>
    </>
  );
}

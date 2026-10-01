// Hosting: how few providers carry more than half of the network. The headline is that number; the
// instrument is the ranked providers (grouped by AS number, so one company's spellings count once),
// the ones that together pass half drawn in colour. A row filters the globe to that provider.

import { Server } from 'lucide-react';
import { useMemo } from 'react';
import type { ProvidersDto } from '../../../api/generated/ProvidersDto';
import { useNetworkDecentralization, useNetworkProviders } from '../../../api/queries';
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
import { leaders, nameList, REST_COLOR, shareText } from '../lib/concentration';

/** A short name for a provider in a sentence: the first words of its registered organisation. */
const shortOrg = (org: string): string => {
  const words = org.replace(/[,.]/g, '').split(/\s+/);
  const stop = new Set(['GmbH', 'AG', 'Inc', 'LLC', 'Ltd', 'SAS', 'BV', 'AB', 'AS', 'SA', 'Corp', 'Co']);
  const kept = words.filter((w) => !stop.has(w));
  return kept.slice(0, 2).join(' ') || org;
};

function HostingSkeleton() {
  return (
    <div>
      <ViewHeader level={2} kind="Hosting" icon={Server} title="Providers" />
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Providers that host more than half of all nodes" loading />
        </StatGrid>
      </div>
      <Section title="Providers by node count">
        <Skeleton h={300} radius={12} />
      </Section>
    </div>
  );
}

export function HostingTab() {
  const q = useNetworkProviders();
  const dec = useNetworkDecentralization();
  const summary = useSummary();
  const filter = useGlobeFilter();
  return (
    <QueryBoundary query={q} skeleton={<HostingSkeleton />}>
      {(data) => (
        <Providers
          data={data}
          total={summary?.node_count ?? null}
          selectedOrg={filter.org}
          onToggle={(org) => filter.toggle('org', org)}
          multi={dec.data?.multi_node_hosts ?? null}
          updatedAt={q.dataUpdatedAt || null}
        />
      )}
    </QueryBoundary>
  );
}

function Providers({
  data,
  total: summaryTotal,
  selectedOrg,
  onToggle,
  multi,
  updatedAt,
}: {
  data: ProvidersDto;
  total: number | null;
  selectedOrg: string | null;
  onToggle: (org: string) => void;
  multi: number | null;
  updatedAt: number | null;
}) {
  const model = useMemo(() => {
    const items = data.providers.map((p) => ({
      key: p.asn === null ? p.org : String(p.asn),
      label: p.org,
      asn: p.asn,
      count: p.nodes,
      share: p.share,
      hosts: p.hosts,
      countries: p.countries,
    }));
    const total = summaryTotal ?? items.reduce((s, i) => s + i.count, 0);
    const lead = leaders(items, total);
    return { items, total, lead, inLead: new Set(lead.leaders.map((l) => l.key)) };
  }, [data, summaryTotal]);
  const { lead } = model;
  const selected = selectedOrg
    ? (model.items.find((i) => i.label.toLowerCase() === selectedOrg.toLowerCase())?.key ?? null)
    : null;
  const bars: BarListItem[] = model.items.map((p) => ({
    id: p.key,
    label: (
      <span>
        {p.label}
        {p.asn === null ? null : <span className="ex-muted ui-mono"> AS{p.asn}</span>}
      </span>
    ),
    title: `${p.label}: ${formatInt(p.count)} nodes on ${formatInt(p.hosts)} hosts in ${formatInt(p.countries)} ${p.countries === 1 ? 'country' : 'countries'}. Choose it to show these nodes on the globe.`,
    value: p.count,
    display: formatInt(p.count),
    detail: shareText(p.share),
    color: lead.reached && !model.inLead.has(p.key) ? REST_COLOR : undefined,
    onSelect: () => onToggle(p.label),
  }));

  return (
    <>
      <ViewHeader
        level={2}
        kind="Hosting"
        icon={Server}
        title="Providers"
        subtitle={
          lead.reached
            ? `${nameList(lead.leaders.map((l) => shortOrg(l.label)))} together carry ${formatPercent(lead.share)} of all nodes.`
            : 'The listed providers together do not reach half of the nodes yet.'
        }
        freshness={<Freshness label="providers" ts={updatedAt} cadenceMs={30_000} />}
      >
        <Chip mono>{formatInt(data.providers.length)} providers</Chip>
        <Chip title="Share of located nodes that run in hosting and datacenter networks; the rest sit on residential and business lines">
          {formatPercent(data.hosting_share, 0)} in datacenters
        </Chip>
        {multi !== null ? (
          <Chip title="Hosts that run more than one node">{formatInt(multi)} hosts run several nodes</Chip>
        ) : null}
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label="Providers that host more than half of all nodes"
            value={lead.reached ? lead.n : `${lead.n}+`}
            unit={lead.n === 1 ? 'provider' : 'providers'}
            caption={lead.reached ? `${formatPercent(lead.share)} of all nodes together` : undefined}
          />
        </StatGrid>
      </div>

      <Section title="Providers by node count">
        <BarList
          label="Providers by node count"
          items={bars}
          total={model.total}
          selectedId={selected}
          limit={10}
          labelWidth="min(190px, 40%)"
        />
        <p className="ex-caption">
          {lead.reached ? 'The coloured bars together carry more than half of all nodes. ' : ''}
          Choose a provider to show its nodes on the globe.
        </p>
      </Section>
    </>
  );
}

// Hosting: how few providers carry more than half of the network. The headline is that number; the
// instrument is the ranked providers (grouped by AS number, so one company's spellings count once)
// with the rule where the running share crosses half. A row filters the globe to that provider.

import { Server } from 'lucide-react';
import { useMemo } from 'react';
import { useNetworkDecentralization, useNetworkProviders } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import { Chip, EntityHead, ErrorState, Freshness, HeroNumber, Section, Skeleton } from '../../explorer/parts';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { leaders, nameList } from '../lib/concentration';
import { RankedBars, type RankedItem } from '../viz/RankedBars';

/** A short name for a provider in a sentence: the first words of its registered organisation. */
const shortOrg = (org: string): string => {
  const words = org.replace(/[,.]/g, '').split(/\s+/);
  const stop = new Set(['GmbH', 'AG', 'Inc', 'LLC', 'Ltd', 'SAS', 'BV', 'AB', 'AS', 'SA', 'Corp', 'Co']);
  const kept = words.filter((w) => !stop.has(w));
  return kept.slice(0, 2).join(' ') || org;
};

export function HostingTab() {
  const q = useNetworkProviders();
  const dec = useNetworkDecentralization();
  const summary = useSummary();
  const filter = useGlobeFilter();
  const data = q.data;

  const model = useMemo(() => {
    if (!data) return null;
    const items: RankedItem[] = data.providers.map((p) => ({
      key: p.asn === null ? p.org : String(p.asn),
      label: p.org,
      sub: p.asn === null ? undefined : `AS${p.asn}`,
      count: p.nodes,
      share: p.share,
      title: `${p.org}: ${formatInt(p.nodes)} nodes on ${formatInt(p.hosts)} hosts in ${formatInt(p.countries)} ${p.countries === 1 ? 'country' : 'countries'}. Click to show them on the globe.`,
    }));
    const total = summary?.node_count ?? items.reduce((s, i) => s + i.count, 0);
    return { items, total, lead: leaders(items, total) };
  }, [data, summary?.node_count]);

  if (q.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading hosting">
        <EntityHead kind="Hosting" icon={Server} title={<Skeleton w={200} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={360} radius={14} />
        </Section>
      </div>
    );
  }
  if (!data || !model) {
    return <ErrorState title="Could not load hosting" onRetry={() => void q.refetch()} />;
  }
  const { lead } = model;
  const selected = filter.org
    ? (model.items.find((i) => i.label.toLowerCase() === filter.org?.toLowerCase())?.key ?? null)
    : null;
  const multi = dec.data?.multi_node_hosts ?? null;

  return (
    <>
      <EntityHead
        kind="Hosting"
        icon={Server}
        status="ok"
        aside={<Freshness label="providers" at={q.dataUpdatedAt || null} cadenceMs={30_000} />}
        title={
          <HeroNumber
            whole={lead.reached ? lead.n : `${lead.n}+`}
            unit={lead.n === 1 ? 'provider hosts' : 'providers host'}
          />
        }
        sub={
          <span>
            {lead.reached
              ? `more than half of all nodes: ${nameList(lead.leaders.map((l) => shortOrg(l.label)))} together carry ${formatPercent(lead.share)}.`
              : 'The listed providers together do not reach half of the nodes yet.'}
          </span>
        }
      >
        <Chip mono>{formatInt(data.providers.length)} providers</Chip>
        <Chip title="Share of located nodes that run in hosting and datacenter networks; the rest sit on residential and business lines">
          {formatPercent(data.hosting_share, 0)} in datacenters
        </Chip>
        {multi !== null ? (
          <Chip title="Hosts that run more than one node">{formatInt(multi)} hosts run several nodes</Chip>
        ) : null}
      </EntityHead>

      <Section title="Providers by node count" aside="choose one to show it on the globe">
        <RankedBars
          items={model.items}
          label="Providers by node count"
          nakamoto={lead.reached ? lead.n : undefined}
          selected={selected}
          onSelect={(key) => {
            const item = model.items.find((i) => i.key === key);
            if (item) filter.toggle('org', item.label);
          }}
          initial={10}
        />
      </Section>
    </>
  );
}

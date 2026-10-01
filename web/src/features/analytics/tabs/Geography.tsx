// Geography: how few countries it takes to hold more than half of the network. The headline is that
// number (the Nakamoto coefficient for countries); the instrument is the ranked countries with the
// rule drawn where the running share crosses half. A row filters the globe to that country.

import { Globe2 } from 'lucide-react';
import { useMemo } from 'react';
import { useNetworkGeo } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import { Chip, EntityHead, ErrorState, Freshness, HeroNumber, Section, Skeleton } from '../../explorer/parts';
import { useGlobeFilter } from '../hooks/useGlobeFilter';
import { leaders, nameList } from '../lib/concentration';
import { hhi, hhiBand } from '../lib/stats';
import { RankedBars, type RankedItem } from '../viz/RankedBars';

const BAND_WORD = { low: 'low', moderate: 'moderate', high: 'high' } as const;

export function GeographyTab() {
  const q = useNetworkGeo();
  const summary = useSummary();
  const filter = useGlobeFilter();
  const geo = q.data;

  const model = useMemo(() => {
    if (!geo) return null;
    const items: RankedItem[] = geo.countries.map((c) => ({
      key: c.key,
      label: c.label,
      sub: c.key,
      count: c.count,
      share: c.share,
      title: `${c.label}: ${formatInt(c.count)} nodes, ${formatPercent(c.share)}. Click to show them on the globe.`,
    }));
    const located = items.reduce((s, i) => s + i.count, 0);
    const total = summary?.node_count ?? located + geo.unlocated;
    const lead = leaders(items, total);
    return { items, total, lead, hhi: hhi([...items.map((i) => i.count), geo.unlocated]) };
  }, [geo, summary?.node_count]);

  if (q.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading geography">
        <EntityHead kind="Geography" icon={Globe2} title={<Skeleton w={200} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={360} radius={14} />
        </Section>
      </div>
    );
  }
  if (!geo || !model) {
    return <ErrorState title="Could not load geography" onRetry={() => void q.refetch()} />;
  }
  const { lead } = model;
  const band = hhiBand(model.hhi);
  const selected = filter.cc && !filter.cc.includes(',') ? filter.cc.toUpperCase() : null;

  return (
    <>
      <EntityHead
        kind="Geography"
        icon={Globe2}
        status="ok"
        aside={<Freshness label="geography" at={q.dataUpdatedAt || null} cadenceMs={30_000} />}
        title={
          <HeroNumber
            whole={lead.reached ? lead.n : `${lead.n}+`}
            unit={lead.n === 1 ? 'country holds' : 'countries hold'}
          />
        }
        sub={
          <span>
            {lead.reached
              ? `more than half of all nodes: ${nameList(lead.leaders.map((l) => l.label))} together hold ${formatPercent(lead.share)}.`
              : 'The located countries together do not reach half of the nodes yet.'}
          </span>
        }
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
      </EntityHead>

      <Section title="Countries by node count" aside="choose one to show it on the globe">
        <RankedBars
          items={model.items}
          label="Countries by node count"
          nakamoto={lead.reached ? lead.n : undefined}
          selected={selected}
          onSelect={(key) => filter.toggle('cc', key)}
        />
      </Section>
    </>
  );
}

import { useMemo, useState } from 'react';
import { useNetworkGeo, useNetworkProviders, useNetworkVersions } from '../../../api/queries';
import { formatInt, formatPercent } from '../../../lib/format';
import { SpecGrid, Specimen } from '../../gallery/primitives';
import { BarList, type BarListItem } from '../BarList';
import './chartsGallery.css';

const LONG = [
  { id: 'a', label: 'Amazon Data Services Northern Virginia and Ohio Regions', value: 412 },
  { id: 'b', label: 'OVH SAS', value: 290 },
  { id: 'c', label: 'Hetzner Online GmbH', value: 188 },
  { id: 'd', label: 'Contabo GmbH', value: 96 },
  { id: 'e', label: 'DigitalOcean, LLC', value: 41 },
] as const;

/** Top countries, providers and versions as ranked bars: real data, links, limit, selection, states. */
export function BarListSpecimens() {
  const geo = useNetworkGeo();
  const providers = useNetworkProviders();
  const versions = useNetworkVersions();
  const [selected, setSelected] = useState<string | null>(null);

  const countries = useMemo<BarListItem[]>(
    () =>
      (geo.data?.countries ?? []).map((c) => ({
        id: c.key,
        label: c.label,
        value: c.count,
        detail: formatPercent(c.share),
        to: { kind: 'country', value: c.key },
      })),
    [geo.data],
  );
  const orgs = useMemo<BarListItem[]>(
    () =>
      (providers.data?.providers ?? []).map((p) => ({
        id: `${p.asn ?? p.org}`,
        label: p.org,
        value: p.nodes,
        detail: formatPercent(p.share),
        to: { kind: 'provider', value: p.org },
      })),
    [providers.data],
  );
  const daemon = useMemo<BarListItem[]>(
    () =>
      (versions.data?.daemon ?? []).map((v) => ({
        id: v.key,
        label: v.label,
        value: v.count,
        display: formatInt(v.count),
        detail: formatPercent(v.share),
        to: { kind: 'version', value: v.key },
      })),
    [versions.data],
  );
  const picks = useMemo<BarListItem[]>(
    () => countries.slice(0, 6).map(({ to: _to, ...item }) => item),
    [countries],
  );

  return (
    <>
      <h3 className="kgc-group">
        BarList <small>ranked bars: a quiet gradient, a rounded data end, links and a limit</small>
      </h3>
      <SpecGrid min={360}>
        <Specimen
          title="Top countries"
          caption="Real nodes per country from the live server. Each row is a link; bars are shares of the whole network. Limit 6 with Show all."
          surface="raised"
          layout="stack"
        >
          <BarList
            label="Top countries by node count"
            items={countries}
            total={
              geo.data
                ? countries.reduce((n, c) => n + (c.value ?? 0), 0) + (geo.data.unlocated ?? 0)
                : undefined
            }
            limit={6}
            loading={geo.isPending}
            emptyText="No located nodes yet."
          />
        </Specimen>
        <Specimen
          title="Providers"
          caption="Real hosting providers, ranked, with a count and a share. Hover and keyboard focus each have their own state."
          surface="raised"
          layout="stack"
        >
          <BarList
            label="Top providers by node count"
            items={orgs}
            limit={6}
            loading={providers.isPending}
            emptyText="No providers reported yet."
          />
        </Specimen>
        <Specimen
          title="Daemon versions"
          caption="Real FluxOS daemon versions in one color (the entity, never the rank), all rows shown."
          surface="raised"
          layout="stack"
        >
          <BarList
            label="Daemon versions"
            items={daemon.slice(0, 8)}
            loading={versions.isPending}
            emptyText="No versions reported yet."
          />
        </Specimen>
        <Specimen
          title="Selectable"
          caption="Rows as buttons with a selected row (accent wash and a 2 px bar); arrow keys move between rows."
          surface="raised"
          layout="stack"
        >
          <BarList
            label="Pick a country"
            items={picks}
            selectedId={selected ?? picks[0]?.id ?? null}
            onSelect={(item) => setSelected(item.id)}
            loading={geo.isPending}
          />
        </Specimen>
        <Specimen
          title="Long labels, narrow"
          caption="A 300 px column: long names truncate with an ellipsis and the full text in the title; the value column never shifts."
          surface="raised"
          layout="stack"
          width={300}
        >
          <BarList
            label="Providers with long names"
            items={LONG.map((r) => ({ ...r, detail: formatPercent(r.value / 1027) }))}
            labelWidth="minmax(96px, 46%)"
          />
        </Specimen>
        <Specimen
          title="Unknown and zero"
          caption="An unknown value is an empty dashed track and the word Unknown; a zero has no bar. Neither is drawn as the other."
          surface="raised"
          layout="stack"
        >
          <BarList
            label="Mixed readings"
            items={[
              { id: 'a', label: 'Reported', value: 120 },
              { id: 'b', label: 'Not reported', value: null },
              { id: 'c', label: 'None', value: 0 },
              { id: 'd', label: 'Few', value: 7 },
            ]}
          />
        </Specimen>
        <Specimen
          title="Loading"
          caption="Skeleton rows with the geometry of the loaded list."
          surface="raised"
          layout="stack"
        >
          <BarList items={[]} loading skeletonRows={4} />
        </Specimen>
        <Specimen
          title="Empty"
          caption="No rows: a compact empty state, never a blank."
          surface="raised"
          layout="stack"
        >
          <BarList items={[]} emptyText="Nothing to rank for this filter." />
        </Specimen>
      </SpecGrid>
    </>
  );
}

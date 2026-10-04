// Where the nodes run, who hosts them and what they run, as three compact panels: the largest few as bars with their
// share beside them, one sentence on who holds the most, and a link to the full tab in analytics. The bars wear the
// analytics colours and mean the same thing: the fewest places that together pass half of the nodes are in colour, the
// rest step back to gray. A row opens the globe with those nodes showing. Each panel reads its own endpoint, so one
// failing leaves the other two.

import { Globe2, Layers, Server } from 'lucide-react';
import { useMemo } from 'react';
import { useNetworkGeo, useNetworkProviders, useNetworkVersions } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import { BarList, type BarListItem } from '../../../ui';
import { HubLink, HubPanel, type PanelState } from '..';
import {
  type Distribution,
  geoDistribution,
  providerDistribution,
  versionDistribution,
} from './lib/distributions';
import { GHOST_DIST } from './lib/placeholders';
import { Redact } from './Redact';
import './panels.css';

/** The label column of a compact bar list: room for a country, truncating a long provider's name. */
const LABEL = 'minmax(84px, 42%)';

function items(dist: Distribution): BarListItem[] {
  return dist.rows.map((r) => ({
    id: r.id,
    label: r.label,
    title: r.title,
    value: r.count,
    display: r.shareText,
    color: r.color,
    to: r.to ?? undefined,
  }));
}

function DistBody({
  dist,
  label,
  more,
  names = false,
  longMore = false,
  padTo = 0,
}: {
  dist: Distribution;
  label: string;
  /** The line under the bars: what is not shown. */
  more: string | null;
  /** The sentence above the bars names places or companies: two lines in a narrow panel whoever they are. */
  names?: boolean;
  /** The line under the bars is long enough to wrap in a narrow panel. */
  longMore?: boolean;
  /** Rows to keep room for: a list of fewer is padded with rows that show nothing. */
  padTo?: number;
}) {
  const rows = items(dist);
  const pad = Math.max(0, padTo - rows.length);
  const shown: BarListItem[] =
    pad === 0
      ? rows
      : [
          ...rows,
          ...Array.from({ length: pad }, (_, i) => ({
            id: `pad-${i}`,
            label: '\u00a0',
            value: 0,
            display: '\u00a0',
          })),
        ];
  return (
    <div className="nd-dist" data-names={names || undefined} data-pad={pad || undefined}>
      <p className="nd-dist__reading">{dist.reading}</p>
      <BarList label={label} items={shown} labelWidth={LABEL} />
      {more ? (
        <p className="nd-dist__more" data-long={longMore || undefined}>
          {more}
        </p>
      ) : null}
    </div>
  );
}

/** Loading is the ready state with made-up bars, so the footer is there and the panel does not grow. */
const stateOf = (q: { isPending: boolean; data: unknown }, empty: boolean): PanelState =>
  q.data ? (empty ? 'empty' : 'ready') : q.isPending ? 'ready' : 'error';

/** Made-up bars with a sentence and a line under them as long as the real ones usually are. */
function Ghost({
  reading,
  rows,
  more,
  names = false,
  longMore = false,
}: {
  reading: string;
  rows: number;
  more: string | null;
  names?: boolean;
  longMore?: boolean;
}) {
  return (
    <Redact>
      <DistBody
        dist={{ ...GHOST_DIST, reading, rows: GHOST_DIST.rows.slice(0, rows) }}
        label="Loading"
        more={more}
        names={names}
        longMore={longMore}
      />
    </Redact>
  );
}

/** The versions in use are one to six; the panel keeps room for this many rows whichever it is. */
const VERSION_ROWS = 3;

export function GeographyPanel() {
  const q = useNetworkGeo();
  const summary = useSummary();
  const dist = useMemo(
    () => (q.data ? geoDistribution(q.data, summary?.node_count ?? null) : null),
    [q.data, summary?.node_count],
  );
  const rest = dist ? dist.entries - dist.rows.length : 0;
  const unlocated = q.data?.unlocated ?? 0;
  const more = [
    rest > 0 ? `${formatInt(rest)} more ${rest === 1 ? 'country' : 'countries'}` : null,
    unlocated > 0 ? `${formatInt(unlocated)} not located` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <HubPanel
      id="nd-geography"
      span="third"
      title="Geography"
      icon={Globe2}
      aside={dist ? `${formatInt(dist.entries)} countries` : undefined}
      state={stateOf(q, !!dist && dist.rows.length === 0)}
      aria-busy={q.isPending || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the countries"
      errorText="The breakdown is built by this server from the node list; try again in a moment."
      emptyIcon={Globe2}
      emptyTitle="No located nodes yet"
      emptyText="The server has not placed any node on the map."
      footer={<HubLink to={{ type: 'analytics', key: 'geography' }}>Open in analytics</HubLink>}
    >
      {dist ? (
        <DistBody dist={dist} label="Countries by node count" more={more || null} names />
      ) : q.isPending ? (
        <Ghost
          reading="Germany, United States and Finland hold 53.6% of all nodes."
          rows={6}
          more="48 more countries, 12 not located"
          names
        />
      ) : null}
    </HubPanel>
  );
}

export function HostingPanel() {
  const q = useNetworkProviders();
  const summary = useSummary();
  const dist = useMemo(
    () => (q.data ? providerDistribution(q.data, summary?.node_count ?? null) : null),
    [q.data, summary?.node_count],
  );
  const rest = dist ? dist.entries - dist.rows.length : 0;
  const more = [
    rest > 0 ? `${formatInt(rest)} more ${rest === 1 ? 'provider' : 'providers'}` : null,
    q.data ? `${formatPercent(q.data.hosting_share, 0)} of located nodes run in datacenters` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <HubPanel
      id="nd-hosting"
      span="third"
      title="Hosting"
      icon={Server}
      aside={dist ? `${formatInt(dist.entries)} providers` : undefined}
      state={stateOf(q, !!dist && dist.rows.length === 0)}
      aria-busy={q.isPending || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the providers"
      errorText="The breakdown is built by this server from the node list; try again in a moment."
      emptyIcon={Server}
      emptyTitle="No providers yet"
      emptyText="The server has not matched any node to a provider."
      footer={<HubLink to={{ type: 'analytics', key: 'hosting' }}>Open in analytics</HubLink>}
    >
      {dist ? (
        <DistBody dist={dist} label="Providers by node count" more={more || null} names longMore />
      ) : q.isPending ? (
        <Ghost
          reading="Hetzner Online, GHOSTnet Network and 6 others hold 51.2% of all nodes."
          rows={6}
          more="294 more providers. 46% of located nodes run in datacenters"
          names
          longMore
        />
      ) : null}
    </HubPanel>
  );
}

export function VersionsPanel() {
  const q = useNetworkVersions();
  const dist = useMemo(() => (q.data ? versionDistribution(q.data.flux_os) : null), [q.data]);

  return (
    <HubPanel
      id="nd-versions"
      span="third"
      title="FluxOS versions"
      icon={Layers}
      aside={dist ? `${formatInt(dist.entries)} in use` : undefined}
      state={stateOf(q, !!dist && dist.rows.length === 0)}
      aria-busy={q.isPending || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the versions"
      errorText="The breakdown is built by this server from the node list; try again in a moment."
      emptyIcon={Layers}
      emptyTitle="No versions reported"
      emptyText="No node has told the server which FluxOS it runs."
      footer={
        <>
          <HubLink to={{ type: 'analytics', key: 'versions' }}>Open in analytics</HubLink>
          <span className="nd-foot-note">Daemon, benchmark and system versions are there too</span>
        </>
      }
    >
      {dist ? (
        <DistBody dist={dist} label="FluxOS versions by node count" more={null} padTo={VERSION_ROWS} />
      ) : q.isPending ? (
        <Ghost
          reading="99.0% of nodes run 8.20.0; 2 other versions are in use."
          rows={VERSION_ROWS}
          more={null}
        />
      ) : null}
    </HubPanel>
  );
}

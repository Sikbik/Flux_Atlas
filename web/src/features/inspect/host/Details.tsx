// What sits behind the host's lead: who is paid for it and where it is. Each is a fold whose one-line
// summary already answers the question, so the view stays short until a reader asks.

import { Fingerprint, MapPin } from 'lucide-react';
import type { Geo } from '../../../api/generated/Geo';
import { formatInt } from '../../../lib/format';
import { EntityLink, KeyValue, Section } from '../../../ui';
import type { useOpenSet } from '../ui/openset';

type OpenSet = ReturnType<typeof useOpenSet>;

export function geoSource(s: string): string {
  switch (s) {
    case 'node_reported':
      return 'Reported by the node';
    case 'stats_lookup':
      return 'Stats lookup by IP';
    case 'local_db':
      return 'Local geo database';
    default:
      return 'Unknown';
  }
}

/** The addresses that are paid for the nodes of this host, with how many nodes each is paid for here. */
export function OperatorsFold({
  operators,
  nodes,
  open,
}: {
  operators: ReadonlyArray<readonly [string, number]>;
  nodes: number;
  open: OpenSet;
}) {
  const one = operators.length === 1;
  const summary =
    operators.length === 0
      ? 'Unknown'
      : one && nodes > 1
        ? `One address pays all ${formatInt(nodes)} nodes`
        : `${formatInt(operators.length)} ${operators.length === 1 ? 'address' : 'addresses'}`;
  return (
    <Section
      collapsible
      level={3}
      icon={Fingerprint}
      title="Operators"
      aside={<span className="ix-host-aside">{summary}</span>}
      open={open.isOpen('operators')}
      onOpenChange={(v) => open.setOpen('operators', v)}
    >
      {operators.length === 0 ? (
        <p className="ix-cap">The payment addresses of this host's nodes are not known yet.</p>
      ) : (
        <>
          <KeyValue
            align="start"
            items={operators.map(([addr, n]) => ({
              id: addr,
              label: <EntityLink kind="operator" value={addr} icon />,
              value: `${formatInt(n)} ${n === 1 ? 'node' : 'nodes'} here`,
            }))}
          />
          {one && nodes > 1 ? (
            <p className="ix-cap">
              All {formatInt(nodes)} nodes pay one address, so one failure of this host takes them out of the
              queue together.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

export interface HostPlace {
  provider: string;
  asn: string | null;
  /** The whole address as far as it is known: city, region, country. */
  place: string;
  /** The city, when the geo source has one (never guessed). */
  city: string;
  country: string;
  countryCode: string;
  hosting: boolean | null;
  lat: number | null;
  lon: number | null;
  geo: Geo | null;
}

/** Provider, place and kind of network, with the honest note that the place comes from the IP. */
export function LocationFold({ p, open }: { p: HostPlace; open: OpenSet }) {
  return (
    <Section
      collapsible
      level={3}
      icon={MapPin}
      title="Location"
      aside={
        <span className="ix-host-aside">{[p.city, p.country].filter(Boolean).join(', ') || 'Unknown'}</span>
      }
      open={open.isOpen('location')}
      onOpenChange={(v) => open.setOpen('location', v)}
    >
      <KeyValue
        align="start"
        items={[
          {
            label: 'Provider',
            value:
              p.provider === 'Unknown provider' ? null : (
                <span>
                  <EntityLink kind="provider" value={p.provider} icon>
                    {p.provider}
                  </EntityLink>
                  {p.asn ? <span className="ix-dim"> {p.asn}</span> : null}
                </span>
              ),
          },
          { label: 'Place', value: p.place || null },
          {
            label: 'Country',
            value: p.countryCode ? (
              <EntityLink kind="country" value={p.countryCode} icon>
                {p.country || p.countryCode}
              </EntityLink>
            ) : null,
          },
          {
            label: 'Network',
            value: p.hosting === null ? null : p.hosting ? 'Datacenter' : 'Residential or office',
          },
          {
            label: 'Coordinates',
            value: p.lat !== null && p.lon !== null ? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : null,
            mono: true,
          },
          { label: 'Source', value: p.geo ? geoSource(p.geo.source) : null },
        ]}
      />
      <p className="ix-cap">
        The place comes from the IP address and is approximate; hosts in the same data center share it.
      </p>
    </Section>
  );
}

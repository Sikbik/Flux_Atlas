// The nodes an address is paid for: a map of where they run and the list, filterable by tier. Every row
// is a link to the node.

import { useMemo, useState } from 'react';
import type { NodeRow } from '../../../../api/generated/NodeRow';
import { formatInt } from '../../../../lib/format';
import {
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  EntityLink,
  Row,
  StatusChip,
  TierChip,
  type TierName,
  tierLabel,
} from '../../../../ui';
import { DotMap, type MapSite } from '../../../analytics/viz/DotMap';
import { Dense, NodeLink, useNodeInfo } from '../shared';

const TIER_RANK: Record<string, number> = { stratus: 0, nimbus: 1, cumulus: 2, unknown: 3 };

export function sortNodes(nodes: readonly NodeRow[]): NodeRow[] {
  return [...nodes].sort(
    (a, b) =>
      (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.id - b.id,
  );
}

/** Where the nodes run: one marker per location, sized by how many nodes sit there. */
export function NodesMap({ nodes }: { nodes: readonly NodeRow[] }) {
  const sites = useMemo<MapSite[]>(() => {
    const by = new Map<
      string,
      { lon: number; lat: number; n: number; cc: string; country: string; orgs: Set<string> }
    >();
    for (const n of nodes) {
      if (n.lat === null || n.lon === null) continue;
      const k = `${n.lat.toFixed(1)},${n.lon.toFixed(1)}`;
      const e = by.get(k) ?? {
        lon: n.lon,
        lat: n.lat,
        n: 0,
        cc: n.country_code ?? '',
        country: n.country ?? '',
        orgs: new Set<string>(),
      };
      e.n += 1;
      if (n.org) e.orgs.add(n.org);
      by.set(k, e);
    }
    return [...by.entries()].map(([k, e]) => ({
      key: k,
      lon: e.lon,
      lat: e.lat,
      weight: e.n,
      label: e.country || e.cc || 'Unknown place',
      detail: e.orgs.size > 0 ? [...e.orgs].slice(0, 2).join(', ') : undefined,
      color: 'var(--accent-400)',
    }));
  }, [nodes]);
  const unlocated = nodes.filter((n) => n.lat === null || n.lon === null).length;
  return (
    <figure className="ex-nodemap" aria-label="Where this address's nodes run">
      <DotMap
        sites={sites}
        label={`Locations of ${formatInt(nodes.length)} nodes`}
        maxRadius={10}
        weightUnit="nodes"
      />
      {unlocated > 0 ? (
        <figcaption className="ex-muted">{formatInt(unlocated)} not located yet</figcaption>
      ) : null}
    </figure>
  );
}

/** A node's place: its city (when the server names one) and its country as a link. */
function Where({ node: n }: { node: NodeRow }) {
  const city = useNodeInfo(n.id, n.outpoint)?.city ?? '';
  if (!n.country_code) return city ? <span>{city}</span> : null;
  return (
    <span>
      {city ? `${city}, ` : ''}
      <EntityLink kind="country" value={n.country_code}>
        {n.country ?? n.country_code}
      </EntityLink>
    </span>
  );
}

const COLUMNS: readonly DataTableColumn<NodeRow>[] = [
  {
    id: 'node',
    header: 'Node',
    minWidth: 190,
    cell: (n) => (
      <NodeLink
        id={n.id}
        outpoint={n.outpoint}
        fallbackEndpoint={n.endpoint}
        fallbackTier={n.tier}
        glyph={false}
      />
    ),
  },
  {
    id: 'tier',
    header: 'Tier',
    minWidth: 110,
    sortable: true,
    sortValue: (n) => TIER_RANK[n.tier] ?? 9,
    cell: (n) => <TierChip tier={n.tier as TierName | 'unknown'} size="sm" />,
  },
  {
    id: 'status',
    header: 'Status',
    minWidth: 120,
    cell: (n) => <StatusChip status={n.status} size="sm" />,
  },
  {
    id: 'where',
    header: 'Where',
    minWidth: 180,
    cell: (n) => <Where node={n} />,
  },
  {
    id: 'org',
    header: 'Provider',
    minWidth: 180,
    cell: (n) => (n.org ? <EntityLink kind="provider" value={n.org} /> : null),
  },
  {
    id: 'paid',
    header: 'Last paid',
    numeric: true,
    minWidth: 130,
    sortable: true,
    sortValue: (n) => n.last_paid_height,
    cell: (n) =>
      n.last_paid_height === null ? (
        <span className="ex-muted">never paid</span>
      ) : (
        <EntityLink kind="block" value={n.last_paid_height} />
      ),
  },
];

export function AddressNodesList({
  nodes,
  loading,
}: {
  nodes: readonly NodeRow[] | undefined;
  loading: boolean;
}) {
  const [tier, setTier] = useState<TierName | null>(null);
  const sorted = useMemo(() => sortNodes(nodes ?? []), [nodes]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { stratus: 0, nimbus: 0, cumulus: 0 };
    for (const n of sorted) c[n.tier] = (c[n.tier] ?? 0) + 1;
    return c;
  }, [sorted]);
  const shown = useMemo(() => (tier ? sorted.filter((n) => n.tier === tier) : sorted), [sorted, tier]);
  if (!loading && sorted.length === 0) {
    return (
      <EmptyState title="No nodes are paid to this address">
        Payments to this address do not come from a node, or its nodes have left the network.
      </EmptyState>
    );
  }
  return (
    <>
      <Row gap={3} wrap className="ex-filters" role="group" aria-label="Filter by tier">
        <Chip selected={tier === null} onClick={() => setTier(null)}>
          All {formatInt(sorted.length)}
        </Chip>
        {(['stratus', 'nimbus', 'cumulus'] as const).map((t) =>
          counts[t] ? (
            <Chip key={t} selected={tier === t} onClick={() => setTier(tier === t ? null : t)}>
              {tierLabel(t)} {formatInt(counts[t])}
            </Chip>
          ) : null,
        )}
      </Row>
      <Dense>
        <DataTable
          aria-label="Nodes of this address"
          rows={shown}
          columns={COLUMNS}
          rowKey={(n) => n.id}
          rowLink={(n) =>
            n.outpoint || n.endpoint ? { kind: 'node', value: n.outpoint || n.endpoint || '' } : null
          }
          loading={loading}
          maxHeight={520}
        />
      </Dense>
    </>
  );
}

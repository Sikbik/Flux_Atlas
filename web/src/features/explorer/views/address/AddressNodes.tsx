// The nodes an address is paid for: a map of where they run, counts by tier with the collateral they
// lock, and the list (windowed, filterable by tier). Every row is a link to the node.

import { useMemo, useState } from 'react';
import type { NodeRow } from '../../../../api/generated/NodeRow';
import { formatInt } from '../../../../lib/format';
import { DotMap, type MapSite } from '../../../analytics/viz/DotMap';
import {
  EmptyState,
  EntityLink,
  Skeleton,
  StatusChip,
  TIER_LABEL,
  TierGlyph,
  type TierName,
  ToggleChip,
  Windowed,
} from '../../parts';
import { NodeLink } from '../shared';

const TIER_RANK: Record<string, number> = { stratus: 0, nimbus: 1, cumulus: 2, unknown: 3 };
const ROW_H = 58;

const STATUS: Record<string, 'ok' | 'pending' | 'warn' | 'crit' | 'off'> = {
  confirmed: 'ok',
  started: 'pending',
  dos: 'crit',
  offline: 'crit',
  expired: 'crit',
  departed: 'off',
  unknown: 'off',
};
const STATUS_WORD: Record<string, string> = {
  confirmed: 'Confirmed',
  started: 'Started',
  dos: 'DoS listed',
  offline: 'Offline',
  expired: 'Expired',
  departed: 'Departed',
  unknown: 'Unknown',
};

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

function Row({ n }: { n: NodeRow }) {
  const tier = n.tier as TierName | 'unknown';
  const lastPaid = n.last_paid_height;
  return (
    <div className="ex-nrow" data-tier={tier === 'unknown' ? undefined : tier}>
      <TierGlyph tier={tier} size={18} />
      <div className="ex-nrow__main">
        <NodeLink id={n.id} fallbackEndpoint={n.endpoint} fallbackTier={n.tier} glyph={false} />
        <span className="ex-nrow__sub">
          {n.org ? <EntityLink kind="provider" value={n.org} /> : null}
          {n.country_code ? (
            <EntityLink kind="country" value={n.country_code}>
              {n.country ?? n.country_code}
            </EntityLink>
          ) : null}
        </span>
      </div>
      <StatusChip status={STATUS[n.status] ?? 'off'} label={STATUS_WORD[n.status] ?? n.status} size="sm" />
      <span className="ex-nrow__paid ex-mono">
        {lastPaid === null ? (
          'never paid'
        ) : (
          <>
            paid at <EntityLink kind="block" value={lastPaid} />
          </>
        )}
      </span>
    </div>
  );
}

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
  const shown = tier ? sorted.filter((n) => n.tier === tier) : sorted;
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading nodes">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={ROW_H - 10} radius={12} style={{ marginBottom: 10 }} />
        ))}
      </div>
    );
  }
  if (sorted.length === 0)
    return (
      <EmptyState title="No nodes are paid to this address">
        Payments to this address do not come from a node, or its nodes have left the network.
      </EmptyState>
    );
  return (
    <div>
      <fieldset className="ex-filters">
        <legend className="ex-sr">Filter by tier</legend>
        <ToggleChip pressed={tier === null} onClick={() => setTier(null)}>
          All {formatInt(sorted.length)}
        </ToggleChip>
        {(['stratus', 'nimbus', 'cumulus'] as const).map((t) =>
          counts[t] ? (
            <ToggleChip key={t} tier={t} pressed={tier === t} onClick={() => setTier(tier === t ? null : t)}>
              {TIER_LABEL[t]} {formatInt(counts[t])}
            </ToggleChip>
          ) : null,
        )}
      </fieldset>
      <Windowed
        key={tier ?? 'all'}
        count={shown.length}
        rowHeight={ROW_H}
        label="Nodes"
        renderRow={(i) => <Row n={shown[i]!} />}
      />
    </div>
  );
}

// /richlist: who holds the supply. The headline is how concentrated it is: the share of the ten
// largest addresses. Below it the ranks as bars (a bar filters the list to those ranks) and the ranked
// addresses with their share and how much of each balance is locked in nodes.

import { useQuery } from '@tanstack/react-query';
import { ListOrdered, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RichListEntry } from '../../../api/generated/RichListEntry';
import { queries, useRichList } from '../../../api/queries';
import { formatInt, parseFlux } from '../../../lib/format';
import {
  Amount,
  BarList,
  type BarListItem,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorState,
  Freshness,
  Meter,
  Row,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  ViewHeader,
} from '../../../ui';
import { useCollateral } from '../hooks/useCollateral';
import { useDwell } from '../hooks/useDom';
import { knownEntity } from '../lib/entities';
import { concentration, formatShare, lockedSats } from '../lib/richlist';
import { AddressTag } from './shared';
import './richlist/richlist.css';
import './view.css';

type NodeFilter = 'all' | 'with' | 'without';

/** How much of an address's balance is collateral held by its nodes; it asks the server only once the row has stayed on screen. */
function Locked({ e }: { e: RichListEntry }) {
  const dwelled = useDwell(220);
  const q = useQuery({ ...queries.address(e.address), enabled: dwelled && e.node_count > 0 });
  const collateral = useCollateral();
  if (e.node_count === 0) return <span className="ex-muted">no nodes</span>;
  if (!q.data) return <span className="ex-muted">{q.isError ? 'unavailable' : ''}</span>;
  const balance = parseFlux(e.balance) ?? 0n;
  const locked = lockedSats(q.data.node_counts, collateral, balance);
  const frac = balance > 0n ? Number((locked * 10000n) / balance) / 10000 : 0;
  const pct = Math.round(frac * 100);
  return (
    <span
      className="ex-locked"
      title={`${formatInt(Number(locked / 100_000_000n))} of ${formatInt(Number(balance / 100_000_000n))} FLUX is collateral held by nodes`}
    >
      <Meter label={`${pct} percent of the balance is locked in nodes`} value={frac} />
      <span className="ui-mono">{pct}%</span>
    </span>
  );
}

const COLUMNS: readonly DataTableColumn<RichListEntry>[] = [
  {
    id: 'rank',
    header: 'Rank',
    numeric: true,
    width: 72,
    sticky: false,
    sortable: true,
    sortValue: (e) => e.rank,
    cell: (e) => formatInt(e.rank),
  },
  { id: 'address', header: 'Address', minWidth: 180, cell: (e) => <AddressTag address={e.address} /> },
  {
    id: 'balance',
    header: 'Balance',
    numeric: true,
    minWidth: 150,
    sortable: true,
    sortValue: (e) => Number(parseFlux(e.balance) ?? 0n),
    cell: (e) => <Amount value={e.balance} decimals={0} />,
  },
  {
    id: 'share',
    header: 'Share',
    numeric: true,
    minWidth: 90,
    sortable: true,
    sortValue: (e) => e.share_pct,
    cell: (e) => formatShare(e.share_pct),
  },
  {
    id: 'nodes',
    header: 'Nodes',
    numeric: true,
    minWidth: 80,
    sortable: true,
    sortValue: (e) => e.node_count,
    cell: (e) => (e.node_count === 0 ? '' : formatInt(e.node_count)),
  },
  { id: 'locked', header: 'Locked in nodes', minWidth: 170, cell: (e) => <Locked e={e} /> },
];

const rowKey = (e: RichListEntry) => e.address;

function RichListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the rich list">
      <ViewHeader kind="Rich list" icon={ListOrdered} title="Rich list" />
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Held by the ten largest addresses" loading />
        </StatGrid>
      </div>
      <Section title="Who holds the supply">
        <Skeleton h={120} radius={8} />
      </Section>
    </div>
  );
}

export function RichListView() {
  const q = useRichList();
  const [bucketKey, setBucketKey] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>('all');
  const entries = q.data?.entries;
  const conc = useMemo(() => concentration(entries ?? []), [entries]);
  const bucket = conc.buckets.find((b) => b.key === bucketKey) ?? null;
  const counts = useMemo(() => {
    let withNodes = 0;
    for (const e of entries ?? []) if (e.node_count > 0) withNodes++;
    return { all: entries?.length ?? 0, with: withNodes, without: (entries?.length ?? 0) - withNodes };
  }, [entries]);
  const shown = useMemo(() => {
    let rows = entries ?? [];
    if (bucket && bucket.from !== null && bucket.to !== null) {
      const { from, to } = bucket;
      rows = rows.filter((e) => e.rank >= from && e.rank <= to);
    }
    if (nodeFilter === 'with') rows = rows.filter((e) => e.node_count > 0);
    else if (nodeFilter === 'without') rows = rows.filter((e) => e.node_count === 0);
    return rows;
  }, [entries, bucket, nodeFilter]);

  if (q.isPending) return <RichListSkeleton />;
  if (!entries) {
    return (
      <ErrorState error={q.error} title="Could not load the rich list" onRetry={() => void q.refetch()}>
        The ranking is built by this server from the chain; try again in a moment.
      </ErrorState>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState icon={ListOrdered} title="The rich list is not built yet" pattern>
        The server ranks addresses once it has indexed their balances. Check back shortly.
      </EmptyState>
    );
  }

  const top10 = conc.top(10);
  const largest = entries[0];
  const largestEntity = largest ? knownEntity(largest.address) : null;
  const items: BarListItem[] = conc.buckets.map((b, i) => ({
    id: b.key,
    label: i === 0 && largestEntity ? `${b.label}, ${largestEntity.label}` : b.label,
    value: b.share,
    display: formatShare(b.share),
    detail:
      b.from === null
        ? 'not on the list'
        : b.holders === 1
          ? '1 address'
          : `${formatInt(b.holders)} addresses`,
    // The bucket for everyone not on the list is not a rank range, so it does not filter the table.
    onSelect: b.from === null ? undefined : () => setBucketKey(bucketKey === b.key ? null : b.key),
  }));

  return (
    <div>
      <ViewHeader
        kind="Rich list"
        icon={ListOrdered}
        title="Rich list"
        subtitle="Who holds the supply, ranked by balance."
        freshness={<Freshness label="ranking" ts={q.data?.updated_ms ?? null} cadenceMs={600_000} />}
      >
        <Chip mono>{formatInt(conc.listed)} addresses ranked</Chip>
        <Chip title="Collateral locked by a node stays in its owner's balance">Locked coins are counted</Chip>
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label="Held by the ten largest addresses"
            value={top10.toFixed(1)}
            unit="% of the supply"
            caption={
              largest
                ? `The largest alone holds ${formatShare(largest.share_pct)}${largestEntity ? `, the ${largestEntity.label.toLowerCase()}` : ''}.`
                : undefined
            }
          />
        </StatGrid>
      </div>

      <Section title="Who holds the supply">
        <BarList
          label="Share of the supply by rank"
          items={items}
          max={100}
          selectedId={bucketKey}
          labelWidth={150}
        />
        <p className="ex-caption">Choose a bar to list its addresses below.</p>
      </Section>

      <Section title="Addresses by balance" aside={`${formatInt(shown.length)} shown`} flush>
        <Row gap={3} wrap className="ex-filters" role="group" aria-label="Filter the ranking">
          <Chip selected={nodeFilter === 'all'} onClick={() => setNodeFilter('all')}>
            All {formatInt(counts.all)}
          </Chip>
          <Chip
            selected={nodeFilter === 'with'}
            onClick={() => setNodeFilter(nodeFilter === 'with' ? 'all' : 'with')}
          >
            Run nodes {formatInt(counts.with)}
          </Chip>
          <Chip
            selected={nodeFilter === 'without'}
            onClick={() => setNodeFilter(nodeFilter === 'without' ? 'all' : 'without')}
          >
            No nodes {formatInt(counts.without)}
          </Chip>
          {bucket ? (
            <Chip selected icon={X} onClick={() => setBucketKey(null)}>
              {bucket.label}
            </Chip>
          ) : null}
        </Row>
        <DataTable
          aria-label="Addresses by balance"
          rows={shown}
          columns={COLUMNS}
          rowKey={rowKey}
          rowLink={(e) => ({ kind: 'address', value: e.address })}
          maxHeight={560}
          empty={<p className="ex-note ex-pad">No address matches both filters.</p>}
        />
      </Section>
    </div>
  );
}

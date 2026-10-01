// /richlist: who holds the supply. The headline is how concentrated it is, as one bar cut by rank;
// below it the ranked addresses with their share and how much of each balance is locked in nodes.
// A segment of the bar filters the list to those ranks.

import { ListOrdered, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRichList } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import { knownEntity } from '../lib/entities';
import { concentration } from '../lib/richlist';
import {
  Chip,
  EmptyState,
  EntityHead,
  ErrorState,
  Freshness,
  HeroNumber,
  Section,
  Skeleton,
  ToggleChip,
  Windowed,
} from '../parts';
import { Concentration, formatShare } from './richlist/Concentration';
import { RichRow, ROW_HEIGHT } from './richlist/RichRow';
import './richlist/richlist.css';

type NodeFilter = 'all' | 'with' | 'without';

function RichListSkeleton() {
  return (
    <div className="ex-root" role="status" aria-busy="true" aria-label="Loading the rich list">
      <EntityHead
        kind="Rich list"
        icon={ListOrdered}
        title={<Skeleton w={260} h={46} radius={8} />}
        loading
      />
      <Section>
        <Skeleton h={38} radius={6} />
        <div className="ex-gap" />
        <Skeleton h={66} radius={8} />
      </Section>
      <Section title="Addresses by balance">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} h={ROW_HEIGHT - 12} radius={12} style={{ marginBottom: 12 }} />
        ))}
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
      <div className="ex-root">
        <ErrorState title="Could not load the rich list" onRetry={() => void q.refetch()}>
          The ranking is built by this server from the chain; try again in a moment.
        </ErrorState>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="ex-root">
        <EmptyState icon={ListOrdered} title="The rich list is not built yet">
          The server ranks addresses once it has indexed their balances. Check back shortly.
        </EmptyState>
      </div>
    );
  }

  const top10 = conc.top(10);
  const [whole, frac] = top10.toFixed(1).split('.');
  const largest = entries[0];
  const largestEntity = largest ? knownEntity(largest.address) : null;
  const maxShare = shown[0]?.share_pct ?? 0;

  return (
    <div className="ex-root">
      <EntityHead
        kind="Rich list"
        icon={ListOrdered}
        status="ok"
        aside={<Freshness label="ranking" at={q.data?.updated_ms ?? null} cadenceMs={600_000} />}
        title={<HeroNumber whole={whole} frac={`.${frac}%`} />}
        sub={
          <span>
            of the supply sits in the ten largest addresses.
            {largest ? (
              <>
                {' '}
                The largest alone holds {formatShare(largest.share_pct)}
                {largestEntity ? <>, the {largestEntity.label.toLowerCase()}</> : null}.
              </>
            ) : null}
          </span>
        }
      >
        <Chip mono>{formatInt(conc.listed)} addresses ranked</Chip>
        <Chip title="Collateral locked by a node stays in its owner's balance">Locked coins are counted</Chip>
      </EntityHead>

      <Section title="Who holds the supply" aside="pick a slice to list its addresses">
        <Concentration
          buckets={conc.buckets}
          active={bucketKey}
          onPick={setBucketKey}
          entityOfFirst={largestEntity?.label ?? null}
        />
      </Section>

      <Section title="Addresses by balance" aside={`${formatInt(shown.length)} shown`}>
        <fieldset className="ex-filters">
          <legend className="ex-sr">Filter the ranking</legend>
          <ToggleChip pressed={nodeFilter === 'all'} onClick={() => setNodeFilter('all')}>
            All {formatInt(counts.all)}
          </ToggleChip>
          <ToggleChip
            pressed={nodeFilter === 'with'}
            onClick={() => setNodeFilter(nodeFilter === 'with' ? 'all' : 'with')}
          >
            Run nodes {formatInt(counts.with)}
          </ToggleChip>
          <ToggleChip
            pressed={nodeFilter === 'without'}
            onClick={() => setNodeFilter(nodeFilter === 'without' ? 'all' : 'without')}
          >
            No nodes {formatInt(counts.without)}
          </ToggleChip>
          {bucket ? (
            <ToggleChip pressed onClick={() => setBucketKey(null)} icon={X}>
              {bucket.label}
            </ToggleChip>
          ) : null}
        </fieldset>
        <div className="ex-rhead" aria-hidden="true">
          <span>Rank</span>
          <span>Address</span>
          <span>Balance, FLUX</span>
          <span>Share</span>
          <span>Nodes and locked</span>
        </div>
        {shown.length === 0 ? (
          <p className="ex-muted" role="status">
            No address matches both filters.
          </p>
        ) : (
          <Windowed
            key={`${bucketKey ?? 'all'}-${nodeFilter}`}
            count={shown.length}
            rowHeight={ROW_HEIGHT}
            label="Addresses by balance"
            rowKey={(i) => shown[i]?.address ?? String(i)}
            renderRow={(i) => {
              const e = shown[i];
              return e ? <RichRow e={e} maxShare={maxShare} /> : null;
            }}
          />
        )}
      </Section>
    </div>
  );
}

// The newest nodes: the ten most recently confirmed, newest first, each with its tier, where it is, who hosts it and
// when it began. A row is one link to the node (named by its collateral outpoint, shown as the node's address when
// the live table knows it); the provider is its own link above the row, to the globe showing that provider's nodes.
// In a wide panel the list runs in two columns, down the first and then the second. While it loads, the panel draws the
// same list with made-up rows, so it has the size of the loaded one.

import { Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { EntityLink, RelativeTime, TierGlyph, Unknown } from '../../../ui';
import { useNodeInfo } from '../../explorer/views/shared';
import { HubPanel, isFilling, type PanelState, useNodesOverview } from '..';
import { NEWEST_SHOWN, type NewestRow, newestRows } from './lib/newest';
import { ghostNewest } from './lib/placeholders';
import { Redact, WaitAside } from './Redact';
import './bench.css';

const Row = memo(function Row({ r }: { r: NewestRow }) {
  // The live table knows the node's address when it has the node; until then the collateral stands in for it.
  const info = useNodeInfo(null, r.key);
  const name = info?.endpoint || r.shortKey;
  return (
    <li className="nd-new" data-tier={r.tier}>
      <TierGlyph tier={r.tier} size={20} />
      <span className="nd-new__who">
        <ShellLink
          to={{ type: 'node', key: r.key }}
          className="nd-new__link"
          aria-label={`Open the ${r.tierName} node ${name}`}
        >
          {name}
        </ShellLink>
        <span className="nd-new__sub">
          <span className="nd-new__country">{r.country ?? <Unknown>Unknown place</Unknown>}</span>
          {r.provider ? (
            <EntityLink kind="provider" value={r.provider} className="nd-new__provider">
              {r.provider}
            </EntityLink>
          ) : null}
        </span>
      </span>
      <span className="nd-new__age">
        <span className="ui-sr-only">Active since </span>
        <RelativeTime ts={r.sinceMs} />
      </span>
    </li>
  );
});

function NewestList({ rows }: { rows: readonly NewestRow[] }) {
  return (
    <ol className="nd-new__list" aria-label="The newest confirmed nodes, newest first">
      {rows.map((r) => (
        <Row key={r.key} r={r} />
      ))}
    </ol>
  );
}

export function NewestPanel() {
  const q = useNodesOverview();
  const rows = useMemo(() => newestRows(q.data?.newest, NEWEST_SHOWN), [q.data]);
  const ghost = useMemo(() => ghostNewest(), []);
  const loading = q.isPending;
  const waiting = loading && isFilling(q.failureReason);
  const state: PanelState = q.data ? (rows.length === 0 ? 'empty' : 'ready') : loading ? 'ready' : 'error';
  const filling = isFilling(q.error);

  return (
    <HubPanel
      id="nd-newest"
      span="full"
      title="Newest nodes"
      icon={Sparkles}
      aside={waiting ? <WaitAside what="The newest nodes" /> : 'newest first'}
      state={state}
      aria-busy={loading || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle={filling ? 'The newest nodes are still being read' : 'Could not load the newest nodes'}
      errorText={
        filling
          ? 'The server is reading the chain tip for the first time; try again in a moment.'
          : 'They come from the node list this server keeps; try again in a moment.'
      }
      emptyIcon={Sparkles}
      emptyTitle="No new nodes"
      emptyText="No confirmed node has a known start yet."
      footer={<span className="nd-foot-note">The time is when each node was first confirmed</span>}
    >
      {loading ? (
        <Redact>
          <NewestList rows={ghost} />
        </Redact>
      ) : (
        <NewestList rows={rows} />
      )}
    </HubPanel>
  );
}

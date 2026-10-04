// Live activity: how many nodes joined and left over the last day and week, and the latest node events as they happen.
// The counts come from the nodes overview (the server counts them from the node events it has stored; a window it has
// not lived through is a floor, said so in words) and the events from the live feed in the store, so they cost no
// request. The two halves are independent: the overview failing leaves the events running, and the other way round.
// The event list reserves the height of all its rows, so the panel does not grow as the first events arrive.

import { Activity } from 'lucide-react';
import { type CSSProperties, memo, useMemo } from 'react';
import type { NodesOverviewDto } from '../../../api/generated/NodesOverviewDto';
import { useFeed, useNetwork } from '../../../app/context';
import { useFresh } from '../../../motion';
import { Button, EmptyState, RelativeTime, Skeleton, statusMeta } from '../../../ui';
import { NodeLink } from '../../explorer/views/shared';
import { HubLink, HubPanel, type HubQuery, isFilling, useNodesOverview } from '..';
import { type ChurnRow, churnRows, signed } from './lib/churn';
import { eventPhrase, type NodeEventRow, nodeEvents } from './lib/events';
import { GHOST_CHURN } from './lib/placeholders';
import { Redact, WaitAside } from './Redact';
import './activity.css';

/** Rows of events listed, and the height reserved for them. */
const EVENT_ROWS = 7;

function ChurnTable({ rows }: { rows: readonly ChurnRow[] }) {
  const note = rows.find((r) => r.note)?.note ?? null;
  return (
    <>
      <table className="nd-churn">
        <caption className="ui-sr-only">Nodes that joined and left the confirmed set</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="ui-sr-only">Period</span>
            </th>
            <th scope="col">Joined</th>
            <th scope="col">Left</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.window}>
              <th scope="row">
                <span className="nd-churn__label">
                  <span className="nd-churn__window">{r.label}</span>
                  {r.complete ? null : <small>at least</small>}
                </span>
              </th>
              <td data-dir="up">
                {r.complete ? null : <span className="ui-sr-only">at least </span>}
                {signed(r.joined)}
              </td>
              <td data-dir="down">
                {r.complete ? null : <span className="ui-sr-only">at least </span>}
                {signed(-r.left)}
              </td>
              <td data-dir={r.net > 0 ? 'up' : r.net < 0 ? 'down' : 'flat'}>{signed(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="nd-churn__defs">
        <div>
          <dt>Joined</dt>
          <dd>a node confirmed for the first time</dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd>
            a node that expired, spent its collateral or went missing; a move to or from the DoS list does not
            count
          </dd>
        </div>
        <div data-line="counted">
          <dt>Counted</dt>
          <dd>{note ?? 'over the whole period'}</dd>
        </div>
      </dl>
    </>
  );
}

function ChurnBlock({ q, rows }: { q: HubQuery<NodesOverviewDto>; rows: readonly ChurnRow[] }) {
  if (q.isPending) {
    return (
      <Redact>
        <ChurnTable rows={GHOST_CHURN} />
      </Redact>
    );
  }
  if (!q.data) {
    return (
      <p className="nd-note" role="status" data-tone="warn">
        {isFilling(q.error)
          ? 'The server is still reading the chain tip, so the counts are not known yet.'
          : 'The counts of nodes that joined and left could not be loaded.'}
        <Button size="sm" variant="ghost" loading={q.isFetching} onClick={() => void q.refetch()}>
          Try again
        </Button>
      </p>
    );
  }
  if (rows.length === 0) return <p className="nd-note">The server has no join and leave counts yet.</p>;
  return <ChurnTable rows={rows} />;
}

const EventRow = memo(function EventRow({ row, fresh }: { row: NodeEventRow; fresh: boolean }) {
  const meta = statusMeta(row.status);
  const Icon = meta.icon;
  return (
    <li className="nd-ev" data-status={meta.tone} data-fresh={fresh || undefined}>
      <span className="nd-ev__glyph" aria-hidden="true">
        <Icon size={14} strokeWidth={1.5} />
      </span>
      <span className="nd-ev__node">
        <NodeLink id={row.nodeId} glyph={false} />
      </span>
      <span className="nd-ev__what">{eventPhrase(row)}</span>
      <RelativeTime ts={row.tsMs} className="nd-ev__age" />
    </li>
  );
});

function EventsBlock() {
  const feed = useFeed();
  const loaded = useNetwork((s) => s.loaded);
  const rows = useMemo(() => nodeEvents(feed, EVENT_ROWS), [feed]);
  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  // An event that lands slides in; the first fill is history and a resync is not news.
  const fresh = useFresh(keys, { max: 3 });

  if (!loaded && rows.length === 0) {
    return (
      <div className="nd-ev__reserve nd-ev__skeleton" aria-hidden="true">
        {Array.from({ length: EVENT_ROWS }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decoration
          <Skeleton key={i} radius={8} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="nd-ev__reserve nd-ev__empty">
        <EmptyState compact icon={Activity} title="No node events yet">
          A node that joins, starts or leaves appears here as it happens.
        </EmptyState>
      </div>
    );
  }
  return (
    <ol className="nd-ev__reserve nd-events" aria-label="Latest node events, newest first">
      {rows.map((r) => (
        <EventRow key={r.key} row={r} fresh={fresh.has(r.key)} />
      ))}
    </ol>
  );
}

export function ActivityPanel() {
  const q = useNodesOverview();
  const rows = useMemo(() => churnRows(q.data?.churn), [q.data]);
  const waiting = q.isPending && isFilling(q.failureReason);
  return (
    <HubPanel
      id="nd-activity"
      span="twothirds"
      title="Live activity"
      icon={Activity}
      aside={waiting ? <WaitAside what="The counts" /> : 'nodes joining and leaving'}
      footer={
        <>
          <HubLink to={{ type: 'analytics', key: 'churn' }}>Open churn in analytics</HubLink>
          <span className="nd-foot-note">Counted from the node events this server has stored</span>
        </>
      }
    >
      <div className="nd-act" style={{ '--nd-ev-max': EVENT_ROWS } as CSSProperties}>
        <section className="nd-act__part" aria-labelledby="nd-act-churn">
          <h3 id="nd-act-churn" className="nd-sub">
            Joined and left
          </h3>
          <ChurnBlock q={q} rows={rows} />
        </section>
        <section className="nd-act__part" aria-labelledby="nd-act-events">
          <h3 id="nd-act-events" className="nd-sub">
            Latest node events
          </h3>
          <EventsBlock />
        </section>
      </div>
    </HubPanel>
  );
}

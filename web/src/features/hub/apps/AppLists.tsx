// The two short lists of the hub: the newest apps, and the ones closest to their end. Both read the overview (ten rows
// each, the server's own picks), both word their times as the estimates they are ("about 3 hours ago": the server
// counts back from the tip at 30 seconds a block) with the exact figure beside them, and each row is a link that opens
// the app. A new app that arrives while the page is open takes a brief wash. The apps about to go wear an hourglass and
// the warning colour, so the urgency never rests on colour alone.

import { History, Hourglass, PackagePlus } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { useFresh } from '../../../motion';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { appColorSlot } from '../../wallet/lib/apps';
import { HubPanel, type HubQuery, type PanelState } from '..';
import { Ghost, WaitAside } from './ghost';
import { ghostExpiringRows, ghostNewRows } from './lib/placeholders';
import { expiringRows, newRows } from './lib/rows';
import { isWaiting, panelError, useMinute } from './parts';
import './lists.css';

/** The server's picks are ten of each; the loading state draws ten made-up rows. */
const ROWS = 10;
const GHOST_NEW = ghostNewRows(ROWS);
const GHOST_EXPIRING = ghostExpiringRows(ROWS);

interface RowProps {
  name: string;
  label: string;
  when: string;
  whenTitle: string | undefined;
  running: string;
  /** The exact figure under the running count: the blocks left. */
  exact?: string;
  fresh?: boolean;
  soon?: boolean;
}

function Row({ name, label, when, whenTitle, running, exact, fresh, soon }: RowProps) {
  return (
    <li
      className="ap-li"
      title={whenTitle}
      data-fresh={fresh || undefined}
      data-soon={soon || undefined}
      style={{ '--ap-c': `var(--viz-${appColorSlot(name)})` } as CSSProperties}
    >
      <span className="ap-li__dot" aria-hidden="true" />
      <span className="ap-li__main">
        <ShellLink to={{ type: 'app', key: name }} className="ap-li__name">
          {label}
        </ShellLink>
        <span className="ap-li__when">
          {soon ? <Hourglass size={12} strokeWidth={1.5} aria-hidden="true" /> : null}
          <span>{when}</span>
        </span>
      </span>
      <span className="ap-li__side">
        <span className="ap-li__running ap-num">{running}</span>
        {exact ? <span className="ap-li__exact">{exact}</span> : null}
      </span>
    </li>
  );
}

/** Loading is the ready state with made-up rows, so the footer is there and the panel does not grow when they arrive. */
const stateOf = (q: HubQuery<AppsOverviewDto>, rows: number): PanelState =>
  q.data ? (rows === 0 ? 'empty' : 'ready') : q.isPending ? 'ready' : 'error';

const isLoading = (q: HubQuery<AppsOverviewDto>): boolean => !q.data && q.isPending;

/** The ten most recent registrations, newest first. */
export function NewAppsPanel({ overview }: { overview: HubQuery<AppsOverviewDto> }) {
  const o = overview.data;
  const now = useMinute();
  const rows = useMemo(() => (o ? newRows(o.newest, now) : []), [o, now]);
  const keys = useMemo(() => (o ? o.newest.map((a) => a.name) : []), [o]);
  // An app registered while the page is open slides in and takes a wash; the first render marks nothing.
  const fresh = useFresh(keys, { max: 3 });

  return (
    <HubPanel
      id="new-apps"
      span="half"
      title="New apps"
      icon={PackagePlus}
      aside={
        rows.length > 0 ? (
          `latest ${rows.length}`
        ) : isWaiting(overview) ? (
          <WaitAside what="The apps" />
        ) : undefined
      }
      state={stateOf(overview, rows.length)}
      aria-busy={isLoading(overview) || undefined}
      error={overview.error}
      onRetry={() => void overview.refetch()}
      retrying={overview.isFetching}
      {...panelError(overview.error, 'the newest apps')}
      emptyIcon={PackagePlus}
      emptyTitle="No registrations seen yet"
      emptyText="New apps appear here as their registration is mined."
      flush
      footer={
        isLoading(overview) || rows.length > 0 ? (
          <span className="ap-foot-note">Times are estimates from the block height.</span>
        ) : undefined
      }
    >
      {isLoading(overview) ? (
        <Ghost>
          <ol className="ap-list">
            {GHOST_NEW.map((r) => (
              <Row
                key={r.name}
                name={r.name}
                label={r.label}
                when={r.when}
                whenTitle={r.whenTitle}
                running={r.running}
              />
            ))}
          </ol>
        </Ghost>
      ) : o ? (
        <>
          {o.history_complete ? null : (
            <p className="ap-note ap-note--pad" role="status">
              <History size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>Still filling: only the registrations this server has seen.</span>
            </p>
          )}
          <ol className="ap-list" aria-label="The newest apps, latest first">
            {rows.map((r) => (
              <Row
                key={r.name}
                name={r.name}
                label={r.label}
                when={r.when}
                whenTitle={r.whenTitle}
                running={r.running}
                fresh={fresh.has(r.name)}
              />
            ))}
          </ol>
        </>
      ) : null}
    </HubPanel>
  );
}

/** The ten apps whose expiry is soonest. */
export function ExpiringPanel({ overview }: { overview: HubQuery<AppsOverviewDto> }) {
  const o = overview.data;
  const now = useMinute();
  const rows = useMemo(() => (o ? expiringRows(o.expiring, now) : []), [o, now]);

  return (
    <HubPanel
      id="expiring"
      span="half"
      title="Expiring soon"
      icon={Hourglass}
      aside={
        rows.length > 0 ? (
          `next ${rows.length}`
        ) : isWaiting(overview) ? (
          <WaitAside what="The apps" />
        ) : undefined
      }
      state={stateOf(overview, rows.length)}
      aria-busy={isLoading(overview) || undefined}
      error={overview.error}
      onRetry={() => void overview.refetch()}
      retrying={overview.isFetching}
      {...panelError(overview.error, 'the apps about to expire')}
      emptyIcon={Hourglass}
      emptyTitle="No expiries to show"
      emptyText="The server lists no app with an expiry ahead of the chain tip."
      flush
      footer={
        isLoading(overview) || rows.length > 0 ? (
          <span className="ap-foot-note">The time is an estimate; the block count is exact.</span>
        ) : undefined
      }
    >
      {isLoading(overview) ? (
        <Ghost>
          <ol className="ap-list">
            {GHOST_EXPIRING.map((r) => (
              <Row
                key={r.name}
                name={r.name}
                label={r.label}
                when={r.when}
                whenTitle={r.whenTitle}
                running={r.running}
                exact={r.blocks}
              />
            ))}
          </ol>
        </Ghost>
      ) : o ? (
        <ol className="ap-list" aria-label="The apps closest to expiry, soonest first">
          {rows.map((r) => (
            <Row
              key={r.name}
              name={r.name}
              label={r.label}
              when={r.when}
              whenTitle={r.whenTitle}
              running={r.running}
              exact={r.blocks}
              soon={r.soon}
            />
          ))}
        </ol>
      ) : null}
    </HubPanel>
  );
}

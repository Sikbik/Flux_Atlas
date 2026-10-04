// What was deployed each day: apps registered and apps updated (a renewal counts as an update) over the last 90 UTC
// days, as bars, with the totals and the busiest whole day above them. The day still running is drawn lighter. Until
// the server has read the whole history of the permanent app messages the days cover only what it has seen, and the
// panel says so quietly instead of letting a short early bar pass for a quiet day.

import { History, Rocket } from 'lucide-react';
import { useMemo } from 'react';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { formatInt } from '../../../lib/format';
import { formatDay } from '../../wallet/lib/dates';
import { HubPanel, type HubQuery, type PanelState } from '..';
import { DeploymentsChart } from './DeploymentsChart';
import { Ghost, WaitAside } from './ghost';
import { type DeploySeries, type DeployTotals, deploySeries, deployTotals } from './lib/deploy';
import { ghostDeployDays, ghostDeployTotals } from './lib/placeholders';
import { isWaiting, panelError, useMinute } from './parts';
import './deploy.css';

/** The three figures over the chart and the chart. The loading state draws them too, from made-up days. */
function DeploymentsBody({
  series,
  totals,
  complete,
  note,
}: {
  series: DeploySeries;
  totals: DeployTotals;
  complete: boolean;
  /** The line over the figures when the history is still being read; none while the panel loads. */
  note?: boolean;
}) {
  return (
    <div className="ap-dep">
      {note ? (
        <p className="ap-note" role="status">
          <History size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>Still filling: only the messages this server has seen. Earlier days may read low.</span>
        </p>
      ) : null}
      <dl className="ap-mini">
        <div>
          <dt data-static>Registered</dt>
          <dd className="ap-mini__v">{formatInt(totals.registered)}</dd>
          <dd className="ap-mini__n">apps in {formatInt(totals.days)} days</dd>
        </div>
        <div>
          <dt data-static>Updated</dt>
          <dd className="ap-mini__v">{formatInt(totals.updated)}</dd>
          <dd className="ap-mini__n">renewals included</dd>
        </div>
        <div>
          <dt data-static>Busiest day</dt>
          <dd className="ap-mini__v">{totals.busiest ? formatDay(totals.busiest.t) : 'None'}</dd>
          <dd className="ap-mini__n">
            {totals.busiest ? `${formatInt(totals.busiest.total)} messages` : 'no whole day had any'}
          </dd>
        </div>
      </dl>
      <DeploymentsChart series={series} complete={complete} />
    </div>
  );
}

/** The footnote under the chart; the day still running is the last one, so the loading state says it too. */
const footNote = (running: boolean): string =>
  `Whole UTC days${running ? '. The day still running is drawn lighter.' : '.'}`;

export function DeploymentsPanel({ overview }: { overview: HubQuery<AppsOverviewDto> }) {
  const o = overview.data;
  const now = useMinute();
  const series = useMemo(() => (o ? deploySeries(o.deployments, now) : null), [o, now]);
  const totals = useMemo(() => (series ? deployTotals(series) : null), [series]);

  // Loading is the ready state with made-up days, so the footer is there and the panel does not grow when they arrive.
  const loading = !o && overview.isPending;
  const ghost = useMemo(
    () =>
      loading ? { series: deploySeries(ghostDeployDays(now), now), totals: ghostDeployTotals(now) } : null,
    [loading, now],
  );
  const state: PanelState = o
    ? o.deployments.length === 0
      ? 'empty'
      : 'ready'
    : loading
      ? 'ready'
      : 'error';

  return (
    <HubPanel
      id="deployments"
      span="twothirds"
      title="Deployments"
      icon={Rocket}
      aside={
        series && series.t.length > 0 ? (
          `last ${formatInt(series.t.length)} days`
        ) : isWaiting(overview) ? (
          <WaitAside what="The deployments" />
        ) : undefined
      }
      state={state}
      aria-busy={loading || undefined}
      error={overview.error}
      onRetry={() => void overview.refetch()}
      retrying={overview.isFetching}
      {...panelError(overview.error, 'the deployments')}
      emptyIcon={Rocket}
      emptyTitle="No deployments recorded"
      emptyText="The server has not seen an app registered or updated in this range."
      footer={
        ghost ? (
          <span className="ap-foot-note">{footNote(ghost.series.running)}</span>
        ) : series && series.t.length > 0 ? (
          <span className="ap-foot-note">{footNote(series.running)}</span>
        ) : undefined
      }
    >
      {ghost ? (
        <Ghost>
          <DeploymentsBody series={ghost.series} totals={ghost.totals} complete />
        </Ghost>
      ) : o && series && totals ? (
        <DeploymentsBody
          series={series}
          totals={totals}
          complete={o.history_complete}
          note={!o.history_complete}
        />
      ) : null}
    </HubPanel>
  );
}

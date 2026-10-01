// The one-line summaries of the node inspector's folds: what is inside, live, without opening it. Each reads
// data the view already holds (the live node table, the node detail), so a closed fold costs no request of its
// own except the payment ledger the lead already reads.

import type { ReactNode } from 'react';
import { useNetworkVersions, useNodePayments } from '../../../api/queries';
import { fluxToNumber, formatFlux, formatInt, middleTruncate } from '../../../lib/format';
import { LiveDot, Skeleton, type StatusTone } from '../../../ui';
import { spanText } from '../derive/eta';
import { checkinGauge } from '../derive/expiry';
import { latestVersion, versionStanding } from '../derive/versions';
import { useHostNodes } from '../sources/host';
import { useSince, useStartLeft } from './checkin';
import { useNodeCtx } from './context';

/** A summary line: an optional status dot, then the words. */
function Sum({ tone, children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className="ix-sum">
      {tone ? <LiveDot status={tone} ping={false} size={6} /> : null}
      <span>{children}</span>
    </span>
  );
}

export function PaymentsSummary() {
  const { apiKey } = useNodeCtx();
  const q = useNodePayments(apiKey, { limit: 50 });
  if (q.isPending) return <Skeleton h={12} w={150} />;
  const pages = q.data?.pages ?? [];
  const count = pages.reduce((n, p) => n + p.items.length, 0);
  const more = pages.length > 0 && pages[pages.length - 1]?.next_cursor != null;
  if (!count) return <Sum>No payment recorded yet</Sum>;
  const paid = (fluxToNumber(pages[0]?.total_paid ?? null) ?? 0) > 0 ? (pages[0]?.total_paid ?? null) : null;
  return (
    <Sum>
      <span className="ui-mono">
        {formatInt(count)}
        {more ? '+' : ''}
      </span>{' '}
      {count === 1 ? 'payment' : 'payments'}
      {paid ? (
        <>
          {' '}
          · <span className="ui-mono">{formatFlux(paid)}</span>
        </>
      ) : null}
    </Sum>
  );
}

export function HealthSummary() {
  const { node, live } = useNodeCtx();
  const since = useSince();
  const left = useStartLeft();
  const status = live?.status ?? node?.status ?? 'unknown';
  const g = checkinGauge(since);

  if (status === 'dos') return <Sum tone="crit">DoS listed, skipped by the queue</Sum>;
  if (status === 'started') {
    return (
      <Sum tone="pending">
        Waiting for its first confirmation{left !== null ? `, ${formatInt(left)} blocks left` : ''}
      </Sum>
    );
  }
  if (since === null) return <Sum tone="off">Last check-in not known yet</Sum>;
  if (g.state === 'expired') {
    return <Sum tone="crit">Past expiry: no check-in for {formatInt(since)} blocks</Sum>;
  }
  if (g.state === 'atRisk') {
    return <Sum tone="warn">At risk: expires in {spanText(g.msToExpiry ?? 0)} without a check-in</Sum>;
  }
  return (
    <Sum tone="ok">
      Last check-in {spanText(since * 30_000)} ago
      {g.state === 'due' ? ', due now' : `, next due in ${spanText((g.blocksToDue ?? 0) * 30_000)}`}
    </Sum>
  );
}

export function HardwareSummary() {
  const { node, live } = useNodeCtx();
  const hw = node?.hardware ?? null;
  const cores = hw?.cores || live?.cores || 0;
  const ram = hw?.ram_gb || live?.ramGb || 0;
  const ssd = hw?.ssd_gb || live?.ssdGb || 0;
  if (!cores && !ram && !ssd) return <Sum>Not benchmarked yet</Sum>;
  const bench = hw?.bench_status ?? 'unknown';
  return (
    <Sum tone={bench === 'failed' ? 'crit' : undefined}>
      <span className="ui-mono">{cores || '?'}</span> cores ·{' '}
      <span className="ui-mono">{ram ? Math.round(ram) : '?'}</span> GB RAM ·{' '}
      <span className="ui-mono">{ssd ? formatInt(Math.round(ssd)) : '?'}</span> GB SSD
      {bench === 'failed' ? ' · benchmark failed' : ''}
    </Sum>
  );
}

/** The FluxOS release the node runs and whether it is the newest the network runs. */
export function VersionsSummary() {
  const { node, live } = useNodeCtx();
  const v = useNetworkVersions();
  const flux = node?.versions.flux_os ?? (live?.fluxOs || null);
  if (!flux) return <Sum>Not reported</Sum>;
  const latest = v.data ? latestVersion(v.data.flux_os) : null;
  const standing = versionStanding(flux, latest);
  return (
    <Sum tone={standing === 'behind' ? 'warn' : standing === 'latest' ? 'ok' : undefined}>
      FluxOS <span className="ui-mono">{flux}</span>
      {standing === 'latest' ? ', latest' : standing === 'behind' ? `, behind ${latest}` : ''}
    </Sum>
  );
}

export function NetworkSummary() {
  const { node, live, ip } = useNodeCtx();
  const onHost = useHostNodes(ip).length;
  const reachable = live?.reachable ?? node?.reachable ?? null;
  const out = node?.peers_out;
  const inn = node?.peers_in;
  return (
    <Sum tone={reachable === true ? 'ok' : 'off'}>
      {reachable === true ? 'Reachable' : reachable === false ? 'Unreachable' : 'Not checked yet'}
      {onHost > 1 ? ` · ${onHost} nodes on this IP` : ''}
      {(out ?? 0) + (inn ?? 0) > 0 ? (
        <>
          {' '}
          · <span className="ui-mono">{out ?? 0}</span> out, <span className="ui-mono">{inn ?? 0}</span> in
        </>
      ) : null}
    </Sum>
  );
}

export function ActivitySummary() {
  const { detail } = useNodeCtx();
  if (!detail) return <Skeleton h={12} w={120} />;
  const apps = detail.apps.length;
  const events = detail.recent_events.length;
  return (
    <Sum>
      <span className="ui-mono">{apps}</span> {apps === 1 ? 'app' : 'apps'} ·{' '}
      <span className="ui-mono">{events}</span> {events === 1 ? 'event' : 'events'} recorded
    </Sum>
  );
}

export function IdentitySummary() {
  const { node } = useNodeCtx();
  if (!node) return <Skeleton h={12} w={150} />;
  return (
    <Sum>
      Pays <span className="ui-mono">{middleTruncate(node.payment_address ?? 'unknown', 8, 5)}</span>
    </Sum>
  );
}

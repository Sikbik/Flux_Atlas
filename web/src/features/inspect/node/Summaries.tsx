// The one-line summaries of the node inspector's disclosure rows: what is inside, live, without
// opening it. Each reads data the view already holds (the live node table, the node detail), so a
// closed row costs no request of its own except the payment ledger the lead tiles already read.

import { useNodePayments } from '../../../api/queries';
import { fluxToNumber, formatFlux, formatInt, middleTruncate } from '../../../lib/format';
import { spanText } from '../derive/eta';
import { checkinGauge } from '../derive/expiry';
import { useHostNodes } from '../sources/host';
import { Dot, Sk } from '../ui';
import { useNodeCtx } from './context';
import { useSince } from './Health';

export function PaymentsSummary() {
  const { apiKey } = useNodeCtx();
  const q = useNodePayments(apiKey, { limit: 50 });
  if (q.isPending) return <Sk h={12} w={150} />;
  const pages = q.data?.pages ?? [];
  const count = pages.reduce((n, p) => n + p.items.length, 0);
  const more = pages.length > 0 && pages[pages.length - 1]?.next_cursor != null;
  if (!count) return <span>No payment recorded yet</span>;
  const paid = (fluxToNumber(pages[0]?.total_paid ?? null) ?? 0) > 0 ? (pages[0]?.total_paid ?? null) : null;
  return (
    <span>
      <span className="ix-mono">
        {formatInt(count)}
        {more ? '+' : ''}
      </span>{' '}
      {count === 1 ? 'payment' : 'payments'}
      {paid ? (
        <>
          {' '}
          · <span className="ix-mono">{formatFlux(paid)}</span>
        </>
      ) : null}{' '}
      since first ingest
    </span>
  );
}

export function HealthSummary() {
  const { node, live } = useNodeCtx();
  const since = useSince();
  const status = live?.status ?? node?.status ?? 'unknown';
  const g = checkinGauge(since);

  if (status === 'dos') {
    return (
      <>
        <Dot tone="crit" />
        <span>DoS listed, skipped by the queue</span>
      </>
    );
  }
  if (status === 'started') {
    return (
      <>
        <Dot tone="pending" />
        <span>Waiting for its first confirmation</span>
      </>
    );
  }
  if (since === null) {
    return (
      <>
        <Dot tone="off" />
        <span>Last check-in not known yet</span>
      </>
    );
  }
  if (g.state === 'expired') {
    return (
      <>
        <Dot tone="crit" />
        <span>Past expiry: no check-in for {formatInt(since)} blocks</span>
      </>
    );
  }
  if (g.state === 'atRisk') {
    return (
      <>
        <Dot tone="warn" />
        <span>At risk: expires in {spanText(g.msToExpiry ?? 0)} without a check-in</span>
      </>
    );
  }
  return (
    <>
      <Dot tone="ok" />
      <span>
        Checked in {spanText(since * 30_000)} ago
        {g.state === 'due' ? ', due now' : `, next due in ${spanText((g.blocksToDue ?? 0) * 30_000)}`}
      </span>
    </>
  );
}

export function HardwareSummary() {
  const { node, live } = useNodeCtx();
  const hw = node?.hardware ?? null;
  const cores = hw?.cores || live?.cores || 0;
  const ram = hw?.ram_gb || live?.ramGb || 0;
  const ssd = hw?.ssd_gb || live?.ssdGb || 0;
  if (!cores && !ram && !ssd) return <span>Not benchmarked yet</span>;
  const bench = hw?.bench_status ?? 'unknown';
  return (
    <>
      {bench === 'failed' ? <Dot tone="crit" /> : null}
      <span>
        <span className="ix-mono">{cores || '?'}</span> cores ·{' '}
        <span className="ix-mono">{ram ? Math.round(ram) : '?'}</span> GB RAM ·{' '}
        <span className="ix-mono">{ssd ? formatInt(Math.round(ssd)) : '?'}</span> GB SSD
        {bench === 'failed' ? ' · benchmark failed' : ''}
      </span>
    </>
  );
}

export function NetworkSummary() {
  const { node, live, ip } = useNodeCtx();
  const onHost = useHostNodes(ip).length;
  const reachable = live?.reachable ?? node?.reachable ?? null;
  const out = node?.peers_out;
  const inn = node?.peers_in;
  return (
    <>
      <Dot tone={reachable === true ? 'ok' : 'off'} />
      <span>
        {reachable === true ? 'Reachable' : reachable === false ? 'Unreachable' : 'Not checked yet'}
        {onHost > 1 ? ` · ${onHost} nodes on this IP` : ''}
        {out != null || inn != null ? (
          <>
            {' '}
            · <span className="ix-mono">{out ?? 0}</span> out, <span className="ix-mono">{inn ?? 0}</span> in
          </>
        ) : null}
      </span>
    </>
  );
}

export function ActivitySummary() {
  const { detail } = useNodeCtx();
  if (!detail) return <Sk h={12} w={120} />;
  const apps = detail.apps.length;
  const events = detail.recent_events.length;
  return (
    <span>
      <span className="ix-mono">{apps}</span> {apps === 1 ? 'app' : 'apps'} ·{' '}
      <span className="ix-mono">{events}</span> {events === 1 ? 'event' : 'events'} recorded
    </span>
  );
}

export function IdentitySummary() {
  const { node } = useNodeCtx();
  if (!node) return <Sk h={12} w={150} />;
  return (
    <span>
      Pays <span className="ix-mono">{middleTruncate(node.payment_address ?? 'unknown', 8, 5)}</span>
    </span>
  );
}

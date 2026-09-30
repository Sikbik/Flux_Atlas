// /dev/live: an engineering view of the live pipeline, used to verify it end to end. Connection
// state, seq bookkeeping, latency, message rates by type, the last block, store sizes and the
// choreographer's effect log. Refreshes on the shared 1 Hz clock and on every store change.

import type { LatencyStats } from '../../api/live';
import { useNetwork, useRuntime } from '../../app/context';
import { formatAgo, formatFlux, formatHeight, formatInt, formatUtcTime } from '../../lib/format';
import { useBeat, useNow } from '../../lib/useClock';

function ms(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v)} ms`;
}

function Latency({ label, s }: { label: string; s: LatencyStats }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="tabular">{ms(s.last)}</td>
      <td className="tabular">{ms(s.ema)}</td>
      <td className="tabular">{ms(s.p50)}</td>
      <td className="tabular">{ms(s.p95)}</td>
      <td className="tabular">{formatInt(s.samples)}</td>
    </tr>
  );
}

function Row({ k, v, id }: { k: string; v: React.ReactNode; id?: string }) {
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd className="mono tabular" data-testid={id}>
        {v}
      </dd>
    </div>
  );
}

export function LiveInspector() {
  const rt = useRuntime();
  const now = useNow(rt.clock);
  const beat = useBeat(rt.clock);
  // Re-render on any store change as well as on the clock tick.
  const version = useNetwork((s) => s.version);
  const s = rt.store;
  const m = rt.live.metrics();
  const conn = s.connection;
  const last = s.blocks.newest();
  const liveBlocks = s.blocks.toArray().filter((b) => b.live).length;
  const types = Object.keys(m.byType).sort();
  const choreo = rt.choreo.stats();
  const effects = rt.effects.log.slice(-16).reverse();

  return (
    <section className="panel inspector" aria-label="Live inspector" data-window="dev" data-version={version}>
      <header className="panel-head">
        <h1 className="panel-title">Live inspector</h1>
        <span className="panel-kind">dev</span>
      </header>
      <div className="panel-body grid">
        <div>
          <h2>Connection</h2>
          <dl className="kv">
            <Row k="Status" v={conn.status} id="conn-status" />
            <Row k="Since" v={conn.sinceMs ? formatAgo(Date.now() - conn.sinceMs) : 'n/a'} />
            <Row k="Attempt" v={conn.attempt} />
            <Row
              k="Retry in"
              v={conn.retryAtMs ? `${Math.max(0, Math.ceil((conn.retryAtMs - Date.now()) / 1000))} s` : 'n/a'}
            />
            <Row k="Last close code" v={conn.lastCloseCode ?? 'n/a'} />
            <Row k="Last error" v={conn.lastError ?? 'none'} />
            <Row k="Server" v={conn.server ? `${conn.server.name} ${conn.server.version}` : 'n/a'} />
            <Row k="Upstream stale" v={s.stale ? 'yes' : 'no'} />
          </dl>
          <div className="actions">
            <button type="button" className="button" onClick={() => rt.live.reconnectNow()}>
              Reconnect now
            </button>
            <button type="button" className="button" onClick={() => rt.live.requestResync('manual')}>
              Force resync
            </button>
          </div>
        </div>

        <div>
          <h2>Sequence</h2>
          <dl className="kv">
            <Row k="Store seq (resume)" v={s.seq} id="store-seq" />
            <Row k="Client last seq" v={m.lastSeq} />
            <Row k="Hello seq" v={m.helloSeq ?? 'n/a'} />
            <Row k="nodes.bin seq" v={s.nodes.snapshotSeq} />
            <Row k="Bootstrap seq" v={s.bootstrapSeq} />
            <Row k="mesh.bin seq" v={s.meshSnapshotSeq} />
            <Row k="Duplicates" v={m.duplicates} />
            <Row k="Soft gaps" v={m.softGaps} />
            <Row k="Store gaps" v={s.stats.gaps} />
            <Row k="Skipped (in snapshot)" v={s.stats.skippedStale} />
            <Row k="Malformed" v={m.malformed} />
            <Row k="Resyncs" v={m.resyncs} id="resyncs" />
            <Row k="Reconnects" v={m.reconnects} />
          </dl>
        </div>

        <div>
          <h2>Latency</h2>
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>last</th>
                <th>ema</th>
                <th>p50</th>
                <th>p95</th>
                <th>n</th>
              </tr>
            </thead>
            <tbody>
              <Latency label="Server to browser" s={m.transitMs} />
              <Latency label="Upstream to server" s={m.ingestMs} />
            </tbody>
          </table>
          <dl className="kv">
            <Row k="Clock offset" v={ms(m.clockOffsetMs)} />
            <Row k="Server time" v={formatUtcTime(now)} />
          </dl>
        </div>

        <div>
          <h2>Messages</h2>
          <table className="table">
            <thead>
              <tr>
                <th>type</th>
                <th>total</th>
                <th>per s (10 s)</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t}>
                  <th scope="row" className="mono">
                    {t}
                  </th>
                  <td className="tabular" data-testid={`msg-${t}`}>
                    {formatInt(m.byType[t] ?? 0)}
                  </td>
                  <td className="tabular">{(m.ratePerSec[t] ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="kv">
            <Row k="Total" v={`${formatInt(m.messages)} messages, ${formatInt(m.bytes)} bytes`} />
          </dl>
        </div>

        <div>
          <h2>Last block</h2>
          {last ? (
            <dl className="kv">
              <Row k="Height" v={formatHeight(last.height)} id="last-block-height" />
              <Row k="Age" v={formatAgo(now - last.timeMs)} />
              <Row k="Received live" v={last.live ? 'yes' : 'no (bootstrap)'} />
              <Row k="Live blocks received" v={liveBlocks} id="live-blocks" />
              <Row k="Producer" v={last.producer ?? 'unknown'} />
              <Row
                k="Payouts"
                v={
                  last.payouts.map((p) => `${p.tier} ${formatFlux(p.amount, { unit: false })}`).join(', ') ||
                  'none'
                }
              />
              <Row k="Transactions" v={last.txCount} />
              <Row
                k="Next block"
                v={
                  beat.phase === 'late' || beat.phase === 'quiet'
                    ? `late ${Math.round(beat.sinceMs / 1000)} s`
                    : `in ${Math.ceil(beat.remainingMs / 1000)} s`
                }
              />
              <Row k="Beat progress" v={`${Math.round(beat.progress * 100)}%`} />
            </dl>
          ) : (
            <p className="muted">No block yet</p>
          )}
        </div>

        <div>
          <h2>Store</h2>
          <dl className="kv">
            {Object.entries(s.sizes()).map(([k, v]) => (
              <Row key={k} k={k} v={formatInt(v)} id={`store-${k}`} />
            ))}
            <Row k="Next payees" v={s.nextPayees ? `for ${formatHeight(s.nextPayees.height)}` : 'n/a'} />
            <Row k="Tip" v={s.tip ? formatHeight(s.tip.height) : 'n/a'} />
            <Row k="Store version" v={s.version} />
          </dl>
        </div>

        <div className="wide">
          <h2>Choreographer</h2>
          <p className="tabular">
            {choreo.blocks} blocks ({choreo.compactBlocks} compact), {choreo.played} played, {choreo.dropped}{' '}
            dropped, {choreo.coalesced} coalesced, {choreo.recapped} recapped
          </p>
          <ol className="log mono">
            {effects.map((e) => (
              <li key={e.seq}>
                {new Date(e.at).toISOString().slice(11, 23)} {e.name} {summarize(e.cmd)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function summarize(cmd: unknown): string {
  if (!cmd || typeof cmd !== 'object') return '';
  const c = cmd as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['height', 'node', 'to', 'from', 'tier', 'kind', 'count', 'app', 'phase']) {
    if (c[k] !== undefined && c[k] !== null) parts.push(`${k}=${String(c[k])}`);
  }
  if (Array.isArray(c.nodes)) parts.push(`nodes=${c.nodes.length}`);
  if (Array.isArray(c.payees)) parts.push(`payees=${c.payees.length}`);
  return parts.join(' ');
}

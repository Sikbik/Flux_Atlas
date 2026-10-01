// The chrome's hover cards: the status bar's (the connection and every source's age, the network totals, the
// price), the block rail's peek and the Beat's. Each is only wanted once the pointer or focus is on its
// trigger, so they live in one chunk that the triggers load on demand (lazyCard).

import { useMemo } from 'react';
import { useNetwork, usePrice, useRuntime, useSummary, useTip } from '../../app/context';
import { formatAge, formatBytes, formatHeight, formatInt, formatUtcTime, UNKNOWN } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import type { ChainBlock } from '../../store/network';
import { TierGlyph } from '../../ui';
import { notConfirmed } from './counts';
import { type NodeFacts, useNodeFacts } from './data';
import type { PathReading } from './freshness';
import { TIER_LABEL, TIER_ORDER } from './glyphs';
import { amountLabel } from './payouts';
import { placeOfRow } from './places';
import { payeesByTier, txMix } from './rail';
import { formatPrice, formatUsd } from './usd';
import './hovercard.css';

function ageText(r: PathReading): string {
  return r.ageMs === null ? UNKNOWN : formatAge(r.ageMs);
}

const SOURCE_WORD: Record<PathReading['source'], string> = {
  stream: 'live stream',
  snapshot: 'last snapshot',
  none: 'no data yet',
};

export function StatusCard({ readings }: { readings: PathReading[] }) {
  const { clock } = useRuntime();
  const conn = useNetwork((s) => s.connection);
  const server = useNetwork((s) => s.server);
  const jobs = useNetwork((s) => s.freshness);
  const now = clock.now();
  const list = useMemo(() => [...jobs.values()].sort((a, b) => a.job.localeCompare(b.job)), [jobs]);
  return (
    <div className="sb-card-body">
      <span className="hc-title">Connection</span>
      <dl className="hc-rows">
        <dt>State</dt>
        <dd>{conn.status}</dd>
        <dt>Round trip</dt>
        <dd className="mono">{conn.transitMs === null ? UNKNOWN : `${Math.round(conn.transitMs)} ms`}</dd>
        <dt>Upstream detection</dt>
        <dd className="mono">{conn.ingestMs === null ? UNKNOWN : `${Math.round(conn.ingestMs)} ms`}</dd>
        <dt>Server</dt>
        <dd className="mono">{server ? `${server.name} ${server.version}` : UNKNOWN}</dd>
        <dt>Clock offset</dt>
        <dd className="mono">{Math.round(conn.clockOffsetMs)} ms</dd>
      </dl>
      <span className="hc-title sb-card-gap">Freshness</span>
      <dl className="hc-rows">
        {readings.map((r) => (
          <FreshRow key={r.id} reading={r} />
        ))}
      </dl>
      {list.length > 0 ? (
        <>
          <span className="hc-title sb-card-gap">Server ingest jobs</span>
          <dl className="hc-rows sb-jobs">
            {list.map((j) => (
              <JobRow key={j.job} name={j.job} lastOk={j.last_ok_ms} stale={j.stale} now={now} />
            ))}
          </dl>
          <p className="sb-note">
            Job times are as of the last snapshot and refresh when the stream resyncs.
          </p>
        </>
      ) : null}
    </div>
  );
}

function FreshRow({ reading }: { reading: PathReading }) {
  return (
    <>
      <dt>{reading.label}</dt>
      <dd data-state={reading.state} className="sb-card-state">
        {ageText(reading)} <span className="sb-dim">{SOURCE_WORD[reading.source]}</span>
      </dd>
    </>
  );
}

function JobRow({
  name,
  lastOk,
  stale,
  now,
}: {
  name: string;
  lastOk: number | null;
  stale: boolean;
  now: number;
}) {
  return (
    <>
      <dt className="mono">{name}</dt>
      <dd data-state={stale ? 'stale' : 'fresh'} className="sb-card-state">
        {lastOk === null ? UNKNOWN : formatAge(Math.max(0, now - lastOk))}
        {stale ? ' stale' : ''}
      </dd>
    </>
  );
}

export function TotalsCard() {
  const summary = useSummary();
  if (!summary) return null;
  const rows: [string, number][] = [
    ['Nodes', summary.node_count],
    ...notConfirmed(summary),
    ['Hosts', summary.host_count],
    ['Apps', summary.app_count],
    ['App instances', summary.instance_count],
    ['Countries', summary.country_count],
    ['Providers', summary.provider_count],
    ['Unreachable', summary.unreachable_count],
  ];
  return (
    <div className="sb-card-body">
      <span className="hc-title">Network</span>
      <dl className="hc-rows">
        {TIER_ORDER.map((t) => (
          <TierRow key={t} tier={t} count={summary.tiers[t]} />
        ))}
        {rows.map(([k, v]) => (
          <Row key={k} k={k} v={formatInt(v)} />
        ))}
      </dl>
    </div>
  );
}

function TierRow({ tier, count }: { tier: (typeof TIER_ORDER)[number]; count: number }) {
  return (
    <>
      <dt className="sb-tier" data-tier={tier}>
        <TierGlyph tier={tier} size={12} /> {TIER_LABEL[tier]}
      </dt>
      <dd className="mono">{formatInt(count)}</dd>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
    </>
  );
}

export function PriceCard() {
  const price = usePrice();
  if (!price) return null;
  return (
    <div className="sb-card-body">
      <span className="hc-title">FLUX price</span>
      <dl className="hc-rows">
        <Row k="USD" v={formatPrice(price.usd)} />
        <Row k="BTC" v={price.btc.toFixed(10).replace(/0+$/, '')} />
        <Row k="24 h" v={`${price.change_24h_pct >= 0 ? '+' : ''}${price.change_24h_pct.toFixed(2)}%`} />
        <Row k="Market cap" v={formatUsd(price.market_cap_usd)} />
        <Row k="Volume 24 h" v={formatUsd(price.volume_24h_usd)} />
        <Row k="Source" v={price.source} />
        <Row k="Updated" v={formatUtcTime(price.updated_ms)} />
      </dl>
    </div>
  );
}

// ---- the block rail's peek ------------------------------------------------------------------------

function PayeeRow({ p, facts }: { p: ChainBlock['payouts'][number]; facts: NodeFacts | null }) {
  const tier = p.tier === 'unknown' ? 'unknown' : p.tier;
  return (
    <li className="peek-payee" data-tier={tier}>
      <TierGlyph tier={tier} size={13} />
      {facts?.endpoint ? (
        <ShellLink to={{ type: 'node', key: facts.endpoint }} className="peek-link">
          {facts.place ?? facts.endpoint}
        </ShellLink>
      ) : (
        <span className="peek-link">{facts?.place ?? 'Node not in the list'}</span>
      )}
      <span className="mono peek-amt">{amountLabel(Number(p.amount))}</span>
    </li>
  );
}

export function CardPeek({ block, orphan }: { block: ChainBlock; orphan: boolean }) {
  const facts = useNodeFacts();
  const prod = facts(block.producer);
  const mix = txMix(block);
  const payees = payeesByTier(block.payouts);
  return (
    <div className="peek">
      <span className="hc-title">
        <ShellLink to={{ type: 'block', key: String(block.height) }} className="peek-title">
          Block {formatHeight(block.height)}
        </ShellLink>
        {orphan ? <span className="blk-orphan">orphaned</span> : null}
      </span>
      <dl className="hc-rows">
        <dt>Time</dt>
        <dd className="mono">{formatUtcTime(block.timeMs)}</dd>
        <dt>Size</dt>
        <dd className="mono">{formatBytes(block.size)}</dd>
        <dt>Confirmations</dt>
        <dd className="mono">{formatInt(mix.confirms)}</dd>
        <dt>Starts</dt>
        <dd className="mono">{formatInt(mix.starts)}</dd>
        <dt>Large transfers</dt>
        <dd className="mono">{formatInt(mix.transfers)}</dd>
        <dt>Other</dt>
        <dd className="mono">{formatInt(mix.other)}</dd>
        <dt>Producer</dt>
        <dd>
          {prod?.endpoint ? (
            <ShellLink to={{ type: 'node', key: prod.endpoint }} className="peek-link">
              {prod.tier === 'unknown' ? '' : `${TIER_LABEL[prod.tier]}, `}
              {prod.place ?? prod.endpoint}
            </ShellLink>
          ) : (
            UNKNOWN
          )}
        </dd>
      </dl>
      {payees.length > 0 ? (
        <>
          <span className="hc-title peek-gap">Paid</span>
          <ul className="peek-payees">
            {payees.map((p) => (
              <PayeeRow key={p.tier} p={p} facts={facts(p.node)} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ---- the Beat's card ------------------------------------------------------------------------------

export function BeatCard() {
  const { clock, store } = useRuntime();
  const tip = useTip();
  const now = useNow(clock);
  const producer = useNetwork((s) => (s.tip?.producer === null || !s.tip ? null : s.tip.producer));
  if (!tip) return null;
  const idx = producer === null ? -1 : store.nodes.indexOf(producer);
  const city = idx >= 0 ? placeOfRow(store, idx) : null;
  return (
    <>
      <span className="hc-title">The chain's pulse</span>
      <dl className="hc-rows">
        <dt>Last block</dt>
        <dd className="mono">{formatHeight(tip.height)}</dd>
        <dt>Time</dt>
        <dd className="mono">{formatUtcTime(tip.time_ms)}</dd>
        <dt>Age</dt>
        <dd className="mono">{Math.max(0, Math.round((now - tip.time_ms) / 1000))} s</dd>
        {city ? (
          <>
            <dt>Producer</dt>
            <dd>{city}</dd>
          </>
        ) : null}
        <dt>Interval</dt>
        <dd>30 s</dd>
      </dl>
    </>
  );
}

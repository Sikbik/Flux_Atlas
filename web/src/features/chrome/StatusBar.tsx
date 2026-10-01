// The status bar (design 8.8): 28 px of glass at the foot of the screen. Left: the connection chip and one
// freshness chip per ingest path, with the tip's height, age and the next-block progress. Right: the
// reward-cut chip, network totals with the tier split, the price, the clock when the top bar has hidden
// its own, and the build label. Hovering or focusing the left or right group opens the detail behind it.

import { useMemo } from 'react';
import { useNetwork, usePrice, useRuntime, useSummary, useTip } from '../../app/context';
import { formatAge, formatDuration, formatHeight, formatInt, formatUtcTime, UNKNOWN } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { UtcClock, useBlockSince } from './Beat';
import { useRewardCut } from './data';
import { type PathReading, readPaths } from './freshness';
import { TIER_LABEL, TIER_ORDER, TierGlyph, type TierName } from './glyphs';
import { HoverCard } from './HoverCard';
import { useLiveView } from './live';
import { Odometer } from './Odometer';
import { RewardCutCard } from './tickers';
import './statusbar.css';

function ageText(r: PathReading): string {
  return r.ageMs === null ? UNKNOWN : formatAge(r.ageMs);
}

const STATE_WORD: Partial<Record<PathReading['state'], string>> = { stale: 'stale', dead: 'dead' };

export function StatusBar() {
  return (
    <section className="statusbar" data-region="statusbar" aria-label="Network status">
      <StatusLeft />
      <StatusRight />
    </section>
  );
}

function StatusLeft() {
  const { clock, store } = useRuntime();
  const now = useNow(clock);
  const view = useLiveView();
  const jobs = useNetwork((s) => s.freshness);
  const tip = useTip();
  const { since } = useBlockSince();
  const readings = readPaths({
    nowMs: now,
    jobs,
    lastMessage: store.lastMessageMs,
    tipAnchorMs: clock.lastBlockInfo?.anchorMs ?? null,
  });
  const conn = view.status === 'live' && view.tone === 'ok' ? 'WebSocket' : null;
  return (
    <HoverCard
      placement="top"
      className="sb-anchor"
      cardClassName="sb-card"
      card={<StatusCard readings={readings} />}
    >
      <button type="button" className="sb-group sb-left" aria-label="Connection and data freshness">
        <span className="sb-conn" data-tone={view.tone} data-testid="conn-chip">
          <i className="live-dot" aria-hidden="true" />
          <b>{view.label}</b>
          {conn || view.detail ? (
            <span className="sb-dim">{[conn, view.detail].filter(Boolean).join(', ')}</span>
          ) : null}
        </span>
        {readings.map((r) =>
          r.id === 'tip' ? (
            <span key={r.id} className="sb-fresh sb-tipchip" data-state={r.state}>
              <i className="sb-dot" aria-hidden="true" />
              <span>tip</span>
              {tip ? (
                <b>
                  <Odometer value={tip.height} format={formatHeight} />
                </b>
              ) : null}
              <span className="sb-age">{ageText(r)}</span>
              {STATE_WORD[r.state] ? <em>{STATE_WORD[r.state]}</em> : null}
              <span className="sb-prog" aria-hidden="true">
                <i key={tip?.height ?? 0} style={{ '--since': Math.round(since) } as React.CSSProperties} />
              </span>
            </span>
          ) : (
            <span key={r.id} className="sb-fresh" data-state={r.state}>
              <i className="sb-dot" aria-hidden="true" />
              <span>{r.label}</span>
              <span className="sb-age">{ageText(r)}</span>
              {STATE_WORD[r.state] ? <em>{STATE_WORD[r.state]}</em> : null}
            </span>
          ),
        )}
      </button>
    </HoverCard>
  );
}

function StatusCard({ readings }: { readings: PathReading[] }) {
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

const SOURCE_WORD: Record<PathReading['source'], string> = {
  stream: 'live stream',
  snapshot: 'last snapshot',
  none: 'no data yet',
};

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

// ---- the right group ---------------------------------------------------------------------------

function StatusRight() {
  return (
    <div className="sb-group sb-right">
      <RewardCutChip />
      <Totals />
      <PriceChip />
      <span className="sb-clock">
        <UtcClock />
      </span>
      <Build />
    </div>
  );
}

function RewardCutChip() {
  const cut = useRewardCut();
  if (!cut) return null;
  return (
    <HoverCard placement="top" cardClassName="sb-card" card={<RewardCutCard cut={cut} />}>
      <ShellLink to={{ type: 'analytics', key: 'overview' }} className="sb-cut">
        {cut.landed ? (
          <>
            <b>Reward cut</b> landed
          </>
        ) : (
          <>
            Reward cut in <b>{formatDuration(cut.etaMs)}</b>
          </>
        )}
      </ShellLink>
    </HoverCard>
  );
}

function Totals() {
  const summary = useSummary();
  const tiers = summary?.tiers;
  return (
    <HoverCard
      placement="top"
      cardClassName="sb-card"
      card={summary ? <TotalsCard /> : null}
      disabled={!summary}
    >
      <span className="sb-totals">
        {tiers ? (
          <span className="sb-tiers">
            {TIER_ORDER.map((t) => (
              <span key={t} className="sb-tier" data-tier={t}>
                <TierGlyph tier={t} size={12} title={`${TIER_LABEL[t]} nodes`} />
                <b>
                  <Odometer value={tiers[t]} />
                </b>
              </span>
            ))}
          </span>
        ) : null}
        <span>
          <b>
            <Odometer value={summary?.node_count ?? null} />
          </b>{' '}
          nodes
        </span>
        <span className="sb-dot-sep" aria-hidden="true" />
        <span>
          <b>
            <Odometer value={summary?.host_count ?? null} />
          </b>{' '}
          hosts
        </span>
        <span className="sb-dot-sep" aria-hidden="true" />
        <span>
          <b>
            <Odometer value={summary?.app_count ?? null} />
          </b>{' '}
          apps
        </span>
      </span>
    </HoverCard>
  );
}

function TotalsCard() {
  const summary = useSummary();
  if (!summary) return null;
  const rows: [string, number][] = [
    ['Nodes', summary.node_count],
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
        {(Object.keys(TIER_LABEL) as (TierName | 'unknown')[])
          .filter((t): t is TierName => t !== 'unknown')
          .reverse()
          .map((t) => (
            <TierRow key={t} tier={t} count={summary.tiers[t]} />
          ))}
        {rows.map(([k, v]) => (
          <Row key={k} k={k} v={formatInt(v)} />
        ))}
      </dl>
    </div>
  );
}

function TierRow({ tier, count }: { tier: TierName; count: number }) {
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

const USD_SMALL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Past this age the price dims and says so. */
const PRICE_STALE_MS = 15 * 60_000;

function PriceChip() {
  const { clock } = useRuntime();
  const price = usePrice();
  const now = useNow(clock);
  if (!price) return null;
  const stale = now - price.updated_ms > PRICE_STALE_MS;
  const ch = price.change_24h_pct;
  return (
    <HoverCard placement="top" cardClassName="sb-card" card={<PriceCard />}>
      <span className="sb-price" data-stale={stale || undefined}>
        FLUX <b>{(price.usd < 1 ? USD_SMALL : USD).format(price.usd)}</b>
        <span className={ch >= 0 ? 'sb-up' : 'sb-down'}>
          {ch >= 0 ? '+' : ''}
          {ch.toFixed(2)}%
        </span>
        {stale ? <em>stale</em> : null}
      </span>
    </HoverCard>
  );
}

function PriceCard() {
  const price = usePrice();
  if (!price) return null;
  return (
    <div className="sb-card-body">
      <span className="hc-title">FLUX price</span>
      <dl className="hc-rows">
        <Row k="USD" v={(price.usd < 1 ? USD_SMALL : USD).format(price.usd)} />
        <Row k="BTC" v={price.btc.toFixed(10).replace(/0+$/, '')} />
        <Row k="24 h" v={`${price.change_24h_pct >= 0 ? '+' : ''}${price.change_24h_pct.toFixed(2)}%`} />
        <Row k="Market cap" v={USD.format(Math.round(price.market_cap_usd))} />
        <Row k="Volume 24 h" v={USD.format(Math.round(price.volume_24h_usd))} />
        <Row k="Source" v={price.source} />
        <Row k="Updated" v={formatUtcTime(price.updated_ms)} />
      </dl>
    </div>
  );
}

function Build() {
  const server = useNetwork((s) => s.server);
  if (!server) return null;
  return <span className="sb-build">v{server.version}</span>;
}

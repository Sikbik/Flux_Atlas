// The status bar (design 8.8): 28 px of glass at the foot of the screen, quiet at rest. Left: the connection
// chip, the tip's height, age and next-block progress, and one small light per other ingest path (a path
// that is stale or dead steps forward as a chip in words). Right: the reward-cut chip, the node count with
// the tier split, the price, the clock when the top bar has hidden its own, and the build label. Hovering
// or focusing either group opens the detail behind it: every age, every source, every total. The cards are
// their own chunks (lazyCard), fetched when the pointer or focus nears a chip.

import type { Ref } from 'react';
import { useNetwork, usePrice, useRuntime, useSummary, useTip } from '../../app/context';
import { formatAge, formatDuration, formatHeight, UNKNOWN } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { AnimatedNumber, HoverCard, LiveDot, TierGlyph } from '../../ui';
import { UtcClock, useBlockSince } from './Beat';
import { useRewardCut } from './data';
import { type PathReading, readPaths } from './freshness';
import { TIER_LABEL, TIER_ORDER } from './glyphs';
import { lazyCard } from './lazyCard';
import { useLiveView } from './live';
import { formatPrice } from './usd';
import './statusbar.css';

const loadStatusCards = () => import('./ChromeCards');
const statusCard = lazyCard(() => loadStatusCards().then((m) => m.StatusCard));
const totalsCard = lazyCard(() => loadStatusCards().then((m) => m.TotalsCard));
const priceCard = lazyCard(() => loadStatusCards().then((m) => m.PriceCard));
const cutCard = lazyCard(() => import('./tickers').then((m) => m.RewardCutCard));

function ageText(r: PathReading): string {
  return r.ageMs === null ? UNKNOWN : formatAge(r.ageMs);
}

const STATE_WORD: Partial<Record<PathReading['state'], string>> = { stale: 'stale', dead: 'dead' };

/** A path that is not keeping up says so in words; one that is stays a quiet light. */
const needsWords = (r: PathReading): boolean => r.state === 'stale' || r.state === 'dead';

export function StatusBar({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <section ref={ref} className="statusbar" data-region="statusbar" aria-label="Network status">
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
      placement="top-start"
      label="Connection and data freshness"
      content={() => <statusCard.Card readings={readings} />}
    >
      <button
        type="button"
        className="sb-group sb-left"
        aria-label="Connection and data freshness"
        onPointerEnter={statusCard.preload}
        onFocus={statusCard.preload}
      >
        <span className="sb-conn" data-tone={view.tone} data-testid="conn-chip">
          <LiveDot status={view.tone} className="live-blink" />
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
                  <AnimatedNumber value={tip.height} format={formatHeight} font="mono" maxHz={0} />
                </b>
              ) : null}
              <span className="sb-age">{ageText(r)}</span>
              {STATE_WORD[r.state] ? <em>{STATE_WORD[r.state]}</em> : null}
              <span className="sb-prog" aria-hidden="true">
                <i key={tip?.height ?? 0} style={{ '--since': Math.round(since) } as React.CSSProperties} />
              </span>
            </span>
          ) : needsWords(r) ? (
            <span key={r.id} className="sb-fresh" data-state={r.state}>
              <i className="sb-dot" aria-hidden="true" />
              <span>{r.label}</span>
              <span className="sb-age">{ageText(r)}</span>
              {STATE_WORD[r.state] ? <em>{STATE_WORD[r.state]}</em> : null}
            </span>
          ) : null,
        )}
        {/* Quiet at rest: a path that is keeping up is one small light; the hover card has every age. */}
        <span className="sb-leds" aria-hidden="true">
          {readings.map((r) =>
            r.id === 'tip' || needsWords(r) ? null : <i key={r.id} className="sb-led" data-state={r.state} />,
          )}
        </span>
      </button>
    </HoverCard>
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
    <HoverCard placement="top" label="Reward cut" content={() => <cutCard.Card cut={cut} />}>
      <ShellLink
        to={{ type: 'analytics', key: 'overview' }}
        className="sb-cut"
        onPointerEnter={cutCard.preload}
        onFocus={cutCard.preload}
      >
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
    <HoverCard placement="top" label="Network totals" content={() => <totalsCard.Card />} disabled={!summary}>
      <span className="sb-totals" onPointerEnter={totalsCard.preload}>
        {tiers ? (
          <span className="sb-tiers">
            {TIER_ORDER.map((t) => (
              <span key={t} className="sb-tier" data-tier={t}>
                <TierGlyph tier={t} size={12} label={`${TIER_LABEL[t]} nodes`} />
                <b>
                  <AnimatedNumber value={tiers[t]} font="mono" />
                </b>
              </span>
            ))}
          </span>
        ) : null}
        <span>
          <b>
            <AnimatedNumber value={summary?.node_count ?? null} font="mono" />
          </b>{' '}
          nodes
        </span>
      </span>
    </HoverCard>
  );
}

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
    <HoverCard placement="top" label="FLUX price" content={() => <priceCard.Card />}>
      <span className="sb-price" data-stale={stale || undefined} onPointerEnter={priceCard.preload}>
        FLUX <b>{formatPrice(price.usd)}</b>
        <span className={ch >= 0 ? 'sb-up' : 'sb-down'}>
          {ch >= 0 ? '+' : ''}
          {ch.toFixed(2)}%
        </span>
        {stale ? <em>stale</em> : null}
      </span>
    </HoverCard>
  );
}

function Build() {
  const server = useNetwork((s) => s.server);
  if (!server) return null;
  return <span className="sb-build">v{server.version}</span>;
}

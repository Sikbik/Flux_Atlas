// The status bar (design 8.8): 28 px of glass at the foot of the screen, quiet at rest. Left: the connection
// chip, the tip's height, age and next-block progress, and one small light per other ingest path (a path
// that is stale or dead steps forward as a chip in words). Right: the reward-cut chip, the node count with
// the tier split, the price, the clock when the top bar has hidden its own, and the build label. Hovering
// or focusing either group opens the detail behind it: every age, every source, every total. The cards are
// their own chunks (lazyCard), fetched when the pointer or focus nears a chip.

import { History } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { useNetwork, usePrice, useRuntime, useSummary, useTip } from '../../app/context';
import { formatAge, formatDuration, formatHeight, formatInt, UNKNOWN } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { AnimatedNumber, cx, HoverCard, LiveDot, TierGlyph } from '../../ui';
import { tMinus, tMinusSpoken, useArchive } from './archive';
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

/** The status bar. The root takes a ref, a class and a style; it is a dense zone for the motion language. */
export function StatusBar({ className, ...rest }: ComponentPropsWithRef<'section'>) {
  return (
    <section
      className={cx('statusbar', className)}
      data-region="statusbar"
      data-fx-density="dense"
      aria-label="Network status"
      {...rest}
    >
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
  const { since, sec } = useBlockSince();
  // While the archive shows, the tip is the archived moment's (and "T-" how long before now it was); the block timer
  // and the freshness verdict are about the present, so they rest. The connection and the other paths stay: they are
  // the live feed's own state, and still true.
  const at = useArchive((m) => (m ? m.at : null));
  const archivedTip = useArchive((m) => (m ? m.tip : null));
  const archived = at !== null;
  const minus = at === null ? null : tMinus(now - at);
  const readings = readPaths({
    nowMs: now,
    jobs,
    lastMessage: store.lastMessageMs,
    tipAnchorMs: clock.lastBlockInfo?.anchorMs ?? null,
  });
  const conn = view.status === 'live' && view.tone === 'ok' ? 'WebSocket' : null;
  const label = 'Connection and data freshness';
  return (
    <HoverCard placement="top-start" label={label} content={() => <statusCard.Card readings={readings} />}>
      <button
        type="button"
        className="sb-group sb-left"
        aria-label={
          at === null
            ? label
            : `${label}. Archive view, tip ${archivedTip === null ? UNKNOWN.toLowerCase() : formatHeight(archivedTip)}, ${tMinusSpoken(now - at)}`
        }
        onPointerEnter={statusCard.preload}
        onFocus={statusCard.preload}
      >
        <span className="sb-conn" data-tone={view.tone} data-testid="conn-chip">
          <LiveDot status={view.tone} ping={false} />
          <b>{view.label}</b>
          {conn || view.detail ? (
            <span className="sb-dim">{[conn, view.detail].filter(Boolean).join(', ')}</span>
          ) : null}
        </span>
        {readings.map((r) =>
          r.id === 'tip' ? (
            <span
              key={r.id}
              className="sb-fresh sb-tipchip"
              data-state={archived ? 'archive' : r.state}
              data-testid="tip-chip"
            >
              <i className="sb-dot" aria-hidden="true" />
              <span>tip</span>
              {archived ? (
                <b className="sb-arch">{archivedTip === null ? UNKNOWN : formatHeight(archivedTip)}</b>
              ) : tip ? (
                <b>
                  <AnimatedNumber value={tip.height} format={formatHeight} font="mono" maxHz={0} />
                </b>
              ) : null}
              <span className="sb-age">{archived ? minus : ageText(r)}</span>
              {!archived && STATE_WORD[r.state] ? <em>{STATE_WORD[r.state]}</em> : null}
              {archived ? null : (
                <span className="sb-prog" aria-hidden="true">
                  <i
                    key={tip?.height ?? 0}
                    style={{ '--since': Math.round(since), '--sec': sec } as React.CSSProperties}
                  />
                </span>
              )}
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
  // While the archive shows, the node count is the archived moment's (undefined: the present; null: not recorded).
  // The tier split and the card behind it are the present's, so they step aside instead of disagreeing with it.
  const archivedNodes = useArchive((m) => (m ? m.nodes : undefined));
  const archived = archivedNodes !== undefined;
  return (
    <HoverCard
      placement="top"
      label="Network totals"
      content={() => <totalsCard.Card />}
      disabled={!summary || archived}
    >
      <span
        className="sb-totals"
        data-archive={archived ? '' : undefined}
        data-testid="nodes-total"
        onPointerEnter={totalsCard.preload}
      >
        {tiers && !archived ? (
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
        <span className="sb-nodes">
          {archived ? <History className="sb-hist" size={11} strokeWidth={1.5} aria-hidden="true" /> : null}
          <b>
            {archived ? (
              formatInt(archivedNodes)
            ) : (
              <AnimatedNumber value={summary?.node_count ?? null} font="mono" />
            )}
          </b>{' '}
          nodes
          {archived ? <span className="sr-only"> in the archive view</span> : null}
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

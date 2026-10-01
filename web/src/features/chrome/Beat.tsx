// The top bar's live instruments: the Beat (the chain's 30 s pulse as a ring, the tip height and the
// countdown), the Live chip (connection state and round trip) and the UTC clock. The ring and the light
// that travels the bar's lower edge are pure CSS animations started at the right offset (negative
// animation delay) and remounted per block, so they run on the compositor and cost React nothing between
// blocks; React re-renders these components once a second for their text.

import { useMemo, useRef } from 'react';
import { useConnection, useNetwork, useRuntime, useTip } from '../../app/context';
import { formatHeight, formatUtcTime } from '../../lib/format';
import { useBeat, useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { HoverCard } from './HoverCard';
import { useLiveView } from './live';
import { Odometer } from './Odometer';
import './beat.css';

/** Milliseconds into the current block interval at the moment the block changes (for animation offsets). */
export function useBlockSince(): { height: number | null; since: number } {
  const { clock } = useRuntime();
  const height = useBeat(clock).height;
  // Recomputed per block only: the CSS animation carries it from there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `height` identifies the block
  const since = useMemo(() => {
    const last = clock.lastBlockInfo;
    return last ? Math.max(0, clock.now() - last.anchorMs) : 0;
  }, [clock, height]);
  return { height, since };
}

function BeatRing({ height, since, phase }: { height: number | null; since: number; phase: string }) {
  // A ping on every block after the first one seen.
  const prev = useRef<number | null>(height);
  const ping = prev.current !== null && height !== null && prev.current !== height;
  if (height !== null) prev.current = height;
  return (
    <span className="beat-ring" data-phase={phase} aria-hidden="true">
      <span className="beat-track" />
      <span
        key={`a${height}`}
        className="beat-anim"
        style={{ '--since': Math.round(since) } as React.CSSProperties}
      >
        <span className="beat-half beat-half-r">
          <span className="beat-arc" />
        </span>
        <span className="beat-half beat-half-l">
          <span className="beat-arc" />
        </span>
        <span className="beat-head">
          <i />
        </span>
        <span className="beat-core" />
      </span>
      {ping ? <span key={`p${height}`} className="beat-ping" /> : null}
    </span>
  );
}

/** The Beat: ring, tip height, and what the next block is doing. */
export function BeatChip() {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const tip = useTip();
  const status = useConnection().status;
  const { since } = useBlockSince();
  const height = beat.height ?? tip?.height ?? null;
  const secs = (ms: number) => Math.round(ms / 1000);
  let sub: string;
  let phase: string = beat.phase;
  if (height === null) sub = 'waiting for a block';
  else if (beat.phase === 'quiet') {
    // The feed itself is gone, or the chain really is quiet: the two read differently.
    if (status !== 'live') {
      sub = 'feed lost';
      phase = 'lost';
    } else sub = `chain quiet ${secs(beat.sinceMs)} s`;
  } else if (beat.phase === 'late') sub = `block late ${secs(beat.sinceMs)} s`;
  else sub = `next in ${Math.max(1, Math.ceil(beat.remainingMs / 1000))} s`;

  const body = (
    <>
      <BeatRing height={height} since={since} phase={phase} />
      <span className="beat-txt">
        <b className="beat-tip">
          {height === null ? 'No block yet' : <Odometer value={height} format={formatHeight} />}
        </b>
        <small className="beat-sub">{sub}</small>
      </span>
    </>
  );
  return (
    <HoverCard
      placement="bottom"
      card={<BeatCard />}
      cardClassName="beat-card"
      disabled={height === null}
      className="beat-anchor"
    >
      {height === null ? (
        <span className="beat" data-phase={phase}>
          {body}
        </span>
      ) : (
        <ShellLink
          to={{ type: 'block', key: String(height) }}
          className="beat"
          data-phase={phase}
          aria-label={`Block ${formatHeight(height)}, ${sub}`}
        >
          {body}
        </ShellLink>
      )}
    </HoverCard>
  );
}

function BeatCard() {
  const { clock, store } = useRuntime();
  const tip = useTip();
  const now = useNow(clock);
  const producer = useNetwork((s) => (s.tip?.producer === null || !s.tip ? null : s.tip.producer));
  if (!tip) return null;
  const idx = producer === null ? -1 : store.nodes.indexOf(producer);
  const city = idx >= 0 ? store.nodes.locations.info(store.nodes.loc[idx] ?? 0)?.city : undefined;
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

/** The Live chip: connection in words, with the round trip when flowing. The e2e hook is `live-status`. */
export function LiveChip({ compact = false }: { compact?: boolean }) {
  const view = useLiveView();
  return (
    <span className="livechip" data-testid="live-status" data-status={view.status} data-tone={view.tone}>
      <i className="live-dot" aria-hidden="true" />
      <span className="live-label">{view.label}</span>
      {!compact && view.detail ? <span className="live-detail">{view.detail}</span> : null}
    </span>
  );
}

/** The UTC clock; mono and tabular so it never shifts. */
export function UtcClock() {
  const { clock } = useRuntime();
  const now = useNow(clock);
  return (
    <time className="utc-clock" dateTime={new Date(now).toISOString()}>
      {formatUtcTime(now)}
    </time>
  );
}

/** The light that travels the top bar's lower edge once per block. */
export function TopLight() {
  const { height, since } = useBlockSince();
  return (
    <span className="topbar-lightrail" aria-hidden="true">
      {height === null ? null : (
        <span
          key={height}
          className="topbar-light"
          style={{ '--since': Math.round(since) } as React.CSSProperties}
        />
      )}
    </span>
  );
}

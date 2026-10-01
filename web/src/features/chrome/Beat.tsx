// The top bar's live instruments: the Beat (the chain's 30 s pulse as a ring, the tip height and the
// countdown), the Live chip (connection state and round trip) and the UTC clock. The ring and the light
// that travels the bar's lower edge are pure CSS animations started at the right offset (negative
// animation delay) and remounted per block, so they run on the compositor and cost React nothing between
// blocks; React re-renders these components once a second for their text.

import { useMemo, useRef } from 'react';
import { useConnection, useRuntime, useTip } from '../../app/context';
import { formatHeight, formatUtcTime } from '../../lib/format';
import { useBeat, useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { AnimatedNumber, HoverCard, LiveDot } from '../../ui';
import { lazyCard } from './lazyCard';
import { useLiveView } from './live';
import './beat.css';

// The Beat's card is part of the chrome's hover-card chunk, fetched when the pointer nears the chip.
const beatCard = lazyCard(() => import('./ChromeCards').then((m) => m.BeatCard));

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

export function BeatRing({ height, since, phase }: { height: number | null; since: number; phase: string }) {
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

export interface BeatView {
  /** The tip's height, or null before the first block. */
  height: number | null;
  /** What the next block is doing, in words ("next in 12 s", "block late 8 s", "feed lost"). */
  sub: string;
  /** The ring's phase: the clock's own, or `lost` when the feed is gone. */
  phase: string;
  /** Milliseconds into the current block interval, for the ring's animation offset. */
  since: number;
}

/** What the Beat shows, for the top bar's chip, the phone's header and the Live sheet. */
export function useBeatView(): BeatView {
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
  return { height, sub, phase, since };
}

/** The Beat: ring, tip height, and what the next block is doing. */
export function BeatChip() {
  const { height, sub, phase, since } = useBeatView();

  const body = (
    <>
      <BeatRing height={height} since={since} phase={phase} />
      <span className="beat-txt">
        <b className="beat-tip">
          {height === null ? (
            'No block yet'
          ) : (
            <AnimatedNumber value={height} format={formatHeight} font="display" maxHz={0} />
          )}
        </b>
        <small className="beat-sub">{sub}</small>
      </span>
    </>
  );
  return (
    <HoverCard
      placement="bottom"
      label="The chain's pulse"
      content={() => <beatCard.Card />}
      disabled={height === null}
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
          onPointerEnter={beatCard.preload}
          onFocus={beatCard.preload}
        >
          {body}
        </ShellLink>
      )}
    </HoverCard>
  );
}

/** The Live chip: connection in words, with the round trip when flowing. The e2e hook is `live-status`. */
export function LiveChip({ compact = false }: { compact?: boolean }) {
  const view = useLiveView();
  return (
    <span className="livechip" data-testid="live-status" data-status={view.status} data-tone={view.tone}>
      <LiveDot status={view.tone} ping={false} />
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

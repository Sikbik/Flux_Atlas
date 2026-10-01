// The top bar's live instruments: the Beat (the chain's 30 s pulse as a ring, the tip height and the
// countdown), the Live chip (connection state and round trip) and the UTC clock. The ring and the light
// that travels the bar's lower edge are pure CSS animations started at the right offset (negative
// animation delay) and remounted per block, so they run on the compositor and cost React nothing between
// blocks; React re-renders these components once a second for their text, and writes the whole seconds into
// the interval (`--sec`) for the one mode that runs no animation (Off draws the same state as steps).
//
// While the time machine shows a recorded moment (archive.ts) the Beat is a "t minus" readout instead: a still
// ring with a clock face, how long before now the moment is, and the block the chain stood at. Nothing counts to a
// block then, and the light along the bar's edge rests. "Return to live" brings the ring back with one ping.

import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useRuntime, useTip } from '../../app/context';
import { formatHeight, formatUtcTime, UNKNOWN } from '../../lib/format';
import { useBeat, useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { AnimatedNumber, HoverCard, LiveDot } from '../../ui';
import { tMinus, tMinusSpoken, useArchive, useArchived } from './archive';
import { lazyCard } from './lazyCard';
import { useLiveView } from './live';
import './beat.css';

// The Beat's card is part of the chrome's hover-card chunk, fetched when the pointer nears the chip.
const beatCard = lazyCard(() => import('./ChromeCards').then((m) => m.BeatCard));

/** The block interval in whole seconds: the ring is full at this. */
const INTERVAL_S = 30;

/**
 * Milliseconds into the current block interval at the moment the block changes (for animation offsets), and the
 * whole seconds into it now (Off draws the ring from them: it runs no animation).
 */
export function useBlockSince(): { height: number | null; since: number; sec: number } {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const archived = useArchived();
  const height = beat.height;
  // Recomputed per block only, and when the present comes back from the archive (where no ring was running): the
  // CSS animation carries it from there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `height` identifies the block, `archived` the return to it
  const since = useMemo(() => {
    const last = clock.lastBlockInfo;
    return last ? Math.max(0, clock.now() - last.anchorMs) : 0;
  }, [clock, height, archived]);
  return { height, since, sec: Math.min(INTERVAL_S, Math.floor(beat.sinceMs / 1000)) };
}

/** True for a moment after the present comes back from the archive (the Beat pings once). */
export function useReturned(archived: boolean): boolean {
  const [returned, setReturned] = useState(false);
  const was = useRef(archived);
  useEffect(() => {
    const back = was.current && !archived;
    was.current = archived;
    if (!back) return;
    setReturned(true);
    const t = setTimeout(() => setReturned(false), 900);
    return () => clearTimeout(t);
  }, [archived]);
  return returned;
}

export interface BeatRingProps {
  height: number | null;
  since: number;
  /** Whole seconds into the interval, for Off. */
  sec: number;
  phase: string;
  /** The archive's still ring (a dashed track and a clock face) in place of the block timer. */
  archive?: boolean;
  /** The present has just come back from the archive: one ping. */
  returned?: boolean;
}

export function BeatRing({ height, since, sec, phase, archive = false, returned = false }: BeatRingProps) {
  // A ping on every block after the first one seen.
  const prev = useRef<number | null>(height);
  const ping = !archive && prev.current !== null && height !== null && prev.current !== height;
  if (!archive && height !== null) prev.current = height;
  if (archive) {
    return (
      <span className="beat-ring" data-phase="archive" aria-hidden="true">
        <span className="beat-track" />
        <History className="beat-hist" size={13} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <span className="beat-ring" data-phase={phase} aria-hidden="true">
      <span className="beat-track" />
      <span
        key={`a${height}`}
        className="beat-anim"
        style={{ '--since': Math.round(since), '--sec': sec } as React.CSSProperties}
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
      {ping || returned ? <span key={`p${height}`} className="beat-ping" /> : null}
    </span>
  );
}

/** The Beat while the archive shows: how long before now the moment on screen is, and the block the chain stood at. */
export interface ArchiveBeat {
  /** `T-4 d 11 h`, for the eye. */
  minus: string;
  /** `T minus 4 days 11 hours`, for a screen reader. */
  spoken: string;
  /** The tip's height at that moment, or null when the recording does not hold it. */
  tip: number | null;
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
  /** Whole seconds into the current block interval (0 to 30), for Off. */
  sec: number;
  /** The "t minus" readout while a recorded moment is on screen, else null (the present). */
  archive: ArchiveBeat | null;
}

/** The block the archive's moment stood at, in words. */
export function archiveBlock(tip: number | null): string {
  return tip === null ? `block ${UNKNOWN.toLowerCase()}` : `block ${formatHeight(tip)}`;
}

/** What the Beat shows, for the top bar's chip, the phone's header and the Live sheet. */
export function useBeatView(): BeatView {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const now = useNow(clock);
  const tip = useTip();
  const status = useConnection().status;
  const { since, sec } = useBlockSince();
  const at = useArchive((m) => (m ? m.at : null));
  const archivedTip = useArchive((m) => (m ? m.tip : null));
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
  const archive: ArchiveBeat | null =
    at === null ? null : { minus: tMinus(now - at), spoken: tMinusSpoken(now - at), tip: archivedTip };
  return { height, sub, phase, since, sec, archive };
}

/** The Beat: ring, tip height, and what the next block is doing; a "t minus" readout while the archive shows. */
export function BeatChip() {
  const { height, sub, phase, since, sec, archive } = useBeatView();
  const returned = useReturned(archive !== null);

  if (archive) {
    const block = archiveBlock(archive.tip);
    return (
      <span className="beat" data-phase="archive">
        <BeatRing height={null} since={0} sec={0} phase="archive" archive />
        <span className="beat-txt">
          <b className="beat-tip" aria-hidden="true">
            {archive.minus}
          </b>
          <small className="beat-sub" aria-hidden="true">
            {block}
          </small>
          <span className="sr-only">{`Archive view, ${archive.spoken}, ${block}`}</span>
        </span>
      </span>
    );
  }

  const body = (
    <>
      <BeatRing height={height} since={since} sec={sec} phase={phase} returned={returned} />
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

/** The light that travels the top bar's lower edge once per block; it rests while the archive shows. */
export function TopLight() {
  const { height, since, sec } = useBlockSince();
  const archived = useArchived();
  return (
    <span className="topbar-lightrail" aria-hidden="true">
      {height === null || archived ? null : (
        <span
          key={height}
          className="topbar-light"
          style={{ '--since': Math.round(since), '--sec': sec } as React.CSSProperties}
        />
      )}
    </span>
  );
}

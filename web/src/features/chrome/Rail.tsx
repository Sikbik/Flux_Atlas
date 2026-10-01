// The block rail (design 8.14, 6.4): the chain's spine along the foot of the screen. Newest block at the
// right, then the ghost card for the next one. A block lands with a thunk (the card enters from the right,
// the others slide over by one card, a white rim fades over 1.6 s); a reorg leaves the orphaned cards
// marked for four seconds. Scrolling into history freezes the rail and offers "Jump to live". Cards link
// to the block and open a peek (mix, producer, payees) on hover or focus. Nothing is polled: the rail
// reads the store's ring and the shared clock.

import { History } from 'lucide-react';
import {
  type ComponentPropsWithRef,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useChainBlocks, useRuntime } from '../../app/context';
import { formatBytes, formatHeight, formatInt, UNKNOWN } from '../../lib/format';
import { useAgo, useBeat } from '../../lib/useClock';
import { useShellActions } from '../../shell/frame/actions';
import { ShellLink } from '../../shell/frame/ShellLink';
import type { ChainBlock } from '../../store/network';
import { cx, HoverCard, TierGlyph } from '../../ui';
import { pressHandlers } from '../../ui/internal/press';
import { useBlockSince } from './Beat';
import { useNodeFacts, usePayoutLines } from './data';
import { useFreshKeys } from './fresh';
import { ProducerGlyph } from './glyphs';
import { lazyCard } from './lazyCard';
import { cssValue, play } from './motion';
import {
  mempoolWeight,
  mixSegments,
  nextTombs,
  STRIP_SHARES,
  type Tomb,
  txMix,
  waitingText,
  withTombs,
} from './rail';
import './rail.css';

// The peek card is part of the chrome's hover-card chunk, fetched when the pointer nears a block card.
const peekCard = lazyCard(() => import('./ChromeCards').then((m) => m.CardPeek));

/** Cards drawn at most; the ring holds 100, the rail keeps the recent ones in the DOM. */
const MAX_CARDS = 40;
/** Scrolled this far from the live edge, the rail counts as being in history. */
const HISTORY_PX = 24;
/** A landed card stays fresh a little longer than its rim takes to fade (1.6 s). */
const FRESH_MS = 1800;

/** Placeholder cards while the first snapshot loads: the same size as the real ones, so nothing shifts. */
const SKELETONS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

const keyOf = (b: ChainBlock) => `${b.height}:${b.hash.slice(0, 8)}`;

/** The rail. The root takes a ref, a class and a style like any element; a block's card is `li.blk-item` with
 * `data-fresh` while it is new and `data-orphan` after a reorganisation, and its link `a.blk` carries the producer's
 * `data-tier` and `data-pressed` while held. */
export function BlockRail({ className, ...rest }: ComponentPropsWithRef<'section'>) {
  return (
    <section className={cx('railwrap', className)} data-region="rail" aria-label="Blocks" {...rest}>
      <Timeline />
      <RailTrack />
    </section>
  );
}

/** The time machine's strip, closed: a label, a track and "Live" (design 8.14). */
function Timeline() {
  const { launch } = useShellActions();
  return (
    <div className="timeline" data-region="timeline">
      <button type="button" className="tl-label" onClick={() => launch('time')}>
        <History size={13} strokeWidth={1.5} aria-hidden="true" />
        Time machine
        <kbd className="kbd">T</kbd>
      </button>
      <div className="tl-track" aria-hidden="true">
        <span className="tl-now" />
      </div>
      <span className="tl-live">Live</span>
    </div>
  );
}

function RailTrack() {
  const live = useChainBlocks();
  const trackRef = useRef<HTMLOListElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [shown, setShown] = useState<readonly ChainBlock[]>(live);
  // While the rail is scrolled into history the blocks on screen stay put; new ones wait behind the pill.
  if (!frozen && shown !== live) setShown(live);

  // Orphaned cards (a reorg) linger, marked, then leave.
  const [tombs, setTombs] = useState<Tomb<ChainBlock>[]>([]);
  const prevShown = useRef(shown);
  useEffect(() => {
    if (prevShown.current === shown) return;
    const before = prevShown.current;
    prevShown.current = shown;
    setTombs((t) => nextTombs(before, shown, t, Date.now()));
  }, [shown]);
  useEffect(() => {
    if (tombs.length === 0) return;
    const wake = Math.max(50, Math.min(...tombs.map((t) => t.at)) + 4_050 - Date.now());
    const id = setTimeout(() => setTombs((t) => nextTombs([], shown, t, Date.now())), wake);
    return () => clearTimeout(id);
  }, [tombs, shown]);

  const cards = useMemo(() => withTombs(shown.slice(0, MAX_CARDS), tombs), [shown, tombs]);

  // Which cards just landed, for the landing animation and the motion language (never the first fill). The FLIP
  // below keeps its own record of the keys it has seen.
  const cardKeys = useMemo(() => cards.map((c) => keyOf(c.block)), [cards]);
  const fresh = useFreshKeys(cardKeys, { ms: FRESH_MS, max: 2 });
  const seen = useRef<Set<string> | null>(null);
  const flip = useRef(new Map<string, number>());

  // FLIP: after the DOM changed, cards that moved slide from where they were to where they are (a card
  // or two arriving or leaving; a whole resync just redraws).
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const keys = cards.map((c) => keyOf(c.block));
    const before = seen.current;
    let changed = 99;
    if (before && before.size > 0) {
      const now = new Set(keys);
      changed = keys.filter((k) => !before.has(k)).length + [...before].filter((k) => !now.has(k)).length;
    }
    const next = new Map<string, number>();
    const ease = cssValue('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)');
    for (const c of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const k = c.dataset.flip as string;
      const left = c.offsetLeft;
      next.set(k, left);
      const was = flip.current.get(k);
      if (changed <= 3 && was !== undefined && Math.abs(was - left) > 1 && !c.hasAttribute('data-fresh')) {
        play(c, [{ transform: `translateX(${was - left}px)` }, { transform: 'none' }], {
          duration: 420,
          easing: ease,
          reduced: [{ opacity: 0.6 }, { opacity: 1 }],
        });
      }
    }
    flip.current = next;
    seen.current = new Set(keys);
  }, [cards]);

  // A vertical wheel over the rail scrolls it sideways (the scrollbar is hidden).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Down moves toward the live edge, up toward history (the live edge is scrollLeft 0).
      const next = Math.min(0, el.scrollLeft + e.deltaY);
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Scroll: past the live edge the rail is in history.
  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setFrozen(Math.abs(el.scrollLeft) > HISTORY_PX);
  }, []);
  const jumpToLive = () => {
    const el = trackRef.current;
    setFrozen(false);
    el?.scrollTo({ left: 0, behavior: 'smooth' });
  };
  const waiting = frozen && live[0] && shown[0] ? Math.max(0, live[0].height - shown[0].height) : 0;

  return (
    <div className="rail" data-frozen={frozen || undefined}>
      <ol ref={trackRef} className="rail-track" aria-label="Recent blocks, newest first" onScroll={onScroll}>
        <GhostCard />
        {live.length === 0
          ? SKELETONS.map((id) => <SkeletonCard key={id} />)
          : cards.map(({ block, orphan }) => (
              <BlockCard key={keyOf(block)} block={block} orphan={orphan} isNew={fresh.has(keyOf(block))} />
            ))}
      </ol>
      {frozen ? (
        <button type="button" className="rail-jump" onClick={jumpToLive}>
          {waiting > 0 ? `${waiting} new, jump to live` : 'Jump to live'}
        </button>
      ) : null}
    </div>
  );
}

function SkeletonCard() {
  return (
    <li className="blk-item" aria-hidden="true">
      <span className="blk blk-skel">
        <span className="skel skel-l" />
        <span className="skel skel-m" />
        <span className="skel skel-s" />
      </span>
    </li>
  );
}

function BlockCard({ block, orphan, isNew }: { block: ChainBlock; orphan: boolean; isNew: boolean }) {
  const { clock } = useRuntime();
  const facts = useNodeFacts();
  const age = useAgo(clock, block.observedMs !== null && block.live ? block.observedMs : block.timeMs, false);
  const prod = facts(block.producer);
  const mix = txMix(block);
  const segs = mixSegments(mix);
  const label = `Block ${formatHeight(block.height)}${orphan ? ', orphaned by a reorganization' : ''}, ${age ?? UNKNOWN}, ${mix.total} transactions${
    prod?.place ? `, produced in ${prod.place}` : ''
  }`;
  return (
    <li
      className="blk-item"
      data-flip={keyOf(block)}
      data-fresh={isNew || undefined}
      data-orphan={orphan || undefined}
    >
      <HoverCard
        placement="top"
        openDelay={260}
        label={`Block ${formatHeight(block.height)}`}
        content={() => <peekCard.Card block={block} orphan={orphan} />}
      >
        <ShellLink
          to={{ type: 'block', key: String(block.height) }}
          className="blk"
          data-tier={prod?.tier}
          aria-label={label}
          {...pressHandlers<HTMLAnchorElement>()}
          onPointerEnter={peekCard.preload}
          onFocus={peekCard.preload}
        >
          <span className="r1">
            <b className="blk-h">{formatHeight(block.height)}</b>
            {orphan ? <span className="blk-orphan">orphaned</span> : <time className="blk-age">{age}</time>}
          </span>
          <span className="r2">
            <span>{formatInt(mix.total)} tx</span>
            <span className="mixbar" aria-hidden="true">
              {segs.map((s) => (
                <i key={s.key} data-mix={s.key} style={{ flexGrow: s.frac }} />
              ))}
            </span>
            <span>{formatBytes(block.size)}</span>
          </span>
          <span className="r3">
            <span className="blk-prod">
              <ProducerGlyph size={14} />
            </span>
            <span className="blk-ip">{prod?.ip ?? UNKNOWN}</span>
            <em>{prod?.place ?? UNKNOWN}</em>
          </span>
          <span className="strip" aria-hidden="true">
            {STRIP_SHARES.map((s) => (
              <i key={s.key} data-part={s.key} style={{ flexGrow: s.share }} />
            ))}
          </span>
        </ShellLink>
      </HoverCard>
    </li>
  );
}

/** The next block: its height, the countdown, what waits in the mempool and the three payees. */
function GhostCard() {
  const { clock, store } = useRuntime();
  const beat = useBeat(clock);
  // Where the block timer stood when the block landed: the fill's animation carries it from there. (The tick's own
  // time since the block, written here every second, would be counted twice: once by the animation's clock and once
  // by the offset, and the fill would run at twice the pace.)
  const { since, sec } = useBlockSince();
  const lines = usePayoutLines();
  const weight = mempoolWeight(store.mempoolList());
  const seen = store.lastMessageMs.has('mempool');
  const next = (beat.height ?? 0) + 1;
  const late = beat.phase === 'late' || beat.phase === 'quiet';
  const secs = Math.max(0, Math.ceil(beat.remainingMs / 1000));
  return (
    <li className="blk-item blk-item-ghost" data-late={late || undefined} aria-label="The next block">
      <div className="blk ghost" data-phase={beat.phase}>
        <span className="r1">
          <b className="blk-h">{beat.height === null ? UNKNOWN : formatHeight(next)}</b>
          <span className="cdwn">
            {beat.height === null ? '' : late ? `late ${Math.round(beat.sinceMs / 1000)} s` : `${secs} s`}
          </span>
        </span>
        <span className="r2">
          Next block
          {seen ? `, ${waitingText(weight, formatBytes)} waiting` : ''}
        </span>
        <span className="ghost-payees">
          {lines.map((l) => (
            <span key={l.tier} className="ghost-chip" data-tier={l.tier}>
              <TierGlyph tier={l.tier} size={11} />
              <span>{l.place ?? UNKNOWN}</span>
            </span>
          ))}
        </span>
        <span className="bar" aria-hidden="true">
          <i key={beat.height ?? 0} style={{ '--since': Math.round(since), '--sec': sec } as CSSProperties} />
        </span>
      </div>
    </li>
  );
}

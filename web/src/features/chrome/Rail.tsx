// The block rail (design 8.14, 6.4): the chain's spine along the foot of the screen. Newest block at the
// right, then the ghost card for the next one. A block lands with a thunk (the card enters from the right,
// the others slide over by one card, a white rim fades over 1.6 s); a reorg leaves the orphaned cards
// marked for four seconds. Scrolling into history freezes the rail and offers "Jump to live". Cards link
// to the block and open a peek (mix, producer, payees) on hover or focus. Nothing is polled: the rail
// reads the store's ring and the shared clock.

import { History } from 'lucide-react';
import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useChainBlocks, useRuntime } from '../../app/context';
import { formatBytes, formatHeight, formatInt, formatUtcTime, UNKNOWN } from '../../lib/format';
import { useAgo, useBeat } from '../../lib/useClock';
import { useShellActions } from '../../shell/frame/actions';
import { ShellLink } from '../../shell/frame/ShellLink';
import type { ChainBlock } from '../../store/network';
import { type NodeFacts, useNodeFacts, usePayoutLines } from './data';
import { ProducerGlyph, TIER_LABEL, TierGlyph } from './glyphs';
import { HoverCard } from './HoverCard';
import { cssValue, play } from './motion';
import { amountLabel } from './payouts';
import {
  freshKeys,
  mixSegments,
  nextTombs,
  payeesByTier,
  STRIP_SHARES,
  type Tomb,
  txMix,
  withTombs,
} from './rail';
import './rail.css';

/** Cards drawn at most; the ring holds 100, the rail keeps the recent ones in the DOM. */
const MAX_CARDS = 40;
/** Scrolled this far from the live edge, the rail counts as being in history. */
const HISTORY_PX = 24;

/** Placeholder cards while the first snapshot loads: the same size as the real ones, so nothing shifts. */
const SKELETONS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

const keyOf = (b: ChainBlock) => `${b.height}:${b.hash.slice(0, 8)}`;

export function BlockRail({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <section ref={ref} className="railwrap" data-region="rail" aria-label="Blocks">
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

  // Which cards are new since the last render, for the landing animation (never the first fill).
  const seen = useRef<Set<string> | null>(null);
  const flip = useRef(new Map<string, number>());
  const newKeys = useMemo(
    () =>
      freshKeys(
        seen.current,
        cards.map((c) => keyOf(c.block)),
      ),
    [cards],
  );

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
      if (changed <= 3 && was !== undefined && Math.abs(was - left) > 1 && !c.hasAttribute('data-new')) {
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
              <BlockCard key={keyOf(block)} block={block} orphan={orphan} isNew={newKeys.has(keyOf(block))} />
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
      data-new={isNew || undefined}
      data-orphan={orphan || undefined}
    >
      <HoverCard
        placement="top"
        delay={260}
        className="blk-anchor"
        cardClassName="blk-peek"
        card={<CardPeek block={block} orphan={orphan} />}
      >
        <ShellLink
          to={{ type: 'block', key: String(block.height) }}
          className="blk"
          data-tier={prod?.tier}
          aria-label={label}
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

function CardPeek({ block, orphan }: { block: ChainBlock; orphan: boolean }) {
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

/** The next block: its height, the countdown, what waits in the mempool and the three payees. */
function GhostCard() {
  const { clock, store } = useRuntime();
  const beat = useBeat(clock);
  const lines = usePayoutLines();
  const mempool = store.mempoolList();
  const seen = store.lastMessageMs.has('mempool');
  let bytes = 0;
  for (const e of mempool) bytes += e.tx.size;
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
          {seen
            ? `, ${formatInt(mempool.length)} tx${bytes > 0 ? `, ${formatBytes(bytes)}` : ''} waiting`
            : ''}
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
          <i key={beat.height ?? 0} style={{ '--since': Math.round(beat.sinceMs) } as CSSProperties} />
        </span>
      </div>
    </li>
  );
}

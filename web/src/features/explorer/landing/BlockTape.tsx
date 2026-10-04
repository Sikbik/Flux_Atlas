// The block tape: the newest blocks as a row of bars, oldest to newest, each as tall as its transactions and cut into the
// kinds the rail's mix bar uses. The slot after the last is the block that is coming, filling as the 30 seconds pass.
// Every bar is a real link to its block. The row is one tab stop: the arrow keys move along it. A new block slides the
// row along by one slot and its bar grows in; nothing else moves.

import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRuntime } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { useFresh } from '../../../motion';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { RelativeTime, useMotionMode } from '../../../ui';
import { useSize } from '../../analytics/viz/useSize';
import { useBlockSince } from '../../chrome/Beat';
import type { MixKey } from '../../chrome/rail';
import { barText, MIN_SCALE_TX, type TapeBar, tapeBars, tapeCount, tapeFacts, tapeSummary } from './lib/tape';
import { useTapeBlocks } from './useTapeBlocks';
import '../../analytics/viz/chainPlot.css';
import './tape.css';

const MIX_ORDER: readonly MixKey[] = ['confirms', 'starts', 'transfers', 'other'];

/** The long name of each kind, for the reading of one bar. */
const MIX_LABEL: Record<MixKey, string> = {
  confirms: 'Node confirmations',
  starts: 'Node starts',
  transfers: 'Large transfers',
  other: 'Everything else',
};

/** The short name of each kind, for the key under the tape. */
const MIX_SHORT: Record<MixKey, string> = {
  confirms: 'Confirmations',
  starts: 'Starts',
  transfers: 'Transfers',
  other: 'Other',
};

/** Where the reading of a bar sits: the bar's middle, kept inside the stage. */
const TIP_HALF = 104;

/** The slot's width plus the gap between two slots, read off the first two bars (px). */
function slotWidth(list: HTMLElement): number {
  const a = list.children[0] as HTMLElement | undefined;
  const b = list.children[1] as HTMLElement | undefined;
  return a && b ? b.offsetLeft - a.offsetLeft : 0;
}

interface Hot {
  height: number;
  x: number;
}

function Reading({ bar, x, width, now }: { bar: TapeBar; x: number; width: number; now: number }) {
  const left = Math.max(TIP_HALF + 4, Math.min(width - TIP_HALF - 4, x));
  const age = Math.max(0, Math.round((now - bar.timeMs) / 1000));
  return (
    <div className="cp-tip ex-tape__tip" role="presentation" style={{ left }}>
      <div className="cp-tip-head">
        <span>{`#${formatInt(bar.height)}`}</span>
        <span>{age < 90 ? `${age} s ago` : `${Math.round(age / 60)} min ago`}</span>
      </div>
      <ul>
        {MIX_ORDER.filter((k) => bar[k] > 0).map((k) => (
          <li key={k}>
            <span className="cp-key ex-tape__swatch" data-mix={k} aria-hidden="true" />
            <span className="cp-tip-name">{MIX_LABEL[k]}</span>
            <strong className="cp-tip-val">{formatInt(bar[k])}</strong>
          </li>
        ))}
        <li>
          <span className="cp-key" data-none="" aria-hidden="true" />
          <span className="cp-tip-name">Transactions</span>
          <strong className="cp-tip-val">{formatInt(bar.txCount)}</strong>
        </li>
        {bar.gapS !== null ? (
          <li>
            <span className="cp-key" data-none="" aria-hidden="true" />
            <span className="cp-tip-name">
              {bar.late ? 'After the one before, late' : 'After the one before'}
            </span>
            <strong className="cp-tip-val">{`${Math.round(bar.gapS)} s`}</strong>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Static bars of the loading state: the geometry of the tape, no spinner. */
/** The gap between two bars, px (the same number as in tape.css). */
const TAPE_GAP = 3;

const GHOSTS = [0.42, 0.58, 0.36, 0.7, 0.5, 0.64, 0.4, 0.78, 0.52, 0.46, 0.66, 0.38, 0.74, 0.56, 0.44, 0.6];

export function BlockTape() {
  const { blocks, ready } = useTapeBlocks();
  const { clock } = useRuntime();
  const { since, sec } = useBlockSince();
  const mode = useMotionMode();
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { width } = useSize(stageRef);
  const count = tapeCount(width);
  const bars = useMemo(() => tapeBars(blocks, count), [blocks, count]);
  // One bar width whatever the number of blocks held, so a tape that is still filling looks like the full one with its
  // older slots empty.
  const barPx = width > 0 ? Math.max(3, (width - TAPE_GAP * count) / (count + 1)) : 6;
  const ghosts = useMemo(
    () => Array.from({ length: Math.max(0, count - bars.length) }, (_, i) => -(i + 1)),
    [count, bars.length],
  );
  const facts = useMemo(() => tapeFacts(bars), [bars]);
  const summary = useMemo(() => tapeSummary(bars), [bars]);
  const newest = bars[bars.length - 1] ?? null;

  // The bars on screen when the tape first has some reveal in, one after the other.
  const revealed = useRef<ReadonlySet<number> | null>(null);
  if (revealed.current === null && ready && bars.length > 0 && width > 0) {
    revealed.current = new Set(bars.map((b) => b.height));
  }
  const seeded = revealed.current;

  // A block that arrives afterwards grows in on its own. A resize that shows older blocks is not an arrival.
  const keys = useMemo(() => bars.map((b) => String(b.height)), [bars]);
  const fresh = useFresh(keys, { max: 2, scope: String(count) });

  const [roving, setRoving] = useState<number | null>(null);
  const [hot, setHot] = useState<Hot | null>(null);

  // A new block slides the row along by one slot (compositor only, and only at full motion).
  const lastTip = useRef<number | null>(null);
  useLayoutEffect(() => {
    const tip = newest?.height ?? null;
    const prev = lastTip.current;
    lastTip.current = tip;
    const list = listRef.current;
    if (!list || tip === null || prev === null || tip !== prev + 1 || mode !== 'full') return;
    const slot = slotWidth(list);
    if (slot <= 0 || typeof list.animate !== 'function') return;
    list.animate([{ transform: `translateX(${slot}px)` }, { transform: 'translateX(0)' }], {
      duration: 360,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
  }, [newest?.height, mode]);

  const rovingHeight = bars.some((b) => b.height === roving) ? roving : (newest?.height ?? null);
  const hotBar = hot ? (bars.find((b) => b.height === hot.height) ?? null) : null;

  const point = (e: PointerEvent<HTMLLIElement>, height: number) => {
    if (e.pointerType === 'touch') return;
    const li = e.currentTarget;
    setHot({ height, x: li.offsetLeft + li.offsetWidth / 2 });
  };

  const focusBar = (e: FocusEvent<HTMLAnchorElement>, height: number) => {
    const li = e.currentTarget.parentElement as HTMLElement;
    setRoving(height);
    setHot({ height, x: li.offsetLeft + li.offsetWidth / 2 });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a.ex-tape__bar')];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    let next = at;
    if (e.key === 'ArrowLeft') next = Math.max(0, at - 1);
    else if (e.key === 'ArrowRight') next = Math.min(links.length - 1, at + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = links.length - 1;
    else if (e.key === 'Escape') {
      if (hot === null) return;
      e.stopPropagation();
      setHot(null);
      return;
    } else return;
    e.preventDefault();
    links[next]?.focus();
  };

  const loading = !ready || bars.length === 0;
  const now = clock.now();

  return (
    <figure className="ex-tape" aria-label="The latest blocks" aria-busy={loading || undefined}>
      <p className="ui-sr-only">{summary}</p>
      <div className="ex-tape__stage" ref={stageRef}>
        {loading ? (
          <div className="ex-tape__ghosts" aria-hidden="true">
            {GHOSTS.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decoration
              <i key={i} style={{ '--h': h } as CSSProperties} />
            ))}
          </div>
        ) : (
          <>
            {facts.busiest > 0 ? (
              <span className="ex-tape__scale" aria-hidden="true">
                {`tallest ${formatInt(Math.max(MIN_SCALE_TX, facts.busiest))} transactions`}
              </span>
            ) : null}
            <ul
              ref={listRef}
              className="ex-tape__bars"
              aria-label="Blocks, oldest to newest"
              onKeyDown={onKeyDown}
              style={{ '--bar': `${barPx.toFixed(2)}px` } as CSSProperties}
              onPointerLeave={() => setHot(null)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null);
              }}
            >
              {ghosts.map((g) => (
                <li key={g} className="ex-tape__empty" aria-hidden="true">
                  <i />
                </li>
              ))}
              {bars.map((b, i) => {
                const seed = seeded?.has(b.height) ?? false;
                const style = { '--h': b.frac, '--i': i } as CSSProperties;
                return (
                  <li
                    key={b.height}
                    style={style}
                    data-late={b.late || undefined}
                    data-hot={hotBar?.height === b.height || undefined}
                    onPointerEnter={(e) => point(e, b.height)}
                  >
                    {i === 0 && facts.blocks >= 4 ? (
                      <span className="ex-tape__from" aria-hidden="true">
                        <RelativeTime ts={b.timeMs} />
                      </span>
                    ) : null}
                    <ShellLink
                      to={{ type: 'block', key: String(b.height) }}
                      className="ex-tape__bar"
                      aria-label={barText(b, now)}
                      tabIndex={b.height === rovingHeight ? 0 : -1}
                      onFocus={(e) => focusBar(e, b.height)}
                    >
                      <span
                        className="ex-tape__col"
                        data-reveal={seed || undefined}
                        data-fresh={fresh.has(String(b.height)) || undefined}
                      >
                        {b.segments.map((s) => (
                          <i key={s.key} data-mix={s.key} style={{ flexGrow: s.n }} />
                        ))}
                      </span>
                    </ShellLink>
                  </li>
                );
              })}
              {newest ? (
                <li
                  key={`next-${newest.height}`}
                  className="ex-tape__next"
                  aria-hidden="true"
                  style={{ '--since': Math.round(since), '--sec': sec } as CSSProperties}
                >
                  <span className="ex-tape__next-fill" />
                </li>
              ) : null}
            </ul>
            {hotBar && hot ? <Reading bar={hotBar} x={hot.x} width={width} now={now} /> : null}
          </>
        )}
      </div>
      <div className="ex-tape__axis" aria-hidden="true">
        <span>Now</span>
      </div>
      <ul className="ex-tape__key" aria-label="Colours">
        {MIX_ORDER.map((k) => (
          <li key={k}>
            <i data-mix={k} aria-hidden="true" />
            {MIX_SHORT[k]}
          </li>
        ))}
        <li>
          <i data-late="" aria-hidden="true" />
          Late block
        </li>
      </ul>
    </figure>
  );
}

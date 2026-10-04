// The Pulse (design 8.13, 6.5): the live activity feed, a glass card at the bottom left. Newest row at the
// bottom; a head with the filters; rows that read like sentences and link to their subject; bursts collapse
// into one counting row; while the pointer or keyboard focus is inside, insertions wait behind a "N new"
// pill. Rows slide in with one FLIP; the fresh one carries a wash that decays over 1.6 s. The feed is a
// list, not a live region: a separate status line announces at most one summary every five seconds.

import {
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  Blocks,
  Boxes,
  CircleCheck,
  Coins,
  Eye,
  GitFork,
  Hourglass,
  Layers2,
  LogOut,
  type LucideIcon,
  PackageCheck,
  PackageX,
  Play,
  Rocket,
  RotateCw,
  ShieldAlert,
  Shuffle,
  TrendingDown,
  TriangleAlert,
  Unlink,
  WifiOff,
} from 'lucide-react';
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useChainBlocks, useFeed, useRuntime } from '../../app/context';
import { formatBytes, formatFlux, formatHeight, formatInt } from '../../lib/format';
import { useAgo } from '../../lib/useClock';
import { useFresh } from '../../motion/fresh';
import { ShellLink } from '../../shell/frame/ShellLink';
import { visibleWindows } from '../../shell/wm/machine';
import { useWm } from '../../shell/wm/react';
import { WINDOW_SPECS } from '../../shell/wm/specs';
import type { WindowType } from '../../shell/wm/types';
import { useUi } from '../../store/ui';
import { LiveDot } from '../../ui';
import { useNodeFacts } from './data';
import { useLiveView } from './live';
import { cssValue, play } from './motion';
import { amountLabel } from './payouts';
import {
  applyFilter,
  burstSummary,
  collapseBursts,
  type DescribeContext,
  describeEvent,
  normalize,
  PULSE_FILTERS,
  type PulseEvent,
  type PulseFilter,
  type PulseKind,
  type PulseRow,
  type PulseTone,
  toneOf,
} from './pulse';
import './pulse.css';

// ---- preferences -----------------------------------------------------------------------------------

const PREF_KEY = 'atlas.pulse.v1';

interface PulsePrefs {
  filter: PulseFilter;
  /** The Pulse can be turned off (Settings); the card then does not render. */
  enabled: boolean;
  setFilter(f: PulseFilter): void;
  setEnabled(v: boolean): void;
}

function loadPrefs(): Pick<PulsePrefs, 'filter' | 'enabled'> {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) ?? '{}') as Record<string, unknown>;
    const filter = PULSE_FILTERS.some((f) => f.id === v.filter) ? (v.filter as PulseFilter) : 'all';
    return { filter, enabled: v.enabled !== false };
  } catch {
    return { filter: 'all', enabled: true };
  }
}

/** The Pulse's filter and on/off switch, persisted per browser. */
export const usePulsePrefs = create<PulsePrefs>()((set, get) => {
  const save = () => {
    try {
      const { filter, enabled } = get();
      globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({ filter, enabled }));
    } catch {
      // Storage unavailable: the choice lasts for the session.
    }
  };
  return {
    ...loadPrefs(),
    setFilter: (filter) => {
      set({ filter });
      save();
    },
    setEnabled: (enabled) => {
      set({ enabled });
      save();
    },
  };
});

// ---- presentation ------------------------------------------------------------------------------------

const ICON: Record<PulseKind, LucideIcon> = {
  block: Blocks,
  confirmed: Activity,
  paid_mine: Eye,
  node_joined: Rocket,
  node_started: Play,
  node_left: LogOut,
  node_expired: Hourglass,
  node_at_risk: TriangleAlert,
  node_ip_changed: Shuffle,
  node_dosed: ShieldAlert,
  collateral_spent: Unlink,
  node_unreachable: WifiOff,
  node_recovered: CircleCheck,
  node_heartbeat: Activity,
  node_paid: Coins,
  app_deployed: Boxes,
  app_updated: PackageCheck,
  app_renewed: RotateCw,
  app_expired: PackageX,
  app_pending: Hourglass,
  app_install_failed: PackageX,
  version_milestone: BadgeCheck,
  large_transfer: ArrowLeftRight,
  reorg: GitFork,
  reward_reduction: TrendingDown,
};

const TONE_VAR: Record<PulseTone, string> = {
  block: 'var(--accent-400)',
  mine: 'var(--hot)',
  join: 'var(--tier, var(--accent-400))',
  leave: 'var(--status-warn)',
  app: 'var(--accent-app)',
  pending: 'var(--text-3)',
  quiet: 'var(--text-3)',
  version: 'var(--accent-300)',
  crit: 'var(--status-crit)',
  ok: 'var(--status-ok)',
};

/** Windows that sit where the Pulse is (the left, from x 88): the Pulse steps aside for them. */
const COVERING: readonly WindowType[] = [
  'explorer',
  'block',
  'tx',
  'address',
  'mempool',
  'supply',
  'richlist',
  'queue',
  'analytics',
  'terminal',
];
/** Docked inspectors that need the room: the Pulse shrinks to its newest row. */
const COMPACT: readonly WindowType[] = ['app', 'operator'];

type PulseMode = 'full' | 'compact' | 'hidden';

function usePulseMode(): PulseMode {
  return useWm((s) => {
    const open = visibleWindows(s);
    if (
      open.some(
        (w) =>
          COVERING.includes(w.type) && WINDOW_SPECS[w.type].chrome === 'window' && w.placement === 'floating',
      )
    )
      return 'hidden';
    if (open.some((w) => COMPACT.includes(w.type))) return 'compact';
    return 'full';
  }, Object.is);
}

/** Bold the numbers in a row's sentence (design 8.13). */
function Sentence({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*\d|\d)/g);
  return (
    <>
      {parts.map((p, i) =>
        // The split alternates text and number captures, so odd positions are the numbers.
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positions in a static split are stable
          <b key={i}>{p}</b>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Age({ ts }: { ts: number }) {
  const { clock } = useRuntime();
  return <time className="evt-age">{useAgo(clock, ts, false)}</time>;
}

function useDescribeContext(): DescribeContext {
  const facts = useNodeFacts();
  return useMemo<DescribeContext>(
    () => ({
      node: (id) => {
        const f = facts(id);
        return f ? { tier: f.tier, endpoint: f.endpoint, place: f.place } : null;
      },
      amount: (a) => amountLabel(Number(a)),
      height: (n) => formatHeight(n),
      bytes: (n) => formatBytes(n),
      flux: (a) =>
        formatFlux(a, { decimals: 2 })
          .replace(/\.00$/, '')
          .replace(/ FLUX$/, ''),
    }),
    [facts],
  );
}

/**
 * A payout to a watched node arrives with the block that paid it, and the block has its own light (the rail's
 * streak and the card's lap, a second together). The row's Current waits for that to end, with a beat to spare: it
 * reads as the consequence, and the effect budget (two Currents at once) never has to refuse it. The wait is
 * counted from when the block was seen (`ev.ts`), so a row that shows later than the block lights at once.
 */
const BLOCK_LIGHT_MS = 1100;
const blockLightLeft = (ev: PulseEvent): number | undefined => {
  const left = Math.round(BLOCK_LIGHT_MS - (Date.now() - ev.ts));
  return left > 0 ? left : undefined;
};

function EventRow({ ev, fresh }: { ev: PulseEvent; fresh: boolean }) {
  const ctx = useDescribeContext();
  const d = describeEvent(ev, ctx);
  const Icon = ICON[ev.kind];
  const body = (
    <>
      <span className="ei" aria-hidden="true">
        <Icon size={14} strokeWidth={1.5} />
      </span>
      <span className="evt-main">
        <span className="t">
          <Sentence text={d.title} />
        </span>
        {d.sub ? <span className="sub">{d.sub}</span> : null}
      </span>
      <Age ts={ev.ts} />
    </>
  );
  return (
    <li
      className="evt"
      data-flip={ev.id}
      data-kind={ev.kind}
      data-fresh={fresh || undefined}
      data-fx={ev.kind === 'paid_mine' ? 'current' : undefined}
      data-fx-delay={ev.kind === 'paid_mine' ? blockLightLeft(ev) : undefined}
      data-tier={d.tier && d.tier !== 'unknown' ? d.tier : undefined}
      style={{ '--ev': TONE_VAR[toneOf(ev.kind)] } as CSSProperties}
    >
      {d.target ? (
        <ShellLink to={d.target} className="evt-link">
          {body}
        </ShellLink>
      ) : (
        <div className="evt-link">{body}</div>
      )}
    </li>
  );
}

function BurstRow({
  row,
  open,
  onToggle,
  now,
}: {
  row: Extract<PulseRow, { kind: 'burst' }>;
  open: boolean;
  onToggle: () => void;
  now: number;
}) {
  const n = row.events.length;
  const counting = now - row.lastTs < 2_000;
  return (
    <li
      className="evt evt-burst"
      data-flip={row.id}
      data-open={open || undefined}
      data-counting={counting || undefined}
    >
      <button type="button" className="evt-link" aria-expanded={open} onClick={onToggle}>
        <span className="ei" aria-hidden="true">
          <Layers2 size={14} strokeWidth={1.5} />
        </span>
        <span className="evt-main">
          <span className="t">
            <b>+{formatInt(n)}</b> more {n === 1 ? 'event' : 'events'}
          </span>
          <span className="sub">{burstSummary(row.events)}</span>
        </span>
        <span className="evt-open">{open ? 'close' : 'open'}</span>
      </button>
    </li>
  );
}

// ---- the card ------------------------------------------------------------------------------------------

/** Rows kept in the DOM; the list shows the newest few and fades the rest away at the top. */
const DOM_ROWS = 14;
/** Recent blocks the card starts with: enough to fill the tallest card (ten rows) before the feed has anything to add. */
const BLOCK_ROWS = 12;

function usePulseRows(filter: PulseFilter) {
  const feed = useFeed();
  const blocks = useChainBlocks();
  const watched = useUi((s) => s.watched);
  const events = useMemo(
    () => normalize(feed.slice(0, 200), blocks, { watched: new Set(watched), maxBlocks: BLOCK_ROWS }),
    [feed, blocks, watched],
  );
  return useMemo(() => collapseBursts(applyFilter(events, filter).slice(0, 80)), [events, filter]);
}

export function Pulse() {
  const mode = usePulseMode();
  const enabled = usePulsePrefs((s) => s.enabled);
  if (!enabled) return null;
  return <PulseCard mode={mode} />;
}

export function PulseCard({ mode }: { mode: PulseMode }) {
  const { clock } = useRuntime();
  const filter = usePulsePrefs((s) => s.filter);
  const setFilter = usePulsePrefs((s) => s.setFilter);
  const live = usePulseRows(filter);
  const view = useLiveView();
  const offline = view.status === 'offline' || view.status === 'reconnecting';
  const now = clock.tickTime;

  // Hover-freeze: while the pointer or focus is inside, the rows stay as they are.
  const [frozen, setFrozen] = useState(false);
  const [snap, setSnap] = useState<PulseRow[]>(live);
  const releaseTimer = useRef<number | undefined>(undefined);
  const hold = () => {
    window.clearTimeout(releaseTimer.current);
    if (!frozen) {
      setSnap(live);
      setFrozen(true);
    }
  };
  const release = (wait = 600) => {
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => setFrozen(false), wait);
  };
  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);
  const rows = frozen ? snap : live;
  const shownIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const waiting = frozen ? live.filter((r) => !shownIds.has(r.id)).length : 0;

  const [openBursts, setOpenBursts] = useState<Set<string>>(new Set());
  const toggleBurst = (id: string) =>
    setOpenBursts((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Rows drawn, oldest first: expanded bursts list their events after the burst row.
  const flat = useMemo(() => {
    const out: { key: string; row: PulseRow; sub?: PulseEvent }[] = [];
    for (const r of rows) {
      out.push({ key: r.id, row: r });
      if (r.kind === 'burst' && openBursts.has(r.id))
        for (const e of [...r.events].reverse())
          out.push({ key: e.id, row: { kind: 'event', id: e.id, ev: e }, sub: e });
    }
    return out.slice(-(mode === 'compact' ? 1 : DOM_ROWS));
  }, [rows, openBursts, mode]);

  // Rows present at first paint are history; later ones are fresh for a moment (the wash, and a Current for a
  // payment to a watched node). `useFresh` is what gives the motion language the attribute AFTER the row exists.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null && flat.length > 0) initial.current = new Set(flat.map((f) => f.key));
  const flatKeys = useMemo(() => flat.map((f) => f.key), [flat]);
  const fresh = useFresh(flatKeys, { scope: `${filter}:${mode}` });

  // FLIP: rows slide up by one row when a row arrives at the bottom (a fade when motion is reduced).
  const listRef = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the drawn rows change
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const next = new Map<string, number>();
    const ease = cssValue('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)');
    for (const r of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const k = r.dataset.flip as string;
      const top = r.offsetTop;
      next.set(k, top);
      const was = tops.current.get(k);
      if (was === undefined) {
        if (initial.current && !initial.current.has(k))
          play(
            r,
            [
              { opacity: 0, transform: 'translateY(10px)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: 280,
              easing: ease,
              reduced: [{ opacity: 0 }, { opacity: 1 }],
            },
          );
      } else if (Math.abs(was - top) > 1 && tops.current.size > 0) {
        play(r, [{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
          duration: 280,
          easing: ease,
        });
      }
    }
    tops.current = next;
  }, [flat]);

  // One quiet announcement per five seconds: "3 new events", never every row.
  const announce = useAnnouncer(live.length === 0 ? null : live[live.length - 1]?.id, frozen);

  const compact = mode === 'compact';
  return (
    <section
      className="pulse"
      data-mode={mode}
      data-offline={offline || undefined}
      data-frozen={frozen || undefined}
      aria-label="Live activity"
      onPointerEnter={hold}
      onPointerLeave={() => release()}
      onFocus={hold}
      onBlur={() => release()}
    >
      <header className="pulse-head" data-tone={view.tone}>
        <LiveDot status={view.tone} ping={false} />
        <b>Pulse</b>
        {offline ? <span className="pulse-stale">offline</span> : null}
        {compact ? null : (
          <>
            {/* Quiet at rest: the filters show when the pointer or focus is in the card; until then a
                filter other than All keeps its name showing, so a partial feed is never a surprise. */}
            {filter === 'all' ? null : (
              <span className="filter-now" aria-hidden="true">
                {PULSE_FILTERS.find((f) => f.id === filter)?.label}
              </span>
            )}
            <fieldset className="filters">
              <legend className="sr-only">Filter events</legend>
              {PULSE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={filter === f.id ? 'on' : undefined}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </fieldset>
          </>
        )}
      </header>
      {waiting > 0 ? (
        <button type="button" className="newpill" onClick={() => setFrozen(false)}>
          {waiting} new
        </button>
      ) : null}
      <ul ref={listRef} className="pulse-list">
        {flat.length === 0 ? (
          <li className="pulse-empty">
            {filter === 'mine' ? 'Nothing on your watched nodes yet' : 'Waiting for the next block'}
          </li>
        ) : (
          flat.map(({ key, row, sub }) =>
            row.kind === 'burst' ? (
              <BurstRow
                key={key}
                row={row}
                open={openBursts.has(row.id)}
                onToggle={() => toggleBurst(row.id)}
                now={now}
              />
            ) : (
              <EventRow key={key} ev={row.ev} fresh={fresh.has(key) && !sub} />
            ),
          )
        )}
      </ul>
      <p className="sr-only" role="status">
        {announce}
      </p>
    </section>
  );
}

/** A polite status line that says "N new events" at most once every five seconds. */
function useAnnouncer(newestId: string | null | undefined, frozen: boolean): string {
  const [text, setText] = useState('');
  const last = useRef<string | null | undefined>(newestId);
  const pending = useRef(0);
  useEffect(() => {
    if (newestId === last.current) return;
    last.current = newestId;
    if (!frozen) pending.current += 1;
  }, [newestId, frozen]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pending.current > 0) {
        setText(`${pending.current} new ${pending.current === 1 ? 'event' : 'events'}`);
        pending.current = 0;
      } else setText('');
    }, 5_000);
    return () => window.clearInterval(id);
  }, []);
  return text;
}

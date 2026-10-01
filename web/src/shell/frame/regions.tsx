// The shell's regions (design 3.1), structural and neutral: top bar, left dock, block rail with the
// timeline strip, status bar and the phone's tab bar, plus the boot veil. Each region is a landmark
// with a `data-region` attribute and token-driven geometry; the shell team owns the visual pass
// (glass, light sweeps, the Beat chip, odometers) and fills them in.

import { Link } from '@tanstack/react-router';
import {
  Activity,
  AppWindow,
  Blocks,
  ChartColumn,
  Clock,
  CloudSun,
  Globe,
  ListOrdered,
  Search,
  Server,
  Settings,
  SquareTerminal,
  Tv,
  UserRound,
} from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { useChainBlocks, useConnection, useNetwork, useRuntime, useTip } from '../../app/context';
import { useGlobeStatus } from '../../globe';
import { formatHeight, formatInt, formatUtcTime } from '../../lib/format';
import { useAgo, useBeat, useNow } from '../../lib/useClock';
import { WindowDots } from '../wm/react';

const LIVE_LABEL: Record<string, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  syncing: 'Catching up',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  closed: 'Closed',
};

/**
 * The Live chip: connection state and round trip. The one in the status bar (the top bar's on the
 * phone) carries the e2e hook `live-status`.
 */
export function LiveChip({ compact = false, hook = false }: { compact?: boolean; hook?: boolean }) {
  const conn = useConnection();
  const retryIn = conn.retryAtMs ? Math.max(0, Math.ceil((conn.retryAtMs - Date.now()) / 1000)) : null;
  return (
    <span className="shell-chip" data-testid={hook ? 'live-status' : undefined} data-status={conn.status}>
      <span className={`dot dot-${conn.status}`} aria-hidden="true" />
      {LIVE_LABEL[conn.status] ?? conn.status}
      {!compact && conn.status === 'live' && conn.transitMs !== null
        ? `, ${Math.round(conn.transitMs)} ms`
        : ''}
      {conn.status === 'reconnecting' && retryIn !== null ? ` in ${retryIn} s` : ''}
    </span>
  );
}

/** The Beat chip: tip height and the next-block countdown (late and quiet phases in words). */
export function BeatChip() {
  const { clock } = useRuntime();
  const tip = useTip();
  const beat = useBeat(clock);
  return (
    <span className="shell-chip tabular" data-phase={beat.phase}>
      {tip ? formatHeight(tip.height) : 'No block yet'}
      <span className="shell-chip-sub">
        {beat.phase === 'late' || beat.phase === 'quiet'
          ? `block late ${Math.round(beat.sinceMs / 1000)} s`
          : beat.height !== null
            ? `next in ${Math.ceil(beat.remainingMs / 1000)} s`
            : ''}
      </span>
    </span>
  );
}

function UtcClock() {
  const { clock } = useRuntime();
  const now = useNow(clock);
  return <span className="shell-chip tabular shell-hide-compact">{formatUtcTime(now)}</span>;
}

/** The L1 lockup: the Flux symbol (brand blue, unaltered) and the word Atlas. */
function Lockup() {
  return (
    <Link to="/" className="shell-lockup" aria-label="Flux Atlas, the bare globe">
      <img src={`${import.meta.env.BASE_URL}brand/Flux_symbol-mark_blue.svg`} alt="" width={22} height={26} />
      <span className="shell-wordmark">Atlas</span>
    </Link>
  );
}

export const TopBar = forwardRef<HTMLElement, { phone: boolean }>(function TopBar({ phone }, ref) {
  return (
    <header ref={ref} className="shell-topbar" data-region="topbar">
      <Lockup />
      {phone ? null : (
        <nav className="shell-menus shell-hide-compact" aria-label="Menus">
          <span className="shell-menu">View</span>
          <span className="shell-menu">Go</span>
          <span className="shell-menu">Window</span>
        </nav>
      )}
      <search className="shell-omnibox">
        <Search size={14} aria-hidden="true" />
        <span className="muted">Search nodes, apps, blocks</span>
      </search>
      <div className="shell-topbar-end">
        <BeatChip />
        <LiveChip compact={phone} hook={phone} />
        {phone ? null : <UtcClock />}
      </div>
    </header>
  );
});

interface Launcher {
  label: string;
  icon: ReactNode;
  to?: string;
  key?: string;
}

const LAUNCHERS: Launcher[] = [
  { label: 'Globe', icon: <Globe size={18} />, to: '/', key: 'G' },
  { label: 'Nodes', icon: <Server size={18} />, key: 'N' },
  { label: 'Apps', icon: <AppWindow size={18} />, key: 'A' },
  { label: 'Explorer', icon: <Blocks size={18} />, to: '/mempool', key: 'E' },
  { label: 'Payment queue', icon: <ListOrdered size={18} />, to: '/queue', key: 'Q' },
  { label: 'Analytics', icon: <ChartColumn size={18} />, to: '/analytics', key: 'S' },
  { label: 'Time machine', icon: <Clock size={18} />, to: '/time', key: 'T' },
  { label: 'Operator', icon: <UserRound size={18} />, key: 'O' },
  { label: 'Terminal', icon: <SquareTerminal size={18} />, to: '/terminal', key: '`' },
];

const LAUNCHERS_2: Launcher[] = [
  { label: 'Weather layer', icon: <CloudSun size={18} />, to: '/weather', key: 'W' },
  { label: 'Ambient mode', icon: <Tv size={18} />, to: '/ambient' },
  { label: 'Settings', icon: <Settings size={18} />, to: '/settings' },
];

function LauncherItem({ l }: { l: Launcher }) {
  const label = l.key ? `${l.label} (${l.key})` : l.label;
  if (!l.to) {
    // Not wired yet (the palette and the operator flow come with the feature views).
    return (
      <button type="button" className="shell-launcher" aria-label={label} title={label} disabled>
        {l.icon}
      </button>
    );
  }
  return (
    <Link
      to={l.to}
      className="shell-launcher"
      aria-label={label}
      title={label}
      activeOptions={{ exact: l.to === '/' }}
      search={(prev: Record<string, unknown>) => ({ ...prev, w: undefined })}
    >
      {l.icon}
    </Link>
  );
}

export const Dock = forwardRef<HTMLElement>(function Dock(_props, ref) {
  return (
    <nav ref={ref} className="shell-dock" data-region="dock" aria-label="Dock">
      {LAUNCHERS.map((l) => (
        <LauncherItem key={l.label} l={l} />
      ))}
      <span className="shell-dock-divider" aria-hidden="true" />
      {LAUNCHERS_2.map((l) => (
        <LauncherItem key={l.label} l={l} />
      ))}
      <Link
        to="/about"
        className="shell-launcher shell-launcher-brand"
        aria-label="About Flux (M)"
        title="About Flux (M)"
      >
        <img
          src={`${import.meta.env.BASE_URL}brand/Flux_symbol-mark_blue.svg`}
          alt=""
          width={18}
          height={21}
        />
      </Link>
      <WindowDots className="shell-dock-dots" />
    </nav>
  );
});

function BlockCard({
  height,
  timeMs,
  producer,
}: {
  height: number;
  timeMs: number;
  producer: number | null;
}) {
  const { clock } = useRuntime();
  const ago = useAgo(clock, timeMs);
  return (
    <Link
      to="/block/$key"
      params={{ key: String(height) }}
      className="shell-block-card"
      data-producer={producer ?? undefined}
    >
      <span className="tabular">{formatHeight(height)}</span>
      <span className="muted">{ago}</span>
    </Link>
  );
}

/** Recent blocks, newest on the right, and the ghost card for the next block (design 8.14). */
export const BlockRail = forwardRef<HTMLDivElement>(function BlockRail(_props, ref) {
  const blocks = useChainBlocks();
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  // The ring is newest first; the rail reads oldest to newest, left to right.
  const recent = blocks.slice(0, 9).reverse();
  const next = recent.at(-1);
  return (
    <div ref={ref} className="shell-bottom" data-region="rail">
      <div className="shell-timeline" data-region="timeline">
        <span className="muted">Timeline</span>
        <span className="shell-timeline-track" />
        <span>Live</span>
      </div>
      <ol className="shell-rail" aria-label="Recent blocks">
        {recent.map((b) => (
          <li key={b.height}>
            <BlockCard height={b.height} timeMs={b.timeMs} producer={b.producer} />
          </li>
        ))}
        {next ? (
          <li className="shell-block-card shell-block-ghost" aria-label="Next block">
            <span className="tabular">{formatHeight(next.height + 1)}</span>
            <span className="muted tabular">
              {beat.height === null ? '' : `${Math.ceil(beat.remainingMs / 1000)} s`}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
});

/** Connection, freshness and counts (design 8.8). */
export function StatusBar() {
  const nodes = useNetwork((s) => s.nodes.count);
  const tip = useTip();
  const { clock } = useRuntime();
  const tipAgo = useAgo(clock, tip?.time_ms ?? null);
  return (
    <footer className="shell-statusbar" data-region="statusbar">
      <LiveChip hook />
      <span className="tabular">tip {tipAgo ?? 'unknown'}</span>
      <span className="shell-statusbar-end tabular">{formatInt(nodes)} nodes</span>
      <Link to="/dev/live" className="link">
        Live inspector
      </Link>
    </footer>
  );
}

/** The phone's five tabs (design 3.6). */
export const PhoneTabs = forwardRef<HTMLElement>(function PhoneTabs(_props, ref) {
  return (
    <nav ref={ref} className="shell-tabs" data-region="tabs" aria-label="Tabs">
      <Link to="/" className="shell-tab" activeOptions={{ exact: true }}>
        <Globe size={20} aria-hidden="true" />
        Globe
      </Link>
      <Link to="/mempool" className="shell-tab">
        <Activity size={20} aria-hidden="true" />
        Live
      </Link>
      <button type="button" className="shell-tab" disabled>
        <Search size={20} aria-hidden="true" />
        Search
      </button>
      <button type="button" className="shell-tab" disabled>
        <AppWindow size={20} aria-hidden="true" />
        Apps
      </button>
      <Link to="/settings" className="shell-tab">
        <UserRound size={20} aria-hidden="true" />
        You
      </Link>
    </nav>
  );
});

/**
 * The boot veil: painted with the first frame (it is in the shell chunk, not the globe's), lifted once
 * the snapshot is in and the globe has drawn or cannot. The designed boot (6.4 J, the symbol
 * assembling into the moon) replaces it.
 */
export function BootVeil() {
  const loaded = useNetwork((s) => s.loaded);
  const status = useGlobeStatus();
  const done = loaded && status !== 'loading';
  return (
    <div className="shell-boot" data-testid="boot" data-done={done || undefined} aria-hidden={done}>
      <p className="shell-boot-line">{loaded ? 'Placing the network on the globe' : 'Connecting to Atlas'}</p>
    </div>
  );
}

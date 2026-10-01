// The shell's remaining placeholder regions: the block rail, the phone's tab bar and the boot veil.
// They are replaced one by one by the live chrome (features/chrome).

import { Link } from '@tanstack/react-router';
import { Activity, AppWindow, Globe, Search, UserRound } from 'lucide-react';
import type { Ref } from 'react';
import { useChainBlocks, useNetwork, useRuntime } from '../../app/context';
import { useGlobeStatus } from '../../globe';
import { formatHeight } from '../../lib/format';
import { useAgo, useBeat } from '../../lib/useClock';

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
export function BlockRail({ ref }: { ref?: Ref<HTMLDivElement> }) {
  const blocks = useChainBlocks();
  const { clock } = useRuntime();
  const beat = useBeat(clock);
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
}

/** The phone's five tabs (design 3.6). */
export function PhoneTabs({ ref }: { ref?: Ref<HTMLElement> }) {
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
}

/** The boot veil placeholder: lifted once the snapshot is in and the globe has drawn or cannot. */
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

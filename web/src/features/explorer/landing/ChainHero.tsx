// The Explorer's hero: the chain's height as the one big figure, a clear way to the latest block, the live state, the
// block tape, and the figures that say how the chain is doing today (block time, transactions, fees, what is pending
// and how many nodes run it). Every figure that is not known says so; none shows a zero in its place.

import { Box } from 'lucide-react';
import { useMemo } from 'react';
import { useChainBlocks, useSummary } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { AnimatedNumber, Delta, RelativeTime, StatusChip } from '../../../ui';
import { useBeatView } from '../../chrome/Beat';
import { useLiveView } from '../../chrome/live';
import { HubButton, HubFigure, HubFigures, HubHero } from '../../hub';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { BlockTape } from './BlockTape';
import { fluxText } from './lib/daily';
import { blockPace } from './lib/pace';
import type { TodayFigure } from './lib/today';
import { useToday } from './useToday';
import './landing.css';

/** The connection states as the kit's status words. */
const CONNECTION_STATUS: Record<string, string> = {
  live: 'live',
  syncing: 'syncing',
  connecting: 'syncing',
  idle: 'syncing',
  reconnecting: 'degraded',
  offline: 'error',
  closed: 'unknown',
};

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** `14:00 UTC` for the end of the newest hour a figure of today counts. */
const throughText = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** What sits under a figure of today: the change against the same hours yesterday, or how far it runs. */
function todayNote(f: TodayFigure, pending: boolean) {
  if (pending) return null;
  if (f.kind === 'none') return 'Hourly figures are not built yet';
  if (f.kind === 'yesterday') return 'The whole day before; today has not begun to count';
  if (f.change !== null)
    return <Delta kind="percent" value={f.change} decimals={1} period="vs same hours yesterday" />;
  return f.throughMs === null ? null : `through ${throughText(f.throughMs)}`;
}

export function ChainHero() {
  const view = useBeatView();
  const live = useLiveView();
  const blocks = useChainBlocks();
  const summary = useSummary();
  const today = useToday();
  const pending = useMempoolLive();
  const newest = blocks[0] ?? null;
  const pace = useMemo(() => blockPace(blocks), [blocks]);
  const height = view.height;
  const tipKey = height === null ? null : String(height);

  const target = pace.vsTarget;
  const paceNote =
    pace.avgS === null
      ? 'Needs two blocks'
      : target !== null && Math.abs(target) < 1
        ? 'on the 30 s target'
        : target === null
          ? null
          : `${Math.abs(target).toFixed(0)}% ${target > 0 ? 'slower' : 'faster'} than the 30 s target`;

  const txLabel = today.tx.kind === 'yesterday' ? 'Transactions yesterday' : 'Transactions today';
  const feeLabel = today.fees.kind === 'yesterday' ? 'Fees yesterday' : 'Fees today';

  return (
    <HubHero
      aria-label="The chain now"
      label="Chain height"
      loading={height === null}
      value={<AnimatedNumber value={height} countUpOnMount />}
      aside={
        <StatusChip
          size="sm"
          status={CONNECTION_STATUS[live.status]}
          label={live.detail ? `${live.label} ${live.detail}` : live.label}
        />
      }
      caption={
        newest ? (
          <>
            Block {formatInt(newest.height)} was mined <RelativeTime ts={newest.timeMs} /> with{' '}
            {formatInt(newest.txCount)} {newest.txCount === 1 ? 'transaction' : 'transactions'}.{' '}
            <span className="ex-hero__next" data-phase={view.phase}>
              {capitalize(view.sub)}.
            </span>
          </>
        ) : (
          'Waiting for the first block from the network.'
        )
      }
      actions={
        tipKey === null ? null : (
          <HubButton variant="primary" icon={Box} to={{ type: 'block', key: tipKey }}>
            Latest block
          </HubButton>
        )
      }
      visual={<BlockTape />}
    >
      <HubFigures>
        <HubFigure
          label="Block time"
          value={pace.avgS === null ? null : pace.avgS.toFixed(1)}
          unit="s"
          note={paceNote}
          loading={blocks.length === 0}
        />
        <HubFigure
          label={txLabel}
          value={today.tx.value === null ? null : formatInt(Math.round(today.tx.value))}
          note={todayNote(today.tx, today.isPending)}
          loading={today.isPending}
        />
        <HubFigure
          label={feeLabel}
          value={today.fees.value === null ? null : fluxText(today.fees.value)}
          unit="FLUX"
          note={todayNote(today.fees, today.isPending)}
          loading={today.isPending}
        />
        <HubFigure
          label="Pending"
          value={
            pending.isError && pending.rows.length === 0 ? null : <AnimatedNumber value={pending.size} />
          }
          note="waiting for the next block"
          loading={pending.isPending && pending.rows.length === 0}
        />
        <HubFigure
          label="Nodes"
          value={summary ? <AnimatedNumber value={summary.node_count} /> : null}
          note="confirmed on the network"
          loading={summary === null}
        />
      </HubFigures>
    </HubHero>
  );
}

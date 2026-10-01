import { ChevronRight, X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useRuntime } from '../../../app/context';
import { BLOCK_MS, formatInt } from '../../../lib/format';
import { Amount, AnimatedNumber, EntityLink, IconButton, tierLabel } from '../../../ui';
import { etaShort } from '../derive/eta';
import { cycleHours, estimatePayment, positionOf, type QueueTier, type TierQueue } from '../derive/queue';
import { useChainClock, useNodeLive, useQueues, useTierInfo } from '../sources/live';
import { type PhaseLoop, useRiskFlags } from '../sources/queueFeed';
import { QueueLink } from '../ui/links';
import { Wheel } from './Wheel';

/**
 * Two lines under a ring, fixed in height so nothing moves: what the tier pays and how long its cycle
 * is, or, when the selected node is in this tier, where that node stands and when it is paid.
 */
function CardFoot({
  tier,
  queue,
  selectedId,
  solo,
  onClear,
}: {
  tier: QueueTier;
  queue: TierQueue;
  selectedId: number | null;
  solo: boolean;
  onClear: () => void;
}) {
  const queues = useQueues();
  const { tip, anchorMs, nowMs } = useChainClock();
  const info = useTierInfo().find((t) => t.tier === tier);
  const pos = selectedId !== null ? positionOf(queues, selectedId) : null;
  const mine = pos && pos.tier === tier ? pos : null;
  const node = useNodeLive(mine ? selectedId : null);

  if (mine && node) {
    const est =
      tip !== null && anchorMs !== null
        ? estimatePayment(mine.position, mine.size, tip, anchorMs, nowMs)
        : null;
    return (
      <div className="ix-q-foot" data-selected="">
        <div className="ix-q-foot-1" title="An estimate at about 30 s per block">
          <b className="ui-mono">#{formatInt(mine.position + 1)}</b>
          <span>of {formatInt(mine.size)}</span>
          <small>· paid in about</small>
          <b className="ui-mono">{est ? etaShort(est.etaMs) : 'Unknown'}</b>
        </div>
        <div className="ix-q-foot-2">
          <EntityLink kind="node" value={node.endpoint || String(node.id)}>
            {node.endpoint || `Node ${node.id}`}
          </EntityLink>
          <IconButton
            size="sm"
            variant="ghost"
            icon={X}
            label="Clear the selection"
            onClick={onClear}
            className="ix-q-foot-x"
          />
        </div>
      </div>
    );
  }
  return (
    <div className="ix-q-foot">
      <div className="ix-q-foot-1">
        {info?.payout != null ? (
          <>
            <Amount value={info.payout} />
            <span>a block</span>
          </>
        ) : null}
        <small>
          · cycle <span className="ui-mono">{cycleHours(queue.size).toFixed(1)}</span> h
        </small>
      </div>
      <div className="ix-q-foot-2">
        {solo ? null : (
          <QueueLink tier={tier} className="ix-q-focus">
            Open the {tierLabel(tier)} ring
            <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
          </QueueLink>
        )}
      </div>
    </div>
  );
}

export interface TierCardProps {
  tier: QueueTier;
  queue: TierQueue;
  tip: number | null;
  loop: PhaseLoop;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClear: () => void;
  active: boolean;
  /** A single tier fills the window: a bigger ring. */
  solo: boolean;
}

/** One tier: its ring with the count in the middle, and the two-line foot. */
export const TierCard = memo(function TierCard({
  tier,
  queue,
  tip,
  loop,
  selectedId,
  onSelect,
  onClear,
  active,
  solo,
}: TierCardProps) {
  const { clock } = useRuntime();
  const risk = useRiskFlags(queue.ids);
  const queues = useQueues();
  const selected = selectedId !== null ? positionOf(queues, selectedId) : null;
  const selectedPos = selected && selected.tier === tier ? selected.position : null;
  const anchor = loop.anchorMs;
  const etaFor = useCallback(
    (position: number) =>
      anchor === null ? '' : `in ${etaShort(Math.max(0, anchor + (position + 1) * BLOCK_MS - clock.now()))}`,
    [anchor, clock],
  );
  return (
    <section
      className="ix-q-card"
      data-tier={tier}
      data-active={active || undefined}
      data-solo={solo || undefined}
      aria-label={`${tierLabel(tier)} queue`}
    >
      <Wheel
        tier={tier}
        ids={queue.ids}
        size={queue.size}
        loop={loop}
        tip={tip}
        risk={risk}
        selected={selectedPos}
        onSelect={onSelect}
        etaFor={etaFor}
      >
        <span className="ix-wheel-name">{tierLabel(tier)}</span>
        <b className="ix-wheel-n">
          <AnimatedNumber value={queue.size} />
        </b>
        <span className="ix-wheel-cap">nodes in line</span>
      </Wheel>
      <CardFoot tier={tier} queue={queue} selectedId={selectedId} solo={solo} onClear={onClear} />
    </section>
  );
});

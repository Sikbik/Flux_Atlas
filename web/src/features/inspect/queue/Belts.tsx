import { TierGlyph, tierLabel } from '../../../ui';
import type { QueueTier, TierQueue } from '../derive/queue';
import { useChainClock } from '../sources/live';
import { type PhaseLoop, useRecentPayees } from '../sources/queueFeed';
import { Lane } from './Lane';

/** The belt of one tier with its second-by-second countdowns. */
export function LaneRow({
  tier,
  queue,
  tip,
  loop,
  selectedId,
  onSelect,
  active,
  ahead,
}: {
  tier: QueueTier;
  queue: TierQueue;
  tip: number | null;
  loop: PhaseLoop;
  selectedId: number | null;
  onSelect: (id: number) => void;
  active: boolean;
  ahead?: number;
}) {
  const { nowMs } = useChainClock();
  const paid = useRecentPayees(tier, 4);
  return (
    <div className="ix-q-lane" data-tier={tier} data-active={active || undefined}>
      <div className="ix-q-lane-h">
        <TierGlyph tier={tier} size={14} />
        <span>{tierLabel(tier)}</span>
        <small>pays one node every block</small>
      </div>
      <Lane
        tier={tier}
        ids={queue.ids}
        size={queue.size}
        tip={tip}
        paid={paid}
        loop={loop}
        selectedId={selectedId}
        onSelect={onSelect}
        nowMs={nowMs}
        ahead={ahead}
      />
    </div>
  );
}

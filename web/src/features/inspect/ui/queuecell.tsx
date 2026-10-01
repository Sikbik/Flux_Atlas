import { formatInt } from '../../../lib/format';
import { etaShort } from '../derive/eta';
import { estimatePayment, positionOf } from '../derive/queue';
import { useChainClock, useQueues } from '../sources/live';

export { etaShort };

/**
 * A node's place in its payment queue as two short lines: `#1,527` and the estimated time to payment.
 * It re-renders once a second (the countdown), so it belongs in rows, not in whole views.
 */
export function QueueCell({ id }: { id: number }) {
  const queues = useQueues();
  const { tip, anchorMs, nowMs } = useChainClock();
  const pos = positionOf(queues, id);
  if (!pos) {
    return (
      <span className="ix-qcell" data-muted="">
        <b>Not queued</b>
      </span>
    );
  }
  const est =
    tip !== null && anchorMs !== null ? estimatePayment(pos.position, pos.size, tip, anchorMs, nowMs) : null;
  return (
    <span
      className="ix-qcell"
      title={`Position ${formatInt(pos.position + 1)} of ${formatInt(pos.size)}. The time is an estimate at about 30 s per block.`}
    >
      <b className="ix-mono">#{formatInt(pos.position + 1)}</b>
      {est ? (
        <small className="ix-mono">{pos.position === 0 ? 'next block' : etaShort(est.etaMs)}</small>
      ) : null}
    </span>
  );
}

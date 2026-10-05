// What the node inspector knows about its payments: where the node stands in its tier's queue, what a
// payment is worth, how long ago it was last paid. Read from the live queue and the node's own ledger;
// nothing here ticks, so only the leaf that shows a countdown subscribes to the clock.

import { useNetwork } from '../../../app/context';
import { fluxToNumber } from '../../../lib/format';
import { fluxPerDay, positionOf } from '../derive/queue';
import { useQueues, useTierInfo } from '../sources/live';
import { useNodeCtx } from './context';

export interface PayInfo {
  tier: ReturnType<typeof useNodeCtx>['tier'];
  status: string;
  /** Place in the tier's queue, 0 = paid in the next block; null when not in a queue. */
  position: number | null;
  /** Nodes in the tier's queue. */
  size: number;
  /** In the queue and waiting to be paid. */
  queued: boolean;
  /** FLUX per payment for the tier on the main chain, from the live tier stats. */
  payout: number | null;
  /** Main-chain FLUX per day in steady state (an estimate). */
  perDay: number | null;
  /** What that accrues a day in parallel assets, at the same pace. */
  paPerDay: number | null;
  /** Height of the last payment seen, 0 when none. */
  lastPaid: number;
}

export const NOT_QUEUED: Record<string, string> = {
  started: 'Waiting for the first confirmation',
  dos: 'DoS listed nodes are skipped',
  expired: 'This node is no longer paid',
  departed: 'This node has left the network',
};

/** Why a node earns nothing right now, said under a zero for its per-day figure. */
export const NOT_PAID: Record<string, string> = {
  started: 'until it is confirmed',
  dos: 'while DoS listed',
  expired: 'no longer paid',
  departed: 'left the network',
};

/** The node's queue standing and payout, from the live queue (with the server's own estimate as a fallback). */
export function usePayInfo(): PayInfo {
  const { id, tier, live, node, detail } = useNodeCtx();
  const queues = useQueues();
  const tiers = useTierInfo();
  const payoutRaw = useNetwork((s) => s.tierStats.find((t) => t.tier === tier)?.payout ?? null);

  const pos = id !== null ? positionOf(queues, id) : null;
  const server = detail?.payment_eta ?? null;
  const position = pos ? pos.position : server ? server.rank : null;
  const size = pos?.size ?? server?.tier_size ?? 0;
  const status = live?.status ?? node?.status ?? 'unknown';
  const queued = position !== null && size > 0 && (status === 'confirmed' || status === 'offline');
  const info = tiers.find((t) => t.tier === tier);
  const tierSize = pos?.size ?? info?.count ?? 0;
  const payout = payoutRaw === null ? null : fluxToNumber(payoutRaw);
  return {
    tier,
    status,
    position,
    size,
    queued,
    payout,
    perDay: info?.payout != null && tierSize > 0 ? fluxPerDay(info.payout, tierSize) : null,
    paPerDay: info?.paPayout != null && tierSize > 0 ? fluxPerDay(info.paPayout, tierSize) : null,
    lastPaid: Math.max(live?.lastPaid ?? 0, node?.last_paid_height ?? 0),
  };
}

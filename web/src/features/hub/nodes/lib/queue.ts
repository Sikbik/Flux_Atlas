// The payment queue at a glance: per tier, what a block pays, how long one turn of the queue takes, what a node earns
// in a day at that pace, and who is next. The numbers are the server's per-tier stats; the day's earnings and the
// turn's length are estimates from them (a block about every 30 seconds). Pure.

import type { NextPayeeDto } from '../../../../api/generated/NextPayeeDto';
import type { TierStats } from '../../../../api/generated/TierStats';
import { BLOCK_MS, fluxToNumber, formatDuration, formatFlux } from '../../../../lib/format';
import { perDayText } from './operators';
import { TIER_KEYS, TIER_NAME, type TierKey } from './tiers';

/** Blocks in a day at one every 30 seconds. */
export const BLOCKS_PER_DAY = 86_400_000 / BLOCK_MS;

export interface QueueNext {
  /** The node's id in the live table, when the server named one. */
  nodeId: number | null;
  /** Where it can be opened by its collateral, when the tier's head is the node named. */
  outpoint: string | null;
  endpoint: string | null;
  /** The address the next block pays it to. */
  address: string | null;
}

export interface QueueRow {
  tier: TierKey;
  name: string;
  nodes: number;
  /** A block's payout to the head of the queue: `9.00`. */
  payout: string | null;
  /** About how long one turn of the queue takes, and in words. */
  cycleBlocks: number | null;
  cycleText: string | null;
  /** What a node earns in a day at that pace. An estimate. */
  perDay: number | null;
  perDayText: string;
  next: QueueNext | null;
}

/** The next block's payees, as the store holds them. */
export interface NextPayeesLike {
  height: number;
  payees: readonly NextPayeeDto[];
}

/** The tiers in order, smallest first; a tier the server sent no stats for is left out. */
export function queueRows(stats: readonly TierStats[], next: NextPayeesLike | null): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const tier of TIER_KEYS) {
    const s = stats.find((t) => t.tier === tier);
    if (!s) continue;
    const payout = fluxToNumber(s.payout);
    const cycle = s.cycle_blocks > 0 ? s.cycle_blocks : null;
    const perDay = payout !== null && cycle !== null ? (payout * BLOCKS_PER_DAY) / cycle : null;
    const payee = next?.payees.find((p) => p.tier === tier) ?? null;
    const head = s.next;
    const sameNode = head !== null && (payee === null || payee.node === null || payee.node === head.id);
    const nodeId = payee?.node ?? head?.id ?? null;
    rows.push({
      tier,
      name: TIER_NAME[tier],
      nodes: s.count,
      payout: s.payout ? formatFlux(s.payout, { decimals: 2, unit: false }) : null,
      cycleBlocks: cycle,
      cycleText: cycle === null ? null : formatDuration(cycle * BLOCK_MS),
      perDay,
      perDayText: perDayText(perDay),
      next:
        nodeId === null && !payee?.address
          ? null
          : {
              nodeId,
              outpoint: sameNode ? (head?.outpoint ?? null) : null,
              endpoint: sameNode ? (head?.endpoint ?? null) : null,
              address: payee?.address || null,
            },
    });
  }
  return rows;
}

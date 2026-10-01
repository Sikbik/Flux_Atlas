// The payment queue, read from the live node table (ARCHITECTURE section 8, rank contract).
//
// Every tier is a strict rotation: each block pays the head of each tier's queue and the payee moves to
// the back. The NetworkStore keeps the rank column exact: it rotates a payee to the back on every block,
// closes the gap when a node leaves or drops out of `confirmed`, inserts a node that receives a rank,
// honours the explicit unranked signal (`rank: null`, stored as 0 = not queued) and takes the server's
// authoritative ranks from every `cause: reconcile` delta. So the order of a tier is simply its queued
// nodes (stored rank above 0) sorted by stored rank; this module does not re-derive it from payment
// heights, because that would second-guess the server's own queue model.
//
// The authoritative next payee (`next_payees`) still corrects the head when the two disagree for a moment
// (the announcement can land before the rank delta does). ETAs are `(position + 1) x 30 s` from the tip's
// arrival, always labelled as estimates.

import type { NextPayeesMsg } from '../../../api/generated/NextPayeesMsg';
import { QUEUE_TIERS, type QueueTier } from '../../../app/search';
import { BLOCK_MS } from '../../../lib/format';
import type { NodeTable } from '../../../store/nodeTable';

export { QUEUE_TIERS, type QueueTier };

/** Tier codes of the `tier` column. */
export const TIER_CODE: Record<QueueTier, number> = { cumulus: 1, nimbus: 2, stratus: 3 };

export interface TierQueue {
  tier: QueueTier;
  /** Node ids in queue order: index 0 is paid in the next block. */
  ids: Uint32Array;
  size: number;
  /** True when the head was moved to match the authoritative next payee. */
  headCorrected: boolean;
  /** Newest payment height among the queued nodes, 0 when none is known. */
  throughHeight: number;
}

export interface QueueSnapshot {
  tiers: Record<QueueTier, TierQueue>;
  /** Position of a node in its tier's queue, or -1. Indexed by node id. */
  position: Int32Array;
  /** Tier of a node id (0 = not queued). Indexed by node id. */
  tierOf: Uint8Array;
}

export interface NextPayeeHint {
  height: number;
  payees: ReadonlyArray<{ tier: string; node: number | null }>;
}

/** Position of `id` in its queue (0 = next block), or null when the node is not queued. */
export function positionOf(
  q: QueueSnapshot,
  id: number,
): { tier: QueueTier; position: number; size: number } | null {
  const pos = q.position[id];
  const tc = q.tierOf[id];
  if (pos === undefined || pos < 0 || !tc) return null;
  const tier = QUEUE_TIERS[tc - 1];
  if (!tier) return null;
  return { tier, position: pos, size: q.tiers[tier].size };
}

/**
 * Builds the three queues from the table's stored ranks (a node with rank 0 is not queued). `next` (the
 * authoritative `next_payees` for `tipHeight + 1`) moves the named node to the front of its tier when the
 * head by rank disagrees.
 */
export function buildQueues(
  t: NodeTable,
  next?: NextPayeeHint | NextPayeesMsg | null,
  tipHeight?: number | null,
): QueueSnapshot {
  const rowsByTier: number[][] = [[], [], []];
  let maxId = 0;
  for (let i = 0; i < t.count; i++) {
    const id = t.ids[i]!;
    if (id > maxId) maxId = id;
    const tc = t.tier[i]!;
    if (tc >= 1 && tc <= 3 && t.rank[i]! > 0) rowsByTier[tc - 1]!.push(i);
  }
  const position = new Int32Array(maxId + 1).fill(-1);
  const tierOf = new Uint8Array(maxId + 1);
  const fresh =
    next && tipHeight !== null && tipHeight !== undefined && next.height === tipHeight + 1 ? next : null;

  const tiers = {} as Record<QueueTier, TierQueue>;
  QUEUE_TIERS.forEach((tier, k) => {
    const rows = rowsByTier[k]!;
    rows.sort((a, b) => t.rank[a]! - t.rank[b]! || t.ids[a]! - t.ids[b]!);
    const ids = new Uint32Array(rows.length);
    for (let j = 0; j < rows.length; j++) ids[j] = t.ids[rows[j]!]!;

    let headCorrected = false;
    const hint = fresh?.payees.find((p) => p.tier === tier)?.node ?? null;
    if (hint !== null && ids.length > 0 && ids[0] !== hint) {
      const at = ids.indexOf(hint);
      if (at > 0) {
        ids.copyWithin(1, 0, at);
        ids[0] = hint;
        headCorrected = true;
      }
    }

    let through = 0;
    for (const r of rows) through = Math.max(through, t.lastPaid[r]!);
    for (let j = 0; j < ids.length; j++) {
      position[ids[j]!] = j;
      tierOf[ids[j]!] = k + 1;
    }
    tiers[tier] = { tier, ids, size: ids.length, headCorrected, throughHeight: through };
  });
  return { tiers, position, tierOf };
}

export interface PaymentEstimate {
  /** 0 = paid in the next block. */
  position: number;
  size: number;
  /** Blocks from the tip to the paying block (position + 1). */
  blocks: number;
  /** Height of the paying block. */
  payingHeight: number;
  /** Expected unix ms of the paying block (an estimate: the cadence is about 30 s). */
  atMs: number;
  /** Milliseconds from `nowMs` to the paying block, never negative. */
  etaMs: number;
}

/**
 * When the node at `position` is paid. `anchorMs` is when the tip block landed (the event clock's
 * anchor), so the next block is expected one interval after it and each further slot one more.
 */
export function estimatePayment(
  position: number,
  size: number,
  tipHeight: number,
  anchorMs: number,
  nowMs: number,
  blockMs = BLOCK_MS,
): PaymentEstimate {
  const blocks = position + 1;
  const atMs = anchorMs + blocks * blockMs;
  return {
    position,
    size,
    blocks,
    payingHeight: tipHeight + blocks,
    atMs,
    etaMs: Math.max(0, atMs - nowMs),
  };
}

/** The tier's payment cycle in hours: one node is paid per block, so about size blocks. */
export function cycleHours(size: number, blockMs = BLOCK_MS): number {
  return (size * blockMs) / 3_600_000;
}

/** FLUX per day a node of a tier earns in steady state (payout x blocks per day / tier size). */
export function fluxPerDay(payout: number, size: number, blockMs = BLOCK_MS): number | null {
  if (!Number.isFinite(payout) || size <= 0) return null;
  return (payout * (86_400_000 / blockMs)) / size;
}

/** Fraction (0..1) of the queue already walked: 1 at the head, 0 at the back. */
export function queueProgress(position: number, size: number): number {
  if (size <= 1) return 1;
  return 1 - position / (size - 1);
}

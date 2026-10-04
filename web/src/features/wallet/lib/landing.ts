// A payment landing: a block that has just been mined and paid the wallet. The live block ring carries every
// payout of every block, so a page that is open when one lands can say so at once (the balance counts up, the
// dial's node flashes) without waiting for the wallet to be fetched again. Pure functions; `hooks/useWallet.ts`
// feeds them the store's blocks.

import { PAY_TIERS, type PayTier } from '../types';
import { flux } from './money';

/** The part of a chain block this reads (the store's `ChainBlock` satisfies it). */
export interface BlockLike {
  height: number;
  /** True when it arrived over the live stream (a block of the bootstrap is history, not news). */
  live: boolean;
  timeMs: number;
  payouts: readonly { tier: string; node: number | null; address: string; amount: string }[];
}

export interface Landing {
  height: number;
  /** When the block was mined, unix ms. */
  at: number;
  /** FLUX paid to this wallet in the block. */
  flux: number;
  /** Payments by tier. */
  byTier: Record<PayTier, { count: number; flux: number }>;
  /** The collateral outpoints of the nodes paid, where the table knew them. */
  keys: string[];
  /** Payments in the block (a node may be paid once, but the count is of payouts, not of nodes). */
  count: number;
}

const emptyTiers = (): Landing['byTier'] =>
  Object.fromEntries(PAY_TIERS.map((t) => [t, { count: 0, flux: 0 }])) as Landing['byTier'];

/**
 * The landings among the blocks newer than `afterHeight`, oldest first. `blocks` is newest first, as the store's
 * ring gives it. A block that did not pay this wallet is not a landing; a block of the bootstrap never is.
 */
export function landingsAfter(
  blocks: readonly BlockLike[],
  address: string,
  afterHeight: number,
  keyOf: (nodeId: number) => string | null = () => null,
): Landing[] {
  const out: Landing[] = [];
  for (const b of blocks) {
    if (b.height <= afterHeight) break;
    if (!b.live) continue;
    let landing: Landing | null = null;
    for (const p of b.payouts) {
      if (p.address !== address) continue;
      landing ??= { height: b.height, at: b.timeMs, flux: 0, byTier: emptyTiers(), keys: [], count: 0 };
      const amount = flux(p.amount);
      landing.flux += amount;
      landing.count++;
      const tier = (PAY_TIERS as readonly string[]).includes(p.tier) ? (p.tier as PayTier) : null;
      if (tier) {
        landing.byTier[tier].count++;
        landing.byTier[tier].flux += amount;
      }
      const key = p.node === null ? null : keyOf(p.node);
      if (key && !landing.keys.includes(key)) landing.keys.push(key);
    }
    if (landing) out.push(landing);
  }
  return out.reverse();
}

/** The highest block height in a newest-first list, or 0 for none. */
export const newestHeight = (blocks: readonly Pick<BlockLike, 'height'>[]): number => blocks[0]?.height ?? 0;

/** How many landings are kept for the page to show (the newest). */
export const KEEP_LANDINGS = 12;

/** Adds landings (oldest first) to the kept list (newest first), without repeats, up to the limit. */
export function pushLandings(kept: readonly Landing[], add: readonly Landing[]): Landing[] {
  const seen = new Set(kept.map((l) => l.height));
  const next = [...kept];
  for (const l of add) {
    if (seen.has(l.height)) continue;
    seen.add(l.height);
    next.unshift(l);
  }
  return next.slice(0, KEEP_LANDINGS);
}

/** A landing in one line: `+9.20 FLUX from 1 node`, `+27.60 FLUX from 3 nodes, block 3,011,200`. */
export function landingText(l: Landing): string {
  const nodes = `${l.count} ${l.count === 1 ? 'node' : 'nodes'}`;
  return `+${l.flux.toFixed(2)} FLUX from ${nodes}`;
}

// Who was paid lately, from the live block ring.

import type { ChainBlock } from '../../../store/network';
import type { QueueTier } from './queue';

export interface Payee {
  height: number;
  node: number | null;
  address: string;
}

/** The newest payees of a tier from the live block ring (which is newest first), newest first. */
export function recentPayees(blocks: readonly ChainBlock[], tier: QueueTier, limit: number): Payee[] {
  const out: Payee[] = [];
  for (let i = 0; i < blocks.length && out.length < limit; i++) {
    const b = blocks[i]!;
    const p = b.payouts.find((x) => x.tier === tier);
    if (p) out.push({ height: b.height, node: p.node, address: p.address });
  }
  return out;
}

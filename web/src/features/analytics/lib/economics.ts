// What a node earns, as an estimate. Each block pays one node per tier a fixed amount, so over a day a
// tier pays out `payout x blocks per day`, shared by the nodes waiting their turn. The payment cycle
// (blocks between two payouts to the same node) is the server's own figure, about the tier's node
// count. Yield is simple, per year, on the tier's collateral: before hosting costs, uptime and price.

export type EarnTier = 'cumulus' | 'nimbus' | 'stratus';

export interface TierInput {
  tier: EarnTier;
  /** Nodes in the tier. */
  count: number;
  /** Collateral per node, FLUX. */
  collateral: number;
  /** FLUX paid per block to one node of the tier. */
  payout: number;
  /** Blocks between two payouts to the same node, if the server gives one. */
  cycleBlocks: number | null;
}

export interface TierYield {
  tier: EarnTier;
  nodes: number;
  collateral: number;
  payout: number;
  /** Blocks between two payouts to one node. */
  cycleBlocks: number;
  /** Hours between two payouts to one node. */
  cycleHours: number;
  /** FLUX one node earns per day, on average. */
  perDay: number;
  perYear: number;
  /** Yearly yield on collateral, a fraction. */
  apy: number;
  /** The same after the next reward cut, when one is scheduled. */
  after: { perDay: number; apy: number } | null;
}

export const BLOCKS_PER_DAY = 2880;
export const BLOCK_SECONDS = 30;

export function tierYields(
  inputs: readonly TierInput[],
  /** Payout per block after the next cut, by tier; omit when no cut is scheduled. */
  nextPayout?: Partial<Record<EarnTier, number>> | null,
): TierYield[] {
  return inputs.map((i) => {
    const cycle = i.cycleBlocks !== null && i.cycleBlocks > 0 ? i.cycleBlocks : Math.max(1, i.count);
    const perDay = (i.payout * BLOCKS_PER_DAY) / cycle;
    const perYear = perDay * 365;
    const next = nextPayout?.[i.tier];
    const afterPerDay = next === undefined ? null : (next * BLOCKS_PER_DAY) / cycle;
    return {
      tier: i.tier,
      nodes: i.count,
      collateral: i.collateral,
      payout: i.payout,
      cycleBlocks: cycle,
      cycleHours: (cycle * BLOCK_SECONDS) / 3600,
      perDay,
      perYear,
      apy: i.collateral > 0 ? perYear / i.collateral : 0,
      after:
        afterPerDay === null
          ? null
          : { perDay: afterPerDay, apy: i.collateral > 0 ? (afterPerDay * 365) / i.collateral : 0 },
    };
  });
}

/** `28 hours`, `3 days 4 hours`: how long between two payouts to one node. */
export function formatCycle(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return 'unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest === 0 ? `${days} days` : `${days} days ${rest} hours`;
}

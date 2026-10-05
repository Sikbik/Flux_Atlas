// The next payout, known one block ahead (design 4.3): which node each tier pays in the next block, how
// much, and about when. One line per tier, largest first (the aim strip, the tickers and the ambient
// sentence all read in that order). Pure; the hooks bind the store.

import { BLOCK_MS, heightEta } from '../../lib/format';
import { TIER_ORDER, type TierName } from './glyphs';
import { splitReward } from './rewardcut';

export interface PayeeInput {
  tier: string;
  node: number | null;
  address: string;
}

export interface NextPayeesInput {
  /** Height of the block these payees will be paid in. */
  height: number;
  payees: readonly PayeeInput[];
}

export interface PayoutLine {
  tier: TierName;
  node: number | null;
  address: string;
  /** City, or country when the data has no city. */
  place: string | null;
  /** FLUX paid to this tier in one block. */
  amount: number;
  /** Estimated ms until the block that pays it (0 once due). */
  etaMs: number;
}

/** One line per tier that has a predicted payee, Stratus first. */
export function nextPayoutLines(
  next: NextPayeesInput | null,
  tip: { height: number; timeMs: number } | null,
  nowMs: number,
  subsidy: number,
  placeOf: (node: number) => string | null,
): PayoutLine[] {
  if (!next) return [];
  const split = splitReward(subsidy);
  const etaMs = tip ? Math.max(0, heightEta(next.height, tip, nowMs, BLOCK_MS).etaMs) : 0;
  const out: PayoutLine[] = [];
  for (const tier of TIER_ORDER) {
    const p = next.payees.find((x) => x.tier === tier);
    if (!p) continue;
    out.push({
      tier,
      node: p.node,
      address: p.address,
      place: p.node === null ? null : placeOf(p.node),
      amount: split[tier],
      etaMs,
    });
  }
  return out;
}

/** `9.0`, `3.5`, `1.0`, `8.1`, `3.15`: at least one decimal, at most two, trailing zeros trimmed past one. */
export function amountLabel(n: number): string {
  const s = n.toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** `9 FLUX`, `3.5 FLUX`, `3.15 FLUX` for sentences. */
export function amountWords(n: number): string {
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return `${s} FLUX`;
}

/** `in ~12 s`, `in ~3 min`: an estimate, so it is marked as one. */
export function approxIn(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 90_000) return `in ~${Math.max(1, Math.round(t / 1000))} s`;
  if (t < 3_600_000) return `in ~${Math.round(t / 60_000)} min`;
  return `in ~${(t / 3_600_000).toFixed(1)} h`;
}

/**
 * The ticker sentence for one tier: "Next Stratus payout: Helsinki, 9 FLUX on the main chain, in ~12 s". A payout is a
 * main-chain payment, and says so, so it never reads as the whole of what a node earns (which adds the parallel
 * assets the payment accrues).
 */
export function payoutSentence(line: PayoutLine, label: string): string {
  const where = line.place ?? 'an unlocated node';
  return `Next ${label} payout: ${where}, ${amountWords(line.amount)} on the main chain, ${approxIn(line.etaMs)}`;
}

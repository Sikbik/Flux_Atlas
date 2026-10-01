// Emission math for Proof of Node blocks, in exact base units (1e-8 FLUX) with bigint. It mirrors the
// server's `atlas_core::emission` (fluxd consensus): PoN starts at height 2,020,000 with a 14 FLUX
// subsidy, cut to 9/10 (integer floor) every 1,051,200 blocks, at most 20 times and constant after
// that. Each tier node paid in a block receives `subsidy * base / 14` (base 1.0, 3.5 or 9.0) and the
// dev fund gets the remainder plus every fee.
//
// Everything here is pure; charts convert to numbers at the edge (`satsToFlux`).

import type { Tier } from '../../../api/generated/Tier';

export const COIN = 100_000_000n;
/** First Proof of Node height (2025-10-25). */
export const PON_ACTIVATION_HEIGHT = 2_020_000;
/** Blocks between subsidy reductions. */
export const REDUCTION_INTERVAL = 1_051_200;
export const MAX_REDUCTIONS = 20;
export const PON_INITIAL_SUBSIDY = 14n * COIN;
export const BLOCK_SECONDS = 30;
export const BLOCK_MS = BLOCK_SECONDS * 1000;
export const BLOCKS_PER_DAY = 2880;
/** The first reduction height (3,071,200). */
export const FIRST_REDUCTION_HEIGHT = PON_ACTIVATION_HEIGHT + REDUCTION_INTERVAL;
/** The announced maximum supply, a reference line only (the consensus code does not enforce it). */
export const ANNOUNCED_MAX_SUPPLY_FLUX = 560_000_000;

export type PaidTier = Exclude<Tier, 'unknown'>;
export const PAID_TIERS: readonly PaidTier[] = ['stratus', 'nimbus', 'cumulus'];

/** Base payout of each tier at the initial subsidy (1.0, 3.5, 9.0 of 14). */
const TIER_BASE: Record<PaidTier, bigint> = {
  cumulus: COIN,
  nimbus: (COIN * 7n) / 2n,
  stratus: COIN * 9n,
};

export function satsToFlux(sats: bigint): number {
  return Number(sats) / 1e8;
}

export const isPon = (height: number): boolean => height >= PON_ACTIVATION_HEIGHT;

/** Number of subsidy cuts applied at `height` (0 before the first cut). */
export function reductionsAt(height: number): number {
  if (height < PON_ACTIVATION_HEIGHT) return 0;
  return Math.min(MAX_REDUCTIONS, Math.floor((height - PON_ACTIVATION_HEIGHT) / REDUCTION_INTERVAL));
}

/** The height of cut number `k` (1-based): 3,071,200 for the first. */
export const reductionHeight = (k: number): number => PON_ACTIVATION_HEIGHT + k * REDUCTION_INTERVAL;

/** Height of the next cut strictly after `height`, or null once all 20 are done. */
export function nextReductionHeight(height: number): number | null {
  const done = reductionsAt(height);
  if (done >= MAX_REDUCTIONS) return null;
  return reductionHeight(done + 1);
}

/** Subsidy after `k` cuts (k = 0..20), computed once with the consensus integer flooring. */
const SUBSIDY_AFTER: bigint[] = (() => {
  const out: bigint[] = [PON_INITIAL_SUBSIDY];
  for (let k = 1; k <= MAX_REDUCTIONS; k++) out.push((out[k - 1]! * 9n) / 10n);
  return out;
})();

/** Block subsidy at a PoN height; null before activation. */
export function subsidyAt(height: number): bigint | null {
  if (!isPon(height)) return null;
  return SUBSIDY_AFTER[reductionsAt(height)]!;
}

/** Payout owed to one node of `tier` at a PoN height. */
export function tierPayoutAt(height: number, tier: PaidTier): bigint | null {
  const s = subsidyAt(height);
  if (s === null) return null;
  return (s * TIER_BASE[tier]) / PON_INITIAL_SUBSIDY;
}

export interface PayoutSchedule {
  height: number;
  subsidy: bigint;
  cumulus: bigint;
  nimbus: bigint;
  stratus: bigint;
  /** The minimum dev-fund output (the remainder); the real output adds every fee. */
  devFundMin: bigint;
}

export function payoutSchedule(height: number): PayoutSchedule | null {
  const subsidy = subsidyAt(height);
  if (subsidy === null) return null;
  const cumulus = tierPayoutAt(height, 'cumulus')!;
  const nimbus = tierPayoutAt(height, 'nimbus')!;
  const stratus = tierPayoutAt(height, 'stratus')!;
  return { height, subsidy, cumulus, nimbus, stratus, devFundMin: subsidy - cumulus - nimbus - stratus };
}

/** Every cut of the schedule: height, the new subsidy and the new split. */
export interface Cut {
  /** 1-based cut number. */
  k: number;
  height: number;
  subsidy: bigint;
  schedule: PayoutSchedule;
}

export function allCuts(): Cut[] {
  const out: Cut[] = [];
  for (let k = 1; k <= MAX_REDUCTIONS; k++) {
    const height = reductionHeight(k);
    out.push({ k, height, subsidy: SUBSIDY_AFTER[k]!, schedule: payoutSchedule(height)! });
  }
  return out;
}

/** Subsidy summed over blocks `[from, to)`: exact, in closed form per constant-subsidy period. */
export function emittedBetween(from: number, to: number): bigint {
  if (to <= from) return 0n;
  let h = Math.max(from, PON_ACTIVATION_HEIGHT);
  let total = 0n;
  while (h < to) {
    const k = reductionsAt(h);
    const periodEnd = k >= MAX_REDUCTIONS ? Number.POSITIVE_INFINITY : reductionHeight(k + 1);
    const end = Math.min(to, periodEnd);
    total += SUBSIDY_AFTER[k]! * BigInt(end - h);
    h = end;
  }
  return total;
}

export interface EmissionPoint {
  height: number;
  /** Block subsidy at this height, FLUX. */
  subsidy: number;
  /** Projected total supply at this height, FLUX (current supply plus emission since the tip). */
  supply: number;
  /** Cumulative dev fund inflow from the tip, FLUX (minimum output, fees not projected). */
  devFund: number;
}

/**
 * The projected curve from the tip to `toHeight`: total supply grows by each block's subsidy, with no
 * fees and no burns assumed. Sampled evenly, plus both sides of every cut so steps stay sharp.
 */
export function projectEmission(
  tipHeight: number,
  tipSupplyFlux: number,
  toHeight: number,
  samples = 240,
): EmissionPoint[] {
  const heights = new Set<number>([tipHeight, toHeight]);
  const span = Math.max(1, toHeight - tipHeight);
  for (let i = 0; i <= samples; i++) heights.add(Math.round(tipHeight + (span * i) / samples));
  for (let k = 1; k <= MAX_REDUCTIONS; k++) {
    const hc = reductionHeight(k);
    if (hc > tipHeight && hc <= toHeight) {
      heights.add(hc - 1);
      heights.add(hc);
    }
  }
  const sorted = [...heights].filter((h) => h >= tipHeight && h <= toHeight).sort((a, b) => a - b);
  let devAcc = 0;
  let prev = tipHeight;
  return sorted.map((height) => {
    const sub = subsidyAt(Math.max(height, PON_ACTIVATION_HEIGHT)) ?? 0n;
    const emitted = satsToFlux(emittedBetween(tipHeight, height));
    // Dev fund: the minimum output of each constant-subsidy stretch between samples.
    if (height > prev) {
      const sched = payoutSchedule(prev);
      devAcc += sched ? satsToFlux(sched.devFundMin) * (height - prev) : 0;
    }
    prev = height;
    return { height, subsidy: satsToFlux(sub), supply: tipSupplyFlux + emitted, devFund: devAcc };
  });
}

/** Expected unix ms of `height` assuming the 30 s cadence from a known block (an estimate). */
export function estimateTimeMs(height: number, tip: { height: number; timeMs: number }): number {
  return tip.timeMs + (height - tip.height) * BLOCK_MS;
}

/** The first height at which projected supply reaches `targetFlux`, or null if it never does (an estimate). */
export function heightReachingSupply(
  tipHeight: number,
  tipSupplyFlux: number,
  targetFlux: number,
): number | null {
  if (tipSupplyFlux >= targetFlux) return tipHeight;
  let h = tipHeight;
  let supply = BigInt(Math.round(tipSupplyFlux * 1e8));
  const target = BigInt(Math.round(targetFlux * 1e8));
  while (supply < target) {
    const k = reductionsAt(Math.max(h, PON_ACTIVATION_HEIGHT));
    const per = SUBSIDY_AFTER[k]!;
    const periodEnd = k >= MAX_REDUCTIONS ? Number.POSITIVE_INFINITY : reductionHeight(k + 1);
    const room = (target - supply + per - 1n) / per; // blocks needed at this subsidy
    if (Number.isFinite(periodEnd) && BigInt(periodEnd - h) < room) {
      supply += per * BigInt(periodEnd - h);
      h = periodEnd;
      continue;
    }
    const blocks = Number(room);
    // The constant floor emits forever, so the target is always reachable; cap absurd horizons.
    if (h + blocks > 200_000_000) return null;
    return h + blocks;
  }
  return h;
}

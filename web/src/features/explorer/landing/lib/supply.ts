// The supply at a glance: how much FLUX exists, how much of it sits locked as node collateral, how much is in the
// shielded pools, and how far the total is from the announced cap. Pure.

import type { SupplyDto } from '../../../../api/generated/SupplyDto';
import { fluxToNumber } from '../../../../lib/format';
import { ANNOUNCED_MAX_SUPPLY_FLUX } from '../../lib/emission';

export interface TierCollateral {
  tier: string;
  count: number;
  /** FLUX held as collateral by one node of the tier. */
  collateral: string;
}

export interface SupplySegment {
  id: 'locked' | 'transparent' | 'shielded';
  label: string;
  /** FLUX. */
  value: number;
}

export interface SupplyGlance {
  total: number | null;
  /** The explorer's own circulating figure. */
  circulating: number | null;
  transparent: number | null;
  shielded: number | null;
  /** FLUX held as collateral by confirmed nodes, or null when the tiers are not known. */
  locked: number | null;
  /** The locked part of the total, 0..1. */
  lockedShare: number | null;
  /** The total against the announced cap, 0..1. */
  capShare: number | null;
  /** New FLUX a day. */
  perDay: number | null;
  /** The total split into what is locked, what else is transparent and what is shielded; empty when it cannot be. */
  segments: SupplySegment[];
}

const PAID = ['cumulus', 'nimbus', 'stratus'] as const;

/** Collateral locked by the confirmed nodes: every paid tier has to be known, or the figure is not told. */
export function lockedCollateral(tiers: readonly TierCollateral[]): number | null {
  let sum = 0;
  for (const name of PAID) {
    const t = tiers.find((x) => x.tier === name);
    const c = t ? fluxToNumber(t.collateral) : null;
    if (!t || c === null || c <= 0 || !Number.isFinite(t.count)) return null;
    sum += t.count * c;
  }
  return sum;
}

export function supplyGlance(
  dto: SupplyDto | undefined | null,
  tiers: readonly TierCollateral[],
): SupplyGlance {
  const s = dto?.supply ?? null;
  const total = fluxToNumber(s?.total);
  const transparent = fluxToNumber(s?.transparent);
  const shielded = fluxToNumber(s?.shielded);
  const locked = lockedCollateral(tiers);
  // Collateral is held in transparent coins: more of it than there are transparent coins is a mismatch of
  // sources, and the split is left out rather than drawn wrong.
  const split = total !== null && transparent !== null && shielded !== null;
  const lockedOk = split && locked !== null && locked <= transparent;
  const segments: SupplySegment[] = [];
  if (split) {
    if (lockedOk) {
      segments.push({ id: 'locked', label: 'Locked in nodes', value: locked });
      segments.push({ id: 'transparent', label: 'Other transparent coins', value: transparent - locked });
    } else {
      segments.push({ id: 'transparent', label: 'Transparent coins', value: transparent });
    }
    segments.push({ id: 'shielded', label: 'Shielded pools', value: shielded });
  }
  return {
    total,
    circulating: fluxToNumber(s?.circulating_explorer),
    transparent,
    shielded,
    locked: lockedOk ? locked : null,
    lockedShare: lockedOk && total !== null && total > 0 ? locked / total : null,
    capShare: total !== null ? total / ANNOUNCED_MAX_SUPPLY_FLUX : null,
    perDay: fluxToNumber(dto?.emission_per_day),
    segments,
  };
}

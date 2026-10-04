// The newest confirmed nodes as rows: the tier, where it is, who hosts it, and when it began. The server names a
// node by its collateral outpoint, which is also the key its window opens by. Pure.

import type { NewestNode } from '../../../../api/generated/NewestNode';
import { shortCollateral } from '../../../../lib/format';
import { TIER_KEYS, TIER_NAME, type TierKey } from './tiers';

/** Rows the panel shows. */
export const NEWEST_SHOWN = 10;

export interface NewestRow {
  /** The outpoint: the node window's key. */
  key: string;
  /** The outpoint shortened, for a name when the live table does not know the node yet. */
  shortKey: string;
  tier: TierKey | 'unknown';
  tierName: string;
  country: string | null;
  countryCode: string | null;
  /** The organisation (else the provider key) to show, and the entity the link filters the globe by. */
  provider: string | null;
  providerKey: string | null;
  sinceMs: number;
}

const isTier = (t: string): t is TierKey => (TIER_KEYS as readonly string[]).includes(t);

export function newestRows(list: readonly NewestNode[] | undefined, limit = NEWEST_SHOWN): NewestRow[] {
  if (!list) return [];
  return list.slice(0, limit).map((n) => {
    const tier = isTier(n.tier) ? n.tier : 'unknown';
    return {
      key: n.node_key,
      shortKey: shortCollateral(n.node_key),
      tier,
      tierName: tier === 'unknown' ? 'Unknown tier' : TIER_NAME[tier],
      country: n.country ?? n.country_code ?? null,
      countryCode: n.country_code,
      provider: n.provider,
      providerKey: n.provider_key,
      sinceMs: n.active_since_ms,
    };
  });
}

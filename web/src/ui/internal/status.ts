// The five reserved status roles of tokens.css (`data-status` remaps `--status` and `--status-soft`).

/** Status role: `ok` (green), `pending` (Blue Wave shade), `warn` (orange), `crit` (red), `off` (gray). */
export type StatusTone = 'ok' | 'pending' | 'warn' | 'crit' | 'off';

/** Node tiers, as the API names them. */
export type TierName = 'cumulus' | 'nimbus' | 'stratus';

export const TIER_NAMES: readonly TierName[] = ['cumulus', 'nimbus', 'stratus'];

/** `cumulus` -> `Cumulus`. */
export function tierLabel(tier: TierName): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// Tier vocabulary and the producer mark shared by the chrome (design 5.4). The tier meter itself (three
// stacked capsules, one lit for Cumulus, two for Nimbus, three for Stratus) is the UI kit's `TierGlyph`;
// the producer mark (a hexagon with a spark) is original SVG on the 24 px grid, 1.5 px strokes, currentColor.

import type { Tier } from '../../api/generated/Tier';

export type TierName = Exclude<Tier, 'unknown'>;

export const TIER_ORDER: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];

export const TIER_LABEL: Record<Tier, string> = {
  unknown: 'Unknown',
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
};

/** Store tier codes (nodes.bin) to names. */
export const TIER_BY_CODE: readonly Tier[] = ['unknown', 'cumulus', 'nimbus', 'stratus'];

export const tierOf = (code: number | undefined): Tier => TIER_BY_CODE[code ?? 0] ?? 'unknown';

/** A hexagon with a spark: the node that produced a block. */
export function ProducerGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12l-4.5 7.8h-9L3 12l4.5-7.8h9z" />
      <path d="M12.6 7.6 9.8 12.4h3.4l-1.8 4.2 3.8-5.2h-3.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

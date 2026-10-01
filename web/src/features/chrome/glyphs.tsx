// Custom glyphs and tier vocabulary shared by the chrome (design 5.4): the tier meter (three stacked
// capsules, one lit for Cumulus, two for Nimbus, three for Stratus: tier is never colour alone) and the
// producer mark (a hexagon with a spark). Original SVG on the 24 px grid, 1.5 px strokes, currentColor.

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

const LIT: Record<Tier, number> = { unknown: 0, cumulus: 1, nimbus: 2, stratus: 3 };

/**
 * The tier meter. Pass `title` when the glyph is the only carrier of the tier; beside the tier word it
 * stays decorative. The lit capsules take the tier colour from the nearest `data-tier`.
 */
export function TierGlyph({ tier, size = 14, title }: { tier: Tier; size?: number; title?: string }) {
  const lit = LIT[tier];
  return (
    <svg
      className="glyph-tier"
      data-tier={tier}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {[0, 1, 2].map((k) => (
        <rect
          key={k}
          x={3}
          y={4 + k * 6.4}
          width={18}
          height={4.2}
          rx={2.1}
          fill={2 - k < lit ? 'var(--tier, currentColor)' : 'rgb(255 255 255 / 0.16)'}
        />
      ))}
    </svg>
  );
}

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

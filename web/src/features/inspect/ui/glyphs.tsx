// Custom glyphs from the design's icon set (5.4): the tier meter and the ArcaneOS hexagon. Both are
// original SVG on the 24 px grid, `currentColor` or tier-driven, never filled with a fixed colour.

import type { Tier } from '../../../api/generated/Tier';

const LIT: Record<string, number> = { cumulus: 1, nimbus: 2, stratus: 3 };
/** Capsule tops, bottom up: the lowest capsule is lit first. */
const CAPSULE_Y = [15.5, 9.75, 4] as const;

/** Three stacked capsules, one lit for Cumulus, two for Nimbus, three for Stratus. */
export function TierGlyph({ tier, size = 14 }: { tier: Tier | string; size?: number }) {
  const lit = LIT[tier] ?? 0;
  return (
    <svg
      className="ix-tier-glyph"
      data-tier={tier}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {CAPSULE_Y.map((y, i) => (
        <rect key={y} x="4" y={y} width="16" height="4.5" rx="2.25" className={i < lit ? 'on' : 'off'} />
      ))}
    </svg>
  );
}

/** A pointy-top hexagon with an upward chevron: ArcaneOS. */
export function ArcaneGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" />
      <path d="M8.5 13.2L12 9.6l3.5 3.6" />
    </svg>
  );
}

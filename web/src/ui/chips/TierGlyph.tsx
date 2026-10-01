import type { ComponentPropsWithRef } from 'react';
import { cx } from '../internal/cx';
import { TIER_NAMES, type TierName, tierLabel } from '../internal/status';
import './TierGlyph.css';

/** Props of a TierGlyph: the options below, plus `className`, `style`, `ref` and the other `<svg>` attributes. */
export interface TierGlyphProps extends Omit<ComponentPropsWithRef<'svg'>, 'children' | 'width' | 'height'> {
  /** The tier to draw: one capsule lit for Cumulus, two for Nimbus, three for Stratus, none for `unknown`. */
  tier: TierName | 'unknown' | null | undefined;
  /** Pixel size of the square glyph (the design uses 12, 14, 16 and 24; default 14). */
  size?: number;
  /** Accessible name; when omitted the glyph is decorative (always pair it with the tier word). */
  label?: string;
  /** `tier` (default) paints the lit capsules in the tier colour; `current` uses the surrounding text colour. */
  tone?: 'tier' | 'current';
}

/** Number of lit capsules for a tier (0 for unknown). */
export function litCapsules(tier: TierGlyphProps['tier']): number {
  const i = tier ? TIER_NAMES.indexOf(tier as TierName) : -1;
  return i + 1;
}

/** The tier meter: three stacked capsules, lit bottom-up, so tier reads in greyscale too (design 5.4). */
export function TierGlyph({ tier, size = 14, label, tone = 'tier', className, ...rest }: TierGlyphProps) {
  const lit = litCapsules(tier);
  const key = tier ?? 'unknown';
  return (
    <svg
      className={cx('ui-tier-glyph', className)}
      data-tier={key}
      data-tone={tone}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {[0, 1, 2].map((k) => (
        <rect
          key={k}
          className="ui-tier-glyph__cap"
          data-lit={2 - k < lit || undefined}
          x="3"
          y={4 + k * 6.4}
          width="18"
          height="4.2"
          rx="2.1"
        />
      ))}
    </svg>
  );
}

/** `Stratus, 3 of 3 tiers`-style description for assistive technology. */
export function tierDescription(tier: TierName): string {
  return `${tierLabel(tier)}, tier ${TIER_NAMES.indexOf(tier) + 1} of ${TIER_NAMES.length}`;
}

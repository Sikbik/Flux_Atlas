// ShareBar logic with no DOM: shares, colours (tier ink, the hatched unknown segment, the fixed
// categorical order) and the sentence that stands in for the picture.

import { formatInt, formatPercent } from '../../lib/format';
import type { TierName } from '../internal/status';
import { tierLabel } from '../internal/status';

export interface ShareSegmentLike {
  id: string;
  label: string;
  value: number | null;
  color?: string;
  tier?: TierName;
  unknown?: boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The categorical slots in their fixed order; past the sixth a segment folds into "Other". */
export const SHARE_SLOTS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
] as const;

/** The `--viz-other` colour a seventh and later plain segment takes. */
export const OTHER_COLOR = 'var(--viz-other)';

/** The tier ink colour (chart fills use the ink variants; the emissive ones are for glows). */
export function tierInk(tier: TierName): string {
  return `var(--tier-${tier}-ink)`;
}

/**
 * The fill colour of each segment. A tier segment wears its tier ink, the unknown segment the
 * reserved off-status gray, an explicit `color` wins; every other segment takes the next
 * categorical slot in array order (never cycled; a seventh and later fold into the Other gray).
 */
export function segmentColors(segments: readonly ShareSegmentLike[]): string[] {
  let slot = 0;
  return segments.map((s) => {
    if (s.unknown) return 'var(--status-off)';
    if (s.color) return s.color;
    if (s.tier) return tierInk(s.tier);
    const c = slot < SHARE_SLOTS.length ? (SHARE_SLOTS[slot] as string) : OTHER_COLOR;
    slot++;
    return c;
  });
}

export interface ShareRow {
  id: string;
  /** The segment's value, 0 for unknown or negative values. */
  value: number;
  /** 0..1 of the total (0 when the total is 0). */
  share: number;
}

/** The sum of the positive finite values. */
export function sumOf(segments: readonly Pick<ShareSegmentLike, 'value'>[]): number {
  let t = 0;
  for (const s of segments) if (isNum(s.value) && s.value > 0) t += s.value;
  return t;
}

/** Each segment's share of `total` (default: the sum of the values). */
export function sharesOf(segments: readonly ShareSegmentLike[], total?: number): ShareRow[] {
  const whole = total !== undefined && total > 0 ? total : sumOf(segments);
  return segments.map((s) => {
    const value = isNum(s.value) && s.value > 0 ? s.value : 0;
    return { id: s.id, value, share: whole > 0 ? Math.min(1, value / whole) : 0 };
  });
}

/** `Cumulus 3,393 (50.4%)`: one segment as text, "Unknown" for a missing value. */
export function segmentText(s: ShareSegmentLike, share: number): string {
  if (!isNum(s.value)) return `${s.label} Unknown`;
  return `${s.label} ${formatInt(s.value)} (${formatPercent(share)})`;
}

/**
 * The accessible name of the bar: every share in words. `Node tiers: Cumulus 3,393 (50.4%), Nimbus
 * 1,580 (23.5%), Stratus 1,763 (26.2%)`. Tier segments say their tier word (never colour alone).
 */
export function describeShares(
  label: string | undefined,
  segments: readonly ShareSegmentLike[],
  total?: number,
): string {
  const rows = sharesOf(segments, total);
  if (rows.every((r) => r.value === 0) && segments.every((s) => !isNum(s.value))) {
    return label ? `${label}: no data` : 'No data';
  }
  const parts = segments.map((s, i) =>
    segmentText({ ...s, label: s.tier ? tierLabel(s.tier) : s.label }, rows[i]?.share ?? 0),
  );
  return label ? `${label}: ${parts.join(', ')}` : parts.join(', ');
}

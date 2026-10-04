// The three node tiers as the Nodes hub draws them: counts, shares and a hexagon waffle (one cell per percent of the
// network). Pure.

import type { TierCounts } from '../../../../api/generated/TierCounts';
import { formatInt } from '../../../../lib/format';
import { shareText } from '../../../analytics/lib/concentration';

export type TierKey = 'cumulus' | 'nimbus' | 'stratus';

export const TIER_KEYS: readonly TierKey[] = ['cumulus', 'nimbus', 'stratus'];

export const TIER_NAME: Record<TierKey, string> = {
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
};

/** A tier (or the nodes whose tier is not known) with its count, share and cells in the waffle. */
export interface TierSlice {
  id: TierKey | 'unknown';
  label: string;
  count: number;
  /** 0..1 of all nodes counted. */
  share: number;
  /** Hexagons it fills in the waffle. */
  cells: number;
}

/**
 * Cuts `cells` hexagons between the slices in proportion to their counts (largest remainder, so the cells always add
 * up to `cells`). A slice that has nodes is never left with none: it takes one from the largest.
 */
export function allocateCells(counts: readonly number[], cells: number): number[] {
  const total = counts.reduce((s, c) => s + Math.max(0, c), 0);
  if (total <= 0 || cells <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (Math.max(0, c) / total) * cells);
  const out = exact.map(Math.floor);
  let left = cells - out.reduce((s, n) => s + n, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || (counts[b.i] ?? 0) - (counts[a.i] ?? 0));
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left--;
  }
  // A tier with nodes always shows.
  for (let i = 0; i < out.length; i++) {
    if ((counts[i] ?? 0) > 0 && out[i] === 0) {
      let big = 0;
      for (let j = 1; j < out.length; j++) if ((out[j] ?? 0) > (out[big] ?? 0)) big = j;
      if ((out[big] ?? 0) > 1) {
        out[big] = (out[big] ?? 0) - 1;
        out[i] = 1;
      }
    }
  }
  return out;
}

/**
 * The tiers of a network summary, smallest tier first, with the nodes of no known tier as a last slice when there are
 * any (the total can run past the three tiers; the remainder is Unknown, never dropped).
 */
export function tierSlices(
  counts: Pick<TierCounts, TierKey | 'total'>,
  cells = 100,
): { slices: TierSlice[]; total: number } {
  const known = TIER_KEYS.reduce((s, k) => s + Math.max(0, counts[k]), 0);
  const total = Math.max(known, counts.total);
  const rows: { id: TierSlice['id']; label: string; count: number }[] = TIER_KEYS.map((k) => ({
    id: k,
    label: TIER_NAME[k],
    count: Math.max(0, counts[k]),
  }));
  if (total > known) rows.push({ id: 'unknown', label: 'Tier unknown', count: total - known });
  const alloc = allocateCells(
    rows.map((r) => r.count),
    cells,
  );
  return {
    total,
    slices: rows.map((r, i) => ({
      ...r,
      share: total > 0 ? r.count / total : 0,
      cells: alloc[i] ?? 0,
    })),
  };
}

/** The waffle in words: `3,090 Cumulus nodes (46.6%), 1,517 Nimbus nodes (22.9%) and 2,031 Stratus nodes (30.6%)`. */
export function tierSummary(slices: readonly TierSlice[]): string {
  const parts = slices
    .filter((s) => s.count > 0)
    .map(
      (s) =>
        `${formatInt(s.count)} ${s.id === 'unknown' ? 'nodes of unknown tier' : `${s.label} nodes`} (${shareText(s.share)})`,
    );
  if (parts.length === 0) return 'No nodes counted yet';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

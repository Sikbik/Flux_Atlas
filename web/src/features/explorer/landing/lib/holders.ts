// The rich list as the landing shows it: the share of the supply held by the largest addresses, cut into the
// rank buckets the rich list page uses, laid out as a ring; and the top few addresses with what is known about
// them. Pure.

import type { RichListEntry } from '../../../../api/generated/RichListEntry';
import { fluxToNumber } from '../../../../lib/format';
import { polar, sectorPath } from '../../../wallet/lib/payoutDial';
import { type KnownEntity, knownEntity } from '../../lib/entities';
import { type Bucket, concentration } from '../../lib/richlist';

const TAU = Math.PI * 2;

/** The sequential blue of each rank bucket, the largest holders lightest; everyone else is a neutral track. */
const SLICE_COLOR: Record<string, string> = {
  'r1-1': 'var(--seq-6)',
  'r2-10': 'var(--seq-5)',
  'r11-100': 'var(--seq-4)',
  'r101-1000': 'var(--seq-3)',
  rest: 'var(--ink-3)',
};

export interface RingSlice {
  key: string;
  label: string;
  /** Percent of the supply. */
  share: number;
  holders: number;
  color: string;
  /** The slice's outline as a path in the ring's own coordinates. */
  d: string;
  /** Angles in radians clockwise from the top. */
  a0: number;
  a1: number;
}

export interface RingGeometry {
  size: number;
  /** Inner and outer radius of the ring. */
  r0: number;
  r1: number;
}

export const RING: RingGeometry = { size: 220, r0: 72, r1: 100 };

/** The gap between two slices, as an angle: a hairline of the surface colour. */
const GAP = 0.018;

/**
 * The buckets of the supply as a ring, clockwise from the top, the largest holder first. A slice keeps a hairline of
 * air on both sides, and a slice too thin to show (a bucket that holds almost nothing) is still drawn a sliver wide.
 */
export function ringSlices(buckets: readonly Bucket[], geo: RingGeometry = RING): RingSlice[] {
  const total = buckets.reduce((s, b) => s + b.share, 0);
  if (total <= 0) return [];
  const c = geo.size / 2;
  let at = 0;
  return buckets.map((b) => {
    const span = (b.share / total) * TAU;
    const a0 = at + GAP / 2;
    const a1 = Math.max(a0 + 0.012, at + span - GAP / 2);
    at += span;
    return {
      key: b.key,
      label: b.label,
      share: b.share,
      holders: b.holders,
      color: SLICE_COLOR[b.key] ?? 'var(--seq-3)',
      d: sectorPath(c, c, geo.r0, geo.r1, a0, a1),
      a0,
      a1,
    };
  });
}

/** The point at the middle of a slice's outer edge, for placing a label or a tooltip. */
export function sliceMid(
  s: Pick<RingSlice, 'a0' | 'a1'>,
  r: number,
  size = RING.size,
): { x: number; y: number } {
  return polar(size / 2, size / 2, r, (s.a0 + s.a1) / 2);
}

export interface Holder {
  rank: number;
  address: string;
  /** The balance as the server sent it. */
  balance: string;
  /** The balance as a number, for scaling and for a compact text (never for an exact figure). */
  flux: number;
  /** Percent of the supply. */
  share: number;
  nodes: number;
  entity: KnownEntity | null;
}

/** The first `n` addresses of the rank order, with what is known about each. */
export function topHolders(entries: readonly RichListEntry[], n: number): Holder[] {
  return [...entries]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, n)
    .map((e) => ({
      rank: e.rank,
      address: e.address,
      balance: e.balance,
      flux: fluxToNumber(e.balance) ?? 0,
      share: e.share_pct,
      nodes: e.node_count,
      entity: knownEntity(e.address),
    }));
}

export interface HolderGlance {
  /** Percent of the supply held by the largest ten. */
  top10: number;
  top100: number;
  /** The addresses ranked. */
  listed: number;
  buckets: Bucket[];
  slices: RingSlice[];
  top: Holder[];
}

/** Everything the rich list card draws, from the server's ranking. Null when there is no ranking. */
export function holderGlance(entries: readonly RichListEntry[], topN = 5): HolderGlance | null {
  if (entries.length === 0) return null;
  const c = concentration(entries);
  return {
    top10: c.top(10),
    top100: c.top(100),
    listed: c.listed,
    buckets: c.buckets,
    slices: ringSlices(c.buckets),
    top: topHolders(entries, topN),
  };
}

/** A sentence that reads the ring to a screen reader. */
export function ringSummary(g: HolderGlance): string {
  const parts = g.buckets.map((b) => {
    const who =
      b.from === null ? 'everyone else' : b.holders === 1 ? b.label : `${b.label} (${b.holders} addresses)`;
    return `${who} ${b.share.toFixed(1)} percent`;
  });
  return `Share of the supply by rank: ${parts.join(', ')}.`;
}

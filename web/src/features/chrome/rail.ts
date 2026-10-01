// The block rail's logic (design 8.14, 6.4, 6.5), kept pure: what a block was made of, how a new set of
// blocks differs from the one on screen (which arrived, which were orphaned by a reorg), and how long an
// orphaned card lingers. The component binds it to the store and animates the differences.

import type { PayoutDto } from '../../api/generated/PayoutDto';

/** The fields of a chain block the rail reads (a subset of the store's ChainBlock). */
export interface BlockLike {
  height: number;
  hash: string;
  txCount: number;
  confirmCount: number;
  startCount: number;
  transferCount: number;
}

export type MixKey = 'confirms' | 'starts' | 'transfers' | 'other';

export interface TxMix {
  confirms: number;
  starts: number;
  /** Transfers over the large-transfer threshold (the server reports only those). */
  transfers: number;
  /** Everything else in the block: the coinbase, small transfers, app messages. */
  other: number;
  total: number;
}

/**
 * What a block's transactions were. The server counts confirmations, starts and large transfers; the
 * remainder is "other" (it holds the coinbase and the app payments, which it does not break out yet).
 */
export function txMix(b: BlockLike): TxMix {
  const confirms = Math.max(0, b.confirmCount);
  const starts = Math.max(0, b.startCount);
  const transfers = Math.max(0, b.transferCount);
  const total = Math.max(0, b.txCount);
  return { confirms, starts, transfers, other: Math.max(0, total - confirms - starts - transfers), total };
}

export interface MixSegment {
  key: MixKey;
  n: number;
  /** 0..1 share of the bar; non-empty segments never vanish (a floor of 4 percent). */
  frac: number;
}

const MIX_ORDER: readonly MixKey[] = ['confirms', 'starts', 'transfers', 'other'];
const MIN_FRAC = 0.04;

/** The mix as bar segments in a fixed order, empty ones dropped. */
export function mixSegments(m: TxMix): MixSegment[] {
  const sum = m.confirms + m.starts + m.transfers + m.other;
  if (sum === 0) return [];
  const raw = MIX_ORDER.map((key) => ({ key, n: m[key], frac: m[key] / sum })).filter((s) => s.n > 0);
  // Lift tiny segments to the floor and take the difference from the largest, so the bar still sums to 1.
  let extra = 0;
  for (const s of raw) {
    if (s.frac < MIN_FRAC) {
      extra += MIN_FRAC - s.frac;
      s.frac = MIN_FRAC;
    }
  }
  const largest = raw.reduce((a, b) => (b.frac > a.frac ? b : a), raw[0]!);
  largest.frac -= extra;
  return raw;
}

/** How one tier's reward reads in the card's strip: shares of the 14 FLUX coinbase (design 8.14). */
export const STRIP_SHARES = [
  { key: 'cumulus', share: 1 / 14 },
  { key: 'nimbus', share: 3.5 / 14 },
  { key: 'stratus', share: 9 / 14 },
  { key: 'dev', share: 0.5 / 14 },
] as const;

/** Payees in reading order, Stratus first, one per tier. */
export function payeesByTier(payouts: readonly PayoutDto[]): PayoutDto[] {
  const order = ['stratus', 'nimbus', 'cumulus'];
  return [...payouts]
    .filter((p) => order.includes(p.tier))
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

// ---- reconciling what is on screen with what the store holds --------------------------------------

/** How long an orphaned card stays on the rail, marked, before it leaves. */
export const TOMB_MS = 4_000;

export interface Tomb<T extends BlockLike = BlockLike> {
  block: T;
  /** Local ms when it was orphaned. */
  at: number;
}

/**
 * Orphaned blocks to keep showing: blocks that were on screen, are still within the window of the new
 * set, and are no longer in it by hash (a reorg removed or replaced them). Blocks that merely aged out
 * of the ring are not orphans. Expired tombstones drop.
 */
export function nextTombs<T extends BlockLike>(
  prev: readonly T[],
  next: readonly T[],
  tombs: readonly Tomb<T>[],
  now: number,
): Tomb<T>[] {
  if (next.length === 0) return tombs.filter((t) => now - t.at < TOMB_MS);
  const oldest = next[next.length - 1]!.height;
  const have = new Set(next.map((b) => b.hash));
  const out = tombs.filter((t) => now - t.at < TOMB_MS && !have.has(t.block.hash));
  for (const p of prev) {
    if (p.height < oldest || have.has(p.hash)) continue;
    if (out.some((t) => t.block.hash === p.hash)) continue;
    out.push({ block: p, at: now });
  }
  return out;
}

/**
 * The cards that appeared since the previous render, when that is one or two (a live block landing, or a
 * reorg replacing one). The first fill and a whole resync arriving at once animate nothing.
 */
export function freshKeys(prev: ReadonlySet<string> | null, next: readonly string[]): Set<string> {
  if (!prev || prev.size === 0) return new Set();
  const fresh = next.filter((k) => !prev.has(k));
  return fresh.length > 0 && fresh.length <= 2 ? new Set(fresh) : new Set();
}

/**
 * The cards to draw, newest first: live blocks, with orphaned ones kept just after the live block of
 * the same height (or in height order when that height has no live block).
 */
export function withTombs<T extends BlockLike>(
  live: readonly T[],
  tombs: readonly Tomb<T>[],
): { block: T; orphan: boolean }[] {
  const out = live.map((block) => ({ block, orphan: false }));
  for (const t of tombs) {
    let i = out.findIndex((c) => c.block.height <= t.block.height);
    if (i < 0) i = out.length;
    // After the live block of the same height, before older ones.
    while (i < out.length && out[i]!.block.height === t.block.height && !out[i]!.orphan) i++;
    out.splice(i, 0, { block: t.block, orphan: true });
  }
  return out;
}

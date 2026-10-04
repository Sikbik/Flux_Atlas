// The block tape: the newest blocks as a row of bars, oldest to newest, each as tall as its transactions and cut
// into the same kinds the rail's mix bar uses (node confirmations, node starts, transfers, the rest). Gaps between
// blocks and a late block show up as the spacing and the colour of the bar. Pure.

import type { ChainBlock } from '../../../../store/network';
import { type MixSegment, mixSegments, txMix } from '../../../chrome/rail';
import { BLOCK_SECONDS } from '../../lib/emission';

/** A block that comes this long after the one before it is late (a half again longer than the 30 s target). */
export const LATE_AFTER_S = BLOCK_SECONDS * 1.5;

/** The tallest a bar can be even when every block is light: so a quiet stretch reads as quiet, not as full. */
export const MIN_SCALE_TX = 24;

export interface TapeBar {
  height: number;
  hash: string;
  timeMs: number;
  txCount: number;
  size: number;
  /** Seconds after the block before it, when that one is in the tape and consecutive; else null. */
  gapS: number | null;
  late: boolean;
  /** The bar's height against the tallest, 0 to 1. */
  frac: number;
  segments: MixSegment[];
  confirms: number;
  starts: number;
  transfers: number;
  other: number;
}

/**
 * The newest `count` blocks of a newest-first list as bars, oldest first. A bar's height is its transaction count
 * against the busiest block shown (never less than `MIN_SCALE_TX`), so the whole row keeps one scale.
 */
export function tapeBars(newestFirst: readonly ChainBlock[], count: number): TapeBar[] {
  const take = newestFirst.slice(0, Math.max(0, count));
  const ordered = [...take].reverse();
  const scale = Math.max(MIN_SCALE_TX, ...ordered.map((b) => b.txCount));
  return ordered.map((b, i) => {
    const prev = ordered[i - 1];
    const gapS = prev && prev.height + 1 === b.height ? (b.timeMs - prev.timeMs) / 1000 : null;
    const mix = txMix(b);
    return {
      height: b.height,
      hash: b.hash,
      timeMs: b.timeMs,
      txCount: b.txCount,
      size: b.size,
      gapS: gapS !== null && gapS >= 0 ? gapS : null,
      late: gapS !== null && gapS > LATE_AFTER_S,
      frac: Math.max(0.04, b.txCount / scale),
      segments: mixSegments(mix),
      confirms: mix.confirms,
      starts: mix.starts,
      transfers: mix.transfers,
      other: mix.other,
    };
  });
}

/** How many bars fit a row of `width` px: about 9 px each, between 20 and 60. */
export function tapeCount(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 40;
  return Math.max(20, Math.min(60, Math.floor(width / 9)));
}

/** The words for a bar, for its tooltip and a screen reader. */
export function barText(b: TapeBar, now: number): string {
  const age = Math.max(0, Math.round((now - b.timeMs) / 1000));
  const ago = age < 90 ? `${age} s ago` : `${Math.round(age / 60)} min ago`;
  const parts = [`Block ${b.height.toLocaleString('en-US')}`, ago];
  parts.push(`${b.txCount} ${b.txCount === 1 ? 'transaction' : 'transactions'}`);
  if (b.gapS !== null) parts.push(`${Math.round(b.gapS)} s after the one before${b.late ? ', late' : ''}`);
  return parts.join(', ');
}

/** One sentence for the whole tape: how many blocks, how steady, how busy. */
export function tapeSummary(bars: readonly TapeBar[]): string {
  if (bars.length === 0) return 'No blocks yet.';
  const gaps = bars.map((b) => b.gapS).filter((g): g is number => g !== null);
  const txs = bars.reduce((s, b) => s + b.txCount, 0);
  const late = bars.filter((b) => b.late).length;
  const pace =
    gaps.length === 0
      ? ''
      : ` Blocks came ${(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(1)} seconds apart on average${late > 0 ? `, ${late} of them late` : ''}.`;
  return `The last ${bars.length} blocks carried ${txs.toLocaleString('en-US')} transactions.${pace}`;
}

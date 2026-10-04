// The block tape: the newest blocks as a row of bars, oldest to newest, each as tall as its transactions and cut
// into the same kinds the rail's mix bar uses (node confirmations, node starts, transfers, the rest). Gaps between
// blocks and a late block show up as the spacing and the colour of the bar. Pure.

import type { BlockLite } from '../../../../api/generated/BlockLite';
import { type ChainBlock, fromBlockLite } from '../../../../store/network';
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

/**
 * The live ring (newest first) with the older blocks a server list adds below it, newest first. The ring wins where
 * the two overlap, a block is never repeated, and a list that adds nothing hands the ring back as it is (same array,
 * so nothing downstream redraws).
 */
export function mergeTapeBlocks(
  live: readonly ChainBlock[],
  history: readonly BlockLite[] | undefined,
): readonly ChainBlock[] {
  if (!history || history.length === 0) return live;
  const have = new Set(live.map((b) => b.height));
  const oldest = live.length > 0 ? (live[live.length - 1] as ChainBlock).height : Number.POSITIVE_INFINITY;
  const older = history
    .filter((b) => b.height < oldest && !have.has(b.height))
    .sort((a, b) => b.height - a.height)
    .map(fromBlockLite);
  return older.length === 0 ? live : [...live, ...older];
}

/** The most bars a tape draws: the live ring holds this many blocks (about fifty minutes). */
export const TAPE_MAX_BARS = 100;

/** How many bars fit a row of `width` px: about 9 px each, between 20 and `TAPE_MAX_BARS`. */
export function tapeCount(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 40;
  return Math.max(20, Math.min(TAPE_MAX_BARS, Math.floor(width / 9)));
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

export interface TapeFacts {
  blocks: number;
  txs: number;
  /** The mean seconds between neighbours in the tape, or null when no two are consecutive. */
  avgGapS: number | null;
  late: number;
  /** The most transactions in one block of the tape. */
  busiest: number;
  /** Where the tape starts and ends (unix ms), or null for an empty one. */
  fromMs: number | null;
  toMs: number | null;
}

/** The figures a tape is read by. */
export function tapeFacts(bars: readonly TapeBar[]): TapeFacts {
  const gaps = bars.map((b) => b.gapS).filter((g): g is number => g !== null);
  return {
    blocks: bars.length,
    txs: bars.reduce((s, b) => s + b.txCount, 0),
    avgGapS: gaps.length === 0 ? null : gaps.reduce((s, g) => s + g, 0) / gaps.length,
    late: bars.filter((b) => b.late).length,
    busiest: bars.reduce((m, b) => Math.max(m, b.txCount), 0),
    fromMs: bars[0]?.timeMs ?? null,
    toMs: bars[bars.length - 1]?.timeMs ?? null,
  };
}

/** One sentence for the whole tape: how many blocks, how steady, how busy. */
export function tapeSummary(bars: readonly TapeBar[]): string {
  if (bars.length === 0) return 'No blocks yet.';
  const f = tapeFacts(bars);
  const pace =
    f.avgGapS === null
      ? ''
      : ` Blocks came ${f.avgGapS.toFixed(1)} seconds apart on average${f.late > 0 ? `, ${f.late} of them late` : ''}.`;
  return `The last ${f.blocks} blocks carried ${f.txs.toLocaleString('en-US')} transactions.${pace}`;
}

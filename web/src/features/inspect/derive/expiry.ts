// Node lifecycle arithmetic (design 4.5, ARCHITECTURE 3.2 "Expiry watch"): a node re-confirms about
// every 500 blocks (confirms are accepted from block 500 after the last one), is at risk from 560
// blocks without a check-in, and expires at 640. A start transaction that is never confirmed expires
// after 240 blocks.

import { BLOCK_MS } from '../../../lib/format';

export const CHECKIN = {
  /** Blocks after which a re-confirmation is accepted (and expected). */
  due: 500,
  /** Blocks without a check-in from which a node is at risk of expiry. */
  atRisk: 560,
  /** Blocks without a check-in at which a node expires. */
  expire: 640,
} as const;

/** Blocks a start transaction waits for its confirmation before it expires. */
export const START_EXPIRY_BLOCKS = 240;

export type ExpiryState = 'unknown' | 'healthy' | 'due' | 'atRisk' | 'expired';

/** Blocks since the last check-in, or null when either height is unknown (0 means unknown). */
export function blocksSinceConfirm(
  tip: number | null | undefined,
  lastConfirmed: number | null | undefined,
): number | null {
  if (!tip || !lastConfirmed || lastConfirmed <= 0) return null;
  return Math.max(0, tip - lastConfirmed);
}

export function expiryState(since: number | null): ExpiryState {
  if (since === null) return 'unknown';
  if (since >= CHECKIN.expire) return 'expired';
  if (since >= CHECKIN.atRisk) return 'atRisk';
  if (since >= CHECKIN.due) return 'due';
  return 'healthy';
}

/** True for nodes that should raise an at-risk alert (560 or more blocks without a check-in). */
export const isAtRisk = (since: number | null): boolean => since !== null && since >= CHECKIN.atRisk;

export interface CheckinGauge {
  since: number | null;
  state: ExpiryState;
  /** 0..1 position of the marker on the 0 to 640 track (clamped). */
  fraction: number;
  /** Blocks until the next check-in is accepted (0 once due), null when unknown. */
  blocksToDue: number | null;
  blocksToRisk: number | null;
  blocksToExpiry: number | null;
  /** Milliseconds until the node would expire if no check-in arrives. */
  msToExpiry: number | null;
}

export function checkinGauge(since: number | null, blockMs = BLOCK_MS): CheckinGauge {
  if (since === null) {
    return {
      since,
      state: 'unknown',
      fraction: 0,
      blocksToDue: null,
      blocksToRisk: null,
      blocksToExpiry: null,
      msToExpiry: null,
    };
  }
  const toExpiry = Math.max(0, CHECKIN.expire - since);
  return {
    since,
    state: expiryState(since),
    fraction: Math.min(1, since / CHECKIN.expire),
    blocksToDue: Math.max(0, CHECKIN.due - since),
    blocksToRisk: Math.max(0, CHECKIN.atRisk - since),
    blocksToExpiry: toExpiry,
    msToExpiry: toExpiry * blockMs,
  };
}

/** Blocks left before a started (unconfirmed) node's start transaction expires. */
export function startBlocksLeft(
  tip: number | null | undefined,
  startedHeight: number | null | undefined,
): number | null {
  if (!tip || !startedHeight) return null;
  return Math.max(0, START_EXPIRY_BLOCKS - Math.max(0, tip - startedHeight));
}

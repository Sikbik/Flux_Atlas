// Live chain position for explorer views: the tip from the store and confirmations derived from it,
// so a block or transaction page counts up without a refetch.

import { useNetwork } from '../../../app/context';

/** Confirmations after which a block or transaction is treated as immutable (PoN finality depth). */
export const FINAL_DEPTH = 10;

export function useTipHeight(): number | null {
  return useNetwork((s) => s.tip?.height ?? null);
}

/** Time the tip was mined (header time), for countdowns toward the next block. */
export function useTipTime(): number | null {
  return useNetwork((s) => s.tip?.time_ms ?? null);
}

/**
 * Confirmations of something mined at `height`, from the live tip. Falls back to the server's figure
 * when the store has no tip yet or the server is a block ahead of the socket.
 */
export function liveConfirmations(
  tipHeight: number | null,
  height: number | null | undefined,
  fetched: number,
): number {
  if (height === null || height === undefined) return 0;
  if (tipHeight !== null && tipHeight >= height) return Math.max(fetched, tipHeight - height + 1);
  return fetched;
}

export const isFinal = (confirmations: number): boolean => confirmations >= FINAL_DEPTH;

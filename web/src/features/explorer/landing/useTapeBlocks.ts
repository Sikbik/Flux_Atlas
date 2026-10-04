// The blocks the tape draws. The page starts with the 30 newest blocks (the bootstrap carries that many) and the live
// ring grows by one every 30 seconds, so a tape built on it alone would be half empty for the first quarter of an
// hour. The server's block list fills in the older ones, once, when the landing opens; the live blocks always win where
// the two overlap. If that request fails the tape is simply as long as the blocks the page holds.

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queries } from '../../../api/queries';
import { useChainBlocks } from '../../../app/context';
import type { ChainBlock } from '../../../store/network';
import { mergeTapeBlocks } from './lib/tape';

/** How many of the newest blocks the history asks for. */
export const TAPE_HISTORY = 64;

export interface TapeBlocks {
  /** Newest first. */
  blocks: readonly ChainBlock[];
  /** The live blocks are in and the history has answered (or failed): the tape can be drawn once, whole. */
  ready: boolean;
}

export function useTapeBlocks(): TapeBlocks {
  const live = useChainBlocks();
  // A tape is decoration: when the history cannot be had it is not asked again, and nothing says it failed.
  const history = useInfiniteQuery({ ...queries.blocks({ limit: TAPE_HISTORY }), retry: false });
  const first = history.data?.pages[0]?.items;
  const blocks = useMemo(() => mergeTapeBlocks(live, first), [live, first]);
  return { blocks, ready: live.length > 0 && !history.isPending };
}

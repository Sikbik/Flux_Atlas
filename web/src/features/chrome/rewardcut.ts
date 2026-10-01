// The reward-cut countdown (design 4.6): the first 10 percent cut lands at block 3,071,200 and takes the
// 14 FLUX subsidy to 12.6, split Stratus 9.0 to 8.1, Nimbus 3.5 to 3.15, Cumulus 1.0 to 0.9 and the dev
// fund 0.5 to 0.45. Blocks left and the time to the cut come from the tip and the 30 s cadence (an
// estimate, so it is labelled one wherever it is shown). Pure.

import { BLOCK_MS, heightEta } from '../../lib/format';

/** The first reduction height (also what the server reports as `next_reduction_height`). */
export const FIRST_CUT_HEIGHT = 3_071_200;
/** Height at which Proof of Node began; the progress bar of the cut card runs from here. */
export const POUW_START_HEIGHT = 2_020_000;
/** The fraction of every output that remains after a cut. */
export const CUT_KEEP = 0.9;

/** Each output's share of the subsidy: 1.0, 3.5, 9.0 and 0.5 of 14. */
export const REWARD_SHARES = { cumulus: 1, nimbus: 3.5, stratus: 9, dev: 0.5 } as const;
const SHARE_TOTAL = 14;

export interface Split {
  cumulus: number;
  nimbus: number;
  stratus: number;
  dev: number;
  total: number;
}

/** The coinbase split of a subsidy (in FLUX). */
export function splitReward(total: number): Split {
  const k = total / SHARE_TOTAL;
  return {
    cumulus: REWARD_SHARES.cumulus * k,
    nimbus: REWARD_SHARES.nimbus * k,
    stratus: REWARD_SHARES.stratus * k,
    dev: REWARD_SHARES.dev * k,
    total,
  };
}

export interface RewardCutView {
  height: number;
  /** Blocks from the tip to the cut (0 when it has landed). */
  blocksLeft: number;
  /** Estimated ms until the cut block, from the tip's time and the 30 s cadence. */
  etaMs: number;
  /** Estimated unix ms of the cut block. */
  atMs: number;
  before: Split;
  after: Split;
  /** 0..1 progress from the start of Proof of Node to the cut. */
  progress: number;
  landed: boolean;
}

export function rewardCutView(
  nextHeight: number | null,
  tip: { height: number; timeMs: number } | null,
  nowMs: number,
  subsidy: number | null,
): RewardCutView | null {
  if (nextHeight === null || tip === null) return null;
  const eta = heightEta(nextHeight, tip, nowMs, BLOCK_MS);
  const total = subsidy ?? 14;
  const before = splitReward(total);
  const after = splitReward(total * CUT_KEEP);
  const span = nextHeight - POUW_START_HEIGHT;
  const progress = span > 0 ? Math.min(1, Math.max(0, (tip.height - POUW_START_HEIGHT) / span)) : 1;
  return {
    height: nextHeight,
    blocksLeft: Math.max(0, eta.blocks),
    etaMs: Math.max(0, eta.etaMs),
    atMs: eta.atMs,
    before,
    after,
    progress,
    landed: eta.blocks <= 0,
  };
}

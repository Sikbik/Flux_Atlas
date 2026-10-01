// Hooks that bind the chrome's pure logic to the live store and the shared clock. Each re-renders at
// most once a second (the clock's tick) or when the data it reads changes; none polls anything.

import { useCallback, useEffect, useState } from 'react';
import { useNetwork, useNextPayees, useRuntime, useSummary, useTip } from '../../app/context';
import { fluxToNumber } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { nextPayoutLines, type PayoutLine } from './payouts';
import { type RewardCutView, rewardCutView } from './rewardcut';

/** How long the previous payees stay on the aim strip after a block: until the last beam has landed. */
export const AIM_HOLD_MS = 2_600;

/** The city of a node by id, from the node table (null when the node or its place is unknown). */
export function useCityOf(): (node: number) => string | null {
  const { store } = useRuntime();
  return useCallback(
    (node: number) => {
      const i = store.nodes.indexOf(node);
      if (i < 0) return null;
      const city = store.nodes.locations.info(store.nodes.loc[i] ?? 0)?.city;
      return city ? city : null;
    },
    [store],
  );
}

/** The subsidy in FLUX (14 until the summary says otherwise). */
export function useSubsidy(): number {
  const s = useSummary();
  return fluxToNumber(s?.reward) ?? 14;
}

/**
 * The next payee of each tier, as the aim strip shows them: a new set replaces the old one 2.6 s after
 * the block it follows, so the strip never swaps ahead of the relay on the globe.
 */
export function usePayoutLines(): PayoutLine[] {
  const { clock, store } = useRuntime();
  const next = useNextPayees();
  const tip = useTip();
  const cityOf = useCityOf();
  const subsidy = useSubsidy();
  const now = useNow(clock);
  const [shown, setShown] = useState(next);

  useEffect(() => {
    if (!next) return;
    const blockAt = store.lastMessageMs.get('block') ?? 0;
    const wait = Math.min(AIM_HOLD_MS, Math.max(0, blockAt + AIM_HOLD_MS - clock.now()));
    if (wait === 0) {
      setShown(next);
      return;
    }
    const t = setTimeout(() => setShown(next), wait);
    return () => clearTimeout(t);
  }, [next, store, clock]);

  return nextPayoutLines(
    shown,
    tip ? { height: tip.height, timeMs: tip.time_ms } : null,
    now,
    subsidy,
    cityOf,
  );
}

/** The reward-cut countdown, or null until the summary and the tip are known. */
export function useRewardCut(): RewardCutView | null {
  const { clock } = useRuntime();
  const summary = useSummary();
  const tip = useTip();
  const now = useNow(clock);
  const reduction = summary?.next_reduction_height ?? null;
  return rewardCutView(
    reduction,
    tip ? { height: tip.height, timeMs: tip.time_ms } : null,
    now,
    fluxToNumber(summary?.reward) ?? null,
  );
}

/** Whether the store holds the first snapshot. */
export const useLoaded = (): boolean => useNetwork((s) => s.loaded);

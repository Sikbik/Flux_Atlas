// Hooks that bind the chrome's pure logic to the live store and the shared clock. Each re-renders at
// most once a second (the clock's tick) or when the data it reads changes; none polls anything.

import { useCallback, useEffect, useState } from 'react';
import type { Tier } from '../../api/generated/Tier';
import { useNetwork, useNextPayees, useRuntime, useSummary, useTip } from '../../app/context';
import { fluxToNumber } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { tierOf } from './glyphs';
import { nextPayoutLines, type PayoutLine } from './payouts';
import { placeOfRow } from './places';
import { type RewardCutView, rewardCutView } from './rewardcut';

/** How long the previous payees stay on the aim strip after a block: until the last beam has landed. */
export const AIM_HOLD_MS = 2_600;

/** The place of a node by id: its city, or its country when the data has no city (null when unknown). */
export function usePlaceOf(): (node: number) => string | null {
  const { store } = useRuntime();
  return useCallback(
    (node: number) => {
      const i = store.nodes.indexOf(node);
      return i < 0 ? null : placeOfRow(store, i);
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
  const placeOf = usePlaceOf();
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
    placeOf,
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

/** The route key of a node (its endpoint, `ip:port`), or null when it is unknown. */
export function useNodeKey(): (node: number | null) => string | null {
  const { store } = useRuntime();
  return useCallback(
    (node: number | null) => {
      if (node === null) return null;
      const i = store.nodes.indexOf(node);
      if (i < 0) return null;
      const ep = store.nodes.endpoint(i);
      return ep || null;
    },
    [store],
  );
}

export interface NodeFacts {
  tier: Tier;
  /** `ip:port` as the node table holds it (the route key of the node's window), or null. */
  endpoint: string | null;
  /** The address without the port. */
  ip: string | null;
  /** City, or country when the data has no city; null when neither is known. */
  place: string | null;
}

/** Looks up what the node table knows about a node (null when the node is not in it). */
export function useNodeFacts(): (node: number | null) => NodeFacts | null {
  const { store } = useRuntime();
  return useCallback(
    (node: number | null) => {
      if (node === null) return null;
      const i = store.nodes.indexOf(node);
      if (i < 0) return null;
      const ep = store.nodes.endpoint(i) || null;
      return {
        tier: tierOf(store.nodes.tier[i]),
        endpoint: ep,
        ip: ep ? (ep.split(':')[0] ?? null) : null,
        place: placeOfRow(store, i),
      };
    },
    [store],
  );
}

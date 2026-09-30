// React access to the live runtime. Components read the NetworkStore through selectors and the
// event clock through the hooks in lib/useClock.ts.

import { createContext, type ReactNode, useContext } from 'react';
import type { NetworkStore } from '../store/network';
import { type Equality, useStoreSelector } from '../store/react';
import type { AtlasRuntime } from './runtime';

const RuntimeContext = createContext<AtlasRuntime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: AtlasRuntime; children: ReactNode }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): AtlasRuntime {
  const r = useContext(RuntimeContext);
  if (!r) throw new Error('useRuntime must be used inside RuntimeProvider');
  return r;
}

/** Selects from the NetworkStore; re-renders only when the selection changes. */
export function useNetwork<T>(selector: (s: NetworkStore) => T, equal?: Equality<T>): T {
  return useStoreSelector(useRuntime().store, selector, equal);
}

// Common selections.
export const useConnection = () => useNetwork((s) => s.connection);
export const useTip = () => useNetwork((s) => s.tip);
export const useChainBlocks = () => useNetwork((s) => s.blocks.toArray());
export const useFeed = () => useNetwork((s) => s.feed.toArray());
export const useSummary = () => useNetwork((s) => s.summary);
export const useNextPayees = () => useNetwork((s) => s.nextPayees);
export const usePendingApps = () => useNetwork((s) => s.pendingList());
export const useMempoolEntries = () => useNetwork((s) => s.mempoolList());
export const usePrice = () => useNetwork((s) => s.price);

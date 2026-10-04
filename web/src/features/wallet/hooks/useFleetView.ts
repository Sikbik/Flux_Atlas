// What the Fleet tab is showing: the filters and the sort. Kept for the session, per wallet, so a visit to Health and
// back finds the table as it was left; never stored in the browser (a filter is a question, not a preference), and a
// different wallet starts clean. The columns, density and grouping are preferences and live in `prefs.ts`.

import { useCallback } from 'react';
import { create } from 'zustand';
import type { SortState } from '../../../ui';
import { DEFAULT_SORT, type FleetFilter, NO_FILTER } from '../lib/fleet';

export interface FleetView {
  filter: FleetFilter;
  sort: SortState | null;
}

const FRESH: FleetView = { filter: NO_FILTER, sort: DEFAULT_SORT };

interface Views {
  views: Record<string, FleetView>;
  patch: (addr: string, change: Partial<FleetView>) => void;
}

/** The most wallets remembered in one session; the oldest are forgotten first. */
const KEEP = 8;

const useViews = create<Views>()((set) => ({
  views: {},
  patch: (addr, change) =>
    set((s) => {
      const next = { ...s.views, [addr]: { ...(s.views[addr] ?? FRESH), ...change } };
      const keys = Object.keys(next);
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete next[k];
      return { views: next };
    }),
}));

export interface FleetViewApi extends FleetView {
  /** Changes some of the filters; the rest stay. */
  filterBy: (patch: Partial<FleetFilter>) => void;
  clearFilters: () => void;
  setSort: (sort: SortState | null) => void;
}

export function useFleetView(addr: string): FleetViewApi {
  const view = useViews((s) => s.views[addr]) ?? FRESH;
  const filterBy = useCallback(
    (patch: Partial<FleetFilter>) => {
      const cur = useViews.getState().views[addr] ?? FRESH;
      useViews.getState().patch(addr, { filter: { ...cur.filter, ...patch } });
    },
    [addr],
  );
  const clearFilters = useCallback(() => useViews.getState().patch(addr, { filter: NO_FILTER }), [addr]);
  const setSort = useCallback((sort: SortState | null) => useViews.getState().patch(addr, { sort }), [addr]);
  return { ...view, filterBy, clearFilters, setSort };
}

/** Narrows the fleet table to what the caller names (the Health tab uses it to say "these nodes"). */
export function showInFleet(addr: string, filter: Partial<FleetFilter>): void {
  useViews.getState().patch(addr, { filter: { ...NO_FILTER, ...filter } });
}

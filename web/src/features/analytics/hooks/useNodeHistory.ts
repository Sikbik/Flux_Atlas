// Node counts over time: the server's history (a 30 day backfill, then its own samples) with the live
// tier counts appended as the right edge, so the chart follows the stream between samples.

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { queries } from '../../../api/queries';
import { useRuntime, useSummary } from '../../../app/context';
import {
  bridgeGaps,
  frameFromDto,
  type MetricFrame,
  RANGES,
  type Range,
  rangeWindow,
  trimEmpty,
  withLiveTail,
} from '../lib/metrics';

export const TIER_SERIES = ['stratus', 'nimbus', 'cumulus'] as const;
const SERIES = ['node_count', 'cumulus', 'nimbus', 'stratus'] as const;

/** The index of the current step, re-rendering only when it changes (not every second). */
export function useBoundary(stepMs: number): number {
  const { clock } = useRuntime();
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => Math.floor(clock.tickTime / stepMs);
  return useSyncExternalStore(subscribe, get, get);
}

export interface NodeHistory {
  frame: MetricFrame | null;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
  /** When the server's last sample in this frame was taken (unix ms), if known. */
  sampledMs: number | null;
}

export function useNodeHistory(range: Range): NodeHistory {
  const { clock } = useRuntime();
  const summary = useSummary();
  const step = RANGES[range].stepMs;
  const boundary = useBoundary(step);
  const win = useMemo(() => rangeWindow(range, boundary * step), [range, boundary, step]);
  const q = useQuery(queries.metrics({ series: SERIES, from: win.from, to: win.to, step: win.step }));
  const frame = useMemo(() => {
    if (!q.data) return null;
    const base = trimEmpty(bridgeGaps(frameFromDto(q.data), SERIES), SERIES);
    if (!summary) return base;
    return withLiveTail(base, clock.now(), {
      node_count: summary.tiers.total,
      cumulus: summary.tiers.cumulus,
      nimbus: summary.tiers.nimbus,
      stratus: summary.tiers.stratus,
    });
  }, [q.data, summary, clock]);
  return {
    frame,
    isPending: q.isPending,
    isFetching: q.isFetching,
    isError: q.isError,
    refetch: () => void q.refetch(),
    sampledMs: q.dataUpdatedAt || null,
  };
}

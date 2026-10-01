// The curve under the scrubber: confirmed nodes (and the chain tip beside them) from the server's
// recorded history, with the live count appended as the right edge so the curve follows the stream
// between the server's samples. The history is not something the stream delivers, so it is fetched
// once per step boundary, not polled every second.

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queries } from '../../../api/queries';
import { useSummary, useTip } from '../../../app/context';
import { bridgeGaps, frameFromDto, withLiveTail } from '../../analytics/lib/metrics';
import { buildCurve, type Curve } from '../lib/curve';
import { stepFor } from '../lib/time';

const SERIES = ['node_count', 'tip_height'] as const;

export interface HistoryCurve {
  curve: Curve | null;
  /** The history is still arriving for the first time. */
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * `firstMs` is the start of the recorded history (null before the server has recorded anything) and
 * `nowMs` the server's time, which only has to be right to the second.
 */
export function useHistoryCurve(firstMs: number | null, nowMs: number): HistoryCurve {
  const summary = useSummary();
  const tip = useTip();
  const step = stepFor(firstMs === null ? 0 : nowMs - firstMs);
  const boundary = Math.floor(nowMs / step.ms);
  const window = useMemo(
    () =>
      firstMs === null
        ? null
        : { from: Math.floor(firstMs / step.ms) * step.ms, to: (boundary + 1) * step.ms, step: step.param },
    [firstMs, step.ms, step.param, boundary],
  );
  const q = useQuery({
    ...queries.metrics({ series: SERIES, from: window?.from, to: window?.to, step: window?.step }),
    enabled: window !== null,
  });
  const liveNodes = summary?.tiers.total ?? null;
  const liveTip = tip?.height ?? null;
  const curve = useMemo(() => {
    if (!q.data) return null;
    let frame = bridgeGaps(frameFromDto(q.data), SERIES, 2);
    if (liveNodes !== null)
      frame = withLiveTail(frame, nowMs, { node_count: liveNodes, tip_height: liveTip });
    return buildCurve({
      t: frame.t,
      nodes: frame.v.node_count ?? [],
      tip: frame.v.tip_height ?? [],
    });
    // The live tail follows the second; the rest of the frame only changes with the query.
  }, [q.data, liveNodes, liveTip, nowMs]);
  return {
    curve,
    isPending: q.isPending && window !== null,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

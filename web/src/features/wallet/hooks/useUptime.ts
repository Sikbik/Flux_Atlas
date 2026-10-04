// How reliably the fleet's nodes stayed up, measured on a sample. The wallet itself carries no uptime, and a node's
// uptime is its own request (the last seven days of its status), so a thousand-node wallet is measured on an even
// sample of its nodes, asked in small waves so the server is never hit with a burst and the histogram fills in as the
// answers arrive. Only the Health tab asks, and only while it is open.

import { type UseQueryResult, useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeHistoryDto } from '../../../api/generated/NodeHistoryDto';
import { queries } from '../../../api/queries';
import { evenSample } from '../lib/health';

/** Nodes measured at most: each is one small request. */
export const UPTIME_SAMPLE = 48;
/** Requests asked at a time. */
export const UPTIME_WAVE = 8;

export interface UptimeNode {
  key: string;
  /** Share of the window's known time the node was confirmed, 0..100. */
  pct: number;
}

export interface UptimeSample {
  /** Nodes in the sample. */
  asked: number;
  /** Nodes answered, successfully or not. */
  settled: number;
  failed: number;
  /** Answers with a figure; a node with no observed time has none. */
  nodes: UptimeNode[];
  /** The sample is complete: every node has answered. */
  done: boolean;
  /** Asks the failed nodes again. */
  retry: () => void;
}

interface Folded {
  settled: number;
  failed: number;
  nodes: UptimeNode[];
  retry: () => void;
}

export function useUptimeSample(keys: readonly string[]): UptimeSample {
  const sample = useMemo(() => evenSample(keys, UPTIME_SAMPLE), [keys]);
  const [wave, setWave] = useState(1);

  const combine = useCallback(
    (rs: UseQueryResult<NodeHistoryDto>[]): Folded => {
      const nodes: UptimeNode[] = [];
      let settled = 0;
      let failed = 0;
      rs.forEach((r, i) => {
        if (r.isError) {
          settled++;
          failed++;
        } else if (r.isSuccess) {
          settled++;
          const pct = r.data.uptime_pct;
          const key = sample[i];
          if (pct !== null && Number.isFinite(pct) && key !== undefined) nodes.push({ key, pct });
        }
      });
      return {
        settled,
        failed,
        nodes,
        retry: () => {
          for (const r of rs) if (r.isError) void r.refetch();
        },
      };
    },
    [sample],
  );

  const out = useQueries({
    queries: sample.map((key, i) => ({
      ...queries.nodeHistory(key),
      enabled: i < wave * UPTIME_WAVE,
      retry: 1,
    })),
    combine,
  });

  // The next wave goes out when the one in flight has answered.
  const asking = Math.min(sample.length, wave * UPTIME_WAVE);
  useEffect(() => {
    if (asking < sample.length && out.settled >= asking) setWave((w) => w + 1);
  }, [asking, sample.length, out.settled]);

  return {
    asked: sample.length,
    settled: out.settled,
    failed: out.failed,
    nodes: out.nodes,
    done: out.settled >= sample.length,
    retry: out.retry,
  };
}

// Net change in node counts per time bucket, from the server's sampled history. The history records
// how many nodes there were, not who joined or left, so a node that leaves and another that joins in
// the same bucket cancel out: the bars are net change and are labelled that way.

import type { MetricFrame } from './metrics';

export const CHURN_TIERS = ['cumulus', 'nimbus', 'stratus'] as const;
export type ChurnTier = (typeof CHURN_TIERS)[number];

export interface ChurnBucket {
  /** Bucket start, unix ms, aligned to a multiple of the bucket width. */
  t: number;
  /** Net change in the node count over the bucket; null when the history has no sample for it. */
  net: number | null;
  tiers: Record<ChurnTier, number | null>;
}

/** The change of one series per bucket: last known value in the bucket minus the one before it. */
function netPerBucket(
  t: readonly number[],
  values: readonly (number | null | undefined)[],
  t0: number,
  bucketMs: number,
  count: number,
): (number | null)[] {
  const end: (number | null)[] = new Array<number | null>(count).fill(null);
  let first: number | null = null;
  for (let i = 0; i < t.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (first === null) first = v;
    end[Math.floor((t[i]! - t0) / bucketMs)] = v;
  }
  if (first === null) return end;
  let prev: number = first;
  return end.map((e) => {
    if (e === null) return null;
    const net = e - prev;
    prev = e;
    return net;
  });
}

/** Buckets of `bucketMs`, aligned to the epoch, from the first sample to the last. */
export function churnBuckets(frame: MetricFrame, bucketMs: number): ChurnBucket[] {
  if (frame.t.length === 0 || bucketMs <= 0) return [];
  const t0 = Math.floor(frame.t[0]! / bucketMs) * bucketMs;
  const count = Math.floor((frame.t.at(-1)! - t0) / bucketMs) + 1;
  const total = netPerBucket(frame.t, frame.v.node_count ?? [], t0, bucketMs, count);
  const tiers = CHURN_TIERS.map((k) => netPerBucket(frame.t, frame.v[k] ?? [], t0, bucketMs, count));
  return total.map((net, b) => ({
    t: t0 + b * bucketMs,
    net,
    tiers: {
      cumulus: tiers[0]![b] ?? null,
      nimbus: tiers[1]![b] ?? null,
      stratus: tiers[2]![b] ?? null,
    },
  }));
}

/** First and last known value of a series, and their difference. */
export function windowChange(
  values: readonly (number | null | undefined)[],
): { from: number; to: number; change: number } | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined);
  if (known.length < 2) return null;
  const from = known[0]!;
  const to = known.at(-1)!;
  return { from, to, change: to - from };
}

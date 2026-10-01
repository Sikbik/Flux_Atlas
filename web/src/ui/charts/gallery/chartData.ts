// Real data for the charts gallery: metric series from the live server through the app's own query
// hooks, plus samples derived from the live store. Gallery-only (never imported by the kit itself).

import { useEffect, useMemo, useState } from 'react';
import type { MetricName } from '../../../api/endpoints';
import { useMetrics } from '../../../api/queries';
import { useNetwork } from '../../../app/context';
import type { NetworkStore } from '../../../store/network';
import type { Sample } from '../sparkline';

export interface MetricData {
  /** Bucket start times, unix ms, ascending. */
  t: number[];
  /** One value array per requested series, same length as `t`. */
  values: Record<string, Sample[]>;
  loading: boolean;
  error: unknown;
}

/**
 * The live server's recorded history. Older rows carry 0 for fields the server only started
 * recording recently (price, mempool, transactions), which is "unknown", never zero: names listed
 * in `zeroIsGap` have their zeros turned into gaps.
 */
export function useMetricData(
  names: readonly MetricName[],
  step: string,
  zeroIsGap: readonly MetricName[] = [],
): MetricData {
  const q = useMetrics({ series: names, step });
  const gaps = zeroIsGap.join(',');
  const data = q.data;
  const key = names.join(',');
  return useMemo(() => {
    const values: Record<string, Sample[]> = {};
    const zero = new Set(gaps ? gaps.split(',') : []);
    for (const name of key.split(',')) {
      const raw = data?.series[name] ?? [];
      values[name] = zero.has(name) ? raw.map((v) => (v === 0 ? null : v)) : [...raw];
    }
    return { t: data?.t ?? [], values, loading: q.isPending, error: q.error };
  }, [data, key, gaps, q.isPending, q.error]);
}

/** Drops leading and trailing nulls so a trend glyph spans its width with real samples. */
export function trimGaps(values: readonly Sample[]): Sample[] {
  let a = 0;
  let b = values.length;
  while (a < b && values[a] === null) a++;
  while (b > a && values[b - 1] === null) b--;
  return values.slice(a, b);
}

/** Only the samples that exist (gaps removed): a continuous run for glyphs that should not break. */
export function dense(values: readonly Sample[]): number[] {
  return values.filter((v): v is number => v !== null);
}

/** The last `n` entries. */
export function lastN<T>(values: readonly T[], n: number): T[] {
  return values.slice(Math.max(0, values.length - n));
}

export interface LiveSamples {
  t: number[];
  v: number[];
}

/**
 * Samples a number from the live store each time it changes (no timers): the store drives the
 * cadence, so a tip height shows up once per block and a mempool size whenever it moves. Keeps the
 * latest `max` samples.
 */
export function useStoreSamples(select: (s: NetworkStore) => number | null, max: number): LiveSamples {
  const value = useNetwork(select);
  const [samples, setSamples] = useState<LiveSamples>({ t: [], v: [] });
  useEffect(() => {
    if (value === null) return;
    const now = Date.now();
    setSamples((s) =>
      s.v[s.v.length - 1] === value ? s : { t: [...s.t, now].slice(-max), v: [...s.v, value].slice(-max) },
    );
  }, [value, max]);
  return samples;
}

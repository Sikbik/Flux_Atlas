// What the chain has done today, from the server's hourly figures: the transactions and the fees of the UTC day so
// far, against the same hours yesterday. The server builds those a little behind the chain, so the answer says the
// hour it runs through (see lib/today.ts). It asks again every five minutes.

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queries } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { frameFromDto } from '../../analytics/lib/metrics';
import { DAY_MS } from './lib/daily';
import { type TodayFigure, todaySoFar } from './lib/today';

const FIVE_MIN = 5 * 60_000;

export interface Today {
  tx: TodayFigure;
  fees: TodayFigure;
  isPending: boolean;
  isError: boolean;
}

const NONE: TodayFigure = { kind: 'none', value: null, throughMs: null, change: null };

export function useToday(): Today {
  const { clock } = useRuntime();
  // The window follows the UTC day: yesterday and today, so the key changes once a day.
  const dayStart = Math.floor(clock.now() / DAY_MS) * DAY_MS;
  const q = useQuery({
    ...queries.metrics({
      series: ['tx_count', 'fees_flux_f64'],
      from: dayStart - DAY_MS,
      to: dayStart + DAY_MS,
      step: '1h',
    }),
    refetchInterval: FIVE_MIN,
  });
  const frame = useMemo(() => (q.data ? frameFromDto(q.data) : null), [q.data]);
  // The figures move with the hours, not the seconds: they are read as of the start of the current minute.
  const minute = Math.floor(clock.now() / 60_000);
  return useMemo(() => {
    const nowMs = minute * 60_000;
    return {
      tx: frame ? todaySoFar(frame, 'tx_count', nowMs) : NONE,
      fees: frame ? todaySoFar(frame, 'fees_flux_f64', nowMs) : NONE,
      isPending: q.isPending,
      isError: q.isError,
    };
  }, [frame, minute, q.isPending, q.isError]);
}

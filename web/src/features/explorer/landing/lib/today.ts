// What the chain has done today, and how that compares with the same hours yesterday, from the hourly figures of
// `GET /metrics`. The server builds those a little behind the chain (the newest hour or two are not in yet), so
// "today" is told with the hour it runs through, never as if it were up to the second. Pure.

import type { MetricFrame } from '../../../analytics/lib/metrics';
import { DAY_MS } from './daily';

export interface TodayFigure {
  /**
   * `today`: the known hours of the UTC day so far. `yesterday`: nothing of today is in yet (just after midnight), so
   * the whole of yesterday stands in. `none`: nothing to say.
   */
  kind: 'today' | 'yesterday' | 'none';
  value: number | null;
  /** Unix ms the figure runs through (the end of the newest hour counted). */
  throughMs: number | null;
  /** Percent against the same hours yesterday, when every one of them is known. */
  change: number | null;
}

const NONE: TodayFigure = { kind: 'none', value: null, throughMs: null, change: null };

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** The step of a frame in ms (an hour when it cannot be told). */
function stepOf(frame: MetricFrame): number {
  const a = frame.t[0];
  const b = frame.t[1];
  return a !== undefined && b !== undefined && b > a ? b - a : 3_600_000;
}

/**
 * The sum of `name` over the hours of the UTC day that holds `nowMs`, those the server has built; and the same
 * hours of the day before, for the change. A bucket is named by its start.
 */
export function todaySoFar(frame: MetricFrame, name: string, nowMs: number): TodayFigure {
  const col = frame.v[name];
  if (!col || frame.t.length === 0) return NONE;
  const step = stepOf(frame);
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;

  let sum = 0;
  let count = 0;
  let through = dayStart;
  frame.t.forEach((t, i) => {
    const x = col[i];
    if (t < dayStart || t >= dayStart + DAY_MS || !finite(x)) return;
    sum += x;
    count++;
    through = Math.max(through, t + step);
  });

  if (count === 0) {
    // Nothing of today yet: the day before, whole, if every hour of it is known.
    const prior = frame.t
      .map((t, i) => ({ t, x: col[i] }))
      .filter((b) => b.t >= dayStart - DAY_MS && b.t < dayStart);
    const expected = Math.round(DAY_MS / step);
    if (prior.length < expected || prior.some((b) => !finite(b.x))) return NONE;
    return {
      kind: 'yesterday',
      value: prior.reduce((s, b) => s + (b.x as number), 0),
      throughMs: dayStart,
      change: null,
    };
  }

  // The same stretch of yesterday: every hour of it has to be known, or the comparison would be a guess.
  const span = through - dayStart;
  const hours = Math.round(span / step);
  let same = 0;
  let known = 0;
  frame.t.forEach((t, i) => {
    if (t < dayStart - DAY_MS || t >= dayStart - DAY_MS + span) return;
    const x = col[i];
    if (finite(x)) {
      same += x;
      known++;
    }
  });
  const change = hours >= 2 && known === hours && same > 0 ? (sum / same - 1) * 100 : null;
  return { kind: 'today', value: sum, throughMs: through, change };
}

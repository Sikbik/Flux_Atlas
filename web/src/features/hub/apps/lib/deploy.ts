// The deployments chart's numbers and its words: apps registered and apps updated per UTC day, the day still running
// told apart from the whole ones, the totals, the busiest day, and the sentence that names the chart for a screen
// reader. Pure.
//
// What the payload means (`deployments` of `GET /network/apps-overview`): one row per UTC day, oldest first, the
// last one the day so far. A day counts the app messages mined in it (an update includes a renewal). Until the
// server's one-time backfill of the permanent messages has finished, the days cover only the messages it has seen.

import type { AppDeployDay } from '../../../../api/generated/AppDeployDay';
import { formatInt } from '../../../../lib/format';
import { formatDate, formatDay } from '../../../wallet/lib/dates';

export const DAY_MS = 86_400_000;

export interface DeploySeries {
  /** Start of each UTC day, unix ms, ascending. */
  t: number[];
  registered: number[];
  updated: number[];
  /** Registered plus updated: the height of a day's bar. */
  total: number[];
  /** The last day is still running, so its bar is lower than the day will be. */
  running: boolean;
}

export function deploySeries(days: readonly AppDeployDay[], nowMs: number): DeploySeries {
  const t = days.map((d) => d.day_ms);
  const last = t[t.length - 1];
  return {
    t,
    registered: days.map((d) => d.registered),
    updated: days.map((d) => d.updated),
    total: days.map((d) => d.registered + d.updated),
    running: last !== undefined && nowMs < last + DAY_MS,
  };
}

/** Whether day `i` of the series is the one still running. */
export const isRunningDay = (s: DeploySeries, i: number): boolean => s.running && i === s.t.length - 1;

export interface DeployTotals {
  registered: number;
  updated: number;
  /** Days in the series, the running one included. */
  days: number;
  /** The whole day with the most messages; null with no whole day. */
  busiest: { t: number; total: number } | null;
}

export function deployTotals(s: DeploySeries): DeployTotals {
  const whole = s.running ? s.t.length - 1 : s.t.length;
  let busiest: DeployTotals['busiest'] = null;
  for (let i = 0; i < whole; i++) {
    const total = s.total[i] as number;
    // The later of two equal days wins: it is the one still on the reader's mind.
    if (total > 0 && (busiest === null || total >= busiest.total)) busiest = { t: s.t[i] as number, total };
  }
  return {
    registered: s.registered.reduce((a, b) => a + b, 0),
    updated: s.updated.reduce((a, b) => a + b, 0),
    days: s.t.length,
    busiest,
  };
}

const times = (n: number, one: string, many: string): string => `${formatInt(n)} ${n === 1 ? one : many}`;

/** The sentence for a screen reader (and the table's caption): what the chart shows, over what, and the totals. */
export function deploySummary(s: DeploySeries, complete: boolean): string {
  const n = s.t.length;
  if (n === 0) return 'No app registrations or updates were recorded in this range.';
  const t = deployTotals(s);
  const from = formatDate(s.t[0] as number);
  const to = formatDate(s.t[n - 1] as number);
  const parts = [
    `Apps registered and updated on each UTC day over ${times(n, 'day', 'days')}, ${from} to ${to}.`,
    `${times(t.registered, 'app was', 'apps were')} registered and ${times(t.updated, 'update was', 'updates were')} made (renewals count as updates).`,
  ];
  if (t.busiest) {
    parts.push(
      `The busiest whole day was ${formatDay(t.busiest.t)}, with ${times(t.busiest.total, 'message', 'messages')}.`,
    );
  }
  if (s.running) parts.push('The last day is still running, so it is drawn lighter.');
  if (!complete) parts.push('This server has only seen part of the history, so earlier days may read low.');
  return parts.join(' ');
}

/** The tooltip's head for day `i`: `3 Oct 2026`. */
export const dayHead = (s: DeploySeries, i: number): string => formatDate(s.t[i] as number);

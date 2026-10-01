// Pure helpers for the Timeline: how an event time reads, how the thread's colour runs down the
// list, and what a grouped run says. No DOM, so they are unit tested.

import { formatAgo, formatEta, formatUtcDateTime } from '../../lib/format';
import type { StatusTone } from '../internal/status';

/** Marker colour: a status role, the accent, white attention (`hot`) or a quiet neutral. */
export type TimelineTone = StatusTone | 'accent' | 'hot' | 'neutral';

/** How long a past event ago reads, or how far off a projected one is: `12 s ago`, `in 14.7 h`. */
export function relativeLabel(ts: number, nowMs: number): string {
  return ts <= nowMs ? formatAgo(nowMs - ts) : formatEta(ts - nowMs);
}

/** The ISO instant for a `<time dateTime>` attribute. */
export function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

/** `2026-09-30 19:39 UTC` as two lines for a narrow gutter: `2026-09-30` and `19:39 UTC`. */
export function splitDateTime(ms: number): { date: string; time: string } {
  const s = formatUtcDateTime(ms);
  const i = s.indexOf(' ');
  return i < 0 ? { date: s, time: '' } : { date: s.slice(0, i), time: s.slice(i + 1) };
}

/** True when an item is a grouped run: a count of two or more. */
export function isGroup(count: number | undefined): count is number {
  return typeof count === 'number' && Number.isFinite(count) && count >= 2;
}

/**
 * The thread's colour stops for row `index` of `total`: how much of the accent (in percent) the
 * segment has at its top and at its bottom. The thread runs from Flux blue at the newest item to
 * graphite at the oldest, in equal steps, so rows can colour their own segment and still join up.
 */
export function threadStops(index: number, total: number): { from: number; to: number } {
  if (total <= 1) return { from: 100, to: 100 };
  const step = 100 / (total - 1);
  return { from: Math.round(100 - index * step), to: Math.round(100 - (index + 1) * step) };
}

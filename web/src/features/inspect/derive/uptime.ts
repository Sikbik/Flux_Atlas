// Uptime strips and heartbeat ticks from a node's status history. The history only reaches back to
// our first ingest, so cells before that are "none" (not observed), never "down".

import type { FeedItem } from '../../../api/generated/FeedItem';
import type { StatusSegment } from '../../../api/generated/StatusSegment';

const DAY_MS = 86_400_000;

export interface UptimeCell {
  /** Start of the UTC day. */
  dayMs: number;
  /** Fraction of the observed part of the day the node was confirmed, null when not observed. */
  fraction: number | null;
  /** Hours of the day that were observed. */
  observedH: number;
}

/**
 * One cell per UTC day, oldest first, the last cell being today (observed up to `nowMs`).
 * `coverageFromMs` is when observation began (the history's first moment); earlier time is unobserved.
 */
export function uptimeCells(
  segments: readonly StatusSegment[],
  opts: { nowMs: number; days: number; coverageFromMs: number | null },
): UptimeCell[] {
  const { nowMs, days } = opts;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const first = segments.length ? Math.min(...segments.map((s) => s.from_ms)) : null;
  const coverage = opts.coverageFromMs ?? first;
  const cells: UptimeCell[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const start = today - k * DAY_MS;
    const end = Math.min(start + DAY_MS, nowMs);
    const from = coverage === null ? Number.POSITIVE_INFINITY : Math.max(start, coverage);
    const observed = Math.max(0, end - from);
    if (observed <= 0) {
      cells.push({ dayMs: start, fraction: null, observedH: 0 });
      continue;
    }
    let up = 0;
    for (const s of segments) {
      if (s.status !== 'confirmed') continue;
      const a = Math.max(s.from_ms, from);
      const b = Math.min(s.to_ms, end);
      if (b > a) up += b - a;
    }
    cells.push({ dayMs: start, fraction: Math.min(1, up / observed), observedH: observed / 3_600_000 });
  }
  return cells;
}

export interface HeartbeatTick {
  tsMs: number;
  height: number | null;
}

/** Check-in events (newest first from the server) as ticks, oldest first, inside `windowMs`. */
export function heartbeatTicks(
  events: readonly FeedItem[],
  nowMs: number,
  windowMs: number,
): HeartbeatTick[] {
  const out: HeartbeatTick[] = [];
  for (const e of events) {
    if (e.kind !== 'node_heartbeat' && e.kind !== 'node_joined') continue;
    if (nowMs - e.ts_ms > windowMs || e.ts_ms > nowMs + 60_000) continue;
    const h = Number(e.params.height);
    out.push({ tsMs: e.ts_ms, height: Number.isInteger(h) && h > 0 ? h : null });
  }
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

export interface IpChange {
  tsMs: number;
  from: string | null;
  to: string | null;
}

/** IP changes from node events, newest first; an empty `old` (first sighting) is a null `from`. */
export function ipHistory(events: readonly FeedItem[]): IpChange[] {
  const out: IpChange[] = [];
  for (const e of events) {
    if (e.kind !== 'node_ip_changed') continue;
    out.push({ tsMs: e.ts_ms, from: e.params.old || null, to: e.params.new || null });
  }
  out.sort((a, b) => b.tsMs - a.tsMs);
  // The same change can arrive in both the detail's recent events and the history.
  return out.filter((c, i) => i === 0 || c.tsMs !== out[i - 1]!.tsMs || c.to !== out[i - 1]!.to);
}

// Watchlist alerts: what changed for a watched node between two looks at it. Pure, so the alert
// engine (watch/alerts.ts) only has to read the store and deliver the result.

import { blocksSinceConfirm, CHECKIN } from './expiry';

export type AlertKind = 'offline' | 'at_risk' | 'paid' | 'ip_changed' | 'expired';

export const ALERT_KINDS: readonly AlertKind[] = ['offline', 'at_risk', 'paid', 'ip_changed', 'expired'];

export const ALERT_LABELS: Record<AlertKind, { title: string; hint: string }> = {
  offline: { title: 'Goes offline', hint: 'The sweep can no longer reach the node.' },
  at_risk: {
    title: 'At risk of expiry',
    hint: `${CHECKIN.atRisk} blocks without a check-in, about 80 minutes before the node expires.`,
  },
  paid: { title: 'Is paid', hint: 'A payout lands for the node.' },
  ip_changed: { title: 'Changes IP', hint: 'The node announces a new address.' },
  expired: { title: 'Expires or leaves', hint: 'The node drops off the deterministic list.' },
};

/** What the alert engine remembers about a node between looks. */
export interface WatchSnapshot {
  /** Chain height the snapshot was taken at (check-in age is measured against it). */
  tip: number;
  present: boolean;
  status: string;
  reachable: boolean | null;
  lastPaid: number;
  lastConfirmed: number;
  endpoint: string;
}

export interface AlertEvent {
  kind: AlertKind;
  id: number;
  /** Kind-specific detail: the new endpoint, the payout height, the blocks since the check-in. */
  detail: string | number | null;
}

const isGone = (s: WatchSnapshot) => !s.present || s.status === 'expired' || s.status === 'departed';

/**
 * Alerts raised by the move from `prev` to `next`. The first look at a node (no `prev`) is a
 * baseline and raises nothing.
 */
export function diffWatch(id: number, prev: WatchSnapshot | null, next: WatchSnapshot): AlertEvent[] {
  if (!prev) return [];
  const out: AlertEvent[] = [];
  const gone = isGone(next);

  if (!isGone(prev) && gone) {
    out.push({ kind: 'expired', id, detail: null });
    return out;
  }
  if (gone) return out;

  if (prev.reachable !== false && next.reachable === false) out.push({ kind: 'offline', id, detail: null });

  const sincePrev = blocksSinceConfirm(prev.tip, prev.lastConfirmed);
  const sinceNext = blocksSinceConfirm(next.tip, next.lastConfirmed);
  // Crossing 640 is expiry even before the list drops the node; crossing 560 is the at-risk warning.
  if (
    sinceNext !== null &&
    sinceNext >= CHECKIN.expire &&
    (sincePrev === null || sincePrev < CHECKIN.expire)
  ) {
    out.push({ kind: 'expired', id, detail: sinceNext });
  } else if (
    sinceNext !== null &&
    sinceNext >= CHECKIN.atRisk &&
    sinceNext < CHECKIN.expire &&
    (sincePrev === null || sincePrev < CHECKIN.atRisk)
  ) {
    out.push({ kind: 'at_risk', id, detail: sinceNext });
  }

  if (prev.lastPaid > 0 && next.lastPaid > prev.lastPaid)
    out.push({ kind: 'paid', id, detail: next.lastPaid });

  if (prev.endpoint && next.endpoint && prev.endpoint !== next.endpoint) {
    out.push({ kind: 'ip_changed', id, detail: next.endpoint });
  }
  return out;
}

/** Merges repeats: the same kind for the same node inside `windowMs` is delivered once. */
export class AlertDeduper {
  private readonly last = new Map<string, number>();
  constructor(private readonly windowMs = 10_000) {}

  accept(e: AlertEvent, nowMs: number): boolean {
    const key = `${e.kind}:${e.id}`;
    const at = this.last.get(key);
    if (at !== undefined && nowMs - at < this.windowMs) return false;
    this.last.set(key, nowMs);
    if (this.last.size > 512) {
      for (const [k, t] of this.last) if (nowMs - t >= this.windowMs) this.last.delete(k);
    }
    return true;
  }
}

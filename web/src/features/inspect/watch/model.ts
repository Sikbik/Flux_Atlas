// The pure side of watchlist alerts: the stored preferences, how a burst of alerts is grouped, and what
// each alert says. No store, no DOM, no timers, so all of it is tested directly.

import { formatInt } from '../../../lib/format';
import { CHECKIN } from '../derive/expiry';
import { ALERT_KINDS, type AlertEvent, type AlertKind } from '../derive/watch';

/** The server follows this many watched nodes in real time (the runtime's `setWatch` cap). */
export const WATCH_LIVE_LIMIT = 64;

export interface WatchPrefsData {
  /** Also show alerts as operating-system notifications while the tab is in the background. */
  notify: boolean;
  /** Which alerts are raised at all. */
  kinds: Record<AlertKind, boolean>;
}

export const DEFAULT_PREFS: WatchPrefsData = {
  notify: false,
  kinds: { offline: true, at_risk: true, paid: true, ip_changed: true, expired: true },
};

/** Reads stored preferences defensively: anything unexpected falls back to the default. */
export function parsePrefs(raw: unknown): WatchPrefsData {
  const out: WatchPrefsData = { notify: DEFAULT_PREFS.notify, kinds: { ...DEFAULT_PREFS.kinds } };
  if (typeof raw !== 'object' || raw === null) return out;
  const v = raw as Record<string, unknown>;
  if (typeof v.notify === 'boolean') out.notify = v.notify;
  if (typeof v.kinds === 'object' && v.kinds !== null) {
    const k = v.kinds as Record<string, unknown>;
    for (const kind of ALERT_KINDS) if (typeof k[kind] === 'boolean') out.kinds[kind] = k[kind] as boolean;
  }
  return out;
}

/** An alert with the facts a message needs. */
export interface WatchAlert extends AlertEvent {
  /** The node's `ip:port` now (or its last known one). */
  endpoint: string;
  /** The previous `ip:port`, for an address change. */
  from?: string;
}

export interface AlertGroup {
  kind: AlertKind;
  alerts: WatchAlert[];
}

/**
 * One group per kind, so a burst (a data center going dark) is one message and not forty. Kinds the user
 * turned off are dropped. Groups keep the order of `ALERT_KINDS`, which is the order of severity.
 */
export function groupAlerts(alerts: readonly WatchAlert[], kinds: Record<AlertKind, boolean>): AlertGroup[] {
  const by = new Map<AlertKind, WatchAlert[]>();
  for (const a of alerts) {
    if (!kinds[a.kind]) continue;
    const list = by.get(a.kind);
    if (list) list.push(a);
    else by.set(a.kind, [a]);
  }
  const order: AlertKind[] = ['expired', 'offline', 'at_risk', 'ip_changed', 'paid'];
  return order.flatMap((kind) => {
    const list = by.get(kind);
    return list ? [{ kind, alerts: list }] : [];
  });
}

export interface AlertText {
  title: string;
  body: string;
  /** Route opened by a click: the node when there is one, the watchlist for a group. */
  to: string;
}

const WATCHLIST = '/operator/watchlist';

const nodePath = (endpoint: string) => `/node/${endpoint}`;

function listOf(endpoints: readonly string[], max = 3): string {
  const shown = endpoints.slice(0, max).join(', ');
  const rest = endpoints.length - max;
  return rest > 0 ? `${shown} and ${formatInt(rest)} more` : shown;
}

/** What a group of alerts says, as a title, a sentence and where a click goes. */
export function describeGroup(g: AlertGroup): AlertText {
  const n = g.alerts.length;
  const first = g.alerts[0];
  if (!first) return { title: '', body: '', to: WATCHLIST };
  const endpoints = g.alerts.map((a) => a.endpoint || `node ${a.id}`);
  if (n === 1) {
    const ep = endpoints[0] as string;
    const to = nodePath(first.endpoint || String(first.id));
    switch (g.kind) {
      case 'offline':
        return { title: 'Node unreachable', body: `${ep} can no longer be reached.`, to };
      case 'at_risk':
        return {
          title: 'Node at risk of expiring',
          body: `${ep} has gone ${formatInt(Number(first.detail ?? CHECKIN.atRisk))} blocks without a check-in and expires at ${CHECKIN.expire}.`,
          to,
        };
      case 'paid':
        return {
          title: 'Node paid',
          body: first.detail
            ? `${ep} was paid in block ${formatInt(Number(first.detail))}.`
            : `${ep} was paid.`,
          to,
        };
      case 'ip_changed':
        return {
          title: 'Node changed address',
          body: first.from ? `${first.from} is now announced at ${ep}.` : `Now announced at ${ep}.`,
          to,
        };
      case 'expired':
        return { title: 'Node expired', body: `${ep} dropped off the node list.`, to };
    }
  }
  const count = formatInt(n);
  switch (g.kind) {
    case 'offline':
      return { title: `${count} watched nodes unreachable`, body: listOf(endpoints), to: WATCHLIST };
    case 'at_risk':
      return { title: `${count} watched nodes at risk of expiring`, body: listOf(endpoints), to: WATCHLIST };
    case 'paid':
      return { title: `${count} watched nodes paid`, body: listOf(endpoints), to: WATCHLIST };
    case 'ip_changed':
      return { title: `${count} watched nodes changed address`, body: listOf(endpoints), to: WATCHLIST };
    case 'expired':
      return { title: `${count} watched nodes expired`, body: listOf(endpoints), to: WATCHLIST };
  }
}

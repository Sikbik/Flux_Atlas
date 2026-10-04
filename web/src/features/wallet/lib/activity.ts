// The wallet's activity feed: which kinds of event there are, how they group under a filter, and what the
// fleet-over-time chart plots. Pure functions over the server's items; `tabs/Activity.tsx` draws them.
//
// The server writes one row per node event a person would read, with a plain-language `detail` of its own
// ("Paid 9.00000000 FLUX (stratus)"). The kind says what sort of row it is; the detail says the rest.

import { formatInt } from '../../../lib/format';
import type { FleetDay, WalletActivity } from '../types';
import { formatDate } from './dates';

export type ActivityGroup = 'payments' | 'health' | 'nodes' | 'apps';

export const ACTIVITY_GROUPS: readonly { id: ActivityGroup; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'health', label: 'Health' },
  { id: 'nodes', label: 'Node changes' },
  { id: 'apps', label: 'Apps' },
];

/** The kinds the server writes (`WalletActivity.kind`). */
const GROUP_OF: Record<string, ActivityGroup> = {
  paid: 'payments',
  at_risk: 'health',
  expired: 'health',
  dos: 'health',
  unreachable: 'health',
  recovered: 'health',
  benchmark: 'health',
  status: 'health',
  started: 'nodes',
  confirmed: 'nodes',
  left: 'nodes',
  collateral_spent: 'nodes',
  ip_changed: 'nodes',
  version: 'nodes',
  apps: 'apps',
};

/** The filter group of a feed kind; a kind this client does not know is a change to a node. */
export function groupOfKind(kind: string): ActivityGroup {
  return GROUP_OF[kind] ?? 'nodes';
}

const LABELS: Record<string, string> = {
  started: 'Started',
  confirmed: 'Confirmed',
  paid: 'Payment',
  ip_changed: 'Endpoint changed',
  at_risk: 'At risk of expiry',
  expired: 'Expired',
  left: 'Left the node list',
  dos: 'DOS listed',
  collateral_spent: 'Collateral spent',
  unreachable: 'Became unreachable',
  recovered: 'Reachable again',
  status: 'Status changed',
  benchmark: 'Benchmark',
  version: 'Version changed',
  apps: 'Apps changed',
};

/** How a kind reads on its own: `ip_changed` is "Endpoint changed", and a kind nobody has named gets its words. */
export function kindLabel(kind: string): string {
  const known = LABELS[kind];
  if (known) return known;
  const words = kind.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ActivityTone = 'ok' | 'warn' | 'crit' | 'pay' | 'info';

/**
 * The colour role of a row: money, good news, a warning, trouble, or plain information. A benchmark row is good or
 * bad news by what it says, so the detail is read for that one kind.
 */
export function toneOfKind(kind: string, detail = ''): ActivityTone {
  switch (kind) {
    case 'paid':
      return 'pay';
    case 'confirmed':
    case 'recovered':
      return 'ok';
    case 'at_risk':
    case 'unreachable':
    case 'ip_changed':
      return 'warn';
    case 'dos':
    case 'expired':
    case 'left':
    case 'collateral_spent':
      return 'crit';
    case 'benchmark':
      return /\bfailed\b/i.test(detail) ? 'warn' : /\bpassed\b/i.test(detail) ? 'ok' : 'info';
    default:
      return 'info';
  }
}

/** The items of the groups that are on; none on means all (an empty filter hides nothing). */
export function filterActivity(
  items: readonly WalletActivity[],
  on: ReadonlySet<ActivityGroup>,
): WalletActivity[] {
  if (on.size === 0) return [...items];
  return items.filter((i) => on.has(groupOfKind(i.kind)));
}

/**
 * The items whose kind, sentence or node name contains the text, ignoring case and the spaces at its ends; every
 * word of the text has to be somewhere in the row, so "unreachable 65.108" finds that node's outage. `nameOf` gives
 * a node's endpoint (its key when it has none), so a row is found by the node it is about.
 */
export function searchActivity(
  items: readonly WalletActivity[],
  text: string,
  nameOf: (nodeKey: string | null) => string,
): WalletActivity[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((i) => {
    const hay = `${kindLabel(i.kind)}\n${i.detail}\n${nameOf(i.node_key)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** What time the items span and how many there are; null for none. The feed is the newest rows, not all of them. */
export function activityWindow(
  items: readonly WalletActivity[],
): { from: number; to: number; count: number } | null {
  if (items.length === 0) return null;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const i of items) {
    if (i.t_ms < from) from = i.t_ms;
    if (i.t_ms > to) to = i.t_ms;
  }
  return { from, to, count: items.length };
}

/** How many items each group holds, for the counts on the filter chips. */
export function countByGroup(items: readonly WalletActivity[]): Record<ActivityGroup, number> {
  const out: Record<ActivityGroup, number> = { payments: 0, health: 0, nodes: 0, apps: 0 };
  for (const i of items) out[groupOfKind(i.kind)]++;
  return out;
}

/** Newest first, whatever order the items arrive in. */
export function newestFirst(items: readonly WalletActivity[]): WalletActivity[] {
  return [...items].sort((a, b) => b.t_ms - a.t_ms);
}

export interface PaymentSummary {
  count: number;
  /** FLUX paid in the payments whose amount the server stated in its detail. */
  flux: number;
}

/**
 * The FLUX in a payment's detail line ("Paid 9.00000000 FLUX (stratus)"): the server writes the amount in the
 * sentence, so it is read back out. A detail with no amount counts as a payment of unknown size.
 */
export function paymentAmount(detail: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*FLUX/i.exec(detail);
  if (!m) return null;
  const n = Number((m[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The tier a payment's detail names in brackets ("... FLUX (stratus)"), when it does. */
export function paymentTier(detail: string): 'cumulus' | 'nimbus' | 'stratus' | null {
  const m = /\((cumulus|nimbus|stratus)\)/i.exec(detail);
  return m ? ((m[1] ?? '').toLowerCase() as 'cumulus' | 'nimbus' | 'stratus') : null;
}

export function paymentSummary(items: readonly WalletActivity[]): PaymentSummary {
  let count = 0;
  let total = 0;
  for (const i of items) {
    if (i.kind !== 'paid') continue;
    count++;
    total += paymentAmount(i.detail) ?? 0;
  }
  return { count, flux: total };
}

// ---- the rhythm of the feed ------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The bucket sizes a rhythm chart picks from, finest first. */
export const RHYTHM_BUCKETS: readonly number[] = [
  MIN,
  5 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
];

export interface Rhythm {
  /** The start of each bucket, unix ms, ascending and with no gaps. */
  t: number[];
  bucketMs: number;
  /** Events per bucket, per group. */
  counts: Record<ActivityGroup, number[]>;
  /** Events per bucket in all. */
  total: number[];
}

/**
 * The feed counted into equal slices of time, one count per filter group: when things happened, and whether the
 * trouble came all at once. The slice is the finest that leaves no more than `target` of them over the whole span,
 * and every slice from the first event to the last is there (a quiet hour is a zero, not a gap).
 */
export function rhythm(items: readonly WalletActivity[], target = 36): Rhythm | null {
  const win = activityWindow(items);
  if (!win) return null;
  const span = win.to - win.from;
  const bucketMs =
    RHYTHM_BUCKETS.find((b) => Math.ceil(span / b) + 1 <= target) ?? (RHYTHM_BUCKETS.at(-1) as number);
  const start = Math.floor(win.from / bucketMs) * bucketMs;
  const n = Math.floor((win.to - start) / bucketMs) + 1;
  const counts: Rhythm['counts'] = {
    payments: new Array<number>(n).fill(0),
    health: new Array<number>(n).fill(0),
    nodes: new Array<number>(n).fill(0),
    apps: new Array<number>(n).fill(0),
  };
  const total = new Array<number>(n).fill(0);
  for (const i of items) {
    const k = Math.floor((i.t_ms - start) / bucketMs);
    (counts[groupOfKind(i.kind)][k] as number)++;
    (total[k] as number)++;
  }
  return { t: Array.from({ length: n }, (_, k) => start + k * bucketMs), bucketMs, counts, total };
}

// ---- the fleet over time --------------------------------------------------------------------------

export interface FleetSeries {
  t: number[];
  cumulus: number[];
  nimbus: number[];
  stratus: number[];
  total: number[];
}

export function fleetSeries(history: readonly FleetDay[]): FleetSeries {
  const out: FleetSeries = { t: [], cumulus: [], nimbus: [], stratus: [], total: [] };
  for (const d of history) {
    out.t.push(d.day_ms);
    out.cumulus.push(d.cumulus);
    out.nimbus.push(d.nimbus);
    out.stratus.push(d.stratus);
    out.total.push(d.cumulus + d.nimbus + d.stratus);
  }
  return out;
}

/**
 * The series without the days before the fleet had a node (the store keeps a keyframe for every day it ran, and a
 * young fleet has a long run of zeros in front of it). The last day is always kept, so there is something to say.
 */
export function trimLeadingEmpty(s: FleetSeries): FleetSeries {
  let first = s.total.findIndex((v) => v > 0);
  if (first < 0) first = Math.max(0, s.total.length - 1);
  if (first === 0) return s;
  return {
    t: s.t.slice(first),
    cumulus: s.cumulus.slice(first),
    nimbus: s.nimbus.slice(first),
    stratus: s.stratus.slice(first),
    total: s.total.slice(first),
  };
}

/** How many nodes each day added (negative: lost) against the day before; the first day has no day before. */
export function dailyChange(s: FleetSeries): (number | null)[] {
  return s.total.map((v, i) => (i === 0 ? null : v - (s.total[i - 1] as number)));
}

/** What changed over the history: first and last count, and the net. Null for fewer than two days. */
export function fleetChange(s: FleetSeries): { from: number; to: number; net: number } | null {
  if (s.total.length < 2) return null;
  const from = s.total[0] as number;
  const to = s.total[s.total.length - 1] as number;
  return { from, to, net: to - from };
}

/** The fleet's history in a sentence, for a screen reader and for the chart's table. */
export function describeFleet(s: FleetSeries): string {
  const n = s.t.length;
  if (n === 0) return 'The fleet has no history yet.';
  const last = s.total[n - 1] as number;
  const now = `${formatInt(last)} ${last === 1 ? 'node' : 'nodes'}`;
  if (n === 1) return `One day of fleet history so far, ${formatDate(s.t[0] as number)}: ${now}.`;
  const c = fleetChange(s) as NonNullable<ReturnType<typeof fleetChange>>;
  const move =
    c.net === 0 ? 'no change' : c.net > 0 ? `${formatInt(c.net)} more` : `${formatInt(-c.net)} fewer`;
  return `Confirmed nodes over ${formatInt(n)} days, ${formatDate(s.t[0] as number)} to ${formatDate(s.t[n - 1] as number)}: ${formatInt(c.from)} at the start and ${now} on the last day, ${move}.`;
}

/** The tiers that ever had a node, in the order the chart stacks them. */
export function tiersPresent(s: FleetSeries): ('cumulus' | 'nimbus' | 'stratus')[] {
  return (['cumulus', 'nimbus', 'stratus'] as const).filter((t) => s[t].some((v) => v > 0));
}

// The wallet's activity feed: which kinds of event there are, how they group under a filter, and what the
// fleet-over-time chart plots. Pure functions over the server's items; `tabs/Activity.tsx` draws them.

import type { FleetHistoryDay, WalletActivityItem } from '../types';

export type ActivityGroup = 'payments' | 'health' | 'nodes' | 'apps' | 'chain';

export const ACTIVITY_GROUPS: readonly { id: ActivityGroup; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'health', label: 'Health' },
  { id: 'nodes', label: 'Node changes' },
  { id: 'apps', label: 'Apps' },
  { id: 'chain', label: 'Chain' },
];

const GROUP_OF: Record<string, ActivityGroup> = {
  node_paid: 'payments',
  node_at_risk: 'health',
  node_unreachable: 'health',
  node_recovered: 'health',
  node_dosed: 'health',
  node_expired: 'health',
  node_heartbeat: 'health',
  node_joined: 'nodes',
  node_left: 'nodes',
  node_started: 'nodes',
  node_ip_changed: 'nodes',
  collateral_spent: 'nodes',
  app_deployed: 'apps',
  app_updated: 'apps',
  app_renewed: 'apps',
  app_expired: 'apps',
  app_pending: 'apps',
  app_install_failed: 'apps',
  version_milestone: 'chain',
  large_transfer: 'chain',
  reorg: 'chain',
  reward_reduction: 'chain',
};

/** The filter group of a feed kind; a kind this client does not know falls under the chain. */
export function groupOfKind(kind: string): ActivityGroup {
  return GROUP_OF[kind] ?? 'chain';
}

/** How a kind reads when there is nothing else to say: `node_ip_changed` becomes "IP changed". */
export function kindLabel(kind: string): string {
  const LABELS: Record<string, string> = {
    node_paid: 'Payment',
    node_ip_changed: 'IP changed',
    node_at_risk: 'At risk of expiry',
    node_unreachable: 'Became unreachable',
    node_recovered: 'Reachable again',
    node_dosed: 'DoS listed',
    node_expired: 'Expired',
    node_joined: 'Joined',
    node_left: 'Left',
    node_started: 'Started',
    node_heartbeat: 'Checked in',
    collateral_spent: 'Collateral spent',
    app_deployed: 'App deployed',
    app_updated: 'App updated',
    app_renewed: 'App renewed',
    app_expired: 'App expired',
    app_pending: 'App pending',
    app_install_failed: 'App install failed',
    reward_reduction: 'Reward cut',
  };
  const known = LABELS[kind];
  if (known) return known;
  const words = kind.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ActivityTone = 'ok' | 'warn' | 'crit' | 'pay' | 'info' | 'muted';

/** The colour role of a kind: good news, a warning, trouble, money, plain information, or background noise. */
export function toneOfKind(kind: string): ActivityTone {
  switch (kind) {
    case 'node_paid':
      return 'pay';
    case 'node_joined':
    case 'node_recovered':
      return 'ok';
    case 'node_at_risk':
    case 'node_unreachable':
    case 'node_ip_changed':
    case 'app_install_failed':
      return 'warn';
    case 'node_dosed':
    case 'node_expired':
    case 'node_left':
    case 'collateral_spent':
      return 'crit';
    case 'node_heartbeat':
      return 'muted';
    default:
      return 'info';
  }
}

/** The items of the groups that are on; none on means all (an empty filter hides nothing). */
export function filterActivity(
  items: readonly WalletActivityItem[],
  on: ReadonlySet<ActivityGroup>,
): WalletActivityItem[] {
  if (on.size === 0) return [...items];
  return items.filter((i) => on.has(groupOfKind(i.kind)));
}

/** How many items each group holds, for the counts on the filter chips. */
export function countByGroup(items: readonly WalletActivityItem[]): Record<ActivityGroup, number> {
  const out: Record<ActivityGroup, number> = { payments: 0, health: 0, nodes: 0, apps: 0, chain: 0 };
  for (const i of items) out[groupOfKind(i.kind)]++;
  return out;
}

/** Newest first, whatever order the items arrive in. */
export function newestFirst(items: readonly WalletActivityItem[]): WalletActivityItem[] {
  return [...items].sort((a, b) => b.t_ms - a.t_ms);
}

export interface PaymentSummary {
  count: number;
  /** FLUX paid in the payments whose amount the server stated in its detail. */
  flux: number;
}

/**
 * The FLUX in a payment's detail line ("Paid 9.00 FLUX"): the server writes the amount in the sentence, so it is
 * read back out. A detail with no amount counts as a payment of unknown size.
 */
export function paymentAmount(detail: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*FLUX/i.exec(detail);
  if (!m) return null;
  const n = Number((m[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function paymentSummary(items: readonly WalletActivityItem[]): PaymentSummary {
  let count = 0;
  let total = 0;
  for (const i of items) {
    if (i.kind !== 'node_paid') continue;
    count++;
    total += paymentAmount(i.detail) ?? 0;
  }
  return { count, flux: total };
}

// ---- the fleet over time --------------------------------------------------------------------------

export interface FleetSeries {
  t: number[];
  cumulus: number[];
  nimbus: number[];
  stratus: number[];
  total: number[];
}

export function fleetSeries(history: readonly FleetHistoryDay[]): FleetSeries {
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

/** What changed over the history: first and last count, and the net. Null for fewer than two days. */
export function fleetChange(s: FleetSeries): { from: number; to: number; net: number } | null {
  if (s.total.length < 2) return null;
  const from = s.total[0] as number;
  const to = s.total[s.total.length - 1] as number;
  return { from, to, net: to - from };
}

/** The tiers that ever had a node, in the order the chart stacks them. */
export function tiersPresent(s: FleetSeries): ('cumulus' | 'nimbus' | 'stratus')[] {
  return (['cumulus', 'nimbus', 'stratus'] as const).filter((t) => s[t].some((v) => v > 0));
}

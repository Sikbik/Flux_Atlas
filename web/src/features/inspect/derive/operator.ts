// An operator's fleet, derived from the live node table: one row per node with its live status,
// queue position and hardware, plus the summaries the operator view and the watchlist show
// (concentration risk, version stragglers, hardware mix, apps hosted). Everything here is a pure
// function of its inputs, so the views stay thin and the numbers stay testable.

import type { NodeRow } from '../../../api/generated/NodeRow';
import type { NodeStatus } from '../../../api/generated/NodeStatus';
import { STATUS_CODES } from '../../../api/nodesBin';
import { parseEndpoint } from '../../../lib/format';
import { type NodeTable, Reach } from '../../../store/nodeTable';
import { blocksSinceConfirm, CHECKIN, isAtRisk } from './expiry';
import { fluxPerDay, positionOf, QUEUE_TIERS, type QueueSnapshot, type QueueTier } from './queue';
import { type VersionStanding, versionStanding } from './versions';

export interface FleetNode {
  id: number;
  endpoint: string;
  ip: string;
  port: number | null;
  tier: QueueTier | 'unknown';
  status: NodeStatus;
  reachable: boolean | null;
  /** Blocks since the last check-in, null when unknown. */
  sinceConfirm: number | null;
  atRisk: boolean;
  /** Position in the tier queue (0 = next block), null when not queued. */
  position: number | null;
  /** Height of the last payment, null when none is known. */
  lastPaid: number | null;
  version: string | null;
  cores: number;
  ramGb: number;
  ssdGb: number;
  appCount: number;
  country: string;
  org: string;
  lat: number | null;
  lon: number | null;
  /** Steady-state FLUX per day (an estimate), null when the tier payout is unknown. */
  perDay: number | null;
  paymentAddress: string | null;
  /** False when the live table does not know the node: it left the list, or the list is not loaded. */
  present: boolean;
}

export type TierPayouts = Partial<Record<QueueTier, number>>;

const TIER_NAMES: Record<number, QueueTier | 'unknown'> = {
  0: 'unknown',
  1: 'cumulus',
  2: 'nimbus',
  3: 'stratus',
};

/**
 * One fleet row per roster entry. The live table wins where it knows the node (status, check-in,
 * reachability, hardware); the roster row fills in what the table does not carry.
 */
export function buildFleet(
  roster: readonly NodeRow[],
  t: NodeTable,
  q: QueueSnapshot,
  tip: number | null,
  payouts: TierPayouts,
): FleetNode[] {
  return roster.map((r) => {
    const i = t.indexOf(r.id);
    const known = i >= 0;
    const tierName: QueueTier | 'unknown' = known
      ? (TIER_NAMES[t.tier[i]!] ?? 'unknown')
      : QUEUE_TIERS.includes(r.tier as QueueTier)
        ? (r.tier as QueueTier)
        : 'unknown';
    const endpoint = (known ? t.endpoint(i) : '') || r.endpoint || '';
    const ep = parseEndpoint(endpoint);
    const lastConfirmed =
      known && t.lastConfirmed[i]! > 0 ? t.lastConfirmed[i]! : (r.last_confirmed_height ?? 0);
    const since = blocksSinceConfirm(tip, lastConfirmed);
    const status: NodeStatus = known ? (STATUS_CODES[t.status[i]!] ?? 'unknown') : r.status;
    const reach = known ? t.reachable[i]! : Reach.Unknown;
    const reachable = reach === Reach.Yes ? true : reach === Reach.No ? false : r.reachable;
    const pos = positionOf(q, r.id);
    const size = pos?.size ?? 0;
    const payout = tierName === 'unknown' ? undefined : payouts[tierName];
    const version = known ? t.fluxOs(i) : (r.flux_os ?? '');
    return {
      id: r.id,
      endpoint,
      ip: ep?.host ?? '',
      port: ep?.port ?? null,
      tier: tierName,
      status,
      reachable,
      sinceConfirm: since,
      atRisk: isAtRisk(since),
      position: pos ? pos.position : null,
      lastPaid: known && t.lastPaid[i]! > 0 ? t.lastPaid[i]! : (r.last_paid_height ?? null),
      version: version || null,
      cores: known ? t.cores[i]! : 0,
      ramGb: known ? t.ramGb[i]! : 0,
      ssdGb: known ? t.ssdGb[i]! : 0,
      appCount: known ? t.appCount[i]! : r.app_count,
      country: known ? t.countryCode(i) : (r.country_code ?? ''),
      org: known ? t.orgName(i) : (r.org ?? ''),
      lat: r.lat,
      lon: r.lon,
      perDay: payout !== undefined && size > 0 ? fluxPerDay(payout, size) : null,
      paymentAddress: r.payment_address || null,
      present: known,
    };
  });
}

const stubRow = (id: number): NodeRow => ({
  id,
  outpoint: '',
  endpoint: null,
  tier: 'unknown',
  status: 'unknown',
  rank: null,
  payment_address: '',
  country_code: null,
  country: null,
  org: null,
  lat: null,
  lon: null,
  app_count: 0,
  added_height: 0,
  last_paid_height: null,
  last_confirmed_height: null,
  flux_os: null,
  arcane: null,
  reachable: null,
});

/**
 * A fleet from node ids alone (the watchlist): every fact comes from the live table. A node the table
 * no longer knows stays in the list as `present: false`, so a watched node that left shows as gone
 * instead of silently disappearing.
 */
export function buildWatchFleet(
  ids: readonly number[],
  t: NodeTable,
  q: QueueSnapshot,
  tip: number | null,
  payouts: TierPayouts,
): FleetNode[] {
  return buildFleet(ids.map(stubRow), t, q, tip, payouts);
}

// ---- health -----------------------------------------------------------------------------------------

/**
 * One word for how a node is doing, for the status grid and the counts:
 * `ok` confirmed and checking in; `risk` needs a look (at risk of expiry, or the sweep cannot reach it);
 * `down` offline, DoS listed or past expiry; `pending` not confirmed yet or unknown; `gone` off the list.
 */
export type FleetState = 'ok' | 'risk' | 'down' | 'pending' | 'gone';

export const FLEET_STATES: readonly FleetState[] = ['ok', 'risk', 'down', 'pending', 'gone'];

export function fleetState(n: FleetNode): FleetState {
  if (!n.present || n.status === 'departed') return 'gone';
  if (n.status === 'expired') return 'gone';
  if (n.status === 'dos' || n.status === 'offline') return 'down';
  if (n.sinceConfirm !== null && n.sinceConfirm >= CHECKIN.expire) return 'down';
  if (n.status === 'confirmed') return n.atRisk || n.reachable === false ? 'risk' : 'ok';
  return 'pending';
}

export function stateCounts(nodes: readonly FleetNode[]): Record<FleetState, number> {
  const out: Record<FleetState, number> = { ok: 0, risk: 0, down: 0, pending: 0, gone: 0 };
  for (const n of nodes) out[fleetState(n)]++;
  return out;
}

export type AttentionKind = 'expired' | 'at_risk' | 'unreachable' | 'dos';

export interface Attention {
  kind: AttentionKind;
  nodes: FleetNode[];
}

/**
 * Nodes that need a look, grouped worst first: past expiry, at risk of expiry (closest to expiring
 * first), DoS listed, unreachable. A node appears in the first group it qualifies for only.
 */
export function attention(nodes: readonly FleetNode[]): Attention[] {
  const expired: FleetNode[] = [];
  const atRisk: FleetNode[] = [];
  const dos: FleetNode[] = [];
  const unreachable: FleetNode[] = [];
  for (const n of nodes) {
    if (!n.present || n.status === 'departed') continue;
    if (n.status === 'expired' || (n.sinceConfirm !== null && n.sinceConfirm >= CHECKIN.expire)) {
      expired.push(n);
    } else if (n.status === 'dos') dos.push(n);
    else if (n.atRisk) atRisk.push(n);
    else if (n.reachable === false && (n.status === 'confirmed' || n.status === 'offline'))
      unreachable.push(n);
  }
  atRisk.sort((a, b) => (b.sinceConfirm ?? 0) - (a.sinceConfirm ?? 0));
  const out: Attention[] = [];
  if (expired.length) out.push({ kind: 'expired', nodes: expired });
  if (atRisk.length) out.push({ kind: 'at_risk', nodes: atRisk });
  if (dos.length) out.push({ kind: 'dos', nodes: dos });
  if (unreachable.length) out.push({ kind: 'unreachable', nodes: unreachable });
  return out;
}

// ---- geometry ---------------------------------------------------------------------------------------

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface Centroid {
  lat: number;
  lon: number;
  /** Largest angular distance (radians) from the centre to a node. */
  spread: number;
  /** How many nodes had a place. */
  count: number;
}

/** The centre of a fleet on the sphere (unit-vector mean) and how far it reaches. Null without places. */
export function fleetCentroid(nodes: readonly { lat: number | null; lon: number | null }[]): Centroid | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const n of nodes) {
    if (n.lat === null || n.lon === null || !Number.isFinite(n.lat) || !Number.isFinite(n.lon)) continue;
    const la = toRad(n.lat);
    const lo = toRad(n.lon);
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
    count++;
  }
  if (count === 0) return null;
  const norm = Math.hypot(x, y, z);
  // Opposite sides of the planet cancel out; fall back to the first node's place then.
  if (norm < 1e-9) {
    const first = nodes.find((n) => n.lat !== null && n.lon !== null);
    return first ? { lat: first.lat as number, lon: first.lon as number, spread: Math.PI, count } : null;
  }
  const cx = x / norm;
  const cy = y / norm;
  const cz = z / norm;
  let spread = 0;
  for (const n of nodes) {
    if (n.lat === null || n.lon === null || !Number.isFinite(n.lat) || !Number.isFinite(n.lon)) continue;
    const la = toRad(n.lat);
    const lo = toRad(n.lon);
    const dot = cx * Math.cos(la) * Math.cos(lo) + cy * Math.cos(la) * Math.sin(lo) + cz * Math.sin(la);
    spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, dot))));
  }
  return { lat: toDeg(Math.asin(cz)), lon: toDeg(Math.atan2(cy, cx)), spread, count };
}

/** Camera range (globe radii) that frames a fleet of the given angular spread. */
export function flyRangeFor(spread: number): number {
  return Math.max(0.5, Math.min(3.4, 0.45 + spread * 2.4));
}

/** Soonest payout first, tiers interleaved (every tier pays one node per block); unqueued nodes last. */
export function sortByNextPayout(nodes: readonly FleetNode[]): FleetNode[] {
  return [...nodes].sort((a, b) => {
    const pa = a.position ?? Number.POSITIVE_INFINITY;
    const pb = b.position ?? Number.POSITIVE_INFINITY;
    return pa - pb || a.id - b.id;
  });
}

export interface FleetSummary {
  count: number;
  hosts: number;
  tiers: Record<QueueTier, number>;
  /** Steady-state FLUX per day over the nodes whose tier payout is known. */
  perDay: number | null;
  next: FleetNode | null;
  atRisk: FleetNode[];
  unreachable: FleetNode[];
  /** Nodes that are not confirmed (started, DoS, expired, left). */
  notConfirmed: FleetNode[];
  apps: number;
}

export function summarizeFleet(nodes: readonly FleetNode[]): FleetSummary {
  const tiers: Record<QueueTier, number> = { cumulus: 0, nimbus: 0, stratus: 0 };
  const hosts = new Set<string>();
  let perDay = 0;
  let anyPerDay = false;
  let apps = 0;
  for (const n of nodes) {
    if (n.tier !== 'unknown') tiers[n.tier]++;
    if (n.ip) hosts.add(n.ip);
    if (n.perDay !== null) {
      perDay += n.perDay;
      anyPerDay = true;
    }
    apps += n.appCount;
  }
  const sorted = sortByNextPayout(nodes);
  return {
    count: nodes.length,
    hosts: hosts.size,
    tiers,
    perDay: anyPerDay ? perDay : null,
    next: sorted.find((n) => n.position !== null && n.status === 'confirmed') ?? null,
    atRisk: nodes.filter((n) => n.atRisk),
    unreachable: nodes.filter((n) => n.reachable === false),
    notConfirmed: nodes.filter((n) => n.status !== 'confirmed'),
    apps,
  };
}

// ---- concentration risk ----------------------------------------------------------------------------

export interface Concentration {
  level: 'none' | 'warn' | 'crit';
  kind: 'host' | 'provider' | null;
  /** The shared host IP or provider name. */
  key: string;
  nodes: number;
  total: number;
  /** Share (0..1) of the fleet's daily payout (or of its nodes when payouts are unknown) at risk. */
  share: number;
  headline: string;
  body: string;
}

const NONE: Concentration = {
  level: 'none',
  kind: null,
  key: '',
  nodes: 0,
  total: 0,
  share: 0,
  headline: '',
  body: '',
};

function topShare(
  nodes: readonly FleetNode[],
  keyOf: (n: FleetNode) => string,
): { key: string; count: number; share: number } | null {
  const weight = (n: FleetNode) => n.perDay ?? 1;
  const mixed = nodes.some((n) => n.perDay !== null) && nodes.some((n) => n.perDay === null);
  const w = (n: FleetNode) => (mixed ? 1 : weight(n));
  const total = nodes.reduce((a, n) => a + w(n), 0);
  if (total <= 0) return null;
  const by = new Map<string, { sum: number; count: number }>();
  for (const n of nodes) {
    const k = keyOf(n);
    if (!k) continue;
    const cur = by.get(k) ?? { sum: 0, count: 0 };
    cur.sum += w(n);
    cur.count++;
    by.set(k, cur);
  }
  let best: { key: string; count: number; share: number } | null = null;
  for (const [key, v] of by) {
    const share = v.sum / total;
    if (!best || share > best.share || (share === best.share && v.count > best.count))
      best = { key, count: v.count, share };
  }
  return best;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The most worrying single point of failure in a fleet: one host (IP) or one provider carrying a
 * large share of the payouts. A fleet of one node has nothing to concentrate.
 */
export function concentration(nodes: readonly FleetNode[]): Concentration {
  if (nodes.length < 2) return NONE;
  const host = topShare(nodes, (n) => n.ip);
  const provider = topShare(nodes, (n) => n.org);
  const total = nodes.length;

  if (host && host.count >= 2 && host.share >= 0.5) {
    const all = host.count === total;
    const level = all && total >= 3 ? 'crit' : 'warn';
    const same = provider && provider.count === total && provider.share === 1;
    return {
      level,
      kind: 'host',
      key: host.key,
      nodes: host.count,
      total,
      share: host.share,
      headline: 'Concentration risk',
      body: all
        ? `All ${total} nodes share one IP${same ? ' in one datacenter' : ''}. A single outage would stop ${pct(host.share)} of your payouts. Spreading the same nodes across two hosts would halve the exposure.`
        : `${host.count} of ${total} nodes share the IP ${host.key}. An outage there would stop ${pct(host.share)} of your payouts.`,
    };
  }
  if (provider && provider.count >= 3 && provider.share >= 0.75) {
    return {
      level: 'warn',
      kind: 'provider',
      key: provider.key,
      nodes: provider.count,
      total,
      share: provider.share,
      headline: 'Provider concentration',
      body: `${provider.count} of ${total} nodes run at ${provider.key}. A provider-wide outage would stop ${pct(provider.share)} of your payouts.`,
    };
  }
  return NONE;
}

// ---- versions ---------------------------------------------------------------------------------------

export interface Straggler {
  node: FleetNode;
  standing: VersionStanding;
}

/** Nodes running an older FluxOS than `latest`, oldest first. */
export function stragglers(nodes: readonly FleetNode[], latest: string | null): Straggler[] {
  const out: Straggler[] = [];
  for (const node of nodes) {
    const standing = versionStanding(node.version, latest);
    if (standing === 'behind') out.push({ node, standing });
  }
  return out.sort((a, b) =>
    (a.node.version ?? '').localeCompare(b.node.version ?? '', 'en', { numeric: true }),
  );
}

/** Count of nodes on each FluxOS version, most common first. */
export function versionCounts(nodes: readonly FleetNode[]): { version: string; count: number }[] {
  const by = new Map<string, number>();
  for (const n of nodes) {
    const v = n.version ?? 'Unknown';
    by.set(v, (by.get(v) ?? 0) + 1);
  }
  return [...by]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => {
      if (a.version === 'Unknown' || b.version === 'Unknown') return a.version === 'Unknown' ? 1 : -1;
      return b.count - a.count || b.version.localeCompare(a.version, 'en', { numeric: true });
    });
}

// ---- hardware ---------------------------------------------------------------------------------------

export interface HardwareGroup {
  label: string;
  cores: number;
  ramGb: number;
  ssdGb: number;
  count: number;
  tier: QueueTier | 'unknown';
}

export interface HardwareMix {
  groups: HardwareGroup[];
  totals: { cores: number; ramGb: number; ssdGb: number };
  /** Nodes whose benchmark has not been seen. */
  unknown: number;
}

/** The fleet's hardware, grouped by identical configuration, with totals over the known nodes. */
export function hardwareMix(nodes: readonly FleetNode[]): HardwareMix {
  const by = new Map<string, HardwareGroup>();
  const totals = { cores: 0, ramGb: 0, ssdGb: 0 };
  let unknown = 0;
  for (const n of nodes) {
    if (n.cores <= 0 && n.ramGb <= 0 && n.ssdGb <= 0) {
      unknown++;
      continue;
    }
    totals.cores += n.cores;
    totals.ramGb += n.ramGb;
    totals.ssdGb += n.ssdGb;
    const key = `${n.tier}:${n.cores}:${n.ramGb}:${n.ssdGb}`;
    const g = by.get(key);
    if (g) g.count++;
    else
      by.set(key, {
        label: `${n.cores} cores, ${n.ramGb} GB RAM, ${n.ssdGb} GB SSD`,
        cores: n.cores,
        ramGb: n.ramGb,
        ssdGb: n.ssdGb,
        count: 1,
        tier: n.tier,
      });
  }
  return { groups: [...by.values()].sort((a, b) => b.count - a.count || b.cores - a.cores), totals, unknown };
}

// ---- earnings ---------------------------------------------------------------------------------------

/** Sum of `amount` strings (FLUX decimals) of payments newer than `sinceMs`, in FLUX as a number. */
export function sumSince(
  payments: readonly { time_ms: number; amount: string }[],
  sinceMs: number,
  toFlux: (amount: string) => number | null,
): number {
  let sum = 0;
  for (const p of payments) {
    if (p.time_ms < sinceMs) continue;
    sum += toFlux(p.amount) ?? 0;
  }
  return sum;
}

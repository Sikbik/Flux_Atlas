// Network weather: where the network is struggling and how badly.
//
// Inputs are the three things the network can say about a node that is not well: it cannot be reached,
// it is on the DoS list, or it is at risk of expiry (560 or more blocks without a check-in). The node
// list is scanned once for the server's view of every node (`NodeScan`); the live table then overrides
// whatever it has seen since (reachability deltas, check-ins), so the picture moves with the stream
// instead of being polled. Benchmark failures are not carried by the node list, so they stay unknown.

import { STATUS_CODES } from '../../../api/nodesBin';
import { type NodeTable, Reach } from '../../../store/nodeTable';
import { countryName } from './appSpec';
import { blocksSinceConfirm, isAtRisk } from './expiry';

/** The server's per-node view, as compact columns indexed by scan order. */
export interface NodeScan {
  ids: Uint32Array;
  /** `Reach` values. */
  reach: Uint8Array;
  /** Status codes (`STATUS_CODES`). */
  status: Uint8Array;
  lastConfirmed: Uint32Array;
  /** Id to index. */
  index: Map<number, number>;
}

export function emptyScan(n: number): NodeScan {
  return {
    ids: new Uint32Array(n),
    reach: new Uint8Array(n),
    status: new Uint8Array(n),
    lastConfirmed: new Uint32Array(n),
    index: new Map(),
  };
}

export interface Problem {
  id: number;
  lat: number;
  lon: number;
  country: string;
  org: string;
  unreachable: boolean;
  dos: boolean;
  atRisk: boolean;
}

export interface WeatherCounts {
  total: number;
  unreachable: number;
  dos: number;
  atRisk: number;
  /** Nodes with at least one problem. */
  affected: number;
  /** The node list does not carry benchmark results, so this is never a number. */
  benchFailed: null;
}

export interface WeatherModel {
  counts: WeatherCounts;
  problems: Problem[];
  /** True when only the live table (reachability deltas since load) was available. */
  partial: boolean;
}

const DOS_CODE = STATUS_CODES.indexOf('dos');

/**
 * Merges the scan (when there is one) with the live table and lists every node that is not well.
 * Without a scan only what the stream has reported since load is known, and `partial` says so.
 */
export function buildWeather(t: NodeTable, scan: NodeScan | null, tip: number | null): WeatherModel {
  const problems: Problem[] = [];
  let unreachable = 0;
  let dos = 0;
  let atRisk = 0;
  for (let i = 0; i < t.count; i++) {
    const id = t.ids[i]!;
    const s = scan?.index.get(id);
    const liveReach = t.reachable[i]!;
    const reach = liveReach !== Reach.Unknown ? liveReach : s !== undefined ? scan!.reach[s]! : Reach.Unknown;
    const status = t.status[i]!;
    const lastConfirmed =
      t.lastConfirmed[i]! > 0 ? t.lastConfirmed[i]! : s !== undefined ? scan!.lastConfirmed[s]! : 0;
    const isUnreachable = reach === Reach.No;
    const isDos = status === DOS_CODE;
    // Only confirmed nodes can be "at risk": a started or departed node has no check-in cycle.
    const risk =
      (STATUS_CODES[status] === 'confirmed' || STATUS_CODES[status] === 'offline') &&
      isAtRisk(blocksSinceConfirm(tip, lastConfirmed));
    if (isUnreachable) unreachable++;
    if (isDos) dos++;
    if (risk) atRisk++;
    if (!isUnreachable && !isDos && !risk) continue;
    problems.push({
      id,
      lat: t.lat[i]!,
      lon: t.lon[i]!,
      country: t.countryCode(i),
      org: t.orgName(i),
      unreachable: isUnreachable,
      dos: isDos,
      atRisk: risk,
    });
  }
  return {
    counts: { total: t.count, unreachable, dos, atRisk, affected: problems.length, benchFailed: null },
    problems,
    partial: scan === null,
  };
}

// ---- verdict ----------------------------------------------------------------------------------------

export type WeatherLevel = 'healthy' | 'unsettled' | 'storm' | 'unknown';

/** Thresholds (share of all nodes). Calibrated so an ordinary day, about 2% unreachable, reads healthy. */
export const THRESHOLDS = {
  unsettled: { unreachable: 0.04, atRisk: 0.015, dos: 0.01 },
  storm: { unreachable: 0.1, atRisk: 0.05, dos: 0.03 },
} as const;

export interface Verdict {
  level: WeatherLevel;
  /** The one-line summary: `Healthy, 105 unreachable, 11 at risk`. */
  line: string;
  /** What drove a non-healthy verdict. */
  reasons: string[];
}

export function verdictOf(c: WeatherCounts, opts: { known?: boolean } = {}): Verdict {
  if (c.total <= 0 || opts.known === false) {
    return { level: 'unknown', line: 'Waiting for the node list', reasons: [] };
  }
  const share = (n: number) => n / c.total;
  const reasons: string[] = [];
  let level: WeatherLevel = 'healthy';
  const check = (n: number, label: string, u: number, s: number) => {
    if (share(n) >= s) {
      level = 'storm';
      reasons.push(`${label} ${(share(n) * 100).toFixed(1)}% of nodes`);
    } else if (share(n) >= u) {
      if (level === 'healthy') level = 'unsettled';
      reasons.push(`${label} ${(share(n) * 100).toFixed(1)}% of nodes`);
    }
  };
  check(c.unreachable, 'Unreachable', THRESHOLDS.unsettled.unreachable, THRESHOLDS.storm.unreachable);
  check(c.atRisk, 'At risk', THRESHOLDS.unsettled.atRisk, THRESHOLDS.storm.atRisk);
  check(c.dos, 'DoS listed', THRESHOLDS.unsettled.dos, THRESHOLDS.storm.dos);
  const word = level === 'healthy' ? 'Healthy' : level === 'unsettled' ? 'Unsettled' : 'Storm';
  const parts = [`${c.unreachable.toLocaleString('en-US')} unreachable`];
  parts.push(`${c.atRisk.toLocaleString('en-US')} at risk`);
  if (c.dos > 0) parts.push(`${c.dos.toLocaleString('en-US')} DoS listed`);
  return { level, line: `${word}, ${parts.join(', ')}`, reasons };
}

// ---- hotspots ---------------------------------------------------------------------------------------

/** Degrees per cell of the hotspot grid. */
export const CELL_DEG = 2;

export function cellKey(lat: number, lon: number, cell = CELL_DEG): string {
  return `${Math.floor(lat / cell)}:${Math.floor(lon / cell)}`;
}

/** Node count per grid cell from the live table, the denominators for hotspot ratios. */
export function cellTotals(t: NodeTable, cell = CELL_DEG): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < t.count; i++) {
    const lat = t.lat[i]!;
    const lon = t.lon[i]!;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const k = cellKey(lat, lon, cell);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export interface Hotspot {
  key: string;
  /** Centroid of the affected nodes. */
  lat: number;
  lon: number;
  total: number;
  bad: number;
  unreachable: number;
  dos: number;
  atRisk: number;
  /** How many times the network's own rate this cell's rate is. */
  lift: number;
  level: 'unsettled' | 'storm';
  /** The country code and provider most of the affected nodes share (empty when none is known). */
  country: string;
  org: string;
}

/** The most common non-empty value of `pick` over a list (the first to reach the top count wins a tie). */
function dominant(list: readonly Problem[], pick: (p: Problem) => string): string {
  const n = new Map<string, number>();
  let best = '';
  let top = 0;
  for (const p of list) {
    const k = pick(p);
    if (!k) continue;
    const c = (n.get(k) ?? 0) + 1;
    n.set(k, c);
    if (c > top) {
      best = k;
      top = c;
    }
  }
  return best;
}

/**
 * Cells where trouble is concentrated: at least three affected nodes and at least twice the
 * network's overall rate (storm: five nodes, four times the rate and one in seven or worse).
 */
export function hotspots(
  problems: readonly Problem[],
  totals: ReadonlyMap<string, number>,
  baseline: number,
  cell = CELL_DEG,
): Hotspot[] {
  const by = new Map<string, Problem[]>();
  for (const p of problems) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const k = cellKey(p.lat, p.lon, cell);
    const list = by.get(k);
    if (list) list.push(p);
    else by.set(k, [p]);
  }
  const out: Hotspot[] = [];
  for (const [key, list] of by) {
    const total = Math.max(totals.get(key) ?? list.length, list.length);
    const bad = list.length;
    const ratio = bad / total;
    const lift = baseline > 0 ? ratio / baseline : ratio > 0 ? Number.POSITIVE_INFINITY : 0;
    if (bad < 3 || lift < 2) continue;
    let lat = 0;
    let lon = 0;
    for (const p of list) {
      lat += p.lat;
      lon += p.lon;
    }
    out.push({
      key,
      lat: lat / bad,
      lon: lon / bad,
      total,
      bad,
      unreachable: list.filter((p) => p.unreachable).length,
      dos: list.filter((p) => p.dos).length,
      atRisk: list.filter((p) => p.atRisk).length,
      lift,
      level: bad >= 5 && lift >= 4 && ratio >= 1 / 7 ? 'storm' : 'unsettled',
      country: dominant(list, (x) => x.country),
      org: dominant(list, (x) => x.org),
    });
  }
  return out.sort((a, b) => b.bad - a.bad || b.lift - a.lift);
}

const compass = (deg: number, pos: string, neg: string) =>
  `${Math.abs(deg).toFixed(1)}${deg >= 0 ? pos : neg}`;

/** What to call a hotspot: its provider and country, or its coordinates when neither is known. */
export function placeName(h: Pick<Hotspot, 'org' | 'country' | 'lat' | 'lon'>): string {
  const parts = [h.org, h.country ? countryName(h.country) : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : `${compass(h.lat, 'N', 'S')} ${compass(h.lon, 'E', 'W')}`;
}

/** "6.2x" for a hotspot's rate against the network's own (whole numbers from ten up). */
export const formatLift = (lift: number): string =>
  Number.isFinite(lift) ? `${lift >= 10 ? Math.round(lift) : lift.toFixed(1)}x` : 'far above';

// ---- breakdowns -------------------------------------------------------------------------------------

export interface Breakdown {
  key: string;
  label: string;
  total: number;
  bad: number;
  /** Share of this group's nodes that are affected, 0..1. */
  rate: number;
}

/** Affected nodes per group (provider or country), worst first, with the group's own size. */
export function breakdown(
  problems: readonly Problem[],
  totals: ReadonlyMap<string, number>,
  keyOf: (p: Problem) => string,
  labelOf: (key: string) => string = (k) => k,
  top = 8,
): Breakdown[] {
  const bad = new Map<string, number>();
  for (const p of problems) {
    const k = keyOf(p);
    if (!k) continue;
    bad.set(k, (bad.get(k) ?? 0) + 1);
  }
  const out: Breakdown[] = [];
  for (const [key, n] of bad) {
    const total = Math.max(totals.get(key) ?? n, n);
    out.push({ key, label: labelOf(key), total, bad: n, rate: n / total });
  }
  return out.sort((a, b) => b.bad - a.bad || b.rate - a.rate).slice(0, top);
}

/** Node counts per country code and per organisation from the live table. */
export function groupTotals(t: NodeTable): { byCountry: Map<string, number>; byOrg: Map<string, number> } {
  const byCountry = new Map<string, number>();
  const byOrg = new Map<string, number>();
  for (let i = 0; i < t.count; i++) {
    const cc = t.countryCode(i);
    if (cc) byCountry.set(cc, (byCountry.get(cc) ?? 0) + 1);
    const org = t.orgName(i);
    if (org) byOrg.set(org, (byOrg.get(org) ?? 0) + 1);
  }
  return { byCountry, byOrg };
}

// Instant local matches over the NetworkStore (design 2.5: "resolves locally first, then asks the
// server"): nodes by IP and IP:port, hosts, apps from the apps index, countries, providers, FluxOS
// versions and cities. Nothing here touches React; the index is rebuilt lazily when the node table
// has changed enough to matter.
//
// What nodes.bin does not carry stays with the server: collateral outpoints, payment addresses and
// operators resolve through `/search` and arrive merged into the same groups.

import { COUNTRY_SEP } from '../../../api/nodesBin';
import { formatInt } from '../../../lib/format';
import type { NetworkStore } from '../../../store/network';
import { Reach } from '../../../store/nodeTable';
import { matchScore } from './rank';
import type { NodeStatusKind, TierName } from './types';

const TIER_BY_CODE: readonly (TierName | null)[] = [null, 'cumulus', 'nimbus', 'stratus'];
export const TIER_LABEL: Record<TierName, string> = {
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
};

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export interface CountryEntry {
  code: string;
  name: string;
  lower: string;
  count: number;
  lat: number;
  lon: number;
  /** Camera range (globe radii) that frames the country's nodes. */
  alt: number;
}

export interface ProviderEntry {
  name: string;
  lower: string;
  count: number;
}

export interface VersionEntry {
  version: string;
  count: number;
}

export interface CityEntry {
  name: string;
  lower: string;
  count: number;
  lat: number;
  lon: number;
  country: string;
}

export interface LocalIndex {
  /** `versions.Nodes` the index was built at. */
  built: number;
  /** Snapshot the node table was loaded from. */
  snapshotSeq: number;
  total: number;
  countries: CountryEntry[];
  providers: ProviderEntry[];
  versions: VersionEntry[];
  cities: CityEntry[];
  /** Nodes per IP (hosts). */
  hostCounts: Map<string, number>;
}

/** The IP part of an endpoint (`1.2.3.4:16127`, `[2001:db8::1]:16127`). */
export function hostOf(endpoint: string): string {
  if (endpoint.startsWith('[')) {
    const end = endpoint.indexOf(']');
    return end > 0 ? endpoint.slice(1, end) : endpoint;
  }
  const i = endpoint.lastIndexOf(':');
  return i > 0 && endpoint.indexOf(':') === i ? endpoint.slice(0, i) : endpoint;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;

/** Camera range that frames a region of angular radius `rho` radians around its centre. */
export function altForRadius(rho: number): number {
  return clamp(0.3 + 5.2 * rho, 0.45, 3.0);
}

function countryName(entry: string): { code: string; name: string } {
  const i = entry.indexOf(COUNTRY_SEP);
  const code = i < 0 ? entry : entry.slice(0, i);
  if (!code) return { code: '', name: '' };
  const given = i < 0 ? '' : entry.slice(i + 1);
  let named = '';
  if (!given) {
    try {
      named = regionNames?.of(code) ?? '';
    } catch {
      // Not a region code (an unexpected value from the server): the code stands in for the name.
    }
  }
  return { code, name: given || named || code };
}

/** Builds the index in one pass over the node table. */
export function buildLocalIndex(store: NetworkStore): LocalIndex {
  const t = store.nodes;
  const n = t.count;
  const perCountry = new Map<number, { count: number; x: number; y: number; z: number; pts: number[] }>();
  const perOrg = new Map<number, number>();
  const perVersion = new Map<number, number>();
  const hostCounts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const ci = t.country[i] ?? 0;
    if (ci) {
      let c = perCountry.get(ci);
      if (!c) {
        c = { count: 0, x: 0, y: 0, z: 0, pts: [] };
        perCountry.set(ci, c);
      }
      c.count++;
      const lat = t.lat[i]!;
      const lon = t.lon[i]!;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const la = lat * DEG;
        const lo = lon * DEG;
        const x = Math.cos(la) * Math.cos(lo);
        const y = Math.cos(la) * Math.sin(lo);
        const z = Math.sin(la);
        c.x += x;
        c.y += y;
        c.z += z;
        c.pts.push(x, y, z);
      }
    }
    const oi = t.org[i] ?? 0;
    if (oi) perOrg.set(oi, (perOrg.get(oi) ?? 0) + 1);
    const vi = t.version[i] ?? 0;
    if (vi) perVersion.set(vi, (perVersion.get(vi) ?? 0) + 1);
    const ep = t.endpoint(i);
    if (ep) {
      const h = hostOf(ep);
      hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1);
    }
  }

  const countries: CountryEntry[] = [];
  for (const [ci, c] of perCountry) {
    const { code, name } = countryName(t.countries.get(ci));
    const len = Math.hypot(c.x, c.y, c.z);
    let lat = 0;
    let lon = 0;
    let alt = 1.2;
    if (len > 1e-9 && c.pts.length >= 3) {
      const cx = c.x / len;
      const cy = c.y / len;
      const cz = c.z / len;
      lat = Math.asin(clamp(cz, -1, 1)) / DEG;
      lon = Math.atan2(cy, cx) / DEG;
      const dist: number[] = [];
      for (let k = 0; k < c.pts.length; k += 3) {
        const d = c.pts[k]! * cx + c.pts[k + 1]! * cy + c.pts[k + 2]! * cz;
        dist.push(Math.acos(clamp(d, -1, 1)));
      }
      dist.sort((a, b) => a - b);
      const rho = dist[Math.min(dist.length - 1, Math.floor(dist.length * 0.85))] ?? 0.2;
      alt = altForRadius(rho);
    }
    countries.push({ code, name, lower: name.toLowerCase(), count: c.count, lat, lon, alt });
  }
  countries.sort((a, b) => b.count - a.count);

  // Spellings of one provider vary; group by the lower-cased name (the server groups by ASN).
  const byName = new Map<string, ProviderEntry>();
  for (const [oi, count] of perOrg) {
    const name = t.orgs.get(oi);
    if (!name) continue;
    const lower = name.toLowerCase();
    const cur = byName.get(lower);
    if (cur) cur.count += count;
    else byName.set(lower, { name, lower, count });
  }
  const providers = [...byName.values()].sort((a, b) => b.count - a.count);

  const versions: VersionEntry[] = [];
  for (const [vi, count] of perVersion) {
    const version = t.versions.get(vi);
    if (version) versions.push({ version, count });
  }
  versions.sort((a, b) => b.count - a.count);

  const byCity = new Map<string, CityEntry>();
  const locs = t.locations;
  if (locs) {
    for (let l = 1; l < locs.length; l++) {
      const info = locs.info(l);
      if (!info?.city || info.nodeCount <= 0 || !Number.isFinite(info.lat) || !Number.isFinite(info.lon))
        continue;
      const country = countryName(t.countries.get(info.country)).code;
      const key = `${info.city.toLowerCase()}|${country}`;
      const cur = byCity.get(key);
      if (!cur)
        byCity.set(key, {
          name: info.city,
          lower: info.city.toLowerCase(),
          count: info.nodeCount,
          lat: info.lat,
          lon: info.lon,
          country,
        });
      else {
        if (info.nodeCount > cur.count) {
          cur.lat = info.lat;
          cur.lon = info.lon;
        }
        cur.count += info.nodeCount;
      }
    }
  }
  const cities = [...byCity.values()].sort((a, b) => b.count - a.count);

  return {
    built: store.versions.Nodes,
    snapshotSeq: t.snapshotSeq,
    total: n,
    countries,
    providers,
    versions,
    cities,
    hostCounts,
  };
}

const cache = new WeakMap<NetworkStore, LocalIndex>();

/** The cached index, rebuilt when a new snapshot loaded or 50 node changes have passed. */
export function getLocalIndex(store: NetworkStore): LocalIndex {
  const cur = cache.get(store);
  if (cur && cur.snapshotSeq === store.nodes.snapshotSeq && store.versions.Nodes - cur.built < 50) return cur;
  const next = buildLocalIndex(store);
  cache.set(store, next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Nodes and hosts
// ---------------------------------------------------------------------------------------------

export interface IpQuery {
  /** What was typed before any port. */
  host: string;
  /** The port part, when a colon followed. */
  port: string | null;
  /** True for a complete dotted quad. */
  complete: boolean;
  ipv6: boolean;
}

/** Classifies a query that looks like an IP, IP:port or an IP prefix; null for anything else. */
export function classifyIpQuery(q: string): IpQuery | null {
  const s = q.trim();
  if (!s) return null;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    const host = (end > 0 ? s.slice(1, end) : s.slice(1)).toLowerCase();
    if (!/^[0-9a-f:.]*$/.test(host) || host.length === 0) return null;
    const rest = end > 0 ? s.slice(end + 1) : '';
    const port = rest.startsWith(':') ? rest.slice(1) : null;
    if (port !== null && !/^\d{0,5}$/.test(port)) return null;
    return { host, port, complete: end > 0, ipv6: true };
  }
  const m = /^(\d{1,3}(?:\.\d{0,3}){0,3})(?::(\d{0,5}))?$/.exec(s);
  if (m && (m[1]!.includes('.') || m[2] !== undefined)) {
    const host = m[1]!;
    const parts = host.split('.');
    return {
      host,
      port: m[2] ?? null,
      complete: parts.length === 4 && parts.every((p) => p.length > 0),
      ipv6: false,
    };
  }
  return null;
}

export interface NodeMatch {
  /** Row in the node table. */
  row: number;
  score: number;
}

export interface HostMatch {
  ip: string;
  count: number;
  score: number;
  /** A row on that host, for its city and provider. */
  row: number;
}

export interface EndpointMatches {
  nodes: NodeMatch[];
  hosts: HostMatch[];
  /** Matching nodes in all (the list above is capped). */
  total: number;
}

/** Nodes whose endpoint starts with, or contains, the typed IP text, best first. */
export function matchEndpoints(
  store: NetworkStore,
  index: LocalIndex,
  q: IpQuery,
  limit = 8,
  hostLimit = 3,
): EndpointMatches {
  const t = store.nodes;
  const found: NodeMatch[] = [];
  const hostRow = new Map<string, number>();
  const exactPort = q.port !== null && q.port.length > 0;
  const substring = !q.complete && q.host.length >= 5 && !q.ipv6;
  const pass = (loose: boolean) => {
    for (let i = 0; i < t.count; i++) {
      const ep = t.endpoint(i);
      if (!ep) continue;
      const host = hostOf(ep);
      const hit = loose ? host.includes(q.host) : host.startsWith(q.host);
      if (!hit) continue;
      if (
        q.port !== null &&
        q.port.length > 0 &&
        !ep.slice(host.length + (q.ipv6 ? 2 : 1)).startsWith(q.port)
      )
        continue;
      let score: number;
      if (host === q.host && exactPort && ep.endsWith(`:${q.port}`)) score = 100;
      else if (host === q.host) score = 85;
      else score = loose ? 55 : 80 - Math.min(15, host.length - q.host.length);
      // The next in line sorts first among equals.
      const rank = t.rank[i] ?? 0;
      if (rank === 1) score += 2;
      found.push({ row: i, score });
      if (!hostRow.has(host)) hostRow.set(host, i);
    }
  };
  pass(false);
  if (found.length === 0 && substring) pass(true);
  found.sort((a, b) => b.score - a.score || (t.rank[a.row] ?? 0) - (t.rank[b.row] ?? 0));
  const hosts: HostMatch[] = [];
  for (const [ip, row] of hostRow) {
    const count = index.hostCounts.get(ip) ?? 1;
    hosts.push({ ip, count, row, score: ip === q.host ? 95 : 70 });
  }
  hosts.sort((a, b) => b.score - a.score || b.count - a.count || (a.ip < b.ip ? -1 : 1));
  return { nodes: found.slice(0, limit), hosts: hosts.slice(0, hostLimit), total: found.length };
}

// ---------------------------------------------------------------------------------------------
// Describing a node row
// ---------------------------------------------------------------------------------------------

export interface NodeFacts {
  endpoint: string;
  tier: TierName | null;
  city: string;
  countryCode: string;
  /** The country's name (or its code when no name is known). */
  countryName: string;
  org: string;
  /** 1-based queue position, null when not queued. */
  queue: number | null;
  /** The state (the palette draws it with the kit's StatusChip) and its word (the terminal prints it). */
  status: { kind: NodeStatusKind; label: string };
  lat: number;
  lon: number;
}

/** The words are the kit's (a test holds them equal to `statusMeta`), so the terminal and the chips agree. */
export const STATUS_FACT: readonly { kind: NodeStatusKind; label: string }[] = [
  { kind: 'unknown', label: 'Unknown' },
  { kind: 'confirmed', label: 'Confirmed' },
  { kind: 'started', label: 'Started' },
  { kind: 'dos', label: 'DoS' },
  { kind: 'offline', label: 'Offline' },
  { kind: 'expired', label: 'Expired' },
  { kind: 'departed', label: 'Departed' },
];

/** A node the table has marked started but could not be reached. */
export const UNREACHABLE_FACT: { kind: NodeStatusKind; label: string } = {
  kind: 'unreachable',
  label: 'Unreachable',
};

/** The facts a row about node `i` shows, straight from the node table (Unknown stays Unknown). */
export function nodeFacts(store: NetworkStore, i: number): NodeFacts {
  const t = store.nodes;
  const rank = t.rank[i] ?? 0;
  const status =
    t.reachable[i] === Reach.No && t.status[i] === 1
      ? UNREACHABLE_FACT
      : (STATUS_FACT[t.status[i] ?? 0] ?? STATUS_FACT[0]!);
  return {
    endpoint: t.endpoint(i),
    tier: TIER_BY_CODE[t.tier[i] ?? 0] ?? null,
    city: t.locations?.info(t.loc[i] ?? 0)?.city ?? '',
    countryCode: t.countryCode(i),
    countryName: countryName(t.countries.get(t.country[i] ?? 0)).name,
    org: t.orgName(i),
    queue: rank > 0 ? rank : null,
    status,
    lat: t.lat[i]!,
    lon: t.lon[i]!,
  };
}

/** `Stratus, Helsinki, next in line` (parts that are unknown are left out, never zeroed). */
export function nodeSubline(f: NodeFacts): string {
  const parts: string[] = [];
  if (f.tier) parts.push(TIER_LABEL[f.tier]);
  const place = f.city || (f.countryCode ? f.countryName : '');
  parts.push(place || 'Unknown location');
  if (f.queue !== null) parts.push(f.queue === 1 ? 'next in line' : `queue #${formatInt(f.queue)}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Apps, countries, providers, versions, cities
// ---------------------------------------------------------------------------------------------

export interface AppMatch {
  name: string;
  displayName: string;
  owner: string;
  running: number;
  target: number;
  enterprise: boolean;
  score: number;
}

/** Apps whose name matches, best first (exact, prefix, substring, then a typo or two). */
export function matchApps(store: NetworkStore, q: string, limit = 6): { items: AppMatch[]; total: number } {
  const text = q.trim();
  if (text.length < 1) return { items: [], total: 0 };
  const out: AppMatch[] = [];
  for (const a of store.appList()) {
    const s = Math.max(
      matchScore(text, a.display_name, { fuzzy: true }),
      a.name === a.display_name.toLowerCase() ? 0 : matchScore(text, a.name, { fuzzy: true }),
    );
    if (s <= 0) continue;
    out.push({
      name: a.name,
      displayName: a.display_name,
      owner: a.owner,
      running: a.instances_running,
      target: a.instances_target,
      enterprise: a.enterprise,
      score: s,
    });
  }
  out.sort((a, b) => b.score - a.score || b.running - a.running || (a.name < b.name ? -1 : 1));
  return { items: out.slice(0, limit), total: out.length };
}

export interface Scored<T> {
  item: T;
  score: number;
}

function top<T>(list: readonly T[], score: (x: T) => number, limit: number): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const item of list) {
    const s = score(item);
    if (s > 0) out.push({ item, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Countries by name or ISO code. */
export function matchCountries(index: LocalIndex, q: string, limit = 3): Scored<CountryEntry>[] {
  const text = q.trim();
  if (text.length < 2) return [];
  return top(
    index.countries,
    (c) =>
      text.toLowerCase() === c.code.toLowerCase() && text.length === 2
        ? 92
        : matchScore(text, c.name, { fuzzy: true }),
    limit,
  );
}

/** Providers by name (and `AS` numbers are the server's: nodes.bin has names only). */
export function matchProviders(index: LocalIndex, q: string, limit = 3): Scored<ProviderEntry>[] {
  const text = q.trim();
  if (text.length < 3) return [];
  return top(index.providers, (p) => matchScore(text, p.name), limit);
}

/** FluxOS versions: `8.2`, `8.20.0`, `v8.20`. */
export function matchVersions(index: LocalIndex, q: string, limit = 2): Scored<VersionEntry>[] {
  const text = q.trim().replace(/^v/i, '');
  if (!/^\d+(\.\d*)*$/.test(text) || !text.includes('.')) return [];
  return top(index.versions, (v) => (v.version === text ? 95 : v.version.startsWith(text) ? 70 : 0), limit);
}

/** Cities by name. */
export function matchCities(index: LocalIndex, q: string, limit = 3): Scored<CityEntry>[] {
  const text = q.trim();
  if (text.length < 2) return [];
  return top(index.cities, (c) => matchScore(text, c.name, { fuzzy: true }), limit);
}

/** Share of the network, as a rounded whole percent text (`24%`); under one percent says so. */
export function shareText(count: number, total: number): string {
  if (total <= 0) return '';
  const pct = (count / total) * 100;
  if (pct < 1) return 'under 1% of the network';
  return `${Math.round(pct)}% of the network`;
}

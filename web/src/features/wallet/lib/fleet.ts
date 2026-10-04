// The fleet table's data: one row per node (the roster joined with the live node table, the next payment and
// the health findings), the columns a viewer can pick, the filters, the grouping and the CSV. Pure functions;
// `tabs/Fleet.tsx` draws them.

import type { SortValue } from '../../../ui';
import { type FleetNode, type FleetState, fleetState } from '../../inspect/derive/operator';
import { type NodeStatusKind, nodeStatusKind } from '../../inspect/derive/statusKind';
import type { HealthReasonKind, NodeAttention, NodeRow, PayTier, WalletPayout } from '../types';
import { type CsvCell, dateTimeStamp } from './csv';
import { type Severity, worstSeverity } from './health';
import { flux } from './money';

export interface FleetRow {
  /** The node's collateral outpoint, the key every link and filter uses (`#id` for a node with none). */
  key: string;
  /** The id in this session's node table: what the globe is told. */
  id: number;
  /** False when the live table does not know the node (it left, or the table is not loaded). */
  present: boolean;
  endpoint: string;
  ip: string;
  tier: PayTier | 'unknown';
  state: FleetState;
  statusKind: NodeStatusKind;
  /** The kinds of finding the server raised for this node. */
  issues: HealthReasonKind[];
  severity: Severity | null;
  /** The next payment: when (unix ms) and how much (FLUX). */
  etaMs: number | null;
  amount: number | null;
  /** Place in the tier queue, counting from 1. */
  place: number | null;
  lastPaidHeight: number | null;
  sinceConfirm: number | null;
  countryCode: string;
  country: string;
  city: string;
  provider: string;
  version: string;
  arcane: boolean | null;
  cores: number;
  ramGb: number;
  ssdGb: number;
  appCount: number;
  addedHeight: number | null;
  /** FLUX per day, an estimate; null when the tier's payout is not known. */
  perDay: number | null;
  paymentAddress: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Joins what the page knows about each node. `nodes` is the roster joined with the live table (`buildFleet`);
 * `roster` is the server's rows (for the city, the country's name, the age); the payouts and findings come from the
 * wallet itself. Everything is looked up by outpoint, so one pass over each list is all it takes, even for a
 * thousand nodes.
 */
export function buildFleetRows(
  nodes: readonly FleetNode[],
  roster: readonly NodeRow[],
  payouts: readonly WalletPayout[],
  attention: readonly NodeAttention[],
): FleetRow[] {
  const byOutpoint = new Map<string, NodeRow>();
  for (const r of roster) byOutpoint.set(r.outpoint, r);
  const pay = new Map<string, WalletPayout>();
  for (const p of payouts) if (!pay.has(p.node_key)) pay.set(p.node_key, p);
  const issues = new Map<string, NodeAttention>();
  for (const a of attention) issues.set(a.node_key, a);

  return nodes.map((n) => {
    const key = n.outpoint || `#${n.id}`;
    const row = byOutpoint.get(n.outpoint);
    const p = pay.get(n.outpoint);
    const a = issues.get(n.outpoint);
    const kinds = a ? [...new Set(a.reasons.map((r) => r.kind))] : [];
    return {
      key,
      id: n.id,
      present: n.present,
      endpoint: n.endpoint,
      ip: n.ip,
      tier: n.tier,
      state: fleetState(n),
      statusKind: n.present
        ? nodeStatusKind({ status: n.status, reachable: n.reachable, sinceConfirm: n.sinceConfirm })
        : 'departed',
      issues: kinds,
      severity: a ? worstSeverity(a.reasons) : null,
      etaMs: p ? p.eta_ms : null,
      amount: p ? flux(p.amount) : null,
      place: n.position === null ? null : n.position + 1,
      lastPaidHeight: n.lastPaid,
      sinceConfirm: n.sinceConfirm,
      countryCode: n.country,
      country: row?.country ?? n.country,
      city: row?.city ?? '',
      provider: n.org,
      version: n.version ?? '',
      arcane: row?.arcane ?? null,
      cores: n.cores,
      ramGb: n.ramGb,
      ssdGb: n.ssdGb,
      appCount: n.appCount,
      addedHeight: row?.added_height ?? null,
      perDay: n.perDay,
      paymentAddress: n.paymentAddress,
      lat: n.lat,
      lon: n.lon,
    };
  });
}

// ---- state buckets --------------------------------------------------------------------------------

/** The three words a filter offers for how a node is doing. */
export type Bucket = 'healthy' | 'attention' | 'down';

export const BUCKETS: readonly Bucket[] = ['healthy', 'attention', 'down'];

export const BUCKET_LABEL: Record<Bucket, string> = {
  healthy: 'Healthy',
  attention: 'Needs attention',
  down: 'Down or gone',
};

export function bucketOf(r: Pick<FleetRow, 'state' | 'issues'>): Bucket {
  if (r.state === 'down' || r.state === 'gone') return 'down';
  if (r.state === 'risk' || r.state === 'pending' || r.issues.length > 0) return 'attention';
  return 'healthy';
}

// ---- columns --------------------------------------------------------------------------------------

export type ColumnId =
  | 'node'
  | 'state'
  | 'payout'
  | 'place'
  | 'paid'
  | 'checkin'
  | 'perDay'
  | 'country'
  | 'city'
  | 'provider'
  | 'version'
  | 'cores'
  | 'ram'
  | 'ssd'
  | 'apps'
  | 'age';

export interface ColumnSpec {
  id: ColumnId;
  /** The header, and the label in the picker. */
  label: string;
  /** The picker's group heading. */
  group: 'Identity' | 'Payments' | 'Place' | 'Software and hardware';
  numeric?: boolean;
  /** What the column sorts by (missing values go last). */
  sort: (r: FleetRow) => SortValue;
}

const STATE_ORDER: Record<Bucket, number> = { down: 0, attention: 1, healthy: 2 };

export const COLUMN_SPECS: readonly ColumnSpec[] = [
  { id: 'node', label: 'Node', group: 'Identity', sort: (r) => r.endpoint || null },
  {
    id: 'state',
    label: 'State',
    group: 'Identity',
    sort: (r) => STATE_ORDER[bucketOf(r)] * 10 + (r.severity === 'crit' ? 0 : r.severity === 'warn' ? 1 : 2),
  },
  { id: 'payout', label: 'Next payout', group: 'Payments', numeric: true, sort: (r) => r.etaMs },
  { id: 'place', label: 'Queue place', group: 'Payments', numeric: true, sort: (r) => r.place },
  { id: 'paid', label: 'Last paid', group: 'Payments', numeric: true, sort: (r) => r.lastPaidHeight },
  { id: 'checkin', label: 'Check-in age', group: 'Payments', numeric: true, sort: (r) => r.sinceConfirm },
  { id: 'perDay', label: 'FLUX per day', group: 'Payments', numeric: true, sort: (r) => r.perDay },
  { id: 'country', label: 'Country', group: 'Place', sort: (r) => r.country || null },
  { id: 'city', label: 'City', group: 'Place', sort: (r) => r.city || null },
  { id: 'provider', label: 'Provider', group: 'Place', sort: (r) => r.provider || null },
  { id: 'version', label: 'FluxOS', group: 'Software and hardware', sort: (r) => r.version || null },
  {
    id: 'cores',
    label: 'Cores',
    group: 'Software and hardware',
    numeric: true,
    sort: (r) => r.cores || null,
  },
  { id: 'ram', label: 'RAM', group: 'Software and hardware', numeric: true, sort: (r) => r.ramGb || null },
  { id: 'ssd', label: 'SSD', group: 'Software and hardware', numeric: true, sort: (r) => r.ssdGb || null },
  { id: 'apps', label: 'Apps', group: 'Software and hardware', numeric: true, sort: (r) => r.appCount },
  { id: 'age', label: 'Age', group: 'Software and hardware', numeric: true, sort: (r) => r.addedHeight },
];

export const DEFAULT_COLUMNS: readonly ColumnId[] = [
  'node',
  'state',
  'payout',
  'paid',
  'country',
  'provider',
  'version',
  'apps',
];

const COLUMN_IDS = new Set<string>(COLUMN_SPECS.map((c) => c.id));

export const columnSpec = (id: ColumnId): ColumnSpec => COLUMN_SPECS.find((c) => c.id === id) as ColumnSpec;

/** Cleans a stored column list: known columns only, no repeats, in the table's own order, `node` always first. */
export function normalizeColumns(ids: unknown): ColumnId[] {
  if (!Array.isArray(ids)) return [...DEFAULT_COLUMNS];
  const want = new Set(ids.filter((x): x is string => typeof x === 'string' && COLUMN_IDS.has(x)));
  want.add('node');
  return COLUMN_SPECS.filter((c) => want.has(c.id)).map((c) => c.id);
}

// ---- filters --------------------------------------------------------------------------------------

export interface FleetFilter {
  text: string;
  tiers: readonly PayTier[];
  buckets: readonly Bucket[];
  country: string | null;
  provider: string | null;
  version: string | null;
}

export const NO_FILTER: FleetFilter = {
  text: '',
  tiers: [],
  buckets: [],
  country: null,
  provider: null,
  version: null,
};

export function isFiltered(f: FleetFilter): boolean {
  return (
    f.text.trim() !== '' ||
    f.tiers.length > 0 ||
    f.buckets.length > 0 ||
    f.country !== null ||
    f.provider !== null ||
    f.version !== null
  );
}

/** How many filters are set (the count on the Filters button). */
export function filterCount(f: FleetFilter): number {
  return (
    (f.text.trim() ? 1 : 0) +
    (f.tiers.length ? 1 : 0) +
    (f.buckets.length ? 1 : 0) +
    (f.country !== null ? 1 : 0) +
    (f.provider !== null ? 1 : 0) +
    (f.version !== null ? 1 : 0)
  );
}

function haystack(r: FleetRow): string {
  return [r.endpoint, r.key, r.provider, r.city, r.country, r.countryCode, r.version]
    .join('\n')
    .toLowerCase();
}

/** The rows that pass every filter that is set (a filter with nothing chosen passes everything). */
export function filterFleet(rows: readonly FleetRow[], f: FleetFilter): FleetRow[] {
  if (!isFiltered(f)) return [...rows];
  const needle = f.text.trim().toLowerCase();
  const tiers = new Set<string>(f.tiers);
  const buckets = new Set<string>(f.buckets);
  return rows.filter(
    (r) =>
      (tiers.size === 0 || tiers.has(r.tier)) &&
      (buckets.size === 0 || buckets.has(bucketOf(r))) &&
      (f.country === null || r.countryCode === f.country) &&
      (f.provider === null || r.provider === f.provider) &&
      (f.version === null || r.version === f.version) &&
      (needle === '' || haystack(r).includes(needle)),
  );
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

function tally(
  rows: readonly FleetRow[],
  key: (r: FleetRow) => string,
  label: (r: FleetRow) => string,
): Facet[] {
  const by = new Map<string, Facet>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const f = by.get(k);
    if (f) f.count++;
    else by.set(k, { value: k, label: label(r) || k, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
}

export interface Facets {
  country: Facet[];
  provider: Facet[];
  version: Facet[];
}

/** The choices each select offers, with how many nodes each holds, biggest first. */
export function facetsOf(rows: readonly FleetRow[]): Facets {
  return {
    country: tally(
      rows,
      (r) => r.countryCode,
      (r) => r.country || r.countryCode,
    ),
    provider: tally(
      rows,
      (r) => r.provider,
      (r) => r.provider,
    ),
    version: tally(
      rows,
      (r) => r.version,
      (r) => r.version,
    ),
  };
}

// ---- grouping -------------------------------------------------------------------------------------

export type GroupBy = 'none' | 'tier' | 'state' | 'country' | 'city' | 'provider' | 'version';

export const GROUP_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'tier', label: 'Tier' },
  { value: 'state', label: 'State' },
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
  { value: 'provider', label: 'Provider' },
  { value: 'version', label: 'FluxOS version' },
];

export function isGroupBy(v: unknown): v is GroupBy {
  return typeof v === 'string' && GROUP_OPTIONS.some((o) => o.value === v);
}

const TIER_WORD: Record<string, string> = { cumulus: 'Cumulus', nimbus: 'Nimbus', stratus: 'Stratus' };

/** The group a row falls in, as `[key, label]`. A row with no value goes to "Unknown". */
export function groupOf(r: FleetRow, by: Exclude<GroupBy, 'none'>): [string, string] {
  switch (by) {
    case 'tier':
      return [r.tier, TIER_WORD[r.tier] ?? 'Unknown tier'];
    case 'state': {
      const b = bucketOf(r);
      return [b, BUCKET_LABEL[b]];
    }
    case 'country':
      return [r.countryCode || '?', r.country || 'Unknown country'];
    case 'city':
      return r.city
        ? [`${r.countryCode}:${r.city}`, `${r.city}${r.country ? `, ${r.country}` : ''}`]
        : ['?', 'Unknown city'];
    case 'provider':
      return [r.provider || '?', r.provider || 'Unknown provider'];
    case 'version':
      return [r.version || '?', r.version || 'Unknown version'];
  }
}

export interface FleetGroup {
  key: string;
  label: string;
  rows: FleetRow[];
  nodes: number;
  healthy: number;
  /** Nodes that need attention or are down. */
  trouble: number;
  /** FLUX per day over the nodes whose payout is known; null when none is. */
  perDay: number | null;
  /** The soonest next payment in the group, unix ms. */
  nextEtaMs: number | null;
  /** Payments due in the group, FLUX. */
  due: number;
  apps: number;
}

/** Groups rows by a dimension, biggest group first (ties by label); rows keep their given order inside. */
export function groupFleet(rows: readonly FleetRow[], by: GroupBy): FleetGroup[] {
  if (by === 'none') return [];
  const groups = new Map<string, FleetGroup>();
  for (const r of rows) {
    const [key, label] = groupOf(r, by);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label,
        rows: [],
        nodes: 0,
        healthy: 0,
        trouble: 0,
        perDay: null,
        nextEtaMs: null,
        due: 0,
        apps: 0,
      };
      groups.set(key, g);
    }
    g.rows.push(r);
    g.nodes++;
    if (bucketOf(r) === 'healthy') g.healthy++;
    else g.trouble++;
    if (r.perDay !== null) g.perDay = (g.perDay ?? 0) + r.perDay;
    if (r.etaMs !== null) g.nextEtaMs = g.nextEtaMs === null ? r.etaMs : Math.min(g.nextEtaMs, r.etaMs);
    if (r.amount !== null) g.due += r.amount;
    g.apps += r.appCount;
  }
  return [...groups.values()].sort((a, b) => b.nodes - a.nodes || a.label.localeCompare(b.label, 'en'));
}

// ---- CSV ------------------------------------------------------------------------------------------

interface CsvColumn {
  header: string;
  value: (r: FleetRow) => CsvCell;
}

/** Every column of the nodes export, whatever the table shows: an export is the whole record. */
const CSV_COLUMNS: readonly CsvColumn[] = [
  { header: 'node_outpoint', value: (r) => r.key },
  { header: 'endpoint', value: (r) => r.endpoint },
  { header: 'tier', value: (r) => r.tier },
  { header: 'state', value: (r) => bucketOf(r) },
  { header: 'status', value: (r) => r.statusKind },
  { header: 'issues', value: (r) => r.issues.join('; ') },
  { header: 'next_payout_utc', value: (r) => (r.etaMs === null ? null : dateTimeStamp(r.etaMs)) },
  { header: 'next_payout_flux', value: (r) => r.amount },
  { header: 'queue_place', value: (r) => r.place },
  { header: 'last_paid_height', value: (r) => r.lastPaidHeight },
  { header: 'blocks_since_checkin', value: (r) => r.sinceConfirm },
  { header: 'est_flux_per_day', value: (r) => (r.perDay === null ? null : Math.round(r.perDay * 1e4) / 1e4) },
  { header: 'country_code', value: (r) => r.countryCode },
  { header: 'country', value: (r) => r.country },
  { header: 'city', value: (r) => r.city },
  { header: 'provider', value: (r) => r.provider },
  { header: 'fluxos_version', value: (r) => r.version },
  { header: 'arcane', value: (r) => r.arcane },
  { header: 'cores', value: (r) => r.cores || null },
  { header: 'ram_gb', value: (r) => r.ramGb || null },
  { header: 'ssd_gb', value: (r) => r.ssdGb || null },
  { header: 'apps', value: (r) => r.appCount },
  { header: 'added_height', value: (r) => r.addedHeight },
  { header: 'payment_address', value: (r) => r.paymentAddress },
];

export const nodesCsvHeader = (): string[] => CSV_COLUMNS.map((c) => c.header);

export const nodesCsvRows = (rows: readonly FleetRow[]): CsvCell[][] =>
  rows.map((r) => CSV_COLUMNS.map((c) => c.value(r)));

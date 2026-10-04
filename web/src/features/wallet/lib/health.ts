// Health and risk, in plain words: the issues a fleet has and what to do about them, how its hardware stands
// against the network's nodes of the same tier, how concentrated it is, and how reliably its nodes stayed up.
// Pure functions; the server says what is wrong, this says what it means.

import type {
  BenchBand,
  BenchMetric,
  Concentration,
  ConcentrationBy,
  HealthReason,
  HealthReasonKind,
  NodeAttention,
} from '../types';

// ---- issues ---------------------------------------------------------------------------------------

export type Severity = 'crit' | 'warn' | 'info';

interface Copy {
  severity: Severity;
  title: (n: number) => string;
  why: string;
  fix: string;
}

const nodes = (n: number) => `${n} ${n === 1 ? 'node' : 'nodes'}`;

/** What each kind of reason means and what to do about it, in the voice of the app: what happened, what next. */
export const ISSUE_COPY: Record<HealthReasonKind, Copy> = {
  dos: {
    severity: 'crit',
    title: (n) => `${nodes(n)} on the DoS list`,
    why: 'These nodes failed a benchmark or broke a network rule, so the queue skips them for 720 blocks, about six hours. They earn nothing meanwhile.',
    fix: 'Open the node in FluxOS and read its benchmark result. Free CPU, disk or bandwidth if a metric fell short, and check its ports are open. The ban lifts on its own.',
  },
  bench_failed: {
    severity: 'crit',
    title: (n) => `${nodes(n)} failed the benchmark`,
    why: 'A failed benchmark can lower a node to a smaller tier or put it on the DoS list.',
    fix: 'See the measurement that fell short below. Stop other load on the host, then run the benchmark again from FluxOS.',
  },
  expiring_soon: {
    severity: 'crit',
    title: (n) => `${nodes(n)} close to expiring`,
    why: 'A node that goes 640 blocks, about 5.3 hours, without checking in is dropped from the network and stops earning.',
    fix: 'Make sure fluxd is running and synced and that the node can reach the network. Check-ins happen on their own about every 500 blocks.',
  },
  unreachable: {
    severity: 'warn',
    title: (n) => `${nodes(n)} not reachable`,
    why: 'The last Atlas sweep could not reach their API port, so their health cannot be seen from outside.',
    fix: 'Check the node is online, that its API port is forwarded and that the firewall allows it.',
  },
  bench_error: {
    severity: 'warn',
    title: (n) => `${nodes(n)} could not finish a benchmark`,
    why: 'The benchmark stopped with an error before it could score the node.',
    fix: 'Update FluxOS, check free disk space and memory, then run the benchmark again.',
  },
  low_headroom: {
    severity: 'warn',
    title: (n) => `${nodes(n)} with little headroom`,
    why: 'A measurement sits close to the tier minimum, so a small dip would fail the next benchmark.',
    fix: 'Reduce other load on the host, or move the node to stronger hardware, before the next benchmark.',
  },
  version_outdated: {
    severity: 'info',
    title: (n) => `${nodes(n)} behind on FluxOS`,
    why: 'Older FluxOS versions miss fixes and can be skipped when apps are placed.',
    fix: 'Update FluxOS from the node (ArcaneOS nodes update themselves).',
  },
};

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };

export interface IssueNode {
  key: string;
  detail: string;
  metric: string | null;
  value: number | null;
  threshold: number | null;
}

export interface IssueGroup {
  kind: HealthReasonKind;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  nodes: IssueNode[];
}

/**
 * The attention list as issues, one per kind (two hundred nodes behind on a version are one issue, not two
 * hundred rows). Worst first: by severity, then by how many nodes it touches. A node with two reasons is in
 * two groups.
 */
export function groupIssues(attention: readonly NodeAttention[]): IssueGroup[] {
  const by = new Map<HealthReasonKind, IssueNode[]>();
  for (const a of attention) {
    for (const r of a.reasons) {
      if (!(r.kind in ISSUE_COPY)) continue;
      const list = by.get(r.kind) ?? [];
      list.push({
        key: a.node_key,
        detail: r.detail,
        metric: r.metric,
        value: r.value,
        threshold: r.threshold,
      });
      by.set(r.kind, list);
    }
  }
  const out: IssueGroup[] = [];
  for (const [kind, list] of by) {
    const c = ISSUE_COPY[kind];
    out.push({
      kind,
      severity: c.severity,
      title: c.title(list.length),
      why: c.why,
      fix: c.fix,
      nodes: list,
    });
  }
  return out.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.nodes.length - a.nodes.length,
  );
}

/** How many nodes have at least one reason. */
export const attentionCount = (attention: readonly NodeAttention[]): number =>
  attention.filter((a) => a.reasons.length > 0).length;

/** The worst severity among a node's reasons. */
export function worstSeverity(reasons: readonly HealthReason[]): Severity | null {
  let worst: Severity | null = null;
  for (const r of reasons) {
    const s = ISSUE_COPY[r.kind]?.severity;
    if (s && (worst === null || SEVERITY_RANK[s] < SEVERITY_RANK[worst])) worst = s;
  }
  return worst;
}

/** `480 of at least 450 (7% over)`: a measurement against its threshold, when the server sent both. */
export function marginText(n: Pick<IssueNode, 'value' | 'threshold'>, unit = ''): string | null {
  if (n.value === null || n.threshold === null) return null;
  const u = unit ? ` ${unit}` : '';
  const diff = n.threshold !== 0 ? (n.value - n.threshold) / n.threshold : null;
  const tail =
    diff === null
      ? ''
      : diff >= 0
        ? ` (${(diff * 100).toFixed(0)}% over)`
        : ` (${(-diff * 100).toFixed(0)}% under)`;
  return `${trim(n.value)}${u} against ${trim(n.threshold)}${u}${tail}`;
}

const trim = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

// ---- benchmarks -----------------------------------------------------------------------------------

export interface MetricMeta {
  label: string;
  unit: string;
  /** Fraction digits when a value is written. */
  digits: number;
}

export const METRICS: readonly BenchMetric[] = [
  'eps',
  'cores',
  'ram_gb',
  'ssd_gb',
  'disk_write_mbs',
  'down_mbps',
  'up_mbps',
];

export const METRIC_META: Record<BenchMetric, MetricMeta> = {
  eps: { label: 'CPU events per second', unit: 'EPS', digits: 1 },
  cores: { label: 'CPU cores', unit: 'cores', digits: 0 },
  ram_gb: { label: 'Memory', unit: 'GB', digits: 0 },
  ssd_gb: { label: 'SSD', unit: 'GB', digits: 0 },
  disk_write_mbs: { label: 'Disk write', unit: 'MB/s', digits: 0 },
  down_mbps: { label: 'Download', unit: 'Mbps', digits: 0 },
  up_mbps: { label: 'Upload', unit: 'Mbps', digits: 0 },
};

export function metricValue(v: number, metric: BenchMetric): string {
  const d = METRIC_META[metric].digits;
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export type BandStatus = 'below' | 'near' | 'ok' | 'untested';

/** Within this share above a tier's minimum counts as "near": a small dip would fail. */
export const NEAR_MARGIN = 0.1;

/**
 * Where the weakest node of the fleet stands against the tier's minimum: `below` fails it, `near` is within a tenth
 * above it, `ok` clears it, `untested` when the tier states no minimum for the metric.
 */
export function bandStatus(b: Pick<BenchBand, 'fleet_min' | 'minimum'>): BandStatus {
  if (b.minimum === null || b.minimum <= 0) return 'untested';
  if (b.fleet_min < b.minimum) return 'below';
  return b.fleet_min < b.minimum * (1 + NEAR_MARGIN) ? 'near' : 'ok';
}

/** The fleet's median against the network's: `above`, `below` or `level` (within a twentieth). */
export function medianStanding(b: Pick<BenchBand, 'fleet_median' | 'network'>): {
  side: 'above' | 'below' | 'level';
  /** The fleet median over the network median, minus one. */
  ratio: number | null;
} {
  const p50 = b.network.p50;
  if (!(p50 > 0)) return { side: 'level', ratio: null };
  const ratio = b.fleet_median / p50 - 1;
  return { side: ratio > 0.05 ? 'above' : ratio < -0.05 ? 'below' : 'level', ratio };
}

export interface BandScale {
  lo: number;
  hi: number;
}

/** The axis of one band: room around every number it draws, never below zero. */
export function bandScale(b: BenchBand): BandScale {
  const values = [b.network.p10, b.network.p50, b.network.p90, b.fleet_median, b.fleet_min];
  if (b.minimum !== null) values.push(b.minimum);
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || Math.abs(hi) || 1;
  return { lo: Math.max(0, lo - span * 0.12), hi: hi + span * 0.12 };
}

/** One sentence about a band, for the text twin and a screen reader. */
export function bandSentence(b: BenchBand): string {
  const m = METRIC_META[b.metric];
  const unit = m.unit === 'cores' ? 'cores' : m.unit;
  const median = `${metricValue(b.fleet_median, b.metric)} ${unit}`;
  const net = `${metricValue(b.network.p50, b.metric)} ${unit}`;
  const s = medianStanding(b);
  const stand =
    s.side === 'level'
      ? 'level with'
      : s.ratio === null
        ? s.side
        : `${Math.abs(s.ratio * 100).toFixed(0)}% ${s.side}`;
  const min =
    b.minimum === null
      ? ' The tier states no minimum.'
      : bandStatus(b) === 'below'
        ? ` The weakest node, ${metricValue(b.fleet_min, b.metric)}, is below the minimum of ${metricValue(b.minimum, b.metric)}.`
        : ` The weakest node is ${metricValue(b.fleet_min, b.metric)}, against a minimum of ${metricValue(b.minimum, b.metric)}.`;
  return `${m.label}: the fleet median is ${median}, ${stand} the network median ${net}.${min}`;
}

// ---- concentration --------------------------------------------------------------------------------

export type RiskLevel = 'low' | 'moderate' | 'high';

/** The index's bands, on a 0 to 1 scale: under 0.15 diversified, 0.15 to 0.25 moderate, over it concentrated. */
export const HHI_BANDS = { moderate: 0.15, high: 0.25 } as const;

export function riskLevel(hhi: number): RiskLevel {
  return hhi >= HHI_BANDS.high ? 'high' : hhi >= HHI_BANDS.moderate ? 'moderate' : 'low';
}

const BY_WORD: Record<ConcentrationBy, { one: string; plural: string }> = {
  country: { one: 'country', plural: 'countries' },
  city: { one: 'city', plural: 'cities' },
  provider: { one: 'provider', plural: 'providers' },
};

export interface ConcentrationRead {
  by: ConcentrationBy;
  level: RiskLevel;
  /** The risk, said plainly: "One provider outage takes down 100% of this fleet." */
  headline: string;
  /** The word on the gauge. */
  label: string;
  /** How many equal-sized groups would spread the fleet as thinly (1 over the index). */
  effective: number;
  top: { label: string; nodes: number; share: number } | null;
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/** What an index and a top share mean for the viewer. */
export function readConcentration(c: Concentration, total: number): ConcentrationRead {
  const level = riskLevel(c.hhi);
  const word = BY_WORD[c.by];
  const lead = c.buckets[0] ?? null;
  const top = lead ? { label: lead.label, nodes: lead.nodes, share: c.top_share } : null;
  const label = level === 'low' ? 'Diversified' : level === 'moderate' ? 'Moderate' : 'Concentrated';
  const effective = c.hhi > 0 ? 1 / c.hhi : 0;
  let headline: string;
  if (total <= 0 || !lead) {
    headline = `No ${word.plural} to compare: the fleet has no nodes.`;
  } else if (c.buckets.length === 1) {
    headline = `One ${word.one} outage takes down 100% of this fleet.`;
  } else if (c.by === 'provider') {
    headline = `One provider outage, ${lead.label}, takes down ${pct(c.top_share)} of this fleet.`;
  } else {
    headline = `Losing ${lead.label} would take down ${pct(c.top_share)} of this fleet.`;
  }
  return { by: c.by, level, headline, label, effective, top };
}

/** `Provider`, `Country`, `City`: the dimension as a heading. */
export const concentrationTitle = (by: ConcentrationBy): string =>
  BY_WORD[by].one.replace(/^./, (c) => c.toUpperCase());

// ---- uptime ---------------------------------------------------------------------------------------

export interface UptimeBand {
  id: string;
  label: string;
  /** Inclusive lower bound and exclusive upper bound, in percent (the last band's upper bound includes 100). */
  from: number;
  to: number;
  count: number;
}

const UPTIME_EDGES: readonly [number, number, string][] = [
  [0, 90, 'Under 90%'],
  [90, 95, '90 to 95%'],
  [95, 98, '95 to 98%'],
  [98, 99.5, '98 to 99.5%'],
  [99.5, 100.0001, '99.5 to 100%'],
];

/** Sorts nodes' uptime percentages into bands for a histogram. A null (not observed) is left out. */
export function uptimeBands(percentages: readonly (number | null)[]): UptimeBand[] {
  const bands: UptimeBand[] = UPTIME_EDGES.map(([from, to, label]) => ({
    id: label,
    label,
    from,
    to,
    count: 0,
  }));
  for (const p of percentages) {
    if (p === null || !Number.isFinite(p)) continue;
    const v = Math.min(100, Math.max(0, p));
    const band = bands.find((b) => v >= b.from && v < b.to);
    if (band) band.count++;
  }
  return bands;
}

/** The median of the known percentages, or null. */
export function medianOf(values: readonly (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/**
 * Which nodes to measure when only some can be: every `n`th of the fleet, so the sample spans its whole range
 * of ages and hosts, never just the first few.
 */
export function evenSample<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const out: T[] = [];
  const step = items.length / limit;
  for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)] as T);
  return out;
}

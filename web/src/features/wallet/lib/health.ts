// Health and risk, in plain words: the issues a fleet has and what to do about them, how its hardware stands
// against the network's nodes of the same tier, how concentrated it is, and how reliably its nodes stayed up.
// Pure functions; the server says what is wrong, this says what it means.

import type {
  BenchMetric,
  ConcentrationBy,
  HealthKind,
  HealthReason,
  NodeAttention,
  WalletBenchmark,
  WalletConcentration,
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
export const ISSUE_COPY: Record<HealthKind, Copy> = {
  dos: {
    severity: 'crit',
    title: (n) => `${nodes(n)} on the DoS list`,
    why: 'These nodes were not confirmed in time, so the network moved them to the DoS list. The queue skips them and they cannot be confirmed again for 720 blocks, about six hours, and they earn nothing meanwhile.',
    fix: 'Check that fluxd is running and synced, and that the node can reach the network. The ban lifts on its own; the node can be started again once it does.',
  },
  bench_failed: {
    severity: 'crit',
    title: (n) => `${nodes(n)} failed the benchmark`,
    why: 'A failed benchmark can lower a node to a smaller tier or get it removed from the list.',
    fix: 'See the measurements that fell short below. Stop other load on the host, then run the benchmark again from FluxOS.',
  },
  expiring_soon: {
    severity: 'crit',
    title: (n) => `${nodes(n)} close to expiring`,
    why: 'A node has 640 blocks, about 5.3 hours, from its last confirmation to confirm again, or it drops off the list and stops earning. Healthy nodes confirm well inside that; these have under 120 blocks, about an hour, left.',
    fix: 'Make sure fluxd is running and synced and that the node can reach the network. It confirms on its own as soon as it can.',
  },
  unreachable: {
    severity: 'warn',
    title: (n) => `${nodes(n)} not reachable`,
    why: 'The last Atlas sweep could not reach their API port, so their health cannot be seen from outside. They may still be earning.',
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
    title: (n) => `${nodes(n)} close to a tier minimum`,
    why: 'A measured figure (CPU, disk write or bandwidth) sits within a tenth of what the tier requires. These vary from run to run, so a small dip can fail the next benchmark.',
    fix: 'Reduce other load on the host, or move the node to stronger hardware, before the next benchmark.',
  },
  version_outdated: {
    severity: 'info',
    title: (n) => `${nodes(n)} behind on FluxOS`,
    why: 'Most of the network runs a newer FluxOS. Older versions miss fixes and can be skipped when apps are placed.',
    fix: 'Update FluxOS from the node (ArcaneOS nodes update themselves).',
  },
};

/**
 * Two kinds say more than one thing, so they split by what the server measured: a node below a tier minimum is a
 * failure already and one near it is a warning; a node behind on FluxOS is not behind on fluxbench.
 */
const VARIANT_COPY: Record<string, Copy> = {
  'low_headroom:below': {
    severity: 'crit',
    title: (n) => `${nodes(n)} below a tier minimum`,
    why: 'A measurement is under what the tier requires, so the node will fail its next benchmark and can lose its tier or be removed.',
    fix: 'Move the node to hardware that meets its tier, or free the resource that fell short (disk, CPU, bandwidth, memory), then run the benchmark again.',
  },
  'low_headroom:near': ISSUE_COPY.low_headroom,
  'version_outdated:flux_os': ISSUE_COPY.version_outdated,
  'version_outdated:bench': {
    severity: 'info',
    title: (n) => `${nodes(n)} behind on fluxbench`,
    why: 'Most of the network runs a newer fluxbench, the tool that scores a node. Keeping it current keeps the scores comparable and picks up fixes.',
    fix: 'Update fluxbench with FluxOS (ArcaneOS nodes update themselves).',
  },
};

/** The variant of a reason, for the two kinds that have them (`low_headroom`, `version_outdated`). */
export function variantOf(r: Pick<HealthReason, 'kind' | 'metric' | 'value' | 'threshold'>): string | null {
  if (r.kind === 'low_headroom') {
    return r.value !== null && r.threshold !== null && r.value < r.threshold ? 'below' : 'near';
  }
  if (r.kind === 'version_outdated') return r.metric === 'bench' ? 'bench' : 'flux_os';
  return null;
}

function copyOf(r: Pick<HealthReason, 'kind' | 'metric' | 'value' | 'threshold'>): Copy | null {
  const v = variantOf(r);
  return (v ? VARIANT_COPY[`${r.kind}:${v}`] : undefined) ?? ISSUE_COPY[r.kind] ?? null;
}

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };

export interface IssueNode {
  key: string;
  detail: string;
  metric: string | null;
  value: number | null;
  threshold: number | null;
}

export interface IssueGroup {
  /** `kind`, or `kind:variant` where a kind splits. */
  id: string;
  kind: HealthKind;
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
  const by = new Map<string, { kind: HealthKind; copy: Copy; list: IssueNode[] }>();
  for (const a of attention) {
    for (const r of a.reasons) {
      const copy = copyOf(r);
      if (!copy) continue;
      const variant = variantOf(r);
      const id = variant ? `${r.kind}:${variant}` : r.kind;
      let g = by.get(id);
      if (!g) {
        g = { kind: r.kind, copy, list: [] };
        by.set(id, g);
      }
      g.list.push({
        key: a.node_key,
        detail: r.detail,
        metric: r.metric,
        value: r.value,
        threshold: r.threshold,
      });
    }
  }
  const out: IssueGroup[] = [];
  for (const [id, { kind, copy, list }] of by) {
    out.push({
      id,
      kind,
      severity: copy.severity,
      title: copy.title(list.length),
      why: copy.why,
      fix: copy.fix,
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
    const s = copyOf(r)?.severity;
    if (s && (worst === null || SEVERITY_RANK[s] < SEVERITY_RANK[worst])) worst = s;
  }
  return worst;
}

const REASON_LABEL: Record<string, string> = {
  dos: 'On the DoS list',
  bench_failed: 'Failed the benchmark',
  expiring_soon: 'Close to expiring',
  unreachable: 'Not reachable',
  bench_error: 'Benchmark error',
  'low_headroom:below': 'Below a tier minimum',
  'low_headroom:near': 'Close to a tier minimum',
  'version_outdated:flux_os': 'Behind on FluxOS',
  'version_outdated:bench': 'Behind on fluxbench',
};

/** A few words for one reason, for a chip or a tooltip (the issue's own title counts nodes, which a row has one of). */
export function reasonLabel(r: Pick<HealthReason, 'kind' | 'metric' | 'value' | 'threshold'>): string {
  const v = variantOf(r);
  return REASON_LABEL[v ? `${r.kind}:${v}` : r.kind] ?? r.kind.replace(/_/g, ' ');
}

export const SEVERITY_WORD: Record<Severity, string> = { crit: 'Critical', warn: 'Warning', info: 'Note' };

export interface IssueSummary {
  /** Issues (kinds of finding) of each severity. */
  issues: Record<Severity, number>;
  /** Nodes whose worst finding is of each severity. */
  nodes: Record<Severity, number>;
  /** Nodes with any finding. */
  flagged: number;
}

/** How many issues and how many nodes sit at each severity (a node counts once, at its worst). */
export function summarizeIssues(
  groups: readonly IssueGroup[],
  attention: readonly NodeAttention[],
): IssueSummary {
  const issues: Record<Severity, number> = { crit: 0, warn: 0, info: 0 };
  for (const g of groups) issues[g.severity]++;
  const nodes: Record<Severity, number> = { crit: 0, warn: 0, info: 0 };
  let flagged = 0;
  for (const a of attention) {
    const worst = worstSeverity(a.reasons);
    if (worst === null) continue;
    nodes[worst]++;
    flagged++;
  }
  return { issues, nodes, flagged };
}

/** The unit a reason's measurement is in: a benchmark metric's own, or `blocks` for the blocks left to confirm. */
export function metricUnit(metric: string | null): string {
  if (metric === null) return '';
  if (metric === 'blocks_left') return 'blocks';
  return (METRIC_META as Record<string, { unit: string } | undefined>)[metric]?.unit ?? '';
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
 * The metrics a benchmark measures afresh every run (CPU, disk write, bandwidth), so they drift. The others
 * (cores, memory, SSD) are the size of the machine and never do, which is why the server flags those only when
 * they are below the minimum and never for being close to it.
 */
export const DRIFTS: Record<BenchMetric, boolean> = {
  eps: true,
  disk_write_mbs: true,
  down_mbps: true,
  up_mbps: true,
  ram_gb: false,
  cores: false,
  ssd_gb: false,
};

/**
 * Where the weakest node of the fleet stands against the tier's minimum: `below` fails it, `near` is within a tenth
 * above it (a metric that drifts only), `ok` clears it, `untested` when the tier states no minimum for the metric.
 */
export function bandStatus(b: Pick<WalletBenchmark, 'fleet_min' | 'minimum' | 'metric'>): BandStatus {
  if (b.minimum === null || b.minimum <= 0) return 'untested';
  if (b.fleet_min < b.minimum) return 'below';
  return DRIFTS[b.metric] && b.fleet_min < b.minimum * (1 + NEAR_MARGIN) ? 'near' : 'ok';
}

/** The fleet's median against the network's: `above`, `below` or `level` (within a twentieth). */
export function medianStanding(b: Pick<WalletBenchmark, 'fleet_median' | 'network'>): {
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
export function bandScale(b: WalletBenchmark): BandScale {
  const values = [b.network.p10, b.network.p50, b.network.p90, b.fleet_median, b.fleet_min];
  if (b.minimum !== null) values.push(b.minimum);
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || Math.abs(hi) || 1;
  return { lo: Math.max(0, lo - span * 0.12), hi: hi + span * 0.12 };
}

/** One sentence about a band, for the text twin and a screen reader. */
export function bandSentence(b: WalletBenchmark): string {
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
  const measured =
    b.fleet_nodes > 0 ? ` Measured on ${b.fleet_nodes} ${b.fleet_nodes === 1 ? 'node' : 'nodes'}.` : '';
  return `${m.label}: the fleet median is ${median}, ${stand} the network median ${net}.${min}${measured}`;
}

// ---- concentration --------------------------------------------------------------------------------

export type RiskLevel = 'low' | 'moderate' | 'high';

/** The index's bands, on a 0 to 1 scale: under 0.15 diversified, 0.15 to 0.25 moderate, over it concentrated. */
export const HHI_BANDS = { moderate: 0.15, high: 0.25 } as const;

export function riskLevel(hhi: number): RiskLevel {
  return hhi >= HHI_BANDS.high ? 'high' : hhi >= HHI_BANDS.moderate ? 'moderate' : 'low';
}

/** Where the bands sit on the gauge (0..1 of its length): the low band is wide so most fleets land in the open. */
export const HHI_GAUGE = { moderate: 0.4, high: 0.62 } as const;

/**
 * The position of an index on the gauge, 0..1. The scale is piecewise: the three bands take fixed stretches of the
 * track (so each is wide enough to read), and the index runs linearly inside its own band.
 */
export function hhiPosition(hhi: number): number {
  const v = Math.min(1, Math.max(0, Number.isFinite(hhi) ? hhi : 0));
  if (v < HHI_BANDS.moderate) return (v / HHI_BANDS.moderate) * HHI_GAUGE.moderate;
  if (v < HHI_BANDS.high) {
    const t = (v - HHI_BANDS.moderate) / (HHI_BANDS.high - HHI_BANDS.moderate);
    return HHI_GAUGE.moderate + t * (HHI_GAUGE.high - HHI_GAUGE.moderate);
  }
  return HHI_GAUGE.high + ((v - HHI_BANDS.high) / (1 - HHI_BANDS.high)) * (1 - HHI_GAUGE.high);
}

/** The words for an index, for a sentence: `about 3 equal groups`, `a single group`. */
export function effectiveGroups(hhi: number): string {
  if (!(hhi > 0)) return 'no groups';
  const n = 1 / hhi;
  if (n < 1.5) return 'a single group';
  return `about ${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} equal groups`;
}

const BY_WORD: Record<ConcentrationBy, { one: string; plural: string }> = {
  country: { one: 'country', plural: 'countries' },
  city: { one: 'city', plural: 'cities' },
  provider: { one: 'provider', plural: 'providers' },
};

/** The server's bucket for nodes whose place or provider is not known. It is last, and the index leaves it out. */
export const UNKNOWN_BUCKET = 'unknown';

export interface ConcentrationRead {
  by: ConcentrationBy;
  /** `unknown` when no node has a known place (so there is nothing to grade). */
  level: RiskLevel | 'unknown';
  /** The risk, said plainly: "One provider outage takes down 100% of this fleet." */
  headline: string;
  /** The word on the gauge. */
  label: string;
  /** How many equal-sized groups would spread the fleet as thinly (1 over the index). */
  effective: number;
  /** The largest known bucket and its share of the whole fleet. */
  top: { label: string; nodes: number; share: number } | null;
  /** Nodes in the known buckets, and nodes with no known value. */
  known: number;
  unknown: number;
  /** Every node counted, known or not. */
  total: number;
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * What an index and a top share mean for the viewer. The server's buckets are the whole fleet, its unknown bucket
 * last; the index and the top share are over the known ones, so the headline's share is taken against the whole fleet
 * (it is what an outage would actually take down at most) and a note says how many nodes are not placed.
 */
export function readConcentration(c: WalletConcentration): ConcentrationRead {
  const word = BY_WORD[c.by];
  const knownBuckets = c.buckets.filter((b) => b.key !== UNKNOWN_BUCKET);
  const unknown = c.buckets.find((b) => b.key === UNKNOWN_BUCKET)?.nodes ?? 0;
  const known = knownBuckets.reduce((s, b) => s + b.nodes, 0);
  const total = known + unknown;
  const lead = knownBuckets[0] ?? null;
  const share = lead && total > 0 ? lead.nodes / total : 0;
  const top = lead ? { label: lead.label, nodes: lead.nodes, share } : null;
  const level: RiskLevel | 'unknown' = lead ? riskLevel(c.hhi) : 'unknown';
  const label =
    level === 'unknown'
      ? 'Unknown'
      : level === 'low'
        ? 'Diversified'
        : level === 'moderate'
          ? 'Moderate'
          : 'Concentrated';
  const effective = c.hhi > 0 ? 1 / c.hhi : 0;
  let headline: string;
  if (total <= 0) {
    headline = `No ${word.plural} to compare: the fleet has no nodes.`;
  } else if (!lead) {
    headline = `No node has a known ${word.one} yet.`;
  } else if (knownBuckets.length === 1 && unknown === 0) {
    headline = `One ${word.one} outage takes down 100% of this fleet.`;
  } else if (c.by === 'provider') {
    headline = `One provider outage, ${lead.label}, takes down ${pct(share)} of this fleet.`;
  } else {
    headline = `Losing ${lead.label} would take down ${pct(share)} of this fleet.`;
  }
  return { by: c.by, level, headline, label, effective, top, known, unknown, total };
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

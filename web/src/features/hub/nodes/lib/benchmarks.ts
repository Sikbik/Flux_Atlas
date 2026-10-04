// How the network's nodes benchmark, tier by tier: the spread from the 10th to the 90th percentile with the median
// marked, against the minimum the tier asks for. One metric at a time on a shared scale, so the tiers can be compared
// by eye, and every number also written out. Pure.

import type { BenchMetric } from '../../../../api/generated/BenchMetric';
import type { NodeBenchSpread } from '../../../../api/generated/NodeBenchSpread';
import { formatInt } from '../../../../lib/format';
import { TIER_KEYS, TIER_NAME, type TierKey } from './tiers';

export interface MetricMeta {
  id: BenchMetric;
  /** The name over the graphic. */
  label: string;
  /** The short name on the tab. */
  tab: string;
  unit: string;
}

/** Every metric the server can send, in its order. */
export const METRICS: readonly MetricMeta[] = [
  { id: 'eps', label: 'Processor speed', tab: 'Processor', unit: 'events/s' },
  { id: 'disk_write_mbs', label: 'Disk write speed', tab: 'Disk write', unit: 'MB/s' },
  { id: 'down_mbps', label: 'Download speed', tab: 'Download', unit: 'Mbps' },
  { id: 'up_mbps', label: 'Upload speed', tab: 'Upload', unit: 'Mbps' },
  { id: 'ram_gb', label: 'Memory', tab: 'Memory', unit: 'GB' },
  { id: 'cores', label: 'Processor cores', tab: 'Cores', unit: 'cores' },
  { id: 'ssd_gb', label: 'Storage', tab: 'Storage', unit: 'GB' },
];

/** The metrics any node measured, in the server's order. */
export function presentMetrics(spreads: readonly NodeBenchSpread[] | undefined): MetricMeta[] {
  if (!spreads) return [];
  const seen = new Set(spreads.map((s) => s.metric));
  return METRICS.filter((m) => seen.has(m.id));
}

/** A benchmark figure without false precision: whole above 100, a decimal below unless it is whole. */
export function benchNumber(n: number): string {
  if (!Number.isFinite(n)) return 'Unknown';
  if (n >= 100) return formatInt(Math.round(n));
  return Number.isInteger(n) ? formatInt(n) : n.toFixed(1);
}

/** The tops a scale may have, as multiples of a power of ten: each divides into four marks that read cleanly. */
const SCALE_STEPS = [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 4.8, 6, 8, 10] as const;

/** The smallest scale top at or above `v`. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of SCALE_STEPS) if (m * p >= v) return m * p;
  return 10 * p;
}

export interface BenchRow {
  tier: TierKey;
  name: string;
  nodes: number;
  p10: number;
  p50: number;
  p90: number;
  minimum: number | null;
  /** Positions on the shared scale, 0..1. */
  x10: number;
  x50: number;
  x90: number;
  xMin: number | null;
  /** The median as a multiple of the minimum (2.4 is 2.4 times). */
  ratio: number | null;
  /** At least a tenth of the tier's nodes measure under the minimum. */
  tenthBelow: boolean;
  /** The row in words, for a screen reader. */
  text: string;
}

export interface BenchModel {
  meta: MetricMeta;
  rows: BenchRow[];
  /** The scale's top, a round number past every value drawn. */
  max: number;
  /** Axis marks: where (0..1) and what. */
  ticks: { at: number; text: string }[];
  reading: string;
}

function rowOf(s: NodeBenchSpread, meta: MetricMeta, max: number): BenchRow {
  const x = (v: number) => Math.max(0, Math.min(1, v / max));
  const min = s.minimum !== null && s.minimum > 0 ? s.minimum : null;
  const tier = s.tier as TierKey;
  const name = TIER_NAME[tier];
  return {
    tier,
    name,
    nodes: s.nodes,
    p10: s.p10,
    p50: s.p50,
    p90: s.p90,
    minimum: min,
    x10: x(s.p10),
    x50: x(s.p50),
    x90: x(s.p90),
    xMin: min === null ? null : x(min),
    ratio: min === null ? null : s.p50 / min,
    tenthBelow: min !== null && s.p10 < min,
    text: `${name}: 10th percentile ${benchNumber(s.p10)}, median ${benchNumber(s.p50)}, 90th percentile ${benchNumber(s.p90)} ${meta.unit}${
      min === null ? '' : `; the tier minimum is ${benchNumber(min)}`
    }; measured on ${formatInt(s.nodes)} nodes.`,
  };
}

const times = (r: number): string => `${r >= 10 ? Math.round(r) : r.toFixed(1)} times`;

const joinNames = (names: readonly string[]): string =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');

/** One sentence on how far above the minimum the typical node sits, and a second if a tier has nodes under it. */
export function benchReading(rows: readonly BenchRow[]): string {
  const withMin = rows.filter((r) => r.ratio !== null);
  if (withMin.length === 0) return '';
  const parts = withMin.map(
    (r, i) => `${times(r.ratio as number)}${i === 0 ? ' the minimum' : ''} for ${r.name}`,
  );
  const lead = `The median node measures ${joinNames(parts)}.`;
  const below = rows.filter((r) => r.tenthBelow).map((r) => r.name);
  return below.length === 0
    ? lead
    : `${lead} At least a tenth of ${joinNames(below)} nodes measure under it.`;
}

/** The chosen metric across the tiers, or null when no tier measured it. */
export function benchModel(
  spreads: readonly NodeBenchSpread[] | undefined,
  metric: BenchMetric,
): BenchModel | null {
  const meta = METRICS.find((m) => m.id === metric);
  if (!spreads || !meta) return null;
  const chosen = TIER_KEYS.map((t) => spreads.find((s) => s.metric === metric && s.tier === t)).filter(
    (s): s is NodeBenchSpread => s !== undefined,
  );
  if (chosen.length === 0) return null;
  const top = Math.max(...chosen.flatMap((s) => [s.p90, s.minimum ?? 0]));
  const max = niceMax(top * 1.02);
  const rows = chosen.map((s) => rowOf(s, meta, max));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, text: benchNumber(at * max) }));
  return { meta, rows, max, ticks, reading: benchReading(rows) };
}

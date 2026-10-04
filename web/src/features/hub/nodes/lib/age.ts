// How long the confirmed nodes have been running: the server's six age buckets (youngest first) and the nodes that do
// not say when they began, drawn as columns and written out. Pure.

import type { NodeAgeBucket } from '../../../../api/generated/NodeAgeBucket';
import { formatInt } from '../../../../lib/format';
import { shareText } from '../../../analytics/lib/concentration';

export interface AgeBar {
  id: string;
  /** The short name under the column: the server's label (`<7d`, `1-6mo`). */
  label: string;
  /** The range in words (`1 to 6 months`), for a title and a screen reader. */
  long: string;
  count: number;
  /** 0..1 of every confirmed node, those with no known start included. */
  share: number;
  /** 0..1 of the tallest column. */
  frac: number;
  unknown: boolean;
}

export interface AgeModel {
  bars: AgeBar[];
  /** Every confirmed node: the known ages and those with none. */
  total: number;
  unknown: number;
  /** One sentence on the largest group. */
  reading: string;
  /** The columns in words, for a screen reader. */
  summary: string;
}

interface Span {
  value: number;
  unit: 'day' | 'month' | 'year';
}

function span(days: number): Span {
  if (days < 30) return { value: days, unit: 'day' };
  if (days < 365) return { value: Math.round(days / 30), unit: 'month' };
  return { value: Math.round(days / 365), unit: 'year' };
}

const unitText = (s: Span, withUnit = true) =>
  `${formatInt(s.value)}${withUnit ? ` ${s.unit}${s.value === 1 ? '' : 's'}` : ''}`;

/** A bucket's range in words: `Under 7 days`, `7 to 30 days`, `6 months to 1 year`, `Over 2 years`. */
export function rangeText(minDays: number, maxDays: number | null): string {
  if (maxDays === null) return `Over ${unitText(span(minDays))}`;
  if (minDays <= 0) return `Under ${unitText(span(maxDays))}`;
  const a = span(minDays);
  const b = span(maxDays);
  return a.unit === b.unit ? `${unitText(a, false)} to ${unitText(b)}` : `${unitText(a)} to ${unitText(b)}`;
}

/** The age buckets and the nodes with no known start as columns; null when there are no confirmed nodes at all. */
export function ageModel(buckets: readonly NodeAgeBucket[] | undefined, unknown: number): AgeModel | null {
  if (!buckets) return null;
  const known = buckets.reduce((s, b) => s + b.nodes, 0);
  const total = known + Math.max(0, unknown);
  if (total <= 0) return null;
  const tallest = Math.max(...buckets.map((b) => b.nodes), unknown, 1);
  const bars: AgeBar[] = buckets.map((b) => ({
    id: b.label,
    label: b.label,
    long: rangeText(b.min_days, b.max_days),
    count: b.nodes,
    share: b.nodes / total,
    frac: b.nodes / tallest,
    unknown: false,
  }));
  if (unknown > 0) {
    bars.push({
      id: 'unknown',
      label: 'Unknown',
      long: 'Start not known',
      count: unknown,
      share: unknown / total,
      frac: unknown / tallest,
      unknown: true,
    });
  }
  const biggest = bars
    .filter((b) => !b.unknown)
    .reduce<AgeBar | null>((m, b) => (!m || b.count > m.count ? b : m), null);
  const reading =
    biggest && biggest.count > 0
      ? `The largest group of nodes, ${shareText(biggest.share)}, is ${biggest.long.toLowerCase()} old.`
      : 'No node says when it began.';
  const summary = bars
    .map((b) => `${b.long}: ${formatInt(b.count)} nodes (${shareText(b.share)})`)
    .join('; ');
  return { bars, total, unknown: Math.max(0, unknown), reading, summary: `Nodes by age. ${summary}.` };
}

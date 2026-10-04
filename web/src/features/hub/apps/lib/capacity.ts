// What apps lock of the network, per resource, as the hero's rails read it. `used` is the server's `apps_locked`
// (per-instance spec times running instances, over the apps whose spec is public) and `network` its `total` (the
// benchmarked cores, memory and storage of confirmed nodes), the same two numbers the Capacity view draws. Memory and
// storage are shown in the decimal units of that view. Pure.

import type { AppsResources } from '../../../../api/generated/AppsResources';
import { formatInt } from '../../../../lib/format';
import { formatCapacity, type Resource } from '../../../analytics/lib/capacity';
import { nameList, shareText } from '../../../analytics/lib/concentration';

export interface RailRow {
  key: Resource;
  label: string;
  used: number;
  total: number;
  /** A fraction of the network's capacity; null when the network's capacity is not known (a total of zero). */
  share: number | null;
  /** `6,934 cores`, `12.1 TB`. */
  usedText: string;
  totalText: string;
  /** `of 56,223 cores`, or `network total not known` when it is not. */
  ofText: string;
  /** `12.3%`, `<0.1%`, or `Unknown`. */
  percent: string;
}

const LABEL: Record<Resource, string> = { cpu: 'CPU', ram: 'Memory', ssd: 'Storage' };

export function railRows(r: AppsResources): RailRow[] {
  const row = (key: Resource, used: number, total: number): RailRow => {
    const share = total > 0 && Number.isFinite(total) ? Math.min(1, used / total) : null;
    return {
      key,
      label: LABEL[key],
      used,
      total,
      share,
      usedText: formatCapacity(key, used),
      totalText: formatCapacity(key, total),
      ofText: share === null ? 'network total not known' : `of ${formatCapacity(key, total)}`,
      percent: share === null ? 'Unknown' : shareText(share),
    };
  };
  return [
    row('cpu', r.used.cores, r.network.cores),
    row('ram', r.used.ram_gb, r.network.ram_gb),
    row('ssd', r.used.ssd_gb, r.network.ssd_gb),
  ];
}

const WORD: Record<Resource, string> = { cpu: 'cores', ram: 'memory', ssd: 'storage' };

/** The sentence a screen reader hears for the rails together. */
export function railsSummary(rows: readonly RailRow[]): string {
  if (rows.every((r) => r.share === null)) return 'The network capacity is not known yet.';
  const part = (r: RailRow, i: number): string =>
    r.share === null
      ? `the network's ${WORD[r.key]} are not known`
      : `${r.percent} of ${i === 0 ? "the network's" : 'its'} ${WORD[r.key]}`;
  return `Apps with a public spec lock ${nameList(rows.map(part))}.`;
}

/** The line under the rails: the sizes count public specs, so with enterprise apps about, apps hold at least this. */
export function railsNote(enterpriseApps: number | null): string {
  const base = 'These count apps with a public spec.';
  if (enterpriseApps === null || enterpriseApps <= 0) return base;
  const who =
    enterpriseApps === 1
      ? '1 enterprise app keeps its size private'
      : `${formatInt(enterpriseApps)} enterprise apps keep their size private`;
  return `${base} ${who}, so apps hold at least this much.`;
}

// How healthy the confirmed nodes are, as the hero's strip draws it. The server counts three overlapping sets over the
// confirmed nodes: at risk (560 or more blocks since the last confirmation), unreachable (the API did not answer the
// last crawl) and healthy (neither). A node can be in both of the first two, so the strip cuts the nodes into parts
// that do not overlap, and the legend says how many of the unreachable are also at risk. Pure.

import type { NodeStatusCounts } from '../../../../api/generated/NodeStatusCounts';
import { formatInt } from '../../../../lib/format';
import { shareText } from '../../../analytics/lib/concentration';

export type HealthId = 'healthy' | 'at-risk' | 'unreachable';

export interface HealthPart {
  id: HealthId;
  label: string;
  /** Nodes in this part of the strip (no node is in two parts). */
  count: number;
  /** 0..1 of the confirmed nodes. */
  share: number;
  /** The status role that colours it. */
  tone: 'ok' | 'warn' | 'off';
}

export interface HealthItem {
  id: HealthId;
  label: string;
  /** Everything in the set, overlap included (the number the operators table shows). */
  count: number;
  share: number;
  tone: HealthPart['tone'];
  /** What the set means, for a hover title. */
  meaning: string;
}

export interface HealthModel {
  /** Confirmed nodes: the whole the strip is of. */
  total: number;
  parts: HealthPart[];
  items: HealthItem[];
  /** Nodes that are both at risk and unreachable. */
  overlap: number;
  /** The strip in words, for a screen reader. */
  summary: string;
}

const MEANING: Record<HealthId, string> = {
  healthy: 'Confirmed and neither at risk nor unreachable',
  'at-risk': '560 or more blocks since the last confirmation, so the node may expire',
  unreachable: 'The node API did not answer the last crawl',
};

const clampTo = (n: number, max: number) => Math.max(0, Math.min(n, max));

/**
 * The health of the confirmed nodes, or null when there are none to speak of (a health bar of zero nodes would say
 * nothing true). `healthy` is the server's own count, so the union of the two problems is `confirmed - healthy`.
 */
export function healthModel(s: NodeStatusCounts): HealthModel | null {
  const total = s.confirmed;
  if (!(total > 0)) return null;
  const healthy = clampTo(s.healthy, total);
  const union = total - healthy;
  const atRisk = clampTo(s.at_risk, union);
  const unreachable = clampTo(s.unreachable, union);
  const overlap = clampTo(atRisk + unreachable - union, Math.min(atRisk, unreachable));
  const unreachableOnly = unreachable - overlap;
  const share = (n: number) => n / total;

  const parts: HealthPart[] = [
    { id: 'healthy', label: 'Healthy', count: healthy, share: share(healthy), tone: 'ok' },
    { id: 'at-risk', label: 'At risk', count: atRisk, share: share(atRisk), tone: 'warn' },
    {
      id: 'unreachable',
      label: 'Unreachable',
      count: unreachableOnly,
      share: share(unreachableOnly),
      tone: 'off',
    },
  ];
  const items: HealthItem[] = [
    { ...parts[0]!, meaning: MEANING.healthy },
    { ...parts[1]!, meaning: MEANING['at-risk'] },
    {
      ...parts[2]!,
      count: unreachable,
      share: share(unreachable),
      meaning: MEANING.unreachable,
    },
  ];

  const bits = [
    `${formatInt(healthy)} healthy (${shareText(share(healthy))})`,
    `${formatInt(atRisk)} at risk (${shareText(share(atRisk))})`,
    `${formatInt(unreachable)} unreachable (${shareText(share(unreachable))})${
      overlap > 0 ? `, ${formatInt(overlap)} of them also at risk` : ''
    }`,
  ];
  return {
    total,
    parts,
    items,
    overlap,
    summary: `Health of ${formatInt(total)} confirmed nodes: ${bits.join('; ')}.`,
  };
}

// Gallery helpers: turns a real node row and the chain tip into lifecycle events, and a real feed
// entry into a timeline item. The times of block-height events are estimated at the 30 s PoN cadence
// (there is no wall-clock time for a past height in a node row), and the specimen says so.

import {
  Activity,
  Blocks,
  CircleCheck,
  Coins,
  FilePen,
  type LucideIcon,
  OctagonX,
  Rocket,
  TriangleAlert,
} from 'lucide-react';
import type { FeedKind } from '../../../api/generated/FeedKind';
import type { NodeRow } from '../../../api/generated/NodeRow';
import type { TipInfo } from '../../../api/generated/TipInfo';
import { BLOCK_MS, formatInt } from '../../../lib/format';
import type { FeedEntry } from '../../../store/network';
import type { TimelineItem } from '../Timeline';
import type { TimelineTone } from '../timeline';

/** Blocks without a check-in before a node is at risk, and before it expires (design 4.5). */
export const AT_RISK_BLOCKS = 560;
export const EXPIRY_BLOCKS = 640;

/** Estimated unix ms of a block height, from the tip and the 30 s cadence. */
export function estimateTime(height: number, tip: TipInfo): number {
  return tip.time_ms + (height - tip.height) * BLOCK_MS;
}

/** The lifecycle of a node from its heights: joined, paid, last heartbeat, and the two thresholds ahead of it. Newest first. */
export function lifecycleItems(node: NodeRow, tip: TipInfo): TimelineItem[] {
  const items: TimelineItem[] = [];
  const check = node.last_confirmed_height;
  if (check !== null) {
    const expires = check + EXPIRY_BLOCKS;
    const risk = check + AT_RISK_BLOCKS;
    items.push({
      id: 'expired',
      time: estimateTime(expires, tip),
      tone: 'crit',
      icon: OctagonX,
      title: 'Expires without a check-in',
      block: expires,
      meta: `${EXPIRY_BLOCKS} blocks since the last check-in, about 5.3 h`,
      upcoming: expires > tip.height,
    });
    items.push({
      id: 'at-risk',
      time: estimateTime(risk, tip),
      tone: 'warn',
      icon: TriangleAlert,
      title: 'At risk without a check-in',
      block: risk,
      meta: `${AT_RISK_BLOCKS} blocks since the last check-in`,
      upcoming: risk > tip.height,
    });
    items.push({
      id: 'heartbeat',
      time: estimateTime(check, tip),
      tone: 'ok',
      icon: Activity,
      title: 'Heartbeat confirmed',
      block: check,
      meta: 'Nodes check in about every 4.2 h',
    });
  }
  if (node.last_paid_height !== null) {
    items.push({
      id: 'paid',
      time: estimateTime(node.last_paid_height, tip),
      tone: 'accent',
      icon: Coins,
      title: 'Paid',
      block: node.last_paid_height,
      meta: node.rank === null ? undefined : `Queue position ${formatInt(node.rank)}`,
    });
  }
  items.push({
    id: 'joined',
    time: estimateTime(node.added_height, tip),
    tone: 'ok',
    icon: CircleCheck,
    title: 'Joined the network',
    block: node.added_height,
    meta: node.country ? `Confirmed in ${node.country}` : 'First confirmation',
  });
  return items.sort((a, b) => Number(b.time) - Number(a.time));
}

interface FeedStyle {
  title: string;
  tone: TimelineTone;
  icon: LucideIcon;
}

const FEED: Partial<Record<FeedKind, FeedStyle>> = {
  node_joined: { title: 'Node joined', tone: 'ok', icon: Rocket },
  node_recovered: { title: 'Node recovered', tone: 'ok', icon: CircleCheck },
  node_paid: { title: 'Node paid', tone: 'ok', icon: Coins },
  node_heartbeat: { title: 'Heartbeat batch', tone: 'neutral', icon: Activity },
  node_at_risk: { title: 'Node at risk', tone: 'warn', icon: TriangleAlert },
  node_expired: { title: 'Node expired', tone: 'crit', icon: OctagonX },
  node_dosed: { title: 'Node banned', tone: 'crit', icon: OctagonX },
  app_deployed: { title: 'App deployed', tone: 'hot', icon: FilePen },
  app_updated: { title: 'App updated', tone: 'hot', icon: FilePen },
  app_renewed: { title: 'App renewed', tone: 'neutral', icon: FilePen },
};

const sentence = (kind: string): string => {
  const words = kind.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A real feed entry as a timeline item. */
export function feedItem(e: FeedEntry): TimelineItem {
  const style = FEED[e.item.kind];
  const block = e.item.refs.find((r) => r.kind === 'block');
  const node = e.item.refs.find((r) => r.kind === 'node');
  const app = e.item.refs.find((r) => r.kind === 'app');
  return {
    id: e.seq,
    time: e.item.ts_ms || e.observedMs,
    title: style?.title ?? sentence(e.item.kind),
    tone: style?.tone ?? 'accent',
    icon: style?.icon ?? Blocks,
    block: block?.kind === 'block' ? block.height : undefined,
    meta: app?.kind === 'app' ? app.name : node?.kind === 'node' ? `Node ${node.id}` : undefined,
  };
}

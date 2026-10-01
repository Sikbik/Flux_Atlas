// Readable lines for the feed items a node view lists (recent events, history). The server sends a
// `text_key`, parameters and references; the UI never parses free text, so each kind maps to copy
// here. Copy follows the design voice: past tense, subject first, sentence case, no emoji.

import type { FeedItem } from '../../../api/generated/FeedItem';
import type { FeedRef } from '../../../api/generated/FeedRef';
import { formatFlux, formatInt } from '../../../lib/format';

export type FeedTone = 'ok' | 'warn' | 'crit' | 'pay' | 'info' | 'muted';
export type FeedIcon =
  | 'join'
  | 'start'
  | 'heartbeat'
  | 'paid'
  | 'ip'
  | 'risk'
  | 'expired'
  | 'left'
  | 'dos'
  | 'spent'
  | 'offline'
  | 'recovered'
  | 'app'
  | 'info';

export interface FeedLine {
  text: string;
  tone: FeedTone;
  icon: FeedIcon;
  /** Block height the event happened at, when it carries one. */
  height: number | null;
}

const REASONS: Record<string, string> = {
  expired: 'it expired',
  collateral_spent: 'its collateral was spent',
  missing: 'it dropped off the list',
  dos: 'it was DoS-listed',
};

function heightOf(item: FeedItem): number | null {
  const p = Number(item.params.height);
  if (Number.isInteger(p) && p > 0) return p;
  const r = item.refs.find((x): x is Extract<FeedRef, { kind: 'block' }> => x.kind === 'block');
  return r ? r.height : null;
}

const at = (h: number | null) => (h === null ? '' : ` at block ${formatInt(h)}`);

/** One readable line for a node-scoped feed item. */
export function describeFeedItem(item: FeedItem): FeedLine {
  const h = heightOf(item);
  const line = (text: string, tone: FeedTone, icon: FeedIcon): FeedLine => ({ text, tone, icon, height: h });
  switch (item.kind) {
    case 'node_joined':
      return line(`Joined the network${at(h)}`, 'ok', 'join');
    case 'node_started':
      return line(`Start transaction${at(h)}, waiting for its first confirm`, 'info', 'start');
    case 'node_heartbeat':
      return line(`Checked in${at(h)}`, 'muted', 'heartbeat');
    case 'node_paid': {
      const amount = item.params.amount ? formatFlux(item.params.amount) : null;
      return line(`Paid${amount ? ` ${amount}` : ''}${at(h)}`, 'pay', 'paid');
    }
    case 'node_ip_changed': {
      const { old, new: next } = item.params;
      return line(
        old && next ? `IP changed from ${old} to ${next}` : next ? `IP changed to ${next}` : 'IP changed',
        'warn',
        'ip',
      );
    }
    case 'node_at_risk':
      return line(
        item.params.blocks
          ? `At risk of expiry, ${formatInt(Number(item.params.blocks))} blocks since the last check-in`
          : 'At risk of expiry',
        'warn',
        'risk',
      );
    case 'node_expired':
      return line(item.params.predicted === 'true' ? 'Expected to expire' : 'Expired', 'crit', 'expired');
    case 'node_left': {
      const why = item.params.reason ? REASONS[item.params.reason] : undefined;
      return line(why ? `Left the network, ${why}` : 'Left the network', 'crit', 'left');
    }
    case 'node_dosed':
      return line(`Entered the DoS list${at(h)}`, 'crit', 'dos');
    case 'collateral_spent':
      return line(`Collateral spent${at(h)}`, 'crit', 'spent');
    case 'node_unreachable':
      return line('Became unreachable', 'warn', 'offline');
    case 'node_recovered':
      return line('Reachable again', 'ok', 'recovered');
    case 'app_deployed':
    case 'app_updated':
    case 'app_renewed':
    case 'app_expired':
    case 'app_pending':
    case 'app_install_failed':
      return line(item.kind.replace(/^app_/, 'App ').replace('_', ' '), 'info', 'app');
    default:
      return line(item.kind.replaceAll('_', ' '), 'muted', 'info');
  }
}

/** The node ids a feed item references, in order. */
export function nodeRefs(item: FeedItem): number[] {
  return item.refs.filter((r): r is Extract<FeedRef, { kind: 'node' }> => r.kind === 'node').map((r) => r.id);
}

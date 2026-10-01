// One sentence for a feed item. The server sends a kind, the entities it refers to and a few
// parameters; the interface owns the words (it never parses text). Used by the terminal's `tail feed`
// and the ambient overlay's captions.

import type { FeedItem } from '../../api/generated/FeedItem';
import type { FeedRef } from '../../api/generated/FeedRef';
import { formatFlux, formatInt } from '../../lib/format';
import type { NetworkStore } from '../../store/network';

export type FeedTone = 'val' | 'ok' | 'warn' | 'crit' | 'dim';

export interface FeedSentence {
  text: string;
  tone: FeedTone;
  /** The node the sentence is about, when it has one. */
  node: number | null;
}

function nodeName(store: NetworkStore, id: number | null): string {
  if (id === null) return 'A node';
  const row = store.nodes.indexOf(id);
  const ep = row >= 0 ? store.nodes.endpoint(row) : '';
  return ep || `Node #${formatInt(id)}`;
}

const firstNode = (refs: readonly FeedRef[]): number | null => {
  for (const r of refs) if (r.kind === 'node') return r.id;
  return null;
};

const firstApp = (refs: readonly FeedRef[]): string | null => {
  for (const r of refs) if (r.kind === 'app') return r.name;
  return null;
};

const height = (item: FeedItem): string => {
  const h = Number(item.params.height);
  return Number.isFinite(h) ? formatInt(h) : '';
};

const REASON: Record<string, string> = {
  expired: 'it expired',
  collateral_spent: 'its collateral was spent',
  missing: 'it went missing',
  dos: 'it was listed for DoS',
};

/** The sentence for an item, in the product's dry voice. */
export function feedSentence(store: NetworkStore, item: FeedItem): FeedSentence {
  const node = firstNode(item.refs);
  const who = nodeName(store, node);
  const at = height(item);
  const p = item.params;
  switch (item.kind) {
    case 'node_joined':
      return { text: `${who} confirmed${at ? ` in block ${at}` : ''}`, tone: 'ok', node };
    case 'node_started':
      return { text: `${who} started${at ? ` in block ${at}` : ''}`, tone: 'val', node };
    case 'node_heartbeat':
      return { text: `${who} checked in${at ? ` at block ${at}` : ''}`, tone: 'dim', node };
    case 'node_paid': {
      const amount = formatFlux(p.amount, { decimals: 2 });
      const tier = p.tier ? ` (${p.tier[0]!.toUpperCase()}${p.tier.slice(1)})` : '';
      return { text: `${who} was paid ${amount}${tier}${at ? ` in block ${at}` : ''}`, tone: 'ok', node };
    }
    case 'node_ip_changed':
      return { text: `${p.old || 'A node'} moved to ${p.new || 'a new address'}`, tone: 'val', node };
    case 'node_at_risk':
      return { text: `${who} is ${p.blocks ?? 'many'} blocks past its last check-in`, tone: 'warn', node };
    case 'node_expired':
      return { text: `${who} expired`, tone: 'crit', node };
    case 'node_left':
      return {
        text: `${who} left${p.reason && REASON[p.reason] ? `: ${REASON[p.reason]}` : ''}`,
        tone: 'crit',
        node,
      };
    case 'node_dosed':
      return { text: `${who} was listed for DoS${at ? ` at block ${at}` : ''}`, tone: 'crit', node };
    case 'collateral_spent':
      return { text: `${who} had its collateral spent`, tone: 'crit', node };
    case 'node_unreachable':
      return { text: `${who} stopped answering`, tone: 'warn', node };
    case 'node_recovered':
      return { text: `${who} is answering again`, tone: 'ok', node };
    case 'app_deployed':
      return { text: `${firstApp(item.refs) ?? 'An app'} was deployed`, tone: 'val', node };
    case 'app_updated':
      return { text: `${firstApp(item.refs) ?? 'An app'} was updated`, tone: 'val', node };
    case 'app_renewed':
      return { text: `${firstApp(item.refs) ?? 'An app'} was renewed`, tone: 'ok', node };
    case 'app_expired':
      return { text: `${firstApp(item.refs) ?? 'An app'} expired`, tone: 'warn', node };
    case 'app_pending':
      return { text: `${firstApp(item.refs) ?? 'An app'} is waiting for a block`, tone: 'dim', node };
    case 'app_install_failed':
      return { text: `${firstApp(item.refs) ?? 'An app'} failed to install`, tone: 'warn', node };
    case 'version_milestone':
      return {
        text: `A new FluxOS version reached a milestone${p.version ? `: ${p.version}` : ''}`,
        tone: 'val',
        node,
      };
    case 'large_transfer':
      return {
        text: `A large transfer${p.amount ? ` of ${formatFlux(p.amount, { decimals: 0 })}` : ''} moved`,
        tone: 'val',
        node,
      };
    case 'reorg':
      return { text: 'The chain reorganised', tone: 'warn', node };
    case 'reward_reduction':
      return { text: 'The block reward was reduced', tone: 'val', node };
    default:
      return { text: String(item.kind).replaceAll('_', ' '), tone: 'dim', node };
  }
}

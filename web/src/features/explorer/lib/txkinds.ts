// Labels and ordering for transaction kinds (explorer lists, block groups, mempool filters).

import type { NodeTxKind } from '../../../api/generated/NodeTxKind';
import type { TxKind } from '../../../api/generated/TxKind';

export interface KindInfo {
  /** Singular noun for chips: "Transfer". */
  label: string;
  /** Plural for group headings: "Transfers". */
  plural: string;
  /** One sentence for tooltips and empty groups. */
  hint: string;
}

export const TX_KINDS: Record<TxKind, KindInfo> = {
  coinbase: {
    label: 'Coinbase',
    plural: 'Coinbase',
    hint: 'The block reward: the dev fund and one payment per tier.',
  },
  transfer: {
    label: 'Transfer',
    plural: 'Transfers',
    hint: 'FLUX moved between addresses.',
  },
  app_message: {
    label: 'App payment',
    plural: 'App payments',
    hint: 'Pays to register or update an app; the app message hash rides in an OP_RETURN output.',
  },
  node_start: {
    label: 'Node start',
    plural: 'Node starts',
    hint: 'A start transaction asks the network to list a node. It becomes a node once confirmed.',
  },
  node_confirm: {
    label: 'Node confirm',
    plural: 'Node confirms',
    hint: 'A node checking in: its first confirm joins it to the network, later ones keep it from expiring.',
  },
  node_tx: {
    label: 'Fluxnode transaction',
    plural: 'Fluxnode transactions',
    hint: 'A fluxnode start or confirm that was not classified further.',
  },
  unknown: {
    label: 'Unclassified',
    plural: 'Unclassified',
    hint: 'Seen in the mempool before this session; it is classified when its block lands.',
  },
};

/** Group order in a block: value first, the bulk of node check-ins last. */
export const BLOCK_GROUP_ORDER: readonly TxKind[] = [
  'transfer',
  'app_message',
  'node_start',
  'node_tx',
  'node_confirm',
  'unknown',
];

export const NODE_TX_KINDS: Record<NodeTxKind, { label: string; hint: string }> = {
  start: { label: 'Start', hint: 'Asks the network to list the node.' },
  initial_confirm: { label: 'Initial confirm', hint: 'The node joins the network.' },
  update_confirm: { label: 'Heartbeat', hint: 'A periodic confirm that keeps the node alive.' },
  other_confirm: { label: 'Confirm', hint: 'A confirm of another kind.' },
};

/** True for kinds that move no value and carry no addresses (node start and confirm). */
export function isNodeKind(kind: TxKind): boolean {
  return kind === 'node_confirm' || kind === 'node_start' || kind === 'node_tx';
}

/**
 * A node checking in rather than value moving: a confirm or a start, or a transaction no block has classified yet that
 * carries no value (the mempool lists those before it knows what they are).
 */
export const isCheckin = (kind: string, value: string): boolean =>
  kind === 'node_confirm' ||
  kind === 'node_start' ||
  kind === 'node_tx' ||
  (kind === 'unknown' && Number(value) === 0);

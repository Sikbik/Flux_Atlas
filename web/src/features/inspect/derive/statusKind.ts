// Which state word a node wears in a list, from the three facts that decide it. The words are the UI kit's
// status kinds (`StatusChip status=...`), so a list row and a header agree: a node that is fine reads
// `confirmed`; everything else names what is wrong. Pending is never drawn as confirmed.

import type { NodeStatus } from '../../../api/generated/NodeStatus';
import { expiryState } from './expiry';

export type NodeStatusKind =
  | 'confirmed'
  | 'at-risk'
  | 'expired'
  | 'offline'
  | 'unreachable'
  | 'started'
  | 'dos'
  | 'departed'
  | 'unknown';

export interface NodeStatusInput {
  status: NodeStatus;
  /** Whether the last sweep reached the node's API port (null when never checked). */
  reachable: boolean | null;
  /** Blocks since the last check-in, null when unknown. */
  sinceConfirm: number | null;
}

/** The one word for a node: its lifecycle status, sharpened by how long it has gone without a check-in. */
export function nodeStatusKind(i: NodeStatusInput): NodeStatusKind {
  switch (i.status) {
    case 'confirmed':
    case 'offline': {
      const e = expiryState(i.sinceConfirm);
      if (e === 'expired') return 'expired';
      if (e === 'atRisk') return 'at-risk';
      if (i.status === 'offline') return 'offline';
      if (i.reachable === false) return 'unreachable';
      return 'confirmed';
    }
    case 'started':
      return 'started';
    case 'dos':
      return 'dos';
    case 'expired':
      return 'expired';
    case 'departed':
      return 'departed';
    default:
      return 'unknown';
  }
}

/** A node that needs no word in a list: confirmed, checking in, reachable. */
export const isQuietKind = (k: NodeStatusKind): boolean => k === 'confirmed';

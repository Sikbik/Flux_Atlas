// What state chips a node wears, from the three facts that decide it: its status, whether the last
// sweep reached it, and how many blocks it has gone without a check-in. Every chip pairs a tone with
// a word and an icon (design 5.2): color is never the only carrier of state.

import type { NodeStatus } from '../../../api/generated/NodeStatus';
import { CHECKIN, expiryState } from './expiry';

export type Tone = 'ok' | 'pending' | 'warn' | 'crit' | 'off';
export type StateIcon = 'check' | 'pending' | 'alert' | 'x' | 'dashed' | 'shield';

export interface StateChip {
  key: string;
  tone: Tone;
  label: string;
  icon: StateIcon;
  /** One sentence for the tooltip. */
  hint: string;
}

export interface NodeStateInput {
  status: NodeStatus;
  reachable: boolean | null;
  /** Blocks since the last check-in, null when unknown. */
  sinceConfirm: number | null;
}

/** The primary lifecycle chip, then a reachability chip when the node cannot be reached. */
export function nodeStateChips(i: NodeStateInput): StateChip[] {
  const out: StateChip[] = [];
  const e = expiryState(i.sinceConfirm);
  switch (i.status) {
    case 'confirmed':
    case 'offline': {
      if (e === 'expired') {
        out.push({
          key: 'past-expiry',
          tone: 'crit',
          label: 'Past expiry',
          icon: 'x',
          hint: `${CHECKIN.expire} blocks without a check-in seen: the network drops a node at this point unless a confirm is already on its way.`,
        });
      } else if (e === 'atRisk') {
        out.push({
          key: 'at-risk',
          tone: 'warn',
          label: 'At risk',
          icon: 'alert',
          hint: `${CHECKIN.atRisk} or more blocks without a check-in. It expires at ${CHECKIN.expire}.`,
        });
      } else if (i.status === 'offline') {
        out.push({
          key: 'offline',
          tone: 'crit',
          label: 'Offline',
          icon: 'x',
          hint: 'The network lists this node as offline.',
        });
      } else {
        out.push({
          key: 'confirmed',
          tone: 'ok',
          label: 'Confirmed',
          icon: 'check',
          hint: 'On the deterministic node list and checking in on time.',
        });
      }
      break;
    }
    case 'started':
      out.push({
        key: 'started',
        tone: 'pending',
        label: 'Started',
        icon: 'pending',
        hint: 'A start transaction is in the chain; the node is not confirmed yet.',
      });
      break;
    case 'dos':
      out.push({
        key: 'dos',
        tone: 'crit',
        label: 'DoS listed',
        icon: 'shield',
        hint: 'Banned for 720 blocks after a failed benchmark or a network violation.',
      });
      break;
    case 'expired':
      out.push({
        key: 'expired',
        tone: 'crit',
        label: 'Expired',
        icon: 'x',
        hint: 'The node missed its check-ins and left the deterministic list.',
      });
      break;
    case 'departed':
      out.push({
        key: 'departed',
        tone: 'off',
        label: 'Left the network',
        icon: 'dashed',
        hint: 'The node is no longer in the network.',
      });
      break;
    default:
      out.push({
        key: 'unknown',
        tone: 'off',
        label: 'Unknown',
        icon: 'dashed',
        hint: 'No status has been observed for this node.',
      });
  }
  if (i.reachable === false) {
    out.push({
      key: 'unreachable',
      tone: 'off',
      label: 'Unreachable',
      icon: 'dashed',
      hint: 'The last sweep could not reach this node on its API port.',
    });
  }
  return out;
}

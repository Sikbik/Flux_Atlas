// The vocabulary of status chips: every state a node, app, block or connection can be in, mapped to
// one of the five reserved status roles with an icon and a word (design 5.2: status colour is never
// colour alone). The first group is the API's `NodeStatus`, so `<StatusChip status={node.status} />`
// just works; the rest are UI states.

import {
  CircleCheck,
  CircleDashed,
  Clock,
  LoaderCircle,
  LogOut,
  type LucideIcon,
  OctagonX,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import type { StatusTone } from '../internal/status';

export type StatusKind =
  // NodeStatus from the API
  | 'unknown'
  | 'confirmed'
  | 'started'
  | 'dos'
  | 'offline'
  | 'expired'
  | 'departed'
  // UI states
  | 'pending'
  | 'syncing'
  | 'live'
  | 'at-risk'
  | 'degraded'
  | 'stale'
  | 'unreachable'
  | 'error';

export interface StatusMeta {
  tone: StatusTone;
  /** Sentence-case word shown in the chip (the badge variant sets it in caps through CSS). */
  label: string;
  icon: LucideIcon;
  /** The icon turns slowly (a state that is in progress). */
  spin?: boolean;
  /** Draw the live dot instead of an icon (the healthy connection). */
  dot?: boolean;
}

export const STATUS_META: Record<StatusKind, StatusMeta> = {
  unknown: { tone: 'off', label: 'Unknown', icon: CircleDashed },
  confirmed: { tone: 'ok', label: 'Confirmed', icon: CircleCheck },
  started: { tone: 'pending', label: 'Started', icon: Clock },
  dos: { tone: 'crit', label: 'DoS', icon: ShieldAlert },
  offline: { tone: 'crit', label: 'Offline', icon: WifiOff },
  expired: { tone: 'crit', label: 'Expired', icon: OctagonX },
  departed: { tone: 'off', label: 'Departed', icon: LogOut },
  pending: { tone: 'pending', label: 'Pending', icon: Clock },
  syncing: { tone: 'pending', label: 'Syncing', icon: LoaderCircle, spin: true },
  live: { tone: 'ok', label: 'Live', icon: CircleCheck, dot: true },
  'at-risk': { tone: 'warn', label: 'At risk', icon: TriangleAlert },
  degraded: { tone: 'warn', label: 'Degraded', icon: TriangleAlert },
  stale: { tone: 'warn', label: 'Stale', icon: Clock },
  unreachable: { tone: 'off', label: 'Unreachable', icon: CircleDashed },
  error: { tone: 'crit', label: 'Error', icon: OctagonX },
};

/** Metadata for a status; unrecognised values fall back to `unknown` (never a guessed state). */
export function statusMeta(status: string | null | undefined): StatusMeta {
  return (status && (STATUS_META as Record<string, StatusMeta | undefined>)[status]) || STATUS_META.unknown;
}

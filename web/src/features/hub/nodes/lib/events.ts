// The node events the Nodes hub lists live: the ones that change who is on the network (a confirmation that joins, a
// start, and the ways a node goes). The store's feed holds many more kinds (heartbeats, payments, app events); the
// hub leaves those to the Pulse. Pure.

import type { FeedKind } from '../../../../api/generated/FeedKind';
import type { FeedRef } from '../../../../api/generated/FeedRef';
import { formatInt } from '../../../../lib/format';

/** The kinds this list shows. */
export const NODE_EVENT_KINDS: ReadonlySet<FeedKind> = new Set<FeedKind>([
  'node_joined',
  'node_started',
  'node_left',
  'node_expired',
  'node_dosed',
  'collateral_spent',
]);

/** The status word a kind maps to (the kit's status chips carry the icon and the colour for it). */
export type EventStatus = 'confirmed' | 'started' | 'departed' | 'expired' | 'dos';

export interface NodeEventRow {
  /** The feed's sequence number: unique and never reused. */
  key: string;
  kind: FeedKind;
  status: EventStatus;
  /** What happened to the node, after its name: `confirmed`, `left`. */
  verb: string;
  /** Why, when the server said (`its collateral was spent`). */
  detail: string | null;
  height: number | null;
  nodeId: number | null;
  tsMs: number;
}

/** What the structure of a feed entry has to carry for this list (the store's `FeedEntry` does). */
export interface FeedEntryLike {
  seq: number;
  observedMs: number;
  item: {
    kind: FeedKind;
    ts_ms: number;
    refs: readonly FeedRef[];
    params: Readonly<Record<string, string>>;
  };
}

const STATUS: Partial<Record<FeedKind, EventStatus>> = {
  node_joined: 'confirmed',
  node_started: 'started',
  node_left: 'departed',
  node_expired: 'expired',
  node_dosed: 'dos',
  collateral_spent: 'departed',
};

const VERB: Partial<Record<FeedKind, string>> = {
  node_joined: 'confirmed',
  node_started: 'started',
  node_left: 'left',
  node_expired: 'expired',
  node_dosed: 'was listed for DoS',
  collateral_spent: 'had its collateral spent',
};

/** Why a node left, as the server names it. */
const REASON: Record<string, string> = {
  expired: 'it expired',
  collateral_spent: 'its collateral was spent',
  missing: 'it went missing',
  dos: 'it was listed for DoS',
};

function nodeIdOf(refs: readonly FeedRef[]): number | null {
  for (const r of refs) if (r.kind === 'node') return r.id;
  return null;
}

function heightOf(params: Readonly<Record<string, string>>): number | null {
  const h = Number(params.height);
  return Number.isInteger(h) && h > 0 ? h : null;
}

/** The row for one feed entry, or null when it is not a node event this list shows. */
export function nodeEventRow(e: FeedEntryLike): NodeEventRow | null {
  const { kind, params } = e.item;
  const status = STATUS[kind];
  const verb = VERB[kind];
  if (!status || !verb) return null;
  const reason = kind === 'node_left' && params.reason ? (REASON[params.reason] ?? null) : null;
  return {
    key: String(e.seq),
    kind,
    status,
    verb,
    detail: reason,
    height: heightOf(params),
    nodeId: nodeIdOf(e.item.refs),
    tsMs: e.item.ts_ms > 0 ? e.item.ts_ms : e.observedMs,
  };
}

/** The newest `limit` node events of a feed held newest first. */
export function nodeEvents(feed: readonly FeedEntryLike[], limit = 8): NodeEventRow[] {
  const out: NodeEventRow[] = [];
  for (const e of feed) {
    const row = nodeEventRow(e);
    if (row) out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** What follows the node's name: `confirmed in block 3,007,723`, `left: its collateral was spent`. */
export function eventPhrase(row: Pick<NodeEventRow, 'verb' | 'detail' | 'height'>): string {
  const at = row.height === null ? '' : ` in block ${formatInt(row.height)}`;
  return `${row.verb}${row.detail ? `: ${row.detail}` : ''}${at}`;
}

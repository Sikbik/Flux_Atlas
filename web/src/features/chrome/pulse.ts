// The Pulse feed's logic (design 6.5, 8.13), kept pure: turning the store's feed items and blocks into
// human-readable events (the UI maps kinds to copy, it never parses the server's text), aggregating the
// ambient ones (a block's heartbeats read "Confirmed 14 nodes"), the burst rule (the first three events
// in any second render as rows, the rest collapse into one counting row), and the filters.

import type { FeedKind } from '../../api/generated/FeedKind';
import type { FeedRef } from '../../api/generated/FeedRef';
import type { WindowRef } from '../../shell/wm/types';

export type PulseFilter = 'all' | 'blocks' | 'nodes' | 'apps' | 'mine';
export const PULSE_FILTERS: readonly { id: PulseFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'apps', label: 'Apps' },
  { id: 'mine', label: 'Mine' },
];

/** Event kinds the Pulse shows: the feed's, plus the ones derived from blocks. */
export type PulseKind = FeedKind | 'block' | 'confirmed' | 'paid_mine';

export type PulseGroup = 'blocks' | 'nodes' | 'apps';

/** How an event reads: the colour it takes (a design token) and the glyph it wears. */
export type PulseTone =
  | 'block'
  | 'mine'
  | 'join'
  | 'leave'
  | 'app'
  | 'pending'
  | 'quiet'
  | 'version'
  | 'crit'
  | 'ok';

export interface PulseEvent {
  /** Stable identity across renders (`f:<seq>`, `b:<height>`, `c:<height>`, `m:<height>:<node>`). */
  id: string;
  kind: PulseKind;
  group: PulseGroup;
  /** Server-time ms the event happened or was observed. */
  ts: number;
  refs: readonly FeedRef[];
  params: Readonly<Record<string, string>>;
  /** For aggregated rows: how many events it stands for. */
  count?: number;
  /** For block-derived rows: facts the row prints. */
  block?: { height: number; txCount: number; size: number; producer: number | null };
  /** True when it concerns a watched node. */
  mine: boolean;
}

export interface FeedInput {
  seq: number;
  observedMs: number;
  item: {
    kind: FeedKind;
    ts_ms: number;
    refs: readonly FeedRef[];
    params: Readonly<Record<string, string>>;
  };
}

export interface BlockInput {
  height: number;
  hash: string;
  timeMs: number;
  observedMs: number | null;
  size: number;
  txCount: number;
  producer: number | null;
  confirmCount: number;
  live: boolean;
  payouts: readonly { tier: string; node: number | null; amount: string }[];
}

export function groupOf(kind: PulseKind): PulseGroup {
  switch (kind) {
    case 'block':
    case 'confirmed':
    case 'paid_mine':
    case 'large_transfer':
    case 'reorg':
    case 'reward_reduction':
    case 'node_paid':
      return 'blocks';
    case 'app_deployed':
    case 'app_updated':
    case 'app_renewed':
    case 'app_expired':
    case 'app_pending':
    case 'app_install_failed':
      return 'apps';
    default:
      return 'nodes';
  }
}

/** The tone an event reads in. */
export function toneOf(kind: PulseKind): PulseTone {
  switch (kind) {
    case 'block':
    case 'large_transfer':
      return 'block';
    case 'paid_mine':
      return 'mine';
    case 'node_joined':
    case 'node_started':
      return 'join';
    case 'node_left':
    case 'node_expired':
    case 'node_at_risk':
    case 'node_ip_changed':
    case 'node_unreachable':
    case 'collateral_spent':
    case 'app_expired':
    case 'reorg':
      return 'leave';
    case 'node_dosed':
    case 'app_install_failed':
      return 'crit';
    case 'node_recovered':
      return 'ok';
    case 'app_deployed':
    case 'app_updated':
    case 'app_renewed':
      return 'app';
    case 'app_pending':
      return 'pending';
    case 'version_milestone':
    case 'reward_reduction':
      return 'version';
    default:
      return 'quiet';
  }
}

/** Events that count toward the burst rule (design 6.5 class P2: network changes). */
export function isNetworkEvent(e: PulseEvent): boolean {
  return e.kind !== 'block' && e.kind !== 'confirmed' && e.kind !== 'paid_mine' && !e.mine;
}

const nodeRef = (refs: readonly FeedRef[]): number | null => {
  for (const r of refs) if (r.kind === 'node') return r.id;
  return null;
};
const blockRef = (refs: readonly FeedRef[]): number | null => {
  for (const r of refs) if (r.kind === 'block') return r.height;
  return null;
};

export interface NormalizeOptions {
  watched: ReadonlySet<number>;
  /** Blocks to turn into rows (the newest few; older ones are history, not news). */
  maxBlocks?: number;
  /** Seconds within which heartbeats without a block ref still fold into one row. */
  foldMs?: number;
}

/**
 * Turns feed items and blocks into events, newest first. Heartbeats fold into one "Confirmed N nodes" row
 * per block; payouts fold into the block row except to a watched node, which gets its own "mine" row.
 */
export function normalize(
  feed: readonly FeedInput[],
  blocks: readonly BlockInput[],
  opts: NormalizeOptions,
): PulseEvent[] {
  const out: PulseEvent[] = [];
  const hb = new Map<string, PulseEvent>();
  const foldMs = opts.foldMs ?? 20_000;

  // Feed items arrive newest first; fold heartbeats oldest to newest so counts accumulate predictably.
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i]!;
    const node = nodeRef(f.item.refs);
    const mine = node !== null && opts.watched.has(node);
    if (f.item.kind === 'node_heartbeat') {
      const h = blockRef(f.item.refs);
      const key = h !== null ? `c:${h}` : `c:t${Math.floor(f.observedMs / foldMs)}`;
      const prev = hb.get(key);
      if (prev) {
        prev.count = (prev.count ?? 0) + 1;
        prev.ts = Math.max(prev.ts, f.observedMs);
        prev.mine = prev.mine || mine;
      } else {
        const ev: PulseEvent = {
          id: key,
          kind: 'confirmed',
          group: 'blocks',
          ts: f.observedMs,
          refs: h !== null ? [{ kind: 'block', height: h }] : [],
          params: {},
          count: 1,
          mine,
        };
        hb.set(key, ev);
        out.push(ev);
      }
      continue;
    }
    // Payments to anyone but a watched node are part of the block row; they do not get rows of their own.
    if (f.item.kind === 'node_paid' && !mine) continue;
    out.push({
      id: `f:${f.seq}`,
      kind: f.item.kind,
      group: groupOf(f.item.kind),
      ts: f.observedMs,
      refs: f.item.refs,
      params: f.item.params,
      mine,
    });
  }

  const maxBlocks = opts.maxBlocks ?? 8;
  for (const b of blocks.slice(0, maxBlocks)) {
    const ts = b.live && b.observedMs !== null ? b.observedMs : b.timeMs;
    out.push({
      id: `b:${b.height}`,
      kind: 'block',
      group: 'blocks',
      ts,
      refs: [{ kind: 'block', height: b.height }],
      params: {},
      block: { height: b.height, txCount: b.txCount, size: b.size, producer: b.producer },
      mine: false,
    });
    // A bootstrap block's heartbeats are history, not news; a live block's fold with its feed items.
    if (b.live && b.confirmCount > 0 && !hb.has(`c:${b.height}`)) {
      out.push({
        id: `c:${b.height}`,
        kind: 'confirmed',
        group: 'blocks',
        ts: ts + 1,
        refs: [{ kind: 'block', height: b.height }],
        params: {},
        count: b.confirmCount,
        mine: false,
      });
    }
    for (const p of b.payouts) {
      if (p.node !== null && opts.watched.has(p.node)) {
        out.push({
          id: `m:${b.height}:${p.node}`,
          kind: 'paid_mine',
          group: 'blocks',
          ts: ts + 2,
          refs: [
            { kind: 'node', id: p.node },
            { kind: 'block', height: b.height },
          ],
          params: { amount: p.amount, tier: p.tier },
          mine: true,
        });
      }
    }
  }
  out.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
  return out;
}

/** The events a filter lets through. */
export function applyFilter(events: readonly PulseEvent[], filter: PulseFilter): PulseEvent[] {
  switch (filter) {
    case 'all':
      return [...events];
    case 'mine':
      return events.filter((e) => e.mine);
    default:
      return events.filter((e) => e.group === filter);
  }
}

// ---- bursts --------------------------------------------------------------------------------------

export type PulseRow =
  | { kind: 'event'; id: string; ev: PulseEvent }
  | { kind: 'burst'; id: string; events: PulseEvent[]; lastTs: number };

/** Individual rows allowed per window before the rest collapse. */
export const BURST_FREE = 3;
export const BURST_WINDOW_MS = 1_000;
/** A burst row stops counting after this much quiet. */
export const BURST_QUIET_MS = 2_000;

/**
 * The rows to draw, oldest first: in any one second the first three network events are rows and the rest
 * join one collapse row that keeps counting while the burst continues. Block, heartbeat and "mine" rows are
 * never collapsed. `events` is newest first, as `normalize` returns it.
 */
export function collapseBursts(events: readonly PulseEvent[]): PulseRow[] {
  const chrono = [...events].reverse();
  const rows: PulseRow[] = [];
  let win: { start: number; n: number } | null = null;
  let burst: Extract<PulseRow, { kind: 'burst' }> | null = null;
  for (const e of chrono) {
    if (!isNetworkEvent(e)) {
      rows.push({ kind: 'event', id: e.id, ev: e });
      continue;
    }
    if (win === null || e.ts - win.start >= BURST_WINDOW_MS) win = { start: e.ts, n: 0 };
    win.n++;
    if (win.n <= BURST_FREE) {
      rows.push({ kind: 'event', id: e.id, ev: e });
      continue;
    }
    if (burst === null || e.ts - burst.lastTs > BURST_QUIET_MS) {
      burst = { kind: 'burst', id: `x:${e.id}`, events: [], lastTs: e.ts };
      rows.push(burst);
    }
    burst.events.push(e);
    burst.lastTs = e.ts;
  }
  return rows;
}

const SUMMARY_NAMES: Partial<Record<PulseKind, [string, string]>> = {
  node_joined: ['join', 'joins'],
  node_started: ['start', 'starts'],
  node_left: ['departure', 'departures'],
  node_expired: ['expiry', 'expiries'],
  node_at_risk: ['node at risk', 'nodes at risk'],
  node_unreachable: ['unreachable node', 'unreachable nodes'],
  node_recovered: ['recovery', 'recoveries'],
  node_ip_changed: ['address change', 'address changes'],
  app_deployed: ['deployment', 'deployments'],
  app_updated: ['app update', 'app updates'],
  app_renewed: ['renewal', 'renewals'],
  app_pending: ['pending update', 'pending updates'],
  app_expired: ['app expiry', 'app expiries'],
  large_transfer: ['large transfer', 'large transfers'],
};

/** "9 joins, 3 expiries, 2 app updates": what a burst held, the three biggest kinds, largest first. */
export function burstSummary(events: readonly PulseEvent[]): string {
  const counts = new Map<PulseKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind, n]) => {
      const nm = SUMMARY_NAMES[kind];
      return `${n} ${nm ? nm[n === 1 ? 0 : 1] : n === 1 ? 'other' : 'others'}`;
    })
    .join(', ');
}

// ---- words ---------------------------------------------------------------------------------------

export interface DescribeContext {
  /** Tier, endpoint and place of a node, when the node table has it. */
  node(id: number): { tier: string; endpoint: string | null; place: string | null } | null;
  /** FLUX amount to a short label (`9.0`). */
  amount(a: string): string;
  height(n: number): string;
  bytes(n: number): string;
  flux(a: string): string;
}

export interface Described {
  title: string;
  sub: string | null;
  /** The window the row opens: its main subject. */
  target: WindowRef | null;
  /** The tier a row's colour takes, when its subject is a node. */
  tier: string | null;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const LEAVE_REASON: Record<string, string> = {
  expired: 'expired',
  collateral_spent: 'collateral spent',
  missing: 'no longer seen',
  dos: 'DoS listed',
};

export function describeEvent(e: PulseEvent, c: DescribeContext): Described {
  const nid = nodeRef(e.refs);
  const facts = nid === null ? null : c.node(nid);
  const tier = e.params.tier ?? facts?.tier ?? null;
  const place = facts?.place ?? null;
  const endpoint = facts?.endpoint ?? null;
  const nodeTarget: WindowRef | null = endpoint ? { type: 'node', key: endpoint } : null;
  const app = e.refs.find((r): r is Extract<FeedRef, { kind: 'app' }> => r.kind === 'app')?.name ?? null;
  const appTarget: WindowRef | null = app ? { type: 'app', key: app } : null;
  const h = blockRef(e.refs);
  const blockTarget: WindowRef | null = h !== null ? { type: 'block', key: String(h) } : null;
  const where = place ? ` in ${place}` : '';
  const named = app ?? 'An app';

  switch (e.kind) {
    case 'block': {
      const b = e.block;
      const prod = b?.producer != null ? c.node(b.producer) : null;
      const parts = [prod?.endpoint, b ? `${b.txCount} tx` : null, b ? c.bytes(b.size) : null].filter(
        Boolean,
      );
      return {
        title: `Block ${c.height(b?.height ?? h ?? 0)} produced`,
        sub: parts.join(', ') || null,
        target: blockTarget,
        tier: prod?.tier ?? null,
      };
    }
    case 'confirmed':
      return {
        title: `Confirmed ${e.count ?? 0} node${e.count === 1 ? '' : 's'}`,
        sub: h !== null ? `block ${c.height(h)}` : null,
        target: blockTarget,
        tier: null,
      };
    case 'paid_mine':
      return {
        title: `Watched node paid +${c.amount(e.params.amount ?? '0')} FLUX`,
        sub:
          [endpoint, tier ? cap(tier) : null, h !== null ? `block ${c.height(h)}` : null]
            .filter(Boolean)
            .join(', ') || null,
        target: nodeTarget ?? blockTarget,
        tier,
      };
    case 'node_paid':
      return {
        title: `Node paid +${c.amount(e.params.amount ?? '0')} FLUX`,
        sub: endpoint,
        target: nodeTarget ?? blockTarget,
        tier,
      };
    case 'node_joined': {
      const phrase = [tier && tier !== 'unknown' ? cap(tier) : null, place ? `in ${place}` : null]
        .filter(Boolean)
        .join(' ');
      const glue = tier && tier !== 'unknown' ? ', ' : place ? ' ' : '';
      return { title: `Node joined${glue}${phrase}`, sub: endpoint, target: nodeTarget, tier };
    }
    case 'node_started':
      return {
        title: `Node started${where}, waiting to be confirmed`,
        sub: endpoint,
        target: nodeTarget,
        tier,
      };
    case 'node_left':
      return {
        title: `Node left, ${LEAVE_REASON[e.params.reason ?? ''] ?? 'no longer listed'}`,
        sub: endpoint,
        target: nodeTarget,
        tier,
      };
    case 'node_expired':
      return {
        title:
          e.params.predicted === 'true' ? 'Node about to expire' : 'Node expired, no check-in for 640 blocks',
        sub: endpoint,
        target: nodeTarget,
        tier,
      };
    case 'node_at_risk':
      return {
        title: `Node at risk, ${e.params.blocks ?? '560 or more'} blocks since its last check-in`,
        sub: endpoint,
        target: nodeTarget,
        tier,
      };
    case 'node_ip_changed':
      return {
        title: 'Node moved to a new address',
        sub: e.params.new ? `${e.params.old || 'unknown'} to ${e.params.new}` : endpoint,
        target: nodeTarget,
        tier,
      };
    case 'node_dosed':
      return { title: 'Node DoS-listed', sub: endpoint, target: nodeTarget, tier };
    case 'collateral_spent':
      return { title: 'Collateral spent, node removed', sub: endpoint, target: nodeTarget, tier };
    case 'node_unreachable':
      return { title: 'Node unreachable', sub: endpoint, target: nodeTarget, tier };
    case 'node_recovered':
      return { title: 'Node reachable again', sub: endpoint, target: nodeTarget, tier };
    case 'node_heartbeat':
      return { title: 'Node confirmed', sub: endpoint, target: nodeTarget, tier };
    case 'app_deployed':
      return {
        title: `${named} deployed`,
        sub: e.params.instances ? `${e.params.instances} instances` : null,
        target: appTarget,
        tier: null,
      };
    case 'app_updated':
      return { title: `${named} updated`, sub: null, target: appTarget, tier: null };
    case 'app_renewed':
      return { title: `${named} renewed`, sub: null, target: appTarget, tier: null };
    case 'app_expired':
      return { title: `${named} expired`, sub: null, target: appTarget, tier: null };
    case 'app_pending':
      return { title: `${named} update pending`, sub: 'not yet mined', target: appTarget, tier: null };
    case 'app_install_failed':
      return { title: `${named} install failed`, sub: null, target: appTarget, tier: null };
    case 'version_milestone':
      return {
        title: e.params.version
          ? `Version ${e.params.version} reached ${e.params.percent ?? 'a milestone'}${e.params.percent ? ' percent of nodes' : ''}`
          : 'Version rollout milestone',
        sub: null,
        target: null,
        tier: null,
      };
    case 'large_transfer':
      return {
        title: `Large transfer, ${c.flux(e.params.value ?? '')} FLUX`,
        sub: null,
        target: e.refs.find((r) => r.kind === 'tx')
          ? {
              type: 'tx',
              key: (e.refs.find((r) => r.kind === 'tx') as Extract<FeedRef, { kind: 'tx' }>).txid,
            }
          : blockTarget,
        tier: null,
      };
    case 'reorg':
      return { title: 'Chain reorganized', sub: null, target: blockTarget, tier: null };
    case 'reward_reduction':
      return { title: 'Reward cut reached, the subsidy fell', sub: null, target: blockTarget, tier: null };
  }
}

import { describe, expect, it } from 'vitest';
import type { FeedKind } from '../../api/generated/FeedKind';
import {
  applyFilter,
  type BlockInput,
  burstSummary,
  collapseBursts,
  type DescribeContext,
  describeEvent,
  type FeedInput,
  groupOf,
  normalize,
  type PulseEvent,
  toneOf,
} from './pulse';

let seq = 0;
const feed = (
  kind: FeedKind,
  observedMs: number,
  refs: FeedInput['item']['refs'] = [],
  params: Record<string, string> = {},
): FeedInput => ({ seq: ++seq, observedMs, item: { kind, ts_ms: observedMs, refs, params } });

const block = (height: number, over: Partial<BlockInput> = {}): BlockInput => ({
  height,
  hash: `h${height}`,
  timeMs: height * 1000,
  observedMs: height * 1000 + 50,
  size: 3_600,
  txCount: 17,
  producer: 1,
  confirmCount: 14,
  live: true,
  payouts: [],
  ...over,
});

const none = new Set<number>();
const ctx: DescribeContext = {
  node: (id) => (id === 1 ? { tier: 'nimbus', endpoint: '1.2.3.4:16137', place: 'Tokyo' } : null),
  amount: (a) => Number(a).toFixed(1),
  height: (n) => n.toLocaleString('en-US'),
  bytes: (n) => `${(n / 1000).toFixed(1)} KB`,
  flux: (a) => Number(a).toFixed(0),
};

describe('groups and tones', () => {
  it('sorts kinds into the filter groups', () => {
    expect(groupOf('block')).toBe('blocks');
    expect(groupOf('confirmed')).toBe('blocks');
    expect(groupOf('large_transfer')).toBe('blocks');
    expect(groupOf('node_joined')).toBe('nodes');
    expect(groupOf('node_dosed')).toBe('nodes');
    expect(groupOf('app_updated')).toBe('apps');
    expect(groupOf('app_pending')).toBe('apps');
  });

  it('gives pending its own quiet tone, never the confirmed one', () => {
    expect(toneOf('app_pending')).toBe('pending');
    expect(toneOf('app_updated')).toBe('app');
    expect(toneOf('node_started')).toBe('join');
  });
});

describe('normalize', () => {
  it('folds a block heartbeats into one "Confirmed N nodes" row', () => {
    const items = [1, 2, 3, 4].map((i) => feed('node_heartbeat', 5_000 + i, [{ kind: 'block', height: 7 }]));
    const events = normalize(items, [], { watched: none });
    const confirmed = events.filter((e) => e.kind === 'confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.count).toBe(4);
    expect(confirmed[0]?.id).toBe('c:7');
  });

  it('keeps payments to others out of the feed and shows payments to watched nodes', () => {
    const paid = (node: number) =>
      feed(
        'node_paid',
        9_000,
        [
          { kind: 'node', id: node },
          { kind: 'block', height: 7 },
        ],
        { amount: '9' },
      );
    const events = normalize([paid(5), paid(6)], [], { watched: new Set([6]) });
    expect(events.map((e) => e.kind)).toEqual(['node_paid']);
    expect(events[0]?.mine).toBe(true);
  });

  it('turns a block into a row, and its payout to a watched node into a mine row', () => {
    const b = block(10, { payouts: [{ tier: 'stratus', node: 9, amount: '9.00000000' }] });
    const events = normalize([], [b], { watched: new Set([9]) });
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['block', 'confirmed', 'paid_mine']);
    expect(events.find((e) => e.kind === 'paid_mine')?.mine).toBe(true);
  });

  it('does not invent a heartbeat row for a bootstrap block', () => {
    const b = block(10, { live: false, observedMs: null });
    expect(normalize([], [b], { watched: none }).map((e) => e.kind)).toEqual(['block']);
  });

  it('orders newest first and marks events that concern watched nodes', () => {
    const items = [
      feed('node_joined', 1_000, [{ kind: 'node', id: 4 }]),
      feed('node_left', 2_000, [{ kind: 'node', id: 5 }]),
    ];
    const events = normalize(items, [], { watched: new Set([4]) });
    expect(events.map((e) => e.kind)).toEqual(['node_left', 'node_joined']);
    expect(events.map((e) => e.mine)).toEqual([false, true]);
  });

  it('limits how many blocks become rows', () => {
    const blocks = [10, 9, 8, 7, 6].map((h) => block(h, { live: false, observedMs: null }));
    expect(
      normalize([], blocks, { watched: none, maxBlocks: 2 }).filter((e) => e.kind === 'block'),
    ).toHaveLength(2);
  });
});

describe('applyFilter', () => {
  const evs: PulseEvent[] = normalize(
    [
      feed('node_joined', 1_000, [{ kind: 'node', id: 4 }]),
      feed('app_updated', 2_000, [{ kind: 'app', name: 'X' }]),
    ],
    [block(3)],
    { watched: new Set([4]) },
  );

  it('narrows by group and by ownership', () => {
    expect(applyFilter(evs, 'all')).toHaveLength(evs.length);
    expect(applyFilter(evs, 'apps').map((e) => e.kind)).toEqual(['app_updated']);
    expect(applyFilter(evs, 'nodes').map((e) => e.kind)).toEqual(['node_joined']);
    expect(applyFilter(evs, 'blocks').every((e) => e.group === 'blocks')).toBe(true);
    expect(applyFilter(evs, 'mine').map((e) => e.kind)).toEqual(['node_joined']);
  });
});

describe('collapseBursts', () => {
  const joined = (ts: number, id: number) =>
    normalize([feed('node_joined', ts, [{ kind: 'node', id }])], [], { watched: none })[0]!;
  const newestFirst = (...e: PulseEvent[]) => e.sort((a, b) => b.ts - a.ts);

  it('shows the first three network events in a second as rows and collapses the rest', () => {
    const evs = newestFirst(...[0, 100, 200, 300, 400, 500].map((t, i) => joined(10_000 + t, i + 1)));
    const rows = collapseBursts(evs);
    expect(rows.map((r) => r.kind)).toEqual(['event', 'event', 'event', 'burst']);
    const burst = rows[3];
    expect(burst?.kind === 'burst' && burst.events).toHaveLength(3);
  });

  it('keeps one burst row counting while the burst continues, across windows', () => {
    const times = [0, 100, 200, 300, 1_200, 1_300, 1_900, 2_000, 2_100];
    const rows = collapseBursts(newestFirst(...times.map((t, i) => joined(10_000 + t, i + 1))));
    const bursts = rows.filter((r) => r.kind === 'burst');
    expect(bursts).toHaveLength(1);
  });

  it('starts a new burst row after two seconds of quiet', () => {
    const first = [0, 10, 20, 30, 40].map((t, i) => joined(10_000 + t, i + 1));
    const second = [0, 10, 20, 30, 40].map((t, i) => joined(20_000 + t, i + 10));
    const rows = collapseBursts(newestFirst(...first, ...second));
    expect(rows.filter((r) => r.kind === 'burst')).toHaveLength(2);
  });

  it('never collapses block, heartbeat or watched rows', () => {
    const b = normalize([], [block(5), block(6), block(7)], { watched: none });
    const rows = collapseBursts(b);
    expect(rows.every((r) => r.kind === 'event')).toBe(true);
  });

  it('renders a quiet feed as plain rows, oldest first', () => {
    const rows = collapseBursts(newestFirst(joined(10_000, 1), joined(15_000, 2)));
    expect(rows.map((r) => (r.kind === 'event' ? r.ev.ts : 0))).toEqual([10_000, 15_000]);
  });
});

describe('burstSummary', () => {
  it('names the biggest kinds, largest first, with plurals', () => {
    const mk = (kind: FeedKind, n: number) =>
      Array.from({ length: n }, (_, i) => normalize([feed(kind, 1_000 + i, [])], [], { watched: none })[0]!);
    const s = burstSummary([...mk('node_joined', 9), ...mk('node_expired', 1), ...mk('app_updated', 2)]);
    expect(s).toBe('9 joins, 2 app updates, 1 expiry');
  });
});

describe('describeEvent', () => {
  const ev = (kind: FeedKind, refs: FeedInput['item']['refs'], params: Record<string, string> = {}) =>
    normalize([feed(kind, 1_000, refs, params)], [], { watched: none })[0]!;

  it('writes a join with the tier and place, linking to the node', () => {
    const d = describeEvent(ev('node_joined', [{ kind: 'node', id: 1 }]), ctx);
    expect(d.title).toBe('Node joined, Nimbus in Tokyo');
    expect(d.sub).toBe('1.2.3.4:16137');
    expect(d.target).toEqual({ type: 'node', key: '1.2.3.4:16137' });
  });

  it('falls back gracefully when the node is not in the table', () => {
    const d = describeEvent(ev('node_joined', [{ kind: 'node', id: 99 }]), ctx);
    expect(d.title).toBe('Node joined');
    expect(d.target).toBeNull();
  });

  it('never calls a pending app update confirmed', () => {
    const d = describeEvent(ev('app_pending', [{ kind: 'app', name: 'Fluxtracker' }]), ctx);
    expect(d.title).toBe('Fluxtracker update pending');
    expect(d.title.toLowerCase()).not.toContain('updated');
    expect(d.target).toEqual({ type: 'app', key: 'Fluxtracker' });
  });

  it('reads the reasons a node left', () => {
    expect(describeEvent(ev('node_left', [{ kind: 'node', id: 1 }], { reason: 'dos' }), ctx).title).toBe(
      'Node left, DoS listed',
    );
    expect(describeEvent(ev('node_left', [], {}), ctx).title).toBe('Node left, no longer listed');
  });

  it('describes a block with its producer, tx count and size', () => {
    const e = normalize([], [block(2_997_689)], { watched: none }).find((x) => x.kind === 'block')!;
    const d = describeEvent(e, ctx);
    expect(d.title).toBe('Block 2,997,689 produced');
    expect(d.sub).toBe('1.2.3.4:16137, 17 tx, 3.6 KB');
    expect(d.target).toEqual({ type: 'block', key: '2997689' });
  });

  it('links a large transfer to its transaction', () => {
    const d = describeEvent(
      ev(
        'large_transfer',
        [
          { kind: 'tx', txid: 'abc' },
          { kind: 'block', height: 9 },
        ],
        { value: '1200' },
      ),
      ctx,
    );
    expect(d.title).toBe('Large transfer, 1200 FLUX');
    expect(d.target).toEqual({ type: 'tx', key: 'abc' });
  });

  it('singularizes the confirmed row', () => {
    const e = normalize([feed('node_heartbeat', 1, [{ kind: 'block', height: 3 }])], [], {
      watched: none,
    })[0]!;
    expect(describeEvent(e, ctx).title).toBe('Confirmed 1 node');
  });
});

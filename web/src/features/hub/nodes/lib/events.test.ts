import { describe, expect, it } from 'vitest';
import type { FeedKind } from '../../../../api/generated/FeedKind';
import { eventPhrase, type FeedEntryLike, nodeEventRow, nodeEvents } from './events';

const entry = (
  seq: number,
  kind: FeedKind,
  params: Record<string, string> = {},
  node: number | null = seq,
  ts = 1_000 * seq,
): FeedEntryLike => ({
  seq,
  observedMs: ts + 5,
  item: { kind, ts_ms: ts, refs: node === null ? [] : [{ kind: 'node', id: node }], params },
});

describe('nodeEventRow', () => {
  it('keeps the events that change who is on the network', () => {
    const kinds: FeedKind[] = [
      'node_joined',
      'node_started',
      'node_left',
      'node_expired',
      'node_dosed',
      'collateral_spent',
    ];
    for (const k of kinds) expect(nodeEventRow(entry(1, k))).not.toBeNull();
  });

  it('leaves out the noise: heartbeats, payments, app and chain events', () => {
    const kinds: FeedKind[] = [
      'node_heartbeat',
      'node_paid',
      'app_deployed',
      'large_transfer',
      'reorg',
      'node_at_risk',
    ];
    for (const k of kinds) expect(nodeEventRow(entry(1, k))).toBeNull();
  });

  it('reads the node, the block and the time off the entry', () => {
    const r = nodeEventRow(entry(7, 'node_joined', { height: '3007723' }, 42, 5_000));
    expect(r).toMatchObject({ key: '7', status: 'confirmed', nodeId: 42, height: 3007723, tsMs: 5_000 });
  });

  it('falls back to when the client saw it if the event has no time', () => {
    expect(nodeEventRow(entry(3, 'node_started', {}, 1, 0))?.tsMs).toBe(5);
  });

  it('has no node id when the entry names none, and ignores a bad height', () => {
    const r = nodeEventRow(entry(4, 'node_expired', { height: 'soon' }, null));
    expect(r?.nodeId).toBeNull();
    expect(r?.height).toBeNull();
  });
});

describe('eventPhrase', () => {
  it('says what happened and in which block', () => {
    expect(eventPhrase(nodeEventRow(entry(1, 'node_joined', { height: '3007723' }))!)).toBe(
      'confirmed in block 3,007,723',
    );
    expect(eventPhrase(nodeEventRow(entry(1, 'node_started'))!)).toBe('started');
  });

  it('gives the reason a node left, when the server did', () => {
    expect(eventPhrase(nodeEventRow(entry(1, 'node_left', { reason: 'collateral_spent' }))!)).toBe(
      'left: its collateral was spent',
    );
    expect(eventPhrase(nodeEventRow(entry(1, 'node_left', { reason: 'unheard-of' }))!)).toBe('left');
  });

  it('names the DoS listing and a spent collateral in their own words', () => {
    expect(eventPhrase(nodeEventRow(entry(1, 'node_dosed', { height: '10' }))!)).toBe(
      'was listed for DoS in block 10',
    );
    expect(eventPhrase(nodeEventRow(entry(1, 'collateral_spent'))!)).toBe('had its collateral spent');
  });
});

describe('nodeEvents', () => {
  it('takes the newest node events of a newest-first feed, skipping what is not one', () => {
    const feed = [
      entry(9, 'node_heartbeat'),
      entry(8, 'node_joined'),
      entry(7, 'node_paid'),
      entry(6, 'node_left'),
      entry(5, 'node_started'),
    ];
    expect(nodeEvents(feed, 2).map((r) => r.key)).toEqual(['8', '6']);
    expect(nodeEvents(feed, 10).map((r) => r.key)).toEqual(['8', '6', '5']);
  });

  it('is empty for an empty feed', () => {
    expect(nodeEvents([], 8)).toEqual([]);
  });
});

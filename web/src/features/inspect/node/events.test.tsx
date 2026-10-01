import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../../api/generated/FeedItem';
import { feedTimeline } from './events';

const item = (over: Partial<FeedItem>): FeedItem =>
  ({
    kind: 'node_heartbeat',
    ts_ms: 1_700_000_000_000,
    params: {},
    refs: [],
    ...over,
  }) as FeedItem;

describe('feedTimeline', () => {
  it('moves a block height out of the sentence and into the row', () => {
    const [row] = feedTimeline([item({ kind: 'node_heartbeat', params: { height: '2997554' } })]);
    expect(row?.title).toBe('Checked in');
    expect(row?.meta).toBeTruthy();
    expect(row?.tone).toBe('neutral');
  });

  it('keeps a sentence that has no height as it is, with its colour', () => {
    const [row] = feedTimeline([item({ kind: 'node_unreachable' })]);
    expect(row?.title).toBe('Became unreachable');
    expect(row?.meta).toBeUndefined();
    expect(row?.tone).toBe('warn');
  });

  it('keeps the newest first and stops at the limit', () => {
    const rows = feedTimeline(
      Array.from({ length: 12 }, (_, i) => item({ ts_ms: 1_700_000_000_000 - i * 1000 })),
      5,
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]!.time).toBeGreaterThan(rows[4]!.time as number);
  });

  it('gives every row its own id', () => {
    const rows = feedTimeline([
      item({ ts_ms: 1 }),
      item({ ts_ms: 2 }),
      item({ kind: 'node_paid', ts_ms: 2, params: { amount: '9.00000000' } }),
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

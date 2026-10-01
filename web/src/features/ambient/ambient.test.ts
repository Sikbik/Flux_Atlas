import { describe, expect, it } from 'vitest';
import type { AmbientCaption } from '../../globe/engine/types';
import { NUDGE_EVERY_MS, RELOAD_AFTER_MS, RELOAD_COOLDOWN_MS, watchdogAction } from './kiosk';
import { captionHoldMs, captionText, listJoin, payeePlaces } from './sentences';
import { emptyTicker, ingest, TICKER_GAP_MS, TICKER_LIFE_MS, TICKER_ROWS, tick } from './ticker';

describe('listJoin', () => {
  it('reads like a sentence', () => {
    expect(listJoin([])).toBe('');
    expect(listJoin(['Helsinki'])).toBe('Helsinki');
    expect(listJoin(['Helsinki', 'Raleigh'])).toBe('Helsinki and Raleigh');
    expect(listJoin(['Helsinki', 'Raleigh', 'Taganrog'])).toBe('Helsinki, Raleigh and Taganrog');
  });
});

describe('payeePlaces', () => {
  it('lists the largest payout first and each place once', () => {
    const places = payeePlaces([
      { name: 'Taganrog', tier: 1, amount: 1 },
      { name: 'Helsinki', tier: 3, amount: 9 },
      { name: 'Raleigh', tier: 2, amount: 3.5 },
      { name: 'Helsinki', tier: 2, amount: 3.5 },
      { name: '', tier: 1, amount: 1 },
    ]);
    expect(places).toEqual(['Helsinki', 'Raleigh', 'Taganrog']);
  });

  it('falls back to the plain names when the payees carry no tiers', () => {
    expect(payeePlaces(undefined, ['A', 'B'])).toEqual(['A', 'B']);
  });
});

const block = (over: Partial<AmbientCaption> = {}): AmbientCaption => ({
  kind: 'block',
  title: 'Block 2,997,846',
  height: 2_997_846,
  producerName: 'Reston',
  payeeNames: ['Taganrog', 'Raleigh', 'Helsinki'],
  payees: [
    { name: 'Taganrog', tier: 1, amount: 1 },
    { name: 'Raleigh', tier: 2, amount: 3.5 },
    { name: 'Helsinki', tier: 3, amount: 9 },
  ],
  duration: 9,
  ...over,
});

describe('captionText', () => {
  it('turns a landing into the one sentence', () => {
    expect(captionText(block(), null)).toEqual({
      kind: 'sentence',
      lead: 'Block 2,997,846 came from Reston.',
      sub: 'Paid to Helsinki, Raleigh and Taganrog.',
    });
  });

  it('copes with a landing that has no place names', () => {
    const t = captionText(block({ producerName: '', payees: [], payeeNames: [] }), null);
    expect(t.lead).toBe('Block 2,997,846 is in.');
    expect(t.sub).toBeNull();
  });

  it('keeps the other scenes to a label and a line', () => {
    const t = captionText(
      { kind: 'shot', title: 'Dusk line', subtitle: 'Where the sun meets the network', duration: 6 },
      null,
    );
    expect(t).toEqual({ kind: 'scene', lead: 'Dusk line', sub: 'Where the sun meets the network' });
  });

  it('says what the network is right now for the counters scene', () => {
    const summary = { node_count: 6715, app_count: 1900, country_count: 54 } as never;
    const t = captionText({ kind: 'stats', title: 'The network now', duration: 6 }, summary);
    expect(t.sub).toBe('6,715 nodes, 1,900 apps, 54 countries');
    expect(captionText({ kind: 'stats', title: 'The network now', duration: 6 }, null).sub).toBeNull();
  });
});

describe('captionHoldMs', () => {
  it('holds a caption for its duration, within 3 and 9 seconds', () => {
    expect(captionHoldMs(block({ duration: 9 }))).toBe(9000);
    expect(captionHoldMs(block({ duration: 26 }))).toBe(9000);
    expect(captionHoldMs(block({ duration: 1 }))).toBe(3000);
  });
});

describe('the ticker', () => {
  const e = (seq: number, kind: 'node_joined' | 'node_heartbeat' | 'app_deployed') => ({ seq, kind });
  const text = (x: { seq: number }) => `item ${x.seq}`;

  it('does not replay history when it first looks at the feed', () => {
    const s = ingest(emptyTicker(), [e(9, 'node_joined'), e(8, 'app_deployed')], text);
    expect(s.lastSeq).toBe(9);
    expect(s.queue).toEqual([]);
  });

  it('queues only worthwhile new entries, oldest first', () => {
    let s = ingest(emptyTicker(), [e(9, 'node_joined')], text);
    s = ingest(
      s,
      [e(12, 'app_deployed'), e(11, 'node_heartbeat'), e(10, 'node_joined'), e(9, 'node_joined')],
      text,
    );
    expect(s.queue.map((q) => q.key)).toEqual([10, 12]);
    expect(s.lastSeq).toBe(12);
  });

  it('shows one row at a time, a few seconds apart, newest on top', () => {
    let s = ingest(emptyTicker(), [e(1, 'node_joined')], text);
    s = ingest(s, [e(4, 'app_deployed'), e(3, 'node_joined'), e(2, 'node_joined')], text);
    s = tick(s, 100_000);
    expect(s.rows.map((r) => r.key)).toEqual([2]);
    s = tick(s, 100_000 + TICKER_GAP_MS - 1);
    expect(s.rows).toHaveLength(1);
    s = tick(s, 100_000 + TICKER_GAP_MS);
    s = tick(s, 100_000 + 2 * TICKER_GAP_MS);
    expect(s.rows.map((r) => r.key)).toEqual([4, 3, 2]);
    expect(s.rows).toHaveLength(TICKER_ROWS);
  });

  it('lets a row go after its life, and rests when there is nothing to do', () => {
    let s = ingest(emptyTicker(), [e(1, 'node_joined')], text);
    s = ingest(s, [e(2, 'node_joined'), e(1, 'node_joined')], text);
    s = tick(s, 0);
    const same = tick(s, 1000);
    expect(same).toBe(s);
    s = tick(s, TICKER_LIFE_MS + 1);
    expect(s.rows).toEqual([]);
  });

  it('keeps only the newest of a long burst', () => {
    let s = ingest(emptyTicker(), [e(1, 'node_joined')], text);
    const burst = Array.from({ length: 20 }, (_, i) => e(21 - i, 'node_joined'));
    s = ingest(s, burst, text);
    expect(s.queue.length).toBeLessThanOrEqual(6);
    expect(s.queue[s.queue.length - 1]?.key).toBe(21);
  });
});

describe('the kiosk watchdog', () => {
  const base = { downSinceMs: 0, nowMs: 0, lastReloadMs: null };

  it('leaves a healthy or starting connection alone', () => {
    for (const status of ['live', 'syncing', 'connecting', 'idle'] as const)
      expect(watchdogAction({ ...base, status, nowMs: 10 * RELOAD_AFTER_MS })).toBe('none');
  });

  it('nudges a dropped stream, and keeps nudging', () => {
    expect(watchdogAction({ ...base, status: 'reconnecting', nowMs: NUDGE_EVERY_MS })).toBe('nudge');
    expect(watchdogAction({ ...base, status: 'offline', downSinceMs: null })).toBe('nudge');
  });

  it('reloads once a stream has been gone for minutes', () => {
    expect(watchdogAction({ ...base, status: 'offline', nowMs: RELOAD_AFTER_MS })).toBe('reload');
    expect(watchdogAction({ ...base, status: 'offline', nowMs: RELOAD_AFTER_MS - 1 })).toBe('nudge');
  });

  it('never reloads twice in a row, so a dead backend cannot loop the page', () => {
    const t = 2 * RELOAD_AFTER_MS;
    expect(watchdogAction({ ...base, status: 'offline', nowMs: t, lastReloadMs: t - 1000 })).toBe('nudge');
    expect(
      watchdogAction({ ...base, status: 'offline', nowMs: t, lastReloadMs: t - RELOAD_COOLDOWN_MS }),
    ).toBe('reload');
  });
});

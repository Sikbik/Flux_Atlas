import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveMsg } from '../api/generated/LiveMsg';
import { blockMsg, live } from '../testing/fixtures';
import { BEAT_TIMING, Choreographer, type ChoreographerOptions } from './choreographer';
import { type RecordedEffect, recordingSink } from './effects';

const T0 = 5_000_000;

function setup(opts: ChoreographerOptions = {}) {
  const sink = recordingSink(() => Date.now() - T0, { capacity: 10_000 });
  const c = new Choreographer(sink, { tierOf: () => 'cumulus', ...opts });
  const names = (from = 0) => sink.log.slice(from).map((e) => e.name);
  const timeline = (name: string) => sink.log.filter((e) => e.name === name);
  return { sink, c, names, timeline };
}

/** A LiveMsg observed "now" (fresh). */
function fresh(t: LiveMsg['t'], seq: number, body: object): LiveMsg {
  return live(t, seq, body, Date.now());
}

const block = (h: number, opts: Parameters<typeof blockMsg>[1] = {}) => fresh('block', h, blockMsg(h, opts));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('the Beat', () => {
  it('stages producer flare, uplink to the moon, moon flare, downlinks in tier order, landings', () => {
    const { c, sink } = setup();
    c.handle(block(100, { producer: 7, payees: [10, 20, 30] }));
    vi.advanceTimersByTime(10_000);
    const beams = sink.log.filter((e) =>
      ['beat', 'uplink', 'moonFlare', 'downlink', 'payoutLanded', 'devFund'].includes(e.name),
    );
    const at = (e: RecordedEffect) => [e.at, e.name, (e.cmd as { tier?: string })?.tier ?? ''];
    expect(beams.map(at)).toEqual([
      [0, 'beat', ''],
      [160, 'uplink', ''],
      [880, 'moonFlare', ''],
      [880, 'downlink', 'stratus'],
      [1000, 'downlink', 'nimbus'],
      [1120, 'downlink', 'cumulus'],
      [1240, 'devFund', ''],
      [1780, 'payoutLanded', 'stratus'],
      [1900, 'payoutLanded', 'nimbus'],
      [2020, 'payoutLanded', 'cumulus'],
    ]);
    const beat = sink.log[0]!.cmd as { producer: number; compact: boolean; reduced: boolean };
    expect(beat).toMatchObject({ producer: 7, compact: false, reduced: false });
    expect(sink.log.find((e) => e.name === 'uplink')!.cmd).toMatchObject({
      from: 7,
      durationMs: BEAT_TIMING.uplinkMs,
    });
    expect(sink.log.find((e) => e.name === 'downlink')!.cmd).toMatchObject({
      to: 30,
      amount: '9.00000000',
      order: 0,
    });
  });

  it('spreads the heartbeat ripple over 2 to 4 s after the beams, sampled to the budget', () => {
    const { c, timeline } = setup();
    const heartbeats = Array.from({ length: 14 }, (_, k) => 100 + k);
    c.handle(block(100, { heartbeats, confirms: [200] }));
    vi.advanceTimersByTime(10_000);
    const hb = timeline('heartbeats');
    const nodes = hb.flatMap((e) => (e.cmd as { nodes: number[] }).nodes);
    expect(nodes.length).toBe(15);
    expect(new Set(nodes).size).toBe(15);
    expect(hb[0]!.at).toBe(BEAT_TIMING.heartbeatStart);
    const last = hb[hb.length - 1]!.at;
    expect(last).toBeGreaterThan(BEAT_TIMING.heartbeatStart + 1_000);
    expect(last).toBeLessThan(BEAT_TIMING.heartbeatStart + 3_000);
  });

  it('samples a huge ripple and counts the rest into a summary', () => {
    const { c, timeline } = setup();
    const heartbeats = Array.from({ length: 200 }, (_, k) => 1000 + k);
    c.handle(block(100, { heartbeats }));
    vi.advanceTimersByTime(10_000);
    const nodes = timeline('heartbeats').flatMap((e) => (e.cmd as { nodes: number[] }).nodes);
    expect(nodes.length).toBe(48); // 12 per second over the 4 s maximum spread
    const summaries = timeline('summary').map(
      (e) => e.cmd as { kind: string; count: number; final: boolean },
    );
    expect(summaries.at(-1)).toMatchObject({ kind: 'heartbeats', count: 152, final: true });
  });

  it('plays a second block inside 3 s as the compact version and flushes the first one', () => {
    const { c, sink, timeline } = setup();
    c.handle(block(100, { heartbeats: [1, 2, 3] }));
    vi.advanceTimersByTime(500);
    c.handle(block(101, { heartbeats: [4, 5] }));
    // Block 100's pending beams ran at once (never skipped); its ripple was dropped.
    const at500 = sink.log.filter((e) => e.at === 500).map((e) => e.name);
    expect(at500.filter((n) => n === 'payoutLanded').length).toBe(3);
    expect(at500).toContain('beat');
    vi.advanceTimersByTime(10_000);
    const beats = timeline('beat').map((e) => e.cmd as { height: number; compact: boolean });
    expect(beats).toEqual([
      expect.objectContaining({ height: 100, compact: false }),
      expect.objectContaining({ height: 101, compact: true }),
    ]);
    const compactLand = timeline('payoutLanded').filter((e) => (e.cmd as { height: number }).height === 101);
    expect(compactLand.map((e) => e.at - 500)).toEqual([900, 960, 1020]);
    expect(timeline('heartbeats').length).toBe(0);
    expect(c.stats().compactBlocks).toBe(1);
  });

  it('plays the full version again once 3 s have passed', () => {
    const { c, timeline } = setup();
    c.handle(block(100));
    vi.advanceTimersByTime(3_000);
    c.handle(block(101));
    expect(timeline('beat').map((e) => (e.cmd as { compact: boolean }).compact)).toEqual([false, false]);
  });

  it('marks the emission block', () => {
    const { c, timeline } = setup();
    c.handle(block(3_071_200));
    expect(timeline('beat')[0]!.cmd).toMatchObject({ emission: true });
  });
});

describe('pre-aim', () => {
  it('aims after the landing completes and collapses on the next landing', () => {
    const { c, timeline } = setup();
    c.handle(block(100));
    vi.advanceTimersByTime(300);
    c.handle(fresh('next_payees', 2, { height: 101, payees: [{ tier: 'stratus', node: 33, address: 'a' }] }));
    expect(timeline('aim').length).toBe(0);
    vi.advanceTimersByTime(10_000);
    const aim = timeline('aim');
    expect(aim.length).toBe(1);
    expect(aim[0]!.at).toBe(2_020);
    expect(aim[0]!.cmd).toMatchObject({ height: 101, payees: [{ tier: 'stratus', node: 33 }] });
    c.handle(block(101));
    vi.advanceTimersByTime(10_000);
    const clear = timeline('clearAim');
    expect(clear.length).toBe(1);
    expect(clear[0]!.at).toBe(timeline('payoutLanded').at(-1)!.at);
  });

  it('never clears the next aim with the previous landing', () => {
    const { c, sink } = setup();
    c.handle(fresh('next_payees', 1, { height: 100, payees: [{ tier: 'stratus', node: 1, address: 'a' }] }));
    c.handle(block(100));
    c.handle(fresh('next_payees', 3, { height: 101, payees: [{ tier: 'stratus', node: 2, address: 'b' }] }));
    vi.advanceTimersByTime(10_000);
    const seq = sink.log
      .filter((e) => e.name === 'aim' || e.name === 'clearAim')
      .map((e) => (e.name === 'aim' ? `aim:${(e.cmd as { height: number }).height}` : 'clear'));
    expect(seq).toEqual(['aim:100', 'clear', 'aim:101']);
  });

  it('computes the ETA from the last block time', () => {
    const { c, timeline } = setup();
    const b = blockMsg(100);
    b.time_ms = Date.now() - 10_000;
    c.handle(fresh('block', 1, b));
    vi.advanceTimersByTime(5_000);
    c.handle(fresh('next_payees', 2, { height: 101, payees: [] }));
    expect((timeline('aim')[0]!.cmd as { etaMs: number }).etaMs).toBe(15_000);
  });

  it('ignores payees for a height that already landed', () => {
    const { c, timeline } = setup();
    c.handle(block(100));
    vi.advanceTimersByTime(5_000);
    c.handle(fresh('next_payees', 2, { height: 100, payees: [] }));
    expect(timeline('aim').length).toBe(0);
  });
});

describe('budgets, coalescing and priority', () => {
  const joined = (ids: number[], seq = 1) =>
    fresh('nodes', seq, {
      prev_seq: 0,
      added: ids.map((id) => ({
        id,
        outpoint: 'x:0',
        endpoint: null,
        tier: 'cumulus',
        status: 'confirmed',
        lat: null,
        lon: null,
        country_code: null,
        org: null,
        rank: null,
        last_paid_height: null,
        app_count: 0,
        flags: 0,
      })),
      removed: [],
      changed: [],
      cause: 'reconcile',
    });

  it('renders the first 3 of a burst and collapses the rest into one updating summary', () => {
    const { c, timeline } = setup();
    c.handle(joined([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(timeline('pulse').map((e) => (e.cmd as { node: number }).node)).toEqual([1, 2, 3]);
    const s1 = timeline('summary');
    expect(s1.length).toBe(1);
    vi.advanceTimersByTime(600);
    c.handle(joined([11, 12]));
    vi.advanceTimersByTime(2_500);
    const s = timeline('summary').map((e) => e.cmd as { id: string; count: number; final: boolean });
    expect(new Set(s.map((x) => x.id)).size).toBe(1);
    expect(s.at(-1)).toMatchObject({ count: 9, final: true });
  });

  it('caps network pulses at 8 per second across kinds', () => {
    const { c, timeline } = setup();
    const change = (id: number, status: string) => ({ id, status });
    c.handle(
      fresh('nodes', 1, {
        prev_seq: 0,
        added: [],
        removed: [1, 2, 3],
        changed: [
          change(4, 'dos'),
          change(5, 'dos'),
          change(6, 'dos'),
          change(7, 'expired'),
          change(8, 'expired'),
          change(9, 'expired'),
          { id: 10, endpoint: '1.2.3.4:1' },
        ],
        cause: 'block',
      }),
    );
    expect(timeline('pulse').length).toBe(8);
    vi.advanceTimersByTime(1_000);
    c.handle(fresh('nodes', 2, { prev_seq: 1, added: [], removed: [50], changed: [], cause: 'block' }));
    expect(timeline('pulse').length).toBe(9);
  });

  it('lets selected, watched and owned nodes bypass budgets and coalescing', () => {
    const { c, timeline } = setup();
    c.setFocus([5, 6, 7, 8, 9]);
    c.handle(joined([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const pulses = timeline('pulse').map((e) => e.cmd as { node: number; priority: number });
    expect(pulses.filter((p) => p.priority === 1).map((p) => p.node)).toEqual([5, 6, 7, 8, 9]);
    expect(pulses.filter((p) => p.priority === 2).map((p) => p.node)).toEqual([1, 2, 3]);
  });

  it('flags payouts and heartbeats of focus nodes', () => {
    const { c, timeline } = setup();
    c.setFocus([20, 77]);
    c.handle(block(100, { payees: [10, 20, 30], heartbeats: [77, 78] }));
    vi.advanceTimersByTime(10_000);
    const down = timeline('downlink').map((e) => e.cmd as { to: number; mine: boolean });
    expect(down.find((d) => d.to === 20)?.mine).toBe(true);
    expect(down.find((d) => d.to === 10)?.mine).toBe(false);
    expect(timeline('pulse')[0]).toMatchObject({ at: 0, cmd: { node: 77, kind: 'confirmed', priority: 1 } });
    const ripple = timeline('heartbeats').flatMap((e) => (e.cmd as { nodes: number[] }).nodes);
    expect(ripple).toEqual([78]);
  });

  it('staggers app instance pops 80 ms apart', () => {
    const { c, timeline } = setup();
    c.handle(
      fresh('apps', 1, {
        prev_seq: 0,
        upserted: [],
        removed: [],
        instances: [{ app: 'x', started: [1, 2, 3], removed: [], updated: [] }],
        cause: 'sweep',
      }),
    );
    vi.advanceTimersByTime(1_000);
    expect(timeline('pulse').map((e) => [e.at, (e.cmd as { kind: string }).kind])).toEqual([
      [0, 'instance_started'],
      [80, 'instance_started'],
      [160, 'instance_started'],
    ]);
  });

  it('ignores bookkeeping-only changes (rank, payments)', () => {
    const { c, sink } = setup();
    c.handle(
      fresh('nodes', 1, {
        prev_seq: 0,
        added: [],
        removed: [],
        changed: [{ id: 1, rank: 5 }],
        cause: 'reconcile',
      }),
    );
    c.handle(fresh('mempool', 2, { txs: [] }));
    c.handle(fresh('stats', 3, { summary: {} }));
    expect(sink.log.length).toBe(0);
  });

  it('samples mesh links to the ambient budget', () => {
    const { c, timeline } = setup();
    const added = Array.from({ length: 20 }, (_, k) => [k, k + 100] as [number, number]);
    c.handle(fresh('mesh', 1, { added, removed: [], reporters: [] }));
    expect((timeline('links')[0]!.cmd as { added: unknown[] }).added.length).toBe(12);
    expect(timeline('summary')[0]!.cmd).toMatchObject({ kind: 'links', count: 8 });
  });
});

describe('visibility, catch-up and motion', () => {
  it('plays nothing while hidden and recaps on return', () => {
    const { c, sink, timeline } = setup();
    c.handle(block(100));
    vi.advanceTimersByTime(200);
    c.setVisible(false);
    const before = sink.log.length;
    vi.advanceTimersByTime(10_000);
    c.handle(block(101));
    c.handle(block(102));
    c.handle(fresh('nodes', 5, { prev_seq: 0, added: [], removed: [1, 2], changed: [], cause: 'block' }));
    expect(sink.log.length).toBe(before);
    vi.advanceTimersByTime(60_000);
    c.handle(fresh('next_payees', 6, { height: 103, payees: [] }));
    c.setVisible(true);
    const recap = timeline('recap');
    expect(recap.length).toBe(1);
    expect(recap[0]!.cmd).toMatchObject({
      reason: 'hidden',
      blocks: 2,
      lastHeight: 102,
      byKind: { block: 2, nodes: 2 },
    });
    expect(timeline('aim').at(-1)!.cmd).toMatchObject({ height: 103 });
  });

  it('does not animate a replay backlog and recaps it once caught up', () => {
    const { c, timeline } = setup();
    const old = (h: number) => live('block', h, blockMsg(h), Date.now() - 60_000);
    c.handle(old(100));
    c.handle(old(101));
    expect(timeline('beat').length).toBe(0);
    c.handle(block(102));
    expect(timeline('recap')[0]!.cmd).toMatchObject({ reason: 'catch_up', blocks: 2, lastHeight: 101 });
    expect(timeline('beat').length).toBe(1);
  });

  it('reduced motion: static flash and a payee highlight instead of beams', () => {
    const { c, sink } = setup({ motion: 'reduced' });
    c.handle(block(100, { heartbeats: [1, 2] }));
    vi.advanceTimersByTime(10_000);
    const names = sink.log.map((e) => e.name);
    expect(names).not.toContain('uplink');
    expect(names).not.toContain('downlink');
    expect(sink.log.filter((e) => e.name === 'payoutLanded').every((e) => e.at === 0)).toBe(true);
    expect(sink.log[0]!.cmd).toMatchObject({ reduced: true });
    expect(sink.log.find((e) => e.name === 'payoutLanded')!.cmd).toMatchObject({ highlightMs: 1_200 });
  });

  it('motion off: no commands at all', () => {
    const { c, sink } = setup({ motion: 'off' });
    c.handle(block(100));
    c.handle(fresh('next_payees', 2, { height: 101, payees: [] }));
    vi.advanceTimersByTime(10_000);
    expect(sink.log.length).toBe(0);
  });

  it('is deterministic', () => {
    const run = () => {
      vi.setSystemTime(T0);
      const { c, sink } = setup();
      c.setFocus([3]);
      c.handle(block(100, { heartbeats: [1, 2, 3, 4, 5, 6, 7, 8], producer: 9 }));
      vi.advanceTimersByTime(700);
      c.handle(block(101, { heartbeats: [9, 10] }));
      vi.advanceTimersByTime(10_000);
      return JSON.stringify(sink.log);
    };
    expect(run()).toBe(run());
  });

  it('cleans up its timers', () => {
    const { c } = setup();
    c.handle(block(100, { heartbeats: [1, 2, 3] }));
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

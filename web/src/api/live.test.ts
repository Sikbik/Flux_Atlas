import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveMsg } from './generated/LiveMsg';
import {
  ALL_TOPICS,
  CloseCode,
  LiveClient,
  type LiveClientOptions,
  type LiveEnvironment,
  type WebSocketLike,
} from './live';

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  // Server side.
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  hello(seq: number, now = Date.now(), startedMs = 1, instance = 'aaaaaaaaaaaaaaaa'): void {
    this.push({
      seq,
      observed_ms: now,
      event_ms: null,
      t: 'hello',
      server: { name: 'flux-atlas', version: '0', api_version: 1, started_ms: startedMs, instance },
      tip: null,
      now_ms: now,
    });
  }
  serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  subs(): Record<string, unknown>[] {
    return this.sent.filter((m) => m.t === 'sub');
  }
}

class FakeEnv implements LiveEnvironment {
  online = true;
  visible = true;
  private onl = new Set<(v: boolean) => void>();
  private vis = new Set<(v: boolean) => void>();
  isOnline = () => this.online;
  isVisible = () => this.visible;
  onOnlineChange = (fn: (v: boolean) => void) => {
    this.onl.add(fn);
    return () => this.onl.delete(fn);
  };
  onVisibilityChange = (fn: (v: boolean) => void) => {
    this.vis.add(fn);
    return () => this.vis.delete(fn);
  };
  setOnline(v: boolean) {
    this.online = v;
    for (const f of this.onl) f(v);
  }
  setVisible(v: boolean) {
    this.visible = v;
    for (const f of this.vis) f(v);
  }
}

const data = (seq: number, t = 'feed', extra: Record<string, unknown> = {}) => ({
  seq,
  observed_ms: Date.now(),
  event_ms: null,
  t,
  kind: 'node_joined',
  ts_ms: 0,
  text_key: 'feed.node_joined',
  refs: [],
  params: {},
  ...extra,
});

function setup(over: Partial<LiveClientOptions> = {}) {
  const env = new FakeEnv();
  let resumeSeq: number | null = 10;
  const received: LiveMsg[] = [];
  const resync = vi.fn(async (_reason: string) => {
    resumeSeq = 50;
    return 50;
  });
  const client = new LiveClient({
    url: 'ws://test/ws',
    createSocket: (url) => new FakeSocket(url),
    env,
    random: () => 0.5,
    backoff: { baseMs: 1_000, maxMs: 30_000 },
    resync,
    getResumeSeq: () => resumeSeq,
    onMessage: (m) => {
      received.push(m);
      resumeSeq = Math.max(resumeSeq ?? 0, m.seq);
    },
    ...over,
  });
  const sock = () => FakeSocket.all[FakeSocket.all.length - 1]!;
  return { env, client, received, resync, sock, setResume: (s: number | null) => (resumeSeq = s) };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('LiveClient', () => {
  it('fetches a snapshot first when none is loaded, then subscribes from its seq', async () => {
    const t = setup();
    t.setResume(null);
    t.client.start();
    expect(t.client.status.status).toBe('syncing');
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(1));
    expect(t.resync).toHaveBeenCalledWith('initial', expect.any(AbortSignal));
    t.sock().open();
    t.sock().hello(50);
    expect(t.sock().subs()).toEqual([
      { t: 'sub', topics: [...ALL_TOPICS], since_seq: 50, watch: null, watch_apps: null },
    ]);
    expect(t.client.status.status).toBe('live');
  });

  it('replays, drops duplicates, and goes live once caught up to hello.seq', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(13);
    expect(t.client.status.status).toBe('syncing');
    t.sock().push(data(11));
    t.sock().push(data(12));
    t.sock().push(data(12));
    t.sock().push(data(11));
    expect(t.client.status.status).toBe('syncing');
    t.sock().push(data(13));
    expect(t.client.status.status).toBe('live');
    expect(t.received.map((m) => m.seq)).toEqual([11, 12, 13]);
    const m = t.client.metrics();
    expect(m.duplicates).toBe(2);
    expect(m.byType.feed).toBe(5);
  });

  it('counts a soft gap and still delivers', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    t.sock().push(data(11));
    t.sock().push(data(14));
    expect(t.received.length).toBe(2);
    expect(t.client.metrics().softGaps).toBe(1);
  });

  it('answers pings with pong and estimates the clock offset', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(10, Date.now() + 2_000);
    t.sock().push({ seq: 11, observed_ms: 0, event_ms: null, t: 'ping', now_ms: Date.now() + 2_500 });
    expect(t.sock().sent.at(-1)).toEqual({ t: 'pong', now_ms: Date.now() });
    expect(t.client.clockOffsetMs).toBe(2_500);
    expect(t.received.length).toBe(0);
  });

  it('measures transit and ingest latency after catching up', () => {
    const t = setup();
    const lat = vi.fn();
    const c = new LiveClient({
      url: 'ws://x',
      createSocket: (u) => new FakeSocket(u),
      env: new FakeEnv(),
      resync: async () => 10,
      getResumeSeq: () => 10,
      onMessage: () => {},
      onLatency: lat,
    });
    c.start();
    t.sock().open();
    // Server clock 1 s ahead of ours.
    t.sock().hello(10, Date.now() + 1_000);
    vi.advanceTimersByTime(1_000);
    const now = Date.now();
    t.sock().push(data(11, 'block', { observed_ms: now + 1_000 - 40, event_ms: now + 1_000 - 900 }));
    const m = c.metrics();
    expect(m.clockOffsetMs).toBe(1_000);
    expect(m.transitMs.last).toBe(40);
    expect(m.ingestMs.last).toBe(860);
    expect(lat).toHaveBeenCalledWith({ transitMs: 40, ingestMs: 860, clockOffsetMs: 1_000 });
  });

  it('reconnects with jittered exponential backoff and resumes with since_seq', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    t.sock().push(data(11));
    t.sock().serverClose(1006);
    expect(t.client.status.status).toBe('reconnecting');
    // attempt 1: d = 1000, equal jitter with random 0.5 -> 750 ms.
    expect(t.client.status.retryAtMs).toBe(Date.now() + 750);
    vi.advanceTimersByTime(749);
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(2);
    // The connection fails again: attempt 2 doubles.
    t.sock().serverClose(1006);
    expect(t.client.status.attempt).toBe(2);
    expect(t.client.status.retryAtMs).toBe(Date.now() + 1_500);
    vi.advanceTimersByTime(1_500);
    t.sock().open();
    t.sock().hello(15);
    expect(t.sock().subs()[0]!.since_seq).toBe(11);
  });

  it('maps close codes to retry policies', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    t.sock().serverClose(CloseCode.Policy, 'malformed messages');
    expect(t.client.status.retryAtMs).toBe(Date.now() + 22_500);
    expect(t.client.status.lastCloseCode).toBe(1008);
    t.client.reconnectNow();
    t.sock().open();
    t.sock().hello(10);
    t.sock().serverClose(CloseCode.GoingAway, 'server shutting down');
    expect(t.client.status.retryAtMs! - Date.now()).toBeGreaterThanOrEqual(750);
    t.client.reconnectNow();
    t.sock().open();
    t.sock().hello(10);
    t.sock().serverClose(CloseCode.SlowConsumer, 'slow consumer');
    expect(t.client.status.status).toBe('reconnecting');
    t.client.reconnectNow();
    t.sock().open();
    t.sock().hello(10);
    t.sock().serverClose(CloseCode.Idle, 'idle timeout');
    expect(t.client.status.status).toBe('reconnecting');
  });

  it('refetches the snapshot on resync and reconnects from the new seq on a fresh socket', async () => {
    const t = setup();
    t.client.start();
    const first = t.sock();
    first.open();
    first.hello(10);
    first.push({ seq: 99, observed_ms: 0, event_ms: null, t: 'resync', reason: 'replay_gap' });
    expect(first.closed?.code).toBe(1000);
    expect(t.resync).toHaveBeenCalledWith('replay_gap', expect.any(AbortSignal));
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(2));
    t.sock().open();
    t.sock().hello(50);
    expect(t.sock().subs()[0]!.since_seq).toBe(50);
    expect(t.client.metrics().resyncs).toBe(1);
  });

  it('resyncs when hello shows the server restarted since the snapshot', async () => {
    const t = setup({ getSnapshotOrigin: () => ({ instance: 'aaaaaaaaaaaaaaaa', started_ms: 1 }) });
    t.client.start();
    t.sock().open();
    t.sock().hello(3, Date.now(), 2);
    expect(t.sock().subs()).toEqual([]);
    expect(t.resync).toHaveBeenCalledWith('server_restarted', expect.any(AbortSignal));
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(2));
  });

  it('resyncs when hello comes from another instance with the same start time', async () => {
    const t = setup({ getSnapshotOrigin: () => ({ instance: 'aaaaaaaaaaaaaaaa', started_ms: 1 }) });
    t.client.start();
    t.sock().open();
    t.sock().hello(3, Date.now(), 1, 'bbbbbbbbbbbbbbbb');
    expect(t.sock().subs()).toEqual([]);
    expect(t.resync).toHaveBeenCalledWith('other_instance', expect.any(AbortSignal));
    await vi.waitFor(() => expect(FakeSocket.all.length).toBe(2));
  });

  it('subscribes when hello comes from the snapshot origin', () => {
    const t = setup({ getSnapshotOrigin: () => ({ instance: 'aaaaaaaaaaaaaaaa', started_ms: 1 }) });
    t.client.start();
    t.sock().open();
    t.sock().hello(3, Date.now(), 1, 'aaaaaaaaaaaaaaaa');
    expect(t.sock().subs().length).toBe(1);
  });

  it('backs off instead of looping when resyncs repeat', async () => {
    const t = setup();
    t.client.start();
    for (let k = 0; k < 4; k++) {
      t.sock().open();
      t.sock().hello(10);
      t.sock().push({ seq: 99, observed_ms: 0, event_ms: null, t: 'resync', reason: 'replay_gap' });
      await vi.waitFor(() => expect(t.resync).toHaveBeenCalledTimes(k + 1));
      await Promise.resolve();
      if (k < 3) await vi.waitFor(() => expect(FakeSocket.all.length).toBe(k + 2));
    }
    await vi.waitFor(() => expect(t.client.status.status).toBe('reconnecting'));
    expect(FakeSocket.all.length).toBe(4);
  });

  it('replaces a silent socket (watchdog)', () => {
    const t = setup({ staleAfterMs: 5_000 });
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    vi.advanceTimersByTime(4_000);
    t.sock().push(data(11));
    vi.advanceTimersByTime(4_000);
    expect(t.client.status.status).toBe('live');
    vi.advanceTimersByTime(1_001);
    expect(t.client.status.status).toBe('reconnecting');
    expect(t.client.status.lastCloseCode).toBe(CloseCode.ClientStale);
    expect(FakeSocket.all[0]!.closed?.code).toBe(CloseCode.ClientStale);
  });

  it('pauses while offline and reconnects immediately when back online', () => {
    const t = setup();
    t.env.online = false;
    t.client.start();
    expect(t.client.status.status).toBe('offline');
    expect(FakeSocket.all.length).toBe(0);
    t.env.setOnline(true);
    expect(FakeSocket.all.length).toBe(1);
    t.sock().open();
    t.sock().hello(10);
    t.env.setOnline(false);
    expect(t.client.status.status).toBe('offline');
    expect(FakeSocket.all[0]!.closed).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(1);
  });

  it('skips the backoff wait when the tab becomes visible', () => {
    const t = setup({ backoff: { baseMs: 20_000, maxMs: 60_000 } });
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    t.sock().serverClose(1006);
    expect(t.client.status.status).toBe('reconnecting');
    t.env.setVisible(false);
    t.env.setVisible(true);
    expect(FakeSocket.all.length).toBe(2);
  });

  it('requires a stable period before reading live again after a reconnect', () => {
    const t = setup({ stableAfterMs: 2_000 });
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    expect(t.client.status.status).toBe('live');
    t.sock().serverClose(1006);
    vi.advanceTimersByTime(750);
    t.sock().open();
    t.sock().hello(10);
    expect(t.client.status.status).toBe('syncing');
    vi.advanceTimersByTime(1_999);
    expect(t.client.status.status).toBe('syncing');
    vi.advanceTimersByTime(1);
    expect(t.client.status.status).toBe('live');
    expect(t.client.status.attempt).toBe(0);
  });

  it('re-subscribes on the open socket when the watch lists change', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().hello(10);
    t.sock().push(data(11));
    t.client.setWatch([7, 3, 7]);
    t.client.setWatchApps(['KadenaNode']);
    t.client.setWatch([3, 7]);
    const subs = t.sock().subs();
    expect(subs.length).toBe(3);
    expect(subs[1]).toEqual({
      t: 'sub',
      topics: [...ALL_TOPICS],
      since_seq: 11,
      watch: [3, 7],
      watch_apps: null,
    });
    expect(subs[2]!.watch_apps).toEqual(['kadenanode']);
  });

  it('counts malformed frames and stops cleanly', () => {
    const t = setup();
    t.client.start();
    t.sock().open();
    t.sock().onmessage?.({ data: 'not json' });
    t.sock().onmessage?.({ data: '{"no":"type"}' });
    expect(t.client.metrics().malformed).toBe(2);
    t.client.stop();
    expect(t.client.status.status).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

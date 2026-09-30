// Live client for the WebSocket `/ws` (ARCHITECTURE section 8; schema in crates/atlas-core/src/live.rs;
// server behavior in crates/atlas-server/src/live/).
//
// Lifecycle:
//   snapshot (bootstrap + nodes.bin, via `resync`) -> connect -> `hello` -> `sub` with topics,
//   `since_seq` (the store's resume point), `watch`, `watch_apps` -> the server replays anything
//   after `since_seq` from its ring, then streams live -> `live`.
//
// Continuity: every message carries a global `seq`. Messages at or below the last seen seq are
// duplicates (dropped). A jump with all topics subscribed is counted as a soft gap only, because the
// server does not replay keepalive pings; hard gaps are detected per topic by the store from
// `nodes.prev_seq` / `apps.prev_seq`, which call `requestResync`.
//
// Resync (server `resync`, a store gap, or a server restart seen in `hello`): the socket is closed,
// a fresh snapshot is fetched, and a new socket subscribes from the snapshot's seq. A fresh socket
// avoids mixing frames of the old subscription with the new replay.
//
// Reconnect: jittered exponential backoff, resuming with `since_seq`. Close codes: 1001 server
// shutdown (retry after at least 1 s), 4000 idle (retry at base), 4008 slow consumer (retry, the
// replay catches up), 1008 policy (a client bug: back off to the maximum). Offline pauses; online
// and becoming visible retry immediately. A watchdog replaces a socket that went silent (the server
// pings every 20 s).
//
// Latency: ingest = `observed_ms - event_ms` (upstream to server); transit = receipt (in server
// time) minus `observed_ms` (server to browser). The clock offset is the maximum over recent
// samples of `server_time - receipt` from `hello.now_ms`, pings and `observed_ms` (each sample is a
// lower bound of the true offset, so the maximum is the best estimate).

import { realScheduler, type Scheduler, type TimerHandle } from '../lib/scheduler';
import type { ConnectionStatus } from '../store/network';
import type { LiveMsg } from './generated/LiveMsg';
import type { ServerInfo } from './generated/ServerInfo';
import type { Topic } from './generated/Topic';

export const ALL_TOPICS: readonly Topic[] = ['chain', 'mempool', 'nodes', 'apps', 'mesh', 'stats', 'feed'];

export const CloseCode = {
  Normal: 1000,
  GoingAway: 1001,
  Policy: 1008,
  Idle: 4000,
  SlowConsumer: 4008,
  /** Client-side: the watchdog replaced a silent socket. */
  ClientStale: 4001,
} as const;

/** The subset of the browser WebSocket the client uses (tests pass a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface LiveEnvironment {
  isOnline(): boolean;
  isVisible(): boolean;
  onOnlineChange(fn: (online: boolean) => void): () => void;
  onVisibilityChange(fn: (visible: boolean) => void): () => void;
}

/** Browser environment (safe to construct where `window` is absent). */
export function browserEnvironment(): LiveEnvironment {
  const w = typeof window === 'undefined' ? null : window;
  const d = typeof document === 'undefined' ? null : document;
  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isVisible: () => (d ? d.visibilityState !== 'hidden' : true),
    onOnlineChange: (fn) => {
      if (!w) return () => {};
      const on = () => fn(true);
      const off = () => fn(false);
      w.addEventListener('online', on);
      w.addEventListener('offline', off);
      return () => {
        w.removeEventListener('online', on);
        w.removeEventListener('offline', off);
      };
    },
    onVisibilityChange: (fn) => {
      if (!d) return () => {};
      const h = () => fn(d.visibilityState !== 'hidden');
      d.addEventListener('visibilitychange', h);
      return () => d.removeEventListener('visibilitychange', h);
    },
  };
}

/** `ws(s)://<host>/ws` for the current page. */
export function defaultLiveUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_ATLAS_WS) return env.VITE_ATLAS_WS;
  if (typeof location === 'undefined') return 'ws://127.0.0.1:3000/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface LiveStatus {
  status: ConnectionStatus;
  attempt: number;
  retryAtMs: number | null;
  lastCloseCode: number | null;
  lastError: string | null;
  server: ServerInfo | null;
}

export interface LatencyStats {
  last: number | null;
  ema: number | null;
  p50: number | null;
  p95: number | null;
  samples: number;
}

export interface LiveMetrics {
  status: ConnectionStatus;
  connectedAtMs: number | null;
  helloSeq: number | null;
  lastSeq: number;
  messages: number;
  bytes: number;
  byType: Record<string, number>;
  /** Messages per second by type over the last 10 s. */
  ratePerSec: Record<string, number>;
  duplicates: number;
  softGaps: number;
  malformed: number;
  resyncs: number;
  reconnects: number;
  clockOffsetMs: number;
  transitMs: LatencyStats;
  ingestMs: LatencyStats;
}

export interface LiveClientOptions {
  url?: string | (() => string);
  topics?: readonly Topic[];
  createSocket?: WebSocketFactory;
  scheduler?: Scheduler;
  env?: LiveEnvironment;
  random?: () => number;
  backoff?: { baseMs?: number; maxMs?: number; factor?: number };
  /** No frame for this long and the socket is presumed dead. */
  staleAfterMs?: number;
  /** A reconnected stream must stay healthy this long before it reads `live` (no flapping). */
  stableAfterMs?: number;
  /** Without a replay frame reaching `hello.seq`, the stream counts as caught up after this quiet time. */
  catchUpQuietMs?: number;
  connectTimeoutMs?: number;
  /** Fetches and loads a fresh snapshot; resolves with the seq to resume from. */
  resync: (reason: string, signal: AbortSignal) => Promise<number>;
  /** The store's resume seq, or null before any snapshot is loaded. */
  getResumeSeq: () => number | null;
  /** `server.started_ms` of the loaded snapshot; a different one in `hello` forces a resync. */
  getSnapshotServerStart?: () => number | null;
  /** Every data message, in order, after dedupe (not hello, ping or resync). */
  onMessage: (msg: LiveMsg, receivedMs: number) => void;
  onStatus?: (s: LiveStatus) => void;
  /** Latency and clock offset, at most once per second. */
  onLatency?: (l: { transitMs: number | null; ingestMs: number | null; clockOffsetMs: number }) => void;
}

const WS_OPEN = 1;
const SAMPLE_CAP = 256;
const OFFSET_WINDOW = 64;
const RESYNC_LOOP_WINDOW_MS = 60_000;
const RESYNC_LOOP_MAX = 3;

class Latency {
  private buf: number[] = [];
  last: number | null = null;
  ema: number | null = null;
  count = 0;

  add(v: number): void {
    this.last = v;
    this.ema = this.ema === null ? v : this.ema + 0.1 * (v - this.ema);
    this.buf.push(v);
    if (this.buf.length > SAMPLE_CAP) this.buf.shift();
    this.count++;
  }

  stats(): LatencyStats {
    if (this.buf.length === 0) return { last: null, ema: null, p50: null, p95: null, samples: 0 };
    const s = [...this.buf].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? null;
    return { last: this.last, ema: this.ema, p50: q(0.5), p95: q(0.95), samples: this.count };
  }
}

export class LiveClient {
  private readonly o: Required<
    Pick<LiveClientOptions, 'staleAfterMs' | 'stableAfterMs' | 'catchUpQuietMs' | 'connectTimeoutMs'>
  > &
    LiveClientOptions;
  private readonly sched: Scheduler;
  private readonly env: LiveEnvironment;
  private readonly random: () => number;
  private readonly createSocket: WebSocketFactory;
  private topics: readonly Topic[];
  private watch: number[] = [];
  private watchApps: string[] = [];

  private ws: WebSocketLike | null = null;
  private gen = 0;
  private running = false;
  private resyncing = false;
  private resyncAbort: AbortController | null = null;
  private resyncTimes: number[] = [];
  private everLive = false;
  private caughtUp = false;
  private subscribed = false;
  private helloSeq: number | null = null;
  private lastSeq = 0;
  private connectedAtMs: number | null = null;

  private reconnectTimer: TimerHandle | undefined;
  private watchdogTimer: TimerHandle | undefined;
  private stableTimer: TimerHandle | undefined;
  private catchUpTimer: TimerHandle | undefined;
  private connectTimer: TimerHandle | undefined;
  private unlisten: (() => void)[] = [];

  private st: LiveStatus = {
    status: 'idle',
    attempt: 0,
    retryAtMs: null,
    lastCloseCode: null,
    lastError: null,
    server: null,
  };
  private readonly transit = new Latency();
  private readonly ingest = new Latency();
  private offsetSamples: number[] = [];
  private offset = 0;
  private lastLatencyEmit = 0;
  private readonly counters = {
    messages: 0,
    bytes: 0,
    duplicates: 0,
    softGaps: 0,
    malformed: 0,
    resyncs: 0,
    reconnects: 0,
  };
  private readonly byType: Record<string, number> = {};
  /** Per-second buckets for the rate window: [secondIndex, counts by type]. */
  private rateBuckets: { sec: number; counts: Record<string, number> }[] = [];
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();

  constructor(opts: LiveClientOptions) {
    this.o = {
      staleAfterMs: 50_000,
      stableAfterMs: 2_000,
      catchUpQuietMs: 400,
      connectTimeoutMs: 10_000,
      ...opts,
    };
    this.sched = opts.scheduler ?? realScheduler;
    this.env = opts.env ?? browserEnvironment();
    this.random = opts.random ?? Math.random;
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.topics = opts.topics ?? ALL_TOPICS;
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  get status(): LiveStatus {
    return this.st;
  }

  /** Server clock minus local clock (ms). */
  get clockOffsetMs(): number {
    return this.offset;
  }

  /** Server-corrected now. */
  serverNow(): number {
    return this.sched.now() + this.offset;
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unlisten.push(
      this.env.onOnlineChange((online) => this.handleOnline(online)),
      this.env.onVisibilityChange((visible) => this.handleVisible(visible)),
    );
    if (!this.env.isOnline()) {
      this.setStatus({ status: 'offline', retryAtMs: null });
      return;
    }
    this.connect();
  }

  stop(): void {
    this.running = false;
    for (const u of this.unlisten.splice(0)) u();
    this.clearTimers();
    this.resyncAbort?.abort();
    this.dropSocket(CloseCode.Normal, 'client stopped');
    this.setStatus({ status: 'closed', retryAtMs: null });
  }

  /** Nodes the user is looking at (WatchProbe enrollment; their events are never coalesced). */
  setWatch(nodes: readonly number[]): void {
    const next = [...new Set(nodes)].sort((a, b) => a - b);
    if (next.join(',') === this.watch.join(',')) return;
    this.watch = next;
    this.resubscribe();
  }

  /** Apps the user is looking at (hot-app instance polling). */
  setWatchApps(apps: readonly string[]): void {
    const next = [...new Set(apps.map((a) => a.toLowerCase()))].sort();
    if (next.join(',') === this.watchApps.join(',')) return;
    this.watchApps = next;
    this.resubscribe();
  }

  setTopics(topics: readonly Topic[]): void {
    this.topics = [...new Set(topics)];
    this.resubscribe();
  }

  /** Forces a snapshot refetch (the store calls this on a `prev_seq` gap). */
  requestResync(reason: string): void {
    void this.runResync(reason);
  }

  /** Skips the backoff wait and connects now. */
  reconnectNow(): void {
    if (!this.running || this.resyncing) return;
    if (this.st.status === 'reconnecting' || this.st.status === 'offline') {
      this.sched.clearTimeout(this.reconnectTimer);
      this.connect();
    }
  }

  metrics(): LiveMetrics {
    const nowSec = Math.floor(this.sched.now() / 1000);
    const rate: Record<string, number> = {};
    const window = this.rateBuckets.filter((b) => b.sec > nowSec - 10);
    for (const b of window) for (const [t, n] of Object.entries(b.counts)) rate[t] = (rate[t] ?? 0) + n / 10;
    return {
      status: this.st.status,
      connectedAtMs: this.connectedAtMs,
      helloSeq: this.helloSeq,
      lastSeq: this.lastSeq,
      ...this.counters,
      byType: { ...this.byType },
      ratePerSec: rate,
      clockOffsetMs: this.offset,
      transitMs: this.transit.stats(),
      ingestMs: this.ingest.stats(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------------------------

  private url(): string {
    const u = this.o.url ?? defaultLiveUrl;
    return typeof u === 'function' ? u() : u;
  }

  private connect(): void {
    if (!this.running || this.resyncing) return;
    this.sched.clearTimeout(this.reconnectTimer);
    if (this.o.getResumeSeq() === null) {
      void this.runResync('initial');
      return;
    }
    this.dropSocket(CloseCode.Normal, 'replaced');
    const gen = ++this.gen;
    this.caughtUp = false;
    this.subscribed = false;
    this.helloSeq = null;
    this.setStatus({ status: 'connecting', retryAtMs: null });
    let ws: WebSocketLike;
    try {
      ws = this.createSocket(this.url());
    } catch (e) {
      this.setStatus({ lastError: e instanceof Error ? e.message : String(e) });
      this.scheduleReconnect(null);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.gen) return;
      this.sched.clearTimeout(this.connectTimer);
      this.connectedAtMs = this.sched.now();
      this.armWatchdog();
    };
    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      this.onFrame(ev.data);
    };
    ws.onerror = () => {
      if (gen !== this.gen) return;
      this.setStatus({ lastError: 'socket error' });
    };
    ws.onclose = (ev) => {
      if (gen !== this.gen) return;
      this.onClosed(ev.code, ev.reason);
    };
    this.connectTimer = this.sched.setTimeout(() => {
      if (gen !== this.gen) return;
      this.setStatus({ lastError: 'connect timeout' });
      this.dropSocket(CloseCode.Normal, 'connect timeout');
      this.scheduleReconnect(null);
    }, this.o.connectTimeoutMs);
  }

  /** Detaches and closes the current socket without triggering reconnect logic. */
  private dropSocket(code: number, reason: string): void {
    const ws = this.ws;
    this.ws = null;
    this.gen++;
    this.subscribed = false;
    this.sched.clearTimeout(this.watchdogTimer);
    this.sched.clearTimeout(this.stableTimer);
    this.sched.clearTimeout(this.catchUpTimer);
    this.sched.clearTimeout(this.connectTimer);
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private onClosed(code: number, reason: string): void {
    this.ws = null;
    this.gen++;
    this.subscribed = false;
    this.sched.clearTimeout(this.watchdogTimer);
    this.sched.clearTimeout(this.stableTimer);
    this.sched.clearTimeout(this.catchUpTimer);
    this.sched.clearTimeout(this.connectTimer);
    this.setStatus({ lastCloseCode: code, lastError: reason || this.st.lastError });
    if (!this.running) {
      this.setStatus({ status: 'closed' });
      return;
    }
    if (!this.env.isOnline()) {
      this.setStatus({ status: 'offline', retryAtMs: null });
      return;
    }
    this.scheduleReconnect(code);
  }

  /** Backoff delay for the next attempt, before jitter. */
  private backoffMs(attempt: number, code: number | null): number {
    const base = this.o.backoff?.baseMs ?? 500;
    const max = this.o.backoff?.maxMs ?? 30_000;
    const factor = this.o.backoff?.factor ?? 2;
    if (code === CloseCode.Policy) return max;
    let d = Math.min(max, base * factor ** Math.max(0, attempt - 1));
    if (code === CloseCode.GoingAway) d = Math.max(d, 1_000);
    if (code === CloseCode.SlowConsumer) d = Math.max(d, 1_000);
    return d;
  }

  private scheduleReconnect(code: number | null): void {
    if (!this.running) return;
    this.sched.clearTimeout(this.reconnectTimer);
    const attempt = this.st.attempt + 1;
    const d = this.backoffMs(attempt, code);
    // Equal jitter: half fixed, half random, so a fleet of clients spreads out after a restart.
    const delay = Math.round(d / 2 + (d / 2) * this.random());
    this.counters.reconnects++;
    this.setStatus({ status: 'reconnecting', attempt, retryAtMs: this.sched.now() + delay });
    this.reconnectTimer = this.sched.setTimeout(() => this.connect(), delay);
  }

  private handleOnline(online: boolean): void {
    if (!this.running) return;
    if (!online) {
      this.clearTimers();
      this.dropSocket(CloseCode.Normal, 'offline');
      this.setStatus({ status: 'offline', retryAtMs: null });
    } else if (this.st.status === 'offline' || this.st.status === 'reconnecting') {
      this.setStatus({ attempt: 0 });
      this.connect();
    }
  }

  private handleVisible(visible: boolean): void {
    if (!this.running || !visible) return;
    // Timers are throttled in background tabs: retry right away instead of waiting out a backoff.
    if (this.st.status === 'reconnecting') this.reconnectNow();
  }

  private armWatchdog(): void {
    this.sched.clearTimeout(this.watchdogTimer);
    const gen = this.gen;
    this.watchdogTimer = this.sched.setTimeout(() => {
      if (gen !== this.gen) return;
      this.setStatus({ lastError: 'no data from server', lastCloseCode: CloseCode.ClientStale });
      this.dropSocket(CloseCode.ClientStale, 'stale');
      this.scheduleReconnect(CloseCode.ClientStale);
    }, this.o.staleAfterMs);
  }

  private clearTimers(): void {
    for (const t of [
      this.reconnectTimer,
      this.watchdogTimer,
      this.stableTimer,
      this.catchUpTimer,
      this.connectTimer,
    ]) {
      this.sched.clearTimeout(t);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Subscription and resync
  // -------------------------------------------------------------------------------------------

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WS_OPEN) this.ws.send(JSON.stringify(obj));
  }

  private sendSub(sinceSeq: number | null): void {
    this.send({
      t: 'sub',
      topics: this.topics,
      since_seq: sinceSeq,
      watch: this.watch.length ? this.watch : null,
      watch_apps: this.watchApps.length ? this.watchApps : null,
    });
    this.subscribed = true;
  }

  /** Re-sends `sub` on the open socket (watch lists changed). Replays since the last seen seq. */
  private resubscribe(): void {
    if (this.subscribed && this.ws && this.ws.readyState === WS_OPEN) this.sendSub(this.lastSeq);
  }

  private async runResync(reason: string): Promise<void> {
    if (!this.running || this.resyncing) return;
    this.resyncing = true;
    if (reason !== 'initial') this.counters.resyncs++;
    this.clearTimers();
    this.dropSocket(CloseCode.Normal, 'resync');
    this.setStatus({ status: 'syncing', retryAtMs: null });
    const now = this.sched.now();
    this.resyncTimes = this.resyncTimes.filter((t) => now - t < RESYNC_LOOP_WINDOW_MS);
    this.resyncTimes.push(now);
    const looping = this.resyncTimes.length > RESYNC_LOOP_MAX;
    const ac = new AbortController();
    this.resyncAbort = ac;
    let ok = false;
    try {
      const seq = await this.o.resync(reason, ac.signal);
      this.lastSeq = seq;
      ok = true;
    } catch (e) {
      if (!ac.signal.aborted)
        this.setStatus({ lastError: `resync failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      this.resyncing = false;
      this.resyncAbort = null;
    }
    if (!this.running || ac.signal.aborted) return;
    if (!ok || looping) this.scheduleReconnect(null);
    else this.connect();
  }

  // -------------------------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------------------------

  private onFrame(data: unknown): void {
    const received = this.sched.now();
    this.armWatchdog();
    if (typeof data !== 'string') {
      this.counters.malformed++;
      return;
    }
    let msg: LiveMsg;
    try {
      msg = JSON.parse(data) as LiveMsg;
    } catch {
      this.counters.malformed++;
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string' || typeof msg.seq !== 'number') {
      this.counters.malformed++;
      return;
    }
    this.counters.messages++;
    this.counters.bytes += data.length;
    this.byType[msg.t] = (this.byType[msg.t] ?? 0) + 1;
    this.countRate(msg.t, received);

    switch (msg.t) {
      case 'hello':
        this.onHello(msg, received);
        return;
      case 'resync':
        void this.runResync(msg.reason);
        return;
      case 'ping':
        this.sampleOffset(msg.now_ms - received);
        this.send({ t: 'pong', now_ms: this.sched.now() });
        this.advanceSeq(msg.seq);
        return;
      default:
        break;
    }
    if (!this.advanceSeq(msg.seq)) return;
    this.sampleOffset(msg.observed_ms - received);
    if (this.caughtUp) {
      this.transit.add(Math.max(0, received + this.offset - msg.observed_ms));
      if (msg.event_ms !== null && msg.event_ms > 0) {
        const ing = msg.observed_ms - msg.event_ms;
        if (ing >= 0 && ing < 3_600_000) this.ingest.add(ing);
      }
      this.emitLatency(received);
    }
    this.o.onMessage(msg, received);
    if (!this.caughtUp && this.helloSeq !== null && msg.seq >= this.helloSeq) this.markCaughtUp();
    else if (!this.caughtUp) this.armCatchUp();
  }

  /** Dedupe and continuity. Returns false for duplicates. */
  private advanceSeq(seq: number): boolean {
    if (seq <= this.lastSeq) {
      this.counters.duplicates++;
      return false;
    }
    if (this.lastSeq > 0 && seq > this.lastSeq + 1 && this.topics.length === ALL_TOPICS.length)
      this.counters.softGaps++;
    this.lastSeq = seq;
    return true;
  }

  private onHello(msg: Extract<LiveMsg, { t: 'hello' }>, received: number): void {
    this.sampleOffset(msg.now_ms - received);
    this.helloSeq = msg.seq;
    this.setStatus({ server: msg.server });
    const snapStart = this.o.getSnapshotServerStart?.() ?? null;
    if (snapStart !== null && snapStart !== msg.server.started_ms) {
      // The server restarted since our snapshot: its seq space is new; our state cannot be patched.
      void this.runResync('server_restarted');
      return;
    }
    const since = this.o.getResumeSeq();
    this.lastSeq = since ?? 0;
    this.setStatus({ status: 'syncing' });
    this.sendSub(since);
    if (since !== null && since >= msg.seq) this.markCaughtUp();
    else this.armCatchUp();
  }

  private armCatchUp(): void {
    this.sched.clearTimeout(this.catchUpTimer);
    const gen = this.gen;
    this.catchUpTimer = this.sched.setTimeout(() => {
      if (gen === this.gen && !this.caughtUp) this.markCaughtUp();
    }, this.o.catchUpQuietMs);
  }

  private markCaughtUp(): void {
    this.caughtUp = true;
    this.sched.clearTimeout(this.catchUpTimer);
    const goLive = () => {
      this.everLive = true;
      this.setStatus({ status: 'live', attempt: 0, retryAtMs: null, lastError: null });
    };
    if (!this.everLive) {
      goLive();
      return;
    }
    // Returning to live needs a short stable period, so a flapping link does not blink.
    const openFor = this.connectedAtMs === null ? 0 : this.sched.now() - this.connectedAtMs;
    const wait = Math.max(0, this.o.stableAfterMs - openFor);
    if (wait === 0) {
      goLive();
      return;
    }
    const gen = this.gen;
    this.sched.clearTimeout(this.stableTimer);
    this.stableTimer = this.sched.setTimeout(() => {
      if (gen === this.gen) goLive();
    }, wait);
  }

  private sampleOffset(sample: number): void {
    if (!Number.isFinite(sample)) return;
    this.offsetSamples.push(sample);
    if (this.offsetSamples.length > OFFSET_WINDOW) this.offsetSamples.shift();
    this.offset = Math.max(...this.offsetSamples);
  }

  private emitLatency(now: number): void {
    if (!this.o.onLatency || now - this.lastLatencyEmit < 1_000) return;
    this.lastLatencyEmit = now;
    this.o.onLatency({ transitMs: this.transit.ema, ingestMs: this.ingest.ema, clockOffsetMs: this.offset });
  }

  private countRate(t: string, now: number): void {
    const sec = Math.floor(now / 1000);
    let b = this.rateBuckets[this.rateBuckets.length - 1];
    if (!b || b.sec !== sec) {
      b = { sec, counts: {} };
      this.rateBuckets.push(b);
      while (this.rateBuckets.length > 12) this.rateBuckets.shift();
    }
    b.counts[t] = (b.counts[t] ?? 0) + 1;
  }

  private setStatus(patch: Partial<LiveStatus>): void {
    const next = { ...this.st, ...patch };
    const changed = (Object.keys(patch) as (keyof LiveStatus)[]).some((k) => this.st[k] !== next[k]);
    this.st = next;
    if (!changed) return;
    this.o.onStatus?.(next);
    for (const fn of [...this.statusListeners]) fn(next);
  }
}

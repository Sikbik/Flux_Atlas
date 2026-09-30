// The shared event clock. One 1 Hz timer, aligned to whole seconds, drives every "N s ago" label,
// freshness chip and the next-block progress, so the tip, countdown, rail and aim strip never
// disagree (design section 4.1). Time is server time: local time corrected by the clock offset the
// live client estimates from `hello.now_ms` and pings.

import { BLOCK_MS } from './format';
import { realScheduler, type Scheduler, type TimerHandle } from './scheduler';

export type BeatPhase = 'waiting' | 'soon' | 'late' | 'quiet' | 'unknown';

export interface BeatState {
  /** Height of the last block, or null before the first one. */
  height: number | null;
  /** Milliseconds since the last block. */
  sinceMs: number;
  /** 0..1 across the expected interval (clamped). */
  progress: number;
  /** Milliseconds until the expected next block (0 once due). */
  remainingMs: number;
  /** Milliseconds past the expected interval (0 while on time). */
  lateMs: number;
  /**
   * `waiting` inside the interval, `soon` in the last 3 s (anticipation), `late` after 35 s,
   * `quiet` after 90 s (the UI tells "chain quiet" from "feed lost" with the connection state).
   */
  phase: BeatPhase;
}

export const BEAT_SOON_MS = 3_000;
export const BEAT_LATE_MS = 35_000;
export const BEAT_QUIET_MS = 90_000;

/** Pure beat computation from the anchor time of the last block. */
export function beatState(
  last: { height: number; anchorMs: number } | null,
  nowMs: number,
  intervalMs = BLOCK_MS,
): BeatState {
  if (!last)
    return { height: null, sinceMs: 0, progress: 0, remainingMs: intervalMs, lateMs: 0, phase: 'unknown' };
  const since = Math.max(0, nowMs - last.anchorMs);
  const remaining = Math.max(0, intervalMs - since);
  let phase: BeatPhase = 'waiting';
  if (since >= BEAT_QUIET_MS) phase = 'quiet';
  else if (since >= BEAT_LATE_MS) phase = 'late';
  else if (remaining <= BEAT_SOON_MS) phase = 'soon';
  return {
    height: last.height,
    sinceMs: since,
    progress: Math.min(1, since / intervalMs),
    remainingMs: remaining,
    lateMs: Math.max(0, since - intervalMs),
    phase,
  };
}

/**
 * Anchor time for the beat: the block's header time, unless it is implausible against when the
 * server observed it (clock skew in the header), in which case the observation time is used.
 */
export function blockAnchorMs(timeMs: number, observedMs: number | null | undefined): number {
  if (observedMs === null || observedMs === undefined) return timeMs;
  if (timeMs > observedMs + 5_000 || observedMs - timeMs > 60_000) return observedMs;
  return timeMs;
}

export type Freshness = 'fresh' | 'aging' | 'stale' | 'dead';

/** Freshness state for a source with the given cadence (design section 6.5). */
export function freshness(ageMs: number, cadenceMs: number): Freshness {
  if (ageMs < 1.5 * cadenceMs) return 'fresh';
  if (ageMs < 3 * cadenceMs) return 'aging';
  if (ageMs < 10 * cadenceMs) return 'stale';
  return 'dead';
}

type Listener = (nowMs: number) => void;

export class EventClock {
  private readonly sched: Scheduler;
  private offsetMs = 0;
  private listeners = new Set<Listener>();
  private timer: TimerHandle | undefined;
  private lastBlock: { height: number; anchorMs: number } | null = null;
  private tickNow = 0;
  readonly intervalMs: number;

  constructor(opts: { scheduler?: Scheduler; intervalMs?: number } = {}) {
    this.sched = opts.scheduler ?? realScheduler;
    this.intervalMs = opts.intervalMs ?? BLOCK_MS;
    this.tickNow = this.now();
  }

  /** Server-corrected unix ms. */
  now(): number {
    return this.sched.now() + this.offsetMs;
  }

  /** Offset to add to local time to get server time (from the live client). */
  setOffset(ms: number): void {
    this.offsetMs = Number.isFinite(ms) ? ms : 0;
  }

  get offset(): number {
    return this.offsetMs;
  }

  /** Time of the latest tick (stable between ticks; use for render snapshots). */
  get tickTime(): number {
    return this.tickNow;
  }

  /** Records the latest block for the beat (header time corrected by observation time). */
  setLastBlock(height: number, timeMs: number, observedMs?: number | null): void {
    if (this.lastBlock && height < this.lastBlock.height) return;
    this.lastBlock = { height, anchorMs: blockAnchorMs(timeMs, observedMs) };
  }

  get lastBlockInfo(): { height: number; anchorMs: number } | null {
    return this.lastBlock;
  }

  beat(nowMs = this.now()): BeatState {
    return beatState(this.lastBlock, nowMs, this.intervalMs);
  }

  /** Subscribes to the 1 Hz tick. The timer runs only while someone listens. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.schedule();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) {
        this.sched.clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private schedule(): void {
    const local = this.sched.now();
    const delay = 1000 - (local % 1000) || 1000;
    this.timer = this.sched.setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    this.tickNow = this.now();
    for (const fn of [...this.listeners]) fn(this.tickNow);
    if (this.listeners.size > 0) this.schedule();
  }
}

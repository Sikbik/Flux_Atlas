// The time machine's playhead and loader, with no React and no DOM: where in the recorded history the
// view is, whether it plays, and which recorded moment the globe shows.
//
// The loader keeps one request in flight and always chases the latest wanted instant: while a handle
// is dragged, requests are spaced at least 120 ms apart; whatever finishes is shown (so the picture
// follows the handle as fast as the network allows) and the next request goes for where the handle is
// by then. Finished moments are kept (16, by the second) so scrubbing over ground already covered
// costs nothing. The playhead itself is never held back by the network: it moves at the chosen speed
// and the picture catches up.

import type { NodesBin } from '../../../api/nodesBin';
import type { NodeTable } from '../../../store/nodeTable';
import { type ArchiveInfo, summarize } from './summary';
import { clampTime, KEY_STEP, SECOND } from './time';

export type Mode = 'live' | 'archive';

export interface TmState {
  /** `live`: the handle rests at now and the globe shows the present. `archive`: a recorded moment. */
  mode: Mode;
  playing: boolean;
  /** Recorded seconds per real second. */
  speed: number;
  /** A recorded moment is being fetched. */
  loading: boolean;
  /** Why the last fetch failed; cleared by the next success. */
  error: string | null;
  /** What the globe shows right now (null while live, or before the first moment arrives). */
  info: ArchiveInfo | null;
  /** The handle is flying back to now. */
  flying: boolean;
  /** The pointer is dragging the handle. */
  dragging: boolean;
}

export interface TmEnv {
  /** Server time, unix ms. */
  now(): number;
  /** One recorded moment, decoded. Must reject when `signal` aborts. */
  fetchState(t: number, signal: AbortSignal): Promise<NodesBin>;
  /** Shows a node table on the globe; null brings the present back. */
  apply(table: NodeTable | null): void;
  /** The globe's node table for a decoded moment. */
  buildTable(bin: NodesBin): NodeTable;
  /** One animation frame; returns its cancel function. */
  frame(cb: (ts: number) => void): () => void;
  /** A one-shot timer; returns its cancel function. */
  timer(cb: () => void, ms: number): () => void;
}

/** What the URL should say after a settled change. */
export interface Commit {
  /** The playhead in unix ms, or null at live. */
  t: number | null;
  speed: number;
}

/** Spacing of requests while the handle is dragged, and while it plays. */
export const GAP_DRAG_MS = 120;
export const GAP_PLAY_MS = 400;
/** Moments kept; a state is about 435 KB of typed arrays. */
export const CACHE_SIZE = 16;
/** Within this of now the playhead reads as live. */
export const LIVE_SNAP_MS = 30 * SECOND;
/** The "Return to live" flight. */
export const FLIGHT_MS = 680;
/** The server's resolution for a moment: requests are rounded to the second. */
const RES_MS = SECOND;
/** The longest step one animation frame advances the playhead, so a throttled tab does not leap. */
const MAX_FRAME_MS = 100;
/** How often a playing playhead is committed (to the URL). */
const COMMIT_EVERY_MS = 2000;

interface Loaded {
  key: number;
  table: NodeTable;
  info: ArchiveInfo;
}

const INITIAL: TmState = {
  mode: 'live',
  playing: false,
  speed: 60,
  loading: false,
  error: null,
  info: null,
  flying: false,
  dragging: false,
};

const keyOf = (t: number): number => Math.round(t / RES_MS);

function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'The recording could not be loaded.';
}

export class TimeMachine {
  private state: TmState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly tListeners = new Set<(t: number) => void>();
  private readonly commitListeners = new Set<(c: Commit) => void>();

  private start = 0;
  private end = 0;
  private t = 0;
  /** The instant the next fetch should go for; null when the picture is up to date. */
  private wanted: number | null = null;
  private shownKey: number | null = null;
  private readonly cache = new Map<number, Loaded>();
  private inflight: { ac: AbortController; seq: number } | null = null;
  private seq = 0;
  /** The key of the latest wish, so a slow answer to an older one is not shown over a newer picture. */
  private lastWishKey: number | null = null;
  private lastFetchAt = Number.NEGATIVE_INFINITY;
  private resumeAfterDrag = false;
  private attached = false;
  private showing = false;

  private cancelFrame: (() => void) | null = null;
  private cancelPump: (() => void) | null = null;
  private cancelFlight: (() => void) | null = null;
  private lastFrameTs: number | null = null;
  private lastCommitAt = 0;

  constructor(private readonly env: TmEnv) {}

  // ---- reading ----------------------------------------------------------------------------------

  getState = (): TmState => this.state;

  /** The playhead: the recorded instant in view, or now while live. */
  getT = (): number => (this.state.mode === 'live' ? this.end : this.t);

  getRange = (): { start: number; end: number } => ({ start: this.start, end: this.end });

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Called with the playhead on every move (a frame while playing, a pointer move while dragging). */
  subscribeT = (fn: (t: number) => void): (() => void) => {
    this.tListeners.add(fn);
    return () => {
      this.tListeners.delete(fn);
    };
  };

  /** Called when the playhead settles: the URL follows these, not every frame. */
  subscribeCommit = (fn: (c: Commit) => void): (() => void) => {
    this.commitListeners.add(fn);
    return () => {
      this.commitListeners.delete(fn);
    };
  };

  // ---- lifecycle --------------------------------------------------------------------------------

  /** Starts listening to the world. Safe to call again after `detach` (a remount). */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.state = { ...INITIAL, speed: this.state.speed };
    this.emit();
  }

  /** Stops everything and brings the present back to the globe. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.cancelFrame?.();
    this.cancelPump?.();
    this.cancelFlight?.();
    this.cancelFrame = this.cancelPump = this.cancelFlight = null;
    this.inflight?.ac.abort();
    this.inflight = null;
    this.wanted = null;
    this.lastWishKey = null;
    this.lastFrameTs = null;
    this.resumeAfterDrag = false;
    this.release();
    this.state = { ...INITIAL, speed: this.state.speed };
  }

  /** The recorded range: `start` is the first moment worth showing, `end` is now. */
  setRange(start: number, end: number): void {
    this.start = start;
    this.end = Math.max(end, start);
    if (this.state.mode === 'archive') this.t = clampTime(this.t, this.start, this.end);
  }

  // ---- moving the playhead ----------------------------------------------------------------------

  /** The handle is picked up: playback pauses while it is held. */
  beginDrag(): void {
    this.cancelFlightNow();
    this.resumeAfterDrag = this.state.playing;
    this.set({ dragging: true, playing: false });
    this.stopFrames();
  }

  /** The handle moves under the pointer: the playhead follows at once, the picture as it can. */
  scrub(t: number): void {
    if (t >= this.end - LIVE_SNAP_MS) {
      // The handle is within reach of now: the world is live, and stays so until the handle leaves.
      if (this.state.mode === 'archive') this.toLive(false);
      this.emitT(this.end);
      return;
    }
    this.moveTo(t);
    this.want(this.t, GAP_DRAG_MS);
  }

  /** The handle is let go at `t`; a drop within reach of now means live. */
  endDrag(t: number): void {
    const resume = this.resumeAfterDrag;
    this.resumeAfterDrag = false;
    this.set({ dragging: false });
    if (t >= this.end - LIVE_SNAP_MS) {
      this.goLive();
      return;
    }
    this.settle(t);
    if (resume) this.play();
  }

  /** Jumps to `t` and loads it now (a key press, a click on the curve, the URL). */
  settle(t: number): void {
    this.cancelFlightNow();
    if (t >= this.end - LIVE_SNAP_MS) {
      this.goLive();
      return;
    }
    this.moveTo(t);
    this.want(this.t, 0);
    this.commit();
  }

  /** Moves the playhead by `deltaMs` from where it is (from now, while live). */
  nudge(deltaMs: number): void {
    this.settle(this.getT() + deltaMs);
  }

  /** One key press: a minute, an hour or a day back or forward. */
  step(unit: keyof typeof KEY_STEP, direction: -1 | 1): void {
    this.nudge(direction * KEY_STEP[unit]);
  }

  // ---- playing ----------------------------------------------------------------------------------

  play(): void {
    if (!this.attached) return;
    this.cancelFlightNow();
    if (this.state.mode === 'live' || this.t >= this.end - LIVE_SNAP_MS) {
      // From the present there is nothing to play forward into: replay the history from its start.
      this.moveTo(this.start);
      this.want(this.t, 0);
    }
    this.set({ playing: true });
    this.lastFrameTs = null;
    this.lastCommitAt = this.env.now();
    this.scheduleFrame();
    this.commit();
  }

  pause(): void {
    if (!this.state.playing) return;
    this.stopFrames();
    this.set({ playing: false });
    this.commit();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    if (speed === this.state.speed) return;
    this.set({ speed });
    this.commit();
  }

  // ---- leaving the archive ----------------------------------------------------------------------

  /**
   * Back to the present. The handle flies to now (its flight is drawn by the strip while `flying`),
   * and the globe gets the live nodes back at once.
   */
  goLive(opts: { fly?: boolean } = {}): void {
    const fly = opts.fly ?? this.state.mode === 'archive';
    this.resumeAfterDrag = false;
    this.set({ dragging: false });
    this.toLive(fly);
  }

  private toLive(fly: boolean): void {
    this.stopFrames();
    this.inflight?.ac.abort();
    this.inflight = null;
    this.wanted = null;
    this.cancelPump?.();
    this.cancelPump = null;
    this.release();
    this.cancelFlightNow();
    // `flying` goes up in the same breath as the mode, before the handle is told to move, so the strip
    // already knows to glide when it hears where it is going.
    this.set({ mode: 'live', playing: false, loading: false, error: null, info: null, flying: fly });
    if (fly) {
      this.cancelFlight = this.env.timer(() => {
        this.cancelFlight = null;
        this.set({ flying: false });
      }, FLIGHT_MS);
    }
    this.emitT(this.end);
    this.commit();
  }

  /** Tries the current wish again after a failure. */
  retry(): void {
    if (this.state.mode !== 'archive') return;
    this.want(this.t, 0);
  }

  // ---- internals --------------------------------------------------------------------------------

  private moveTo(t: number): void {
    const next = clampTime(t, this.start, this.end);
    this.t = next;
    if (this.state.mode !== 'archive') this.set({ mode: 'archive', error: null });
    this.emitT(next);
  }

  /** Brings the present back to the globe if an archived moment is showing. */
  private release(): void {
    if (!this.showing) return;
    this.showing = false;
    this.shownKey = null;
    this.env.apply(null);
  }

  private cancelFlightNow(): void {
    if (!this.cancelFlight) return;
    this.cancelFlight();
    this.cancelFlight = null;
    this.set({ flying: false });
  }

  private stopFrames(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.lastFrameTs = null;
  }

  private scheduleFrame(): void {
    this.cancelFrame = this.env.frame((ts) => this.onFrame(ts));
  }

  private onFrame(ts: number): void {
    this.cancelFrame = null;
    if (!this.attached || !this.state.playing) return;
    const dt = this.lastFrameTs === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, ts - this.lastFrameTs));
    this.lastFrameTs = ts;
    const next = this.t + dt * this.state.speed;
    if (next >= this.end - LIVE_SNAP_MS) {
      // Reached the present: the replay is over and the world is live again.
      this.goLive({ fly: false });
      return;
    }
    this.t = next;
    this.emitT(next);
    this.want(next, GAP_PLAY_MS);
    const now = this.env.now();
    if (now - this.lastCommitAt >= COMMIT_EVERY_MS) {
      this.lastCommitAt = now;
      this.commit();
    }
    this.scheduleFrame();
  }

  /**
   * Asks for the moment at `t`. The picture follows once the request that is already out (if any)
   * finishes and `gapMs` has passed since the last one started.
   */
  private want(t: number, gapMs: number): void {
    this.wanted = t;
    this.lastWishKey = keyOf(t);
    this.pump(gapMs);
  }

  private pump(gapMs: number): void {
    if (!this.attached || this.wanted === null || this.state.mode !== 'archive') return;
    const key = keyOf(this.wanted);
    if (key === this.shownKey && !this.state.error) {
      this.wanted = null;
      return;
    }
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      this.wanted = null;
      this.show(hit);
      return;
    }
    if (this.inflight) return; // its completion pumps again
    const wait = this.lastFetchAt + gapMs - this.env.now();
    if (wait > 0) {
      if (!this.cancelPump) {
        this.cancelPump = this.env.timer(() => {
          this.cancelPump = null;
          this.pump(0);
        }, wait);
      }
      return;
    }
    this.fetch(key);
  }

  private fetch(key: number): void {
    const ac = new AbortController();
    const seq = ++this.seq;
    this.inflight = { ac, seq };
    this.lastFetchAt = this.env.now();
    this.set({ loading: true });
    const instant = key * RES_MS;
    this.env.fetchState(instant, ac.signal).then(
      (bin) => {
        if (this.inflight?.seq !== seq) return;
        this.inflight = null;
        const loaded: Loaded = { key, table: this.env.buildTable(bin), info: summarize(bin, instant) };
        this.remember(loaded);
        // A late answer is shown while the handle is still looking for something else (progress), or when it
        // is what the handle last asked for; never over a picture the handle has already moved past.
        if ((this.wanted !== null || key === this.lastWishKey) && this.state.mode === 'archive') {
          this.show(loaded);
        }
        this.set({ loading: false, error: null });
        // Chase wherever the handle is by now.
        if (this.wanted !== null) this.pump(this.state.playing ? GAP_PLAY_MS : GAP_DRAG_MS);
      },
      (e: unknown) => {
        if (this.inflight?.seq !== seq) return;
        this.inflight = null;
        if (ac.signal.aborted) return;
        this.set({ loading: false, error: messageOf(e) });
      },
    );
  }

  private remember(loaded: Loaded): void {
    this.cache.delete(loaded.key);
    this.cache.set(loaded.key, loaded);
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private show(loaded: Loaded): void {
    this.shownKey = loaded.key;
    this.showing = true;
    this.env.apply(loaded.table);
    this.set({ info: loaded.info, error: null });
  }

  /** Puts the table now on show on the globe again (the globe was rebuilt after a lost context). */
  reapply(): void {
    if (!this.attached || this.state.mode !== 'archive' || this.shownKey === null) return;
    const hit = this.cache.get(this.shownKey);
    if (hit) this.env.apply(hit.table);
  }

  private commit(): void {
    // The URL follows where the handle settles, not where it passes.
    if (this.state.dragging) return;
    const c: Commit = { t: this.state.mode === 'archive' ? this.t : null, speed: this.state.speed };
    for (const fn of [...this.commitListeners]) fn(c);
  }

  private set(patch: Partial<TmState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof TmState)[]) {
      if (!Object.is(this.state[k], patch[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private emitT(t: number): void {
    for (const fn of [...this.tListeners]) fn(t);
  }
}

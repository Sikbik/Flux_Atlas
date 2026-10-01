import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/http';
import { NodeSection, type NodesBin, statusCode, tierCode } from '../../../api/nodesBin';
import type { NodeTable } from '../../../store/nodeTable';
import {
  CACHE_SIZE,
  type Commit,
  FLIGHT_MS,
  GAP_DRAG_MS,
  GAP_PLAY_MS,
  LIVE_SNAP_MS,
  TimeMachine,
  type TmEnv,
} from './controller';
import { HOUR, MINUTE } from './time';

const START = 1_790_816_000_000;
const NOW = START + 3 * HOUR;

interface Pending {
  t: number;
  signal: AbortSignal;
  resolve(bin: NodesBin): void;
  reject(e: unknown): void;
}

/** A hand-driven world: requests wait until the test answers, frames and timers run when told to. */
class FakeEnv implements TmEnv {
  nowMs = NOW;
  onNoHistory?: (t: number) => void;
  fetches: Pending[] = [];
  applied: (TableStub | null)[] = [];
  private frames: ((ts: number) => void)[] = [];
  private timers: { cb: () => void; at: number; live: boolean }[] = [];

  now = () => this.nowMs;

  fetchState = (t: number, signal: AbortSignal): Promise<NodesBin> =>
    new Promise((resolve, reject) => {
      this.fetches.push({ t, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

  apply = (table: NodeTable | null) => {
    this.applied.push(table as unknown as TableStub | null);
  };

  buildTable = (bin: NodesBin) => ({ bin }) as unknown as NodeTable;

  frame = (cb: (ts: number) => void) => {
    this.frames.push(cb);
    return () => {
      this.frames = this.frames.filter((f) => f !== cb);
    };
  };

  timer = (cb: () => void, ms: number) => {
    const entry = { cb, at: this.nowMs + ms, live: true };
    this.timers.push(entry);
    return () => {
      entry.live = false;
    };
  };

  /** Moves the clock and fires the timers that fall due, in order. */
  advance(ms: number) {
    const target = this.nowMs + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.nowMs = Math.max(this.nowMs, due.at);
      due.cb();
    }
    this.nowMs = target;
  }

  /** Runs one animation frame at `ts`. */
  tick(ts: number) {
    const fs = this.frames;
    this.frames = [];
    for (const f of fs) f(ts);
  }

  get pendingFrames() {
    return this.frames.length;
  }

  get liveTimers() {
    return this.timers.filter((t) => t.live).length;
  }

  /** Answers the oldest unanswered request with a state of `n` confirmed nodes. */
  answer(n = 10, index = 0) {
    const p = this.fetches[index];
    if (!p) throw new Error('no such request');
    p.resolve(stateOf(n));
  }
}

interface TableStub {
  bin: NodesBin;
}

function stateOf(n: number): NodesBin {
  const confirmed = statusCode('confirmed');
  const cumulus = tierCode('cumulus');
  return {
    count: n,
    ids: new Uint32Array(n),
    status: new Uint8Array(n).fill(confirmed),
    tier: new Uint8Array(n).fill(cumulus),
    lat: new Float32Array(n).fill(1),
    lon: new Float32Array(n).fill(1),
    present: new Set([NodeSection.Status, NodeSection.Tier, NodeSection.Lat, NodeSection.Lon]),
  } as unknown as NodesBin;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function make() {
  const env = new FakeEnv();
  const tm = new TimeMachine(env);
  tm.attach();
  tm.setRange(START, NOW);
  const commits: Commit[] = [];
  tm.subscribeCommit((c) => commits.push(c));
  return { env, tm, commits };
}

describe('scrubbing', () => {
  it('starts live and enters the archive on the first move', () => {
    const { tm } = make();
    expect(tm.getState().mode).toBe('live');
    expect(tm.getT()).toBe(NOW);
    tm.beginDrag();
    tm.scrub(START + HOUR);
    expect(tm.getState().mode).toBe('archive');
    expect(tm.getState().dragging).toBe(true);
    expect(tm.getT()).toBe(START + HOUR);
  });

  it('fetches the moment under the handle and shows it when it arrives', async () => {
    const { env, tm } = make();
    tm.scrub(START + HOUR);
    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0]!.t).toBe(START + HOUR);
    expect(tm.getState().loading).toBe(true);
    expect(env.applied).toHaveLength(0);
    env.answer(7);
    await flush();
    expect(env.applied).toHaveLength(1);
    expect(tm.getState().loading).toBe(false);
    expect(tm.getState().info?.nodes).toBe(7);
    expect(tm.getState().info?.t).toBe(START + HOUR);
  });

  it('keeps one request in flight and chases the latest instant, not every one', async () => {
    const { env, tm } = make();
    tm.scrub(START + 10 * MINUTE);
    tm.scrub(START + 20 * MINUTE);
    tm.scrub(START + 30 * MINUTE);
    tm.scrub(START + 40 * MINUTE);
    expect(env.fetches).toHaveLength(1);
    env.answer(1);
    await flush();
    // The first answer is shown as progress; the next request goes for where the handle is now.
    expect(env.applied).toHaveLength(1);
    expect(env.fetches).toHaveLength(1); // the gap since the first request has not passed yet
    env.advance(GAP_DRAG_MS);
    expect(env.fetches).toHaveLength(2);
    expect(env.fetches[1]!.t).toBe(START + 40 * MINUTE);
    env.answer(2, 1);
    await flush();
    expect(env.applied).toHaveLength(2);
    expect(env.fetches).toHaveLength(2); // nothing left to chase
  });

  it('spaces requests at least a gap apart while dragging', async () => {
    const { env, tm } = make();
    tm.scrub(START + 10 * MINUTE);
    env.answer(1);
    await flush();
    tm.scrub(START + 50 * MINUTE);
    expect(env.fetches).toHaveLength(1);
    env.advance(GAP_DRAG_MS - 1);
    expect(env.fetches).toHaveLength(1);
    env.advance(1);
    expect(env.fetches).toHaveLength(2);
  });

  it('shows ground it has covered without asking again', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.answer(3);
    await flush();
    env.advance(1000);
    tm.settle(START + 2 * HOUR);
    env.answer(4, 1);
    await flush();
    expect(env.applied).toHaveLength(2);
    const before = env.fetches.length;
    tm.settle(START + HOUR);
    expect(env.fetches).toHaveLength(before);
    expect(env.applied).toHaveLength(3);
    expect(env.applied[2]).toBe(env.applied[0]);
    expect(tm.getState().info?.nodes).toBe(3);
  });

  it('rounds requests to the second', () => {
    const { env, tm } = make();
    tm.settle(START + HOUR + 400);
    expect(env.fetches[0]!.t % 1000).toBe(0);
  });

  it('never shows a late answer over a picture the handle has moved past', async () => {
    const { env, tm } = make();
    // Cover the ground at +1 h and +2 h first.
    tm.settle(START + HOUR);
    env.answer(1);
    await flush();
    env.advance(1000);
    // A slow request for +2 h goes out ...
    tm.settle(START + 2 * HOUR);
    expect(env.fetches[1]!.t).toBe(START + 2 * HOUR);
    // ... but the handle goes back to +1 h, which is already known, and shows it.
    tm.settle(START + HOUR);
    const shown = env.applied.length;
    env.answer(2, 1);
    await flush();
    expect(env.applied).toHaveLength(shown);
    expect(tm.getState().info?.nodes).toBe(1);
  });

  it('clamps the playhead to the recorded range', () => {
    const { tm } = make();
    tm.scrub(START - 5 * HOUR);
    expect(tm.getT()).toBe(START);
    tm.scrub(NOW + HOUR);
    expect(tm.getT()).toBe(NOW);
  });
});

describe('failures', () => {
  it('reports a failed moment, keeps the picture and tries again on request', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.answer(5);
    await flush();
    env.advance(1000);
    tm.settle(START + 2 * HOUR);
    env.fetches[1]!.reject(new Error('The server said no'));
    await flush();
    expect(tm.getState().error).toBe('The server said no');
    expect(tm.getState().loading).toBe(false);
    expect(tm.getState().info?.nodes).toBe(5); // still showing the last good moment
    tm.retry();
    expect(env.fetches).toHaveLength(3);
    env.answer(6, 2);
    await flush();
    expect(tm.getState().error).toBeNull();
    expect(tm.getState().info?.nodes).toBe(6);
  });

  it('does not retry on its own', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.fetches[0]!.reject(new Error('down'));
    await flush();
    env.advance(60_000);
    expect(env.fetches).toHaveLength(1);
  });
});

describe('moments with no recorded state (no_history)', () => {
  const noHistory = () =>
    new ApiError('no_history', 'no data before 2026-10-01 05:00', 404, '/timeline/state');

  it('shows an empty globe and says so, not a partial picture or an error', async () => {
    const { env, tm } = make();
    const told: number[] = [];
    env.onNoHistory = (t) => told.push(t);
    tm.settle(START + HOUR);
    env.answer(5);
    await flush();
    env.advance(1000);
    tm.settle(START + 2 * HOUR);
    env.fetches[1]!.reject(noHistory());
    await flush();
    const s = tm.getState();
    expect(s.noHistory).toBe(START + 2 * HOUR);
    expect(s.error).toBeNull();
    expect(s.info).toBeNull();
    expect(s.loading).toBe(false);
    // The last good picture is replaced by an empty one: nothing on record means no nodes.
    expect((env.applied.at(-1) as unknown as TableStub).bin.count).toBe(0);
    expect(told).toEqual([START + 2 * HOUR]);
    // A moment that has data clears it.
    tm.settle(START + HOUR);
    await flush();
    expect(tm.getState().noHistory).toBeNull();
    expect(tm.getState().info?.nodes).toBe(5);
  });

  it('clamps the playhead to a later start and loads it once the range moves on', async () => {
    const { env, tm } = make();
    tm.settle(START + 10 * MINUTE);
    env.fetches[0]!.reject(noHistory());
    await flush();
    expect(tm.getState().noHistory).toBe(START + 10 * MINUTE);
    // The recorded range is fetched again: its first keyframe is later now.
    tm.setRange(START + HOUR, NOW);
    expect(tm.getT()).toBe(START + HOUR);
    expect(env.fetches).toHaveLength(2);
    expect(env.fetches[1]!.t).toBe(START + HOUR);
    env.answer(7, 1);
    await flush();
    expect(tm.getState().noHistory).toBeNull();
    expect(tm.getState().info?.nodes).toBe(7);
  });

  it('is cleared by going live', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.fetches[0]!.reject(noHistory());
    await flush();
    tm.goLive();
    expect(tm.getState().noHistory).toBeNull();
    expect(env.applied.at(-1)).toBeNull();
  });
});

describe('going live', () => {
  it('snaps to live near now and brings the present back to the globe', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.answer(1);
    await flush();
    tm.settle(NOW - LIVE_SNAP_MS + 1000);
    expect(tm.getState().mode).toBe('live');
    expect(env.applied.at(-1)).toBeNull();
  });

  it('flies the handle home and aborts what is in flight', async () => {
    const { env, tm, commits } = make();
    tm.settle(START + HOUR);
    env.answer(1);
    await flush();
    env.advance(1000);
    tm.settle(START + 2 * HOUR);
    const pending = env.fetches[1]!;
    tm.goLive();
    expect(pending.signal.aborted).toBe(true);
    expect(tm.getState()).toMatchObject({
      mode: 'live',
      flying: true,
      playing: false,
      info: null,
      loading: false,
    });
    expect(env.applied.at(-1)).toBeNull();
    expect(commits.at(-1)).toEqual({ t: null, speed: 60 });
    env.advance(FLIGHT_MS - 1);
    expect(tm.getState().flying).toBe(true);
    env.advance(1);
    expect(tm.getState().flying).toBe(false);
  });

  it('does not touch the globe when nothing archived was showing', () => {
    const { env, tm } = make();
    tm.goLive();
    expect(env.applied).toHaveLength(0);
    expect(tm.getState().flying).toBe(false);
  });

  it('ignores an answer that arrives after going live', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    tm.goLive();
    env.fetches[0]!.resolve(stateOf(3));
    await flush();
    expect(env.applied).toHaveLength(0);
    expect(tm.getState().mode).toBe('live');
  });

  it('a handle dragged into reach of now makes the world live, and out again makes it archive', async () => {
    const { env, tm } = make();
    tm.beginDrag();
    tm.scrub(START + HOUR);
    env.answer(1);
    await flush();
    tm.scrub(NOW - 5000);
    expect(tm.getState()).toMatchObject({ mode: 'live', dragging: true, flying: false });
    expect(env.applied.at(-1)).toBeNull();
    tm.scrub(START + 2 * HOUR);
    expect(tm.getState()).toMatchObject({ mode: 'archive', dragging: true });
  });

  it('does not ask the server for the present while the handle rests at now', () => {
    const { env, tm } = make();
    tm.beginDrag();
    tm.scrub(NOW);
    tm.scrub(NOW - 1000);
    tm.endDrag(NOW - 1000);
    expect(env.fetches).toHaveLength(0);
    expect(tm.getState().mode).toBe('live');
  });

  it('a drop near now means live, a drop elsewhere settles there', () => {
    const { tm } = make();
    tm.beginDrag();
    tm.scrub(START + HOUR);
    tm.endDrag(NOW - 5000);
    expect(tm.getState()).toMatchObject({ mode: 'live', dragging: false });
    tm.beginDrag();
    tm.scrub(START + HOUR);
    tm.endDrag(START + HOUR);
    expect(tm.getState()).toMatchObject({ mode: 'archive', dragging: false });
  });
});

describe('keys', () => {
  it('nudges by a minute, an hour or a day from where it is', () => {
    const { tm } = make();
    tm.settle(START + 2 * HOUR);
    tm.step('arrow', -1);
    expect(tm.getT()).toBe(START + 2 * HOUR - MINUTE);
    tm.step('shift', -1);
    expect(tm.getT()).toBe(START + 2 * HOUR - MINUTE - HOUR);
    tm.step('arrow', 1);
    expect(tm.getT()).toBe(START + 2 * HOUR - HOUR);
  });

  it('starts from now when live, so a step back leaves the present', () => {
    const { tm } = make();
    tm.step('shift', -1);
    expect(tm.getState().mode).toBe('archive');
    expect(tm.getT()).toBe(NOW - HOUR);
  });

  it('a step forward into the snap zone returns to live', () => {
    const { tm } = make();
    tm.settle(NOW - HOUR);
    tm.nudge(HOUR - 5000);
    expect(tm.getState().mode).toBe('live');
  });
});

describe('playing', () => {
  it('replays from the start when played from live', () => {
    const { env, tm } = make();
    tm.play();
    expect(tm.getState()).toMatchObject({ mode: 'archive', playing: true });
    expect(tm.getT()).toBe(START);
    expect(env.pendingFrames).toBe(1);
  });

  it('advances at the chosen speed, a frame at a time', () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    tm.setSpeed(600);
    tm.play();
    env.tick(1000);
    expect(tm.getT()).toBe(START + HOUR); // the first frame only anchors the clock
    env.tick(1016);
    expect(tm.getT()).toBe(START + HOUR + 16 * 600);
  });

  it('does not leap after a stalled frame', () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    tm.setSpeed(60);
    tm.play();
    env.tick(1000);
    env.tick(6000); // five seconds late
    expect(tm.getT()).toBe(START + HOUR + 100 * 60);
  });

  it('asks for moments at a play pace, not every frame', () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    tm.play();
    const base = env.fetches.length;
    for (let ts = 1000; ts < 1000 + 16 * 10; ts += 16) {
      env.advance(16);
      env.tick(ts);
    }
    expect(env.fetches.length - base).toBeLessThanOrEqual(1);
    env.advance(GAP_PLAY_MS);
    expect(env.fetches.length - base).toBeLessThanOrEqual(2);
  });

  it('pauses and resumes', () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    tm.play();
    tm.pause();
    expect(tm.getState().playing).toBe(false);
    expect(env.pendingFrames).toBe(0);
    tm.toggle();
    expect(tm.getState().playing).toBe(true);
  });

  it('is live again when the replay reaches now', async () => {
    const { env, tm } = make();
    tm.settle(NOW - 2 * MINUTE);
    env.answer(1);
    await flush();
    tm.setSpeed(600);
    tm.play();
    env.tick(0);
    env.tick(100); // 100 ms x 600 = 60 s
    expect(tm.getT()).toBe(NOW - 2 * MINUTE + 60_000);
    env.tick(200);
    env.tick(300);
    expect(tm.getState()).toMatchObject({ mode: 'live', playing: false, flying: false });
    expect(env.applied.at(-1)).toBeNull();
    expect(env.pendingFrames).toBe(0);
  });

  it('pauses while the handle is held and resumes when it is let go', () => {
    const { tm } = make();
    tm.settle(START + HOUR);
    tm.play();
    tm.beginDrag();
    expect(tm.getState().playing).toBe(false);
    tm.scrub(START + 2 * HOUR);
    tm.endDrag(START + 2 * HOUR);
    expect(tm.getState().playing).toBe(true);
    expect(tm.getT()).toBe(START + 2 * HOUR);
  });

  it('commits the playhead to the URL every couple of seconds while playing', () => {
    const { env, tm, commits } = make();
    tm.settle(START + HOUR);
    tm.play();
    const before = commits.length;
    env.tick(0);
    env.advance(1000);
    env.tick(16);
    expect(commits.length).toBe(before);
    env.advance(1500);
    env.tick(32);
    expect(commits.length).toBe(before + 1);
  });
});

describe('commits', () => {
  it('reports settled positions and the speed', () => {
    const { tm, commits } = make();
    tm.settle(START + HOUR);
    expect(commits.at(-1)).toEqual({ t: START + HOUR, speed: 60 });
    tm.setSpeed(600);
    expect(commits.at(-1)).toEqual({ t: START + HOUR, speed: 600 });
  });

  it('stays quiet while the handle is dragged', () => {
    const { tm, commits } = make();
    tm.beginDrag();
    tm.scrub(START + HOUR);
    tm.scrub(START + 2 * HOUR);
    expect(commits).toHaveLength(0);
  });
});

describe('the cache', () => {
  it('keeps a bounded number of moments', async () => {
    const { env, tm } = make();
    for (let i = 0; i < CACHE_SIZE + 4; i++) {
      tm.settle(START + (i + 1) * MINUTE);
      env.answer(i + 1, i);
      await flush();
      env.advance(1000);
    }
    const asked = env.fetches.length;
    tm.settle(START + MINUTE); // evicted
    expect(env.fetches.length).toBe(asked + 1);
    tm.settle(START + (CACHE_SIZE + 4) * MINUTE); // still there
    expect(env.fetches.length).toBe(asked + 1);
  });
});

describe('lifecycle', () => {
  it('detaching brings the present back and drops what is in flight', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.answer(1);
    await flush();
    env.advance(1000);
    tm.settle(START + 2 * HOUR);
    const pending = env.fetches[1]!;
    tm.detach();
    expect(pending.signal.aborted).toBe(true);
    expect(env.applied.at(-1)).toBeNull();
    expect(env.liveTimers).toBe(0);
    expect(env.pendingFrames).toBe(0);
  });

  it('ignores moves when detached, and works again after attaching', () => {
    const { env, tm } = make();
    tm.detach();
    tm.scrub(START + HOUR);
    expect(env.fetches).toHaveLength(0);
    tm.attach();
    tm.scrub(START + HOUR);
    expect(env.fetches).toHaveLength(1);
  });

  it('puts the shown moment back on a rebuilt globe', async () => {
    const { env, tm } = make();
    tm.settle(START + HOUR);
    env.answer(1);
    await flush();
    const shown = env.applied.at(-1);
    tm.reapply();
    expect(env.applied.at(-1)).toBe(shown);
    expect(env.applied).toHaveLength(2);
  });

  it('clamps the playhead when the range changes under it', () => {
    const { tm } = make();
    tm.settle(START + HOUR);
    tm.setRange(START + 2 * HOUR, NOW);
    expect(tm.getT()).toBe(START + 2 * HOUR);
  });

  it('tells listeners about the playhead as it moves', () => {
    const { tm } = make();
    const seen: number[] = [];
    tm.subscribeT((t) => seen.push(t));
    tm.scrub(START + HOUR);
    tm.scrub(START + 2 * HOUR);
    expect(seen).toEqual([START + HOUR, START + 2 * HOUR]);
  });
});

import { describe, expect, it } from 'vitest';
import { homeView } from '../../../globe/engine/moon/orbit';
import {
  type BootFrame,
  type BootMode,
  type BootSignals,
  BootTimeline,
  bootScale,
  DRIFT_FROM,
  DRIFT_TO,
  detectFailure,
  driftShare,
  LIFT_MS,
  MIN_MS,
  QUICK_GIVE_UP_MS,
  quickStep,
  SETTLE_MS,
  STAGES,
  STALL_MS,
  type StageId,
  settleFlight,
  stageOf,
} from './model';

const IDS = STAGES.map((s) => s.id);

/** Runs a timeline at 60 fps; `at(t)` gives the signals at boot time t. */
function run(mode: BootMode, until: number, at: (t: number) => BootSignals): BootFrame[] {
  const tl = new BootTimeline(mode, 0);
  const out: BootFrame[] = [];
  for (let t = 0; t <= until; t += 16) out.push(tl.step(t, at(t)));
  return out;
}

/** Every stage's condition holds from `t = 0`: the network is instant. */
const instant = (): BootSignals => ({ done: Object.fromEntries(IDS.map((id) => [id, 0])), failed: null });

/** Stage `id` holds from `at`; the stages before it from 0. */
function readyFrom(id: StageId, at: number): (t: number) => BootSignals {
  return (t) => {
    const done: BootSignals['done'] = {};
    for (const s of STAGES) {
      done[s.id] = s.id === id || STAGES.indexOf(s) > STAGES.findIndex((x) => x.id === id) ? at : 0;
    }
    return {
      done: Object.fromEntries(Object.entries(done).filter(([, v]) => (v as number) <= t)),
      failed: null,
    };
  };
}

describe('the stage table', () => {
  it('weighs the stages as the design does and ends at exactly 1', () => {
    expect(STAGES.map((s) => s.weight)).toEqual([0.06, 0.08, 0.3, 0.12, 0.1, 0.06, 0.28]);
    expect(STAGES[0]?.a).toBe(0);
    expect(STAGES.at(-1)?.b).toBe(1);
    expect(stageOf('nodes').a).toBe(0.14);
    expect(stageOf('nodes').b).toBe(0.44);
  });
});

describe('pacing', () => {
  it('takes at least the minimum even when every stage is done at once', () => {
    for (const mode of ['first', 'return', 'reduced'] as const) {
      const frames = run(mode, 6000, instant);
      const at100 = frames.find((f) => f.progress >= 1);
      expect(at100, mode).toBeDefined();
      expect(at100?.elapsedMs ?? 0, mode).toBeGreaterThanOrEqual(MIN_MS[mode] - 20);
    }
  });

  it('never goes backwards', () => {
    const frames = run('first', 5000, readyFrom('nodes', 1800));
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]?.progress ?? 0).toBeGreaterThanOrEqual(frames[i - 1]?.progress ?? 0);
      for (let k = 0; k < 4; k++) {
        expect(frames[i]?.pieces[k] ?? 0).toBeGreaterThanOrEqual(frames[i - 1]?.pieces[k] ?? 0);
      }
    }
  });

  it('never runs ahead of what is really done', () => {
    // The nodes arrive at 3 s. Before that the bar may creep inside the stage but never finish it.
    const frames = run('first', 2900, readyFrom('nodes', 3000));
    const last = frames.at(-1);
    expect(last?.progress ?? 1).toBeLessThan(stageOf('nodes').a + stageOf('nodes').weight * 0.86);
    expect(last?.stages.find((s) => s.id === 'nodes')?.state).not.toBe('done');
    expect(last?.pieces[2] ?? 1).toBeLessThan(1);
  });

  it('shows the stage that is running', () => {
    const frames = run('first', 1200, instant);
    const f = frames.at(-1);
    expect(f?.running?.id).toBeDefined();
    expect(f?.stages.filter((s) => s.state === 'done').length).toBeGreaterThan(0);
  });

  it('reports a whole percent', () => {
    const f = run('first', 600, instant).at(-1);
    expect(Number.isInteger(f?.percent)).toBe(true);
    expect(f?.percent).toBe(Math.floor((f?.progress ?? 0) * 100));
  });
});

describe('the symbol', () => {
  it('brings the bar with the tip, then the small hexagon, the big hexagon and the cap in that order', () => {
    const frames = run('first', 3000, instant);
    const landed = (k: number) =>
      frames.find((f) => (f.pieces[k] ?? 0) >= 1)?.elapsedMs ?? Number.POSITIVE_INFINITY;
    // pieces are [bar, cap, big, small]
    expect(landed(0)).toBeLessThan(landed(3));
    expect(landed(3)).toBeLessThan(landed(2));
    expect(landed(2)).toBeLessThan(landed(1));
  });

  it('gives each piece its flight time', () => {
    const frames = run('first', 3000, instant);
    const start = frames.find((f) => (f.pieces[0] ?? 0) > 0)?.elapsedMs ?? 0;
    const land = frames.find((f) => (f.pieces[0] ?? 0) >= 1)?.elapsedMs ?? 0;
    expect(land - start).toBeGreaterThanOrEqual(480);
  });

  it('flashes white once when whole, then breathes while it waits for the stream', () => {
    const frames = run('first', 3500, () => ({
      done: Object.fromEntries(IDS.filter((id) => id !== 'stream').map((id) => [id, 0])),
      failed: null,
    }));
    expect(frames.some((f) => f.white > 0.9)).toBe(true);
    const whole = frames.filter((f) => f.phase === 'whole');
    expect(whole.length).toBeGreaterThan(10);
    expect(whole.every((f) => f.lift === 0)).toBe(true);
    expect(whole.some((f) => f.breathe !== 1)).toBe(true);
    expect(Math.max(...whole.map((f) => Math.abs(f.breathe - 1)))).toBeLessThanOrEqual(0.0121);
  });
});

describe('the lift', () => {
  it('waits for the stream: an offline boot stays assembled', () => {
    const noStream = (): BootSignals => ({
      done: Object.fromEntries(IDS.filter((id) => id !== 'stream').map((id) => [id, 0])),
      failed: null,
    });
    const frames = run('first', 8000, noStream);
    expect(frames.every((f) => f.lift === 0)).toBe(true);
    expect(frames.at(-1)?.phase).toBe('whole');
  });

  it('runs for its full duration once the stream is open, then is done', () => {
    const frames = run('first', 6000, (t) => ({
      done: Object.fromEntries(
        IDS.map((id) => [id, id === 'stream' ? 2000 : 0]).filter(([, v]) => (v as number) <= t),
      ),
      failed: null,
    }));
    const startAt = frames.find((f) => f.lift > 0)?.elapsedMs ?? 0;
    const doneAt = frames.find((f) => f.phase === 'done')?.elapsedMs ?? 0;
    expect(startAt).toBeGreaterThanOrEqual(2000);
    expect(doneAt - startAt).toBeGreaterThanOrEqual(LIFT_MS.first - 40);
    expect(doneAt - startAt).toBeLessThanOrEqual(LIFT_MS.first + 60);
  });

  it('steps instead of arcing under reduced motion', () => {
    const frames = run('reduced', 3000, instant);
    const values = new Set(frames.map((f) => f.lift));
    expect([...values].sort()).toEqual([0, 1]);
    expect(frames.every((f) => f.breathe === 1 && f.white === 0)).toBe(true);
  });

  it('does not lift while failed', () => {
    const failed = (): BootSignals => ({
      done: Object.fromEntries(IDS.map((id) => [id, 0])),
      failed: 'stream',
    });
    const frames = run('first', 5000, failed);
    expect(frames.every((f) => f.lift === 0)).toBe(true);
    expect(frames.at(-1)?.stages.find((s) => s.id === 'stream')?.state).toBe('fail');
  });
});

describe('the wave', () => {
  it('grows with progress and covers the planet by the end', () => {
    const frames = run('first', 3000, instant);
    expect(frames[0]?.theta).toBe(0);
    expect(frames.at(-1)?.theta ?? 0).toBeGreaterThan(Math.PI);
  });
});

describe('detectFailure', () => {
  const base = { nowMs: 0, startMs: 0, loadedAtMs: null, live: false, status: 'syncing', retriedAtMs: null };

  it('is quiet while the boot is simply loading', () => {
    expect(detectFailure({ ...base, nowMs: 4000 }, {})).toBeNull();
  });

  it('names the first undone stage when the connection is refused before the snapshot', () => {
    expect(detectFailure({ ...base, nowMs: 4000, status: 'offline' }, {})).toBe('connect');
    expect(detectFailure({ ...base, nowMs: 4000, status: 'offline' }, { connect: 10, tip: 20 })).toBe(
      'nodes',
    );
  });

  it('calls a snapshot that never comes a failure after the stall time', () => {
    expect(detectFailure({ ...base, nowMs: STALL_MS + 1 }, { connect: 10 })).toBe('tip');
  });

  it('fails the stream when the snapshot is in but the stream will not open', () => {
    const loaded = { ...base, loadedAtMs: 1000 };
    expect(detectFailure({ ...loaded, nowMs: 5000 }, {})).toBeNull();
    expect(detectFailure({ ...loaded, nowMs: 5000, status: 'reconnecting' }, {})).toBe('stream');
    expect(detectFailure({ ...loaded, nowMs: 1000 + STALL_MS + 1 }, {})).toBe('stream');
  });

  it('is never a failure once the stream is live', () => {
    expect(detectFailure({ ...base, nowMs: 60_000, live: true, loadedAtMs: 0 }, {})).toBeNull();
  });

  it('gives Retry a fresh clock', () => {
    const i = { ...base, loadedAtMs: 1000, status: 'offline', nowMs: 20_000 };
    expect(detectFailure(i, {})).toBe('stream');
    expect(detectFailure({ ...i, retriedAtMs: 19_000 }, {})).toBeNull();
  });
});

describe('the planet scale while the boot runs', () => {
  it('drifts from 0.84 to 0.94 of the size it ends at, never backwards', () => {
    expect(driftShare(0)).toBe(DRIFT_FROM);
    expect(driftShare(0.45)).toBe(DRIFT_FROM);
    expect(driftShare(1)).toBeCloseTo(DRIFT_TO, 10);
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = driftShare(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('is the share itself where the boot frames the planet as the shell does', () => {
    expect(bootScale(0.9, 290, 290)).toBeCloseTo(0.9, 10);
  });

  it('takes the share of the shell size when the boot frames it larger, so the planet is never above it', () => {
    // A 1600 by 900 desktop: the boot's area (log on the left) holds a planet of about 328 px, the shell's 290.
    const boot = homeView(1600, 900, { left: 420, right: 0, top: 20, bottom: 60 }).planetR;
    const shell = homeView(1600, 900, { left: 88, right: 12, top: 52, bottom: 154 }).planetR;
    expect(boot).toBeGreaterThan(shell);
    const radius = (share: number) => boot * bootScale(share, shell, boot);
    expect(radius(DRIFT_FROM)).toBeCloseTo(DRIFT_FROM * shell, 6);
    expect(radius(DRIFT_TO)).toBeCloseTo(DRIFT_TO * shell, 6);
    // And through the lift, as the framing eases from the boot's to the shell's, the drawn radius holds.
    for (let t = 0; t <= 1; t += 0.1) {
      const now = boot + (shell - boot) * t;
      expect(now * bootScale(DRIFT_TO, shell, now)).toBeCloseTo(DRIFT_TO * shell, 6);
    }
  });

  it('never scales past the framing itself', () => {
    expect(bootScale(0.94, 400, 300)).toBe(1);
  });

  it('falls back to the share where a radius is not known yet', () => {
    expect(bootScale(0.9, 290, 0)).toBe(0.9);
    expect(bootScale(0.9, 0, 300)).toBe(0.9);
    expect(bootScale(0.9, 290, Number.NaN)).toBe(0.9);
  });
});

describe("the quick path's veil", () => {
  const base = {
    startMs: 0,
    live: false,
    retriedAtMs: null,
    globeLoading: false,
    loaded: false,
    status: 'connecting',
  };

  it('lifts as soon as the data and the globe are ready', () => {
    expect(quickStep({ ...base, nowMs: 400, loaded: true })).toEqual({ kind: 'end' });
  });

  it('waits for a slow globe, then shows the shell with the data it has', () => {
    const slow = { ...base, loaded: true, globeLoading: true };
    expect(quickStep({ ...slow, nowMs: QUICK_GIVE_UP_MS - 1 })).toEqual({ kind: 'wait', failed: null });
    expect(quickStep({ ...slow, nowMs: QUICK_GIVE_UP_MS + 1 })).toEqual({ kind: 'end' });
  });

  it('keeps waiting with no data: there is nothing to show, so it never lifts on a clock', () => {
    expect(quickStep({ ...base, nowMs: 3000 })).toEqual({ kind: 'wait', failed: null });
    expect(quickStep({ ...base, nowMs: QUICK_GIVE_UP_MS + 1 }).kind).toBe('wait');
  });

  it('says Atlas did not answer after a few seconds of refusals', () => {
    const refused = { ...base, status: 'reconnecting' };
    expect(quickStep({ ...refused, nowMs: 2500 })).toEqual({ kind: 'wait', failed: null });
    expect(quickStep({ ...refused, nowMs: 3500 })).toEqual({ kind: 'wait', failed: 'connect' });
  });

  it('says it after longer silence from a server that does not refuse', () => {
    expect(quickStep({ ...base, nowMs: 9000, status: 'syncing' })).toEqual({ kind: 'wait', failed: null });
    expect(quickStep({ ...base, nowMs: 10_500, status: 'syncing' })).toEqual({
      kind: 'wait',
      failed: 'connect',
    });
  });

  it('starts the clock again at a retry', () => {
    const refused = { ...base, status: 'offline', retriedAtMs: 20_000 };
    expect(quickStep({ ...refused, nowMs: 21_000 })).toEqual({ kind: 'wait', failed: null });
    expect(quickStep({ ...refused, nowMs: 23_500 })).toEqual({ kind: 'wait', failed: 'connect' });
  });

  it('lifts by itself when the data arrives after the failure was shown', () => {
    expect(quickStep({ ...base, nowMs: 12_000, status: 'offline' })).toEqual({
      kind: 'wait',
      failed: 'connect',
    });
    expect(quickStep({ ...base, nowMs: 12_500, status: 'live', live: true, loaded: true })).toEqual({
      kind: 'end',
    });
  });
});

describe('the camera at the end of the boot', () => {
  it('goes home over the settle with no zoom-out when the reveal turned it', () => {
    expect(settleFlight(true, false)).toEqual({ arc: 0, duration: SETTLE_MS / 1000 });
  });

  it('stays where it is when the boot never turned it (a reduced boot)', () => {
    expect(settleFlight(false, false)).toBeNull();
    expect(settleFlight(false, true)).toBeNull();
  });

  it('lands at once on a skip, still with no zoom-out', () => {
    const f = settleFlight(true, true);
    expect(f?.arc).toBe(0);
    expect(f?.duration).toBeGreaterThan(0);
    expect(f?.duration).toBeLessThan(0.05);
  });
});

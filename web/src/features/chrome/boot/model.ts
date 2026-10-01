// The boot's progress model (design 6.4 J, 9.1), pure and testable. Nothing here is theatre: a stage counts
// as done only when its real condition held (the signals carry when), progress is the weighted share of the
// stages that are done plus a slow creep inside the one that is running (never more than 85% of its weight),
// and it never goes backwards. What the model adds is pacing: the displayed progress cannot run faster than
// the mode allows (a first visit takes at least 2.4 s even when the network is instant, so each piece of the
// symbol is seen arriving), and a piece takes at least its flight time to land.
//
// The four pieces of the Flux symbol arrive as their stage completes: the slanted bar when the chain tip is
// synced, then the small hexagon (Cumulus), the big hexagon (Nimbus) and the cap (Stratus) across the node
// load. The symbol is whole when the nodes are in, holds and breathes until the live stream opens, then
// lifts off. The wave of light over the planet grows with progress.

export type StageId = 'connect' | 'tip' | 'nodes' | 'hosts' | 'apps' | 'sun' | 'stream';

export interface Stage {
  id: StageId;
  label: string;
  /** Share of the bar (design 6.4 J). */
  weight: number;
  /** Where the stage starts and ends on the bar, 0..1. */
  a: number;
  b: number;
}

const WEIGHTS: ReadonlyArray<readonly [StageId, string, number]> = [
  ['connect', 'Connect to Atlas', 0.06],
  ['tip', 'Sync the chain tip', 0.08],
  ['nodes', 'Load nodes', 0.3],
  ['hosts', 'Place hosts and sites', 0.12],
  ['apps', 'Read apps', 0.1],
  ['sun', 'Set the sun', 0.06],
  ['stream', 'Open the live stream', 0.28],
];

export const STAGES: readonly Stage[] = (() => {
  let cum = 0;
  return WEIGHTS.map(([id, label, weight]) => {
    const a = Math.round(cum * 1e4) / 1e4;
    cum += weight;
    return { id, label, weight, a, b: Math.round(cum * 1e4) / 1e4 };
  });
})();

export const stageOf = (id: StageId): Stage => {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown stage ${id}`);
  return s;
};

/** `first`: never booted here, paced to 2.4 s. `return`: a later visit, the full sequence at its own pace. `reduced`: cross-fades. */
export type BootMode = 'first' | 'return' | 'reduced';

/** The shortest time to 100% (design `--dur-boot-min` is 2400 ms for a first visit). */
export const MIN_MS: Record<BootMode, number> = { first: 2400, return: 1500, reduced: 1000 };
/** One piece arriving (`--dur-assemble`; 160 ms when reduced). */
export const ASSEMBLE_MS: Record<BootMode, number> = { first: 520, return: 520, reduced: 160 };
/** The lift-off from the assembled symbol to the moon (`--dur-lift`; 300 ms when reduced). */
export const LIFT_MS: Record<BootMode, number> = { first: 1400, return: 1400, reduced: 300 };
/** The "whole" flash. */
export const WHOLE_MS = 120;
/** One breath of the assembled symbol (scale 1 +/- 1.2%). */
export const BREATHE_MS = 3200;

const CREEP_MAX = 0.85;
const CREEP_TAU_MS = 1400;

export interface BootSignals {
  /** When, on the boot clock (ms), each stage's real condition first held. Absent while it has not. */
  done: Partial<Record<StageId, number>>;
  /** The stage the boot cannot get past without help (a refused connection, a stream that will not open). */
  failed: StageId | null;
}

export interface StageView {
  id: StageId;
  label: string;
  state: 'wait' | 'run' | 'done' | 'fail';
  /** 0..1 through the stage on the bar. */
  u: number;
}

export type BootPhase = 'assembling' | 'whole' | 'lifting' | 'done';

export interface BootFrame {
  elapsedMs: number;
  /** Displayed progress, 0..1, never decreasing. */
  progress: number;
  percent: number;
  stages: StageView[];
  /** The running stage (the caption under the numeral), null when none is. */
  running: StageView | null;
  /** Arrival of the pieces in the renderer's order: bar, cap, big hexagon, small hexagon. */
  pieces: [number, number, number, number];
  /** Count-up of the tier counters, Cumulus, Nimbus, Stratus (0..1 of the real count). */
  tiers: [number, number, number];
  /** The "whole" flash, 0..1. */
  white: number;
  /** Scale of the assembled symbol while it holds. */
  breathe: number;
  /** The lift-off, 0..1 (the renderer eases it; in reduced mode it steps from 0 to 1 halfway). */
  lift: number;
  /** Angular radius of the reveal wave over the planet, radians. */
  theta: number;
  phase: BootPhase;
  failed: StageId | null;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class BootTimeline {
  private progress = 0;
  private arrivals: [number, number, number, number] = [0, 0, 0, 0];
  private last: number;
  private wholeAt: number | null = null;
  private liftAt: number | null = null;

  constructor(
    readonly mode: BootMode,
    private readonly t0: number,
  ) {
    this.last = t0;
  }

  /** Whether the lift-off has begun (the symbol is leaving; the log fades). */
  get lifting(): boolean {
    return this.liftAt !== null;
  }

  step(now: number, sig: BootSignals): BootFrame {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    const mode = this.mode;

    // Progress: what is really done, plus a creep inside the running stage, held to the pace line.
    let doneSum = 0;
    let creep = 0;
    let prevAt = this.t0;
    for (const s of STAGES) {
      const d = sig.done[s.id];
      if (d !== undefined && d <= now) {
        doneSum += s.weight;
        prevAt = Math.max(prevAt, d);
        continue;
      }
      if (sig.failed === null) {
        creep = s.weight * CREEP_MAX * (1 - Math.exp(-Math.max(0, now - prevAt) / CREEP_TAU_MS));
      }
      break;
    }
    const cap = clamp01((now - this.t0) / MIN_MS[mode]);
    this.progress = Math.max(this.progress, Math.min(doneSum + creep, cap));
    const p = this.progress;
    // The pieces and the counters follow what is really done, never the creep: nothing lands on a guess.
    const pp = Math.min(doneSum, p);

    const stages: StageView[] = STAGES.map((s) => {
      const u = clamp01((p - s.a) / (s.b - s.a));
      const state = sig.failed === s.id ? 'fail' : u >= 1 ? 'done' : u > 0 ? 'run' : 'wait';
      return { id: s.id, label: s.label, state, u };
    });
    const running = stages.find((s) => s.state === 'run' || s.state === 'fail') ?? null;

    // The pieces arrive as their stage completes, and each takes its flight time to land.
    const tip = stageOf('tip');
    const nodes = stageOf('nodes');
    const bar = clamp01((pp - tip.a) / (tip.b - tip.a));
    const nu = clamp01((pp - nodes.a) / (nodes.b - nodes.a));
    const goal: [number, number, number, number] = [
      bar,
      clamp01(nu * 3 - 2),
      clamp01(nu * 3 - 1),
      clamp01(nu * 3),
    ];
    const step = dt / ASSEMBLE_MS[mode];
    for (let i = 0; i < 4; i++) {
      const g = goal[i] ?? 0;
      const cur = this.arrivals[i] ?? 0;
      this.arrivals[i] = Math.max(cur, Math.min(g, cur + step));
    }
    const whole = this.arrivals.every((v) => v >= 1);
    if (whole && this.wholeAt === null) this.wholeAt = now;

    // The lift waits for the stream (an offline boot stays assembled) and for the six stages before it.
    const stream = sig.done.stream;
    if (
      this.liftAt === null &&
      whole &&
      sig.failed === null &&
      stream !== undefined &&
      stream <= now &&
      p >= stageOf('stream').a
    ) {
      this.liftAt = now;
    }
    const liftMs = LIFT_MS[mode];
    const liftU = this.liftAt === null ? 0 : clamp01((now - this.liftAt) / liftMs);
    const lift = mode === 'reduced' ? (liftU >= 0.5 ? 1 : 0) : liftU;

    const flashU = this.wholeAt === null ? 1 : clamp01((now - this.wholeAt) / WHOLE_MS);
    const white = mode === 'reduced' || this.wholeAt === null || flashU >= 1 ? 0 : Math.sin(Math.PI * flashU);
    const breathe =
      mode === 'reduced' || this.wholeAt === null || this.liftAt !== null
        ? 1
        : 1 + 0.012 * Math.sin(((now - this.wholeAt) / BREATHE_MS) * Math.PI * 2);

    const phase: BootPhase =
      this.liftAt !== null ? (liftU >= 1 ? 'done' : 'lifting') : whole ? 'whole' : 'assembling';

    return {
      elapsedMs: now - this.t0,
      progress: p,
      percent: Math.floor(p * 100 + 1e-9),
      stages,
      running,
      pieces: [...this.arrivals],
      tiers: [clamp01(nu * 3), clamp01(nu * 3 - 1), clamp01(nu * 3 - 2)],
      white,
      breathe,
      lift,
      theta: Math.PI * 1.06 * p ** 1.5,
      phase,
      failed: sig.failed,
    };
  }
}

/**
 * Whether the boot has failed, and at which stage. The first undone stage is the one that failed: the
 * connection was refused (offline, closed, retrying) before the snapshot came in, the snapshot has not
 * come in at all after `STALL_MS`, or the snapshot is in but the stream has not opened after `STALL_MS`.
 */
export const STALL_MS = 10_000;
/** A connection that is refused or retrying this long after the start (or the snapshot) is a failure, not a hiccup. */
export const BROKEN_MS = 3000;

export interface FailureInput {
  nowMs: number;
  startMs: number;
  /** When the snapshot came in (the nodes stage), or null. */
  loadedAtMs: number | null;
  live: boolean;
  /** The connection status of the live client. */
  status: string;
  /** When the user last pressed Retry; the stall clock restarts from it. */
  retriedAtMs: number | null;
}

export function detectFailure(i: FailureInput, done: BootSignals['done']): StageId | null {
  if (i.live) return null;
  const since = Math.max(i.startMs, i.retriedAtMs ?? i.startMs);
  const broken = i.status === 'offline' || i.status === 'closed' || i.status === 'reconnecting';
  if (i.loadedAtMs === null) {
    if ((broken && i.nowMs - since > BROKEN_MS) || i.nowMs - since > STALL_MS)
      return firstUndone(done) ?? 'connect';
    return null;
  }
  const waited = i.nowMs - Math.max(i.loadedAtMs, i.retriedAtMs ?? 0);
  if ((broken && waited > BROKEN_MS) || waited > STALL_MS) return 'stream';
  return null;
}

function firstUndone(done: BootSignals['done']): StageId | null {
  for (const s of STAGES) if (done[s.id] === undefined) return s.id;
  return null;
}

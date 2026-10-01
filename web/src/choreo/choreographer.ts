// Choreographer: turns live messages into timed effect commands (pure logic, no rendering).
//
// Rules (ARCHITECTURE section 8, design sections 4.2, 6.4 I and M, 6.5, 6.6):
//
// The Beat (design 6.4 I). A block is one message with its child events, played as a staged
// sequence on the `RELAY_MS` timeline. The Flux moon is the chain: the producer flares (t = 0, with
// the shockwave), a beam climbs to the moon (60 to 780), the moon receives the block (all four pieces
// flash at 780), then it fires its four outputs in coinbase order, `DOWNLINK_ORDER` (dev fund,
// Cumulus, Nimbus, Stratus), 130 ms apart from 890: each output's piece flashes 60 ms before it fires
// (`moonFlare` with `piece`), the dev fund's chip leaves the bar (950), and each payout beam leaves
// its piece (1020, 1150, 1280) and lands 860 ms later (1880, 2010, 2140). The heartbeat ripple
// (confirm transactions) spreads over 2 to 4 s. A second block inside 3 s plays the compact version
// (beams only). The Beat is never skipped or delayed: a new block flushes the previous block's
// pending beams at once and drops its leftover texture.
//
// Pre-aim. `next_payees` aims reticles on the three payees of the next block, but never during a
// landing: the aim waits until the next payees resolve at 2600 ms (the sequence ends at 2780).
//
// Budgets. P2 network effects (joins, leaves, status changes, app instances) are capped at 8 per
// second by a token bucket; in any 1 s window the first 3 of a kind render individually and the
// rest collapse into a "+N" summary that updates in place and turns final after 2 s of quiet. P3
// texture (heartbeats, mesh links) is sampled to 12 per second. Events touching selected, watched
// or owned nodes (P1) bypass budgets and coalescing.
//
// Hidden tab. Nothing plays while hidden (the store still applies state); on return one recap
// command summarizes what happened. Messages that are already old when they arrive (a replay
// after reconnect) are not animated either; they are recapped once the catch-up is over.
//
// Motion. `reduced`: a static flash at the producer, the uplink as a static line (380 ms, the moon
// receives at 440), every output at 480 together as static lines, and the payees highlighted for
// 1.2 s from 860; no stagger, no shockwave. `off`: no commands at all (the UI shows text).
//
// Deterministic: all timing goes through the injected scheduler.

import type { BlockMsg } from '../api/generated/BlockMsg';
import type { LiveMsg } from '../api/generated/LiveMsg';
import type { NextPayeesMsg } from '../api/generated/NextPayeesMsg';
import type { NodeChange } from '../api/generated/NodeChange';
import type { NodesDelta } from '../api/generated/NodesDelta';
import type { Tier } from '../api/generated/Tier';
import { realScheduler, type Scheduler, type TimerHandle } from '../lib/scheduler';
import {
  type CoinbaseOutput,
  DOWNLINK_ORDER,
  type EffectSink,
  type Motion,
  type PayoutPiece,
  PIECE_OF,
  type PulseKind,
  RELAY_MS,
  type RecapCmd,
} from './effects';

/**
 * Beat timeline (ms). The relay itself (uplink, moon, outputs, landings, aim) is `RELAY_MS` in
 * effects.ts, shared with the globe engine; these are the choreographer's own texture timings.
 */
export const BEAT_TIMING = {
  uplinkMs: RELAY_MS.upDur,
  downlinkMs: RELAY_MS.downDur,
  heartbeatStart: 1_600,
  heartbeatSpreadMinMs: 2_000,
  heartbeatSpreadMaxMs: 4_000,
  heartbeatPerNodeMs: 200,
  heartbeatTickMs: 100,
  startsAt: 2_200,
  startsStagger: 80,
  compactWindowMs: RELAY_MS.compactWindow,
  reducedHighlightMs: 1_200,
  instanceStagger: 80,
} as const;

export interface Budgets {
  /** P2 globe effects per second. */
  p2PerSec: number;
  /** P3 sampled texture per second. */
  p3PerSec: number;
  /** Individual renders of one kind per burst window. */
  burstIndividual: number;
  burstWindowMs: number;
  /** Quiet time after which a burst summary is final. */
  burstQuietMs: number;
}

export const DEFAULT_BUDGETS: Budgets = {
  p2PerSec: 8,
  p3PerSec: 12,
  burstIndividual: 3,
  burstWindowMs: 1_000,
  burstQuietMs: 2_000,
};

export interface ChoreographerOptions {
  scheduler?: Scheduler;
  /** Server-corrected now (live client), to spot messages that are already old. */
  serverNow?: () => number;
  motion?: Motion;
  budgets?: Partial<Budgets>;
  /** Messages observed longer ago than this are not animated. */
  lateMs?: number;
  /** Tier lookup for pulses (the store); optional. */
  tierOf?: (node: number) => Tier | null;
  /** Expected block interval for aim ETAs. */
  blockMs?: number;
  /** Height of the first reward cut (the emission ceremony). */
  emissionHeights?: readonly number[];
}

/** Coinbase output index of a payout's tier (`DOWNLINK_ORDER`); an unclassified payout fires last. */
function outputIndex(tier: Tier): number {
  const i = DOWNLINK_ORDER.indexOf(tier as CoinbaseOutput);
  return i > 0 ? i : DOWNLINK_ORDER.length;
}

/** The moon piece a payout beam leaves from (an unclassified payout uses the cap's slot). */
function payoutPiece(tier: Tier): PayoutPiece {
  return tier === 'cumulus' || tier === 'nimbus' ? PIECE_OF[tier] : PIECE_OF.stratus;
}

/** One relay timeline, resolved for full, compact or reduced motion (ms after the Beat). */
interface RelayPlan {
  upAt: number;
  upDur: number;
  recvAt: number;
  fireAt: number;
  gap: number;
  downDur: number;
  flashLead: number;
  landEarly: number;
  aimAt: number;
}

function relayPlan(compact: boolean, reduced: boolean): RelayPlan {
  const R = RELAY_MS;
  if (reduced) {
    return {
      upAt: R.up,
      upDur: R.reducedUpDur,
      recvAt: R.reducedRecv,
      fireAt: R.reducedFire,
      gap: 0,
      downDur: R.reducedLand - R.reducedFire,
      flashLead: 0,
      landEarly: 0,
      aimAt: R.aim,
    };
  }
  if (compact) {
    const recvAt = R.compactUpDur;
    const fireAt = recvAt + R.compactRecvToFire;
    const lastLand = fireAt + (DOWNLINK_ORDER.length - 1) * R.compactGap + R.compactDownDur - R.landEarly;
    return {
      upAt: 0,
      upDur: R.compactUpDur,
      recvAt,
      fireAt,
      gap: R.compactGap,
      downDur: R.compactDownDur,
      flashLead: R.flashLead,
      landEarly: R.landEarly,
      aimAt: lastLand,
    };
  }
  return {
    upAt: R.up,
    upDur: R.upDur,
    recvAt: R.recv,
    fireAt: R.fire,
    gap: R.gap,
    downDur: R.downDur,
    flashLead: R.flashLead,
    landEarly: R.landEarly,
    aimAt: R.aim,
  };
}

class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    now: number,
  ) {
    this.tokens = rate;
    this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

interface Burst {
  id: string;
  windowStart: number;
  inWindow: number;
  overflow: number;
  lastAt: number;
  finalTimer: TimerHandle | undefined;
  lastEmit: number;
}

interface Landing {
  height: number;
  /** Scheduler time of t = 0. */
  start: number;
  /** Scheduler time when the sequence has played out (2780 ms after the Beat at full motion). */
  endsAt: number;
  /** True once the next payees may be aimed (2600 ms after the Beat). */
  done: boolean;
  /** Pending P0 steps (flushed, not dropped, when the next block arrives). */
  p0: Map<TimerHandle, () => void>;
  /** Pending texture steps (dropped when the next block arrives). */
  texture: Set<TimerHandle>;
}

export interface ChoreoStats {
  blocks: number;
  compactBlocks: number;
  played: number;
  dropped: number;
  coalesced: number;
  recapped: number;
}

export class Choreographer {
  private readonly sink: EffectSink;
  private readonly sched: Scheduler;
  private readonly serverNow: () => number;
  private readonly budgets: Budgets;
  private readonly lateMs: number;
  private readonly tierOf: (node: number) => Tier | null;
  private readonly blockMs: number;
  private readonly emission: ReadonlySet<number>;
  private motion: Motion;
  private visible = true;

  private focus = new Set<number>();
  private landing: Landing | null = null;
  private lastBeatStart = Number.NEGATIVE_INFINITY;
  private lastBlock: { height: number; timeMs: number } | null = null;
  private nextPayees: NextPayeesMsg | null = null;
  private aimedHeight: number | null = null;
  /** A `next_payees` arrived during a landing; aim when the beams have landed. */
  private aimPending = false;
  private readonly p2: TokenBucket;
  private readonly p3: TokenBucket;
  private readonly bursts = new Map<string, Burst>();
  private readonly misc = new Set<TimerHandle>();

  private recap: {
    reason: RecapCmd['reason'];
    since: number;
    blocks: number;
    lastHeight: number | null;
    byKind: Record<string, number>;
  } | null = null;
  private catchUpTimer: TimerHandle | undefined;

  readonly counters: ChoreoStats = {
    blocks: 0,
    compactBlocks: 0,
    played: 0,
    dropped: 0,
    coalesced: 0,
    recapped: 0,
  };

  constructor(sink: EffectSink, opts: ChoreographerOptions = {}) {
    this.sink = sink;
    this.sched = opts.scheduler ?? realScheduler;
    this.serverNow = opts.serverNow ?? (() => this.sched.now());
    this.motion = opts.motion ?? 'full';
    this.budgets = { ...DEFAULT_BUDGETS, ...opts.budgets };
    this.lateMs = opts.lateMs ?? 10_000;
    this.tierOf = opts.tierOf ?? (() => null);
    this.blockMs = opts.blockMs ?? 30_000;
    this.emission = new Set(opts.emissionHeights ?? [3_071_200]);
    const now = this.sched.now();
    this.p2 = new TokenBucket(this.budgets.p2PerSec, now);
    this.p3 = new TokenBucket(this.budgets.p3PerSec, now);
  }

  // -------------------------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------------------------

  /** Nodes whose events are P1: selected, watched, owned. */
  setFocus(ids: Iterable<number>): void {
    this.focus = new Set(ids);
  }

  setMotion(m: Motion): void {
    this.motion = m;
    if (m === 'off') {
      this.cancelAll();
      this.sink.clearAim();
      this.aimedHeight = null;
    }
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!v) {
      this.cancelAll();
      this.beginRecap('hidden');
    } else {
      this.endRecap();
      this.reaim();
    }
  }

  /**
   * The session switched to another origin (ARCHITECTURE 8.1): node ids mean other nodes there, so
   * every effect, aim and focus keyed by an old id is dropped. The caller sets the new focus.
   */
  resetOrigin(): void {
    this.cancelAll();
    for (const b of this.bursts.values()) this.sched.clearTimeout(b.finalTimer);
    this.bursts.clear();
    this.focus = new Set();
    this.nextPayees = null;
    this.clearAim();
  }

  dispose(): void {
    this.cancelAll();
    this.sched.clearTimeout(this.catchUpTimer);
    for (const b of this.bursts.values()) this.sched.clearTimeout(b.finalTimer);
    this.bursts.clear();
  }

  stats(): ChoreoStats {
    return { ...this.counters };
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  handle(msg: LiveMsg): void {
    if (msg.t === 'hello' || msg.t === 'ping' || msg.t === 'resync') return;
    if (msg.t === 'block') this.lastBlock = { height: msg.height, timeMs: msg.time_ms };
    if (msg.t === 'next_payees') this.nextPayees = { height: msg.height, payees: msg.payees };
    if (this.motion === 'off') return;

    const late = this.serverNow() - msg.observed_ms > this.lateMs;
    if (!this.visible || late) {
      if (late && this.visible) this.beginRecap('catch_up');
      this.countRecap(msg);
      if (late && this.visible) this.armCatchUpEnd();
      if (msg.t === 'next_payees' && this.visible) this.reaim();
      return;
    }
    if (this.recap?.reason === 'catch_up') {
      // The first fresh message ends the catch-up.
      this.endRecap();
    }

    switch (msg.t) {
      case 'block':
        this.onBlock(msg);
        break;
      case 'next_payees':
        this.onNextPayees();
        break;
      case 'nodes':
        this.onNodes(msg);
        break;
      case 'apps':
        for (const a of msg.upserted)
          this.emit(() => this.sink.app({ app: a.name, phase: 'upserted', nodes: [] }));
        for (const name of msg.removed)
          this.emit(() => this.sink.app({ app: name, phase: 'removed', nodes: [] }));
        for (const inst of msg.instances) {
          this.stagger(inst.started, 'instance_started');
          this.stagger(inst.removed, 'instance_removed');
          this.stagger(inst.updated, 'instance_updated');
        }
        break;
      case 'app_pending':
        this.emit(() => this.sink.app({ app: msg.app, phase: 'pending', nodes: [] }));
        break;
      case 'app_pending_resolved':
        this.emit(() =>
          this.sink.app({ app: msg.app, phase: msg.mined ? 'confirmed' : 'expired', nodes: [] }),
        );
        break;
      case 'app_installing':
        if (msg.node !== null) this.nodePulse(msg.node, 'installing');
        break;
      case 'mesh':
        this.onMesh(msg.added, msg.removed);
        break;
      case 'reorg':
        this.emit(() =>
          this.sink.reorg({
            forkHeight: msg.fork_height,
            fromHeight: msg.from_height,
            toHeight: msg.to_height,
            orphaned: msg.orphaned.length,
          }),
        );
        break;
      default:
        // mempool, stats, feed: the UI reads them from the store; nothing on the globe.
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // The Beat
  // -------------------------------------------------------------------------------------------

  private onBlock(m: BlockMsg): void {
    const now = this.sched.now();
    const compact = now - this.lastBeatStart < BEAT_TIMING.compactWindowMs;
    this.flushLanding();
    this.lastBeatStart = now;
    this.counters.blocks++;
    if (compact) this.counters.compactBlocks++;
    const reduced = this.motion === 'reduced';
    const landing: Landing = {
      height: m.height,
      start: now,
      endsAt: now,
      done: false,
      p0: new Map(),
      texture: new Set(),
    };
    this.landing = landing;

    this.play(() =>
      this.sink.beat({
        height: m.height,
        producer: m.producer?.id ?? null,
        producerTier: m.producer?.tier ?? null,
        compact,
        reduced,
        emission: this.emission.has(m.height),
      }),
    );

    const payouts = [...m.payouts].sort((a, b) => outputIndex(a.tier) - outputIndex(b.tier));
    const aimed = this.aimedHeight === m.height;
    const P = relayPlan(compact, reduced);
    const flare = (at: number, piece: 'bar' | PayoutPiece) =>
      this.p0(landing, at, () =>
        this.sink.moonFlare({ height: m.height, durationMs: RELAY_MS.pieceFlashDur, compact, piece }),
      );

    this.p0(landing, P.upAt, () =>
      this.sink.uplink({ height: m.height, from: m.producer?.id ?? null, durationMs: P.upDur }),
    );
    // The moon receives the block: all four pieces flash and a bead joins its chain.
    this.p0(landing, P.recvAt, () =>
      this.sink.moonFlare({ height: m.height, durationMs: RELAY_MS.recvFlashDur, compact }),
    );
    // Output 0, the dev fund: the bar flashes, then its chip leaves the bar (no beam, no node).
    const devAt = P.fireAt;
    flare(devAt - P.flashLead, PIECE_OF.dev);
    this.p0(landing, devAt + (reduced ? 0 : RELAY_MS.fundAfter), () =>
      this.sink.devFund({ height: m.height, amount: m.dev_fund, piece: PIECE_OF.dev }),
    );
    // Outputs 1 to 3: Cumulus, Nimbus, Stratus, a crescendo that ends on the largest payout.
    const flashed = new Set<PayoutPiece>();
    for (const p of payouts) {
      const order = outputIndex(p.tier);
      const launch = P.fireAt + order * P.gap;
      const land = launch + P.downDur - P.landEarly;
      const piece = payoutPiece(p.tier);
      const mine = p.node !== null && this.focus.has(p.node);
      if (!flashed.has(piece)) {
        flashed.add(piece);
        flare(launch - P.flashLead, piece);
      }
      this.p0(landing, launch, () =>
        this.sink.downlink({
          height: m.height,
          to: p.node,
          tier: p.tier,
          piece,
          amount: p.amount,
          durationMs: P.downDur,
          order,
          mine,
        }),
      );
      this.p0(landing, land, () =>
        this.sink.payoutLanded({
          height: m.height,
          node: p.node,
          tier: p.tier,
          amount: p.amount,
          mine,
          highlightMs: reduced ? BEAT_TIMING.reducedHighlightMs : null,
        }),
      );
    }
    // The next payees resolve: the reticles of this block clear and the next block's are aimed.
    this.p0(landing, P.aimAt, () => this.landed(landing, aimed));
    landing.endsAt = now + (reduced || compact ? P.aimAt : RELAY_MS.end);

    if (reduced) {
      const hb = [...m.heartbeats, ...m.confirms];
      if (hb.length)
        this.play(() => this.sink.heartbeats({ height: m.height, nodes: this.sampleForBudget(hb, 1) }));
      this.focusPulses(m);
      return;
    }

    const T = BEAT_TIMING;
    // P1: focus nodes among the heartbeats, confirms and starts pulse individually.
    this.focusPulses(m);
    if (compact) {
      const skipped = m.heartbeats.length + m.confirms.length + m.starts.length;
      if (skipped) this.coalesce('block_texture', skipped);
      return;
    }

    // Heartbeat ripple: sampled to the ambient budget, spread over 2 to 4 s in 100 ms batches.
    const hb = [...m.heartbeats, ...m.confirms].filter((id) => !this.focus.has(id));
    if (hb.length) {
      const spread = Math.min(
        T.heartbeatSpreadMaxMs,
        Math.max(T.heartbeatSpreadMinMs, hb.length * T.heartbeatPerNodeMs),
      );
      const sampled = this.sampleForBudget(hb, spread / 1000);
      if (sampled.length < hb.length) this.coalesce('heartbeats', hb.length - sampled.length);
      const ticks = Math.max(1, Math.floor(spread / T.heartbeatTickMs));
      const perTick: number[][] = Array.from({ length: ticks }, () => []);
      sampled.forEach((id, k) => {
        // Ease-out density: early ticks are fuller, like a ripple spreading out.
        const x = (k + 0.5) / sampled.length;
        const tick = Math.min(ticks - 1, Math.floor((1 - Math.sqrt(1 - x)) * ticks));
        perTick[tick]!.push(id);
      });
      perTick.forEach((nodes, k) => {
        if (nodes.length) {
          this.texture(landing, T.heartbeatStart + k * T.heartbeatTickMs, () =>
            this.sink.heartbeats({ height: m.height, nodes }),
          );
        }
      });
    }
    // Node starts ignite after the beams.
    m.starts
      .filter((s) => !this.focus.has(s.id))
      .forEach((s, k) => {
        this.texture(landing, T.startsAt + k * T.startsStagger, () => {
          if (this.p2.take(this.sched.now()))
            this.sink.pulse({ node: s.id, kind: 'started', priority: 2, tier: s.tier });
          else this.coalesce('started', 1);
        });
      });
  }

  /** The next payees resolve (2600 ms): clear this height's aim, then place any aim that was waiting. */
  private landed(l: Landing, aimed: boolean): void {
    l.done = true;
    if (aimed && this.aimedHeight === l.height) this.clearAim();
    if (this.aimPending) {
      this.aimPending = false;
      this.reaim();
    }
  }

  private focusPulses(m: BlockMsg): void {
    for (const id of m.heartbeats) if (this.focus.has(id)) this.priorityPulse(id, 'confirmed');
    for (const id of m.confirms) if (this.focus.has(id)) this.priorityPulse(id, 'confirmed');
    for (const s of m.starts) if (this.focus.has(s.id)) this.priorityPulse(s.id, 'started', s.tier);
  }

  private priorityPulse(node: number, kind: PulseKind, tier?: Tier): void {
    this.play(() => this.sink.pulse({ node, kind, priority: 1, tier: tier ?? this.tierOf(node) }));
  }

  /** Runs the previous landing's pending beams now; drops its texture. */
  private flushLanding(): void {
    const l = this.landing;
    if (!l) return;
    for (const h of l.texture) {
      this.sched.clearTimeout(h);
      this.counters.dropped++;
    }
    l.texture.clear();
    const pending = [...l.p0.entries()];
    l.p0.clear();
    for (const [h, fn] of pending) {
      this.sched.clearTimeout(h);
      this.play(fn);
    }
    this.landing = null;
  }

  private p0(l: Landing, at: number, fn: () => void): void {
    if (at <= 0) {
      this.play(fn);
      return;
    }
    const h = this.sched.setTimeout(() => {
      l.p0.delete(h);
      this.play(fn);
    }, at);
    l.p0.set(h, fn);
  }

  private texture(l: Landing, at: number, fn: () => void): void {
    const h = this.sched.setTimeout(() => {
      l.texture.delete(h);
      this.play(fn);
    }, at);
    l.texture.add(h);
  }

  // -------------------------------------------------------------------------------------------
  // Aim
  // -------------------------------------------------------------------------------------------

  private onNextPayees(): void {
    this.reaim();
  }

  /** Aims at the known next payees, after any landing in progress. */
  private reaim(): void {
    const np = this.nextPayees;
    if (!np || this.motion === 'off' || !this.visible) return;
    if (this.lastBlock && np.height <= this.lastBlock.height) return;
    if (this.landing && !this.landing.done) {
      this.aimPending = true;
      return;
    }
    const etaMs = this.lastBlock
      ? Math.max(
          0,
          this.lastBlock.timeMs + this.blockMs * (np.height - this.lastBlock.height) - this.serverNow(),
        )
      : this.blockMs;
    this.aimedHeight = np.height;
    const mine = np.payees
      .filter((p) => p.node !== null && this.focus.has(p.node))
      .map((p) => p.node as number);
    this.play(() =>
      this.sink.aim({
        height: np.height,
        payees: np.payees.map((p) => ({ tier: p.tier, node: p.node })),
        etaMs,
        mine,
      }),
    );
  }

  private clearAim(): void {
    this.aimedHeight = null;
    this.sink.clearAim();
  }

  // -------------------------------------------------------------------------------------------
  // Network events
  // -------------------------------------------------------------------------------------------

  private onNodes(d: NodesDelta): void {
    for (const n of d.added) this.nodePulse(n.id, n.status === 'started' ? 'started' : 'joined', n.tier);
    for (const id of d.removed) this.nodePulse(id, 'left');
    for (const c of d.changed) {
      const kind = changeKind(c, d.cause);
      if (kind) this.nodePulse(c.id, kind, c.tier ?? null);
    }
  }

  private nodePulse(node: number, kind: PulseKind, tier: Tier | null = null): void {
    if (this.focus.has(node)) {
      this.priorityPulse(node, kind, tier ?? undefined);
      return;
    }
    const now = this.sched.now();
    const b = this.burst(kind, now);
    if (b.inWindow >= this.budgets.burstIndividual || !this.p2.take(now)) {
      this.coalesce(kind, 1);
      return;
    }
    b.inWindow++;
    this.play(() => this.sink.pulse({ node, kind, priority: 2, tier: tier ?? this.tierOf(node) }));
  }

  /** App instances pop in stagger (80 ms apart), within the P2 budget. */
  private stagger(nodes: readonly number[], kind: PulseKind): void {
    nodes.forEach((node, k) => {
      if (k === 0) this.nodePulse(node, kind);
      else {
        const h = this.sched.setTimeout(() => {
          this.misc.delete(h);
          this.nodePulse(node, kind);
        }, k * BEAT_TIMING.instanceStagger);
        this.misc.add(h);
      }
    });
  }

  private onMesh(added: [number, number][], removed: [number, number][]): void {
    const now = this.sched.now();
    const take = (list: [number, number][]) => {
      const out: [number, number][] = [];
      for (const e of list) {
        if (this.focus.has(e[0]) || this.focus.has(e[1]) || this.p3.take(now)) out.push(e);
      }
      return out;
    };
    const a = take(added);
    const r = take(removed);
    const skipped = added.length + removed.length - a.length - r.length;
    if (skipped) this.coalesce('links', skipped);
    if (a.length || r.length) this.play(() => this.sink.links({ added: a, removed: r }));
  }

  // -------------------------------------------------------------------------------------------
  // Budgets and coalescing
  // -------------------------------------------------------------------------------------------

  /** Evenly spaced sample of `ids` that fits `seconds` of the P3 budget. */
  private sampleForBudget(ids: readonly number[], seconds: number): number[] {
    const max = Math.max(1, Math.floor(this.budgets.p3PerSec * seconds));
    if (ids.length <= max) return [...ids];
    const out: number[] = [];
    const step = ids.length / max;
    for (let k = 0; k < max; k++) out.push(ids[Math.floor(k * step)]!);
    return out;
  }

  private burst(kind: string, now: number): Burst {
    let b = this.bursts.get(kind);
    if (!b || now - b.windowStart >= this.budgets.burstWindowMs) {
      const carry = b && now - b.lastAt < this.budgets.burstQuietMs ? b : null;
      b = {
        id: carry?.id ?? `${kind}:${now}`,
        windowStart: now,
        inWindow: 0,
        overflow: carry?.overflow ?? 0,
        lastAt: carry?.lastAt ?? now,
        finalTimer: carry?.finalTimer,
        lastEmit: carry?.lastEmit ?? Number.NEGATIVE_INFINITY,
      };
      this.bursts.set(kind, b);
    }
    return b;
  }

  /** Counts `n` events of `kind` into its "+N" summary (updated in place, final after quiet). */
  private coalesce(kind: string, n: number): void {
    const now = this.sched.now();
    const b = this.burst(kind, now);
    b.overflow += n;
    b.lastAt = now;
    this.counters.coalesced += n;
    if (now - b.lastEmit >= 250) {
      b.lastEmit = now;
      this.play(() => this.sink.summary({ id: b.id, kind, count: b.overflow, final: false }));
    }
    this.sched.clearTimeout(b.finalTimer);
    b.finalTimer = this.sched.setTimeout(() => {
      this.bursts.delete(kind);
      if (this.visible && this.motion !== 'off')
        this.sink.summary({ id: b.id, kind, count: b.overflow, final: true });
    }, this.budgets.burstQuietMs);
  }

  // -------------------------------------------------------------------------------------------
  // Recap (hidden tab, catch-up)
  // -------------------------------------------------------------------------------------------

  private beginRecap(reason: RecapCmd['reason']): void {
    if (this.recap) return;
    this.recap = { reason, since: this.sched.now(), blocks: 0, lastHeight: null, byKind: {} };
  }

  private countRecap(msg: LiveMsg): void {
    const r = this.recap;
    if (!r) return;
    if (msg.t === 'block') {
      r.blocks++;
      r.lastHeight = msg.height;
    }
    const n =
      msg.t === 'nodes'
        ? msg.added.length + msg.removed.length + msg.changed.filter((c) => changeKind(c, msg.cause)).length
        : msg.t === 'mempool' || msg.t === 'stats' || msg.t === 'feed' || msg.t === 'next_payees'
          ? 0
          : 1;
    if (n) r.byKind[msg.t] = (r.byKind[msg.t] ?? 0) + n;
    this.counters.recapped++;
  }

  private armCatchUpEnd(): void {
    this.sched.clearTimeout(this.catchUpTimer);
    this.catchUpTimer = this.sched.setTimeout(() => {
      if (this.recap?.reason === 'catch_up') this.endRecap();
    }, 1_000);
  }

  private endRecap(): void {
    const r = this.recap;
    this.recap = null;
    this.sched.clearTimeout(this.catchUpTimer);
    if (!r || this.motion === 'off') return;
    const events = Object.values(r.byKind).reduce((a, b) => a + b, 0);
    if (events === 0) return;
    this.play(() =>
      this.sink.recap({
        reason: r.reason,
        spanMs: this.sched.now() - r.since,
        blocks: r.blocks,
        lastHeight: r.lastHeight,
        events,
        byKind: r.byKind,
      }),
    );
  }

  // -------------------------------------------------------------------------------------------

  private emit(fn: () => void): void {
    this.play(fn);
  }

  private play(fn: () => void): void {
    if (!this.visible || this.motion === 'off') {
      this.counters.dropped++;
      return;
    }
    this.counters.played++;
    fn();
  }

  private cancelAll(): void {
    if (this.landing) {
      for (const h of this.landing.p0.keys()) this.sched.clearTimeout(h);
      for (const h of this.landing.texture) this.sched.clearTimeout(h);
      this.landing = null;
    }
    for (const h of this.misc) this.sched.clearTimeout(h);
    this.misc.clear();
    this.aimPending = false;
  }
}

/** The visible effect of a node change, or null for bookkeeping changes (rank, paid, apps). */
function changeKind(c: NodeChange, cause: NodesDelta['cause']): PulseKind | null {
  if (c.status !== undefined) {
    switch (c.status) {
      case 'confirmed':
        return 'confirmed';
      case 'started':
        return 'started';
      case 'dos':
        return 'dos';
      case 'expired':
      case 'departed':
        return 'expired';
      case 'offline':
        return 'unreachable';
      default:
        return 'status';
    }
  }
  if (c.reachable !== undefined) return c.reachable ? 'recovered' : 'unreachable';
  if (c.endpoint !== undefined) return 'ip_changed';
  if ((c.lat !== undefined || c.lon !== undefined) && cause === 'geo') return 'located';
  return null;
}

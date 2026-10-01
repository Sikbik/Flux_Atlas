// The effect vocabulary between an event choreographer and the thing that draws it, and the engine's
// implementation of it.
//
// `EffectSink` mirrors `web/src/choreo/effects.ts` one to one (same command names and fields), so the
// web app's choreographer can drive the engine directly: `runtime.setEffectSink(engine.sink)`. Every
// command is imperative and immediate: it fires at the moment the effect should start, draws itself
// from preallocated pools and never schedules a follow-up of its own, except for a few short tails
// that belong to the effect (a payee's +40% hold, the second ring of a node's ignition, the gossip
// hops of a block's flood). Timing, rate budgets, coalescing and priority are the caller's business;
// the engine owns only its concurrency budgets (the ring, arc and beam pools drop the newest when
// full).
//
// The engine's own `Choreographer` (choreographer.ts) is an optional layer on top of this class for
// the standalone lab: it schedules the same calls on the design's timeline (6.4 I) and applies state
// changes. The web app bypasses it.
//
// When porting, delete the type block below and import the same names from web/src/choreo/effects.ts;
// the class only needs `EffectSink` and the command types.

import * as THREE from 'three';
import type { Fx } from './fx';
import { RingKind } from './layers/rings';
import { DEG, arcLift, hash01 } from './math';
import type { Moon } from './moon/moon';
import type { MeshStore } from './nodes/mesh';
import type { NodeStore } from './nodes/store';
import type { GlobeTokens } from './tokens';
import type { EngineEvents } from './types';
import { NodeState } from './types';

// ---- the vocabulary (mirrors web/src/choreo/effects.ts) -----------------------------------------

export type Tier = 'unknown' | 'cumulus' | 'nimbus' | 'stratus';
/** P0 the Beat, P1 mine (selected, watched, owned), P2 network events, P3 ambient texture. */
export type Priority = 0 | 1 | 2 | 3;

/** t = 0 of a block landing: producer flare, pillar and shockwave. */
export interface BeatCmd {
  height: number;
  producer: number | null;
  producerTier: Tier | null;
  /** A second block inside the compact window: beams only, no flare or shockwave. */
  compact: boolean;
  /** Reduced motion: a static ring flash at the producer, no shockwave. */
  reduced: boolean;
  /** The one-off reward-cut block: a second, wider shockwave and the emission tint. */
  emission: boolean;
}

/** Beam from the producer up to the moon (the chain). */
export interface UplinkCmd {
  height: number;
  from: number | null;
  durationMs: number;
}

/** Which part of the moon a flare lights: all four (the moon receives the block) or one output's piece. */
export type MoonPiece = 'all' | 'bar' | 'smallHex' | 'bigHex' | 'cap';

/**
 * The moon accepts the block. Without `piece` (or with `'all'`) all four pieces flash, two rings leave
 * the moon and a bead is left on the chain; with a piece, only that piece flashes (340 ms, the bar
 * before the dev fund's chip, the others just before their beam leaves).
 */
export interface MoonFlareCmd {
  height: number;
  durationMs: number;
  compact: boolean;
  piece?: MoonPiece;
}

/** Beam from the moon down to one payee, in coinbase order (dev fund, Cumulus, Nimbus, Stratus). */
export interface DownlinkCmd {
  height: number;
  to: number | null;
  tier: Tier;
  /** FLUX, 8-decimal string. */
  amount: string;
  durationMs: number;
  /** 0-based launch order. */
  order: number;
  /** The payee is selected, watched or owned. */
  mine: boolean;
}

/** A payout arrived: payee pulse and amount chip; under reduced motion a static highlight. */
export interface PayoutLandedCmd {
  height: number;
  node: number | null;
  tier: Tier;
  amount: string;
  mine: boolean;
  /** Set under reduced motion: highlight the payee for this long instead of beams. */
  highlightMs: number | null;
}

/** The fourth coinbase output drifting off to the dev fund; no node. The bar flashes and a chip leaves it. */
export interface DevFundCmd {
  height: number;
  amount: string;
}

/** A batch of heartbeat (confirm transaction) sparkles, already sampled to the ambient budget. */
export interface HeartbeatsCmd {
  height: number | null;
  nodes: number[];
}

export type PulseKind =
  | 'joined'
  | 'left'
  | 'started'
  | 'confirmed'
  | 'status'
  | 'dos'
  | 'expired'
  | 'ip_changed'
  | 'located'
  | 'unreachable'
  | 'recovered'
  | 'installing'
  | 'instance_started'
  | 'instance_removed'
  | 'instance_updated';

/** A single-node effect (birth, implode, status flash, install arc, instance pop). */
export interface PulseCmd {
  node: number;
  kind: PulseKind;
  priority: Priority;
  tier: Tier | null;
}

/** Pre-aim reticles on the next block's payees. */
export interface AimCmd {
  height: number;
  payees: { tier: Tier; node: number | null; /** FLUX, for the label the lab draws at the reticle (optional extension). */ amount?: number }[];
  /** Expected time to the block, for the breathing tempo (the last 5 s speed up). */
  etaMs: number;
  /** Payee nodes that are selected, watched or owned. */
  mine: number[];
}

export type AppPhase = 'pending' | 'confirmed' | 'expired' | 'upserted' | 'removed';

export interface AppCmd {
  app: string;
  phase: AppPhase;
  nodes: number[];
}

export interface LinksCmd {
  added: [number, number][];
  removed: [number, number][];
}

/** "+N more" for events coalesced out of a burst or dropped by a budget. Updates in place by `id`. */
export interface SummaryCmd {
  id: string;
  kind: string;
  count: number;
  final: boolean;
}

export interface ReorgCmd {
  forkHeight: number;
  fromHeight: number;
  toHeight: number;
  orphaned: number;
}

/** A short recap instead of replaying what played while nobody watched. */
export interface RecapCmd {
  reason: 'hidden' | 'catch_up';
  spanMs: number;
  blocks: number;
  lastHeight: number | null;
  events: number;
  byKind: Record<string, number>;
}

export interface EffectSink {
  beat(cmd: BeatCmd): void;
  uplink(cmd: UplinkCmd): void;
  moonFlare(cmd: MoonFlareCmd): void;
  downlink(cmd: DownlinkCmd): void;
  payoutLanded(cmd: PayoutLandedCmd): void;
  devFund(cmd: DevFundCmd): void;
  heartbeats(cmd: HeartbeatsCmd): void;
  pulse(cmd: PulseCmd): void;
  aim(cmd: AimCmd): void;
  clearAim(): void;
  app(cmd: AppCmd): void;
  links(cmd: LinksCmd): void;
  summary(cmd: SummaryCmd): void;
  reorg(cmd: ReorgCmd): void;
  recap(cmd: RecapCmd): void;
}

// ---- the design's relay timeline (6.4 I), seconds -------------------------------------------------

/** The moon fires its four outputs in the order they appear in every PoN coinbase. One constant drives flashes, beams, chips and payouts. */
export const DOWNLINK_ORDER = ['dev', 'cumulus', 'nimbus', 'stratus'] as const;
export type Output = (typeof DOWNLINK_ORDER)[number];

export const RELAY = {
  /** Uplink leaves this long after the flare, flies `D_UP`, and the moon receives at `T_RECV`. */
  T_UP: 0.06,
  D_UP: 0.72,
  T_RECV: 0.78,
  /** The first output leaves 110 ms after the moon receives; the rest follow `GAP` apart. */
  T_FIRE: 0.89,
  GAP: 0.13,
  D_DOWN: 0.9,
  /** A piece flashes this long before its output leaves. */
  FLASH_LEAD: 0.06,
  /** The dev-fund chip starts 60 ms after the bar's output would leave. */
  FUND_AFTER: 0.06,
  /** A beam lands this long before its head's last frame. */
  LAND_EARLY: 0.04,
  /** The next payees resolve. */
  T_AIM: 2.6,
  /** Reduced motion: flare static, uplink 380 ms, receive at 440, every downlink at 480, landed at 860. */
  RED_UP: 0.38,
  RED_RECV: 0.44,
  RED_FIRE: 0.48,
  RED_LAND: 0.86,
  /** A second block inside this window plays the compact version. */
  COMPACT_WINDOW: 3.0,
  COMPACT_UP: 0.3,
  COMPACT_DOWN: 0.6,
  COMPACT_GAP: 0.06,
} as const;

/** How long a fresh payee holds +40% brightness, seconds. */
export const PAID_HOLD = 6;

const TIER_CODE: Record<Tier, number> = { unknown: 0, cumulus: 1, nimbus: 2, stratus: 3 };

export function tierCode(t: Tier | null | undefined): number {
  return t ? TIER_CODE[t] : 0;
}

const PIECE_OF: Record<MoonPiece, number> = { all: -1, bar: 0, smallHex: 1, bigHex: 2, cap: 3 };

// ---- host ----------------------------------------------------------------------------------------

export interface EffectsHost {
  fx: Fx;
  store: NodeStore;
  mesh: MeshStore;
  tokens(): GlobeTokens;
  now(): number;
  emit<K extends keyof EngineEvents>(type: K, payload: EngineEvents[K]): void;
  isFocused(slot: number): boolean;
  flowEnabled(): boolean;
  /** Projects a node's display position to canvas pixels (payout chips). */
  screenOf(slot: number, out: { x: number; y: number }): void;
  /** The Flux moon when it is on (blocks then travel producer, moon, payees), else null. */
  moon(): Moon | null;
  /** Where one of the moon's pieces is on screen, in canvas pixels (the dev-fund chip). */
  moonPiecePoint(piece: number, out: { x: number; y: number }): void;
  /** Draws a mesh link that is already in the store (fade-in and a handshake packet), adding it first when it is not. */
  linkShow(a: number, b: number): void;
  /** Retires a mesh link with a fade. */
  linkHide(a: number, b: number): void;
  /** Drops queued flourishes of the host's own (the recap). */
  flushQueued(): void;
}

// ---- timers (tails of effects) ---------------------------------------------------------------------

const T_UNPAID = 1;
const T_BIRTH2 = 2;
const T_GOSSIP = 3;
const T_UNAIM = 4;

const TCAP = 256;

class Timers {
  private readonly due = new Float64Array(TCAP);
  private readonly kind = new Uint8Array(TCAP);
  private readonly a = new Int32Array(TCAP);
  private readonly b = new Int32Array(TCAP);
  private readonly f = new Float32Array(TCAP);
  private n = 0;

  add(due: number, kind: number, a: number, b = 0, f = 0): void {
    if (this.n >= TCAP) return;
    const i = this.n++;
    this.due[i] = due;
    this.kind[i] = kind;
    this.a[i] = a;
    this.b[i] = b;
    this.f[i] = f;
  }

  clear(): void {
    this.n = 0;
  }

  get size(): number {
    return this.n;
  }

  /** Runs every timer that is due. Entries added while running wait for the next call. */
  run(now: number, fn: (kind: number, a: number, b: number, f: number) => void): void {
    let i = 0;
    const end = this.n;
    while (i < this.n && i < end) {
      if (this.due[i] <= now) {
        const k = this.kind[i];
        const a = this.a[i];
        const b = this.b[i];
        const f = this.f[i];
        const last = --this.n;
        if (i !== last) {
          this.due[i] = this.due[last];
          this.kind[i] = this.kind[last];
          this.a[i] = this.a[last];
          this.b[i] = this.b[last];
          this.f[i] = this.f[last];
        }
        fn(k, a, b, f);
      } else i++;
    }
  }
}

const MAX_AIM = 8;

// ---- the implementation ----------------------------------------------------------------------------

export class Effects implements EffectSink {
  private readonly timers = new Timers();
  private readonly col = new THREE.Color();
  private readonly col2 = new THREE.Color();
  private readonly pt = { x: 0, y: 0 };

  // the pre-aim reticles
  private readonly aimSlot = new Int32Array(MAX_AIM).fill(-1);
  private readonly aimRing = new Int32Array(MAX_AIM).fill(-1);
  private readonly aimStart = new Float32Array(MAX_AIM);
  private readonly aimGuide = new Int32Array(MAX_AIM).fill(-1);
  private readonly aimGuideStart = new Float32Array(MAX_AIM);
  private aimN = 0;

  // installing instances: slot -> ring
  private readonly installs = new Map<number, { ring: number; start: number }>();

  // gossip flood fill
  private visit = new Uint32Array(0);
  private epoch = 1;

  /** Engine time of the last flash of each moon piece (a beam that leaves just after a flare does not flash again). */
  private readonly pieceAt = new Float64Array(4).fill(-1e9);

  /** The last block's producer, for the moonless fallback (a comet straight from the producer to each payee). */
  private producerSlot = -1;

  /** Counts of commands received, for the HUD and for verifying a driver. */
  readonly counts: Record<string, number> = {};

  constructor(private readonly h: EffectsHost) {}

  // ---- per frame -------------------------------------------------------------------------------

  /** Runs the tails that belong to effects. The engine calls this once a frame. */
  update(now: number): void {
    this.timers.run(now, (kind, a, b, f) => this.tail(kind, a, b, f, now));
  }

  /** Drops tails and locks (a hidden tab returning, a recap). State the tails would have changed is settled. */
  flush(): void {
    const s = this.h.store;
    this.timers.clear();
    this.clearAim(false);
    this.installs.clear();
    for (let i = 0; i < s.high; i++) if (s.state[i] & NodeState.Paid) s.setState(i, NodeState.Paid, false);
  }

  get aimedCount(): number {
    return this.aimN;
  }
  aimedSlot(i: number): number {
    return this.aimSlot[i];
  }

  private count(name: string): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  private tail(kind: number, a: number, b: number, f: number, now: number): void {
    const h = this.h;
    const s = h.store;
    switch (kind) {
      case T_UNPAID:
        s.setState(a, NodeState.Paid, false);
        break;
      case T_BIRTH2:
        if (s.alive[a] === 0) break;
        h.fx.tierColor(s.tier[a], this.col);
        h.fx.ringPx(a, RingKind.Ignite, this.col, 0, 28, 0.6, 1.0);
        break;
      case T_GOSSIP:
        this.gossip(a, b, f, now);
        break;
      case T_UNAIM:
        break;
    }
  }

  // ---- the Beat ----------------------------------------------------------------------------------

  beat(c: BeatCmd): void {
    this.count('beat');
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    // The faint aim guides clear while the relay plays; the reticles stay until their beams land.
    this.hideGuides();
    const ps = c.producer === null ? -1 : s.slotOf(c.producer);
    this.producerSlot = ps;
    if (ps < 0 || s.alive[ps] === 0) return;
    fx.color(c.emission ? 'emission' : 'block', this.col);
    if (c.reduced || fx.reduced) {
      // A static ring flash at the producer, no shockwave.
      fx.ringPx(ps, RingKind.Producer, this.col, 30, 30, 0.9, 1.3);
      fx.flash(ps, 2.4);
      return;
    }
    if (c.compact) return;
    const tk = h.tokens();
    // Flare (white, 900 ms), pillar 0.34R, ring, then the shockwave rolling over the planet.
    fx.ringPx(ps, RingKind.Producer, this.col, 4, 58, 1.5, 1.5);
    fx.beamUp(ps, this.col, 0.34, 0.16, 0.86, 3.0, 1.7);
    fx.flash(ps, 4.0);
    const d = s.dir;
    fx.waveFrom(d[ps * 3], d[ps * 3 + 1], d[ps * 3 + 2], 1.0, tk.shockReach * DEG, 1.7);
    if (c.emission) fx.waveFrom(d[ps * 3], d[ps * 3 + 1], d[ps * 3 + 2], 0.8, tk.shockReachEmission * DEG, 2.1, 0.4);
    fx.shake(0.12);
    if (h.flowEnabled()) this.timers.add(fx.time + 0.3, T_GOSSIP, ps, 1, this.nextEpoch());
  }

  uplink(c: UplinkCmd): void {
    this.count('uplink');
    const h = this.h;
    const s = h.store;
    if (!h.moon()) return;
    const ps = c.from === null ? -1 : s.slotOf(c.from);
    if (ps < 0 || s.alive[ps] === 0) return;
    h.fx.uplink(ps, 0, Math.max(0.1, c.durationMs / 1000));
  }

  moonFlare(c: MoonFlareCmd): void {
    this.count('moonFlare');
    const moon = this.h.moon();
    if (!moon) return;
    const p = c.piece ?? 'all';
    if (p === 'all') {
      moon.seal(1, c.height);
      this.stamp(-1);
      this.h.emit('seal', { height: c.height });
    } else {
      const k = PIECE_OF[p];
      moon.flare(k, 1, Math.max(0.34, c.durationMs / 1000));
      this.stamp(k);
    }
  }

  private stamp(piece: number): void {
    const t = this.h.fx.time;
    if (piece < 0) for (let k = 0; k < 4; k++) this.pieceAt[k] = t;
    else this.pieceAt[piece] = t;
  }

  downlink(c: DownlinkCmd): void {
    this.count('downlink');
    const h = this.h;
    const fx = h.fx;
    const tier = tierCode(c.tier);
    const moon = h.moon();
    const piece = tier >= 1 && tier <= 3 ? tier : -1;
    // The piece flashes white just before its output leaves: when nothing flared it a moment ago, it
    // flashes now and the beam leaves 60 ms later (and flies a little faster, so it lands on time).
    let lead = 0;
    if (moon && piece >= 0 && fx.time - this.pieceAt[piece] > 0.2) {
      moon.flare(piece, 1, 0.34);
      this.stamp(piece);
      lead = fx.reduced ? 0 : RELAY.FLASH_LEAD;
    }
    if (c.to === null) return;
    const slot = h.store.slotOf(c.to);
    if (slot < 0 || h.store.alive[slot] === 0) return;
    fx.tierColor(tier, this.col);
    if (!moon) {
      // No moon: the block flies straight from its producer to the payee.
      const ps = this.producerSlot;
      if (ps < 0 || h.store.alive[ps] === 0 || ps === slot) return;
      const d = h.store.dir;
      const dot = d[ps * 3] * d[slot * 3] + d[ps * 3 + 1] * d[slot * 3 + 1] + d[ps * 3 + 2] * d[slot * 3 + 2];
      const lift = arcLift(Math.acos(Math.max(-1, Math.min(1, dot))), 0.12, 0.22);
      const dur = c.durationMs / 1000;
      fx.comet(ps, slot, this.col, dur, 1.7, 2.0, lift);
      fx.trace(ps, slot, this.col, dur, 2.4, 0.9, 0.28, lift);
      return;
    }
    if (piece < 0) return;
    const travel = Math.max(0.2, c.durationMs / 1000 - lead);
    fx.downlink(piece, slot, this.col, lead, travel);
  }

  payoutLanded(c: PayoutLandedCmd): void {
    this.count('payoutLanded');
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    const slot = c.node === null ? -1 : s.slotOf(c.node);
    if (slot < 0 || s.alive[slot] === 0) return;
    const tier = tierCode(c.tier);
    fx.tierColor(tier, this.col);
    const red = fx.reduced || c.highlightMs !== null;
    if (red) {
      // Reduced motion: no beam came; the payee is simply highlighted for a moment.
      fx.ringPx(slot, RingKind.Impact, this.col, 28, 28, 0.6, 1.3, tier);
      fx.flash(slot, 2.0);
    } else {
      // The reticle collapses into the payee pulse: ring 6 to 36 px over 900 ms, node flare, +40% hold.
      fx.ringPx(slot, RingKind.Impact, this.col, 6, 36, 0.9, 1.7, tier);
      fx.flash(slot, 2.6);
      fx.shake(0.04);
    }
    if (c.mine) {
      fx.color('mine', this.col2);
      fx.ringPx(slot, RingKind.Pulse, this.col2, 10, 54, 1.1, 1.2);
    }
    s.setState(slot, NodeState.Paid, true);
    this.timers.add(fx.time + (c.highlightMs !== null ? c.highlightMs / 1000 : PAID_HOLD), T_UNPAID, slot);
    for (let k = 0; k < this.aimN; k++) {
      if (this.aimSlot[k] === slot) {
        fx.endRing(this.aimRing[k], this.aimStart[k], 0.12);
        if (this.aimGuide[k] >= 0) fx.endGuide(this.aimGuide[k], this.aimGuideStart[k], 0.5);
        this.aimGuide[k] = -1;
        this.aimRing[k] = -1;
        s.setState(slot, NodeState.Aimed, false);
      }
    }
    h.screenOf(slot, this.pt);
    h.emit('payout', { id: s.id[slot], tier, amount: Number(c.amount), height: c.height, x: this.pt.x, y: this.pt.y, text: c.amount });
  }

  devFund(c: DevFundCmd): void {
    this.count('devFund');
    const h = this.h;
    const moon = h.moon();
    if (moon && h.fx.time - this.pieceAt[0] > 0.2) {
      moon.flare(0, 1, 0.34);
      this.stamp(0);
    }
    h.moonPiecePoint(0, this.pt);
    h.emit('devfund', { height: c.height, x: this.pt.x, y: this.pt.y, amount: c.amount });
  }

  // ---- texture and lifecycle ---------------------------------------------------------------------

  heartbeats(c: HeartbeatsCmd): void {
    this.count('heartbeats');
    const s = this.h.store;
    const fx = this.h.fx;
    for (let i = 0; i < c.nodes.length; i++) {
      const slot = s.slotOf(c.nodes[i]);
      if (slot >= 0 && s.alive[slot] !== 0) fx.flash(slot, 0.95);
    }
  }

  pulse(c: PulseCmd): void {
    this.count('pulse');
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    const slot = s.slotOf(c.node);
    if (slot < 0 || s.alive[slot] === 0) return;
    const strong = c.priority <= 1;
    switch (c.kind) {
      case 'joined':
        this.ignite(slot, true);
        break;
      case 'started':
        this.ignite(slot, false);
        break;
      case 'left':
        fx.color('off', this.col);
        fx.ringPx(slot, RingKind.Implode, this.col, 0, 28, 0.5, 1.3);
        break;
      case 'expired':
        fx.color('alert', this.col);
        fx.ringPx(slot, RingKind.Implode, this.col, 0, 28, 0.5, 1.3);
        break;
      case 'confirmed':
        // A heartbeat: a micro sparkle; watched nodes get a ring too.
        fx.flash(slot, strong ? 1.5 : 0.95);
        if (strong) {
          fx.tierColor(s.tier[slot], this.col);
          fx.ringPx(slot, RingKind.Tick, this.col, 3, 12, 0.6, 1.0);
        }
        break;
      case 'status':
      case 'recovered':
        this.statusPulse(slot, 'tier');
        break;
      case 'dos':
        this.statusPulse(slot, 'alert');
        break;
      case 'unreachable':
        this.statusPulse(slot, 'risk');
        break;
      case 'ip_changed':
        fx.color('accent', this.col);
        fx.ringPx(slot, RingKind.Pulse, this.col, 3, 20, 0.6, 1.0);
        fx.flash(slot, 0.8);
        break;
      case 'located':
        fx.color('accent', this.col);
        fx.ringPx(slot, RingKind.Ignite, this.col, 0, 34, 0.9, 1.2);
        fx.flash(slot, 1.2);
        break;
      case 'installing':
        this.install(slot);
        break;
      case 'instance_started':
        // Installing to running: the instance pops and releases a ring (6 to 28 px, 700 ms).
        this.endInstall(slot);
        fx.color('constellation', this.col);
        fx.ringPx(slot, RingKind.Impact, this.col, 6, 28, 0.7, 1.3);
        fx.flash(slot, 1.4);
        break;
      case 'instance_removed':
        this.endInstall(slot);
        fx.color('constellation', this.col);
        fx.ringPx(slot, RingKind.Implode, this.col, 0, 22, 0.5, 1.1);
        break;
      case 'instance_updated':
        fx.color('constellation', this.col);
        fx.ringPx(slot, RingKind.Pulse, this.col, 4, 20, 0.6, 1.0);
        fx.flash(slot, 0.9);
        break;
    }
  }

  /** Node joined: a pillar 0 to 0.12R in 600 ms, two rings 0 to 28 px (200 ms apart), a white-hot flash. */
  private ignite(slot: number, pillar: boolean): void {
    const fx = this.h.fx;
    fx.tierColor(this.h.store.tier[slot], this.col);
    if (pillar) fx.beamUp(slot, this.col, 0.12, 0.6, 1.3, 2.0, 1.3);
    fx.ringPx(slot, RingKind.Ignite, this.col, 0, 28, 0.6, 1.4);
    fx.flash(slot, pillar ? 2.6 : 1.8);
    this.timers.add(fx.time + 0.2, T_BIRTH2, slot);
  }

  private statusPulse(slot: number, color: 'tier' | 'alert' | 'risk'): void {
    const fx = this.h.fx;
    if (color === 'tier') fx.tierColor(this.h.store.tier[slot], this.col);
    else fx.color(color, this.col);
    fx.ringPx(slot, RingKind.Pulse, this.col, 3, 24, 0.5, 1.2);
    fx.flash(slot, 1.0);
  }

  private install(slot: number): void {
    if (this.installs.has(slot)) return;
    const fx = this.h.fx;
    // A spinning 240 degree arc until the instance turns Running.
    fx.color('install', this.col);
    const ring = fx.ringPx(slot, RingKind.Install, this.col, 9, 9, 180, 1.1);
    this.installs.set(slot, { ring, start: Math.fround(fx.time) });
  }

  private endInstall(slot: number): void {
    const it = this.installs.get(slot);
    if (!it) return;
    this.h.fx.endRing(it.ring, it.start, 0.25);
    this.installs.delete(slot);
  }

  // ---- aim ---------------------------------------------------------------------------------------

  aim(c: AimCmd): void {
    this.count('aim');
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    this.clearAim(true);
    const life = Math.max(6, c.etaMs / 1000 + 4);
    const alpha = fx.aimAlpha();
    const moon = h.moon();
    const announced: { id: number; tier: number; amount: number }[] = [];
    for (let i = 0; i < c.payees.length && this.aimN < MAX_AIM; i++) {
      const id = c.payees[i].node;
      if (id === null) continue;
      const slot = s.slotOf(id);
      if (slot < 0) continue;
      const tier = c.payees[i].tier ? tierCode(c.payees[i].tier) : s.tier[slot];
      announced.push({ id, tier, amount: c.payees[i].amount ?? 0 });
      const mine = c.mine.includes(id);
      if (mine) fx.color('mine', this.col);
      else fx.tierColor(tier, this.col);
      const k = this.aimN++;
      this.aimSlot[k] = slot;
      this.aimRing[k] = fx.ringPx(slot, RingKind.Target, this.col, 14, 14, life, alpha * 1.25, i * 0.37);
      this.aimStart[k] = Math.fround(fx.time);
      this.aimGuide[k] = -1;
      if (moon && moon.opts.guides && tier >= 1 && tier <= 3) {
        // The moon already knows who is next: a faint dotted line from its piece to the payee,
        // brightening over the last 5 s before the block is due.
        fx.tierColor(tier, this.col);
        this.aimGuideStart[k] = Math.fround(fx.time);
        this.aimGuide[k] = fx.aimGuide(tier, slot, this.col, life, fx.time + c.etaMs / 1000);
      }
      s.setState(slot, NodeState.Aimed, true);
    }
    h.emit('aim', { height: c.height, eta: c.etaMs, payees: announced });
  }

  clearAim(fade = true): void {
    const fx = this.h.fx;
    for (let k = 0; k < this.aimN; k++) {
      const s = this.aimSlot[k];
      if (s >= 0) this.h.store.setState(s, NodeState.Aimed, false);
      if (fade && this.aimRing[k] >= 0) fx.endRing(this.aimRing[k], this.aimStart[k]);
      if (this.aimGuide[k] >= 0) fx.endGuide(this.aimGuide[k], this.aimGuideStart[k], 0.5);
      this.aimGuide[k] = -1;
      this.aimRing[k] = -1;
      this.aimSlot[k] = -1;
    }
    this.aimN = 0;
  }

  /** Fades the dotted guides only (the relay hides them; the reticles stay until their beams land). */
  private hideGuides(): void {
    const fx = this.h.fx;
    for (let k = 0; k < this.aimN; k++) {
      if (this.aimGuide[k] >= 0) {
        fx.endGuide(this.aimGuide[k], this.aimGuideStart[k], 0.3);
        this.aimGuide[k] = -1;
      }
    }
  }

  // ---- apps, links, summary ------------------------------------------------------------------------

  app(c: AppCmd): void {
    this.count('app');
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    for (let i = 0; i < c.nodes.length && i < 64; i++) {
      const slot = s.slotOf(c.nodes[i]);
      if (slot < 0 || s.alive[slot] === 0) continue;
      switch (c.phase) {
        case 'pending':
        case 'confirmed': {
          // The deploy was seen (pending) or paid (confirmed): a soft reticle on each chosen node.
          fx.color('constellation', this.col);
          fx.ringPx(slot, RingKind.Pulse, this.col, 4, c.phase === 'pending' ? 16 : 22, c.phase === 'pending' ? 1.6 : 1.2, c.phase === 'pending' ? 0.5 : 0.8);
          break;
        }
        case 'expired':
          fx.color('alert', this.col);
          fx.ringPx(slot, RingKind.Implode, this.col, 0, 18, 0.6, 0.8);
          break;
        case 'upserted':
          fx.color('constellation', this.col);
          fx.ringPx(slot, RingKind.Pulse, this.col, 4, 20, 0.7, 0.8);
          break;
        case 'removed':
          this.endInstall(slot);
          fx.color('constellation', this.col);
          fx.ringPx(slot, RingKind.Implode, this.col, 0, 22, 0.5, 1.1);
          break;
      }
    }
    h.emit('appDeploy', { app: c.app, phase: c.phase === 'upserted' ? 'spawned' : c.phase === 'expired' ? 'failed' : c.phase, count: c.nodes.length });
  }

  links(c: LinksCmd): void {
    this.count('links');
    for (const [a, b] of c.removed) this.h.linkHide(a, b);
    for (const [a, b] of c.added) this.h.linkShow(a, b);
  }

  summary(c: SummaryCmd): void {
    this.count('summary');
    this.h.emit('summary', c);
  }

  reorg(c: ReorgCmd): void {
    this.count('reorg');
    const moon = this.h.moon();
    // The chain took a different road: the newest beads come off the orbit and the moon pulses once.
    if (moon) {
      moon.chain.drop(c.orphaned);
      moon.flareAll(0.5, 0.9);
    }
    this.h.emit('reorg', c);
  }

  recap(c: RecapCmd): void {
    this.count('recap');
    // Nothing is replayed; whatever was queued or in flight is settled and the moon acknowledges it once.
    this.h.flushQueued();
    this.flush();
    this.h.moon()?.flareAll(0.35, 0.8);
    this.h.emit('recap', c);
  }

  // ---- gossip (the flood that follows a block when the mesh flow layer is on) ------------------------

  nextEpoch(): number {
    const cap = this.h.store.capacity;
    if (this.visit.length < cap) {
      const v = new Uint32Array(cap);
      v.set(this.visit);
      this.visit = v;
    }
    return ++this.epoch;
  }

  /** Flood-fills a packet wave through the mesh from `slot` with a shrinking fan-out. */
  private gossip(slot: number, hop: number, epoch: number, now: number): void {
    const h = this.h;
    const fx = h.fx;
    const mesh = h.mesh;
    mesh.buildAdjacency(h.store, 300);
    if (this.visit.length < h.store.capacity) this.nextEpoch();
    if (hop === 1 || this.visit[slot] !== epoch) this.visit[slot] = epoch;
    const [lo, hi] = mesh.range(slot);
    const deg = hi - lo;
    if (deg === 0) return;
    const fan = hop === 1 ? 14 : hop === 2 ? 4 : hop === 3 ? 2 : hop === 4 ? 1 : 0;
    if (fan === 0) return;
    fx.color('mesh', this.col);
    const nb = mesh.neighbours;
    const d = h.store.dir;
    const start = Math.floor(hash01(slot * 7 + hop * 131 + epoch) * deg);
    let sent = 0;
    for (let k = 0; k < deg && sent < fan; k++) {
      const t = nb[lo + ((start + k * 7) % deg)];
      if (this.visit[t] === epoch || h.store.alive[t] !== 1) continue;
      this.visit[t] = epoch;
      const dot = d[slot * 3] * d[t * 3] + d[slot * 3 + 1] * d[t * 3 + 1] + d[slot * 3 + 2] * d[t * 3 + 2];
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      const travel = 0.42 + 0.38 * ang;
      fx.packet(slot, t, this.col, travel, 2.0, 1.3);
      if (hop < 4) this.timers.add(now + travel, T_GOSSIP, t, hop + 1, epoch);
      sent++;
    }
  }
}

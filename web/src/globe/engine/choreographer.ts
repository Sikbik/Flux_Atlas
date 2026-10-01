// Event choreographer: turns the live event stream into organic, budgeted animation. This is the
// optional layer for the standalone lab; an app that has its own choreographer drives `Effects`
// (effects.ts, `engine.sink`) directly and bypasses this file.
//
// The network produces bursts (a block lands with its producer, three payees, a dozen heartbeats and
// a wave of gossip) and quiet stretches. Playing every event the instant it arrives would look like
// noise, so events are scheduled on a time heap with three rules:
//
//   1. Spread. A burst is staggered over a few seconds with an ease-out density, so the eye can
//      follow the headline (producer, payout beams) before the texture (heartbeats, gossip) fills in.
//   2. Budget. Each family of events has a token bucket. Over budget, an event waits a little, then
//      is dropped. Nothing over budget ever piles up.
//   3. Priority. Events touching the selection, watched nodes or the active constellation bypass the
//      budget, and the headline block events always play.
//
// State changes (a node appearing, an edge vanishing) are applied the moment the event is enqueued;
// only the flourish is scheduled. So a hidden tab, a late event or a dropped animation can never
// leave the globe showing the wrong network.
//
// The Beat (a block landing) is the design's relay (6.4 I), as data in `RELAY` (effects.ts), and one
// constant, `DOWNLINK_ORDER`, drives it: the producer flares and a shockwave rolls out, a beam climbs
// to the moon (60 to 780 ms), the moon receives, then it fires its four outputs in the order of every
// PoN coinbase, 130 ms apart: the bar (the dev fund, a chip and no beam), then Cumulus, Nimbus and
// Stratus, each piece flashing just before its beam leaves, each beam flying 900 ms and landing on
// its pre-aimed reticle as a payee pulse (1880, 2010, 2140 ms). The next payees are aimed at 2600 ms.
// A second block inside 3 s plays the compact version.

import * as THREE from 'three';
import type { PayoutPiece } from '../../choreo/effects';
import {
  DOWNLINK_ORDER,
  type Effects,
  type EffectsHost,
  type Output,
  RELAY,
  type Tier as TierName,
} from './effects';

/** The moon piece a tier's payout leaves from (tier codes 1 to 3; 0 falls back to the small hexagon). */
const PAYOUT_PIECE: readonly PayoutPiece[] = ['smallHex', 'smallHex', 'bigHex', 'cap'];

import { RingKind } from './layers/rings';
import { hash01 } from './math';
import { NO_CLUSTER } from './nodes/store';
import type { BlockEvent, GlobeEvent, NodeRecord } from './types';

// Scheduled entry kinds
const K_CONFIRM = 3;
const K_MEMPOOL = 5;
const K_SHIMMER = 6;
const K_IGNITE = 7;
const K_LEAVE = 8;
const K_STATUS = 9;
const K_APP_SPAWN = 10;
const K_APP_REMOVE = 11;
const K_APP_INSTALL = 12;
const K_LINK = 13;
// The relay's steps (6.4 I): `ea` is the block slot, `eb` the step's argument.
const K_BEAT = 14;
const K_UPLINK = 21;
const K_RECV = 22;
const K_PFLASH = 19;
const K_FUND = 20;
const K_DOWN = 23;
const K_LAND = 24;
const K_AIM = 25;

// Budget lanes
const L_BEAM = 0;
const L_CONFIRM = 1;
const L_TICK = 2;
const L_LIFE = 3;
const L_APP = 4;
const L_CRAWL = 5;
const L_LINK = 6;
const LANES = 7;

// Tokens per second and burst size per lane. Confirms and app pops follow the design's caps
// (12 sparkles and 12 pops per second); the rest are tuned to keep a busy minute readable.
const LANE_RATE = [4, 12, 2.5, 6, 12, 10, 8];
const LANE_BURST = [8, 16, 5, 12, 14, 16, 14];
const LANE_MAX_DELAY = [4, 3.5, 1.5, 2.5, 3, 1.5, 2];

const KIND_LANE: number[] = [];
KIND_LANE[K_CONFIRM] = L_CONFIRM;
KIND_LANE[K_MEMPOOL] = L_TICK;
KIND_LANE[K_SHIMMER] = L_CRAWL;
KIND_LANE[K_IGNITE] = L_LIFE;
KIND_LANE[K_LEAVE] = L_LIFE;
KIND_LANE[K_STATUS] = L_LIFE;
KIND_LANE[K_APP_SPAWN] = L_APP;
KIND_LANE[K_APP_REMOVE] = L_APP;
KIND_LANE[K_APP_INSTALL] = L_APP;
KIND_LANE[K_LINK] = L_LINK;
KIND_LANE[K_BEAT] = L_BEAM;
KIND_LANE[K_UPLINK] = L_BEAM;
KIND_LANE[K_RECV] = L_BEAM;
KIND_LANE[K_PFLASH] = L_BEAM;
KIND_LANE[K_FUND] = L_BEAM;
KIND_LANE[K_DOWN] = L_BEAM;
KIND_LANE[K_LAND] = L_BEAM;
KIND_LANE[K_AIM] = L_BEAM;

const CAP = 4096;
const MAX_PAYEES = 8;
const BLOCK_SLOTS = 8;

/** Late events skip their animation (state is still applied). */
const STALE_MS = 9000;

const TIER_NAMES: TierName[] = ['unknown', 'cumulus', 'nimbus', 'stratus'];

interface BlockPayload {
  height: number;
  producerSlot: number;
  n: number;
  slot: Int32Array;
  tier: Uint8Array;
  amount: Float32Array;
  ev: BlockEvent | null;
  compact: boolean;
  reduced: boolean;
  /** Seconds each leg takes (set when the block starts). */
  dUp: number;
  dDown: number;
}

interface AimPayload {
  height: number;
  eta: number;
  ids: Int32Array;
  tiers: Int8Array;
  amounts: Float32Array;
  n: number;
}

export interface ChoreoHost extends EffectsHost {
  hidden: boolean;
  /** Adds a node; `delay` seconds until its appearance animation starts (negative = no animation). */
  addNode(rec: NodeRecord, delay: number): number;
  removeNode(id: number, delay: number): number;
  setStatus(slot: number, status: number): void;
  /** Returns true if an active constellation for `app` absorbed the change. */
  constellationChange(app: string, slot: number, op: 'spawn' | 'remove'): boolean;
  /** Show a short-lived constellation for a freshly deployed app. */
  transientConstellation(slots: Int32Array, n: number, seconds: number): void;
  /** Adds a mesh edge (state only) and returns its index, or -1. */
  addLink(a: number, b: number, animate: boolean): number;
  /** Draws a freshly added link (fade-in and a handshake packet). */
  showLink(e: number): void;
  removeLink(a: number, b: number, animate: boolean): void;
}

export class Choreographer {
  // heap
  private readonly due = new Float64Array(CAP);
  private readonly kind = new Uint8Array(CAP);
  private readonly ea = new Int32Array(CAP);
  private readonly eb = new Int32Array(CAP);
  private readonly ef = new Float32Array(CAP);
  private readonly prio = new Uint8Array(CAP);
  private readonly born = new Float64Array(CAP);
  private readonly heap = new Uint16Array(CAP);
  private heapN = 0;
  private readonly freeIdx = new Uint16Array(CAP);
  private freeN = 0;

  // budget
  private readonly tokens = new Float32Array(LANES);
  suppressed = 0;
  private lastBudgetEmit = 0;

  // blocks in flight
  private readonly blocks: BlockPayload[] = [];
  private blockCursor = 0;
  private lastBlockStart = -99;

  // next payees waiting for the relay to finish (they are aimed at 2.6 s)
  private readonly aims: AimPayload[] = [];
  private aimCursor = 0;

  private readonly col = new THREE.Color();

  /** Lifetime statistics for the HUD. */
  stats = { blocks: 0, confirms: 0, mempool: 0, lifecycle: 0, apps: 0, links: 0, crawl: 0, played: 0 };

  constructor(
    private readonly h: ChoreoHost,
    readonly effects: Effects,
  ) {
    for (let i = 0; i < CAP; i++) this.freeIdx[i] = CAP - 1 - i;
    this.freeN = CAP;
    for (let i = 0; i < BLOCK_SLOTS; i++) {
      this.blocks.push({
        height: 0,
        producerSlot: -1,
        n: 0,
        slot: new Int32Array(MAX_PAYEES),
        tier: new Uint8Array(MAX_PAYEES),
        amount: new Float32Array(MAX_PAYEES),
        ev: null,
        compact: false,
        reduced: false,
        dUp: 0.72,
        dDown: 0.9,
      });
    }
    for (let i = 0; i < 4; i++)
      this.aims.push({
        height: 0,
        eta: 0,
        ids: new Int32Array(MAX_PAYEES),
        tiers: new Int8Array(MAX_PAYEES),
        amounts: new Float32Array(MAX_PAYEES),
        n: 0,
      });
    for (let i = 0; i < LANES; i++) this.tokens[i] = LANE_BURST[i]! * 0.5;
  }

  get queued(): number {
    return this.heapN;
  }

  /** The pre-aimed payee slots (for the host's labels), valid until the next block. */
  get aimedCount(): number {
    return this.effects.aimedCount;
  }
  aimedSlot(i: number): number {
    return this.effects.aimedSlot(i);
  }

  // ---- heap -------------------------------------------------------------------------------

  private push(kind: number, a: number, b: number, f: number, due: number, prio: number): boolean {
    if (this.freeN === 0) {
      this.suppressed++;
      return false;
    }
    const i = this.freeIdx[--this.freeN]!;
    this.due[i] = due;
    this.kind[i] = kind;
    this.ea[i] = a;
    this.eb[i] = b;
    this.ef[i] = f;
    this.prio[i] = prio;
    this.born[i] = due;
    this.pushBack(i);
    return true;
  }

  private pop(): number {
    const top = this.heap[0]!;
    this.heapN--;
    if (this.heapN > 0) {
      this.heap[0] = this.heap[this.heapN]!;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < this.heapN && this.due[this.heap[l]!]! < this.due[this.heap[m]!]!) m = l;
        if (r < this.heapN && this.due[this.heap[r]!]! < this.due[this.heap[m]!]!) m = r;
        if (m === k) break;
        const t = this.heap[m]!;
        this.heap[m] = this.heap[k]!;
        this.heap[k] = t;
        k = m;
      }
    }
    return top;
  }

  /** Inserts an already allocated entry into the heap. */
  private pushBack(i: number): void {
    let k = this.heapN++;
    this.heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.due[this.heap[p]!]! <= this.due[this.heap[k]!]!) break;
      const t = this.heap[p]!;
      this.heap[p] = this.heap[k]!;
      this.heap[k] = t;
      k = p;
    }
  }

  private release(i: number): void {
    this.freeIdx[this.freeN++] = i;
  }

  /** Drops every scheduled flourish (used when the tab returns after being hidden). */
  flush(): void {
    this.heapN = 0;
    this.freeN = CAP;
    for (let i = 0; i < CAP; i++) this.freeIdx[i] = CAP - 1 - i;
    for (let i = 0; i < LANES; i++) this.tokens[i] = LANE_BURST[i]! * 0.5;
    this.h.fx.time = this.h.now();
    // Target locks belong to an old block window; the next nextPayees event re-creates them. Paid
    // holds are released too, so nothing stays lit forever.
    this.effects.flush();
  }

  // ---- public entry -----------------------------------------------------------------------

  /**
   * Queues a live event. `lead` (seconds) delays only a block's choreography, never its state: the
   * ambient director uses it to start the camera move before the flare so the cut lands on the beat.
   */
  enqueue(ev: GlobeEvent, lead = 0): void {
    const h = this.h;
    const now = h.now();
    const stale = h.hidden || (ev.time !== undefined && Date.now() - ev.time > STALE_MS);
    switch (ev.type) {
      case 'block':
        this.onBlock(ev, now + lead, stale);
        break;
      case 'nextPayees':
        this.onNextPayees(ev, now, stale);
        break;
      case 'confirm':
        this.stats.confirms += ev.ids.length;
        if (!stale) this.scheduleConfirms(ev.ids, now, 0.05, 1.4);
        break;
      case 'mempool': {
        const n = ev.count ?? 1;
        this.stats.mempool += n;
        h.emit('mempool', { count: n });
        // Design: mempool is list-only. On the globe it is at most a whisper of gossip, and only
        // while the network-wide flow layer is showing the mesh.
        if (!stale && h.flowEnabled())
          for (let i = 0; i < Math.min(n, 4); i++)
            this.push(K_MEMPOOL, -1, (ev.seed ?? 0) + i, 0, now + i * 0.25, 0);
        break;
      }
      case 'nodeStarted': {
        this.stats.lifecycle++;
        const existing = h.store.slotOf(ev.node.id);
        if (existing >= 0 && h.store.alive[existing] === 2) h.store.revive(existing, now);
        else if (existing < 0) h.addNode(ev.node, stale ? -1 : 0.05);
        if (!stale) {
          const s = h.store.slotOf(ev.node.id);
          if (s >= 0) this.push(K_IGNITE, s, 0, 0, now + 0.08, h.isFocused(s) ? 2 : 0);
        }
        break;
      }
      case 'nodeLeft': {
        this.stats.lifecycle++;
        const s = h.store.slotOf(ev.id);
        if (s < 0) break;
        if (!stale)
          this.push(K_LEAVE, s, ev.reason === 'expired' ? 1 : 0, 0, now + 0.02, h.isFocused(s) ? 2 : 0);
        h.removeNode(ev.id, stale ? -1 : 0.4);
        break;
      }
      case 'nodeStatus': {
        this.stats.lifecycle++;
        const s = h.store.slotOf(ev.id);
        if (s < 0) break;
        h.setStatus(s, ev.status);
        if (!stale) this.push(K_STATUS, s, ev.status, 0, now + 0.02, h.isFocused(s) ? 2 : 0);
        break;
      }
      case 'appDeploy':
        this.onAppDeploy(ev.app, ev.phase, ev.nodes, now, stale);
        break;
      case 'appInstance': {
        this.stats.apps++;
        const s = h.store.slotOf(ev.node);
        if (s < 0) break;
        const handled = h.constellationChange(ev.app, s, ev.op);
        if (!stale)
          this.push(
            ev.op === 'spawn' ? K_APP_SPAWN : K_APP_REMOVE,
            s,
            handled ? 1 : 0,
            0,
            now + 0.05,
            handled || h.isFocused(s) ? 2 : 0,
          );
        break;
      }
      case 'crawl': {
        this.stats.crawl += ev.ids.length;
        if (stale) break;
        const n = ev.ids.length;
        for (let i = 0; i < n; i++) {
          const s = h.store.slotOf(ev.ids[i]!);
          if (s < 0) continue;
          this.push(K_SHIMMER, s, 0, 0, now + this.spread(i, n, ev.ids[i]!, 1.6), h.isFocused(s) ? 2 : 0);
        }
        break;
      }
      case 'peerLink': {
        this.stats.links++;
        if (ev.op === 'add') {
          const e = h.addLink(ev.a, ev.b, !stale);
          if (e >= 0 && !stale)
            this.push(
              K_LINK,
              e,
              0,
              0,
              now + hash01(e * 7 + 3) * 0.6,
              h.isFocused(h.store.slotOf(ev.a)) || h.isFocused(h.store.slotOf(ev.b)) ? 2 : 0,
            );
        } else {
          h.removeLink(ev.a, ev.b, !stale);
        }
        break;
      }
    }
  }

  // ---- blocks -----------------------------------------------------------------------------

  private onBlock(ev: BlockEvent, now: number, stale: boolean): void {
    const h = this.h;
    this.stats.blocks++;
    // The block has landed: release the reticles (they collapse into the payee pulses when the
    // beams arrive; if nothing fires they just fade).
    if (stale) {
      this.effects.clearAim(false);
      return;
    }
    const p = this.blocks[this.blockCursor++ % BLOCK_SLOTS]!;
    p.height = ev.height;
    p.ev = ev;
    p.producerSlot = h.store.slotOf(ev.producer);
    p.n = 0;
    for (let i = 0; i < ev.payees.length && p.n < MAX_PAYEES; i++) {
      const s = h.store.slotOf(ev.payees[i]!.id);
      if (s < 0) continue;
      p.slot[p.n] = s;
      p.tier[p.n] = ev.payees[i]!.tier ?? h.store.tier[s]!;
      p.amount[p.n] = ev.payees[i]!.amount ?? 0;
      p.n++;
    }
    const idx = (this.blockCursor - 1) % BLOCK_SLOTS;
    this.push(K_BEAT, idx, 0, 0, now, 3);
    // The heartbeat ripple spreads over 2 to 4 s, after the beams.
    if (ev.confirms) this.scheduleConfirms(ev.confirms, now, 1.6, 2.6);
  }

  /** Puts the relay's steps on the heap. Times are from the block's arrival (6.4 I); `DOWNLINK_ORDER` drives the order. */
  private startBlock(idx: number, now: number): void {
    const h = this.h;
    const p = this.blocks[idx]!;
    const ev = p.ev;
    if (!ev) return;
    this.stats.played++;
    const compact = now - this.lastBlockStart < RELAY.COMPACT_WINDOW;
    const red = h.fx.reduced;
    this.lastBlockStart = now;
    p.compact = compact;
    p.reduced = red;

    const tUp = red ? RELAY.T_UP : compact ? 0 : RELAY.T_UP;
    const dUp = red ? RELAY.RED_UP : compact ? RELAY.COMPACT_UP : RELAY.D_UP;
    const tRecv = red ? RELAY.RED_RECV : tUp + dUp;
    const tFire = red ? RELAY.RED_FIRE : compact ? tRecv + 0.04 : RELAY.T_FIRE;
    const gap = red ? 0 : compact ? RELAY.COMPACT_GAP : RELAY.GAP;
    const dDown = red ? RELAY.RED_LAND - RELAY.RED_FIRE : compact ? RELAY.COMPACT_DOWN : RELAY.D_DOWN;
    p.dUp = dUp;
    p.dDown = dDown;

    this.push(K_BEAT, idx, 1, 0, now, 3);
    this.push(K_UPLINK, idx, 0, 0, now + tUp, 3);
    this.push(K_RECV, idx, 0, 0, now + tRecv, 3);
    const flashLead = red ? 0 : RELAY.FLASH_LEAD;
    for (let i = 0; i < DOWNLINK_ORDER.length; i++) {
      const out: Output = DOWNLINK_ORDER[i]!;
      const t = tFire + i * gap;
      if (out === 'dev') {
        // The fourth coinbase output has no node: the bar flashes first, then a chip leaves it.
        this.push(K_PFLASH, idx, 0, 0, now + t - flashLead, 3);
        this.push(K_FUND, idx, 0, 0, now + t + RELAY.FUND_AFTER, 3);
        continue;
      }
      const tier = i;
      for (let r = 0; r < p.n; r++) {
        if (p.tier[r] !== tier) continue;
        this.push(K_PFLASH, idx, tier, 0, now + t - flashLead, 3);
        this.push(K_DOWN, idx, r, 0, now + t, 3);
        this.push(K_LAND, idx, r, 0, now + t + dDown - (red ? 0 : RELAY.LAND_EARLY), 3);
      }
    }
    // A payee whose tier is unknown still gets its beam, after the crescendo.
    for (let r = 0; r < p.n; r++) {
      if (p.tier[r]! >= 1 && p.tier[r]! <= 3) continue;
      const t = tFire + 4 * gap;
      this.push(K_DOWN, idx, r, 0, now + t, 3);
      this.push(K_LAND, idx, r, 0, now + t + dDown - (red ? 0 : RELAY.LAND_EARLY), 3);
    }
  }

  private onNextPayees(
    ev: { height: number; eta?: number; payees: readonly { id: number; tier?: number; amount?: number }[] },
    now: number,
    stale: boolean,
  ): void {
    const h = this.h;
    if (stale) {
      this.effects.clearAim(false);
      const a: { id: number; tier: number; amount: number }[] = [];
      for (const p of ev.payees) a.push({ id: p.id, tier: p.tier ?? 0, amount: p.amount ?? 0 });
      h.emit('aim', { height: ev.height, eta: ev.eta ?? 30000, payees: a });
      return;
    }
    // Never during a landing: the reticles of this block are still collapsing into their payees. The
    // next payees resolve at 2.6 s.
    const wait = this.lastBlockStart + RELAY.T_AIM - now;
    if (wait > 0) {
      const slot = this.aims[this.aimCursor++ % this.aims.length]!;
      slot.height = ev.height;
      slot.eta = ev.eta ?? 30000;
      slot.n = 0;
      for (let i = 0; i < ev.payees.length && slot.n < MAX_PAYEES; i++) {
        slot.ids[slot.n] = ev.payees[i]!.id;
        slot.tiers[slot.n] = ev.payees[i]!.tier ?? 0;
        slot.amounts[slot.n] = ev.payees[i]!.amount ?? 0;
        slot.n++;
      }
      this.push(K_AIM, (this.aimCursor - 1) % this.aims.length, 0, 0, now + wait, 3);
      return;
    }
    this.aimNow(ev.height, ev.eta ?? 30000, ev.payees);
  }

  private aimNow(
    height: number,
    eta: number,
    payees: readonly { id: number; tier?: number; amount?: number }[],
  ): void {
    const h = this.h;
    const list: { tier: TierName; node: number | null; amount?: number }[] = [];
    const mine: number[] = [];
    for (const p of payees) {
      const s = h.store.slotOf(p.id);
      const t = p.tier ?? (s >= 0 ? h.store.tier[s]! : 0);
      list.push({ tier: TIER_NAMES[t >= 1 && t <= 3 ? t : 0]!, node: p.id, amount: p.amount });
      if (s >= 0 && h.isFocused(s)) mine.push(p.id);
    }
    this.effects.aim({ height, payees: list, etaMs: eta, mine });
  }

  // ---- confirms & helpers ------------------------------------------------------------------

  private spread(i: number, n: number, seed: number, span: number): number {
    const u = (i + hash01(seed * 977 + i)) / Math.max(1, n);
    return span * (1 - (1 - u) ** 1.7);
  }

  private scheduleConfirms(ids: ArrayLike<number>, now: number, offset: number, span: number): void {
    const h = this.h;
    const n = ids.length;
    for (let i = 0; i < n; i++) {
      const s = h.store.slotOf(ids[i]!);
      if (s < 0) continue;
      this.push(K_CONFIRM, s, 0, 0, now + offset + this.spread(i, n, ids[i]!, span), h.isFocused(s) ? 2 : 0);
    }
  }

  // ---- apps -------------------------------------------------------------------------------

  private appNodes = new Int32Array(256);

  private onAppDeploy(
    app: string,
    phase: string,
    nodes: ArrayLike<number> | undefined,
    now: number,
    stale: boolean,
  ): void {
    const h = this.h;
    this.stats.apps++;
    const n = Math.min(nodes?.length ?? 0, this.appNodes.length);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const s = h.store.slotOf((nodes as ArrayLike<number>)[i]!);
      if (s >= 0) this.appNodes[count++] = s;
    }
    h.emit('appDeploy', { app, phase: phase as 'pending', count });
    if (stale || count === 0) return;
    if (phase === 'installing') {
      for (let i = 0; i < count; i++)
        this.push(
          K_APP_INSTALL,
          this.appNodes[i]!,
          0,
          0,
          now + this.spread(i, count, this.appNodes[i]!, 1.2),
          0,
        );
    } else if (phase === 'spawned') {
      // Instances spawn in stagger (80 ms apart, at most 12 pops per second through the app lane).
      for (let i = 0; i < count; i++)
        this.push(K_APP_SPAWN, this.appNodes[i]!, 0, 0, now + Math.min(i * 0.08, 2.4), 0);
      h.transientConstellation(this.appNodes, count, 7);
    } else if (phase === 'removed' || phase === 'failed') {
      for (let i = 0; i < count; i++)
        this.push(
          K_APP_REMOVE,
          this.appNodes[i]!,
          0,
          0,
          now + this.spread(i, count, this.appNodes[i]!, 1.2),
          0,
        );
    } else if (phase === 'confirmed' || phase === 'pending') {
      // The deploy was seen (pending) or paid (confirmed): a soft reticle on each chosen node.
      const ids: number[] = [];
      for (let i = 0; i < count; i++) ids.push(h.store.id[this.appNodes[i]!]!);
      this.effects.app({ app, phase: phase as 'pending' | 'confirmed', nodes: ids });
    }
  }

  // ---- per frame --------------------------------------------------------------------------

  update(dt: number): void {
    const h = this.h;
    const fx = h.fx;
    const now = h.now();
    fx.time = now;
    for (let i = 0; i < LANES; i++)
      this.tokens[i] = Math.min(LANE_BURST[i]!, this.tokens[i]! + LANE_RATE[i]! * dt);
    let guard = 0;
    while (this.heapN > 0 && this.due[this.heap[0]!]! <= now && guard++ < 600) {
      const i = this.pop();
      const kind = this.kind[i]!;
      const lane = KIND_LANE[kind]!;
      const pr = this.prio[i]!;
      let ok = true;
      if (pr < 3) {
        // Hidden side of the planet: far cheaper, never worth a ring.
        let cost = 1;
        const slot = this.ea[i]!;
        if (kind !== K_MEMPOOL && kind !== K_LINK && slot >= 0 && !fx.visible(slot) && pr < 2) cost = 0.15;
        if (this.tokens[lane]! >= cost) this.tokens[lane]! -= cost;
        else if (pr >= 2) this.tokens[lane] = Math.max(-8, this.tokens[lane]! - cost);
        else {
          ok = false;
          const late = now - this.born[i]!;
          if (late < LANE_MAX_DELAY[lane]!) {
            // Try again a moment later.
            this.due[i] = now + 0.12 + hash01(i * 31 + guard) * 0.2;
            this.pushBack(i);
            continue;
          }
          this.suppressed++;
        }
      }
      if (ok) this.run(kind, this.ea[i]!, this.eb[i]!, this.ef[i]!, pr, now);
      this.release(i);
    }
    if (this.suppressed > 0 && now - this.lastBudgetEmit > 1) {
      this.lastBudgetEmit = now;
      h.emit('budget', { suppressed: this.suppressed });
    }
  }

  private run(kind: number, a: number, b: number, _f: number, prio: number, now: number): void {
    const h = this.h;
    const s = h.store;
    const fx = h.fx;
    const E = this.effects;
    switch (kind) {
      case K_BEAT:
        if (b === 0) this.startBlock(a, now);
        else this.beat(a);
        break;
      case K_UPLINK: {
        const p = this.blocks[a]!;
        E.uplink({ height: p.height, from: p.ev ? p.ev.producer : null, durationMs: p.dUp * 1000 });
        break;
      }
      case K_RECV: {
        const p = this.blocks[a]!;
        E.moonFlare({ height: p.height, durationMs: 900, compact: p.compact });
        break;
      }
      case K_PFLASH: {
        const p = this.blocks[a]!;
        E.moonFlare({
          height: p.height,
          durationMs: 340,
          compact: p.compact,
          piece: b === 0 ? 'bar' : b === 1 ? 'smallHex' : b === 2 ? 'bigHex' : 'cap',
        });
        break;
      }
      case K_FUND: {
        const p = this.blocks[a]!;
        E.devFund({ height: p.height, amount: '0.50000000', piece: 'bar' });
        break;
      }
      case K_DOWN: {
        const p = this.blocks[a]!;
        E.downlink({
          height: p.height,
          to: s.id[p.slot[b]!]!,
          tier: TIER_NAMES[p.tier[b]! & 3]!,
          piece: PAYOUT_PIECE[p.tier[b]! & 3]!,
          amount: p.amount[b]!.toFixed(8),
          durationMs: p.dDown * 1000,
          order: b,
          mine: h.isFocused(p.slot[b]!),
        });
        break;
      }
      case K_LAND: {
        const p = this.blocks[a]!;
        E.payoutLanded({
          height: p.height,
          node: s.id[p.slot[b]!]!,
          tier: TIER_NAMES[p.tier[b]! & 3]!,
          amount: p.amount[b]!.toFixed(8),
          mine: h.isFocused(p.slot[b]!),
          highlightMs: p.reduced ? 1200 : null,
        });
        break;
      }
      case K_AIM: {
        const q = this.aims[a]!;
        const list: { id: number; tier: number; amount: number }[] = [];
        for (let i = 0; i < q.n; i++) list.push({ id: q.ids[i]!, tier: q.tiers[i]!, amount: q.amounts[i]! });
        this.aimNow(q.height, q.eta, list);
        break;
      }
      case K_CONFIRM: {
        // Heartbeat: a micro sparkle (scale 1 to 1.6 to 1, +40% alpha over 600 ms). Watched nodes get a ring too.
        if (s.alive[a] === 0) break;
        E.pulse({ node: s.id[a]!, kind: 'confirmed', priority: prio >= 2 ? 1 : 3, tier: null });
        break;
      }
      case K_MEMPOOL:
        this.mempoolHop(b, now);
        break;
      case K_SHIMMER: {
        if (s.alive[a] === 0) break;
        fx.flash(a, 0.3);
        if (prio >= 2) {
          fx.tierColor(s.tier[a]!, this.col);
          fx.ringPx(a, RingKind.Shimmer, this.col, 4, 14, 1.2, 0.55);
        }
        break;
      }
      case K_IGNITE:
        if (s.alive[a] !== 0)
          E.pulse({ node: s.id[a]!, kind: 'joined', priority: prio >= 2 ? 1 : 2, tier: null });
        break;
      case K_LEAVE:
        if (s.alive[a] !== 0)
          E.pulse({
            node: s.id[a]!,
            kind: b === 1 ? 'expired' : 'left',
            priority: prio >= 2 ? 1 : 2,
            tier: null,
          });
        break;
      case K_STATUS:
        if (s.alive[a] !== 0)
          E.pulse({
            node: s.id[a]!,
            kind: b === 4 ? 'dos' : b === 5 ? 'unreachable' : 'status',
            priority: prio >= 2 ? 1 : 2,
            tier: null,
          });
        break;
      case K_APP_SPAWN:
        if (s.alive[a] !== 0)
          E.pulse({ node: s.id[a]!, kind: 'instance_started', priority: prio >= 2 ? 1 : 2, tier: null });
        break;
      case K_APP_REMOVE:
        if (s.alive[a] !== 0)
          E.pulse({ node: s.id[a]!, kind: 'instance_removed', priority: prio >= 2 ? 1 : 2, tier: null });
        break;
      case K_APP_INSTALL:
        if (s.alive[a] !== 0) E.pulse({ node: s.id[a]!, kind: 'installing', priority: 2, tier: null });
        break;
      case K_LINK:
        h.showLink(a);
        break;
    }
  }

  /** The Beat's first step: the producer flares, the shockwave rolls, the lab's overlays hear about the block. */
  private beat(idx: number): void {
    const h = this.h;
    const p = this.blocks[idx]!;
    const ev = p.ev;
    if (!ev) return;
    const ps = p.producerSlot;
    const tier = ps >= 0 ? TIER_NAMES[h.store.tier[ps]! & 3]! : null;
    this.effects.beat({
      height: p.height,
      producer: ev.producer,
      producerTier: tier,
      compact: p.compact,
      reduced: p.reduced,
      emission: ev.emission === true,
    });
    h.emit('block', ev);
  }

  /** Two-hop whisper for a mempool transaction: dim packets from a pseudo-random origin. */
  private mempoolHop(seed: number, now: number): void {
    const h = this.h;
    const fx = h.fx;
    const s = h.store;
    if (s.high === 0) return;
    let origin = -1;
    for (let tries = 0; tries < 8; tries++) {
      const c = Math.floor(hash01(seed * 131 + tries * 17 + Math.floor(now * 3)) * s.high);
      if (s.alive[c] === 1 && fx.visible(c)) {
        origin = c;
        break;
      }
    }
    if (origin < 0) return;
    h.mesh.buildAdjacency(s, 300);
    const [lo, hi] = h.mesh.range(origin);
    const deg = hi - lo;
    if (deg === 0) return;
    fx.color('mesh', this.col);
    this.col.multiplyScalar(0.7);
    fx.flash(origin, 0.3);
    const nb = h.mesh.neighbours;
    const first = Math.floor(hash01(seed * 7 + 3) * deg);
    for (let k = 0; k < Math.min(3, deg); k++) {
      const t = nb[lo + ((first + k) % deg)]!;
      if (s.alive[t] !== 1) continue;
      fx.packet(origin, t, this.col, 0.7, 1.5, 0.9);
    }
  }

  dispose(): void {
    this.heapN = 0;
  }

  /** For the HUD: lane fill levels 0..1. */
  laneLevel(lane: number): number {
    return this.tokens[lane]! / LANE_BURST[lane]!;
  }

  get noCluster(): number {
    return NO_CLUSTER;
  }

  get scratchColor(): THREE.Color {
    return this.col;
  }
}

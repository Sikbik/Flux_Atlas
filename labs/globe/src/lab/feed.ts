// A fake live event feed with realistic rates, compressible for demos.
//
// At speed 1 it behaves like the real network: one block every ~30 s with a producer, three payees
// known one block ahead (one per tier) and 12 to 18 fluxnode heartbeats; a few mempool
// transactions per minute; nodes joining and leaving now and then; app deployments walking through
// pending, confirmed, installing, spawned; the crawler re-checking hosts every second; and peer
// links coming and going. Speed N compresses time N-fold.

import { Rng } from '../engine/math';
import type { GlobeEngine } from '../engine/GlobeEngine';
import type { NodeRecord, Payee } from '../engine/types';
import { appInstances, type LabData } from './data';
import type { SinkDriver } from './sinkDriver';

const PAYOUT = [0, 1.0, 3.5, 9.0];

export class Feed {
  speed = 1;
  height: number;
  onLog: ((line: string) => void) | null = null;
  private timer = 0;
  private last = 0;
  private readonly rng: Rng;
  private alive: number[] = [];
  private byTier: number[][] = [[], [], [], []];
  private nextId: number;
  private nextLoc: number;
  private nextHost: number;
  private nextPayees: Payee[] = [];
  private accBlock = 0;
  private nextBlockAt = 30;
  private accMempool = 0;
  private accJoin = 0;
  private accLeave = 0;
  private accRisk = 0;
  private accApp = 0;
  private accCrawl = 0;
  private accLink = 0;
  private pending: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private readonly recs = new Map<number, NodeRecord>();
  private lastLinks: [number, number][] = [];

  constructor(
    private readonly engine: GlobeEngine,
    private readonly data: LabData,
    seed = 5,
    /** When set, blocks and next payees go through the effect sink (the path a web app takes) instead of `engine.enqueue`. */
    private readonly driver: SinkDriver | null = null,
  ) {
    this.rng = new Rng(seed);
    this.height = data.tip;
    const c = data.cols;
    for (let i = 0; i < c.ids.length; i++) {
      this.alive.push(c.ids[i]);
      this.byTier[c.tier[i]]?.push(c.ids[i]);
      this.recs.set(c.ids[i], { id: c.ids[i], lat: c.lat[i], lon: c.lon[i], tier: c.tier[i], status: c.status[i], flags: c.flags[i], loc: c.loc[i], host: c.host?.[i] ?? 0 });
    }
    this.nextId = Math.max(...Array.from(c.ids.subarray(0, Math.min(c.ids.length, 100000)))) + 1;
    this.nextLoc = Math.max(...Array.from(c.loc)) + 1;
    this.nextHost = (c.host ? Math.max(...Array.from(c.host)) : 0) + 1;
    // Next block's payees are known from the start.
    this.nextPayees = this.pickPayees();
    // The first block is a little way off, so the moon's ring starts part-filled.
    this.accBlock = 9;
  }

  /** The block clock, 0..1 across a 30 s block interval (the moon's ring). Smooth between ticks. */
  get beat(): number {
    const extra = this.timer ? Math.max(0, (performance.now() - this.last) / 1000) * this.speed : 0;
    return Math.min(1, (this.accBlock + extra) / 30);
  }

  /** Seconds until the next block is expected (the tooltip's ticking line). */
  get nextIn(): number {
    return Math.max(0, 30 - this.beat * 30);
  }

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.tick(), 100);
    this.announce();
  }

  private announce(): void {
    if (this.driver) this.driver.nextPayees(this.height + 1, this.nextPayees);
    else this.engine.enqueue({ type: 'nextPayees', height: this.height + 1, payees: this.nextPayees });
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  setSpeed(s: number): void {
    this.speed = s;
  }

  private log(s: string): void {
    this.onLog?.(s);
  }

  private pickAlive(): number {
    return this.alive[this.rng.int(this.alive.length)];
  }

  private pickPayees(): Payee[] {
    const out: Payee[] = [];
    for (let t = 1; t <= 3; t++) {
      const arr = this.byTier[t];
      if (arr.length === 0) continue;
      out.push({ id: arr[this.rng.int(arr.length)], tier: t, amount: PAYOUT[t] });
    }
    return out;
  }

  /** Fire a block immediately (producer, payees, confirms), then announce the following payees. */
  blockNow(): void {
    if (this.alive.length === 0) return;
    this.accBlock = 0;
    const producer = this.pickAlive();
    const confirms: number[] = [];
    const n = 12 + this.rng.int(7);
    for (let i = 0; i < n; i++) confirms.push(this.pickAlive());
    this.height++;
    const payees = this.nextPayees;
    if (this.driver) this.driver.block({ height: this.height, producer, payees, confirms, time: Date.now() });
    else this.engine.enqueue({ type: 'block', height: this.height, producer, payees, confirms, time: Date.now() });
    this.log(`block ${this.height.toLocaleString('en-US')}  ${n} confirms`);
    this.nextPayees = this.pickPayees();
    this.announce();
  }

  private later(delayMs: number, fn: () => void): void {
    this.pending.push({ at: this.clock + delayMs, fn });
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(2, (now - this.last) / 1000) * this.speed;
    this.last = now;
    this.clock += dt * 1000;
    const r = this.rng;

    // Scheduled follow-ups (app deploy phases)
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at <= this.clock) {
        this.pending[i].fn();
        this.pending.splice(i, 1);
      }
    }

    this.accBlock += dt;
    if (this.accBlock >= this.nextBlockAt) {
      this.accBlock = 0;
      this.nextBlockAt = Math.max(24, 30 * (0.85 + r.next() * 0.3));
      this.blockNow();
    }
    this.accMempool += dt * (4 / 60);
    while (this.accMempool >= 1) {
      this.accMempool -= 1;
      this.engine.enqueue({ type: 'mempool', count: 1, seed: r.int(1e6), time: Date.now() });
    }
    this.accCrawl += dt * 4.5;
    if (this.accCrawl >= 1) {
      const n = Math.floor(this.accCrawl);
      this.accCrawl -= n;
      const ids: number[] = [];
      for (let i = 0; i < n + 2; i++) ids.push(this.pickAlive());
      this.engine.enqueue({ type: 'crawl', ids, time: Date.now() });
    }
    this.accJoin += dt / 45;
    if (this.accJoin >= 1) {
      this.accJoin = 0;
      this.joinNode();
    }
    this.accLeave += dt / 80;
    if (this.accLeave >= 1) {
      this.accLeave = 0;
      this.leaveNode();
    }
    this.accRisk += dt / 110;
    if (this.accRisk >= 1) {
      this.accRisk = 0;
      const id = this.pickAlive();
      this.engine.enqueue({ type: 'nodeStatus', id, status: 5, time: Date.now() });
      this.log(`node ${id} at risk`);
      this.later(9000, () => {
        if (this.recs.has(id)) this.engine.enqueue({ type: 'nodeStatus', id, status: 1, time: Date.now() });
      });
    }
    this.accApp += dt / 90;
    if (this.accApp >= 1) {
      this.accApp = 0;
      this.deployApp();
    }
    this.accLink += dt / 14;
    if (this.accLink >= 1) {
      this.accLink = 0;
      this.churnLink();
    }
  }

  private joinNode(): void {
    const r = this.rng;
    const base = this.recs.get(this.pickAlive());
    if (!base) return;
    const sameLoc = r.next() < 0.6 && Number.isFinite(base.lat);
    const id = this.nextId++;
    const tier = 1 + (r.next() < 0.5 ? 0 : r.next() < 0.48 ? 1 : 2);
    const rec: NodeRecord = {
      id,
      lat: sameLoc ? base.lat : base.lat + r.gauss() * 0.3,
      lon: sameLoc ? base.lon : base.lon + r.gauss() * 0.3,
      tier,
      status: 2,
      flags: 128 | (r.next() < 0.4 ? 16 : 0),
      loc: sameLoc ? base.loc : this.nextLoc++,
      host: this.nextHost++,
    };
    this.recs.set(id, rec);
    this.alive.push(id);
    this.byTier[tier].push(id);
    this.engine.enqueue({ type: 'nodeStarted', node: rec, time: Date.now() });
    this.log(`node ${id} started`);
    // A joiner needs a handful of peers.
    const peers = 6 + r.int(6);
    for (let i = 0; i < peers; i++) {
      const other = this.pickAlive();
      if (other !== id) this.later(1200 + i * 250, () => this.engine.enqueue({ type: 'peerLink', a: id, b: other, op: 'add', time: Date.now() }));
    }
    this.later(7000, () => this.engine.enqueue({ type: 'nodeStatus', id, status: 1, time: Date.now() }));
  }

  private leaveNode(): void {
    if (this.alive.length < 100) return;
    const i = this.rng.int(this.alive.length);
    const id = this.alive[i];
    this.alive.splice(i, 1);
    const rec = this.recs.get(id);
    if (rec) {
      const arr = this.byTier[rec.tier];
      const j = arr.indexOf(id);
      if (j >= 0) arr.splice(j, 1);
      this.recs.delete(id);
    }
    this.engine.enqueue({ type: 'nodeLeft', id, reason: 'expired', time: Date.now() });
    this.log(`node ${id} expired`);
  }

  private deployApp(): void {
    const apps = this.data.apps;
    const r = this.rng;
    const n = 3 + r.int(10);
    const nodes: number[] = [];
    for (let i = 0; i < n; i++) nodes.push(this.pickAlive());
    const name = `deploy${1000 + r.int(9000)}`;
    const t = (ms: number, phase: 'pending' | 'confirmed' | 'installing' | 'spawned', withNodes: boolean): void =>
      this.later(ms, () => {
        this.engine.enqueue({ type: 'appDeploy', app: name, phase, nodes: withNodes ? nodes : undefined, time: Date.now() });
        this.log(`app ${name} ${phase}`);
      });
    t(0, 'pending', false);
    t(4500, 'confirmed', false);
    t(9000, 'installing', true);
    t(17000, 'spawned', true);
    void apps;
    void appInstances;
  }

  private churnLink(): void {
    const r = this.rng;
    if (this.lastLinks.length > 0 && r.next() < 0.45) {
      const [a, b] = this.lastLinks.splice(r.int(this.lastLinks.length), 1)[0];
      this.engine.enqueue({ type: 'peerLink', a, b, op: 'remove', time: Date.now() });
      return;
    }
    const a = this.pickAlive();
    const b = this.pickAlive();
    if (a === b) return;
    this.lastLinks.push([a, b]);
    if (this.lastLinks.length > 40) this.lastLinks.shift();
    this.engine.enqueue({ type: 'peerLink', a, b, op: 'add', time: Date.now() });
  }
}

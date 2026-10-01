// NodeStore: the CPU-side truth for every node on the globe.
//
// Nodes live in numbered slots. A slot is the node's instance index on the GPU, so nothing is
// ever compacted: a departing node keeps its slot while it fades out, then the slot goes onto a
// free list and is reused by the next arrival. Capacity grows in powers of two (rarely).
//
// Co-located nodes share a cluster (one per distinct `loc`). A node's rank inside its cluster is
// assigned on arrival and never changes while it lives, so stacks and fan-outs stay visually
// stable when neighbours come and go.

import { DEG, hash01, nextPow2, TAU } from '../math';
import type { NodeColumns, NodeRecord } from '../types';
import { NodeState } from '../types';

export const NO_CLUSTER = 0xffffffff;
const ALIVE_DEATH = 1e9;

/**
 * Clusters whose centres lie within this arc (about 5 km) of an earlier cluster fan out together.
 * They are one site that the geocoder placed a few blocks apart; two sunflowers drawn on top of
 * each other would put markers on markers. Stacks (spires) stay per cluster, so the global view
 * is untouched.
 */
export const FAN_GROUP_ARC = 5 / 6371;
const FAN_GROUP_COS = Math.cos(FAN_GROUP_ARC);

export interface DirtyRange {
  lo: number;
  hi: number;
}

export class NodeStore {
  capacity = 0;
  /** Slots in use, including free holes below the high-water mark. */
  high = 0;
  /** Nodes that are alive (not fading out). */
  live = 0;
  /** Nodes currently fading out. */
  dying = 0;
  /** Counts selections as they start, so the node layer can time the lock-on of the selected marker. */
  selectionSerial = 0;

  id!: Uint32Array;
  lat!: Float32Array;
  lon!: Float32Array;
  dir!: Float32Array;
  tier!: Uint8Array;
  status!: Uint8Array;
  flags!: Uint8Array;
  state!: Uint8Array;
  locId!: Uint32Array;
  cluster!: Uint32Array;
  rank!: Uint32Array;
  /** Rank in the node's fan group (see `cFan`): the node's place in the shared sunflower. */
  fanRank!: Uint32Array;
  host!: Uint32Array;
  /** 0 free, 1 alive, 2 dying. */
  alive!: Uint8Array;
  birth!: Float32Array;
  death!: Float32Array;
  flash!: Float32Array; // t0, amp per slot
  pos!: Float32Array; // x, y, z, dim per slot (display position)
  /** Random per-node phase for ambient shimmer. */
  seed!: Float32Array;

  // clusters
  clusterCount = 0;
  cCapacity = 0;
  cLoc!: Uint32Array;
  cDir!: Float32Array;
  cLat!: Float32Array;
  cLon!: Float32Array;
  /** Live nodes that pass the filter (drives spire height). */
  cPass!: Uint32Array;
  /** Live nodes. */
  cLive!: Uint32Array;
  /** Next rank to assign. */
  cNext!: Uint32Array;
  /** Per-tier live counts: [c*3 + tier-1]. */
  cTier!: Uint32Array;
  /** Cluster state bits: 1 = holds the selection. */
  cFlags!: Uint8Array;
  cRep!: Uint32Array; // a representative live slot
  /** Fan group of each cluster: the first cluster of its site, whose position and spiral it shares. */
  cFan!: Uint32Array;
  /** Per fan root: next fan rank to assign (the spiral's length). */
  cFanNext!: Uint32Array;
  /** Displayed spire height in globe radii (eased toward its target). */
  cHeight!: Float32Array;

  readonly idToSlot = new Map<number, number>();
  readonly locToCluster = new Map<number, number>();
  private free!: Uint32Array;
  private freeN = 0;

  readonly attrDirty: DirtyRange = { lo: Infinity, hi: -1 };
  readonly timeDirty: DirtyRange = { lo: Infinity, hi: -1 };
  readonly flashDirty: DirtyRange = { lo: Infinity, hi: -1 };
  posDirty = true;
  clustersDirty = true;
  /** Bumped whenever the capacity changes so GPU buffers know to reallocate. */
  capacityVersion = 0;

  constructor(initial = 16384) {
    this.allocate(nextPow2(Math.max(64, initial)));
    this.allocClusters(256);
  }

  private allocate(cap: number): void {
    const grow = <T extends Uint8Array | Uint32Array | Float32Array>(
      old: T | undefined,
      n: number,
      Ctor: { new (n: number): T },
    ): T => {
      const a = new Ctor(n);
      if (old) a.set(old);
      return a;
    };
    const first = this.capacity === 0;
    this.id = grow(this.id, cap, Uint32Array);
    this.lat = grow(this.lat, cap, Float32Array);
    this.lon = grow(this.lon, cap, Float32Array);
    this.dir = grow(this.dir, cap * 3, Float32Array);
    this.tier = grow(this.tier, cap, Uint8Array);
    this.status = grow(this.status, cap, Uint8Array);
    this.flags = grow(this.flags, cap, Uint8Array);
    this.state = grow(this.state, cap, Uint8Array);
    this.locId = grow(this.locId, cap, Uint32Array);
    this.cluster = grow(this.cluster, cap, Uint32Array);
    this.rank = grow(this.rank, cap, Uint32Array);
    this.fanRank = grow(this.fanRank, cap, Uint32Array);
    this.host = grow(this.host, cap, Uint32Array);
    this.alive = grow(this.alive, cap, Uint8Array);
    this.birth = grow(this.birth, cap, Float32Array);
    this.death = grow(this.death, cap, Float32Array);
    this.flash = grow(this.flash, cap * 2, Float32Array);
    this.pos = grow(this.pos, cap * 4, Float32Array);
    this.seed = grow(this.seed, cap, Float32Array);
    this.free = grow(this.free, cap, Uint32Array);
    if (first) this.death.fill(ALIVE_DEATH);
    else this.death.fill(ALIVE_DEATH, this.capacity);
    this.capacity = cap;
    this.capacityVersion++;
  }

  private allocClusters(cap: number): void {
    const grow = <T extends Uint8Array | Uint32Array | Float32Array>(
      old: T | undefined,
      n: number,
      Ctor: { new (n: number): T },
    ): T => {
      const a = new Ctor(n);
      if (old) a.set(old);
      return a;
    };
    this.cLoc = grow(this.cLoc, cap, Uint32Array);
    this.cDir = grow(this.cDir, cap * 3, Float32Array);
    this.cLat = grow(this.cLat, cap, Float32Array);
    this.cLon = grow(this.cLon, cap, Float32Array);
    this.cPass = grow(this.cPass, cap, Uint32Array);
    this.cLive = grow(this.cLive, cap, Uint32Array);
    this.cNext = grow(this.cNext, cap, Uint32Array);
    this.cTier = grow(this.cTier, cap * 3, Uint32Array);
    this.cFlags = grow(this.cFlags, cap, Uint8Array);
    this.cRep = grow(this.cRep, cap, Uint32Array);
    this.cFan = grow(this.cFan, cap, Uint32Array);
    this.cFanNext = grow(this.cFanNext, cap, Uint32Array);
    this.cHeight = grow(this.cHeight, cap, Float32Array);
    this.cCapacity = cap;
  }

  // ---- dirty tracking ---------------------------------------------------------------------

  private mark(r: DirtyRange, slot: number): void {
    if (slot < r.lo) r.lo = slot;
    if (slot > r.hi) r.hi = slot;
  }
  markAttr(slot: number): void {
    this.mark(this.attrDirty, slot);
  }
  markTime(slot: number): void {
    this.mark(this.timeDirty, slot);
  }
  markFlash(slot: number): void {
    this.mark(this.flashDirty, slot);
  }
  static clear(r: DirtyRange): void {
    r.lo = Infinity;
    r.hi = -1;
  }

  // ---- lifecycle --------------------------------------------------------------------------

  clear(): void {
    this.high = 0;
    this.live = 0;
    this.dying = 0;
    this.freeN = 0;
    this.alive.fill(0);
    this.death.fill(ALIVE_DEATH);
    this.state.fill(0);
    this.idToSlot.clear();
    this.locToCluster.clear();
    this.clusterCount = 0;
    this.cLive.fill(0);
    this.cNext.fill(0);
    this.cFanNext.fill(0);
    this.cPass.fill(0);
    this.cTier.fill(0);
    this.cFlags.fill(0);
    this.posDirty = true;
    this.clustersDirty = true;
    this.mark(this.attrDirty, 0);
    this.mark(this.attrDirty, this.capacity - 1);
    this.mark(this.timeDirty, 0);
    this.mark(this.timeDirty, this.capacity - 1);
  }

  private clusterFor(loc: number, lat: number, lon: number): number {
    let c = this.locToCluster.get(loc);
    if (c !== undefined) return c;
    if (this.clusterCount >= this.cCapacity) this.allocClusters(this.cCapacity * 2);
    c = this.clusterCount++;
    this.locToCluster.set(loc, c);
    this.cLoc[c] = loc;
    this.cLat[c] = lat;
    this.cLon[c] = lon;
    const la = lat * DEG;
    const lo = lon * DEG;
    const cl = Math.cos(la);
    const dx = cl * Math.sin(lo);
    const dy = Math.sin(la);
    const dz = cl * Math.cos(lo);
    this.cDir[c * 3] = dx;
    this.cDir[c * 3 + 1] = dy;
    this.cDir[c * 3 + 2] = dz;
    // Join the fan of the first earlier cluster of the same site, if there is one.
    let root = c;
    for (let j = 0; j < c; j++) {
      if (Math.abs(this.cLat[j]! - lat) > 0.1) continue;
      const dot = this.cDir[j * 3]! * dx + this.cDir[j * 3 + 1]! * dy + this.cDir[j * 3 + 2]! * dz;
      if (dot >= FAN_GROUP_COS) {
        root = this.cFan[j]!;
        break;
      }
    }
    this.cFan[c] = root;
    if (root === c) this.cFanNext[c] = 0;
    this.cLive[c] = 0;
    this.cNext[c] = 0;
    this.cPass[c] = 0;
    this.cFlags[c] = 0;
    this.cHeight[c] = 0;
    this.clustersDirty = true;
    return c;
  }

  /** Reserve a slot (reuse a free one or extend the high-water mark). */
  private takeSlot(): number {
    if (this.freeN > 0) return this.free[--this.freeN]!;
    if (this.high >= this.capacity) this.allocate(this.capacity * 2);
    return this.high++;
  }

  /**
   * Adds one node. `spawnAt` is the engine time its appearance animation starts (use a value far in
   * the past for no animation). Returns the slot, or -1 if the id already exists.
   */
  add(rec: NodeRecord, spawnAt: number): number {
    if (this.idToSlot.has(rec.id)) return -1;
    const s = this.takeSlot();
    this.id[s] = rec.id;
    this.idToSlot.set(rec.id, s);
    this.tier[s] = rec.tier;
    this.status[s] = rec.status;
    this.flags[s] = rec.flags;
    this.state[s] = 0;
    this.host[s] = rec.host ?? 0;
    this.locId[s] = rec.loc;
    this.birth[s] = spawnAt;
    this.death[s] = ALIVE_DEATH;
    this.flash[s * 2] = -1e9;
    this.flash[s * 2 + 1] = 0;
    this.seed[s] = hash01(rec.id * 2654435761);
    this.alive[s] = 1;
    this.live++;
    const located = Number.isFinite(rec.lat) && Number.isFinite(rec.lon);
    if (located) {
      this.lat[s] = rec.lat;
      this.lon[s] = rec.lon;
      const la = rec.lat * DEG;
      const lo = rec.lon * DEG;
      const cl = Math.cos(la);
      this.dir[s * 3] = cl * Math.sin(lo);
      this.dir[s * 3 + 1] = Math.sin(la);
      this.dir[s * 3 + 2] = cl * Math.cos(lo);
      const c = this.clusterFor(rec.loc, rec.lat, rec.lon);
      this.cluster[s] = c;
      this.rank[s] = this.cNext[c]!++;
      this.fanRank[s] = this.cFanNext[this.cFan[c]!]!++;
      this.cLive[c]!++;
      this.cPass[c]!++;
      if (rec.tier >= 1 && rec.tier <= 3) this.cTier[c * 3 + rec.tier - 1]!++;
      if (this.cLive[c] === 1) this.cRep[c] = s;
    } else {
      // Unlocated: an orbital belt around the planet, placed by hash so it is stable.
      this.lat[s] = NaN;
      this.lon[s] = NaN;
      const a = hash01(rec.id * 40503 + 17) * TAU;
      const tilt = 0.32;
      const bx = Math.cos(a);
      const bz = Math.sin(a);
      // Ring in a plane tilted about the X axis.
      this.dir[s * 3] = bx;
      this.dir[s * 3 + 1] = bz * Math.sin(tilt);
      this.dir[s * 3 + 2] = bz * Math.cos(tilt);
      this.cluster[s] = NO_CLUSTER;
      this.rank[s] = 0;
      this.fanRank[s] = 0;
    }
    this.posDirty = true;
    this.clustersDirty = true;
    this.markAttr(s);
    this.markTime(s);
    this.markFlash(s);
    return s;
  }

  /** Bulk load of columns. Ranks inside each cluster are ordered by host, then by input order. */
  addColumns(cols: NodeColumns, spawnAt: number, startIdx = 0, endIdx = cols.ids.length): void {
    const n = endIdx - startIdx;
    // First pass: add nodes (ranks assigned in arrival order).
    const slots = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const k = startIdx + i;
      slots[i] = this.add(
        {
          id: cols.ids[k]!,
          lat: cols.lat[k]!,
          lon: cols.lon[k]!,
          tier: cols.tier[k]!,
          status: cols.status[k]!,
          flags: cols.flags[k]!,
          loc: cols.loc[k]!,
          host: cols.host ? cols.host[k] : 0,
        },
        spawnAt,
      ) as number;
    }
    if (cols.host) this.reorderByHost(slots);
  }

  /** Re-rank nodes inside clusters so that nodes of one host sit next to each other. */
  private reorderByHost(slots: Uint32Array): void {
    const byCluster = new Map<number, number[]>();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      if (s === 0xffffffff || this.cluster[s] === NO_CLUSTER) continue;
      const c = this.cluster[s]!;
      let list = byCluster.get(c);
      if (!list) {
        list = [];
        byCluster.set(c, list);
      }
      list.push(s);
    }
    for (const [c, list] of byCluster) {
      if (list.length < 2) continue;
      const base = this.cNext[c]! - list.length; // ranks were assigned sequentially from here
      const ordered = list.slice().sort((a, b) => this.host[a]! - this.host[b]! || a - b);
      for (let r = 0; r < ordered.length; r++) this.rank[ordered[r]!] = base + r;
    }
    // The same for the shared fan: a host's nodes are neighbours in the sunflower, whatever cluster they are in.
    const byFan = new Map<number, number[]>();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      if (s === 0xffffffff || this.cluster[s] === NO_CLUSTER) continue;
      const g = this.cFan[this.cluster[s]!]!;
      let list = byFan.get(g);
      if (!list) {
        list = [];
        byFan.set(g, list);
      }
      list.push(s);
    }
    for (const [g, list] of byFan) {
      if (list.length < 2) continue;
      const base = this.cFanNext[g]! - list.length;
      const ordered = list.slice().sort((a, b) => this.host[a]! - this.host[b]! || a - b);
      for (let r = 0; r < ordered.length; r++) this.fanRank[ordered[r]!] = base + r;
    }
  }

  /** Begin removing a node: it keeps its slot and fades out over `fade` seconds starting at `at`. */
  remove(id: number, at: number, fade: number): number {
    const s = this.idToSlot.get(id);
    if (s === undefined || this.alive[s] !== 1) return -1;
    this.alive[s] = 2;
    this.death[s] = at;
    this.live--;
    this.dying++;
    const c = this.cluster[s]!;
    if (c !== NO_CLUSTER) {
      this.cLive[c]!--;
      if ((this.state[s]! & NodeState.Dim) === 0) this.cPass[c]!--;
      const t = this.tier[s]!;
      if (t >= 1 && t <= 3) this.cTier[c * 3 + t - 1]!--;
      if (this.cRep[c] === s) this.cRep[c] = this.findRep(c);
    }
    this.markTime(s);
    this.clustersDirty = true;
    this.posDirty = true;
    void fade;
    return s;
  }

  /** Bring a fading node back to life (it rejoined before its slot was reaped). */
  revive(slot: number, at: number): boolean {
    if (this.alive[slot] !== 2) return false;
    this.alive[slot] = 1;
    this.death[slot] = ALIVE_DEATH;
    this.birth[slot] = at;
    this.dying--;
    this.live++;
    const c = this.cluster[slot]!;
    if (c !== NO_CLUSTER) {
      this.cLive[c]!++;
      if ((this.state[slot]! & NodeState.Dim) === 0) this.cPass[c]!++;
      const t = this.tier[slot]!;
      if (t >= 1 && t <= 3) this.cTier[c * 3 + t - 1]!++;
    }
    this.markTime(slot);
    this.clustersDirty = true;
    this.posDirty = true;
    return true;
  }

  private findRep(c: number): number {
    for (let s = 0; s < this.high; s++) if (this.alive[s] === 1 && this.cluster[s] === c) return s;
    return 0;
  }

  /** Finish nodes whose fade-out completed: free the slot and forget the id. Returns the number freed. */
  reap(time: number, fade: number): number {
    if (this.dying === 0) return 0;
    let freed = 0;
    for (let s = 0; s < this.high; s++) {
      if (this.alive[s] === 2 && time - this.death[s]! > fade) {
        this.alive[s] = 0;
        this.idToSlot.delete(this.id[s]!);
        this.id[s] = 0;
        this.death[s] = ALIVE_DEATH;
        this.state[s] = 0;
        this.free[this.freeN++] = s;
        this.dying--;
        freed++;
        this.markTime(s);
        this.markAttr(s);
      }
    }
    // Trim the high-water mark.
    while (this.high > 0 && this.alive[this.high - 1] === 0) {
      // Remove trailing free slots from the free list lazily: rebuild it.
      this.high--;
    }
    if (freed > 0) this.rebuildFree();
    return freed;
  }

  private rebuildFree(): void {
    this.freeN = 0;
    for (let s = 0; s < this.high; s++) if (this.alive[s] === 0) this.free[this.freeN++] = s;
  }

  slotOf(id: number): number {
    const s = this.idToSlot.get(id);
    return s === undefined ? -1 : s;
  }

  /** Nearest live slot with this state bit, for convenience. */
  setState(slot: number, bit: number, on: boolean): void {
    const cur = this.state[slot]!;
    const next = on ? cur | bit : cur & ~bit;
    if (next !== cur) {
      this.state[slot] = next;
      this.markAttr(slot);
      if (on && (bit & NodeState.Selected) !== 0) this.selectionSerial++;
    }
  }

  get aliveCount(): number {
    return this.live + this.dying;
  }
}

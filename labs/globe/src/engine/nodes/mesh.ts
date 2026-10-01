// MeshStore: the P2P topology. Edges are undirected pairs of node ids kept in flat arrays with a
// free list, so streaming deltas (a link appearing, a link vanishing) cost O(1). A lazily built
// CSR adjacency (by node slot) serves neighbour lookups for selection and gossip propagation.
//
// Ids must be below 2^21 so the pair key stays an exact JS integer.

import type { NodeStore } from './store';

const KEY_MUL = 4294967296;

export class MeshStore {
  cap = 1024;
  /** Edge endpoints as node ids. */
  ida = new Uint32Array(this.cap);
  idb = new Uint32Array(this.cap);
  /** Endpoint slots (resolved lazily; validated against ids at use). */
  sa = new Uint32Array(this.cap);
  sb = new Uint32Array(this.cap);
  /** 1 = live edge. */
  alive = new Uint8Array(this.cap);
  /** 1 when the connection was dialed by the lower id (`ida` is the outbound side). */
  fwd = new Uint8Array(this.cap);
  /** Ribbon pool index of the faint link, or -1. */
  link = new Int32Array(this.cap).fill(-1);
  /** Start time of that ribbon (guards against the pool reusing the index). */
  linkStart = new Float32Array(this.cap);
  high = 0;
  live = 0;
  private free: number[] = [];
  private readonly map = new Map<number, number>();

  // CSR adjacency by slot (grow-only buffers, rebuilt in place)
  private adjOffsets = new Uint32Array(1);
  private adjList = new Uint32Array(0);
  private adjEdge = new Uint32Array(0);
  private adjN = 0;
  private adjAt = -1e9;
  adjDirty = true;
  resolveDirty = true;
  version = 0;

  private static key(a: number, b: number): number {
    return a < b ? a * KEY_MUL + b : b * KEY_MUL + a;
  }

  private grow(): void {
    const n = this.cap * 2;
    const g = <T extends Uint8Array | Uint32Array | Int32Array>(old: T, Ctor: { new (n: number): T }): T => {
      const a = new Ctor(n);
      a.set(old);
      return a;
    };
    this.ida = g(this.ida, Uint32Array);
    this.idb = g(this.idb, Uint32Array);
    this.sa = g(this.sa, Uint32Array);
    this.sb = g(this.sb, Uint32Array);
    this.alive = g(this.alive, Uint8Array);
    this.fwd = g(this.fwd, Uint8Array);
    const l = new Int32Array(n).fill(-1);
    l.set(this.link);
    this.link = l;
    const ls = new Float32Array(n);
    ls.set(this.linkStart);
    this.linkStart = ls;
    this.cap = n;
  }

  clear(): void {
    this.high = 0;
    this.live = 0;
    this.free.length = 0;
    this.map.clear();
    this.alive.fill(0);
    this.link.fill(-1);
    this.linkStart.fill(0);
    this.adjDirty = true;
    this.resolveDirty = true;
    this.version++;
  }

  /** Adds an edge. Returns its index, or -1 if it already exists or is degenerate. */
  add(a: number, b: number): number {
    if (a === b || a === 0 || b === 0) return -1;
    const k = MeshStore.key(a, b);
    if (this.map.has(k)) return -1;
    let e: number;
    if (this.free.length > 0) e = this.free.pop() as number;
    else {
      if (this.high >= this.cap) this.grow();
      e = this.high++;
    }
    this.ida[e] = a < b ? a : b;
    this.idb[e] = a < b ? b : a;
    this.fwd[e] = a < b ? 1 : 0;
    this.alive[e] = 1;
    this.link[e] = -1;
    this.map.set(k, e);
    this.live++;
    this.adjDirty = true;
    this.resolveDirty = true;
    this.version++;
    return e;
  }

  /** Removes an edge by node ids. Returns its index (so the caller can retire the ribbon) or -1. */
  remove(a: number, b: number): number {
    const k = MeshStore.key(a, b);
    const e = this.map.get(k);
    if (e === undefined) return -1;
    this.map.delete(k);
    this.alive[e] = 0;
    this.free.push(e);
    this.live--;
    this.adjDirty = true;
    this.version++;
    return e;
  }

  has(a: number, b: number): boolean {
    return this.map.has(MeshStore.key(a, b));
  }

  /** The edge's index, or -1. */
  find(a: number, b: number): number {
    return this.map.get(MeshStore.key(a, b)) ?? -1;
  }

  /** Kill every edge touching a node (it left). Returns how many were removed. */
  removeNode(id: number, onRemoved?: (e: number) => void): number {
    let n = 0;
    for (let e = 0; e < this.high; e++) {
      if (this.alive[e] && (this.ida[e] === id || this.idb[e] === id)) {
        this.map.delete(MeshStore.key(this.ida[e], this.idb[e]));
        this.alive[e] = 0;
        this.free.push(e);
        this.live--;
        n++;
        onRemoved?.(e);
      }
    }
    if (n > 0) {
      this.adjDirty = true;
      this.version++;
    }
    return n;
  }

  /** Re-resolve endpoint slots from the node store. Edges with a missing endpoint are skipped at use. */
  resolve(nodes: NodeStore): void {
    if (!this.resolveDirty) return;
    for (let e = 0; e < this.high; e++) {
      if (!this.alive[e]) continue;
      const a = nodes.idToSlot.get(this.ida[e]);
      const b = nodes.idToSlot.get(this.idb[e]);
      this.sa[e] = a === undefined ? 0xffffffff : a;
      this.sb[e] = b === undefined ? 0xffffffff : b;
    }
    this.resolveDirty = false;
  }

  /**
   * Builds CSR adjacency over the node slots, reusing its buffers. `maxAgeMs` lets callers that can
   * live with slightly stale adjacency (gossip, traffic) skip rebuilds while links stream in.
   */
  buildAdjacency(nodes: NodeStore, maxAgeMs = 0): void {
    if (!this.adjDirty) return;
    const now = performance.now();
    if (maxAgeMs > 0 && now - this.adjAt < maxAgeMs && this.adjN > 0) return;
    this.resolve(nodes);
    const n = nodes.high;
    if (this.adjOffsets.length < n + 1) this.adjOffsets = new Uint32Array(Math.max(n + 1, this.adjOffsets.length * 2));
    const off = this.adjOffsets;
    off.fill(0, 0, n + 1);
    for (let e = 0; e < this.high; e++) {
      if (!this.alive[e]) continue;
      const a = this.sa[e];
      const b = this.sb[e];
      if (a === 0xffffffff || b === 0xffffffff || a >= n || b >= n) continue;
      off[a + 1]++;
      off[b + 1]++;
    }
    for (let i = 0; i < n; i++) off[i + 1] += off[i];
    const total = off[n];
    if (this.adjList.length < total) {
      const cap = Math.max(total, this.adjList.length * 2, 1024);
      this.adjList = new Uint32Array(cap);
      this.adjEdge = new Uint32Array(cap);
    }
    const list = this.adjList;
    const edge = this.adjEdge;
    // Fill using `off` as write cursors, then shift back. Avoids a scratch copy of the offsets.
    for (let e = 0; e < this.high; e++) {
      if (!this.alive[e]) continue;
      const a = this.sa[e];
      const b = this.sb[e];
      if (a === 0xffffffff || b === 0xffffffff || a >= n || b >= n) continue;
      list[off[a]] = b;
      edge[off[a]++] = e;
      list[off[b]] = a;
      edge[off[b]++] = e;
    }
    for (let i = n; i > 0; i--) off[i] = off[i - 1];
    off[0] = 0;
    this.adjN = n;
    this.adjAt = now;
    this.adjDirty = false;
  }

  /** Neighbour slots of `slot` as [start, end) into `neighbours`. */
  range(slot: number): [number, number] {
    if (slot + 1 > this.adjN) return [0, 0];
    return [this.adjOffsets[slot], this.adjOffsets[slot + 1]];
  }
  get neighbours(): Uint32Array {
    return this.adjList;
  }
  get neighbourEdges(): Uint32Array {
    return this.adjEdge;
  }
  /** Is edge `e` dialed by `slot` (outbound from the point of view of that node)? */
  isOutbound(e: number, slot: number): boolean {
    return this.sa[e] === slot ? this.fwd[e] === 1 : this.fwd[e] === 0;
  }
  degree(slot: number): number {
    if (slot + 1 > this.adjN) return 0;
    return this.adjOffsets[slot + 1] - this.adjOffsets[slot];
  }
}

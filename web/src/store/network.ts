// NetworkStore: the live model of the Flux network, outside React.
//
// - nodes: a columnar NodeTable (typed arrays from nodes.bin, patched in place by `nodes` deltas)
// - mesh: undirected edges, patched by `mesh` deltas
// - rings: the latest blocks (100) and feed items (500)
// - mempool, next payees, pending apps and installs, apps index, summary, tier stats, price,
//   freshness, and connection state
//
// Every mutation bumps the global `version` and the version of the slice it touched, then notifies
// subscribers once per batch with a change set. The globe subscribes directly (`subscribe`); React
// reads through selectors (`store/react.ts`). Applying live messages is allocation-light: a block
// with ~20 child events or a 6.7k-row reconcile delta stays well under a frame (see the benchmark).

import type { SnapshotOrigin } from '../api/bin/container';
import type { AppIndexEntry } from '../api/generated/AppIndexEntry';
import type { AppMessageKind } from '../api/generated/AppMessageKind';
import type { AppsDelta } from '../api/generated/AppsDelta';
import type { BlockLite } from '../api/generated/BlockLite';
import type { BlockMsg } from '../api/generated/BlockMsg';
import type { BootstrapDto } from '../api/generated/BootstrapDto';
import type { FeedItem } from '../api/generated/FeedItem';
import type { JobFreshness } from '../api/generated/JobFreshness';
import type { LiveMsg } from '../api/generated/LiveMsg';
import type { MempoolDto } from '../api/generated/MempoolDto';
import type { MeshDelta } from '../api/generated/MeshDelta';
import type { NetworkSummary } from '../api/generated/NetworkSummary';
import type { NextPayeesMsg } from '../api/generated/NextPayeesMsg';
import type { NodeChange } from '../api/generated/NodeChange';
import type { NodesDelta } from '../api/generated/NodesDelta';
import type { PayoutDto } from '../api/generated/PayoutDto';
import type { PriceInfo } from '../api/generated/PriceInfo';
import type { ServerInfo } from '../api/generated/ServerInfo';
import type { TierStats } from '../api/generated/TierStats';
import type { TipInfo } from '../api/generated/TipInfo';
import type { TxLite } from '../api/generated/TxLite';
import type { MeshBin } from '../api/meshBin';
import { NodeFlag, type NodesBin, statusCode } from '../api/nodesBin';
import { NodeField, NodeTable } from './nodeTable';
import { Ring } from './ring';

export { NodeField, NodeTable } from './nodeTable';

/** Slice bits used in change sets and `versions`. */
export const Slice = {
  Nodes: 1 << 0,
  Mesh: 1 << 1,
  Blocks: 1 << 2,
  Feed: 1 << 3,
  Mempool: 1 << 4,
  NextPayees: 1 << 5,
  Pending: 1 << 6,
  Apps: 1 << 7,
  Summary: 1 << 8,
  Price: 1 << 9,
  Freshness: 1 << 10,
  Connection: 1 << 11,
  Tip: 1 << 12,
} as const;
export type SliceName = keyof typeof Slice;

export const BLOCK_RING = 100;
export const FEED_RING = 500;
export const MEMPOOL_CAP = 5_000;
export const MEMPOOL_TTL_MS = 20 * 60_000;
/** Resolved pending apps stay visible this long ("Not mined" is an end state, not a disappearance). */
export const PENDING_RESOLVED_TTL_MS = 10 * 60_000;
export const INSTALLING_TTL_MS = 15 * 60_000;
/** `recently_paid` flag window (codec README: paid within the last 10 blocks). */
export const RECENTLY_PAID_BLOCKS = 10;

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'closed';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Local ms when `status` last changed. */
  sinceMs: number;
  /** Local ms of the next reconnect attempt while `reconnecting`. */
  retryAtMs: number | null;
  attempt: number;
  lastCloseCode: number | null;
  lastError: string | null;
  server: ServerInfo | null;
  /** Server-to-browser delivery latency (EMA, ms): receipt minus `observed_ms`. */
  transitMs: number | null;
  /** Upstream-to-server detection latency (EMA, ms): `observed_ms` minus `event_ms`. */
  ingestMs: number | null;
  /** Server clock minus local clock, ms. */
  clockOffsetMs: number;
}

/** A block as kept in the ring: bootstrap rows and live `block` messages normalized. */
export interface ChainBlock {
  height: number;
  hash: string;
  timeMs: number;
  size: number;
  txCount: number;
  producer: number | null;
  payouts: readonly PayoutDto[];
  reward: string;
  fees: string;
  devFund: string | null;
  confirmCount: number;
  startCount: number;
  transferCount: number;
  /** Server observation time (live blocks only). */
  observedMs: number | null;
  /** True when it arrived over the WebSocket (false for bootstrap rows). */
  live: boolean;
}

export interface FeedEntry {
  seq: number;
  observedMs: number;
  item: FeedItem;
}

export interface MempoolEntry {
  tx: TxLite;
  firstSeenMs: number;
}

export interface PendingApp {
  hash: string;
  app: string;
  kind: AppMessageKind;
  receivedMs: number;
  expiresMs: number;
  state: 'pending' | 'mined' | 'expired';
  resolvedMs: number | null;
}

export interface InstallingEntry {
  app: string;
  node: number | null;
  endpoint: string;
  sinceMs: number;
}

export interface NextPayees extends NextPayeesMsg {
  receivedMs: number;
}

/** What changed in one notification. */
export interface StoreChange {
  version: number;
  slices: number;
  /** Node detail (only when `slices & Slice.Nodes`). */
  nodes: NodeChangeSet | null;
  /** Mesh detail (only when `slices & Slice.Mesh`). */
  mesh: MeshChangeSet | null;
}

export interface NodeChangeSet {
  /** True when rows were added, removed or the table was reloaded: row indices moved. */
  structural: boolean;
  reloaded: boolean;
  added: number[];
  removed: number[];
  /** Ids whose fields changed (deduplication is not guaranteed). */
  changed: number[];
  /** Union of `NodeField` bits over `changed`. */
  fields: number;
}

export interface MeshChangeSet {
  reloaded: boolean;
  added: [number, number][];
  removed: [number, number][];
}

export type GapTopic = 'nodes' | 'apps';

export interface NetworkStoreOptions {
  /** Called when a delta's `prev_seq` shows a gap; the live client answers with a resync. */
  onGap?: (topic: GapTopic, detail: { expected: number | null; prevSeq: number; seq: number }) => void;
  now?: () => number;
}

const EDGE_SHIFT = 2 ** 32;
const edgeKey = (a: number, b: number) => (a < b ? a * EDGE_SHIFT + b : b * EDGE_SHIFT + a);

type Listener = (change: StoreChange) => void;

export class NetworkStore {
  readonly nodes = new NodeTable();
  readonly blocks = new Ring<ChainBlock>(BLOCK_RING);
  readonly feed = new Ring<FeedEntry>(FEED_RING);
  readonly mempool = new Map<string, MempoolEntry>();
  readonly pendingApps = new Map<string, PendingApp>();
  readonly installing = new Map<string, InstallingEntry>();
  readonly apps = new Map<string, AppIndexEntry>();
  /** Mesh edges keyed `a * 2^32 + b` (a < b) to flags. */
  readonly mesh = new Map<number, number>();

  summary: NetworkSummary | null = null;
  tierStats: readonly TierStats[] = [];
  price: PriceInfo | null = null;
  tip: TipInfo | null = null;
  nextPayees: NextPayees | null = null;
  /** Seq of the bootstrap or live message `nextPayees` came from. */
  private nextPayeesSeq = 0;
  /** Highest `feed` seq pushed to the ring. */
  private feedSeq = 0;
  /** Origin (`instance/started_ms`) the seq marks above belong to (seqs restart with the server). */
  private seqServer: string | null = null;
  freshness: ReadonlyMap<string, JobFreshness> = new Map();
  server: ServerInfo | null = null;
  /** True while the server serves restored state (upstream stale). */
  stale = false;
  connection: ConnectionState = {
    status: 'idle',
    sinceMs: 0,
    retryAtMs: null,
    attempt: 0,
    lastCloseCode: null,
    lastError: null,
    server: null,
    transitMs: null,
    ingestMs: null,
    clockOffsetMs: 0,
  };

  /** Latest live seq applied (resume point for `since_seq`). */
  seq = 0;
  /** Seq of the bootstrap body loaded. */
  bootstrapSeq = 0;
  meshSnapshotSeq = 0;
  /** Seq of the last applied `nodes` / `apps` message (null until the first after a snapshot). */
  lastNodesMsgSeq: number | null = null;
  lastAppsMsgSeq: number | null = null;
  /** Local receipt time of the last message per type (freshness chips). */
  readonly lastMessageMs = new Map<LiveMsg['t'], number>();
  loaded = false;
  /** Bumps with every snapshot load: node ids are re-resolved from stable keys after each. */
  snapshotGen = 0;
  /** Snapshot loads that switched to another instance (other node ids: every id cache is stale). */
  instanceSwitches = 0;

  version = 0;
  readonly versions: Record<SliceName, number> = {
    Nodes: 0,
    Mesh: 0,
    Blocks: 0,
    Feed: 0,
    Mempool: 0,
    NextPayees: 0,
    Pending: 0,
    Apps: 0,
    Summary: 0,
    Price: 0,
    Freshness: 0,
    Connection: 0,
    Tip: 0,
  };
  /** Counters for diagnostics (/dev/live). */
  readonly stats = { applied: 0, skippedStale: 0, gaps: 0 };

  private readonly listeners = new Set<Listener>();
  private readonly opts: NetworkStoreOptions;
  private batchDepth = 0;
  private pendingSlices = 0;
  private pendingNodes: NodeChangeSet | null = null;
  private pendingMesh: MeshChangeSet | null = null;
  private meshArrays: { version: number; a: Uint32Array; b: Uint32Array; flags: Uint8Array } | null = null;
  private pendingArray: { version: number; list: PendingApp[] } | null = null;
  private mempoolArray: { version: number; list: MempoolEntry[] } | null = null;
  private appsArray: { version: number; list: AppIndexEntry[] } | null = null;

  constructor(opts: NetworkStoreOptions = {}) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  // -------------------------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------------------------

  /** Raw subscription (the globe engine). Returns an unsubscribe function. */
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Groups mutations into one notification. */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
  }

  private touch(slices: number): void {
    this.pendingSlices |= slices;
    for (const [name, bit] of Object.entries(Slice) as [SliceName, number][]) {
      if (slices & bit) this.versions[name]++;
    }
    if (this.batchDepth === 0) this.flush();
  }

  private nodeChanges(): NodeChangeSet {
    if (!this.pendingNodes) {
      this.pendingNodes = {
        structural: false,
        reloaded: false,
        added: [],
        removed: [],
        changed: [],
        fields: 0,
      };
    }
    return this.pendingNodes;
  }

  private meshChanges(): MeshChangeSet {
    if (!this.pendingMesh) this.pendingMesh = { reloaded: false, added: [], removed: [] };
    return this.pendingMesh;
  }

  private flush(): void {
    if (this.pendingSlices === 0) return;
    this.version++;
    const change: StoreChange = {
      version: this.version,
      slices: this.pendingSlices,
      nodes: this.pendingSlices & Slice.Nodes ? this.pendingNodes : null,
      mesh: this.pendingSlices & Slice.Mesh ? this.pendingMesh : null,
    };
    this.pendingSlices = 0;
    this.pendingNodes = null;
    this.pendingMesh = null;
    for (const fn of [...this.listeners]) fn(change);
  }

  // -------------------------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------------------------

  /**
   * Loads a fresh snapshot (boot or resync). The bodies must share one origin (the caller checks
   * with `snapshotOriginError`). `nodes`, `mesh` and `bootstrap` may have been built at different
   * seqs; each slice remembers its own and skips older deltas, and the resume point is the lowest
   * seq whose snapshot still needs the stream (ARCHITECTURE 8.1):
   * `min(bootstrap.seq, nodes.seq, M)`, where M is the mesh seq when it is below the bootstrap's
   * `mesh_seq` (the mesh body misses edge changes the replay must bring).
   *
   * `mesh: null` means the server has no mesh (404): the mesh loads empty. Left out, the mesh is
   * kept (unless the instance changed). A snapshot of another instance (`server.instance`) drops
   * everything keyed by node id first: ids are assigned per data directory, so they mean other
   * nodes there. A restart of the same instance (`started_ms` only) keeps its ids (ARCHITECTURE
   * 3.3) and resets the seq marks, since seqs restart with the process.
   */
  loadSnapshot(s: { bootstrap: BootstrapDto; nodes: NodesBin; mesh?: MeshBin | null }): void {
    this.batch(() => {
      const switched = this.loaded && (this.server?.instance ?? '') !== (s.bootstrap.server.instance ?? '');
      if (switched) this.dropOriginState();
      this.nodes.load(s.nodes);
      this.lastNodesMsgSeq = null;
      this.lastAppsMsgSeq = null;
      const nc = this.nodeChanges();
      nc.structural = true;
      nc.reloaded = true;
      this.applyBootstrap(s.bootstrap);
      if (s.mesh) this.loadMesh(s.mesh);
      else if (s.mesh === null || switched) this.loadEmptyMesh();
      this.seq = resumeSeq(s.bootstrap, s.nodes, s.mesh ?? null);
      this.loaded = true;
      this.snapshotGen++;
      this.touch(Slice.Nodes);
    });
  }

  /** Forgets what is keyed by node id or live seq of the previous instance. */
  private dropOriginState(): void {
    this.blocks.reset([]);
    this.feed.reset([]);
    this.installing.clear();
    this.nextPayees = null;
    this.nextPayeesSeq = 0;
    this.feedSeq = 0;
    this.seqServer = null;
    this.instanceSwitches++;
    this.touch(Slice.Blocks | Slice.Feed | Slice.Pending | Slice.NextPayees);
  }

  /** Seqs restart with the server: forget the seq marks of an earlier server run. */
  private noteServer(server: ServerInfo): void {
    const key = originKey(server);
    if (this.seqServer === key) return;
    this.seqServer = key;
    this.feedSeq = 0;
    this.nextPayeesSeq = 0;
  }

  private applyBootstrap(b: BootstrapDto): void {
    this.noteServer(b.server);
    this.bootstrapSeq = b.seq;
    this.server = b.server;
    this.stale = b.stale;
    this.summary = b.network;
    this.tierStats = b.tiers;
    if (b.network.price) this.price = b.network.price;
    this.setTip(b.network.tip);
    const live = new Map<number, ChainBlock>();
    for (const blk of this.blocks.toArray()) if (blk.live) live.set(blk.height, blk);
    const rows = [...b.blocks]
      .sort((x, y) => x.height - y.height)
      .map((row) => live.get(row.height) ?? fromBlockLite(row));
    this.blocks.reset(rows);
    this.apps.clear();
    for (const a of b.apps) this.apps.set(a.name, a);
    this.freshness = new Map(b.freshness.map((f) => [f.job, f]));
    let slices = Slice.Blocks | Slice.Apps | Slice.Summary | Slice.Price | Slice.Freshness | Slice.Tip;
    // Seed the next payees so a fresh page shows them before the next block. A live
    // `next_payees` held for a newer height, or for the same height from a later seq, wins.
    const np = b.next_payees;
    const cur = this.nextPayees;
    if (np && (!cur || np.height > cur.height || (np.height === cur.height && b.seq >= this.nextPayeesSeq))) {
      this.nextPayees = { height: np.height, payees: np.payees, receivedMs: b.generated_ms };
      this.nextPayeesSeq = b.seq;
      slices |= Slice.NextPayees;
    }
    this.touch(slices);
  }

  /** Loads the full mesh (mesh.bin). Live `mesh` deltas at or below its seq are skipped. */
  loadMesh(m: MeshBin): void {
    this.mesh.clear();
    for (let i = 0; i < m.count; i++) this.mesh.set(m.a[i]! * EDGE_SHIFT + m.b[i]!, m.flags[i]!);
    this.meshSnapshotSeq = m.seq;
    this.meshChanges().reloaded = true;
    this.meshArrays = null;
    this.touch(Slice.Mesh);
  }

  /** An empty mesh (a server without one); every live delta applies. */
  private loadEmptyMesh(): void {
    this.mesh.clear();
    this.meshSnapshotSeq = 0;
    this.meshChanges().reloaded = true;
    this.meshArrays = null;
    this.touch(Slice.Mesh);
  }

  /** Replaces the mempool with the server's view (`GET /mempool`). */
  setMempool(dto: MempoolDto): void {
    const prev = this.mempool;
    const next = new Map<string, MempoolEntry>();
    for (const tx of dto.txs)
      next.set(tx.txid, { tx, firstSeenMs: prev.get(tx.txid)?.firstSeenMs ?? dto.updated_ms });
    prev.clear();
    for (const [k, v] of next) prev.set(k, v);
    this.touch(Slice.Mempool);
  }

  setConnection(patch: Partial<ConnectionState>): void {
    this.connection = { ...this.connection, ...patch };
    this.touch(Slice.Connection);
  }

  private setTip(tip: TipInfo | null | undefined): boolean {
    if (!tip) return false;
    if (this.tip && tip.height < this.tip.height) return false;
    if (this.tip && tip.height === this.tip.height && tip.hash === this.tip.hash) return false;
    this.tip = tip;
    this.touch(Slice.Tip);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Live messages
  // -------------------------------------------------------------------------------------------

  /** Applies one live message. Control messages (hello, ping, resync) are the client's business. */
  apply(msg: LiveMsg, receivedMs = this.now()): void {
    this.lastMessageMs.set(msg.t, receivedMs);
    this.batch(() => {
      switch (msg.t) {
        case 'block':
          this.applyBlock(msg, msg.seq, msg.observed_ms);
          break;
        case 'reorg':
          this.applyReorg(msg.fork_height);
          break;
        case 'mempool':
          this.applyMempool(msg.txs, receivedMs);
          break;
        case 'nodes':
          this.applyNodes(msg, msg.seq);
          break;
        case 'apps':
          this.applyApps(msg, msg.seq);
          break;
        case 'mesh':
          this.applyMesh(msg, msg.seq);
          break;
        case 'next_payees':
          this.nextPayees = { height: msg.height, payees: msg.payees, receivedMs };
          this.nextPayeesSeq = msg.seq;
          this.touch(Slice.NextPayees);
          break;
        case 'app_pending':
          this.pendingApps.set(msg.hash, {
            hash: msg.hash,
            app: msg.app,
            kind: msg.kind,
            receivedMs: msg.received_ms,
            expiresMs: msg.expires_ms,
            state: 'pending',
            resolvedMs: null,
          });
          this.touch(Slice.Pending);
          break;
        case 'app_pending_resolved': {
          const p = this.pendingApps.get(msg.hash);
          if (p) {
            this.pendingApps.set(msg.hash, {
              ...p,
              state: msg.mined ? 'mined' : 'expired',
              resolvedMs: receivedMs,
            });
            this.touch(Slice.Pending);
          }
          break;
        }
        case 'app_installing':
          this.installing.set(`${msg.app}\u0000${msg.node ?? msg.endpoint}`, {
            app: msg.app,
            node: msg.node,
            endpoint: msg.endpoint,
            sinceMs: receivedMs,
          });
          this.touch(Slice.Pending);
          break;
        case 'stats':
          this.summary = msg.summary;
          if (msg.summary.price) {
            this.price = msg.summary.price;
            this.touch(Slice.Price);
          }
          this.setTip(msg.summary.tip);
          this.touch(Slice.Summary);
          break;
        case 'feed':
          // A resume after a resync replays from the snapshot's seq, the lower of the bootstrap's
          // and nodes.bin's, so it can re-deliver feed items the ring already holds.
          if (msg.seq <= this.feedSeq) break;
          this.feedSeq = msg.seq;
          this.feed.push({
            seq: msg.seq,
            observedMs: msg.observed_ms,
            item: {
              kind: msg.kind,
              ts_ms: msg.ts_ms,
              text_key: msg.text_key,
              refs: msg.refs,
              params: msg.params,
            },
          });
          this.touch(Slice.Feed);
          break;
        case 'hello':
          this.noteServer(msg.server);
          this.server = msg.server;
          this.setTip(msg.tip);
          break;
        case 'resync':
        case 'ping':
          break;
      }
      if (msg.t !== 'hello' && msg.t !== 'resync' && msg.seq > this.seq) this.seq = msg.seq;
      this.stats.applied++;
    });
  }

  /**
   * A block has two parts that snapshots cover at different seqs (ARCHITECTURE 8.1): the block list
   * and choreography (bootstrap) and the node table (nodes.bin: payout rotation, confirms, the
   * recently-paid flag). A replayed block applies only the parts its snapshots do not hold yet, so
   * a payee is never rotated twice when nodes.bin is newer than the bootstrap.
   */
  private applyBlock(m: BlockMsg, seq: number, observedMs: number): void {
    if (seq > this.bootstrapSeq) this.applyBlockToChain(m, observedMs);
    if (seq > this.nodes.snapshotSeq) this.applyBlockToNodes(m);
    else this.stats.skippedStale++;
  }

  private applyBlockToChain(m: BlockMsg, observedMs: number): void {
    const block: ChainBlock = {
      height: m.height,
      hash: m.hash,
      timeMs: m.time_ms,
      size: m.size,
      txCount: m.tx_count,
      producer: m.producer?.id ?? null,
      payouts: m.payouts,
      reward: m.reward,
      fees: m.fees,
      devFund: m.dev_fund,
      confirmCount: m.heartbeats.length + m.confirms.length,
      startCount: m.starts.length,
      transferCount: m.transfers_over_threshold.length,
      observedMs,
      live: true,
    };
    const newest = this.blocks.newest();
    if (!this.blocks.replaceWhere((b) => b.height === m.height, block)) {
      if (!newest || m.height > newest.height) this.blocks.push(block);
    }
    this.setTip({ height: m.height, hash: m.hash, time_ms: m.time_ms, producer: m.producer?.id ?? null });

    // Mempool: transactions first seen before the block's header time were most likely mined.
    // (Heuristic; `setMempool` from GET /mempool reconciles.)
    let pruned = false;
    for (const tx of m.transfers_over_threshold) pruned = this.mempool.delete(tx.txid) || pruned;
    for (const [id, e] of this.mempool) {
      if (e.firstSeenMs <= m.time_ms) {
        this.mempool.delete(id);
        pruned = true;
      }
    }
    if (pruned) this.touch(Slice.Mempool);
    this.touch(Slice.Blocks);
  }

  private applyBlockToNodes(m: BlockMsg): void {
    // Node facts the block states outright (the matching `nodes` delta is idempotent with these).
    const t = this.nodes;
    const nc = this.nodeChanges();
    let touched = false;
    for (const p of m.payouts) {
      if (p.node === null) continue;
      const i = t.indexOf(p.node);
      if (i < 0) continue;
      t.lastPaid[i] = m.height;
      t.flags[i] = t.flags[i]! | NodeFlag.RecentlyPaid;
      nc.changed.push(p.node);
      nc.fields |= NodeField.LastPaid | NodeField.Flags;
      // Rank contract rule 1: the payee moves to the back of its tier queue.
      this.rotateToBack(i, nc);
      touched = true;
    }
    const confirmedCode = statusCode('confirmed');
    for (const list of [m.heartbeats, m.confirms]) {
      for (const id of list) {
        const i = t.indexOf(id);
        if (i < 0) continue;
        t.lastConfirmed[i] = m.height;
        nc.changed.push(id);
        nc.fields |= NodeField.LastConfirmed;
        touched = true;
      }
    }
    for (const id of m.confirms) {
      const i = t.indexOf(id);
      if (i >= 0 && t.status[i] !== confirmedCode) {
        t.status[i] = confirmedCode;
        nc.fields |= NodeField.Status;
      }
    }
    // Age out the recently-paid flag (a linear pass over the flags column; microseconds).
    const cutoff = m.height - RECENTLY_PAID_BLOCKS;
    const flags = t.flags;
    const lastPaid = t.lastPaid;
    for (let i = 0; i < t.count; i++) {
      if (flags[i]! & NodeFlag.RecentlyPaid && lastPaid[i]! < cutoff) {
        flags[i] = flags[i]! & ~NodeFlag.RecentlyPaid;
        nc.changed.push(t.ids[i]!);
        nc.fields |= NodeField.Flags;
        touched = true;
      }
    }
    if (touched) this.touch(Slice.Nodes);
  }

  private applyReorg(forkHeight: number): void {
    const keep = this.blocks
      .toArray()
      .filter((b) => b.height <= forkHeight)
      .reverse();
    this.blocks.reset(keep);
    this.touch(Slice.Blocks);
  }

  private applyMempool(txs: readonly TxLite[], receivedMs: number): void {
    for (const tx of txs)
      if (!this.mempool.has(tx.txid)) this.mempool.set(tx.txid, { tx, firstSeenMs: receivedMs });
    if (this.mempool.size > MEMPOOL_CAP) {
      const drop = this.mempool.size - MEMPOOL_CAP;
      let k = 0;
      for (const id of this.mempool.keys()) {
        if (k++ >= drop) break;
        this.mempool.delete(id);
      }
    }
    this.touch(Slice.Mempool);
  }

  private checkContinuity(
    topic: GapTopic,
    snapshotSeq: number,
    last: number | null,
    prevSeq: number,
    seq: number,
  ): boolean {
    const ok = last === null ? prevSeq <= snapshotSeq : prevSeq === last;
    if (!ok) {
      this.stats.gaps++;
      this.opts.onGap?.(topic, { expected: last, prevSeq, seq });
    }
    return ok;
  }

  /**
   * Applies a `nodes` delta, maintaining payment-queue ranks by the rank contract
   * (ARCHITECTURE section 8). The order mirrors the server's model of the clients exactly, so
   * its `cause: reconcile` corrections make the ranks exact again:
   *
   * 1. `removed` nodes leave their tier queue; ranks behind them move up (the gap closes).
   * 2. A node whose status leaves `confirmed`, or whose `changed` rank is `null` (the explicit
   *    unranked signal) outside a reconcile, leaves its tier queue the same way.
   * 3. Field changes apply.
   * 4. Entering ranks, ascending by (rank, id): `added` nodes, and `changed` ranks outside a
   *    reconcile, are inserted at their rank (clamped to the tier size); nodes at or behind it
   *    shift back. A node already ranked is taken out first, at its turn (a move).
   * 5. In a `cause: reconcile` delta, `changed` ranks are authoritative and set as is; `null`
   *    unranks the node without shifting anyone.
   */
  private applyNodes(d: NodesDelta, seq: number): void {
    const t = this.nodes;
    if (seq <= t.snapshotSeq) {
      this.stats.skippedStale++;
      return;
    }
    if (!this.checkContinuity('nodes', t.snapshotSeq, this.lastNodesMsgSeq, d.prev_seq, seq)) return;
    this.lastNodesMsgSeq = seq;
    const nc = this.nodeChanges();
    const authoritative = d.cause === 'reconcile';
    for (const id of d.removed) {
      const i = t.indexOf(id);
      if (i >= 0) this.leaveQueue(i, nc);
      if (t.remove(id)) {
        nc.removed.push(id);
        nc.structural = true;
      }
    }
    for (const c of d.changed) {
      const statusExit = c.status !== undefined && c.status !== 'confirmed';
      const unranked = c.rank === null && !authoritative;
      if (!statusExit && !unranked) continue;
      const i = t.indexOf(c.id);
      if (i >= 0) this.leaveQueue(i, nc);
    }
    // Field updates keep the rank the client holds; entering ranks apply below.
    const entering: { id: number; rank: number }[] = [];
    for (const n of d.added) {
      const i = t.indexOf(n.id);
      const existed = i >= 0;
      if (n.rank !== null) entering.push({ id: n.id, rank: n.rank });
      t.upsert({ ...n, rank: existed && t.rank[i]! > 0 ? t.rank[i]! - 1 : null });
      if (existed) {
        nc.changed.push(n.id);
        nc.fields |= 0x1fff;
      } else {
        nc.added.push(n.id);
        nc.structural = true;
      }
    }
    for (const c of d.changed) {
      let change: NodeChange = c;
      if (c.rank !== undefined && !authoritative) {
        // A rank enters below; `null` already left the queue above.
        if (c.rank !== null) entering.push({ id: c.id, rank: c.rank });
        const { rank: _rank, ...rest } = c;
        change = rest;
      }
      const f = t.applyChange(change);
      if (f > 0) {
        nc.changed.push(c.id);
        nc.fields |= f;
      }
    }
    entering.sort((x, y) => x.rank - y.rank || x.id - y.id);
    for (const e of entering) {
      const i = t.indexOf(e.id);
      if (i < 0) continue;
      // A node already ranked moves: out of its place, then in at the new rank.
      this.leaveQueue(i, nc);
      this.enterQueue(i, e.rank, nc);
    }
    this.touch(Slice.Nodes);
  }

  // -------------------------------------------------------------------------------------------
  // Payment queue (rank contract). Ranks are stored plus one (0 = not queued), per tier.
  // -------------------------------------------------------------------------------------------

  /** Number of ranked nodes in tier code `tier`. */
  private queueSize(tier: number): number {
    const t = this.nodes;
    const tiers = t.tier;
    const rank = t.rank;
    let n = 0;
    for (let i = 0; i < t.count; i++) if (tiers[i] === tier && rank[i]! > 0) n++;
    return n;
  }

  /** Moves every node of `tier` with stored rank above `above` by `delta`, recording them. */
  private shiftQueue(tier: number, above: number, delta: 1 | -1, skip: number, nc: NodeChangeSet): void {
    const t = this.nodes;
    const tiers = t.tier;
    const rank = t.rank;
    const ids = t.ids;
    for (let i = 0; i < t.count; i++) {
      if (i === skip || tiers[i] !== tier || rank[i]! <= above) continue;
      rank[i] = rank[i]! + delta;
      nc.changed.push(ids[i]!);
    }
    nc.fields |= NodeField.Rank;
  }

  /** Takes row `i` out of its tier queue; the nodes behind it move up. */
  private leaveQueue(i: number, nc: NodeChangeSet): void {
    const t = this.nodes;
    const r = t.rank[i]!;
    if (r === 0) return;
    t.rank[i] = 0;
    nc.changed.push(t.ids[i]!);
    this.shiftQueue(t.tier[i]!, r, -1, i, nc);
  }

  /** Inserts unranked row `i` at `rank` (clamped to the tier size); the rest shifts back. */
  private enterQueue(i: number, rank: number, nc: NodeChangeSet): void {
    const t = this.nodes;
    const tier = t.tier[i]!;
    if (tier === 0 || t.rank[i]! > 0) return;
    const at = Math.min(rank, this.queueSize(tier));
    // Stored ranks are rank + 1: everything at `at` or behind (stored >= at + 1) moves back.
    this.shiftQueue(tier, at, 1, i, nc);
    t.rank[i] = at + 1;
    nc.changed.push(t.ids[i]!);
  }

  /** Rule 1: a paid node moves to the back of its tier; the nodes behind it move up. */
  private rotateToBack(i: number, nc: NodeChangeSet): void {
    const t = this.nodes;
    const r = t.rank[i]!;
    if (r === 0) return;
    const tier = t.tier[i]!;
    this.shiftQueue(tier, r, -1, i, nc);
    // The tier size includes the payee itself, so the back is size - 1 (stored: size).
    t.rank[i] = this.queueSize(tier);
    nc.changed.push(t.ids[i]!);
  }

  private applyApps(d: AppsDelta, seq: number): void {
    if (seq <= this.bootstrapSeq) {
      this.stats.skippedStale++;
      return;
    }
    if (!this.checkContinuity('apps', this.bootstrapSeq, this.lastAppsMsgSeq, d.prev_seq, seq)) return;
    this.lastAppsMsgSeq = seq;
    const upserted = new Set<string>();
    for (const a of d.upserted) {
      this.apps.set(a.name, a);
      upserted.add(a.name);
    }
    for (const name of d.removed) this.apps.delete(name);
    let pendingTouched = false;
    for (const inst of d.instances) {
      const cur = this.apps.get(inst.app);
      if (cur && !upserted.has(inst.app)) {
        const running = Math.max(0, cur.instances_running + inst.started.length - inst.removed.length);
        if (running !== cur.instances_running)
          this.apps.set(inst.app, { ...cur, instances_running: running });
      }
      for (const node of inst.started)
        pendingTouched = this.installing.delete(`${inst.app}\u0000${node}`) || pendingTouched;
    }
    if (pendingTouched) this.touch(Slice.Pending);
    this.touch(Slice.Apps);
  }

  private applyMesh(d: MeshDelta, seq: number): void {
    // mesh.bin already holds this change (a resume replays from below its seq for other topics).
    if (seq <= this.meshSnapshotSeq) {
      this.stats.skippedStale++;
      return;
    }
    const mc = this.meshChanges();
    for (const [a, b] of d.removed) {
      if (this.mesh.delete(edgeKey(a, b))) mc.removed.push([Math.min(a, b), Math.max(a, b)]);
    }
    for (const [a, b] of d.added) {
      const k = edgeKey(a, b);
      if (!this.mesh.has(k)) {
        this.mesh.set(k, 0);
        mc.added.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    this.touch(Slice.Mesh);
  }

  /** Drops expired mempool entries, resolved pending apps and stale installs. Call periodically. */
  prune(nowMs = this.now()): void {
    let slices = 0;
    for (const [id, e] of this.mempool) {
      if (nowMs - e.firstSeenMs > MEMPOOL_TTL_MS) {
        this.mempool.delete(id);
        slices |= Slice.Mempool;
      }
    }
    for (const [h, p] of this.pendingApps) {
      const expired = p.state === 'pending' && nowMs > p.expiresMs;
      if (expired) {
        this.pendingApps.set(h, { ...p, state: 'expired', resolvedMs: nowMs });
        slices |= Slice.Pending;
      } else if (p.resolvedMs !== null && nowMs - p.resolvedMs > PENDING_RESOLVED_TTL_MS) {
        this.pendingApps.delete(h);
        slices |= Slice.Pending;
      }
    }
    for (const [k, e] of this.installing) {
      if (nowMs - e.sinceMs > INSTALLING_TTL_MS) {
        this.installing.delete(k);
        slices |= Slice.Pending;
      }
    }
    if (slices) this.touch(slices);
  }

  // -------------------------------------------------------------------------------------------
  // Derived reads (cached per slice version so React selectors stay referentially stable)
  // -------------------------------------------------------------------------------------------

  /** Mesh edges as flat arrays for the renderer. */
  meshEdges(): { a: Uint32Array; b: Uint32Array; flags: Uint8Array } {
    if (this.meshArrays && this.meshArrays.version === this.versions.Mesh) return this.meshArrays;
    const n = this.mesh.size;
    const a = new Uint32Array(n);
    const b = new Uint32Array(n);
    const flags = new Uint8Array(n);
    let i = 0;
    for (const [k, f] of this.mesh) {
      a[i] = Math.floor(k / EDGE_SHIFT);
      b[i] = k % EDGE_SHIFT;
      flags[i] = f;
      i++;
    }
    this.meshArrays = { version: this.versions.Mesh, a, b, flags };
    return this.meshArrays;
  }

  pendingList(): readonly PendingApp[] {
    if (this.pendingArray && this.pendingArray.version === this.versions.Pending)
      return this.pendingArray.list;
    const list = [...this.pendingApps.values()].sort((x, y) => y.receivedMs - x.receivedMs);
    this.pendingArray = { version: this.versions.Pending, list };
    return list;
  }

  mempoolList(): readonly MempoolEntry[] {
    if (this.mempoolArray && this.mempoolArray.version === this.versions.Mempool)
      return this.mempoolArray.list;
    const list = [...this.mempool.values()].sort((x, y) => y.firstSeenMs - x.firstSeenMs);
    this.mempoolArray = { version: this.versions.Mempool, list };
    return list;
  }

  appList(): readonly AppIndexEntry[] {
    if (this.appsArray && this.appsArray.version === this.versions.Apps) return this.appsArray.list;
    const list = [...this.apps.values()];
    this.appsArray = { version: this.versions.Apps, list };
    return list;
  }

  /** Sizes for diagnostics. */
  sizes(): Record<string, number> {
    return {
      nodes: this.nodes.count,
      edges: this.mesh.size,
      apps: this.apps.size,
      blocks: this.blocks.size,
      feed: this.feed.size,
      mempool: this.mempool.size,
      pendingApps: this.pendingApps.size,
      installing: this.installing.size,
    };
  }
}

/** `instance/started_ms`: the origin a server info names (ARCHITECTURE 8.1). */
export function originKey(server: Pick<ServerInfo, 'instance' | 'started_ms'>): string {
  return `${server.instance ?? ''}/${server.started_ms}`;
}

/**
 * The live seq to resume from after loading these snapshots (ARCHITECTURE 8.1):
 * `min(bootstrap.seq, nodes.seq, M)`, M = the mesh seq only when it is below `bootstrap.mesh_seq`.
 */
export function resumeSeq(
  bootstrap: Pick<BootstrapDto, 'seq' | 'mesh_seq'>,
  nodes: Pick<NodesBin, 'seq'>,
  mesh: Pick<MeshBin, 'seq'> | null,
): number {
  let seq = Math.min(bootstrap.seq, nodes.seq);
  const meshSeq = bootstrap.mesh_seq;
  if (mesh && meshSeq !== undefined && mesh.seq < meshSeq) seq = Math.min(seq, mesh.seq);
  return seq;
}

/**
 * Why `/bootstrap`, `/nodes.bin` and `/mesh.bin` cannot be loaded together, or null when they
 * share the bootstrap's origin (ARCHITECTURE 8.1). A file without ORIGIN (an older server) is
 * accepted only when the bootstrap names no instance either.
 */
export function snapshotOriginError(
  bootstrap: Pick<BootstrapDto, 'server'>,
  nodes: Pick<NodesBin, 'origin'>,
  mesh: Pick<MeshBin, 'origin'> | null,
): string | null {
  const server = bootstrap.server;
  const check = (what: string, o: SnapshotOrigin | null): string | null => {
    if (o === null)
      return server.instance ? `${what} has no origin, bootstrap is ${originKey(server)}` : null;
    if (o.instance === server.instance && o.startedMs === server.started_ms) return null;
    return `${what} is from ${o.instance}/${o.startedMs}, bootstrap from ${originKey(server)}`;
  };
  return check('nodes.bin', nodes.origin) ?? (mesh ? check('mesh.bin', mesh.origin) : null);
}

export function fromBlockLite(b: BlockLite): ChainBlock {
  return {
    height: b.height,
    hash: b.hash,
    timeMs: b.time_ms,
    size: b.size,
    txCount: b.tx_count,
    producer: b.producer,
    payouts: b.payouts,
    reward: b.reward,
    fees: b.fees,
    devFund: null,
    confirmCount: b.confirm_count,
    startCount: b.start_count,
    transferCount: b.transfer_count,
    observedMs: null,
    live: false,
  };
}

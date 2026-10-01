// The real network, as recorded by scripts/record-live.mjs, turned into what the globe engine takes.
//
// Everything here is a reading of the recording: node positions, tiers and city names come from
// nodes.bin, the peer links from mesh.bin, blocks, payouts, heartbeats and the next payees from the
// WebSocket stream. Nothing is made up. A node's place name is its recorded city; when the source has
// no city, its recorded country; never a guess.

import type { NodeColumns } from '../../engine/types';
import { ENGINE_STATUS, base64ToBuffer, decodeMeshBin, decodeNodesBin, splitCountry, TIER_CODES, type MeshBin, type NodesBin, type TierName } from './bin';

// ---- the recording file ------------------------------------------------------------------------------

export interface NodeRef {
  id: number;
  tier: TierName;
  endpoint: string | null;
  lat: number | null;
  lon: number | null;
  country_code: string | null;
}
export interface Payout {
  tier: TierName;
  node: number | null;
  address: string;
  amount: string;
}
export interface BlockMsg {
  t: 'block';
  seq: number;
  observed_ms: number;
  event_ms: number | null;
  height: number;
  hash: string;
  time_ms: number;
  size: number;
  tx_count: number;
  producer: NodeRef | null;
  payouts: Payout[];
  heartbeats: number[];
  confirms: number[];
  starts: NodeRef[];
  reward: string;
  fees: string;
  dev_fund: string;
}
export interface NextPayeesMsg {
  t: 'next_payees';
  seq: number;
  observed_ms: number;
  height: number;
  payees: { tier: TierName; node: number | null; address: string }[];
}
export interface MempoolMsg {
  t: 'mempool';
  seq: number;
  observed_ms: number;
  txs: { txid: string; value: string; kind: string; size: number }[];
}
export interface NodesMsg {
  t: 'nodes';
  seq: number;
  observed_ms: number;
  added: { id: number; tier: TierName; status: string; lat: number | null; lon: number | null; country_code: string | null; endpoint: string | null }[];
  removed: number[];
  changed: { id: number; status?: string; tier?: TierName }[];
}
export interface MeshMsg {
  t: 'mesh';
  seq: number;
  observed_ms: number;
  added: [number, number][];
  removed: [number, number][];
}
export type AnyMsg = { t: string; seq: number; observed_ms: number } & Record<string, unknown>;

export interface Recorded {
  rx: number;
  wall: number;
  msg: AnyMsg;
}
export interface RecordedApp {
  name: string;
  display_name: string;
  instances: { node: number | null; lat: number | null; lon: number | null; country_code: string | null }[];
}
export interface Bootstrap {
  seq: number;
  generated_ms: number;
  network: {
    node_count: number;
    host_count: number;
    country_count: number;
    provider_count: number;
    app_count: number;
    instance_count: number;
    tip: { height: number; time_ms: number } | null;
    mempool_size: number;
  };
  blocks: { height: number; time_ms: number }[];
}
export interface RecordingFile {
  format: string;
  recordedAt: string;
  server: string;
  t0Wall: number;
  durationMs: number;
  snapshotSeq: number;
  bootstrap: Bootstrap;
  nodesBin: string;
  meshBin: string;
  apps: Record<string, RecordedApp>;
  messages: Recorded[];
}

export async function loadRecording(url: string): Promise<RecordingFile> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`recording ${url}: HTTP ${r.status}`);
  return (await r.json()) as RecordingFile;
}

// ---- the world ---------------------------------------------------------------------------------------

/** The engine reserves node id 0, so every server node id crosses the boundary shifted by one (as in web/src/globe/bindings.ts). */
export const toEngineId = (id: number): number => id + 1;
export const fromEngineId = (id: number): number => id - 1;

/** The IP part of an endpoint (`1.2.3.4:16127`, `[2001:db8::1]:16127`). */
function ipOf(endpoint: string): string {
  if (endpoint.startsWith('[')) {
    const end = endpoint.indexOf(']');
    return end > 0 ? endpoint.slice(1, end) : endpoint;
  }
  const i = endpoint.lastIndexOf(':');
  return i > 0 && endpoint.indexOf(':') === i ? endpoint.slice(0, i) : endpoint;
}

export interface Place {
  lat: number;
  lon: number;
  /** Recorded city, else recorded country, else ''. */
  name: string;
  city: string;
  country: string;
  cc: string;
}

export class World {
  readonly rec: RecordingFile;
  readonly nodes: NodesBin;
  readonly mesh: MeshBin;
  /** Row of a server node id in nodes.bin. */
  readonly row = new Map<number, number>();
  /** Nodes that joined after the snapshot (from `nodes` messages), by server id. */
  readonly extra = new Map<number, NodesMsg['added'][number]>();

  constructor(rec: RecordingFile) {
    this.rec = rec;
    this.nodes = decodeNodesBin(base64ToBuffer(rec.nodesBin));
    this.mesh = decodeMeshBin(base64ToBuffer(rec.meshBin));
    for (let i = 0; i < this.nodes.count; i++) this.row.set(this.nodes.ids[i], i);
    for (const { msg } of rec.messages) {
      if (msg.t === 'nodes') for (const n of (msg as unknown as NodesMsg).added) if (!this.row.has(n.id)) this.extra.set(n.id, n);
    }
  }

  has(id: number): boolean {
    return this.row.has(id);
  }

  tierOf(id: number): number {
    const r = this.row.get(id);
    return r === undefined ? 0 : this.nodes.tier[r];
  }

  /** The recorded place of a node: position, city, country. Null when the node is not in the snapshot or has no position. */
  place(id: number): Place | null {
    const r = this.row.get(id);
    if (r === undefined) return null;
    const n = this.nodes;
    const lat = n.lat[r];
    const lon = n.lon[r];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const city = n.locations.city(n.loc[r]).trim();
    const c = splitCountry(n.countries.get(n.country[r]));
    const name = city || c.name || '';
    return { lat, lon, name, city, country: c.name, cc: c.code };
  }

  /** The columns for `engine.setNodes` (engine ids), with the web app's status mapping and host ids. */
  columns(): NodeColumns {
    const n = this.nodes;
    const hostId = new Map<string, number>();
    const cols: NodeColumns = {
      ids: new Uint32Array(n.count),
      lat: new Float32Array(n.count),
      lon: new Float32Array(n.count),
      tier: new Uint8Array(n.count),
      status: new Uint8Array(n.count),
      flags: new Uint8Array(n.count),
      loc: new Uint32Array(n.count),
      host: new Uint32Array(n.count),
    };
    for (let i = 0; i < n.count; i++) {
      cols.ids[i] = toEngineId(n.ids[i]);
      cols.lat[i] = n.lat[i];
      cols.lon[i] = n.lon[i];
      cols.tier[i] = n.tier[i];
      cols.status[i] = ENGINE_STATUS[n.status[i]] ?? 0;
      cols.flags[i] = n.flagsCol[i];
      cols.loc[i] = n.loc[i];
      const ep = n.ips.get(i);
      if (ep) {
        const ip = ipOf(ep);
        let h = hostId.get(ip);
        if (h === undefined) hostId.set(ip, (h = hostId.size + 1));
        cols.host![i] = h;
      }
    }
    return cols;
  }

  /** The peer links in engine ids, dropping any whose end is not in the snapshot. */
  meshEdges(): { a: Uint32Array; b: Uint32Array } {
    const m = this.mesh;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < m.count; i++) {
      if (this.row.has(m.a[i]) && this.row.has(m.b[i])) {
        a.push(toEngineId(m.a[i]));
        b.push(toEngineId(m.b[i]));
      }
    }
    return { a: Uint32Array.from(a), b: Uint32Array.from(b) };
  }

  /** The co-located sites with the most nodes: the datacenter towers. */
  topSites(count: number): { loc: number; nodes: number; lat: number; lon: number; city: string; country: string }[] {
    const L = this.nodes.locations;
    const out: { loc: number; nodes: number; lat: number; lon: number; city: string; country: string }[] = [];
    for (let i = 1; i < L.length; i++) {
      const lat = L.lat(i);
      const lon = L.lon(i);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ loc: i, nodes: L.nodeCount(i), lat, lon, city: L.city(i).trim(), country: splitCountry(this.nodes.countries.get(L.country(i))).name });
    }
    out.sort((x, y) => y.nodes - x.nodes);
    return out.slice(0, count);
  }
}

// ---- reading the stream ------------------------------------------------------------------------------

export interface FeaturedBlock {
  block: BlockMsg;
  /** The payees the previous block announced for this block (the pre-aim), if recorded. */
  aimed: NextPayeesMsg | null;
  /** The payees announced for the block after this one, if recorded. */
  next: NextPayeesMsg | null;
  producer: Place;
  /** Payee places in coinbase order (cumulus, nimbus, stratus). */
  payees: { tier: TierName; node: number; amount: string; place: Place }[];
}

export function blocksOf(rec: RecordingFile): BlockMsg[] {
  const seen = new Set<number>();
  const out: BlockMsg[] = [];
  for (const { msg } of rec.messages) {
    if (msg.t !== 'block') continue;
    const b = msg as unknown as BlockMsg;
    if (seen.has(b.height)) continue;
    seen.add(b.height);
    out.push(b);
  }
  return out.sort((x, y) => x.height - y.height);
}

export function nextPayeesOf(rec: RecordingFile, height: number): NextPayeesMsg | null {
  let best: NextPayeesMsg | null = null;
  for (const { msg } of rec.messages) {
    if (msg.t === 'next_payees' && (msg as unknown as NextPayeesMsg).height === height) best = msg as unknown as NextPayeesMsg;
  }
  return best;
}

/** Everything the film needs to say about one recorded block, or null when the block cannot be shown whole (a node missing from the snapshot, or without a position). */
export function describeBlock(rec: RecordingFile, world: World, block: BlockMsg): FeaturedBlock | null {
  if (!block.producer || !world.has(block.producer.id)) return null;
  const producer = world.place(block.producer.id);
  if (!producer) return null;
  const payees: FeaturedBlock['payees'] = [];
  for (const tier of ['cumulus', 'nimbus', 'stratus'] as TierName[]) {
    const p = block.payouts.find((x) => x.tier === tier);
    if (!p || p.node === null || !world.has(p.node)) return null;
    const place = world.place(p.node);
    if (!place) return null;
    payees.push({ tier, node: p.node, amount: p.amount, place });
  }
  return { block, aimed: nextPayeesOf(rec, block.height), next: nextPayeesOf(rec, block.height + 1), producer, payees };
}

export const tierCodeOf = (t: TierName): number => TIER_CODES.indexOf(t);

/** "2,997,581" */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A FLUX amount string ("9.00000000") as "9.00". */
export const fmtFlux = (s: string): string => Number(s).toFixed(2);

/** "2026-10-01 01:14 UTC" from epoch ms. */
export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

#!/usr/bin/env node
// Records the real Flux network through a running Flux Atlas server, so a film of it can be rendered
// again and again from exactly the same facts (scripts/capture.mjs reads this file).
//
//   node scripts/record-live.mjs                          # 8 minutes (about 16 blocks) from http://127.0.0.1:3100
//   node scripts/record-live.mjs --seconds 150 --blocks 4  # stop after 150 s and at least 4 live blocks
//   node scripts/record-live.mjs --base http://127.0.0.1:3100 --out clips/recording-x.json
//   node scripts/record-live.mjs --enrich clips/recording-x.json   # (re)fetch nodeGeo for a recording
//
// What it stores (one JSON file, self-contained):
//   bootstrap   GET /api/v1/bootstrap, the network summary, tiers, the latest blocks and the app index
//   nodesBin    GET /api/v1/nodes.bin  (base64; the current positions, tiers, cities of every node)
//   meshBin     GET /api/v1/mesh.bin   (base64; the current peer links)
//   apps        GET /api/v1/apps/<name> for the busiest apps (their running instances: node, lat, lon)
//   nodeGeo     GET /api/v1/nodes/<id> for every node a recorded block or next-payees message names (the
//               producer, the payees): its recorded region, city, country and provider. nodes.bin has no
//               city names, because the geolocation source rarely knows one; the region ("Uusimaa") does exist.
//   messages    every message the WebSocket sends after `sub` on all topics, each with its receipt time
//               (`rx`, milliseconds since the recording started) and its wall-clock time (`wall`).
//               The server's own clock is inside each message (`observed_ms`, `event_ms`).
//
// The messages are replayed from the snapshot's sequence number, so nothing between the snapshot and
// the first live message is missing. Nothing is invented and nothing is modified here.
//
// Needs Node 22 or newer (global WebSocket and fetch). No dependencies.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};

const BASE = String(opt('base', process.env.ATLAS_URL ?? 'http://127.0.0.1:3100')).replace(/\/$/, '');
const MAX_SECONDS = Number(opt('seconds', 480));
const MIN_SECONDS = Number(opt('min-seconds', 0));
const MIN_BLOCKS = Number(opt('blocks', 0));
const APPS = Number(opt('apps', 60));
const TOPICS = ['chain', 'mempool', 'nodes', 'apps', 'mesh', 'stats', 'feed'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
const OUT = resolve(String(opt('out', resolve(here, '..', 'clips', `recording-${stamp}.json`))));

const log = (...a) => console.log(`[record ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function getBin(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- node details: the regions and countries the cinema names places by ----------------------------------

async function fetchNodeGeo(messages, into) {
  const ids = new Set();
  for (const { msg } of messages) {
    if (msg.t === 'block') {
      if (msg.producer) ids.add(msg.producer.id);
      for (const p of msg.payouts ?? []) if (p.node !== null) ids.add(p.node);
    } else if (msg.t === 'next_payees') {
      for (const p of msg.payees ?? []) if (p.node !== null) ids.add(p.node);
    }
  }
  const todo = [...ids].filter((id) => !(id in into));
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (id) => {
        try {
          const d = await getJson(`/api/v1/nodes/${id}`);
          const g = d.node?.geo;
          into[id] = g
            ? { lat: g.lat, lon: g.lon, city: g.city ?? '', region: g.region ?? '', country: g.country ?? '', country_code: g.country_code ?? '', org: g.org ?? '', tier: d.node.tier }
            : null;
        } catch (e) {
          into[id] = null;
          log(`node ${id}: ${e.message}`);
        }
      }),
    );
  }
  log(`nodeGeo: ${Object.keys(into).length} nodes (${ids.size} named in the stream)`);
}

if (argv.includes('--enrich')) {
  const file = resolve(String(opt('enrich', '')));
  const { readFileSync } = await import('node:fs');
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  rec.nodeGeo = rec.nodeGeo ?? {};
  await fetchNodeGeo(rec.messages, rec.nodeGeo);
  writeFileSync(file, JSON.stringify(rec));
  log(`enriched ${file}`);
  process.exit(0);
}

// ---- the snapshots, taken together ------------------------------------------------------------------

const t0wall = Date.now();
log(`server ${BASE}`);
const [bootstrap, nodesBuf, meshBuf] = await Promise.all([getJson('/api/v1/bootstrap'), getBin('/api/v1/nodes.bin'), getBin('/api/v1/mesh.bin')]);
// The container header: magic(4) version(2) flags(2) seq(u64) generated_ms(u64) count(u32) sections(u32).
const nodesSeq = Number(nodesBuf.readBigUInt64LE(8));
const nodesCount = nodesBuf.readUInt32LE(24);
const meshCount = meshBuf.readUInt32LE(24);
log(`bootstrap seq ${bootstrap.seq}, tip ${bootstrap.network.tip?.height}, nodes.bin ${nodesCount} nodes (seq ${nodesSeq}), mesh.bin ${meshCount} links`);

// The busiest apps with their real instances (for the constellation shot).
const appIndex = [...bootstrap.apps].sort((a, b) => b.instances_running - a.instances_running).slice(0, APPS);
const apps = {};
for (const a of appIndex) {
  try {
    const d = await getJson(`/api/v1/apps/${encodeURIComponent(a.name)}`);
    apps[a.name] = {
      name: d.name,
      display_name: d.display_name,
      instances: d.instances.map((i) => ({ node: i.node, lat: i.lat, lon: i.lon, country_code: i.country_code })),
    };
  } catch (e) {
    log(`app ${a.name}: ${e.message}`);
  }
}
log(`apps: ${Object.keys(apps).length} (${Object.values(apps).map((a) => `${a.name} ${a.instances.length}`).slice(0, 5).join(', ')} ...)`);

// ---- the live stream --------------------------------------------------------------------------------

const messages = [];
const nodeGeo = {};
const t0 = performance.now();
let blocksLive = 0;
let helloAt = 0;
let done = false;

function save(reason) {
  mkdirSync(dirname(OUT), { recursive: true });
  const rec = {
    format: 'flux-atlas-live-recording/1',
    recordedAt: new Date(t0wall).toISOString(),
    server: BASE,
    t0Wall: t0wall,
    durationMs: Math.round(performance.now() - t0),
    snapshotSeq: nodesSeq,
    bootstrap,
    nodesBin: nodesBuf.toString('base64'),
    meshBin: meshBuf.toString('base64'),
    apps,
    nodeGeo,
    messages,
  };
  writeFileSync(OUT, JSON.stringify(rec));
  log(`${reason}: wrote ${messages.length} messages (${blocksLive} live blocks) to ${OUT}`);
}

await new Promise((resolveRun) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
  const finish = async (why) => {
    if (done) return;
    done = true;
    try {
      ws.close(1000, 'done');
    } catch {
      /* already closed */
    }
    try {
      await fetchNodeGeo(messages, nodeGeo);
    } catch (e) {
      log(`nodeGeo failed: ${e.message}`);
    }
    save(why);
    resolveRun();
  };
  process.on('SIGINT', () => finish('interrupted'));
  process.on('SIGTERM', () => finish('terminated'));

  ws.onopen = () => log('socket open');
  ws.onerror = (e) => log('socket error', e?.message ?? '');
  ws.onclose = (e) => {
    if (!done) log(`socket closed (${e.code} ${e.reason})`);
    finish(`closed ${e.code}`);
  };
  ws.onmessage = (ev) => {
    const rx = performance.now() - t0;
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      helloAt = rx;
      ws.send(JSON.stringify({ t: 'sub', topics: TOPICS, since_seq: nodesSeq, watch: null, watch_apps: null }));
      log(`hello (server ${msg.server?.name} ${msg.server?.version}); subscribed from seq ${nodesSeq}`);
    }
    if (msg.t === 'ping') ws.send(JSON.stringify({ t: 'pong', now_ms: Date.now() }));
    if (msg.t === 'resync') log(`server asked for a resync: ${msg.reason}`);
    messages.push({ rx: Math.round(rx * 10) / 10, wall: Date.now(), msg });
    if (msg.t === 'block') {
      const replay = rx - helloAt < 1500 && msg.observed_ms < t0wall - 200;
      if (!replay) blocksLive++;
      const p = msg.payouts?.map((x) => `${x.tier[0]}${x.node ?? '?'}:${x.amount}`).join(' ');
      log(`block ${msg.height}${replay ? ' (replayed)' : ''} producer ${msg.producer?.id ?? '-'} ${msg.producer?.country_code ?? ''}  payouts ${p}  heartbeats ${msg.heartbeats?.length} confirms ${msg.confirms?.length}  live blocks ${blocksLive}`);
    }
    const elapsed = rx / 1000;
    if (elapsed >= MAX_SECONDS || (elapsed >= MIN_SECONDS && MIN_BLOCKS > 0 && blocksLive >= MIN_BLOCKS)) finish('complete');
  };
  // Checkpoints, so a crash loses at most a minute.
  const cp = setInterval(() => {
    if (done) clearInterval(cp);
    else save('checkpoint');
  }, 60000);
  const guard = setTimeout(() => finish('time limit'), (MAX_SECONDS + 30) * 1000);
  guard.unref?.();
});
process.exit(0);

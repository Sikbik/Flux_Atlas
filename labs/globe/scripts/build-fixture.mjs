#!/usr/bin/env node
// Builds a compact, IP-free snapshot of the live Flux network for the lab.
//
//   node scripts/build-fixture.mjs [rawDir]     (or FLUX_RAW_DIR=<dir>)
//
// Reads the raw API dumps the research team collected (geo projection, deterministic node list,
// app locations, P2P topology samples) and writes
//   public/data/flux-snapshot.json   metadata and string tables
//   public/data/flux-snapshot.bin    columnar typed arrays (little endian, 4-byte aligned)
//
// Nothing that identifies a host is written: no IPs, no collateral hashes, no payment addresses.
// Node ids are simply row numbers + 1. See README.md "Data format" for the column layout.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'data');
mkdirSync(out, { recursive: true });

const candidates = [
  process.argv[2],
  process.env.FLUX_RAW_DIR,
  resolve(root, '../../docs/research/fixtures/flux'),
].filter(Boolean);
// The fixtures committed under docs/research are trimmed samples (a few hundred nodes); the snapshot
// shipped in public/data was built from the full dumps. Prefer whichever candidate holds the largest geo dump.
const sizeOf = (d) => (existsSync(join(d, 'stats_fluxinfo_projection_geo.json')) ? readFileSync(join(d, 'stats_fluxinfo_projection_geo.json')).length : -1);
const rawDir = candidates.filter((d) => sizeOf(d) > 0).sort((a, b) => sizeOf(b) - sizeOf(a))[0];
if (!rawDir) throw new Error('raw flux dumps not found; pass the directory as the first argument');
console.log('reading', rawDir);

const readJson = (name) => JSON.parse(readFileSync(join(rawDir, name), 'utf8'));
const geo = readJson('stats_fluxinfo_projection_geo.json').data;
const list = readJson('daemon_viewdeterministicfluxnodelist.json').data;
const locs = readJson('apps_locations.json').data;

const TIP = 2996915;

// ip:port normalisation. The default API port is omitted by some sources and present in others.
const norm = (s) => (s.endsWith(':16127') ? s.slice(0, -6) : s);
const hostOf = (s) => {
  const t = norm(s);
  if (t.startsWith('[')) return t.slice(0, t.indexOf(']') + 1);
  const i = t.lastIndexOf(':');
  return i === -1 ? t : t.slice(0, i);
};

// Join the node list (heights, payment state) onto the geo projection by collateral.
const byCollateral = new Map();
for (const n of list) byCollateral.set(`${n.txhash}:${n.outidx}`, n);

const count = geo.length;
const ids = new Uint32Array(count);
const lat = new Float32Array(count);
const lon = new Float32Array(count);
const tier = new Uint8Array(count);
const status = new Uint8Array(count);
const flags = new Uint8Array(count);
const loc = new Uint32Array(count);
const host = new Uint32Array(count);
const country = new Uint16Array(count);
const org = new Uint16Array(count);

const tierCode = { CUMULUS: 1, NIMBUS: 2, STRATUS: 3 };
const countries = [];
const countryIndex = new Map();
const orgs = [];
const orgIndex = new Map();
const hostIndex = new Map();
const locIndex = new Map();
const locTable = []; // { lat, lon, n, country, region }
const ipToNode = new Map();

// Deterministic hash for the only synthesised bit (ArcaneOS adoption): see README.
const hash = (x) => {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
};

for (let i = 0; i < count; i++) {
  const n = geo[i];
  const g = n.geolocation ?? {};
  ids[i] = i + 1;
  tier[i] = tierCode[n.tier] ?? 0;
  status[i] = 1;

  const located = typeof g.lat === 'number' && typeof g.lon === 'number' && !(g.lat === 0 && g.lon === 0);
  lat[i] = located ? g.lat : NaN;
  lon[i] = located ? g.lon : NaN;

  const cName = g.country || 'Unknown';
  if (!countryIndex.has(cName)) {
    countryIndex.set(cName, countries.length);
    countries.push({ name: cName, code: g.countryCode || '' });
  }
  country[i] = countryIndex.get(cName);

  const oName = g.org || g.isp || 'Unknown';
  if (!orgIndex.has(oName)) {
    orgIndex.set(oName, orgs.length);
    orgs.push(oName);
  }
  org[i] = orgIndex.get(oName);

  const h = hostOf(n.ip);
  if (!hostIndex.has(h)) hostIndex.set(h, hostIndex.size);
  host[i] = hostIndex.get(h);

  const key = located ? `${g.lat.toFixed(3)},${g.lon.toFixed(3)}` : 'unlocated';
  if (!locIndex.has(key)) {
    locIndex.set(key, locTable.length);
    locTable.push({ lat: located ? +g.lat.toFixed(3) : null, lon: located ? +g.lon.toFixed(3) : null, n: 0, country: country[i], region: g.regionName || '' });
  }
  loc[i] = locIndex.get(key);
  locTable[loc[i]].n++;

  let f = 0;
  const rec = byCollateral.get(`${n.collateralHash}:${n.collateralIndex}`);
  if (rec) {
    if (TIP - rec.last_paid_height < 3600) f |= 1 << 6; // recently paid
    if (TIP - rec.added_height < 2880) f |= 1 << 7; // joined in the last ~24 h
  }
  if (hash(i * 2654435761) % 100 < 38) f |= 1 << 4; // ArcaneOS (synthesised: adoption rate only)
  if (g.dataCenter === false && g.hosting === false && g.mobile === false && Math.abs(g.lat ?? 0) > 0) f |= 0;
  flags[i] = f;

  ipToNode.set(norm(n.ip), i);
}

// Which nodes host apps, and each app's instance list.
const appNodes = new Map();
for (const r of locs) {
  const idx = ipToNode.get(norm(r.ip));
  if (idx === undefined) continue;
  flags[idx] |= 1; // has_apps
  let arr = appNodes.get(r.name);
  if (!arr) appNodes.set(r.name, (arr = []));
  if (!arr.includes(idx)) arr.push(idx);
}
const apps = [...appNodes.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);
const appNames = apps.map(([name]) => name);
const appOffsets = new Uint32Array(apps.length + 1);
const appInstances = [];
apps.forEach(([, v], i) => {
  appOffsets[i] = appInstances.length;
  for (const idx of v) appInstances.push(ids[idx]);
});
appOffsets[apps.length] = appInstances.length;

// Observed P2P edges from the topology samples (each reporter lists its outbound and inbound peers).
const edgeSet = new Set();
const topoFiles = readdirSync(rawDir).filter((f) => /^(node_.*_)?flux_topology\.json$/.test(f));
let reporters = 0;
for (const f of topoFiles) {
  const t = readJson(f).data?.topology;
  if (!t) continue;
  for (const [k, v] of Object.entries(t)) {
    const a = ipToNode.get(norm(k));
    if (a === undefined) continue;
    reporters++;
    for (const p of [...(v.outbound ?? []), ...(v.inbound ?? [])]) {
      const b = ipToNode.get(norm(p));
      if (b === undefined || b === a) continue;
      edgeSet.add(a < b ? a * 65536 + b : b * 65536 + a);
    }
  }
}
const edges = [...edgeSet];
const meshA = new Uint32Array(edges.length);
const meshB = new Uint32Array(edges.length);
edges.forEach((e, i) => {
  meshA[i] = ids[Math.floor(e / 65536)];
  meshB[i] = ids[e % 65536];
});

// Pack columns 4-byte aligned.
const columns = [
  ['ids', ids],
  ['lat', lat],
  ['lon', lon],
  ['tier', tier],
  ['status', status],
  ['flags', flags],
  ['loc', loc],
  ['host', host],
  ['country', country],
  ['org', org],
  ['meshA', meshA],
  ['meshB', meshB],
  ['appOffsets', appOffsets],
  ['appInstances', Uint32Array.from(appInstances)],
];
let offset = 0;
const layout = {};
const chunks = [];
for (const [name, arr] of columns) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(new Uint8Array(pad));
    offset += pad;
  }
  layout[name] = { offset, length: arr.length, type: arr.constructor.name };
  chunks.push(bytes);
  offset += bytes.length;
}
const bin = Buffer.concat(chunks);
writeFileSync(join(out, 'flux-snapshot.bin'), bin);
writeFileSync(
  join(out, 'flux-snapshot.json'),
  JSON.stringify({
    source: 'Flux network snapshot, 2026-09-30 (public API dumps, IPs and collateral stripped)',
    generated: '2026-09-30T19:50:00Z',
    tip: TIP,
    count,
    hosts: hostIndex.size,
    reporters,
    layout,
    countries,
    orgs,
    locs: locTable,
    apps: appNames,
    note: 'flag bit4 (ArcaneOS) is synthesised at a 38% rate; all other flags derive from real heights and app locations.',
  }),
);
console.log({ nodes: count, hosts: hostIndex.size, locs: locTable.length, countries: countries.length, orgs: orgs.length, apps: apps.length, edges: edges.length, binBytes: bin.length });

#!/usr/bin/env node
// Builds web/public/data/admin1-lines.bin: the state and province boundaries the globe draws once the
// camera is down in a region (src/globe/engine/borders.ts decodes it, layers/borders.ts draws it).
//
//   node scripts/borders-admin1.mjs [--src file.geojson] [--out path] [--check] [--stats]
//
//   --src    a local copy of the source file (default: download the pinned release, cached in $TMPDIR)
//   --out    the asset to write (default: public/data/admin1-lines.bin)
//   --check  build in memory and exit 1 when the committed asset differs (nothing is written)
//   --stats  print the size of the asset per detail level
//
// Source. Natural Earth 1:10m "Admin 1 - States, Provinces" lines, release v5.1.2 of the official vector
// repository (public domain). The raw file is 21 MB and is never committed; the pinned URL and its
// SHA-256 make the build reproducible. Every run gives the same bytes.
//
// What the build does, in order.
//   1. Keeps the boundary classes and drops features without geometry.
//   2. Cuts away every stretch that runs along a coastline or a country border the globe already draws
//      (public/data/countries-50m.json, the very file the engine reads): the lines are internal
//      boundaries only, so nothing is drawn twice. Endpoints that stop close to such a line are moved
//      onto it, so a state line meets the coast instead of stopping a few pixels short of it.
//   3. Sorts every line into one of four detail levels from Natural Earth's own `MIN_ZOOM` (the map zoom
//      at which the line first belongs on a map): level 0 holds the first-order divisions of large
//      countries (US states, Canadian provinces), level 3 the finest municipal lines. The globe fades
//      each level in at its own zoom, so a dense country never turns into a mesh from far away.
//   4. Simplifies each line (Douglas-Peucker, a tolerance per level), rounds to 0.001 degree, drops
//      repeated points and repeated segments, and orders the lines by place so the deltas stay small.
//   5. Writes the lines as delta-coded varints (format below).
//
// File format (little-endian), read by decodeAdmin1 in src/globe/engine/borders.ts:
//   0   4 bytes   magic "FXA1"
//   4   u8        level count N
//   5   u8        0 (reserved)
//   6   u16       units per degree (1000)
//   8   N varints the number of lines of each level, level 0 first
//   ... the lines, level by level. Each line is a varint point count (at least 2), then that many points
//       as pairs of zigzag varint deltas (longitude, latitude) in units. The first point of a line is a
//       delta from the first point of the line before it ((0, 0) for the very first); the others are
//       deltas from the point before them. Units count from (-180, -90): longitude = x / 1000 - 180.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const SOURCE = {
  name: 'Natural Earth 1:10m Admin 1 - States, Provinces (lines)',
  release: 'v5.1.2',
  commit: 'f1890d9f152c896d250a77557a5751a93d494776',
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces_lines.geojson',
  sha256: '1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6',
};

/** Detail levels: a line belongs to the first level whose `maxZoom` covers its MIN_ZOOM; `tol` is in degrees. */
const LEVELS = [
  { maxZoom: 5.6, tol: 0.004 },
  { maxZoom: 7, tol: 0.006 },
  { maxZoom: 8.7, tol: 0.01 },
  { maxZoom: Number.POSITIVE_INFINITY, tol: 0.014 },
];
const UNITS = 1000;
/** A vertex this close to a drawn coastline or border (degrees) counts as lying on it. */
const ON_LINE_DEG = 0.01;
/** A line end this close to a drawn line (degrees) is moved onto it. */
const SNAP_DEG = 0.05;
/** Lines shorter than this (degrees) are not worth a draw call. */
const MIN_LENGTH_DEG = 0.012;

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const outPath = resolve(arg('out') ?? join(webDir, 'public', 'data', 'admin1-lines.bin'));
const countriesPath = join(webDir, 'public', 'data', 'countries-50m.json');

// ---------------------------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------------------------

async function readSource() {
  const local = arg('src');
  let bytes;
  if (local) {
    bytes = readFileSync(resolve(local));
  } else {
    const cache = join(process.env.TMPDIR || tmpdir(), `ne-admin1-lines-${SOURCE.release}.geojson`);
    if (existsSync(cache)) bytes = readFileSync(cache);
    else {
      console.error(`downloading ${SOURCE.url}`);
      const res = await fetch(SOURCE.url);
      if (!res.ok) throw new Error(`${SOURCE.url}: ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(cache), { recursive: true });
      writeFileSync(cache, bytes);
    }
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SOURCE.sha256) {
    throw new Error(`the source is not ${SOURCE.release}: sha256 ${sha}, expected ${SOURCE.sha256}`);
  }
  return JSON.parse(bytes.toString('utf8'));
}

// ---------------------------------------------------------------------------------------------
// The lines the globe already draws (coastlines and country borders), for the cut and the snap
// ---------------------------------------------------------------------------------------------

class DrawnLines {
  constructor(topo) {
    const [sx, sy] = topo.transform.scale;
    const [tx, ty] = topo.transform.translate;
    this.cell = 0.5;
    this.segs = [];
    this.grid = new Map();
    for (const arc of topo.arcs) {
      let x = 0;
      let y = 0;
      let prev = null;
      for (const [dx, dy] of arc) {
        x += dx;
        y += dy;
        const p = [x * sx + tx, y * sy + ty];
        if (prev) this.add(prev, p);
        prev = p;
      }
    }
  }

  add(a, b) {
    const id = this.segs.length;
    this.segs.push([a[0], a[1], b[0], b[1]]);
    const c = this.cell;
    const x0 = Math.floor(Math.min(a[0], b[0]) / c);
    const x1 = Math.floor(Math.max(a[0], b[0]) / c);
    const y0 = Math.floor(Math.min(a[1], b[1]) / c);
    const y1 = Math.floor(Math.max(a[1], b[1]) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 100000 + cy;
        const list = this.grid.get(key);
        if (list) list.push(id);
        else this.grid.set(key, [id]);
      }
    }
  }

  /** The closest point of any drawn line within `maxDeg` of (lon, lat), or null. Distances are ground distances. */
  nearest(lon, lat, maxDeg) {
    const c = this.cell;
    const kx = Math.cos((lat * Math.PI) / 180);
    const reach = Math.ceil(maxDeg / (c * Math.max(kx, 0.05)));
    const cx = Math.floor(lon / c);
    const cy = Math.floor(lat / c);
    let best = null;
    let bestD = maxDeg;
    for (let ix = -reach; ix <= reach; ix++) {
      for (let iy = -Math.ceil(maxDeg / c); iy <= Math.ceil(maxDeg / c); iy++) {
        const list = this.grid.get((cx + ix) * 100000 + (cy + iy));
        if (!list) continue;
        for (const id of list) {
          const [ax, ay, bx, by] = this.segs[id];
          const ex = (bx - ax) * kx;
          const ey = by - ay;
          const px = (lon - ax) * kx;
          const py = lat - ay;
          const len2 = ex * ex + ey * ey;
          const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len2)) : 0;
          const d = Math.hypot(px - ex * t, py - ey * t);
          if (d < bestD) {
            bestD = d;
            best = [ax + (bx - ax) * t, ay + (by - ay) * t];
          }
        }
      }
    }
    return best ? { dist: bestD, point: best } : null;
  }
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

function levelOf(minZoom) {
  const z = Number.isFinite(minZoom) ? minZoom : 99;
  return LEVELS.findIndex((l) => z <= l.maxZoom);
}

/** Every line of the source as { level, pts: [[lon, lat], ...] }. */
function readLines(geojson) {
  const lines = [];
  for (const f of geojson.features) {
    if (!f.geometry) continue;
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const level = levelOf(f.properties.MIN_ZOOM);
    for (const part of parts) {
      // A line never jumps across the antimeridian here; if one did, it would be split, not drawn across the map.
      let run = [];
      for (const p of part) {
        if (run.length && Math.abs(p[0] - run.at(-1)[0]) > 180) {
          if (run.length > 1) lines.push({ level, pts: run });
          run = [];
        }
        run.push([p[0], p[1]]);
      }
      if (run.length > 1) lines.push({ level, pts: run });
    }
  }
  return lines;
}

/**
 * Joins lines that continue each other. Natural Earth cuts a boundary into many parts; wherever exactly
 * two parts of the same level meet end to end they become one line, which saves a header per part and
 * lets the simplifier drop the vertex between them. Junctions of three or more lines stay as they are.
 */
function mergeLines(lines) {
  const nodeKey = (p) => `${p[0]},${p[1]}`;
  const ends = new Map();
  lines.forEach((line, i) => {
    for (const end of [0, 1]) {
      const key = `${line.level}|${nodeKey(end === 0 ? line.pts[0] : line.pts.at(-1))}`;
      const list = ends.get(key);
      if (list) list.push([i, end]);
      else ends.set(key, [[i, end]]);
    }
  });
  // The line that continues `line` past its end `end`, if the junction has exactly two ends.
  const partner = (i, end) => {
    const line = lines[i];
    const key = `${line.level}|${nodeKey(end === 0 ? line.pts[0] : line.pts.at(-1))}`;
    const list = ends.get(key);
    if (list?.length !== 2) return null;
    const other = list[0][0] === i && list[0][1] === end ? list[1] : list[0];
    return other[0] === i && other[1] === end ? null : other;
  };
  const used = new Uint8Array(lines.length);
  const out = [];
  const walk = (start, forward) => {
    // Appends the lines that follow `start`, leaving through its tail (forward) or its head (backward).
    const pts = [];
    let [i, end] = [start, forward ? 1 : 0];
    for (;;) {
      const next = partner(i, end);
      if (!next || used[next[0]]) return pts;
      used[next[0]] = 1;
      const seg = lines[next[0]].pts;
      // Entering at `next[1]`: the walk continues to the far end of that line.
      const ordered = next[1] === 0 ? seg : [...seg].reverse();
      pts.push(...ordered.slice(1));
      [i, end] = [next[0], next[1] === 0 ? 1 : 0];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const tail = walk(i, true);
    const head = walk(i, false);
    // The backward walk collects points in walking order; they precede the line when reversed.
    const pts = [...head.reverse(), ...lines[i].pts, ...tail];
    out.push({ level: lines[i].level, pts });
  }
  return out;
}

/** Cuts the stretches that run along a drawn line; moves the ends that stop near one onto it. */
function cutAndSnap(lines, drawn, report) {
  const out = [];
  for (const line of lines) {
    const pts = line.pts;
    const near = pts.map((p) => drawn.nearest(p[0], p[1], ON_LINE_DEG));
    let run = [pts[0]];
    const flush = () => {
      if (run.length > 1) out.push({ level: line.level, pts: run });
      run = [];
    };
    for (let i = 1; i < pts.length; i++) {
      const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
      const along = near[i - 1] && near[i] && drawn.nearest(mid[0], mid[1], ON_LINE_DEG * 2);
      if (along) {
        report.cut++;
        flush();
        run = [pts[i]];
      } else run.push(pts[i]);
    }
    flush();
  }
  // Snap the ends that stop near a drawn line (not on a bit of line so short that a snap would be its whole length).
  for (const line of out) {
    let length = 0;
    for (let i = 1; i < line.pts.length; i++) {
      length += Math.hypot(line.pts[i][0] - line.pts[i - 1][0], line.pts[i][1] - line.pts[i - 1][1]);
    }
    if (length < SNAP_DEG * 4) continue;
    for (const end of [0, line.pts.length - 1]) {
      const p = line.pts[end];
      const hit = drawn.nearest(p[0], p[1], SNAP_DEG);
      if (hit && hit.dist > 0) {
        line.pts[end] = hit.point;
        report.snapped++;
      }
    }
  }
  // A short line whose every vertex sits on a drawn line (a harbour island's boundary) is that line.
  return out.filter((line) => {
    const hugs = line.pts.every((p) => drawn.nearest(p[0], p[1], ON_LINE_DEG * 0.6) !== null);
    if (hugs) report.hugging++;
    return !hugs;
  });
}

/** Douglas-Peucker on one line; `tol` in degrees of ground distance. Returns the kept points. */
function simplify(pts, tol) {
  const n = pts.length;
  if (n <= 2) return pts;
  let meanLat = 0;
  for (const p of pts) meanLat += p[1];
  const kx = Math.cos(((meanLat / n) * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * kx);
  const ys = pts.map((p) => p[1]);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ex = xs[b] - xs[a];
    const ey = ys[b] - ys[a];
    const len2 = ex * ex + ey * ey;
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const px = xs[i] - xs[a];
      const py = ys[i] - ys[a];
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len2)) : 0;
      const d = Math.hypot(px - ex * t, py - ey * t);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const quant = (p) => [Math.round((p[0] + 180) * UNITS), Math.round((p[1] + 90) * UNITS)];

/** Quantizes, drops repeated points and segments already in the set, and returns the pieces that remain. */
function quantizeUnique(line, seen) {
  const q = [];
  for (const p of line.pts.map(quant)) {
    const last = q.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) q.push(p);
  }
  const pieces = [];
  let run = [];
  for (let i = 0; i < q.length; i++) {
    if (i === 0) {
      run.push(q[0]);
      continue;
    }
    const a = q[i - 1];
    const b = q[i];
    const key = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) {
      if (run.length > 1) pieces.push(run);
      run = [b];
    } else {
      seen.add(key);
      run.push(b);
    }
  }
  if (run.length > 1) pieces.push(run);
  return pieces.map((pts) => ({ level: line.level, pts }));
}

const lengthDeg = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s / UNITS;
};

/** Z-order of the line's first point on a 1 degree grid: neighbours end up next to each other. */
function placeKey(pts) {
  const x = Math.min(511, Math.floor(pts[0][0] / UNITS) + 0);
  const y = Math.min(255, Math.floor(pts[0][1] / UNITS) + 0);
  let key = 0;
  for (let b = 0; b < 9; b++) key += (((x >> b) & 1) * 2 + ((y >> b) & 1)) * 4 ** b;
  return key;
}

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

function pushVarint(out, value) {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}
const zigzag = (v) => (v >= 0 ? v * 2 : -v * 2 - 1);

function encode(byLevel) {
  const out = [0x46, 0x58, 0x41, 0x31, byLevel.length, 0, UNITS & 0xff, UNITS >> 8];
  for (const lines of byLevel) pushVarint(out, lines.length);
  let px = 0;
  let py = 0;
  for (const lines of byLevel) {
    for (const line of lines) {
      pushVarint(out, line.pts.length);
      let x = px;
      let y = py;
      for (let i = 0; i < line.pts.length; i++) {
        const [qx, qy] = line.pts[i];
        pushVarint(out, zigzag(qx - x));
        pushVarint(out, zigzag(qy - y));
        x = qx;
        y = qy;
        if (i === 0) {
          px = qx;
          py = qy;
        }
      }
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

const geojson = await readSource();
const topo = JSON.parse(readFileSync(countriesPath, 'utf8'));
const drawn = new DrawnLines(topo);
const report = { cut: 0, snapped: 0, hugging: 0 };

const raw = readLines(geojson);
const merged = mergeLines(raw);
const trimmed = cutAndSnap(merged, drawn, report);
const seen = new Set();
const byLevel = LEVELS.map(() => []);
let pointsIn = 0;
for (const line of raw) pointsIn += line.pts.length;
for (const line of trimmed) {
  const simple = { level: line.level, pts: simplify(line.pts, LEVELS[line.level].tol) };
  for (const piece of quantizeUnique(simple, seen)) {
    if (lengthDeg(piece.pts) >= MIN_LENGTH_DEG) byLevel[piece.level].push(piece);
  }
}
for (const lines of byLevel)
  lines.sort((a, b) => placeKey(a.pts) - placeKey(b.pts) || a.pts[0][0] - b.pts[0][0]);

const bytes = encode(byLevel);

if (flag('stats') || flag('check')) {
  let points = 0;
  let segments = 0;
  console.log(`${SOURCE.name}, ${SOURCE.release}`);
  console.log(`source lines ${raw.length} (${merged.length} once joined), points ${pointsIn}`);
  console.log(
    `cut along drawn lines: ${report.cut} segments and ${report.hugging} short lines, ends moved onto them: ${report.snapped}`,
  );
  byLevel.forEach((lines, level) => {
    const p = lines.reduce((a, l) => a + l.pts.length, 0);
    points += p;
    segments += p - lines.length;
    console.log(
      `level ${level} (to zoom ${LEVELS[level].maxZoom}, tolerance ${LEVELS[level].tol} deg): ${lines.length} lines, ${p} points, ${p - lines.length} segments`,
    );
  });
  console.log(`total: ${points} points, ${segments} segments`);
  const gz = gzipSync(bytes, { level: 9 }).length;
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  console.log(`size: ${bytes.length} bytes raw, ${gz} gzip, ${br} brotli`);
}

if (flag('check')) {
  const same = existsSync(outPath) && readFileSync(outPath).equals(bytes);
  console.log(
    same ? `${outPath} is up to date` : `${outPath} is out of date: run node scripts/borders-admin1.mjs`,
  );
  process.exit(same ? 0 : 1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);
console.log(`wrote ${outPath} (${bytes.length} bytes)`);

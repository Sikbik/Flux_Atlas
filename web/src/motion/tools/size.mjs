#!/usr/bin/env node
// The initial payload of a production build: the gzip size (level 9) of every script and stylesheet
// the built index.html loads up front, following static imports between chunks. Lazy chunks (the effect
// runners, the gallery, other routes) are not counted: they are not on the critical path.
//
// usage: npm run build && node src/motion/tools/size.mjs [dist]
//
// Rollup re-splits shared chunks when the module graph changes, so single files shift by a few hundred
// bytes between builds. Compare the total of two builds (before and after a change), not single files.

// biome-ignore-all lint/suspicious/noConsole: a command line tool reports on stdout

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const seen = new Map();
const queue = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  const p = join(dist, f);
  if (!existsSync(p)) continue;
  const buf = readFileSync(p);
  seen.set(f, { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length });
  if (f.endsWith('.js')) {
    // static imports only (`from"./x.js"`, `import"./x.js"`), not dynamic import("./x.js")
    for (const m of buf.toString('utf8').matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) {
      queue.push(`/assets/${m[1]}`);
    }
  }
}

let raw = 0;
let gz = 0;
for (const [f, s] of seen) {
  raw += s.raw;
  gz += s.gz;
  console.log(f.padEnd(44), String(s.raw).padStart(9), String(s.gz).padStart(8));
}
console.log('initial total'.padEnd(44), String(raw).padStart(9), String(gz).padStart(8));

#!/usr/bin/env node
// Builds the lab's texture and geography assets from public-domain sources.
//
//   node scripts/build-textures.mjs
//
// Downloads go to .cache/ (git-ignored) and the web-sized results land in public/.
// Requires ImageMagick (`magick`). Nothing is hotlinked at runtime.
//
// Sources (see README.md and public/licenses/ATTRIBUTION.txt for credits and terms):
//   Day      NASA Visible Earth, Blue Marble Next Generation with topography and bathymetry (Dec 2004)
//   Night    NASA Earth Observatory, Black Marble 2016 color map (VIIRS day/night band, Suomi NPP)
//   Clouds   NASA Visible Earth, composite cloud map
//   Borders  Natural Earth 1:50m and 1:110m (public domain), as TopoJSON via world-atlas

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
const tex = join(root, 'public', 'textures');
const data = join(root, 'public', 'data');
mkdirSync(cache, { recursive: true });
mkdirSync(tex, { recursive: true });
mkdirSync(data, { recursive: true });

const SOURCES = {
  day: {
    file: 'bluemarble_5400.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
  },
  night: {
    file: 'blackmarble_2016_3km.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
  },
  clouds: {
    file: 'clouds_2048.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg',
  },
};

async function fetchTo(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 1000) return;
  console.log('download', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  (await import('node:fs')).writeFileSync(dest, buf);
}

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' });

for (const s of Object.values(SOURCES)) await fetchTo(s.url, join(cache, s.file));

// Day map: 4096 for desktop, 2048 for mobile / low quality.
for (const w of [4096, 2048]) {
  magick(join(cache, SOURCES.day.file), '-resize', `${w}x`, '-quality', w > 2048 ? '80' : '82', '-sampling-factor', '4:2:0', '-strip', join(tex, `earth_day_${w}.jpg`));
}
// Night map: lights survive downsampling better with a slight unsharp pass.
for (const w of [4096, 2048]) {
  magick(join(cache, SOURCES.night.file), '-filter', 'Lanczos', '-resize', `${w}x`, '-unsharp', '0x0.6+0.6+0.02', '-quality', '86', '-strip', join(tex, `earth_night_${w}.jpg`));
}
// Clouds: one grey channel is enough.
magick(join(cache, SOURCES.clouds.file), '-colorspace', 'Gray', '-quality', '78', '-strip', join(tex, 'earth_clouds_2048.jpg'));

// Natural Earth TopoJSON (world-atlas 2.0.2, ISC license wrapper, Natural Earth public domain).
const atlas = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/';
for (const f of ['land-110m.json', 'land-50m.json', 'countries-110m.json', 'countries-50m.json']) {
  await fetchTo(atlas + f, join(cache, f));
  copyFileSync(join(cache, f), join(data, f));
}
console.log('done');

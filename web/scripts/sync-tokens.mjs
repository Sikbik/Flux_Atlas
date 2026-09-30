#!/usr/bin/env node
// Copies the design system's source of truth into the web app:
//   docs/design/tokens.css   -> web/src/styles/tokens.css
//   docs/design/tokens.json  -> web/src/styles/tokens.json   (the globe reads --globe-* offline)
//   docs/design/fonts/*      -> web/src/styles/fonts/*       (woff2 + licences), with fonts.css
//     (falls back to docs/design/mock/assets/fonts until the design team ships a fonts/ folder)
//
// usage: node scripts/sync-tokens.mjs [--from <design dir>] [--check]
//   --from   design directory (default: $ATLAS_DESIGN_DIR, then <repo>/docs/design)
//   --check  do not write; exit 1 if the web copies are out of date
//
// The copies are committed so the app builds without docs/design present. Never edit them by
// hand: change docs/design first, then run `npm run sync-tokens`.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const repoDir = resolve(webDir, '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const check = argv.includes('--check');
const designDir = resolve(arg('from') ?? process.env.ATLAS_DESIGN_DIR ?? join(repoDir, 'docs', 'design'));
const stylesDir = join(webDir, 'src', 'styles');
const fontsOut = join(stylesDir, 'fonts');

const HEADER =
  '/* Synced from docs/design by web/scripts/sync-tokens.mjs. Do not edit; change docs/design. */\n';

const digest = (buf) => createHash('sha256').update(buf).digest('hex');
let stale = 0;
let written = 0;

function put(dest, content) {
  const next = typeof content === 'string' ? Buffer.from(content) : content;
  const prev = existsSync(dest) ? readFileSync(dest) : null;
  if (prev && digest(prev) === digest(next)) return;
  stale += 1;
  if (check) {
    console.log(`out of date: ${dest}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, next);
  written += 1;
  console.log(`wrote ${dest}`);
}

if (!existsSync(join(designDir, 'tokens.css'))) {
  const have = existsSync(join(stylesDir, 'tokens.css'));
  const msg = `sync-tokens: no tokens.css in ${designDir}`;
  if (have) {
    console.warn(`${msg}; keeping the committed copy in src/styles.`);
    process.exit(0);
  }
  console.error(`${msg}, and src/styles/tokens.css does not exist. Pass --from <design dir>.`);
  process.exit(1);
}

put(join(stylesDir, 'tokens.css'), HEADER + readFileSync(join(designDir, 'tokens.css'), 'utf8'));
if (existsSync(join(designDir, 'tokens.json'))) {
  put(join(stylesDir, 'tokens.json'), readFileSync(join(designDir, 'tokens.json')));
}

// Fonts: prefer a dedicated docs/design/fonts folder; fall back to the mock's assets.
const fontSources = [
  { dir: join(designDir, 'fonts'), css: join(designDir, 'fonts', 'fonts.css') },
  { dir: join(designDir, 'mock', 'assets', 'fonts'), css: join(designDir, 'mock', 'assets', 'fonts.css') },
];
const fonts = fontSources.find((s) => existsSync(s.dir));
if (fonts) {
  for (const name of readdirSync(fonts.dir)) {
    if (/\.(woff2|txt)$/i.test(name)) {
      const src = join(fonts.dir, name);
      const dest = join(fontsOut, name);
      if (check) put(dest, readFileSync(src));
      else if (!existsSync(dest) || digest(readFileSync(dest)) !== digest(readFileSync(src))) {
        mkdirSync(fontsOut, { recursive: true });
        copyFileSync(src, dest);
        stale += 1;
        written += 1;
        console.log(`wrote ${dest}`);
      }
    }
  }
  if (existsSync(fonts.css)) {
    // Both layouts reference the files as ./fonts/<name> relative to the css file, as we do.
    const css = readFileSync(fonts.css, 'utf8').replace(/url\((["']?)\.\/(?:fonts\/)?/g, 'url($1./fonts/');
    put(join(stylesDir, 'fonts.css'), HEADER + css);
  }
} else {
  console.warn('sync-tokens: no fonts found in the design directory; the app falls back to system fonts.');
}

if (check) {
  if (stale > 0) {
    console.error(`sync-tokens: ${stale} file(s) out of date. Run npm run sync-tokens.`);
    process.exit(1);
  }
  console.log('sync-tokens: up to date');
} else {
  console.log(`sync-tokens: ${written} file(s) written from ${designDir}`);
}

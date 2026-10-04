# Flux Atlas web app

React 19 + TypeScript (strict) + Vite. The logic foundation of the live-first frontend: typed API
layer, binary snapshot decoders, the WebSocket live client, the NetworkStore, the choreographer core,
the shared event clock and formatters, a typed route tree for the whole IA, and a `/dev/live`
inspector. The globe (`src/globe`: the three.js engine ported from `labs/globe`, its bindings to the
live runtime and the URL, labels and tethers) and the shell core (`src/shell`: the window manager and
the structural frame) are in; the designed shell and feature views come next. The visual system comes
from `docs/design` through `src/styles/tokens.css`.

## Run it

You need Node 26 + npm, the Rust toolchain (`export PATH="$HOME/.cargo/bin:$PATH"`), and for the
end-to-end test a system Chromium at `/usr/bin/chromium` (or set `CHROMIUM`).

```sh
# 1. The dev backend: the real API server and live hub over a mainnet-sized fixture network
#    (6,724 nodes, 1,900 apps) with a synthetic live stream. Listens on 127.0.0.1:3000.
cargo run -p atlas-server --example demo_server
#    Faster blocks for demos and debugging (default 30000):
ATLAS_DEMO_BLOCK_MS=5000 cargo run -p atlas-server --example demo_server

# 2. The web app (Vite proxies /api, /ws and /healthz to 127.0.0.1:3000).
cd web
npm install
npm run dev            # http://127.0.0.1:5173, the live inspector at /dev/live
```

Point the dev server elsewhere with `ATLAS_API_TARGET=http://host:port npm run dev`. The demo server
also serves `web/dist` itself (debug builds read the directory at run time), so after
`npm run build` the app is available at http://127.0.0.1:3000 directly.

### The demo server

`crates/atlas-server/examples/demo_server.rs` starts the fixture engine and emits, through
`EngineHandle::emit` with the exact `LiveBody` variants (so seq, replay, resync and fan-out behave as
in production):

| Stream | Cadence | Content |
|---|---|---|
| `block` | `ATLAS_DEMO_BLOCK_MS` (default 30 s, jittered 15%) | producer, three tier payouts from local payment queues, 13 to 16 heartbeats, occasional initial confirms, starts and large transfers, 0.3 to 1.5 s detection latency |
| `nodes` | after each block; a rank `reconcile` every 20 blocks; expiries and removals | payees, heartbeats, joins, starts, expiries |
| `next_payees` | after each block (and once at start) | queue heads of the next height |
| `mempool` | about 23 per minute | 91% node transactions, the rest transfers |
| `app_pending` / `app_pending_resolved` / `apps` / `app_installing` | every 20 to 60 s (scaled with the block cadence) | pending, mined (85%) or expired, upsert, installs, instance spawns and removals |
| `mesh` | every 12 s (scaled) | added and removed edges per simulated sweep call |
| `stats`, `feed` | per block and every 10 s | summary with a synthetic price; activity items |

The snapshot bodies (`/bootstrap`, `/nodes.bin`, `/mesh.bin`, `/apps`) are republished after every
block, so a resync always lands on current data. Env: `ATLAS_DEMO_BIND`, `ATLAS_DEMO_BLOCK_MS`,
`ATLAS_DEMO_SEED`, `ATLAS_LOG`. Ctrl+C shuts down gracefully (clients see close code 1001).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on 127.0.0.1:5173 with the API proxy |
| `npm run build` | typecheck, then the production build into `dist/` |
| `npm run preview` | serve `dist/` with the same proxy (port 4173) |
| `npm run typecheck` | `tsc --noEmit` (TypeScript 7, strict) |
| `npm run lint` | Biome (lint and format check) |
| `npm test` | Vitest: decoders (golden), store, live client, choreographer, formatters, clock, benchmarks |
| `npm run e2e` | builds a test build (`VITE_ATLAS_TEST=1`, `dist-e2e/`), starts `demo_server` (3 s blocks) and `vite preview`, loads the app in headless Chromium (SwiftShader), asserts the socket goes live, a block arrives, the globe draws ~6.7k nodes and plays a Beat, windows follow the URL without remounting the globe, the Explorer, Nodes and Apps launchers open their landings, a lost WebGL context recovers, every route renders, and a server restart is survived |
| `node scripts/globe-check.mjs fps` | real-GPU frame rate and frame times at 2560 x 1440 (`--w --h --path --seconds --base`) with the engine's GPU-synced cost per frame |
| `node scripts/globe-frame-check.mjs` | real-GPU framing check: the planet's projected disc against the free area (top bar, dock, block rail) across 13 DPRs (`--dprs`, `--device 2560x1440`), with the maximal middle-drag pitch, home, runtime zoom, resizes, windows, the ambient round trip and a context lost for good (`--quick` skips those; `--shots DIR`) |
| `node scripts/globe-check.mjs soak` | heap after forced GC once a minute while routes churn for `--minutes` (default 10) |
| `npm run shot -- /dev/live out.png --base http://127.0.0.1:5173` | screenshot tool (playwright-core + system Chromium) |
| `npm run sync-tokens` | copies `docs/design/tokens.css`, `tokens.json` and the fonts into `src/styles/` (`--from <dir>`, `--check`) |
| `node scripts/borders-admin1.mjs` | rebuilds `public/data/admin1-lines.bin`, the state and province lines the globe draws once the camera is down (Natural Earth 1:10m admin-1, release v5.1.2, public domain). It downloads the pinned release, checks its SHA-256, cuts what the coastlines and country borders already draw, simplifies and packs it. `--src <file>` uses a local copy, `--stats` prints the size per detail level, `--check` exits 1 when the committed file is stale. The raw 21 MB source is never committed |

`npm run e2e` compiles the demo server on first use; set `ATLAS_DEMO_BIN` to a prebuilt binary to
skip cargo, and `CARGO_TARGET_DIR` as usual.

## Layout

```
src/
  api/        generated/ (ts-rs output from Rust, never hand-edited), http.ts, endpoints.ts,
              queryKeys.ts, queries.ts, liveInvalidation.ts, nodesBin.ts, meshBin.ts, bin/, live.ts
  store/      network.ts (NetworkStore), nodeTable.ts, ring.ts, react.ts, ui.ts (zustand prefs)
  choreo/     effects.ts (EffectSink), choreographer.ts
  lib/        clock.ts (event clock, beat), useClock.ts, format.ts, scheduler.ts
  app/        App.tsx, router.tsx (route tree), runtime.ts, context.tsx, errors.tsx, search.ts,
              placeholders/ (neutral views every route renders until the designed windows land)
  features/   dev/LiveInspector.tsx (/dev/live)
  globe/      engine/ (the three.js renderer, a lazy chunk), GlobeCanvas.tsx (mounted once as the living
              wallpaper), bindings.ts (store + URL -> engine; engine -> intents), anchors.ts (labels,
              tooltips and tethers from one loop), context.tsx (hooks), overlays.tsx, stats.ts
  shell/      wm/ (window-manager core: state machine, route binding, minimal frame; see wm/README.md),
              frame/ (structural regions: top bar, dock, stage, rail, status bar, phone tabs),
              windowContent.tsx (what `?w=` extra windows render)
  styles/     tokens.css, tokens.json, fonts (synced), global.css (neutral, token-driven)
  testing/    fixtures for unit tests and benchmarks
```

## How the live pieces fit

```
                 resync(): GET /bootstrap + /nodes.bin (+ /mesh.bin) -> store.loadSnapshot
                                         ^
 WebSocket /ws -> LiveClient ---------> onMessage(msg)
                  hello, sub, dedupe,      |-> store.apply(msg)          state first
                  replay/resync, backoff,  |-> clock.setLastBlock(...)   the 30 s beat
                  watchdog, latency        |-> choreo.handle(msg)        timed effects -> EffectSink
                                           '-> invalidate(msg)           TanStack Query keys
```

- **NetworkStore** (`store/network.ts`): `loadSnapshot`, `apply(msg)`, `setConnection`,
  `setMempool`, `loadMesh`, `prune`, `subscribe(fn(change))` for the globe (change sets carry added,
  removed and changed node ids plus `NodeField` bits), `batch`, `version` and per-slice `versions`,
  and cached derived reads (`blocks.toArray()`, `feed.toArray()`, `meshEdges()`, `pendingList()`,
  `mempoolList()`, `appList()`). Nodes are columns in `store.nodes` (`ids`, `lat`, `lon`, `tier`,
  `status`, `flags`, `loc`, `rank`, `lastPaid`, `lastConfirmed`, ...; use `count`, `indexOf(id)`,
  `endpoint(i)`, `countryCode(i)`). React reads through `useNetwork(selector, equality)`.
- **LiveClient** (`api/live.ts`): `start`, `stop`, `setWatch`, `setWatchApps`, `setTopics`,
  `requestResync`, `reconnectNow`, `metrics()`, `onStatus`, `serverNow()`.
- **Choreographer** (`choreo/choreographer.ts`): `handle(msg)`, `setFocus(ids)`, `setMotion`,
  `setVisible`, `stats`, `dispose`. The renderer implements `EffectSink` (`beat`, `uplink`,
  `moonFlare`, `downlink`, `payoutLanded`, `devFund`, `heartbeats`, `pulse`, `aim`, `clearAim`,
  `app`, `links`, `summary`, `reorg`, `recap`) and attaches with `runtime.setEffectSink(sink)`.
- **Event clock** (`lib/clock.ts`): one 1 Hz timer for every "N s ago" label; `beat()` gives the
  next-block progress and the late/quiet phases; `useNow`, `useAgo`, `useBeat` for React.

## Conventions

- Clean-room: nothing from v1 (`frontend/`, `backend/`).
- No emoji anywhere (code, comments, copy, docs, commits).
- Visuals are token-driven only: never hard-code colours or fonts; the designers own the look.
- `src/api/generated` is produced from Rust (`ts-rs`); change the Rust types, never these files.

## The globe

`GlobeCanvas` (in the root layout, outside every route) creates the engine once: `import('./engine')`
is its own chunk, so the shell and the boot veil paint before three.js arrives. It never unmounts while
the user navigates; a lost WebGL context is answered with a fresh engine on a fresh canvas (state comes
back from the store and the URL). Preferences (`store/ui.ts`): the art style `globeArt` (`marble`
default, `holo` = the dot-matrix planet, `neon`), the performance tier (`auto` lets the engine's
governor lower the render scale, then the tier; the lite tier always draws the dot matrix; software GL
starts there), and motion (`system` follows `prefers-reduced-motion`).

`bindings.ts` is the only place the app talks to the engine about data (unit-tested with a fake engine):

| Source | Engine |
|---|---|
| `store.loadSnapshot` / change sets | `setNodes` keyed by id (rows are unordered after deltas), `updateNodes` (added, removed, tier/status/flags), relocation for geo changes |
| `mesh.bin`, `mesh` deltas | `setMesh`, `updateMesh` |
| recent blocks | `seedMoonChain` (once) |
| `tier`, `cc`, `org`, `ver`, `arcane`, `watched` | `setFilter` (masks plus an id allow-list) |
| `l=mesh.off,mesh.sel,mesh.flow` | `setMeshMode` (default `selection`) |
| `/node/$key`, `?sel=` | `select` (flies on `/node`) |
| `/app/$name` | `showAppConstellation` (instances from the app API) |
| `/host/$ip` | `flyTo` the host's site, close enough to fan the stack |
| `/ambient` | `setMode('ambient')`: the moon blends from companion to orbit (900 ms) |
| watchlist | `setWatched` |
| the choreographer | `runtime.setEffectSink(shiftSink(engine.sink))` |
| engine `select` / `hover` / `moonclick` / `wake` | intents (navigate to `/node/$key`, clear the selection, `/about`, leave ambient) and the hover signal |

Node ids: the server interns ids from 0 and the engine reserves 0, so every id crossing the boundary
is shifted by one (`toEngineId`, `shiftSink`); app code only ever sees store ids.

Labels, tooltips and tethers use the anchor system (`anchors.ts`): `useGlobeAnchor(ref, anchor)`,
`<GlobeLabel anchor>`, `<Tether from to>`. Anchors are world points (`engine.labelAnchors()`
projects them once per frame, occlusion-culled behind the planet), nodes, the moon (its centre or the
About tether point) and DOM elements. One loop, run on the engine's `frame` event, writes transforms
directly: no React render per frame. Labels in a group are collision-culled and kept off the moon.

`window.__atlasGlobeStats` (dev builds and `VITE_ATLAS_TEST=1`): nodes drawn, fps, frame and CPU ms,
Beats, payouts, downlinks, quality, render scale, art, frames. `window.__atlasGlobe` adds the engine
and `loseContext()` / `restoreContext()` for tests.

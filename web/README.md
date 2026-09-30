# Flux Atlas web app

React 19 + TypeScript (strict) + Vite. The logic foundation of the live-first frontend: typed API
layer, binary snapshot decoders, the WebSocket live client, the NetworkStore, the choreographer core,
the shared event clock and formatters, a typed route tree for the whole IA, and a `/dev/live`
inspector. The globe engine (`src/globe`) and the shell (`src/shell`) are placeholders reserved for
the next work packages; the visual system comes from `docs/design` through `src/styles/tokens.css`.

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
| `npm run e2e` | starts `demo_server` (3 s blocks) and `vite preview`, loads the app in headless Chromium, asserts the socket goes live, a block arrives, every route renders, and a server restart is survived |
| `npm run shot -- /dev/live out.png --base http://127.0.0.1:5173` | screenshot tool (playwright-core + system Chromium) |
| `npm run sync-tokens` | copies `docs/design/tokens.css`, `tokens.json` and the fonts into `src/styles/` (`--from <dir>`, `--check`) |

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
  globe/      placeholder: the globe engine port lands here
  shell/      placeholder: the shell lands here
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

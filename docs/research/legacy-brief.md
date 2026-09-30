# Flux Atlas v1 — Legacy Brief

Analysis of v1 at commit `c1e1ed9` (branch `development`, 20 commits, 2025-10-07 → 2026-03-02).
~8.6k LOC: backend 2.3k TS, frontend 6.3k (of which ~2.6k is CSS). **No tests, no CI, no lockfiles.**
All `path:line` refs are relative to the repo root. Read this file instead of v1; open v1 only to confirm a fact.

> **Reference only — clean-room rule.** v2 is a whole rewrite. Do not port, copy, or adapt any v1 code,
> formulas, layouts, styles, or structure. Use this brief only to understand the product's purpose and
> to learn facts about the Flux network and its APIs. The "Lessons for v2" items below are observations about
> *problems to solve*, not implementations to reuse.


---

## 1. Purpose, audience, and what it promises

Flux Atlas v1 is a **peer-topology graph** of the Flux network, not a map. Every 30 minutes a backend crawls
every FluxNode's own HTTP API for its P2P peer lists. It turns those lists into a node/edge graph, precomputes
the 2D and 3D force layouts, and serves one JSON blob. A React SPA renders that blob as a 2D WebGL graph
(Sigma) or a 3D orbitable graph (three.js via react-force-graph-3d). The audience is Flux node operators and
community members who want to find their node (by IP, payment address, collateral, or app name) and look at
its peers, tier, ArcaneOS status, bandwidth benchmark, and installed apps, plus network-wide totals (node
count, tier split, ArcaneOS adoption, app instances). What it promises (`README.md:1-25`, `frontend/index.html:12`):
"real-time" visualization of 8,000+ nodes at 60fps, search/highlight, hub/bridge detection, and ArcaneOS
tracking. In practice data is 30–60 min stale, and the "bridge" detection does not exist; there is only a
degree-centrality hub flag.

There is **no geolocation, no globe, no block explorer, no per-app view, no history/time series, and no
explorer-API usage**. All of those are net-new in v2.

---

## 2. Feature inventory

**Routing.** There is no router. `viewMode` state is `null` (landing), `'2d'` or `'3d'` (`frontend/src/App.tsx:43-53`).
Every load starts on the landing page (`App.tsx:26-28`). There are no URL deep links and no browser-history integration.

| Feature | Details | Refs |
|---|---|---|
| **Landing page** | Hero ("Flux Network Atlas"), live counters for **Active Nodes** (`stats.totalFluxNodes`) and **App Instances** (sum of `instances` over global app specs), with a cubic-ease 2 s count-up animation; two cards: "2D Topographic" and "3D Immersive" | `frontend/src/components/LandingPage.tsx:135-565`, counter `:108-133` |
| Landing background | Canvas particle field (≤150 particles, O(n²) proximity lines <120px, cyan/purple), mouse-parallax gradient + 3 orbs, grid/noise/vignette layers, staggered entrance (4 phases, 100–1000 ms) | `LandingPage.tsx:14-105,229-250,259-286` |
| Landing loading state | Polls `/api/status` every **2 s** while node count unknown; shows `"<stage> <pct>%"` from backend progress; on completion fetches `/api/state` and calls parent `refresh` | `LandingPage.tsx:170-227` |
| Landing gating | 2D/3D buttons stay disabled until **both** node count and app instances load | `LandingPage.tsx:253-255,373-377` |
| **2D graph** | Sigma v3 WebGL over graphology (undirected, non-multi). Only `kind==='flux'` nodes with ≥1 edge or connectionCount>0. Edges deduped to unordered pairs. Positions come from backend `position` and are renormalized to a centered [0,1] box | `frontend/src/components/GraphCanvas.tsx:67-106,155-319` |
| 2D node size | `0.4 + ln(1+connectionCount)*0.18 + sqrt(centrality)*0.7`, ×1.25 hub, ×0.6 mobile, clamp [0.4, 3.0] | `GraphCanvas.tsx:19-28` |
| 2D edges | Always in the graph but drawn **transparent** (`#00000000`, size 0.1). On select, connected edges are shown (`#2E68FF` flux-flux / `#7E98D1` stub, size 0.8), non-neighbors are dimmed (hex+`33` alpha) | `GraphCanvas.tsx:194-208,321-372`, dim `:30-52` |
| 2D camera | Initial `{x:.5,y:.5}`, ratio 0.8 desktop / 0.4 mobile (<768px), set before first render; ratio range 0.02–5; labels off, edge events off | `GraphCanvas.tsx:214-233` |
| 2D picking | Desktop: Sigma `clickNode`/`clickStage`, hover tooltip follows cursor. Touch: custom `touchstart` nearest-node search within **40 px** (O(n) scan) | `GraphCanvas.tsx:235-304` |
| **Node tooltip** (2D and 3D) | IP (or id), tier chip, HUB chip, ARCANE chip, Outgoing / Incoming / Apps counts, "Click to select". In 2D the tooltip for a selected node is pinned at top-center | 2D `GraphCanvas.tsx:439-538`; 3D HTML string `GraphCanvas3D.tsx:245-303` |
| **3D graph** | `react-force-graph-3d`. Uses backend `position3d` as fixed `fx/fy/fz`; warmup/cooldown 0, alpha/velocity decay 1 (no client simulation); links invisible; orbit controls; node drag off; transparent bg | `frontend/src/components/GraphCanvas3D.tsx:39-79,240-409` |
| 3D nodes | One `THREE.Sprite` per node with a shared 128px canvas circle texture and a **per-node SpriteMaterial**. Size `max(1.5, 0.5+ln(1+conn)*0.3)`, ×1.2 mobile, ×1.5 when selected/highlighted (gold `#FFD700`). Sprite cached on `node.__sprite` (leak fix `e2dac89`) | `GraphCanvas3D.tsx:82-108,316-351` |
| 3D selection | Builds a `LineSegments` (cyan, 0.7 opacity) of the selected node's edges and adds it to the scene; click flies the camera to the node (distance 80, or 120 on mobile, 1 s) | `GraphCanvas3D.tsx:185-236,375-392` |
| 3D camera | Radius = max node distance from origin; initial/reset z = radius×0.6 (desktop) / ×0.78 (mobile); "Orbit View" goes to `(0.8r, 0.5r, 2r)`; zoom ±30/40% along view vector | `GraphCanvas3D.tsx:111-182,396-408` |
| **Graph controls** (both views) | Zoom in/out, Orbit View (fit), Reset (also clears selection), Help popover (touch vs mouse gestures), Tier/Arcane color toggle, legend, "N nodes • M edges" | `frontend/src/components/GraphControls.tsx:43-191` (help `:109`, toggle `:154`, legend `:169`, stats `:183`) |
| **Color schemes** | `tier`: Cumulus `#4da6ff`, Nimbus `#b388ff`, Stratus `#ff8f4d`, Unknown `#7d89b0`. `arcane`: ARCANE `#61f2ff`, everything else `#ffd166`. Stubs `rgba(148,163,211,.45)` | `frontend/src/theme.ts:14-44` |
| **Search** | Case-insensitive substring over `meta.ip`, `paymentAddress`, `collateral`, app names, and tier. Minimum 2 chars. Debounce 400 ms (<3 chars) / 150 ms. Every match is highlighted gold at 2× size. List paginated 25 per page | `App.tsx:55-62,121-158`; UI `frontend/src/components/Sidebar.tsx:96-183` |
| **Sidebar** | Title + "Latest network scan: HH:MM" (pulses while building), API error box, search, stat cards (Flux Nodes, Hubs, Edges), **ArcaneOS Adoption** bar + toggle, **Tier Presence** list, **Node Spotlight** | `Sidebar.tsx:61-266` |
| **Node Spotlight** | IP with `:port` accent; tier/status/HUB badges; outgoing/incoming peers; download/upload speed; installed-app count (hover list plus a click modal with name and description); payment address; collateral; frontend URL link; RPC endpoint; last confirmed block | `frontend/src/components/NodeDetails.tsx:11-285` |
| **Rebuild notice** | The app polls `/api/status` every **10 s**. While building it shows "Scanning the Network..." (top-right, non-blocking). When a new `buildId` appears it shows "Rebuild Complete! Refresh Now", which runs `window.location.reload()` and sends the user back to the landing page | `App.tsx:67-116,169-174,230-245`; CSS `App.css:190` |
| Chrome | Home button (back to landing), mobile sidebar edge-tab + backdrop, footer with click-to-copy donation address `t3aYE1U7yncYeCoAGmfpbEXo3dbQSegZCSP` and GitHub link | `App.tsx:247-326` |
| Responsive | Desktop grid `1fr 400px` (`App.css:75`), `100dvh`; breakpoints 1024/640 (`App.css:1406,1480`), landing 768/480 plus short-height rules (`LandingPage.css:892-1073`); `prefers-reduced-motion` honored | — |

**Settings:** the only user setting is the color scheme (tier/arcane), held in memory and not persisted. There are no tier/status filters, no edge toggles, and no theme switch.

---

## 3. Data sources

### 3.1 Endpoints called

| # | Caller | URL | When | Timeout | Response fields actually used |
|---|---|---|---|---|---|
| 1 | backend | `GET https://api.runonflux.io/daemon/listfluxnodes` (base + endpoint configurable) | once per build | max(rpcTimeout, 15 s) | `ip`, `collateral`, `tier`, `payment_address`, `last_confirmed_height` (`backend/src/services/fluxApi.ts:57-74`, `atlasBuilder.ts:906-941`) |
| 2 | backend → **every node** | `GET {proto}://{host}:{port||16127}/flux/connectedpeers` | per node per build | rpcTimeout | `data[]` (string `ip[:port]` or `{ip}`), used as **outgoing edges** (`fluxApi.ts:165-184`) |
| 3 | backend → every node | `GET …/flux/incomingconnections` | per node, in parallel with #2 | rpcTimeout | `data[]` **length only** (the incoming count); no edges are created from it (`fluxApi.ts:169-191`, `atlasBuilder.ts:422-428`) |
| 4 | backend → alive nodes | `GET …/flux/isarcaneos` | only if #2 or #3 succeeded; can be disabled | min(rpcTimeout, 3 s) | `data: boolean` → ARCANE / LEGACY; no answer → UNVERIFIED (`fluxApi.ts:211-232`, `atlasBuilder.ts:55-59`) |
| 5 | backend → alive nodes | `GET …/benchmark/getbenchmarks` | same | 3 s | `data.download_speed`, `data.upload_speed` only (`fluxApi.ts:215-240`) |
| 6 | backend → alive nodes | `GET …/apps/installedapps` | same | 3 s | `data[].name, description, version, owner` (`fluxApi.ts:219-250`) |
| 7 | **browser** (landing) | `GET https://api.runonflux.io/apps/globalappsspecifications` | once per landing mount | none | `Σ data[].instances` (the "App Instances" counter) (`LandingPage.tsx:143-167`) |

Every response is checked for `status === 'success'`. No request sends projections or query params. The explorer
API is never called, and v1 reads no block, tx, or chain data beyond the heights in #1.

**Live check (2026-09-30):** `listfluxnodes` returned **6,724 nodes** (Cumulus 3,378 / Stratus 1,764 / Nimbus 1,582) in a
**4.2 MB** JSON. Record shape:
`{collateral:"COutPoint(<txid>, <n>)", txhash, outidx:"159", ip:"5.230.173.203"|"1.2.3.4:16137"|"", network:"ipv4",
added_height, confirmed_height, last_confirmed_height, last_paid_height, tier:"CUMULUS", payment_address, pubkey,
activesince:"<unix str>", lastpaid:"<unix str>", amount:"1000.00", rank}`.
Of these, 4,328 (64%) carry an explicit `:port` (UPnP), only **2,655 distinct hosts** exist (max 8 nodes per host), and
12 have an empty `ip`. `activesince` and `lastpaid` are **strings**, although v1 types them as numbers (`backend/src/types/atlas.ts:25-26`).

### 3.2 Crawl mechanics (`backend/src/services/fluxApi.ts:94-283`)
- Concurrency uses `p-limit(maxWorkers)` (code default 50, Docker 24). The crawl is 7k nodes × 2–5 requests.
- **Two-phase fail-fast.** Phase 1 fetches the two peer lists in parallel. Metadata (phase 2) is only probed if phase 1
  answered, so dead nodes cost one timeout window and nothing more.
- **SSRF guard.** RFC1918, loopback, link-local, multicast, reserved, and unparsable hosts are skipped (`backend/src/utils/net.ts:71-136`).
- Peer sanitation keeps `:port` (needed for UPnP) and drops self-peers by host (`fluxApi.ts:78-92`).
- **Cache.** `data/peer_cache.json` = `{timestamp, data: PeerFetchResult[]}` (pretty-printed) with a **1 h TTL**. A fresh cache is
  returned **as-is and ignores the node list that was just fetched** (`fluxApi.ts:98-124`).
- Progress is reported as 5% (list), 15→70% (scan, `completed/total`), 70% (graph), 95%, then 100% (`atlasBuilder.ts:1201-1251`).

### 3.3 Identity, tier, apps, geo
- **Node ID** is the `collateral` string verbatim (`"COutPoint(txid, n)"`). Stubs fall back to the normalized IP (`net.ts:56-60`).
  This handles several nodes behind one IP. The IP is not unique: 2,655 hosts serve 6,724 nodes.
- **Peer→node resolution** is UPnP-aware (`atlasBuilder.ts:273-365`). It builds a map from `host`, `host:port`, and `host:16127`
  to `[nodeIds]`. Lookup order is exact `ip:port`, then `ip:16127` (if no port), then bare `ip`. If several nodes match,
  it picks one with a **seeded RNG**, so edges to co-hosted nodes are *arbitrarily* assigned. Unmatched peers are dropped, or
  become `stub` nodes when `FLUX_INCLUDE_EXTERNAL_PEERS=true`.
- **Tier** is the `record.tier` string upper-cased and mapped to CUMULUS/NIMBUS/STRATUS; anything else becomes UNKNOWN (`atlasBuilder.ts:43-53`).
  There is no benchmark-based tier detection.
- **App→node mapping** exists only as a per-node attribute from #6, and only for nodes that answered RPC. There is no app→nodes index,
  and search just scans the nodes. The global app specs are used only for the instance total.
- **Ports.** RPC is `host:(port||16127)`. The frontend URL is `http://host:(apiPort-1)`, e.g. 16126 (`atlasBuilder.ts:906-935`).
- **Geolocation: none.** v1 has no lat/lon source.

---

## 4. Backend architecture

**Stack:** Node 20, ESM TypeScript, **Express 5**, undici fetch (custom Agent; `rejectUnauthorized=!allowInsecureSSL`),
zod (env parsing only), d3-force, d3-force-3d, seedrandom, p-limit, helmet, compression, cors, express-rate-limit
(`backend/package.json`). The entry point starts the builder and listens (`backend/src/index.ts:1-15`).

### 4.1 HTTP surface (`backend/src/http/server.ts`)

| Method/Path | Response | Notes |
|---|---|---|
| `GET /healthz` | External callers get `{status:'ok'\|'starting'\|'error'}` with 200/202/503. Loopback callers also get `uptime`, `nodes`, `edges`, `lastBuild`, `memory{heapUsed,heapTotal,rss}` MB | `:76-138`. Used by the Docker HEALTHCHECK (wget spider) |
| `GET /api/state` | `AtlasState = {building, error?, data?: AtlasBuild}`, i.e. the **entire graph** | `:140-142`. Re-serialized on every request |
| `GET /api/status` | `{building, buildId?, error?, progress: {stage, progress}\|null}` | `:145-154`. Cheap poll target |
| `GET *` | Static files from `../../../frontend/dist`, SPA fallback to `index.html` | `:157-163` |

Middleware: `trust proxy 1`; gzip level 6 above 1 KB; helmet CSP (`connect-src 'self' https://api.runonflux.io`,
`img-src https: data:`, `worker-src blob:`); **rate limit 100 req/min/IP**. CORS: in production only when
`ALLOWED_ORIGINS` is set, otherwise disabled (same-origin still works); dev allows all origins. `express.json` is mounted but unused (`:14-74`).

### 4.2 AtlasBuild shape (`backend/src/types/atlas.ts:50-144`; the frontend mirror is `frontend/src/types.ts`)
```
AtlasBuild { buildId: "<base36 ts>-<nodeCount>", startedAt, completedAt, durationMs,
  nodes: AtlasNode[], edges: AtlasEdge[], bounds{minX..maxY}, stats, config{caps…}, meta{axis,hubThreshold,layoutStrategy,source} }
AtlasNode { id, label(=id), tier, kind:'flux'|'stub', status:'ARCANE'|'LEGACY'|'UNVERIFIED', isArcane, isHub,
  metrics{degree, degreeCentrality, connectionCount(=out+in list lengths), incomingPeers, outgoingPeers},
  position{x,y} (normalized to ±500), position3d{x,y,z},
  meta{tier,status,ip,collateral,paymentAddress,rpcEndpoint,frontendUrl,lastConfirmedHeight,isFluxNode,isStub,
       bandwidth{download_speed,upload_speed}?, apps[{name,description,version,owner}]?} }
AtlasEdge { id:"src|tgt", source, target, weight:1, kind:'flux-flux'|'flux-stub' }   // directed; A→B and B→A are separate edges
AtlasStats { totalFluxNodes, totalStubNodes, totalNodes, totalEdgesRaw, totalEdgesTrimmed, hubCount,
  tierTotals{CUMULUS,NIMBUS,STRATUS,UNKNOWN}, statusTotals{ARCANE,LEGACY,UNVERIFIED}, stubAfterTrim, sampling, buildDurationMs }
```
A historical healthz example from the deleted `DEPLOYMENT.md` (`git show a023038^:DEPLOYMENT.md`) reported **8,521 nodes / 128,027 edges**.

### 4.3 Build pipeline (`backend/src/services/atlasBuilder.ts:1000-1098`)
1. `buildGraph` (`:263-440`): builds flux nodes and directed edges from **outgoing** peers only, and records in/out counts.
2. Trimming: `enforceStubCap`, `enforceMaxDegree` (drops stub and low-weight edges first), `enforceEdgeCap`, `dropIsolatedStubs` (`:146-252`).
   The Docker config sets every cap to 0, so trimming is **disabled**. The code defaults (48/90k/64/6000) enable it.
3. `computeDegreeMetrics`: degree = number of non-stub edges touching the node, both directions (`:442-465`).
4. `normalizeClusterDegrees`: nodes sharing an IP all get `aggregate/clusterSize`, so UPnP boxes don't dominate (`:467-531`).
5. Degree centrality = normDegree/(N−1). **Hub** = centrality ≥ the 90th-percentile value, flux nodes only (`:791-798,876-885`).
6. Composite weight = mean of normalized degree, centrality, and bandwidth (down+up), each in [0,1] (`:746-789`).
7. **2D layout** (`:589-736`): collapse nodes by IP into cluster super-nodes. Seed positions randomly, with spread ×(1+2·avgWeight)
   so heavy clusters start farther out. Run d3-force with charge −250, link distance 200, strength 0.3, **no center force**,
   for `min(100, 30+0.02n)` ticks, but only if clusters ≤ `LAYOUT_NODE_CAP` (4200), otherwise positions stay seeded-random.
   Members are placed on a radius-6 ring around the cluster center, then everything is normalized to ±500.
8. **3D layout** (`:812-874`): d3-force-3d over **all nodes and all edges**, 200 ticks. Charge is `−30 − 150/(1+0.3·deg)`, so
   well-connected nodes sit central and leaves drift outward. Link distance 60, strength 0.3, weak center 0.05. Seeded init ±250.
9. Stats, then `toAtlasNodes`. Everything is deterministic for a given input and `FLUX_LAYOUT_SEED`.

### 4.4 Jobs, storage, memory
- **Scheduler** (`:1115-1133`). `start()` loads `data/atlas_build_cache.json` if it is <1 h old, then calls `refresh()` right away,
  then repeats every `FLUX_UPDATE_INTERVAL` (30 min). An `isRefreshing` flag prevents overlap. The last good build is served
  while rebuilding, and also after a failure, when `error` is set (`:1188-1270`).
- **`data/`** (cwd-relative, i.e. `/app/backend/data` in Docker, the `containerData` volume):
  `peer_cache.json` holds the raw crawl, 1 h TTL, pretty-printed. `atlas_build_cache.json` holds the full AtlasBuild, 1 h TTL on startup.
  Both are written whole with `writeFile`, which is not atomic.
- **Memory/CPU.** The whole graph plus apps and descriptions stays in memory. The 2D and 3D simulations run **synchronously
  on the event loop** (seconds of blocking with ~7k nodes / ~100k edges). `/api/state` runs `JSON.stringify` on multi-MB data
  per request, plus Express's weak-ETag hash and gzip. Recommended RAM is 2 GB (README), but the spec allots 1000 MB.

---

## 5. Frontend architecture

- **Stack** (`frontend/package.json`): React **19.1**, Vite **7.1**, TS 5.9, **sigma ^3.0.2** + **graphology ^0.26**,
  **react-force-graph-3d ^1.29** + **three ^0.181**, ESLint 9. No router, no state library, no CSS framework,
  no data-fetching library. There is a dev proxy for `/api` and `/healthz` to :4000 (`frontend/vite.config.ts`).
- **State.** `App.tsx` holds `useState` for selection, search, color scheme, view mode, and rebuild flags.
  `useAtlasState` fetches `/api/state` **once**. Auto-refresh is commented out, so `VITE_POLL_INTERVAL_MS` is dead (`frontend/src/hooks/useAtlasState.ts:39-50`).
  Selection is cleared if the node disappears (`App.tsx:12-23`).
  Props flow `App → Sidebar/GraphCanvas*`. Styling is mostly inline style objects plus `App.css` and `LandingPage.css`.
- **Rendering and limits.**
  - *2D (Sigma WebGL)* handles ~7k nodes fine. **All ~60–130k edges are uploaded and drawn transparent** even when hidden.
    The main effect's dependency list includes `highlightedNodes`, `colorScheme`, and `onNodeSelect` (`GraphCanvas.tsx:319`), so
    **every debounced search keystroke or color toggle kills and rebuilds the whole Sigma instance**. The in-place
    update effects at `:374-437` are therefore redundant. The mobile touch picker is O(n) per touch.
    History: `010f1ef` fixed a Y normalization bug (minX was used for Y) and set the camera before the first render to stop the load "shift".
    `ec3e023` and `b127bdd` replaced centroid centering with bbox-offset centering at (0.5, 0.5), because asymmetric layouts sat off-center.
  - *3D (three via react-force-graph-3d)* uses one Sprite and **one SpriteMaterial per node**, so ~7k draw calls. That is the main
    FPS ceiling; there is no instancing and no `Points`. Before `e2dac89`, every change to selection, highlight, or color scheme
    re-ran `nodeThreeObject` for all nodes and allocated new materials that were never disposed, which leaked memory.
    Now sprites are cached on `node.__sprite` and recolored in place. Remaining gaps: the cache dies when `graphData` is
    recomputed and old materials are still not disposed; the circle texture is never disposed; selection runs an O(E) link
    filter plus an O(n) `find` per link; `isMobile` is read once per render and doesn't react to resize.
  - The landing particle canvas runs a rAF O(n²) loop with ≤150 particles, which is fine. The Outfit and JetBrains Mono fonts are
    named but never loaded, because Google Fonts was removed for CSP in `a023038`, so the system fallback font is used.

---

## 6. Deployment

- **Dockerfile** (`Dockerfile:1-79`) has 3 stages on `node:20-alpine`: frontend `npm ci && npm run build`, then backend `tsc`,
  then a runtime stage with `npm ci --only=production`, `dist`, and the frontend `dist` at `/app/frontend/dist`. The runtime stage
  bakes the prod env as `ENV` (PORT 3000, RPC timeout 15 s, workers 24, max nodes 10000, all caps 0, external peers off,
  layout cap 4200, interval 30 min, Arcane probe on). It includes a HEALTHCHECK (wget `/healthz`, 30 s interval, 40 s start
  period) and runs `node dist/index.js` from `/app/backend`.
  **Build breaks on a clean clone:** `npm ci` requires `package-lock.json`, but `.gitignore:3` excludes lockfiles and none are committed.
- **docker-compose.yml** has service `flux-atlas`, image **`littlestache/flux-atlas:3.0`**, `3000:3000`, a named volume
  `atlas-data → /app/backend/data`, the same env, `restart: unless-stopped`, and a bridge network.
- **flux_app_spec.json** (Flux app spec **v8**): `name "FluxAtlas"`, `owner "YOUR_ZELID_HERE"` (placeholder), **`instances: 3`**,
  `staticip false`, `enterprise ""`. It has one compose component, `fluxatlas`, with `repotag "littlestache/flux-atlas:latest"`
  (changed from a pinned tag in `2936c4d`), `ports [3000]`, `containerPorts [3000]`, `domains [""]`,
  `environmentParameters ["NODE_ENV=production","PORT=3000"]`, `commands []`, `containerData "/app/backend/data"`
  (no `r:`/`g:` sync prefix), `cpu 1.0`, `ram 1000`, `hdd 5`, `tiered false`.
  Top-level v8 fields `contacts`, `geolocation`, `expire`, and `nodes` are **absent**, and whether port 3000 is an allowed
  external port was not checked. Verify both against the FluxOS spec validator before reusing the file.
- Public URL in the OG tags: `https://atlas.app.runonflux.io/` (`frontend/index.html:18`).
- **Implication of `instances: 3`:** each instance crawls the entire network independently, which triples the RPC load on
  FluxNodes, and each ends up with a **different `buildId`**. If the Flux gateway doesn't pin clients to one instance, the
  10 s `/api/status` poll can hit another instance and show a spurious "Rebuild Complete". This is an inference; it was not tested.

---

## 7. Problems and debt

**Data correctness**
1. **The peer-cache TTL (1 h) is longer than the rebuild interval (30 min).** Every second rebuild reuses cached peers *and the
   cached node list* (`fluxApi.ts:98-121`). New or removed nodes are ignored for up to 1 h, and each rebuild mints a new
   `buildId` for identical data, which prompts users to reload for nothing.
2. Edges to UPnP co-hosted nodes are assigned to a random sibling (`atlasBuilder.ts:367-375`), so per-node edges for ~64% of nodes are approximate.
3. Edges are directed and deduplicated only on the client. Both `degree` and `stats.totalEdgesTrimmed` count A→B and B→A, while
   the UI's edge count is the undirected count, so the sidebar and graph-controls numbers disagree.
   `connectionCount` counts raw list lengths, including non-Flux peers.
4. "Legacy" in the sidebar is `total − ARCANE`, which includes UNVERIFIED (unreachable) nodes (`Sidebar.tsx:219`). Adoption % is understated.
5. Nodes that are unreachable over RPC (NAT or firewall) look isolated. The frontend then **drops** nodes with no edges and
   connectionCount 0, so the displayed "N nodes" (all flux nodes) doesn't match what is drawn.
6. Bandwidth is labeled "MB/s" (`frontend/src/utils/format.ts:22-28`). FluxOS benchmark speeds are very likely **Mbit/s**; verify.
7. Types don't match the API: `activesince`/`lastpaid` arrive as strings, and `metrics.incomingPeers/outgoingPeers` are missing from the backend type.
8. The app instance count is fetched **from the browser** against api.runonflux.io. If that call fails, the landing CTAs are
   **disabled forever** (`LandingPage.tsx:255`).

**Performance / ops**
9. `/api/state` is one monolithic, multi-MB payload (every node, edge, and app description) with no field selection, paging,
   delta updates, or pre-serialized/pre-compressed cache. It is re-stringified per hit.
10. Layout simulations block the event loop, so health checks and requests stall during builds.
11. `enforceEdgeCap` re-sorts every edge on each removal (O(k·E log E)), and `enforceMaxDegree` re-sorts per removal.
    Both are latent in Docker (caps are 0) but active at the code defaults.
12. Cache files are written non-atomically, and the peer cache is pretty-printed, which makes it large.
13. The client uses full-page reload as its update mechanism and has no push channel (SSE/WS). Two parallel polling loops run
    (landing 2 s, app 10 s) and log to the console on every tick (`App.tsx:78-103`).
14. See §5 for the 2D full re-instantiation, transparent-edge overdraw, and 3D per-node materials.

**UX gaps**
15. No URL state: views, selections, and searches cannot be linked; refresh returns to the landing page.
16. No filters (tier, status, app), no legend-click filtering, and no persisted preferences.
17. No geographic context, no app-centric view, no chain/explorer data, no history or trends.
18. The 3D tooltip is built as HTML string interpolation (`GraphCanvas3D.tsx:245`). Today only IP and tier are interpolated,
    but it is an XSS foot-gun if app names are ever added.
19. There is heavy inline styling, duplicated tooltip markup between the 2D and 3D views, and unused props
    (`LoadingIndicator` progress/stages, `StatsCard.helperText`).

**Hygiene**
20. No lockfiles, so the Docker `npm ci` fails. `--only=production` is deprecated. There are no tests.
    `.Zone.Identifier` Windows artifacts are committed under `frontend/public/`.
21. Config drift. Code defaults differ from the Dockerfile and `.env.example` (e.g. RPC timeout 4 s / 15 s / 8 s, workers 50/24/24,
    external peers true/false/true). `FLUX_MAX_PEERS_PER_NODE` is parsed but **never used**.
    `README.md:92-98` documents env names that don't exist (`FLUX_SEED_NODE`, `MAX_CONCURRENT_FETCHES`, `LAYOUT_NODE_CAP`).
    The README also claims "Centrality Analysis ... bridge nodes", which is not implemented.
22. The frontend URL is hard-coded to `http://`, and `rpcEndpoint` exposes internal crawl details.

### Lessons for v2 (problems to solve fresh; do not port the v1 implementations)
- **Collateral (`txhash:outidx`) as the node key**, with IP[:port] as a mutable attribute. Parse `COutPoint(...)` into a clean key.
  Remember that 2,655 hosts serve 6,724 nodes.
- **UPnP-aware address resolution** (`ip:port` → `ip:16127` → bare ip) and the **frontend port = API port − 1** convention.
  Aggregate co-hosted nodes into a **host cluster** entity; this is also the natural unit to geolocate on a globe.
- **Two-phase, fail-fast crawl** with bounded concurrency, short metadata timeouts, and an SSRF guard on crawl targets.
- **Serve the last good snapshot while rebuilding**, persist it for instant cold start, and expose a cheap status/version endpoint
  (in v2, push over SSE/WS instead of polling).
- **Deterministic, seeded, server-side layouts** so positions are stable across builds and the client doesn't simulate.
  The 3D charge formula `−30 − 150/(1+0.3·deg)` gives a pleasing core/periphery "galaxy" shape that is worth reusing for a
  non-geo "topology" mode or the screensaver.
- **Cluster-then-ring 2D layout** (force only on host clusters, then a ring for members), and **UPnP degree normalization**.
- **Hub = top-decile centrality**, and the composite weight of degree, centrality, and bandwidth, as a cheap "importance" score for sizing and LOD.
- **Hide edges by default and reveal the selected node's edges**. This declutters well; keep it, but don't upload hidden edges.
- Touch picking by nearest node within a radius. The camera fly-to-node on select.
- Arcane detection via `/flux/isarcaneos`; the tri-state ARCANE/LEGACY/UNVERIFIED is honest about unreachable nodes.
- For v2, replace the per-node `installedapps` fan-out with a central call if possible. Candidates to verify: `api.runonflux.io`
  `/apps/locations` (app → node IPs) and `/apps/globalappsspecifications` (specs and instance counts). Candidate geo source
  to verify: FluxOS `/flux/geolocation` on each node; otherwise GeoIP on the host.

---

## 8. Environment variables and config

| Var | Code default (`backend/src/config/env.ts:65-90`) | Dockerfile / compose | Effect |
|---|---|---|---|
| `PORT` | 4000 | 3000 | listen port |
| `NODE_ENV` | — | production | CORS mode, CSP upgrade-insecure |
| `ALLOWED_ORIGINS` | unset | unset | CSV of allowed CORS origins in production (`server.ts:62-72`) |
| `LOG_LEVEL` | info | — | `backend/src/utils/logger.ts:11` |
| `FLUX_API_BASE_URL` | https://api.runonflux.io | same | node list host |
| `FLUX_DAEMON_LIST_ENDPOINT` | /daemon/listfluxnodes | same | node list path |
| `FLUX_RPC_PROTOCOL` | http | http | protocol for per-node API calls |
| `FLUX_RPC_PORT` | 16127 | 16127 | default node API port |
| `FLUX_RPC_TIMEOUT` | 4000 ms | 15000 | peer-call timeout (metadata = min(this, 3000)) |
| `FLUX_MAX_WORKERS` | 50 | 24 | crawl concurrency |
| `FLUX_MAX_NODES` | 9000 | 10000 | slice of the node list |
| `FLUX_QUICK_SAMPLE_NODES` | 0 | 0 | dev: crawl only the first N |
| `FLUX_MAX_PEERS_PER_NODE` | 48 | 0 | **unused** |
| `FLUX_MAX_EDGES` | 90000 | 0 | edge cap (0 = off) |
| `FLUX_MAX_NODE_DEGREE` | 64 | 0 | per-node degree cap |
| `FLUX_MAX_STUB_NODES` | 6000 | 0 | stub cap |
| `FLUX_INCLUDE_EXTERNAL_PEERS` | true | false | create stub nodes for non-Flux peers |
| `FLUX_LAYOUT_NODE_CAP` | 4200 | 4200 | above this many host clusters, 2D force is skipped (seeded random) |
| `FLUX_LAYOUT_SEED` | flux-atlas | flux-atlas | RNG seed for layouts and tie-breaks |
| `FLUX_UPDATE_INTERVAL` | 1800000 | 1800000 | rebuild period (0 = off) |
| `FLUX_ALLOW_INSECURE_SSL` | true | true | undici `rejectUnauthorized=false` |
| `FLUX_ENABLE_ARCANE_PROBE` | true | true | call `/flux/isarcaneos` |
| `VITE_API_BASE_URL` (fe) | '' (same-origin) | build-time | API prefix (`frontend/src/api/atlas.ts:3-5`) |
| `VITE_POLL_INTERVAL_MS` (fe) | 15000 | — | **dead** (auto-refresh disabled) |

Hard-coded constants: cache TTLs 1 h (`fluxApi.ts:11`, `atlasBuilder.ts:1145`); metadata timeout 3 s; rate limit 100/min;
client polls of 10 s (app) and 2 s (landing); search thresholds (2 chars, 25 per page, 150/400 ms debounce); mobile breakpoint 768 px;
layout extent ±500; 3D ticks 200; 2D ticks ≤100; hub percentile 0.9.

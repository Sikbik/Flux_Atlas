# Flux Atlas v2 — Build Plan

Branch: `development`. Tech lead: orchestrator session. Team roles:
- **Backend & hard logic:** Opus high-effort engineers.
- **Design & UI craft:** Sonnet max-effort designers/creative engineers.

Every work package (WP) has one owner, an exclusive file boundary, and acceptance gates. The lead reviews and
commits at each milestone. Status values: done, running, queued.

## Phase 0 — Discovery
| WP | Owner | Output | Status |
|---|---|---|---|
| R1 Legacy analysis | Opus | `docs/research/legacy-brief.md` | done |
| R2 Flux API map (live-verified) | Opus | `docs/research/flux-api.md`, `docs/research/fixtures/flux/` | done |
| R3 Explorer API map | Opus | `docs/research/explorer-api.md`, `docs/research/fixtures/explorer/` | done |
| D1 Design direction + tokens + mock | Sonnet (sonnet-max) | `docs/design/**` | done (v0.3, a4265be) |
| D2 Globe + ambient renderer lab | Sonnet (sonnet-max) | `labs/globe/**` | done (384bfdd; marble default, holo lite, neon option). Moon style pass done (dc8a016: comet wake, ember beads, three glass finishes, soft planet shockwave), handed to G2 |

## Phase 1 — Blueprint (lead)
- Finalize `docs/ARCHITECTURE.md`: endpoints, ingest cadences, domain model, binary formats, live protocol.
- Write `docs/FEATURES.md`: the feature spec, merging research opportunities with the design IA. (draft written; reconcile with the design IA when D1 lands)
- Choose the globe art direction from the D2 shots and reconcile it with D1 tokens.

## Phase 2 — Foundations (parallel)
| WP | Owner | Boundary | Acceptance |
|---|---|---|---|
| B1 Backend foundation (done, 01ef4fd) | Opus | `Cargo.toml`, `crates/atlas-core`, `crates/atlas-flux`, `crates/atlas-store`, skeletons of `atlas-engine` + `atlas-server` | fmt/clippy/test green; every parser passes on every fixture; the nodes.bin codec round-trips and a golden file is written; redb tables round-trip; SSRF guard unit-tested; ts-rs exports into `web/src/api/generated/` |
| F1a Frontend foundation: logic core (done, merged). F1b: globe port + bindings + window-manager core (done, merged 2929567; 60 fps at 1440p, 1.5 ms GPU per frame, flat heap over a 10-minute route-churn soak) | Opus | `web/**` (initial) | Vite app boots; tokens + fonts load; router; the nodes.bin decoder passes the golden test; WS client handles resync; NetworkStore; mock mode with a fake live feed; globe engine ported and mounted as the persistent wallpaper; window-manager + dock primitives; Playwright smoke + screenshot script; `tsc`/biome/vitest green |

## Phase 3 — Features (parallel)
| WP | Owner | Boundary | Acceptance |
|---|---|---|---|
| B2 Engine & ingest (done; 90-min live soak clean; merged via I1, 9eb7f04) | Opus | `crates/atlas-engine` | runs against the live API for 30+ min with no errors; events derived correctly (unit tests from fixture pairs); metrics/snapshots/time machine persist and reload; peer crawl respects the SSRF guard and rate limits; memory stays flat |
| B3 API server + live hub (done, merged 62bb028) | Opus | `crates/atlas-server` | every §6 endpoint is implemented and tested; pre-built bodies with ETag/compression; WS protocol incl. replay/resync; search resolution; explorer proxy cache; SPA embed; `oha` p99 < 5 ms on hot endpoints |
| K1 UI kit (done, merged; 52 components, 710 tests, axe-core clean, +2 kB shell) | Sonnet | `web/src/ui/**`, `web/src/styles/components.css` | the shared primitives every view composes (layout, key-value, stats, chips, tabs, tables, charts, entity links, amounts, hashes, states); a kit gallery at `/dev/kit`; merged first, then pulled into the other F branches |
| F2a Frame & live chrome (done, merged 888c0b9; follow-up merged fd5233a: page panels, moon parks in the phone header, window inset policy, frame check 73/73, vendor chunk 200.8 kB gz initial; second follow-up running: boot settles home, archive t-minus, page-panel inset) | Sonnet | `web/src/shell/**`, `web/src/styles/{global,frame}.css`, `web/src/globe/overlays.tsx`, `web/src/features/chrome/**`, `web/src/views/frame.ts` | boot sequence on real load progress; top bar, dock, status bar and window chrome with motion; live block rail, Pulse feed with +N collapsing, next-payout ticker, reward-cut countdown; toasts; globe hover tooltip and labels; phone layout |
| F2b Command & delight (done, merged aec9fcf; palette, /q, terminal, 24 achievements, ambient, Settings, About with data credits) | Sonnet | `web/src/features/{command,achievements,ambient,settings}/**`, `web/src/views/command.ts` | ⌘K palette and omnibox search; `/q` results; terminal with every command, autocomplete, history and live tails; achievements; ambient mode UX (idle entry, kiosk, smooth exit); settings and about |
| F3 Inspectors (done, merged 087431e; node, host, app and revisions, operator and watchlist, payment queue, network weather; e2e 10/10 after the lead's fixes) | Sonnet | `web/src/features/inspect/**`, `web/src/views/inspect.ts` | node, host and app inspectors (app constellation, spec history), operator view, watchlist, payment-queue visualizer, network weather |
| F4 Explorer & analytics (done, merged; explorer and nine analytics tabs on the kit, the time machine at /time) | Sonnet | `web/src/features/{explorer,analytics,timemachine}/**`, `web/src/views/explorer.ts` | block/tx/address/mempool/supply/rich-list views, analytics dashboards, time-machine scrubber |
| G2 World-space moon (done, merged bf7e118; UTC-locked 240 s orbit, lab style ported, 60 fps at 1440p) | Sonnet | `web/src/globe/engine/moon/**`, the moon's beams, MoonProxy | the moon keeps its orbit position as the camera moves; true 3D revolutions with soft limb occlusion; the block beat reads in any pose; the trail lives in world space; the globe lab's restyle (dc8a016, `labs/globe/clips/moon-style-notes.md`) is ported in, with the planet shockwave as its own commit |
| G3 Globe framing & robustness (done, merged 23dc876; pitch keeps the planet framed, 32 px rail clearance, context-loss recovery) | Opus | `web/src/globe/**` except the moon | middle-drag pitch can no longer push the globe under the rail; a framing contract with clearance above the rail; the fractional-DPR context loss fixed; ambient exit restores layers |
| G4 Node legibility up close (done, merged 970a1cc; the lens ramp, receding basemaps, bead markers, lock ring, shared fans) | Sonnet | `web/src/globe/engine/nodes/**`, basemap and city-lights parts of `engine/layers/**` | at close zoom every node reads instantly against city lights, coastlines and the day side (zoom-adaptive basemap dimming, contrast knockout, tier-colored rims); an unmistakable selected-node treatment; legible fanned stacks; the global look unchanged |
| G5 Engine capabilities for the frame (done, merged; fly-to drift 257 px to 0, keyboard camera, boot aperture, label clip, hover dedupe, Neon twilight, 48-handshake cap) | Opus | `web/src/globe/**` (camera, controls, bindings) | the fly-to aim bug G4 found (a lone node's target sits 108 km off, so zooming loses it) first; typed `GlobeTarget` (setMoonBoot, setReveal, setInset, getHubs, project, projectNode); a planet-hide flag or lat/lon reveal origin for the boot; keyboard camera controls (orbit, zoom, Home, F; design 10.3); hover events deduplicated by target (the engine re-emits hover every frame); a clip option for place labels |
| M1 Motion & interaction language (done; integration merged 5c027ef: Power-on windows, toasts and sheets, rail Current, tab lines, useFresh; 60 fps with effects, nothing loops at rest) | Sonnet | `web/src/motion/**`, `docs/design/motion-language.md` | one Flux interaction vocabulary taken from the block pulse (pulse, charge, spark, current, power-on, settle) with restraint rules and a UX simplicity checklist; a `/dev/motion` gallery; an integration guide, then an integration pass across the merged app |

View ownership is enforced by the registry in `web/src/views/`: each F team swaps placeholders for real views only in its
own barrel, so the route tree and `shell/windowContent.tsx` never change in parallel. Feature queries live in the feature
directory; shared files (`api/**`, `store/**`, `app/**`, `choreo/**`, `globe/engine/**`) change only for bug fixes,
called out in the hand-back.

## Phase 4 — Integration & hardening
| WP | Owner | Scope |
|---|---|---|
| I1 Integration (done, merged 9eb7f04; block latency median 1.0 s live, 0 of 6,725 ranks off over 17 real blocks) | Opus | merge B2, wire watch hooks/config/timeline, ingest-off tests, client rank rules, live E2E against the real network |
| D1 Deploy & capacity (done, merged 2058d38; one listener proven by test, 5.2 h soak under --cpus=1 --memory=2500m: CPU 3.3%, RSS about 450 MB, disk projected to 6.9 GB of 10 GB; image 14.5 MB compressed, scratch base) | Opus | one-port container (`deploy/Dockerfile`, EXPOSE 3000 only, data at `/app/backend/data`), `deploy/flux_app_spec.json` matching the live app, a 2-hour soak inside 1 CPU / 2,500 MB / 10 GB with 200 clients, bounded caches, an enforced disk budget, `atlas db-stats` |
| B4 Backend fixes (done, merged 43c504c; PoN selection rule in research 6.8) | Opus | API defects reported by the F teams (metrics nulls, step format, tx sizes, mempool kinds), engine counters in Prometheus, time-machine columns, an explicit unranked signal, GeoIP coverage |
| B5 Backend follow-ups (done, merged 1a070df; 99.2% of nodes have a city, restart reconcile diffs=0) | Opus | city-level geo from DB-IP Lite City (CC BY 4.0, attribution exposed to clients), ranks correct before the first bootstrap after a restart |
| B6 Rank accuracy & API consistency (done, merged; expiry, DOS and queue order exactly as fluxd, 2 h soak with 0 corrections, named counts, next payees at load, mesh hysteresis) | Opus | steady-state rank corrections (expiry vs fluxd, payment_address diffs), one node count across endpoints, city in node rows, slow-request attribution, mesh flapping, next payees in the bootstrap, duplicate feed items |
| L1 Lead fixes (done) | lead | globe froze 0.5 to 1.2 s on every 12 s topology sweep (each streamed link re-resolved all 134k edges): fixed in f277752, max frame 33 ms live |
| B7 API defects from the views (done, merged; earnings by address from a 30-day ledger, top operators to 5,000, tx app_ref, app economy, 1,000-block pages, mesh outlier rule 396 to 167 links per call, topology reply caps, mesh rows 8.6x smaller) | Opus | operator earned_24h bug, top_operators cap, /tx app_ref, app-economy aggregates, blocks limit, mesh outlier hosts, monotonic app records |
| B8 Server and edge hardening (done, merged cb2f997; FDM trust list from FluxOS, slow-loris 0/400 to 400/400 closed, SIGTERM 30 s to 4.2 s, request CPU p50 85 ms to 0.12 ms under attack, CSP clean on 17 routes, capabilities dropped) | Opus | X1 H1 proxy trust and global caps, M1 timeouts and shutdown, M7 request CPU and compression, L1 sub replay, L2 store read timeouts, L3 capabilities, L4-L5 GeoIP, L8, L10 security headers, L15 private metrics |
| B9 Engine robustness and consistency (done, merged 4f4252d, 7d9c775, 77d1c40; engine death answers 503 `dead` and exits 1, bounded writer and reorgs, payout undo, interactive upstream lane, instance ORIGIN, `txid:vout` node keys with old ids migrated, `no_history` time machine) | Opus | X1 M2-M3 and M5-M6 upstream budget, failover validation, liveness; M8 mesh resume; M9 instance id and stable node keys on the client; L6, L7, L9, L11-L14 |
| Q1 Visual QA & polish (deferred by the user for budget; partial work unmerged on `worktree-agent-aeabe66d1798ee1ed`) | Sonnet | screenshot sweep across routes × viewports, motion polish, a11y, reduced motion |
| B10 Chain history (done, merged 87b10da and b983ed0; whole chain sampled at 0.86 req/s on a new bulk lane, every window complete within 42 min of a fresh start, about 4 MB steady) | Opus | block time and difficulty over 24h, 7d, 30d, 1y and all; `/api/v1/network/chain-history`; per-block rows for 31 days, a 120-block grid for 30 days and a 720-block grid for the rest; the 120 s to 30 s target schedule |
| D-chain Chain analytics tab (done, merged 0f0d4b7) | Sonnet | `/analytics/chain`: window selector, four tiles, difficulty (log scale past a 20x range) and time per block with the target step at Proof of Node, carets for off-chart gaps, data tables for screen readers |
| R1 Release assets (done; `og-image.jpg` 1200x630 from the live globe with the Flux moon, Open Graph and Twitter `summary_large_image` tags with absolute URLs on the domain, `favicon.svg`/`.ico` of the planet with the Flux round symbol as its moon, touch and manifest icons) | lead | link previews for Twitter, Discord and the rest; a project favicon; the release image built locally |
| B11 Wallet intelligence (done, merged ef9d8a2; `/wallet/{addr}` 0.9 to 1.7 s cold and 0.3 ms warm for a 208-node wallet, 25 KB brotli; run rate 3,025 FLUX a day matches noxide's month with parallel assets; Fusion's `/coinbase/records` is never called) | Opus | `/wallet/{addr}`: standing, realized earnings by day, expected against received payments, a 365-day projection with the reduction step, next payouts, health reasons, benchmarks against network percentiles and tier minimums, concentration, apps, activity, fleet history; `/wallet/{addr}/parallel-assets` from Flux Fusion; `/prices` in 16 currencies with a year of history |
| D-wallet Wallet workspace (done, merged e4a0390) | Sonnet | `/wallet/$addr`: Overview (standing, run rate, payout dial), Earnings (each day at its own price, projection, profitability with the viewer's hosting costs), Parallel assets (claim-all quote, fee gauge, a card per chain, claims), Fleet (windowed table, filters, grouping, CSV, globe pings), Health and risk, Apps (treemap) and Activity; ways in from the operator panel, address pages, the palette and `/?wallet=` |
| B12 Explorer data (done, merged e3bd504; `/chain/daily` six Insight series once per 12 h on the bulk lane, warm under 1 ms; 400 concurrent `/richlist` requests made no upstream call; top 10/100/1,000 addresses hold 59.1/76.0/92.1% of supply) | Opus | `/chain/daily?days=30\|90\|365\|all` (transactions, blocks, fees per block and per day, outputs, supply; Insight serves 730 days), `/richlist` served from one shared copy with `stale` while Insight fails, a daily top-1,000 snapshot kept 400 days, `/richlist/movers?window=1d\|7d\|30d` (gainers, losers, entered, left, concentration) |
| B13 Network hubs data (done, merged 758e045; 1,205 operators by ZelID and 847 by payment address over 6,848 nodes; cold 2 to 10 ms, warm under 1 ms) | Opus | `/network/operators?by=zelid\|address` (nodes, share, tiers, countries, providers, wallets, FLUX a day, collateral, health), `/network/nodes-overview` (benchmark spreads per tier, age, newest, churn, status), `/network/apps-overview` (owners, instance countries, resources against capacity, deployments per day, newest, expiring, enterprise) |
| D-borders Globe borders (done, merged 7a6da0d; +0.05 to 0.2 ms a frame on the GPU; states asset 312 KB) | Sonnet | country borders in all three looks (neon hairline, marble engraved thread, holo beads), Natural Earth 1:10m admin-1 lines fading in as the camera comes down (never on Lite), a Borders setting (Off, Countries, Countries and states) |
| D-hubs Explorer, Nodes and Apps hubs (done, merged 2bb88a2; e2e 18/18; 0 layout moves while data arrives at 1440, 1024 and 760 px) | Sonnet | one hub frame (hero, tiles, panels, leaderboard, search, nav) for `/explorer` (live chain hero with a block tape, latest blocks, mempool, holders and movers, chain activity, supply), `/nodes` (network health, top node operators by ZelID or address, live joins and leaves, payment queue, geography, hosting, versions, decentralization, node age, benchmarks, newest nodes) and `/apps` (resources against capacity, top apps treemap, top owners, where apps run, deployments, what apps pay, new and expiring apps); the dock launchers open the hubs; the palette finds Explorer, Nodes, Apps, Operators and the rich list |
| X1 Review (done, b9a68da: 0 critical, 1 high, 9 medium, 15 low; frontend XSS clean; cargo and npm audit clean) | Opus | security (SSRF, input validation, DoS limits), correctness, efficiency |

## Phase 5 — Ship
`deploy/Dockerfile`, `deploy/flux_app_spec.json`, README, removal of v1 dirs, final review, and hand-off.

**Deployment target: the live Flux app `atlas`.** v2 ships as an update of this app and must conform to its spec.
- Spec facts (v8 at height 2,988,596; owner `196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH`):
  - 2 instances, served at https://atlas.app.runonflux.io.
  - One component, `atlas`, with image `littlestache/flux-atlas:latest`.
- Ports: public port 33889 maps to container port **3000**.
  - The server binds `0.0.0.0:3000`, which is already the default.
  - It serves the SPA, the API and the WebSocket on that one port.
  - It is the only open port. When hosted, Flux rebinds it to the public port (33889, and the domain through the FDM balancers), so nothing may need a second port or assume its own public port: the client derives the WebSocket URL from `location.host`, and link-preview URLs use https://atlas.app.runonflux.io.
- Persistent data lives at **`/app/backend/data`** (the spec's containerData).
  - The spec passes no environment variables and no commands, so every image default must work as is.
  - The image therefore sets `ATLAS_DATA_DIR=/app/backend/data`.
  - FluxOS mounts that volume, so the user the image runs as must be able to write to it.
- Budget per instance: 1 CPU, 2,500 MB RAM, 10 GB disk.
  - Server RSS, the redb cache and history retention must fit inside it.
- Re-read the live spec before deploying: `GET https://api.runonflux.io/apps/appspecifications/atlas`.

## Team conventions
- **Clean-room rewrite: no v1 code is carried over** (no snippets, formulas, layouts, styles, or structure).
  v1 is only a reference for purpose and network/API facts. Every brief restates this.
- **No emojis** anywhere in v2: docs, code, comments, UI copy, commit messages. Use plain-word statuses; UI icons come from an icon set.
- Rust: `export PATH="$HOME/.cargo/bin:$PATH"`. Web: Node 26 + npm.
- Visual verification tool: `node $SCRATCH/team/tools/shot.mjs <url|file> <out.png> [--gpu --fps --frames N --mobile --eval js]`,
  where `$SCRATCH` is the session scratchpad the lead gives in each brief.
- Agents in the main tree don't commit. The lead reviews and commits per milestone.
- Parallel work packages that touch dependent code (B2/B3, K1/F2a/F2b/F3/F4) run in **isolated git worktrees** and commit to
  their worktree branch only. The lead merges into `development`. Each Rust agent uses its own `CARGO_TARGET_DIR`
  to avoid build-lock contention.
- Contract changes (DTOs, binary formats, WS messages) go through `docs/ARCHITECTURE.md` first.
- Branch syncs: agents cannot merge `development` into their own worktrees (the permission system blocks it). The
  user chose lead-run syncs: the agent commits and ends its turn, the lead merges `development` into its branch,
  resolves conflicts, runs its gates, and resumes it with a change list.

## Backlog (from the hand-backs)
- **K2 kit consolidation.** Several local primitives should move into `web/src/ui`.
  - Shell (F2a): the bottom sheet and the Beat pill.
  - Palette (F2b): the result row and the kind strip.
  - Explorer and analytics (F4): ConfirmationGauge, DotMap, DeltaBars, Scrubber.
  - Inspectors (F3): Callout, LocationMap, NodeFinder, Stepper, Fold.
  - Plus the kit gaps each team listed: TimeSeries step and stack, DataTable responsive columns, combobox, slider, and others.
- **Tokens.** Have the design source (`docs/design` tokens) add `[data-motion="off"]` to the reduced block. M1's parity copy in motion.css can then go.
- **Engine.**
  - Highlight by an id set.
  - `sel` selecting more than the first resolvable node.
  - Weather hotspots drawn as world glows instead of GlobeLabel anchors.
- **Backend.**
  - `reachable` and `last_confirmed` are missing from nodes.bin, so weather pages through the list.
  - Benchmark failures are not exposed.
  - DoS and started nodes have a null endpoint.
  - `node_ids` and `node_ids_rev` are never pruned (about +80 MB a year), and `app_events` is kept forever (about +150 MB a year).
- **Visual QA (Q1, deferred).** The moon dips under the block rail at high-latitude poses; the phone "You" tab IA and the aim strip during archive; About link placeholders; the palette's height jump on first open.
- **Outpoints.** Search hits are still keyed by numeric id, and `PayoutDto.node` and app instances carry no outpoint. A fresh instance shows start-list diffs, and its mesh shrinks.
- **Wallet follow-ups.** A multi-wallet portfolio (several addresses in localStorage) was not built. Not verified: Safari and Firefox, a real-GPU "high" tier. The explorer address hero clips a 10M balance on a phone (pre-existing).
- **Hub follow-ups.** Move the hub queries (`hub/api.ts`, `hub/apps/api.ts`, the Explorer landing hooks) into `api/endpoints.ts` and `queries.ts`; fold `nodes/Redact` and `apps/ghost` into one part; the Versions panel grows about 30 px on a phone past three versions. Live joins, leaves and new apps arriving are covered by unit tests only.
- **Deploy (needs the user's go-ahead).** Re-read the live spec, build `deploy/Dockerfile`, push `littlestache/flux-atlas:latest`, and update the `atlas` app.


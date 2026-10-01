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
| D2 Globe + ambient renderer lab | Sonnet (sonnet-max) | `labs/globe/**` | done (384bfdd; marble default, holo lite, neon option) |

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
| B2 Engine & ingest (done; 90-min live soak clean, merging via I1) | Opus | `crates/atlas-engine` | runs against the live API for 30+ min with no errors; events derived correctly (unit tests from fixture pairs); metrics/snapshots/time machine persist and reload; peer crawl respects the SSRF guard and rate limits; memory stays flat |
| B3 API server + live hub (done, merged 62bb028) | Opus | `crates/atlas-server` | every §6 endpoint is implemented and tested; pre-built bodies with ETag/compression; WS protocol incl. replay/resync; search resolution; explorer proxy cache; SPA embed; `oha` p99 < 5 ms on hot endpoints |
| K1 UI kit (running, worktree) | Sonnet | `web/src/ui/**`, `web/src/styles/components.css` | the shared primitives every view composes (layout, key-value, stats, chips, tabs, tables, charts, entity links, amounts, hashes, states); a kit gallery at `/dev/kit`; merged first, then pulled into the other F branches |
| F2a Frame & live chrome (running, worktree) | Sonnet | `web/src/shell/**`, `web/src/styles/{global,frame}.css`, `web/src/globe/overlays.tsx`, `web/src/features/chrome/**`, `web/src/views/frame.ts` | boot sequence on real load progress; top bar, dock, status bar and window chrome with motion; live block rail, Pulse feed with +N collapsing, next-payout ticker, reward-cut countdown; toasts; globe hover tooltip and labels; phone layout |
| F2b Command & delight (running, worktree) | Sonnet | `web/src/features/{command,achievements,ambient,settings}/**`, `web/src/views/command.ts` | ⌘K palette and omnibox search; `/q` results; terminal with every command, autocomplete, history and live tails; achievements; ambient mode UX (idle entry, kiosk, smooth exit); settings and about |
| F3 Inspectors (running, worktree) | Sonnet | `web/src/features/inspect/**`, `web/src/views/inspect.ts` | node, host and app inspectors (app constellation, spec history), operator view, watchlist, payment-queue visualizer, network weather |
| F4 Explorer & analytics (running, worktree) | Sonnet | `web/src/features/{explorer,analytics,timemachine}/**`, `web/src/views/explorer.ts` | block/tx/address/mempool/supply/rich-list views, analytics dashboards, time-machine scrubber |

View ownership is enforced by the registry in `web/src/views/`: each F team swaps placeholders for real views only in its
own barrel, so the route tree and `shell/windowContent.tsx` never change in parallel. Feature queries live in the feature
directory; shared files (`api/**`, `store/**`, `app/**`, `choreo/**`, `globe/engine/**`) change only for bug fixes,
called out in the hand-back.

## Phase 4 — Integration & hardening
| WP | Owner | Scope |
|---|---|---|
| I1 Integration (running, worktree) | Opus | merge B2, wire watch hooks/config/timeline, ingest-off tests, client rank rules, live E2E against the real network |
| Q1 Visual QA & polish | Sonnet | screenshot sweep across routes × viewports, motion polish, a11y, reduced motion |
| X1 Review | Opus | security (SSRF, input validation, DoS limits), correctness, efficiency |

## Phase 5 — Ship
`deploy/Dockerfile`, `deploy/flux_app_spec.json`, README, removal of v1 dirs, final review, and hand-off.

**Deployment target: the live Flux app `atlas`.** v2 ships as an update of this app and must conform to its spec.
- Spec facts (v8 at height 2,988,596; owner `196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH`):
  - 2 instances, served at https://atlas.app.runonflux.io.
  - One component, `atlas`, with image `littlestache/flux-atlas:latest`.
- Ports: public port 33889 maps to container port **3000**.
  - The server binds `0.0.0.0:3000`, which is already the default.
  - It serves the SPA, the API and the WebSocket on that one port.
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

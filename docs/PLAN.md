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
| R2 Flux API map (live-verified) | Opus | `docs/research/flux-api.md`, `docs/research/fixtures/flux/` | running |
| R3 Explorer API map | Opus | `docs/research/explorer-api.md`, `docs/research/fixtures/explorer/` | done |
| D1 Design direction + tokens + mock | Sonnet (sonnet-max) | `docs/design/**` | running |
| D2 Globe + ambient renderer lab | Sonnet (sonnet-max) | `labs/globe/**` | running |

## Phase 1 — Blueprint (lead)
- Finalize `docs/ARCHITECTURE.md`: endpoints, ingest cadences, domain model, binary formats, live protocol.
- Write `docs/FEATURES.md`: the feature spec, merging research opportunities with the design IA.
- Choose the globe art direction from the D2 shots and reconcile it with D1 tokens.

## Phase 2 — Foundations (parallel)
| WP | Owner | Boundary | Acceptance |
|---|---|---|---|
| B1 Backend foundation (running) | Opus | `Cargo.toml`, `crates/atlas-core`, `crates/atlas-flux`, `crates/atlas-store`, skeletons of `atlas-engine` + `atlas-server` | fmt/clippy/test green; every parser passes on every fixture; the nodes.bin codec round-trips and a golden file is written; redb tables round-trip; SSRF guard unit-tested; ts-rs exports into `web/src/api/generated/` |
| F1 Frontend foundation | Opus | `web/**` (initial) | Vite app boots; tokens + fonts load; router; the nodes.bin decoder passes the golden test; WS client handles resync; NetworkStore; mock mode with a fake live feed; globe engine ported and mounted as the persistent wallpaper; window-manager + dock primitives; Playwright smoke + screenshot script; `tsc`/biome/vitest green |

## Phase 3 — Features (parallel)
| WP | Owner | Boundary | Acceptance |
|---|---|---|---|
| B2 Engine & ingest | Opus | `crates/atlas-engine` | runs against the live API for 30+ min with no errors; events derived correctly (unit tests from fixture pairs); metrics/snapshots/time machine persist and reload; peer crawl respects the SSRF guard and rate limits; memory stays flat |
| B3 API server + live hub | Opus | `crates/atlas-server` | every §6 endpoint is implemented and tested; pre-built bodies with ETag/compression; WS protocol incl. replay/resync; search resolution; explorer proxy cache; SPA embed; `oha` p99 < 5 ms on hot endpoints |
| F2 Shell & signature moments | Sonnet | `web/src/shell/**`, `web/src/ui/**` | boot sequence on real load progress; windows (drag/snap/stack/minimize); dock; ⌘K palette; terminal; toasts; achievements; ambient mode; phone layout |
| F3 Inspectors | Sonnet | `web/src/features/{node,app,operator}/**` | node + app inspectors, app constellation, operator view, watchlist |
| F4 Explorer & analytics | Sonnet | `web/src/features/{explorer,analytics,timemachine,search}/**` | live block rail, block/tx/address/mempool, analytics dashboards, time-machine scrubber |

## Phase 4 — Integration & hardening
| WP | Owner | Scope |
|---|---|---|
| I1 Integration | Opus | real backend ↔ frontend end to end, contract mismatches, perf passes (backend + globe FPS) |
| Q1 Visual QA & polish | Sonnet | screenshot sweep across routes × viewports, motion polish, a11y, reduced motion |
| X1 Review | Opus | security (SSRF, input validation, DoS limits), correctness, efficiency |

## Phase 5 — Ship
`deploy/Dockerfile`, `deploy/flux_app_spec.json`, README, removal of v1 dirs, final review, and hand-off.

## Team conventions
- **Clean-room rewrite: no v1 code is carried over** (no snippets, formulas, layouts, styles, or structure).
  v1 is only a reference for purpose and network/API facts. Every brief restates this.
- **No emojis** anywhere in v2: docs, code, comments, UI copy, commit messages. Use plain-word statuses; UI icons come from an icon set.
- Rust: `export PATH="$HOME/.cargo/bin:$PATH"`. Web: Node 26 + npm.
- Visual verification tool: `node $SCRATCH/team/tools/shot.mjs <url|file> <out.png> [--gpu --fps --frames N --mobile --eval js]`,
  where `$SCRATCH` is the session scratchpad the lead gives in each brief.
- Agents don't commit. The lead reviews and commits per milestone.
- Contract changes (DTOs, binary formats, WS messages) go through `docs/ARCHITECTURE.md` first.

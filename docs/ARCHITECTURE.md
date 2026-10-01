# Flux Atlas v2 — Architecture

> Status: **DRAFT v0.1** (tech lead, 2026-09-30). Sections marked **[TBD research]** are finalized once
> `docs/research/*.md` land. This document is the contract every team member builds against. If you
> need to deviate, say so in your report. Don't silently diverge.
>
> **Clean-room rule:** v2 is a whole rewrite. **No code is carried over from v1** (`backend/`, `frontend/`) —
> no snippets, formulas, layouts, styles, or structure. v1 is a reference for the product's purpose and for
> facts about the network/API only.

## 1. Goals

| Goal | Target |
|---|---|
| See the whole Flux network live | every node, app, and block, with history from first ingest |
| Hot API latency | p99 < 5 ms for snapshot endpoints (served from memory, pre-serialized, pre-compressed) |
| **Live-first** | Every change reaches browsers as an event, animated as it happens. Freshness tiers: T1 ≤ 3 s (blocks, producer, payouts, node heartbeats/starts, mempool), T2 ≤ 60 s (app deploys/updates, instance placement, node-list reconciliation), T3 continuous rolling crawl (peers, reachability, benchmarks, installed apps; each host revisited ≤ 20 min, and updates stream out per host, never as a batch) |
| Frontend perf | 60 fps globe at 1440p with 15k nodes + 200 arcs + 50 pulses; first meaningful paint < 2 s |
| Footprint | one self-contained binary (API + embedded web app) + one data dir, one process, one port (3000); fits the live Flux app spec (1 vCPU / 2,500 MB RAM / 10 GB disk) with wide headroom, measured in section 11 |
| Upstream etiquette | bounded req/s, conditional requests where possible, failover, no hammering of individual nodes |
| Resilience | serves the last-known state instantly on restart; degrades gracefully when upstream is down |

Non-goals: running a Flux daemon or indexing the whole chain ourselves. The explorer proxies upstream
explorer APIs with caching, and we index only what we observe from first ingest (plus a bounded backfill).

## 2. Repository layout

```
Cargo.toml                 # Rust workspace (resolver 3, edition 2024)
crates/
  atlas-core/              # domain model, ids, enums, API DTOs + WS messages (serde + ts-rs), binary codecs
  atlas-flux/              # upstream clients (FluxOS API, explorer, aggregators), raw models, parsers, failover, rate limits
  atlas-store/             # redb persistence: tables, value codecs, migrations, retention/compaction
  atlas-engine/            # ingest schedulers, reducer (single-writer state), diff→events, metrics, snapshots, time machine
  atlas-geoip/             # local GeoIP: memory-mapped DB-IP City Lite reader, verified download + atomic install
  atlas-server/            # axum HTTP + WebSocket, pre-built bodies, search, explorer proxy cache, static web embed, CLI (bin: `atlas`)
web/                       # React 19 + TypeScript + Vite frontend
labs/globe/                # standalone globe/ambient renderer lab (ported into web/src/globe)
docs/                      # ARCHITECTURE.md, PLAN.md, research/, design/
deploy/                    # Dockerfile (+ Dockerfile.dockerignore), flux_app_spec.json
```

The v1 dirs (`backend/`, `frontend/`, root Dockerfile/compose/spec) stay until the v2 cut-over (PLAN phase 5),
then get deleted.

Environment: the Rust toolchain lives in `~/.cargo/bin` (`export PATH="$HOME/.cargo/bin:$PATH"`). Node 26 + npm.

## 3. Backend runtime model

```
            ┌──────────── atlas-flux (clients) ─────────────┐
 schedulers │ TipWatcher  NodeList  Geo/Bench  Apps  Chain  │  ← rate-limited, retrying, failover
            └───────┬───────────────────────────────────────┘
                    │ Observation (typed, parsed upstream result)
                    ▼
            ┌──────────────── Reducer (1 task) ─────────────┐
            │ owns mutable NetworkState; applies observations│
            │ diff → Vec<Event>; recompute derived views     │
            └──┬─────────────┬──────────────────┬───────────┘
               │ ArcSwap     │ broadcast        │ mpsc (batched)
               ▼             ▼                  ▼
        Published (immut.)  LiveHub (WS)    StoreWriter (redb, 1 write txn per tick)
        + PrebuiltBodies    ring buffer     events, node history, metrics, snapshots, blocks
               ▲
        axum handlers (lock-free reads)
```

- **Single-writer reducer.** Only the reducer mutates state, so there are no locks on the hot path. After each
  applied batch it builds a new immutable `Published` (Arc-shared, structurally reusing unchanged parts) and
  swaps it in with `arc_swap`. Readers never block.
- **Pre-built bodies.** On publish, the reducer (or a helper task it spawns) serializes the hot endpoints once
  (`bootstrap.json`, `nodes.bin`, `apps.json`, …), pre-compresses each one (br + gzip + zstd), and computes a
  strong ETag. Handlers just pick the right encoding: zero serialization per request. **Brotli runs at quality 6**
  (measured on `nodes.bin`: q6 9.4 ms / 74 KB, q9 20 ms / 73 KB, q11 563 ms / 52 KB); q11 is far too slow for a
  body rebuilt every block.
- **Sequencing.** Every publish increments `seq: u64`. Snapshot bodies carry `seq`; WS deltas carry
  `seq` / `prev_seq`, so clients can detect gaps and resync.
- **Persistence is write-behind.** The StoreWriter batches everything from a tick into one redb write
  transaction. It commits with `Durability::Immediate` at most every 10 s and `Eventual` otherwise
  (settle the exact policy in atlas-store).
- **Startup.** Open the DB → load the last state (node records, apps, recent blocks, latest snapshot) → publish
  immediately (API is ready in < 1 s with last-known data, flagged `stale: true`) → start schedulers.
- **Allocator:** mimalloc. **Runtime:** tokio multi-thread.

### 3.1 Upstream client rules (atlas-flux)
- reqwest + rustls, HTTP/2 where offered, gzip/br/zstd decode, pooled connections, 20 s default timeout
  (per-endpoint overrides for big payloads).
- A per-upstream `governor` token bucket (default ≤ 4 req/s to `api.runonflux.io`) plus a concurrency
  semaphore.
- Retries: 3 attempts, jittered exponential backoff; never retry 4xx except 429 (honor `Retry-After`).
- **Failover pool:** the primary is `https://api.runonflux.io`. The secondaries are healthy FluxOS nodes picked
  from the current node list (`http://<ip>:<apiport>`), health-scored and rotated. A response is only accepted
  if its chain height is within ±2 of the best known tip (this guards against stale nodes).
- Parsers are tolerant: unknown fields are ignored, and missing optional fields become `None`. Every parser has
  a unit test against `docs/research/fixtures/**`.
- Large JSON (multi-MB node lists): parse from bytes with serde_json, or `sonic-rs` if a benchmark shows ≥ 2×
  gain. Measure first.

### 3.2 Live-first ingest [TBD research: exact endpoints, push channels, latencies]

**Principle.** The system is an event stream, not a rebuild loop. Every ingest path produces fine-grained
events the moment it learns something. Snapshots exist only to bootstrap and resync clients. Where the upstream
offers push, use it. Where it doesn't, poll the cheapest possible change indicator tightly, and fetch the
expensive payload only when that indicator moves. v1 rebuilt everything every 30 min; v2 never batches.

| Tier | Job | Source (prefer push, else tight poll) | Cadence | Events |
|---|---|---|---|---|
| T1 | **ChainStream** | Insight socket.io (Engine.IO 3) `wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket`, send `42["subscribe","inv"]`, ping `2` every 25 s. Run **two sockets at once** (main + `explorer2.runonflux.io`), dedupe by hash. Unhealthy after 90 s without a block or a ping timeout. Fallback only while no socket is healthy: poll Insight `/api/status?q=getLastBlockHash` every 2 s. **Never** poll the FluxOS gateway for liveness (30 s apicache, measured 27 s lag). | push (0.94 s median after block time) | `NewTip(hash)` |
| T1 | **BlockDecoder** | FluxOS `GET /daemon/getblock/{hash}` (verbosity 2, ~160 ms, ~10 KB): every tx decoded, including fluxnode fields. Producer = header `collateral` (10-hex prefix + index), resolved against the local node table (Insight `/api/block/{hash}` `nodesCollateral` for the full txid if ambiguous). Payouts: classify the coinbase outputs **by amount** (Cumulus 1.0 / Nimbus 3.5 / Stratus 9.0 × reduction factor; the remainder, 0.5 + fees, goes to the dev fund `t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA`). Reorg-aware: check `previousblockhash` against our tip, walk back on mismatch, fill gaps. 10-block finality window. Optional `getblockdeltas/{hash}` for transfer inputs. | per block (~30 s), ~3 upstream calls | `BlockAdded` (producer, payouts, dev fund, tx mix), `NodeHeartbeat` (confirm tx, `update_type` 1), `NodeConfirmed` (`update_type` 0 = initial confirm), `NodeStarted` (start tx, v5/v6, incl. P2SH/multisig), `NodePaid`, `NodeIpChanged` (confirm carries IP), `LargeTransfer` |
| T1 | **PayoutAttribution** | Our own payment-queue model per tier (rank order from the node list, advanced locally on every block; the paid node moves to the back). Match each coinbase payee `(tier, address)` against the head of that tier's queue. Reconcile with `last_paid_height` from NodeReconcile. **Must be recorded at ingest time**, since `last_paid_height` is overwritten on the next payment and one address can own 180+ nodes. | per block | `NodePaid` with an exact node; drives the **"next to be paid"** predictive highlight (head of each tier queue) before the block lands |
| T1 | **MempoolStream** | the same Insight socket, `tx` events (~23/min; ~91% are fluxnode confirms/starts with empty `vout`, ~2/min regular transfers carrying value + outputs). Push transfers immediately. Socket fluxnode txids do not resolve, so node txs come from the 20 s reconcile, fetched and classified (≤ 0.4 req/s per host) before they are streamed; see Mempool classification below. | push | `MempoolTx` (transfer / app payment; node txs from the reconcile) |
| T1 | **Expiry watch** | derived: a node is dropped by the block `last_confirmed + 641` (still listed at `+ 640`; see "Lifecycle boundaries" below); confirms are allowed every **≥ 500 blocks** | per block | `NodeAtRisk` (≥ 560 blocks since last confirm), `NodeExpired` (predicted, then confirmed by reconcile) |
| T1 | **AppChainFeed** | app register/update payments are txs with an OP_RETURN (message hash) to the app address; seen in the decoded block → `GET /apps/permanentmessages?hash=<h>` for the exact spec + price paid | per block | `AppRegistered`, `AppUpdated` (spec diff + FLUX paid) |
| T2 | **AppPending** | `/apps/temporarymessages` (5 s apicache, 12.8 KB br). Pending deploys appear a median ~168 s before they're mined; ~15% never get mined (show as pending, expire after 1 h) | 10 s | `AppPending` → promoted when the OP_RETURN lands, or `AppPendingExpired` |
| T2 | **AppInstalling** | `/apps/installinglocations` (30 B when empty) | 10 s | `AppInstalling` |
| T2 | **AppPlacement** | `/apps/locations` (318 KB br), diffed on `(name, ip)`: new key = spawn, missing = removal/expiry, changed `hash` = rolling update. **Hot apps** (open in any client) are polled via `/apps/location/<name>` every 5–10 s | 90 s (configurable 60–120) | `AppInstanceStarted`, `AppInstanceRemoved`, `AppInstanceUpdated` |
| T2 | **AppCatalog** | `/apps/globalappsspecifications` (1.22 MB) with `If-None-Match`, plus an immediate refresh on AppChainFeed; `/apps/installingerrorslocations` every 15 min; marketplace list hourly | 10 min | reconciliation + `AppInstallFailed` |
| T2 | **NodeRegistry** | a **block-driven state machine**: starts, initial confirms (joins), heartbeats (every ~500–520 blocks), IP changes, payouts, collateral spends (from block vins), expiry (the block `last_confirmed + 641`), DOS (an unconfirmed start at `added + 240`) and the end of a DOS ban (`added + 720`) are all derived per block. Rank is recomputed locally with fluxd's own sort: per tier, ascending `last_paid_height` (or `confirmed_height` when never paid), never-paid before paid at one height, then the collateral outpoint in fluxd's byte order (see "Queue order" below); it reproduces all 6,724 ranks of the research dump. Reconciled against `/daemon/viewdeterministicfluxnodelist` (546 KB br) every 10 min, or immediately if `getfluxnodecount` (60 s) totals disagree. `getstartlist` / `getdoslist` every 60 s as cross-checks. Any reconcile diff is logged as a bug signal | per block + 10 min | `NodeStarted`, `NodeConfirmed`, `NodeHeartbeat`, `NodeIpChanged`, `NodeExpired`, `NodeDosed`, `NodeCollateralSpent`, `RankShift` (coalesced) |
| T2 | **NextPayees** | local queue model (rank 0 per tier), validated against `fluxnodecurrentwinner?nc=<ts>` after each tip (it names the exact payees of the next block; ignore it if stale) | per block | `NextPayees` (drives the pre-aimed payout glow) |
| T2 | **Chain** | `getfluxnodecount`, socket `info` (supply per block) | 60 s / push | `Stats` |
| T2 | **Price** | Insight `/api/markets/info` (Flux-provided; also pushed as socket `markets_info`), CoinGecko `ids=zelcash` as fallback | 60 s / push | `Price` |
| T2 | **Supply** | FluxOS `gettxoutsetinfo` (3 s upstream; cache 10 min) + `getblockchaininfo.valuePools`; socket `info.supply` per block | per block (socket) / 10 min | `Stats` |
| T3 | **StatsRound** | `stats.runonflux.io/fluxinfo` (1.63 MB br full; `?projection=` variants), fetched whenever `roundTime` changes (check every 5 min; rounds take ~15–18 min). Gives hardware/benchmarks, FluxOS/fluxd/bench/ArcaneOS versions, geolocation (ip-api: lat/lon, country, region, org, ASN, hosting flags), running apps and locked resources for every node. ~150 unreachable nodes come back with an `error` and **zeroed placeholders: treat them as missing, never as (0,0)** | per round | `NodeHardwareChanged`, `NodeVersionChanged`, `NodeUnreachable`/`NodeRecovered`, `NodeLocated`, `StatsRound` (freshness) |
| T3 | **GeoResolve** | `stats.runonflux.io/fluxlocation/<ip>` (0.5 s, works for any node IP) **immediately** for every new or changed IP (so new nodes land on the globe within seconds), and for zero-geo nodes; cached 7 days per IP. Local fallback for org/country/region: Flux's own `iplocation.bin.gz` (the table FluxOS placement uses; weekly). **City names** (and approximate coordinates for nodes without any) from the local DB-IP City Lite database, see *Local GeoIP* below | on event | `NodeLocated` |
| T3 | **TopologySweep** | `/flux/topology` on rotating reachable nodes (each call returns ~60 reporters' peer lists). **Rolling: one call every ~12 s**, and each result streams immediately, so the whole overlay graph refreshes about every 30 min without a batch | continuous | `PeerLinksChanged` (mesh deltas) |
| T3 | **WatchProbe** | direct, SSRF-guarded probes of **watched** nodes only (clients' watchlists): `/flux/version` (or `/flux/uptime`) every 60 s. This gives operators near-real-time offline detection, which is otherwise impossible at network scale | 60 s per watched host | `NodeUnreachable`/`NodeRecovered` (fast path) |

**No full-network per-node crawl.** Aggregated sources (stats rounds, topology) replace it. We only touch individual
node APIs for TopologySweep, WatchProbe and failover reads, always through the SSRF guard.

**Bootstrap backfills (background, resumable, polite):** `stats /fluxhistorystats` (30 days of tier counts at
~15-min resolution → metrics); `/apps/permanentmessages` full (one call, 24.5 MB, 6 years of app history →
app timelines and "spec archaeology"); the last 7 days of blocks via `getblock` (1.5 req/s by default,
`ATLAS_BACKFILL_DAYS` / `ATLAS_BACKFILL_RPS`), extendable to 30 days.

> **Implemented (B2, I1).** Deviations and precisions over the table above:
> - **Gap jump.** The block sync fills gaps of up to 30 blocks (`max_live_gap`) live. A larger gap jumps straight
>   to the tip: that block is applied as **discontinuous** (no expiry/at-risk derivation across the hole), and the
>   block backfill fills the hole in the background. The reconcile that follows a jump adopts the list; its
>   differences are expected and not counted as bug signals.
> - **Restart catch-up (B5).** Until the chain first reaches an announced tip after a restart, the block sync replays
>   every missed block instead of jumping, up to `max_catchup_gap` (1,440 blocks, about 12 h of downtime; one
>   `getblockhash` + one `getblock` per block). Each missed payout rotates the restored queue exactly as it rotated
>   upstream, and clients rotate the same way from the replayed `block` messages, so no rank correction follows a
>   restart. Catch-up blocks (older than 2 min) skip the `currentwinner` fetch and the tip-latency sample.
> - **Deferred reconcile (B5).** A node list whose height is above the applied tip waits until the block sync
>   reaches that height (or until no block arrived for 90 s: a stalled sync is reconciled anyway). Adopting it
>   first would roll the model forward, and the blocks applied after it would pay and rotate the same nodes a
>   second time: this was the "thousands of rank diffs after every restart" bug signal (the startup reconcile
>   runs within a second of the restart, before the catch-up). Nodes that newer blocks changed are still skipped,
>   but fields those blocks cannot know (tier, payment address, confirm height, an unknown last payment) are filled
>   from the list. On shutdown every listed record is written with its current rank. (Since B6 the restore does not
>   need the stored rank: the queue key is fluxd's full order, see "Queue order".)
> - **Lifecycle boundaries (B6, from fluxd `RunOnFlux/fluxd` @ `8a60ee63`).** `ConnectBlock` (`src/main.cpp`
>   4118 to 4129) applies, at the height `H` of the block being connected: confirm expiry when
>   `nLastConfirmedBlockHeight < H - 640` unless that block confirms the node (`src/fluxnode/fluxnode.cpp` 235, 276,
>   280), so a node last confirmed at `c` is listed through `c + 640` and gone at `c + 641`; DOS for a start with
>   `nAddedBlockHeight == H - 240` that the block does not confirm (`CheckForExpiredStartTx`, 494); the end of a DOS
>   ban when `nAddedBlockHeight <= H - 720` (`GetUndoDataForExpiredFluxnodeDosScores`, 220), after which fluxd no
>   longer tracks the collateral. Verified live: `7feb2f4f...:0` (last confirmed 2,997,359) was listed at 2,997,999
>   and gone at 2,998,000. The engine used `>= 640` before, one block early: the B5 soak's
>   `expiry_mispredicted` (node `c6ec3309...:0`, last confirmed 2,997,231, still in the list at 2,997,871) was this.
>   The heights are `atlas_core::node::windows::{expiry_height, dos_height, dos_end_height}`. A start resets the
>   node's heights and a first confirm resets its last payment (fluxd builds fresh cache data, `nLastPaidHeight = 0`,
>   `fluxnode.cpp` 327, 1166). A DOS entry the DOS list no longer holds after its ban is dropped as departed (the
>   block path does this at `added + 720`; the list catches jumps).
> - **Queue order (B6).** fluxd sorts each tier's payment list with `FluxnodeListData::operator<`
>   (`src/fluxnode/fluxnode.h` 313): comparator height `nLastPaidHeight` if non-zero, else `nConfirmedBlockHeight`;
>   at one height a never-paid node comes first; ties go by `COutPoint` (`src/primitives/transaction.h` 446), whose
>   `uint256` compares its internal bytes with `memcmp` (`src/uint256.h` 94), i.e. the hex text reversed, then the
>   output index. `SortList` (`fluxnode.cpp` 1436, 1470) runs after every block that pays the tier, and the RPC rank
>   counts only entries still confirmed (`src/rpc/fluxnode.cpp` 1507, 1559), so expired entries left in the list
>   until they reach its front never shift a rank. The engine's queue key is this function of the record alone
>   (`state::queue::key_of`), so joins confirmed in one block, a reconcile and a restart all produce the exact
>   upstream order with no upstream rank or transaction order involved. Measured on the live list (height
>   2,997,987): all 145 tie groups put never-paid nodes first and all 30 groups of several never-paid nodes follow
>   the reversed-byte order (6 of them would also match the hex order).
> - **Restore arms expiry (B6).** A store that has been reconciled before (it has `first_ingest_ms`) restores an
>   armed model, so the blocks replayed after a restart derive expiry and DOS like live blocks. Unarmed, a node that
>   expired during the downtime stayed queued until the first reconcile removed it and shifted every rank behind
>   it (measured on 3106: 1,466 ranks moved by one removal after a 62-block catch-up).
> - **Payment address of a fresh start (B6).** No fluxnode transaction carries the payment address (fluxd's
>   `TxToJSON` has it commented out), so a node seen first in a start transaction has none until the start list or
>   the node list names it. After a block with such starts the engine polls `getstartlist` 25 s later (past the
>   daemon's 20 s cache, `?nc=` past the gateway's apicache) instead of waiting for the 60 s poll, so a join that
>   confirms a few blocks later already has it. A reconcile that still finds an empty address fills it and counts
>   it under `filled`, not as a diff: that was the B5 `payment_address` bug signal (node `da84503a...:0` started at
>   2,997,933 during a restart and confirmed 5 blocks later). A different non-empty address stays a bug signal.
> - **Reconcile report (B6).** Per reconcile: field `diffs` (bug signals), `rank_diffs` (listed nodes whose
>   position among the nodes queued in their tier both before and after changed: order errors; a join or a leave
>   shifts ranks too but is a membership diff), `queue_order` (adjacent upstream ranks whose model keys are out of
>   order: a direct check of the key rule), `filled` (unknown fields taken from the list), and up to 12 `samples`
>   with node, field, model and list values in the warning log.
> - **Reorgs.** On a `previousblockhash` mismatch the sync walks back through the 10-block finality window to the
>   fork, then the reducer deletes the orphaned blocks (store and recent ring), moves the tip to the fork, clears
>   the expected payees, emits `reorg` (+ a feed item), and **triggers an immediate NodeRegistry reconcile**. The
>   replacement blocks then arrive as ordinary `block` messages. A reorg deeper than the window is logged as an
>   error and treated as a discontinuity.
> - **Mesh expiry.** Each TopologySweep reporter's peer list replaces its previous one. A report not refreshed for
>   **1 h** (about two sweep cycles) expires, and an edge no unexpired report lists is removed (streamed as a `mesh`
>   delta).
> - **Mesh hysteresis (B6).** An edge appears as soon as a report from either endpoint lists it, and is removed only
>   when **two consecutive reports covering it** (new reports from either endpoint) omit it, or when no unexpired
>   report lists it. Before, the newer of the two endpoints' reports decided alone, and a single omission removed the
>   link. Measured on 3106 with that rule: about 320 links added and 310 removed per 12 s call (out of about
>   134,000), and 31.7% of the removed links came back within 10 minutes (20.6% of all additions re-added a link
>   removed within the previous 30 minutes): the copies of a reporter's list that different queried nodes hold
>   differ in age, and the two endpoints disagree for a while after a reconnect. Every added link is a handshake
>   on the globe, so that noise was visible. A real disconnect now leaves the globe one covering report later
>   (typically the next call that includes either endpoint, up to one sweep cycle, about 30 min). Measured over a
>   2 h soak with this rule (747 calls): 7.3% of removed links came back within 10 minutes (16.2% within 30). What
>   churn remains comes mostly from a few queried hosts (5.230.173.205 and .206, every port) whose copies of the
>   reporters' lists hold far more links than other nodes' copies: a call to one of them adds 2,400 to 3,900 links
>   where a typical call adds about 250, and the next covering reports from other nodes remove them again.
>   `bidirectional` still means both latest reports list each other.
> - **Watch hooks.** The server forwards every `sub` with `watch` / `watch_apps` to `EngineHandle::set_watch`
>   (and `clear_watch` on disconnect); the engine unions them into WatchProbe targets and hot-app polling.
> - **Mempool classification.** The socket `tx` push carries no fluxnode type, no OP_RETURN and no size. Its
>   fluxnode pushes also carry txids that resolve nowhere (not in the daemon mempool, not in any block, and
>   Insight's own `/api/tx` answers "Not found"; measured: 66 of 66 over 150 s), so the engine ignores them and
>   takes node txs from the reconcile only. Socket transfers are pushed immediately (complete as pushed: kind
>   `transfer`, `size: null` until the reconcile fills it); socket app payments are pushed as `app_message` and
>   fetched (the OP_RETURN decides). The 20 s reconcile is cache-busted (`?nc=`: the gateway's 30 s apicache
>   answers with the previous block's transactions, already mined), fills sizes, and txids in it that the socket
>   never pushed are fetched, classified with the block classifier (`atlas_flux::decode::kind_of`, from the
>   daemon or the Insight form of the tx: `node_start` / `node_confirm` / `app_message` / `transfer`, with the
>   size) and only then streamed as new `mempool` entries. One fetch every 1.25 s, newest first, each txid
>   once, alternating gateway `getrawtransaction/<txid>/1` and Insight `/api/tx/<txid>` (0.4 req/s per host);
>   entries older than 2 min are dropped from the queue (mined by then, and classified by the block).
>   What stays unknown before mining: whether an app payment registers or updates, and which app (known when the
>   pending `temporarymessages` entry or the mined `permanentmessages` entry is matched); whether a tx is mined at
>   all; and, for up to one reconcile plus the fetch queue (about 20-30 s), the node txs themselves, which
>   appear once fetched rather than at broadcast.
> - **Local GeoIP (B5).** No upstream source carries a city (stats `fluxinfo` and `fluxlocation` have none; measured
>   0 cities over 2,654 hosts), so cities come from DB-IP "IP to City Lite" (crate `atlas-geoip`):
>   - *Fetch:* `https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz` (UTC month; the previous month while
>     the current one is not published), outbound HTTPS only, checked about 30 s after start and then daily, in
>     the background: startup and ingest never wait for it, and without a database cities stay unknown.
>   - *Install:* the download (about 60 MB) is decompressed to a staging file (the gzip CRC and length trailer are
>     checked; output capped at 1 GiB), memory-mapped and checked (MaxMind DB metadata, a City database type,
>     40 MB to 1 GiB, at least 3 of 4 probe addresses answering their known country), then renamed over
>     `<ATLAS_DATA_DIR>/geoip/dbip-city-lite.mmdb`. The replaced file is kept as `dbip-city-lite.prev.mmdb` (a hard
>     link, so the live path never disappears) and `dbip-city-lite.json` records the month. A failed check leaves the
>     live database untouched; leftovers of an interrupted update are removed at the next start.
>   - *Read:* the file is memory-mapped (`maxminddb` over `memmap2`, `MADV_RANDOM`), never read onto the heap.
>     Measured on the 2026-09 file (127 MB): open 21 us, 2,655 node hosts looked up in 3 ms warm / 145 ms cold,
>     heap (RssAnon) unchanged. In the server (3105, 10 min after start): RssFile 11.8 MB without GeoIP, 13.2 MB
>     with it after a cold start, 19.1 MB 10 min after an install (the freshly written file is in the page cache,
>     so fault-around maps neighbouring pages; +44 MB right after the install). These are clean file pages the
>     kernel can drop. RssAnon varied 207 to 248 MB across runs with and without GeoIP (engine noise; the
>     database adds no heap beyond the city strings, which fit inline). Restart cost: under 4 ms warm, about
>     120 ms with a cold page cache (complete locations skip the lookup).
>   - *Use:* a node's geo gets the DB-IP city, and the region when its source has none. Country, org and ASN are
>     never overridden (an empty country is filled), and nothing is taken when DB-IP disagrees with the source on
>     the country. A node without usable coordinates gets DB-IP's (city-level, approximate) with
>     `source: local_db`, which sets the `geo_approx` flag in `nodes.bin`; it still counts as unlocated for
>     GeoResolve, so a precise location replaces it. Enrichment runs on restore (before the first publish), on
>     every geo update from a stats round or GeoResolve, and over all nodes when a new database is installed
>     (one `nodes` delta, `cause: geo`). Cities reach `NodeRecord.geo.city`, `nodes.bin` LOCATIONS, snapshots
>     (keyframes record geo with city), `NodeRef.city`, `NodeLite.city` and `NodeChange.city`.
>   - *Config:* `ATLAS_GEOIP_AUTO` (default on) switches the download; `ATLAS_GEOIP_DB` points at an
>     operator-managed `.mmdb` instead (auto-download off; reloaded when its modification time changes; replace
>     it by rename, never rewrite it in place, since it is memory-mapped). With `ATLAS_INGEST=0` nothing is
>     downloaded, but an existing database is still read.
>   - *Attribution (CC BY 4.0):* "IP Geolocation by DB-IP" with a link to https://db-ip.com, wherever the data is
>     shown. `/bootstrap` lists it in `attributions` while a database is loaded, or while stored nodes still carry
>     its data (any city or `local_db` location, for example after the download was turned off), so the About view
>     can show it.
> - **Ingest switch.** `ATLAS_INGEST=0` (or `IngestConfig::disabled()`) runs the engine without ingest jobs: it
>   restores, publishes and serves the stored state. Tests, fixtures and `demo_server` always run this way.

**FluxOS caching facts:** apicache keys on the full URL (30 s default; 5 s for topology/temporarymessages;
2 min for permanentmessages), and **a unique query string (`?nc=<ts>`) bypasses it**. Only use that where freshness
matters (currentwinner, fallback tip detection). A second, internal 20 s daemon-RPC cache cannot be bypassed,
except that errors are never cached. `getblock`/`getrawtransaction` are cached by hash, so they're always fresh.
`api.runonflux.io` appears pinned to one backend (`fluxnode:` response header), so node-local endpoints through
it describe that one node. Keep a pool of healthy direct nodes for failover.

**Tip-detection fallbacks** (only while both explorer sockets are unhealthy): Insight `getLastBlockHash` every
2 s; then, if Insight is down too, FluxOS `getblockhash/<tip+1>?nc=<ts>` at 1 req/s rotated across 3–5 healthy
nodes (errors are uncached, so it is detected within 0.9–2.2 s). Steady-state polling cost is zero.

**Parsing quirks:** ints arrive as strings (`outidx`, `activesince`, `lastpaid`, `amount`, v2/v3 ports), objects as
strings (`apps.fluxusage: "0"`), typos (`explorerScannedHeigth`, `enviromentParameters`), node-list IPs omit `:16127`
while other sources always include the port (normalize to `host:port`), and pre-PoN app `expire` values are in
2-minute blocks (×4 after height 2,020,000).

**Chain facts (verified 2026-09-30):** Proof of Node since height 2,020,000 (2025-10-25). 30 s target spacing
(29.98 s measured). 14 FLUX/block. **The first 10% reward cut is at height 3,071,200 (~2026-10-26)**, then every
1,051,200 blocks, up to 20 cuts. Collateral: 1,000 / 12,500 / 40,000 FLUX. The producer earns nothing extra.
Insight's `minedBy` is the Stratus payee, **not** the producer, so never label it "miner". FluxOS errors arrive as
**HTTP 200 with `status:"error"`**, so always check the envelope. Blockbook is **not used**: its operator restricts
it to Trezor Suite.

**Upstream budget:** ~3 calls per block for the chain path regardless of viewer count, ≤ 4 req/s per upstream host
overall, circuit breaker on 5xx/timeouts. Total steady-state transfer is ~0.7–1.1 GB/day, dominated by the
`/apps/locations` diff (its interval is the main lever). Older blocks are proxied on demand and cached forever
beyond the finality window.

Detection budget: T1 events should reach the browser ≤ 3 s after the block/tx is visible upstream (target ≤ 1 s
with push). The server stamps every event with `observed_ms` and the upstream `event_ms` (block time / first-seen),
so clients can show true latency.

**Choreography contract (server side):** the events of one block are emitted as one `block` message carrying
its child events (heartbeats, payouts, starts). The client then stages the animation (producer beam → payout
arcs → heartbeat ripple over a few seconds) instead of receiving a burst of unrelated messages. Non-block events
stream individually. The server never drops events to save bandwidth, but it may coalesce `RankShift` /
`StatsRound` into periodic summaries.

**SSRF guard (mandatory):** node IPs come from a public list anyone can register into. Never connect to
loopback, private (RFC1918/ULA), link-local, CGNAT, multicast, documentation, or unspecified ranges. Only
connect on the node's advertised port (or the 16127 default), and cap response sizes (e.g. 4 MB).

**Addressing facts (verified 2026-09-30):** 6,724 nodes (Cumulus 3,378 / Nimbus 1,582 / Stratus 1,764) on 2,655 IPs.
Up to 8 nodes per IP on UPnP API ports 16137/16147/…/16197; default 16127 (TLS on API port + 1; UI port = API
port − 1). No IPv6 or onion nodes today (parse bracketed IPv6 anyway). 12 confirmed nodes have an empty IP: keep
them, but they can't be located.


### 3.3 Identity
- **Canonical node identity = collateral outpoint** (`txid:vout`), since IPs change. Internally every node
  gets an interned `NodeId(u32)` on first sight, persisted in `node_ids`, so ids stay stable across
  restarts of one data directory.
- **Node ids are instance-local (B9).** The app runs as two independent instances behind one domain, each
  with its own data directory, so the same id names different nodes on the two instances (ids are assigned
  in order of first sight). Clients use ids only within one origin (section 8.1) and never persist them or
  put them in shareable URLs: anything stored or shared uses the outpoint, the stable key.
- **Instance and start epoch (B9).** Each data directory has a random 64-bit instance id (`meta`
  `engine.instance_id`, created on first start), sent as 16 lowercase hex digits in `ServerInfo.instance`.
  `ServerInfo.started_ms` is the process start epoch; live `seq`s restart with every process. The pair
  `(instance, started_ms)` is a snapshot's **origin**: bootstrap and `hello` carry it in `server`, and
  `nodes.bin`, `mesh.bin` and `/timeline/state` in their ORIGIN section (section 7).
- Apps: name (case-insensitive, stored lowercase + display name).
- Blocks: height (u32) + hash.

## 4. Domain model (atlas-core) — sketch, finalize from research

```rust
pub struct NodeId(pub u32);
pub struct Outpoint { pub txid: [u8; 32], pub vout: u32 }
#[repr(u8)] pub enum Tier { Unknown = 0, Cumulus = 1, Nimbus = 2, Stratus = 3 }   // [TBD] new node types?
#[repr(u8)] pub enum NodeStatus { Unknown = 0, Confirmed = 1, Started = 2, /* [TBD] */ }
pub struct Geo { lat: f32, lon: f32, continent: CompactStr, country_code: CompactStr, country: CompactStr,
                 region: CompactStr, city: CompactStr, org: CompactStr, asn: Option<u32>, source: GeoSource }
pub struct Hardware { cores: u16, threads: u16, ram_gb: f32, ssd_gb: f32, eps: f32,
                      down_mbps: f32, up_mbps: f32, arch: Arch, bench_status: BenchStatus }
pub struct Versions { flux_os: Option<CompactStr>, daemon: Option<CompactStr>, bench: Option<CompactStr> }
pub struct NodeRecord { id: NodeId, outpoint: Outpoint, ip: IpAddr, api_port: u16, tier: Tier, status: NodeStatus,
                        payment_address: CompactStr, rank: Option<u32>, added_height: u32, confirmed_height: Option<u32>,
                        last_confirmed_height: Option<u32>, last_paid_height: Option<u32>,
                        geo: Option<Geo>, hw: Option<Hardware>, versions: Versions,
                        app_count: u16, first_seen_ms: u64, last_seen_ms: u64 }
pub struct AppRecord { name, display_name, owner, spec_version, description, registered_height, expire_height,
                       target_instances, components: Vec<Component>, domains, ports, totals: Resources,
                       enterprise: bool, geo_rules, locations: Vec<AppInstance>, spec_hash, first_seen_ms, updated_ms }
pub struct BlockSummary { height: u32, hash: [u8; 32], time: u64, size: u32, tx_count: u32,
                          producer: Option<NodeId>, payouts: SmallVec<[Payout; 4]>, reward: Amount }
pub enum Event { NodeAdded, NodeRemoved, NodeStatusChanged, NodeIpChanged, NodePaid, NodeVersionChanged,
                 NodeHardwareChanged, AppRegistered, AppUpdated, AppExpired, AppInstanceAdded,
                 AppInstanceRemoved, BlockAdded /* … */ }
```

Conventions:
- Time is `u64` unix **milliseconds** everywhere (DB, API, WS). Heights are `u32`.
- **Money:** `Amount(i64)` in base units (1e-8 FLUX). It crosses the wire as a **decimal string in FLUX**
  (e.g. `"1234.56789012"`), because JS numbers lose precision on supply-sized values. Aggregates/analytics
  may use `f64` FLUX, and the field name must say so (`*_flux_f64`).
- Strings: `compact_str::CompactString` for small repeated strings. Country/org/city/version strings are
  interned into tables in binary payloads.

## 5. Persistence — redb (pure-Rust, ACID, MVCC, single writer / many readers)

Why redb: pure Rust, stable file format, crash-safe, zero-copy reads, and a simple embedded model that fits a
single-writer design. Values are encoded as **postcard** (stable wire format) with a leading schema-version
byte. Large blobs are **zstd**-compressed.

| Table | Key | Value | Notes |
|---|---|---|---|
| `meta` | `&str` | bytes | schema version, ingest cursors, first-ingest time |
| `node_ids` | outpoint `&[u8;36]` | `u32` | interning; `node_ids_rev` u32 → outpoint |
| `node_state` | `u32` | NodeRecord | latest known record (includes departed nodes, flagged) |
| `node_events` | `(u32 node, u64 ts, u32 seq)` | NodeEvent | per-node history (uptime/status/ip/version/paid) |
| `events` | `(u64 ts, u32 seq)` | Event | global feed + time-machine replay |
| `snapshots` | `u64 ts` | zstd(postcard(NetworkSnapshot)) | hourly keyframes + one at startup |
| `metrics_1m` | `u64 minute_ts` | MetricsRow | fixed struct of network gauges; retention 30 d |
| `metrics_1h` | `u64 hour_ts` | MetricsRow | rollups; retained forever |
| `blocks` | `u32 height` | BlockSummary | all observed + backfilled blocks |
| `block_hash` | `[u8;32]` | `u32` | hash → height |
| `payments` | `(u32 node, u32 height)` | Amount | payment history per node |
| `apps` | `&str name` | AppRecord | latest spec + first seen |
| `app_events` | `(&str name, u64 ts, u32 seq)` | AppEvent | spec updates, instance moves |
| `geo_cache` | `IpAddr bytes` | (Geo, fetched_ms) | enrichment cache (TTL 7 d) |

> **Implemented (B1): 23 tables**, see `crates/atlas-store/src/tables.rs`. Added: `node_ids_rev`,
> `block_payouts`, `node_txs` + `node_txs_by_node`, `app_messages` + `app_messages_by_app`,
> `pending_app_messages`, `mesh_edges` + `mesh_events`. Notes: the global event key is a store row counter
> (not the live `seq`). Non-durable commits use `Durability::None`, fsynced at most every 10 s (a crash can lose
> up to 10 s of history, which re-ingest recovers). Event pruning (`Store::prune_events`) keeps global events 30 d,
> per-node events 90 d, mesh change rows 7 d. redb's page cache defaults to 1 GiB, so the server sets
> `cache_size_bytes` (`ATLAS_DB_CACHE_MB`, default 32 MB); the hot state lives in memory anyway.
> `MetricsRow` is schema version 2: every series is an `Option` (`None` = not recorded, never 0). Version 1 rows
> (0 for unknown) are upgraded on read: a row with `tip_height == 0` is a backfilled `fluxhistorystats` point that
> only knows `node_count` and the tier counts; in a live v1 row a 0 is read as unknown for the gauges that are
> never 0 on a populated network (supply, price, hardware and locked totals, countries, providers, apps,
> instances, mesh edges, ArcaneOS, unreachable) and for `avg_block_time_ms`.

**Disk outside redb (GeoIP, B5):** `<ATLAS_DATA_DIR>/geoip/` holds the live DB-IP City Lite database (127 MB for
2026-09) and the previous one (same size), about **255 MB** steady. A monthly update needs about **190 MB more** while
it runs (the 60 MB download plus the 127 MB staging file), so the peak is about 445 MB. The size grows slowly
month to month (2026-08 was 61.7 MB compressed, 2026-09 60.3 MB).

A retention task runs hourly: prune `metrics_1m` older than 30 d, roll up `metrics_1h`, keep hourly
snapshots for 30 d, then daily keyframes for a year (section 5.1). `compact()` runs weekly. **Time machine:** state at `t` =
nearest snapshot ≤ `t` + replay of `events` in (snapshot_ts, t]. Target < 50 ms per reconstruction; cache
recent reconstructions.

### 5.1 Retention, disk budget and compaction (D1)

The Flux app gets a 10 GB volume. Every history table has a retention tier, and a disk budget guard bounds
the file whatever the rates do (`crates/atlas-store/src/budget.rs`, run hourly by the maintenance job):

Growth is measured on the constrained soak (section 11.1): bytes per row from `atlas db-stats` after the full
7-day backfill (page bytes including B-tree fragmentation, so conservative), rows per day from the live rate in
the 31 minutes after the backfill finished (2,832 blocks a day at 30 s spacing).

| Tier | Tables | Keep | Product use | B/row | Rows per day | MB per day | Steady state |
|---|---|---|---|---|---|---|---|
| State | `meta`, `node_ids`(+`_rev`), `node_state`, `apps`, `mesh_edges`, `pending_app_messages`, `geo_cache` (7 d TTL) | current | everything live | | | ~0.2 (new node ids) | 20 MB, +80 MB a year of node ids |
| Blocks | `blocks`, `block_hash`, `block_payouts` | 365 d | explorer block list, producer, payouts | 511 + 53 + 3 x 106 | 2,880 | 2.5 | 930 MB |
| Payments | `payments` | 730 d | node payment history, earnings | 23 | 8,600 | 0.2 | 145 MB |
| Node txs | `node_txs`, `node_txs_by_node` | 90 d | heartbeat timeline, lifecycle | 231 + 15 | 43,800 | 10.8 | 970 MB |
| Global events | `events` | 30 d | feed, time machine replay | 100 | 70,500 | 7.1 | 210 MB |
| Node events | `node_events` | 90 d | node history | 139 | 54,000 | 7.5 | 675 MB |
| Mesh changes | `mesh_events` | 7 d | topology history | 6,450 to 8,590 | 6,900 to 13,000 | 44 to 111 | 310 to 780 MB |
| Snapshots | `snapshots` | hourly 30 d, then daily keyframes 365 d | time machine | 525 KB | 24 | 12.6 | 380 + 190 MB |
| Metrics | `metrics_1m` / `metrics_1h` | 30 d / forever | charts | 160 / 96 | 1,440 / 24 | 0.23 / 0.002 | 7 MB / +1 MB a year |
| App history | `app_messages`(+`_by_app`) | forever | app spec history (from the six-year bootstrap) | 768 + 91 | ~190 | 0.16 | 58 MB, +60 MB a year |
| App timelines | `app_events` | forever | app timelines | 175 | 2,300 | 0.4 | +150 MB a year |

**The guard.** `ATLAS_DISK_BUDGET_MB` (default 6,144 MiB. The 10 GB volume is 9.3 GiB, a little less after
ext4 metadata; the budget leaves about 3 GiB for redb's copy-on-write pages between commits, its growth steps,
and the GeoIP files, which live beside the database in `geoip/` and are not counted against the budget). Hourly,
after the age tiers:

1. Measure the file (allocated blocks, O(1)). Under 90% of the budget: done.
2. Over it: walk the table pages (`db_stats`). If the live data is under 75%, the file is mostly free pages:
   compact.
3. Otherwise prune oldest-first: delete the oldest day of every history table (events, node and mesh events,
   snapshots, app events, blocks with their hash and payout rows, payments, node txs, app messages), estimate
   the freed bytes from each table's bytes per row, and repeat until the estimate is under 75%; then compact.
   It never prunes the newest 7 days and never touches current state; if 7 days do not fit, it logs an error
   asking for a larger budget.

Unit tests cover the marks, the oldest-first stepping, the 7-day floor and the height/time estimates; store
tests run the tiers and the guard on a real database.

**Compaction.** `redb::Database::compact` needs no live read transactions, so `Store::compact` takes the
database write lock: readers and the store writer wait while it runs. Measured: 0.2 s for the 7-day soak file (257 MiB long, 197 MiB allocated, to 196 MiB), 0.8 s for a 95 MiB file after a restart, 0.1 s for 128 MiB. It runs
weekly, after a guard prune, and offline with `atlas db-stats --compact`. Between compactions redb reuses
freed pages, so once the tiers prune as fast as ingest writes, the file stops growing; compaction only hands
the slack back to the filesystem. redb grows the file in steps (doubling up to its 4 GiB region size, then a
region at a time) but the tail stays sparse until written, so the guard measures allocated blocks, not length.
Store reads from async jobs go through `spawn_blocking`, so a compaction never stalls the 1-CPU runtime.

**Projection.** With every tier full (one year in) the database holds about **4.6 GB** (4.1 GB with the quieter mesh
rate), then grows about 0.35 GB a year from the tables kept for longer or forever (payments to two years, app
history, app timelines, node ids). It reaches the guard's high-water mark (90% of 6 GiB, 5.8 GB) about four
years in; from then on the guard trims the oldest history (in practice the year-old blocks, payments, keyframes and app
history, since the shorter tiers hold nothing that old) and the file
holds between 75% and 90% of the budget. The volume then holds at most the 6 GiB budget plus the GeoIP files
(255 MB, 445 MB during a monthly update), about **6.9 GB of the 10 GB**. During the first week (the 7-day
backfill fills in about 4.7 hours at 1.5 blocks a second) the file was 257 MiB long and 197 MiB allocated,
with 186 MiB in table pages; the largest tables were `node_txs` (60 MiB), `app_messages` (52 MiB) and
`mesh_events` (21 MiB).

## 6. HTTP API (atlas-server) — `/api/v1`

JSON unless noted. Every response carries an `ETag` and `Cache-Control`; hot bodies are pre-compressed.
Error shape: `{"error":{"code":"not_found","message":"…"}}`. CORS is open for GET (a public data API).

| Method & path | Returns |
|---|---|
| `GET /bootstrap` | one-shot boot payload: network summary, tier stats, latest 30 blocks, app index (name, instances, component count, resource totals), live `seq`, server info, data freshness per job, and `attributions` (third-party data credits the UI must show, for example `{name: "DB-IP", text: "IP Geolocation by DB-IP", url: "https://db-ip.com", license: "CC BY 4.0", license_url, scope, version}` while the GeoIP database is loaded or nodes carry its data; an empty list otherwise; typed optional for older servers), and `next_payees` (B6: `{height, payees: [{tier, node, address}]}`, the same shape as the live `next_payees` message, holding the predicted payees of block `tip + 1`; the restored queue heads right after a restart; absent before any payee is known and typed optional for older servers). Clients seed their next-payout state from it and let a live `next_payees` for a newer height, or for the same height with a later `seq`, replace it |
| `GET /nodes.bin` | **binary columnar node snapshot** (§7), feeds the globe + tables |
| `GET /mesh.bin` | binary P2P mesh: header + `u32 edge_count` + `u32 a[]`, `u32 b[]` (NodeIds, a<b, deduped) + `u8 flags[]` (bit0 bidirectional, bit1 cross-continent) + ORIGIN; rebuilt at most every 10 s while the mesh changes, so its header `seq` can lag the live stream (bootstrap `mesh_seq`, section 8.1) |
| `GET /nodes/{id}/peers` | the node's peers with geo, for selection-reveal |
| `GET /nodes?…` | JSON node table with filters/sort/pagination (`tier`, `status`, `country`, `org`, `q`, `sort`, `cursor`). Rows carry `city` and `region` (`null` when unknown). `total` counts the rows matching the filters: unfiltered, every tracked node (`listed_count`, see Node counts below) |
| `GET /nodes/{id\|ip\|outpoint}` | full node detail: record, geo, hw, versions, rank + payment ETA, hosted apps, recent events |
| `GET /nodes/{id}/history?from&to` | status timeline, uptime %, events |
| `GET /nodes/{id}/payments?cursor` | payment history |
| `GET /apps` / `GET /apps/{name}` | app index / full app: normalized spec, components, instances (node ids), history |
| `GET /apps/{name}/history` | spec versions with diffs |
| `GET /network/summary` · `/network/geo` · `/network/providers` · `/network/versions` · `/network/capacity` · `/network/decentralization` | analytics aggregates. The summary's counts are defined under Node counts below |
| `GET /metrics?series=a,b&from&to&step` | time series (columnar JSON: `{from_ms, to_ms, step_ms, t:[…], series:{a:[…], b:[…]}}`). **A value that was not recorded is `null`, never 0** (product rule: unknown is never zero): backfilled history rows carry only `node_count` and the tier counts, and a live row records a series only once its source has reported. A bucket with no known sample is `null`. `step` is one of `1m`, `5m`, `15m`, `30m`, `1h`, `3h`, `6h`, `12h`, `1d` (= `24h`), `7d` (= `1w`), case-insensitive, or a whole number of milliseconds that is a multiple of 60000; anything else is a 400 `bad_request` that lists the accepted steps. Omitted, the step is picked for about 500 points |
| `GET /blocks?before&limit` · `GET /blocks/{height\|hash}` | block summaries / block detail with txs. Each `TxLite.size` is the serialized size in bytes, computed from the decoded `getblock` verbosity 2 fields (which carry no per-tx size or hex; the shapes are verified against Insight sizes: Sapling v4, fluxnode start v5/v6 incl. P2SH, confirm v5), or `null` when it cannot be computed (legacy v1-v3, JoinSplits, delegate starts, or the store fallback when upstream is down). Never 0 |
| `GET /tx/{txid}` | decoded tx (inputs with prevout values/addresses, outputs, Flux tx type annotations) |
| `GET /address/{addr}` · `/address/{addr}/txs?cursor` · `/address/{addr}/nodes` | explorer address views, plus nodes owned/paid to it |
| `GET /mempool` · `GET /supply` · `GET /richlist` | explorer extras. With live ingest, `/mempool` serves the engine's mempool (socket transfers in real time, node txs from the 20 s reconcile, classified with the block classifier; see MempoolStream in 3.2) with no upstream call per request; `bytes` sums the known sizes. Offline (`ATLAS_INGEST=0`), it falls back to the gateway set joined with the live stream |
| `GET /search?q=` | ranked typed hits `[{kind, key, label, sublabel}]` |
| `GET /timeline` · `GET /timeline/state?t=` (binary, §7 format) | time-machine index and state at t (nearest keyframe + event replay via `timemachine::state_at`; header `seq` = 0, `generated_ms` = t; cached 60 s per t). **Honest bounds (B9):** the index's `first_ms` is the first keyframe (the earliest `t` with a whole network state; `null` before any keyframe), and a `t` before it answers **404 `no_history`** with "no data before <time>" instead of a partial globe built from the events alone. A reconstruction replays at most **50,000 events** after its keyframe; a `t` that would need more (keyframes missing for many hours) also answers 404 `no_history`. The file carries ORIGIN (its node ids are this instance's) and OUTPOINTS. Keyframes (snapshot format 2) record tier, status, endpoint, geo with city, FluxOS version, hardware, last payment, app count, ArcaneOS and first-seen time, replayed through the node events. **Columns the state does not know are left out of the file, never zero-filled** (§7): `rank` always (the queue is not replayable exactly), and `last_paid`, `app_count`, `flags` when the keyframe is format 1 (written before B4) or missing. Per row the usual unknown encodings apply (0 cores, version index 0, empty city); the `enterprise` flag bit is not recorded and stays clear |
| `GET /operator/{address}` | operator dashboard: owned nodes, earnings, next payment ETAs |
| `GET /ws` | WebSocket live stream (§8) |
| `GET /healthz` · `/readyz` · `/metrics/prometheus` | ops. **Liveness (B9):** `/healthz` is 200 while the engine is alive and **503 `{status: "dead", reason}`** once a supervised engine part died or stalled (section 3.4); `atlas healthcheck` (the image's HEALTHCHECK) fails on it. `/readyz` is 200 only when fresh state is published, the engine is alive and the store writer commits (503 `starting`, `dead` or `store_failing`). A dead engine also makes the process exit with status 1, so the container restart policy restarts it on the persisted state. Prometheus families (bounded labels only): HTTP per route; WS clients, messages, bytes, drops; explorer proxy caches; per ingest job `atlas_ingest_job_runs_total`, `_errors_total`, `_last_success_age_seconds` (absent before the first success), `_stale`, `_upstream_calls_total`, `_upstream_errors_total`, `_upstream_seconds_total` (job duration = time in upstream calls); `atlas_upstream_requests_total{host,result}` and `atlas_upstream_request_duration_seconds{host}`; `atlas_engine_events_total{kind}`, `atlas_live_messages_total{type}`, block/reorg/reconcile/rank-correction counters, `atlas_block_emit_latency_seconds{quantile}`; `atlas_store_commit_duration_seconds` (DB writes); `atlas_publish_duration_seconds`; `atlas_replay_ring_messages{ring}` / `_capacity{ring}` (hub and engine) |

Everything else serves the embedded web app (SPA fallback to `index.html`, immutable caching for hashed assets).

> **Node counts (B6).** One headline number: `NetworkSummary.node_count` (bootstrap `network`, `/network/summary`,
> the live `stats` message) is the count of **confirmed** nodes, i.e. fluxd's deterministic list and the
> `getfluxnodecount` total. The server also tracks nodes that are not in that list yet or any more, and shows them on
> the globe with their status, so `nodes.bin` (header `count`) and the unfiltered `GET /nodes` `total` hold more rows.
> The summary names the difference: `listed_count` (every tracked row = `nodes.bin` rows = unfiltered `/nodes`
> `total`) = `node_count` + `started_count` (start mined, not confirmed: fluxd's start list) + `dos_count` (fluxd's
> DOS list) + `expired_count` (predicted expired by the block path, dropped by the next reconcile, at most 10 min).
> Measured on 3106: `node_count` 6,725 and `listed_count` 6,729 (2 started, 2 DOS). Before B6 a DOS entry never
> left the model, so the difference also grew with every DOS ban (fixed: it leaves at `added + 720`). A
> view that says "N nodes" shows `node_count` (or counts `status == confirmed` rows of `nodes.bin`, the same number);
> `listed_count` is only for a "rows on the map" or "including pending" label.
>
> **Request log (B6).** A request slower than 1 s is logged at `warn` with `method`, `route` (the matched route
> pattern), `path` (only for unmatched routes), `query` (first 256 bytes), `status` and `ms`. The slow requests seen
> under normal use are the explorer proxies that wait on upstream (`/address/{addr}` about 1.3 s on Insight, several
> `/blocks/{h}` at once queued behind the per-host rate limit, 0.2 to 1.2 s). The hot endpoints answer from memory
> in under 1 ms (bootstrap, nodes.bin, mesh.bin, apps, summary, network views) to about 5 ms (`/nodes` pages, node
> detail by endpoint). Two hot paths were fixed: the detail of a recent block (`/blocks/{h}` for the newest 32) is
> built from the copy the BlockDecoder already fetched (`EngineHandle::recent_raw_block`) instead of a second
> `getblock` (155 ms before, under 1 ms now), and node detail no longer waits for the hosted-apps map rebuild (every
> 30 s a request paid about 35 ms reading every app record); a stale map is served while one task rebuilds it.

## 7. Binary node snapshot — `nodes.bin` (format v1)

> **Authoritative byte layout: `crates/atlas-core/src/codec/README.md`** (implemented and golden-tested in B1).
> Refinements over the sketch below: string tables start with a `u32 n`; the rank column stores `rank + 1`
> (0 = not queued); index 0 means "unknown" in the country/org/version/location tables; `mesh.bin` uses the
> same sectioned container (magic `FXMS`) instead of bare arrays. Golden file:
> `crates/atlas-core/tests/golden/nodes.bin` + `nodes.expected.json`.
> **A missing column means "not recorded"**: unknown for every row, never zeros. Producers that lack a column
> leave it out (`encode_nodes_bin_without`; `/timeline/state` does so for `rank`, and for `last_paid`, `app_count`
> and `flags` without a format-2 keyframe). Decoders default missing columns so old readers keep working, and
> expose which columns were present (Rust `NodesBin::has`, web `NodesBin.present` / `hasColumn`); a reader must
> not show a defaulted column as data.

Little-endian and columnar. Every section starts on an 8-byte boundary, so the client can wrap sections as
typed-array views with zero copying.

```
Header (32 B):  magic "FXAT" | u16 version=1 | u16 flags | u64 seq | u64 generated_ms | u32 count | u32 section_count
Section table:  section_count × { u16 kind, u16 dtype, u32 offset, u32 byte_len }   (then pad to 8)
Sections (kind → dtype[count] unless noted):
  1 ids            u32      NodeId
  2 lat            f32      degrees (NaN = unknown location)
  3 lon            f32
  4 tier           u8       Tier
  5 status         u8       NodeStatus
  6 flags          u8       bit0 has_apps, bit1 ipv6, bit2 non-default port, bit3 geo_approx, bit4 arcane(?), bit5 enterprise(?), bit6 recently_paid, bit7 new_24h
  7 loc            u32      location id (co-located cluster; index into LOCATIONS)
  8 country        u16      index into COUNTRIES
  9 org            u16      index into ORGS
 10 app_count      u16
 11 rank           u32      0 = n/a
 12 last_paid      u32      height, 0 = never
 13 cores          u16      (0 = unknown)
 14 ram_gb         u16
 15 ssd_gb         u32
 16 version        u16      index into VERSIONS
 32 ips            string table: u32 offsets[count+1] + UTF-8 blob
 33 COUNTRIES      string table (code\u001Fname)
 34 ORGS           string table
 35 VERSIONS       string table
 36 LOCATIONS      u32 n, then n × {f32 lat, f32 lon, u16 country, u16 pad, u32 node_count} + string table of city names
 17 OUTPOINTS      struct: count × {u8 txid[32] (display order: hex of these bytes = the txid), u32 vout}  (B9; the stable key)
 48 ORIGIN         struct: u64 started_ms, u64 instance  (B9; shared with mesh.bin; ServerInfo.instance = hex of instance)
```

Clients must ignore unknown section kinds; that's how the format evolves. A **golden fixture** is written by the
backend test suite (`crates/atlas-core/tests/golden/nodes.bin` + `.json` expectation) and the web decoder's tests
read the same file. Both sides must pass.

## 8. Live protocol — WebSocket `/ws`

> **Authoritative schema: `crates/atlas-core/src/live.rs`** (exported to `web/src/api/generated/`). Refinements
> over the sketch below: the envelope (`seq`, `observed_ms`, `event_ms`) is flattened into each message body;
> `resync` carries a `reason`; the client also sends `pong`; `block` adds `confirms`, `prev_hash`, `fees`, `dev_fund`;
> `mesh` adds `reporters`. Enums serialize lowercase. Amounts are always 8-decimal FLUX strings. `u64` is exported
> to TS as `number` (all our u64 values are < 2^53).

Text frames with JSON messages `{ "t": <type>, … }`. All message types are Rust enums in
`atlas-core::live`, exported to TS.

- Server → `hello { server, seq, tip, now_ms }` (`server` carries the origin: `instance`, `started_ms`; section 8.1)
- Client → `sub { topics: ["chain","mempool","nodes","apps","mesh","stats","feed"], since_seq?: u64, watch?: [NodeId] }`
  (`watch` enrolls those nodes in WatchProbe (fast offline detection) and guarantees their events are never coalesced; `watch_apps?: [name]` enables hot-app instance polling)
- Server keeps a ring buffer of the last 2,048 messages. If `since_seq` is inside the buffer it replays;
  otherwise it sends `resync { seq }` and the client refetches `/bootstrap` + `/nodes.bin`.
- Every message carries `seq`, `observed_ms`, and (when known) `event_ms`, so clients show true latency.
- Messages (all live-first; each maps 1:1 to something that really happened):
  - `block { height, hash, time, size, tx_count, producer?: NodeRef, payouts: [{tier, node?, address, amount}],
    heartbeats: [NodeId], starts: [NodeRef], updates: [NodeId], transfers_over_threshold: [TxLite], reward }`.
    One message per block with its child events, so the client can stage the choreography.
  - `reorg { from_height, to_height, orphaned: [hash] }`
  - `mempool { txs: [TxLite{txid, value, kind, size}] }` (coalesced per ≤ 500 ms; `size` is `null` when unknown,
    which is the case for socket pushes; a tx the socket never pushed arrives once classified)
  - `nodes { prev_seq, added: [NodeLite], removed: [id], changed: [{id, …changed fields}], cause }`
    (`cause`: reconcile | block | sweep | geo)
  - `apps { prev_seq, upserted: [AppLite], removed: [name], instances: [{app, started: [id], removed: [id]}], cause }`
  - `mesh { added: [[a, b]], removed: [[a, b]], reporters: [NodeId] }` (streamed per TopologySweep call)
  - `next_payees { height, payees: [{tier, node}] }` (after every tip; pre-aims the payout glow)
  - `app_pending { hash, app, kind: register|update, received_ms, expires_ms }`, `app_installing { app, node }`
  - `stats { summary }` (coalesced to ≤ 1/s)
  - `feed { kind, ts, text_key, refs }` (human-readable activity items: node joined/left, app deployed/updated,
    version rollout milestones, large transfers). The UI renders these; it never parses free text.
- Heartbeats: ping every 20 s. Slow consumers are dropped when their per-connection queue (1,024) is full.
  Clients reconnect with jittered backoff and `since_seq`.
- **Feed items are delivered at least once (B6).** After a resync the client resumes from the lower of the
  bootstrap's and `nodes.bin`'s seq (`nodes.bin` is rebuilt only when nodes change, so it lags), and the replay
  can re-deliver `feed` items the client already holds. The server emits one item per event (an app message is
  applied once, keyed by its message hash); the client keeps the highest `feed` seq it pushed and skips any at
  or below it, resetting that mark when `server.started_ms` changes (seqs restart with the server).

**Rank contract (payment queue).** Ranks are never streamed per node per block (that would be ~6.7k changes
every 30 s). Each tier's queue is a strict rotation, so clients maintain ranks deterministically:
1. On each `block`, for every tier payout whose payee is known: the payee moves to the back (rank = tier size − 1)
   and every other node of that tier with a rank greater than the payee's old rank moves up by one. A payee's old
   rank is normally 0.
2. `nodes.added` carries each new node's rank (joins enter at the back by confirmed height). `nodes.removed` closes
   the gap: ranks behind the removed node in its tier move up by one.
3. A `nodes` delta with `cause: reconcile` carries authoritative ranks for every node whose rank differs from the
   rotation model. After applying it, clients are exact again. The server sends one after every NodeRegistry
   reconcile (≤ 10 min) and whenever its own model detects a divergence.
4. A node whose status leaves `confirmed` drops out of its tier queue; ranks behind it close the gap.
5. An unranked node that receives a rank (a `changed` rank, typically a join confirmed in a block) is inserted at
   that rank; nodes at or behind it shift back. Ranks past the tier size clamp to the back.
6. **Unranked signal.** In `nodes.changed`, an absent `rank` means "unchanged" and `rank: null` means "not queued".
   Outside a reconcile, `rank: null` is an exit like rule 4 (the node leaves its tier queue; ranks behind it close the
   gap). In a `cause: reconcile` delta it is authoritative like any other rank: the node becomes unranked, without
   shifting anyone. The server sends it whenever clients still rank a node that the true queue does not hold while
   its status stays `confirmed` (so no status exit tells them), for example a node the upstream list stops ranking.

The server keeps an exact model of what clients hold (`atlas_engine::state::queue::ClientRanks`) and diffs it
against the true queue after every tick, so clients must apply a `nodes` delta in the same order: `removed`
(rule 2), then status exits and `rank: null` exits (rules 4 and 6), then field changes, then entering ranks
ascending by `(rank, id)` (rules 2 and 5; an already ranked node is taken out at its turn, a move). In a
`cause: reconcile` delta, `changed` ranks (including `null`) are authoritative and set as is, without shifting
anyone. Implemented in `web/src/store/network.ts`.
Displayed ETAs are `rank × 30 s`, labelled as estimates.

**Client choreographer (web).** Incoming events go into a scheduler with a visual budget (max concurrent
pulses/arcs, per-type rate caps), not straight onto the screen. A block plays as a staged sequence: producer
flare → payout beams → heartbeat ripple staggered over 2–4 s. Bursts collapse into aggregate effects plus
"+N" feed items. Selected and watched nodes bypass the budget. While the tab is hidden, animations are skipped
and state is applied directly; on return, only a short summary replays. The live feed, counters, "seconds ago"
labels and the next-block progress (~30 s cadence) all run off the same event clock.

### 8.1 Origins, resume and stable keys (B9)

**One origin per session state.** The domain balances two independent instances, and a process restart
starts a new seq space. A client holds snapshots, live messages and node ids of exactly one origin
`(server.instance, server.started_ms)`:

1. A resync fetches `/bootstrap`, `/nodes.bin` and `/mesh.bin`. The binary ORIGIN sections must equal the
   bootstrap's `server.instance` / `server.started_ms`. On a mismatch (the fetches reached different
   instances) the client discards all three and fetches again, with backoff; it never loads a mix. A file
   without ORIGIN (an older server) is accepted only when the bootstrap's `instance` is empty.
2. A `hello` whose `server.instance` or `server.started_ms` differs from the loaded snapshot's means the
   socket reached another origin: full resync (new snapshots; every id-keyed client cache is dropped).
3. Watched and selected nodes are kept by outpoint and mapped to ids of the current origin after each
   load, before `sub.watch` is sent.

**Resume point.** Each snapshot covers the live stream up to its own seq, and they lag differently
(`nodes.bin` is rebuilt when nodes or the tip change, `mesh.bin` at most every 10 s). The client subscribes
with `since_seq = min(bootstrap.seq, nodes.bin seq, M)`, where `M` is the `mesh.bin` seq when it is below
the bootstrap's `mesh_seq` (the mesh body misses edge changes the stream must replay), and is omitted
otherwise (the mesh body already holds every edge change up to `bootstrap.seq`). While replaying, each
topic skips what its snapshot already holds: `mesh` deltas with `seq <= mesh.bin seq`; `nodes` deltas
with `seq <= nodes.bin seq`; the node-table part of a `block` (payout rotation, heartbeats, starts) with
`seq <= nodes.bin seq`, while its block-list and choreography part is still applied when `seq >
bootstrap.seq`; feed items as in section 8. A failed `mesh.bin` fetch fails the resync (it is retried);
only a 404 (a server without the mesh) loads an empty mesh.

**Stable node keys.** Node URLs are `/node/<txid>:<vout>` (the colon percent-encoded in links). The
router still accepts `/node/<ip:port>` and a legacy numeric id: it resolves the key against the loaded
snapshot and replaces the URL with the outpoint form (one redirect; a legacy id is resolved against
whatever instance answers, the best a pre-B9 link can do). `?sel=` holds outpoints too. API calls name
nodes by outpoint (`/nodes/{key}` and its sub-routes accept an id, `ip:port` or an outpoint), so a
request that reaches the other instance still means the same node. Persisted client state (watchlist,
achievements, window layouts, palette recents, any `localStorage`) stores outpoints; stored numeric ids
from older clients are resolved once against the first loaded snapshot and rewritten.

## 9. Frontend architecture (web/)

**Stack:** Vite · React 19 · TypeScript (strict) · three.js (engine ported from `labs/globe`, imperative,
framework-agnostic) · TanStack Router (typed routes + search params) · TanStack Query (request/response data) ·
Zustand (UI state) · `motion` (UI animation) · `cmdk` (palette) · uPlot (large time series) + hand-built SVG
micro-viz · CSS Modules + `tokens.css` from `docs/design` (no CSS-in-JS runtime) · lucide icons · Biome (lint +
format) · Vitest · Playwright (system Chromium) for smoke + screenshot tests.

```
web/src/
  app/          providers, router, routes, error boundaries
  styles/       tokens.css (synced from docs/design/tokens.css), global.css, fonts
  api/          generated/ (ts-rs output — never hand-edit), http.ts, nodesBin.ts (decoder), live.ts (WS client), queries.ts, mock/ (fixture-backed mock mode)
  store/        network.ts (NetworkStore: typed arrays + versioned subscriptions via useSyncExternalStore), ui.ts (zustand)
  globe/        engine/ (from labs/globe), GlobeCanvas.tsx (mounted once as the living wallpaper), bindings.ts (store → engine)
  shell/        desktop, dock, window manager, command palette, terminal, boot sequence, toasts, ambient mode, achievements
  features/     node/, app/, explorer/ (block, tx, address, mempool), analytics/, timemachine/, operator/, search/
  ui/           primitives: StatTile, Sparkline, Badge, Table, Tabs, Tooltip, Skeleton, Ticker, …
  lib/          format (FLUX amounts, heights→time), geo, time, keyboard
```

- The **NetworkStore** lives outside React: typed arrays decoded from `nodes.bin`, patched by WS deltas,
  with a monotonically increasing version. The globe subscribes directly (no React re-renders), and React
  components subscribe through selectors.
- **Mock mode** (`VITE_ATLAS_MOCK=1`) serves fixtures + synthetic generators and a fake live feed, so the UI can be
  built before the backend is live.
- Dev: Vite proxies `/api` and `/ws` to `127.0.0.1:3000`. Prod: the Rust binary embeds `web/dist`.

## 10. Build, deploy, quality gates

- `deploy/Dockerfile` (section 11): node stage (`npm ci`, `npm run build`) → rust stage (static musl build of
  `atlas` with the embedded dist, `--release`, LTO thin, `codegen-units=1`) → `scratch` runtime with the
  binary, the CA bundle and `/app/backend/data`. `atlas healthcheck` is the Docker HEALTHCHECK.
- `deploy/flux_app_spec.json`: the live v8 spec of the Flux app `atlas` (section 11).
- Config: env vars (each also a flag; full table in `crates/atlas-server/README.md`): `ATLAS_BIND` (default
  `0.0.0.0:3000`), `ATLAS_DATA_DIR` (`/data`; the image sets `/app/backend/data`), `ATLAS_INGEST` (`1`; `0`
  serves stored state only), `ATLAS_BACKFILL_DAYS` (7), `ATLAS_BACKFILL_RPS` (1.5), `ATLAS_DB_CACHE_MB` (32),
  `ATLAS_DISK_BUDGET_MB` (6144), `ATLAS_INTERVALS`
  (`job=duration,...` per-job interval overrides), `ATLAS_FLUX_API`, `ATLAS_EXPLORER_API`, `ATLAS_STATS_API`,
  `ATLAS_UPSTREAM_RPS`, `ATLAS_GEOIP_AUTO` (`1`; DB-IP City Lite download), `ATLAS_GEOIP_DB` (path of an operator-managed `.mmdb`
  instead of the downloaded one), `ATLAS_REPLAY_CAPACITY`, `ATLAS_TRUST_PROXY`,
  `ATLAS_CLIENT_RPS` / `ATLAS_CLIENT_BURST`, `ATLAS_WS_MAX_CONNECTIONS` / `ATLAS_WS_MAX_PER_IP` / `ATLAS_WS_PING`,
  `ATLAS_LOG`, `ATLAS_HEALTHCHECK_ADDR` (`127.0.0.1:3000`, for `atlas healthcheck`). The web smoke targets a
  running server with `ATLAS_E2E_SERVER` (+ `ATLAS_WEB_PORT`).
- Gates. Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Web: `tsc --noEmit`,
  `biome check`, `vitest run`, Playwright smoke. Perf: an ingest-cycle benchmark on the full raw node dump, `oha`
  load test on `/api/v1/nodes.bin` and `/bootstrap`, globe FPS via the team shot tool `--gpu --fps`.

## 11. Deployment: the live Flux app `atlas`

v2 ships as an update of the live Flux app `atlas` (PLAN phase 5). `deploy/flux_app_spec.json` is its live
v8 spec with a new description only: one component `atlas`, image `littlestache/flux-atlas:latest`, public
port 33889 → container port **3000**, `containerData` `/app/backend/data`, no environment parameters, no
commands, 1 CPU, 2,500 MB RAM, 10 GB disk, 2 instances. Re-read
`GET https://api.runonflux.io/apps/appspecifications/atlas` before deploying.

**One process, one port.** The container runs one process, `atlas serve`, which opens exactly one listening
socket: TCP `0.0.0.0:3000` (`ATLAS_BIND`). The web app, `/api/v1/*`, the `/ws` upgrade, `/healthz`, `/readyz`
and `/metrics/prometheus` all share it. There is no metrics exporter, admin or debug port and no UDP
listener. Upstream traffic (the FluxOS gateway, the two Insight socket.io connections, stats, CoinGecko,
SSRF-guarded node probes) is outbound only and needs no inbound port. Proven three ways:

- `crates/atlas-server/tests/one_port.rs` runs the real `serve` path (store, engine with ingest off, router) on
  one ephemeral port, loads the SPA index and a deep link, an API route, `/metrics/prometheus`, a `/ws`
  upgrade and `/healthz` on it, then audits the test process's sockets (`/proc/self/fd` against
  `/proc/self/net/{tcp,tcp6,udp,udp6,raw,raw6}`): exactly one listening socket, no UDP or raw sockets.
- `default_port_is_3000` in `src/main.rs` pins `ATLAS_BIND` to `0.0.0.0:3000` and the healthcheck to
  `127.0.0.1:3000`.
- The constrained container with live ingest, 200 WebSocket clients and HTTP load, inspected from a sidecar in
  its network namespace (`ss -ltnup`): one listener, `tcp 0.0.0.0:3000`, nothing else; the only other sockets
  are the established inbound clients on 3000 and four or five outbound connections to upstream port 443. The GeoIP run (merged image)
  shows the same single listener.

**Image** (`deploy/Dockerfile`, build from the repository root with
`docker build -f deploy/Dockerfile -t flux-atlas .`; the context is filtered by `deploy/Dockerfile.dockerignore`
to 7.5 MB):

1. `node:26-alpine`: `npm ci` from the lockfile, `npm run build`, source maps dropped.
2. `rust:1.97-alpine`: a fully static musl release build of `atlas` embedding `web/dist` (rust-embed). mimalloc
   is the global allocator, so musl's malloc is not on the hot path.
3. `scratch`: the binary, the CA bundle (rustls verifies upstream TLS against it) and `/app/backend/data`.
   34 MB unpacked, 14.5 MB compressed (`docker images` shows 49 MB, the unpacked and compressed layers together). No shell, no package manager, no libc to patch. A glibc build on
   `distroless/cc` would add 43 MB for nothing the server uses.

The spec passes no environment and no commands, so the image defaults are the production configuration:
`ENTRYPOINT atlas`, `CMD serve`, `ATLAS_BIND=0.0.0.0:3000`, `ATLAS_DATA_DIR=/app/backend/data`, `ATLAS_LOG=info`,
`EXPOSE 3000` only, `VOLUME /app/backend/data`, and `HEALTHCHECK` running `atlas healthcheck` (a raw HTTP probe
of `/healthz`, so the image needs no curl).

**Runtime user: root.** FluxOS bind-mounts a host directory at `containerData`, created by root and not
writable by others. Tested on a root-owned ext4 volume: as uid 65532 the server fails with `Permission denied`
creating `atlas.redb`; as root it works. A start-as-root-then-drop scheme would need a shell or a privilege
helper in the image; the scratch image has neither, so there is nothing to escalate with and the process only
writes `/app/backend/data`.

**Volume layout.** Everything lives under `/app/backend/data`: `atlas.redb` (state, cursors, history; bounded
by `ATLAS_DISK_BUDGET_MB`, section 5.1) and `geoip/` (DB-IP City Lite, section 3.2: 127 MB live, about 255 MB
with the previous month kept, about 445 MB while a monthly update stages). With the spec's defaults the server
downloads the GeoIP database about 30 s after start, so the container needs outbound HTTPS to
`download.db-ip.com`; without it the server runs and cities stay unknown. `atlas db-stats` lists both.

**Persistence.** State, cursors and history live in `/app/backend/data/atlas.redb`. Verified: after
`docker restart` (and after a new container on the same volume) the engine restores nodes, apps, mesh and
the tip, serves them within a second, and the block backfill resumes from its stored cursor instead of
starting over. The GeoIP database survives a restart too: the restarted container maps the stored file
(`geoip: database mapped`, 2026-09) and downloads nothing.

### 11.1 Resource budget, measured

Two runs of the release image under the spec's limits (`docker run --cpus=1 --memory=2500m`, a fresh
root-owned 10 GiB ext4 volume, live ingest against mainnet, default configuration):

- **Soak** (5.2 h, 2026-10-01 02:54 to 08:05 UTC): 200 WebSocket clients subscribed to every topic, 20 HTTP
  requests a second over `/bootstrap`, `nodes.bin`, `/apps` and `/blocks`, and the full 7-day block backfill
  (20,159 blocks, finished after 4.7 h), sampled every minute (RSS, cgroup memory and CPU, latency, publish
  times, table sizes). Built before GeoIP merged.
- **GeoIP confirmation** (17 min, with GeoIP merged): the same limits and load on a fresh volume; the DB-IP
  City Lite database downloaded and installed 39 s after start and enriched 6,664 nodes.

| Resource | Spec | Measured | Headroom |
|---|---|---|---|
| CPU | 1 vCPU | soak: mean 3.3% of one core, busiest minute 8.0%, cgroup throttling at most 2.2% of a minute; GeoIP run: busiest 15 s 20.8% (startup) | over 10x |
| Memory | 2,500 MB | RSS 380 to 480 MB through the soak (407 to 477 MB from minute 120 on, 418 to 463 MB after the backfill), peak 557 MB at startup (parsing the permanent app messages); cgroup total with page cache up to 655 MB, all of it reclaimable; GeoIP adds 0 to 9 MB RssFile (clean, droppable) and no heap | 4.5x on the peak |
| Disk | 10 GB | first week 197 MiB allocated (257 MiB long) plus 121 MiB GeoIP; levels off at about 4.6 GB in a year, bounded at 6 GiB by the guard, 6.9 GB worst case with GeoIP staging (section 5.1) | over 3 GB |
| Block latency | p99 under 3 s | upstream Insight push to the last of 200 clients: p50 164 ms, p90 270 ms, p99 344 ms, max 1.83 s (617 blocks); server emit to last client p99 28 ms; block header time to emit p50 1.05 s, p99 2.81 s | |
| HTTP | | 93,000 requests per endpoint, 0 errors, p50 1.2 to 1.9 ms, worst minute p99 42 ms | |

**Memory.** RSS climbs during the first two hours while the bounded structures fill, then holds: the two replay
rings reach their 16 MiB caps (`atlas_replay_ring_bytes`), the mesh settles around 140,000 edges, and the
rest is the live network model and the published bodies. Every cache is bounded by bytes, not entries: the
explorer proxy caches (66 MiB in total), the metrics and timeline caches (16 and 24 MiB) and the replay rings
(16 MiB each); `atlas_cache_bytes` and `atlas_replay_ring_bytes` report them. The soak load did not touch the
explorer caches, so the worst case adds their 106 MiB to the measured plateau: under 600 MB with 200
clients. A WebSocket client costs about 47 KB (8 KiB read and 16 KiB write buffers; measured +14 MB for 300
extra clients). redb's page cache is capped at 32 MB (`ATLAS_DB_CACHE_MB`).

**CPU and latency.** Block messages go out from the reducer as soon as a block is applied; publishing (body
rebuild and compression) runs on its own thread, at most 0.39 s per publish in the soak, and never blocks the
hot path (emit to last client stayed under 80 ms). When the gateway cannot serve a block it just announced
("Can't read block from disk"), the chain job retries the tip at 0.3, 0.7, 1.2, 2, 3 and 4.5 s unless a newer
tip arrives (`TIP_RETRY_MS`); before that fix one such block reached clients 30 s late, after it the worst
block took 1.85 s from push to emit.

**First boot.** On a fresh volume the payee queue rotates correctly from the first block: blocks at or below
the list height are attributed from the list's `last_paid_height` (`reattribute_recent_payouts`), so
`reattributed=3` named the three payees of the block the list was fetched at. The soak attributed 1,863 live
payouts exactly, 0 by fallback, 0 currentwinner mismatches; the counter's 3 unattributed are that first block's payees, counted
when it was applied before the list arrived and named by the reattribution, and the rank check (globe ranks against the server's queue, every block) matched 39 of 39
blocks after the first boot and 21 of 21 after the backfill.

# X1 review: security and correctness

Reviewer: X1 (Opus). Base: `development` at `b7f4857`. Scope: the brief's seven areas.
This is a report only. Nothing in the code was changed.

**Counts:**

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 9 |
| Low | 15 |
| Info | 13 |

**How it was checked:**
- Code reading across `crates/` and `web/`.
- A release build of `atlas` probed on `127.0.0.1:3108`, with:
  - ingest off;
  - a copy of the 3100 database;
  - upstream URLs pointed at a dead local port, so nothing external was contacted;
  - the server pinned to one core.
- The `demo_server` example on the same port, with `TOKIO_WORKER_THREADS=1` and one pinned core, for the live stream.
- Focused benchmarks and fuzzing done by three sub-reviews (frontend, parsers and unsafe code, correctness hotspots).
- `cargo audit` and `npm audit --omit=dev`.

**Scripts:** all probe scripts are in the session scratchpad, `/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/`. In this report `$S` stands for that directory.

**B7 overlap:** B7 is in flight, so two findings overlap its scope: topology outliers (M4) and operator earnings (noted under M7).

---

## Before going live (must fix)

1. **H1. Client IP behind the Flux proxy.**
   - Decide the trust model.
   - Trust `X-Forwarded-For` only from known proxy peers.
   - Make the default right for a spec that passes no environment.
2. **M1. Connection timeouts and shutdown.**
   - Add a header-read timeout, an idle keep-alive timeout and a connection cap.
   - Add a deadline on graceful shutdown.
   - Raise `RLIMIT_NOFILE` at startup.
3. **M2 and M6. Upstream budget for ingest.**
   - Keep user-driven lookups and client-chosen hot apps away from the ingest's upstream budget and circuit breakers.
4. **M3. Validate failover answers.**
   - Check the height (the documented ±2 rule) and the requested block hash.
   - Or keep chain-critical reads off community nodes.
5. **M4. Cap topology replies.**
   - Cap peers per reporter and reporters per reply (coordinate with B7's mesh-outlier work).
6. **M5. Make a dead engine visible.**
   - Use `panic = "abort"`, or a health check that reflects reducer liveness, so a dead engine is restarted instead of serving frozen data.
7. **M9. Two instances.**
   - Confirm whether FDM keeps a client on one instance.
   - Either way, stamp `nodes.bin` and `mesh.bin` with an instance id.
   - Stop persisting node ids across sessions: they differ between the two instances.
8. **M7. Cheap protections for per-request CPU work.**
   - Round `t` on `/timeline/state`.
   - Compress per-request bodies off the async worker.
   - Rate-limit the heavy derived routes.
9. **L9 and L10. Small frontend fixes.**
   - Guard `decodeURIComponent` in the router.
   - Send CSP, `frame-ancestors` and `nosniff` headers.

---

## High

### H1. Every user shares the proxy's IP, so the per-IP limits become site-wide limits

**Location:**
- `crates/atlas-server/src/extract.rs:58-75` (`ClientIp::from_parts`)
- `crates/atlas-server/src/config.rs:68` (`trust_proxy: false`), `config.rs:108` (`max_per_ip: 16`), `config.rs:137-139` (5 rps, burst 20)
- `crates/atlas-server/src/live/hub.rs:195-218`
- `crates/atlas-server/src/proxy.rs:307, 317`

**What is wrong:**
- The client IP is the TCP peer unless `ATLAS_TRUST_PROXY` is set. The Flux spec passes no environment, so production runs with `trust_proxy = false`.
- Public traffic reaches the container through the Flux domain proxy (FDM, HAProxy) at `atlas.app.runonflux.io`. The peer address of almost every request is therefore one of a handful of proxy IPs.
- v1 knew this: it set `app.set('trust proxy', 1)` (`backend/src/http/server.ts:18`).
- Every per-IP control then applies to all users together:
  - at most **16 concurrent live WebSockets per proxy IP for the whole site**;
  - **5 upstream-reaching explorer requests a second (burst 20)** shared by everyone.
- The failure needs no attacker: the 17th visitor through a given proxy gets a 429 on `/ws` and no live stream. One user scrolling the explorer exhausts the explorer budget for everyone.

**Simply turning on `ATLAS_TRUST_PROXY` is not safe:**
- The app port (33889) is also published directly on each node's public IP.
- A direct client can send its own `X-Forwarded-For`, and the right-most entry (`extract.rs:67`) is then attacker-chosen.
- That bypasses both limits, and lets one client create unbounded keys in the governor keyed limiter (`proxy.rs:307`), whose state grows until the 60 s prune.

**Verified:**
- Local probe: 20 WebSockets from one IP; 16 opened and 4 were refused at the handshake.
  - Command: `node $S/ws_limit.mjs 20`.
- Code reading of the limiter keys.
- **Not verified:** the FDM proxy IPs, and whether FDM appends `X-Forwarded-For`. Measure on a node before deploying: log the peer IP and the `X-Forwarded-For` value of a request through the domain.

**Suggested fix:**
- Trust `X-Forwarded-For` (or `X-Real-IP`) only when the TCP peer is in an allowlist of FDM proxy addresses or CIDRs.
  - Ship the allowlist as a built-in default, because the spec cannot pass environment variables.
  - Otherwise use the peer.
- Take the right-most entry not in the allowlist rather than the right-most entry.
- Key IPv6 clients by /64.
- Raise `max_per_ip` for allowlisted proxies, or apply it only to resolved client IPs.
- Fixing H1 makes M2 more pressing: per-user budgets let more total load reach the shared upstream.

---

## Medium

### M1. No header-read, idle or request timeouts; one half-sent request blocks shutdown

**Location:**
- `crates/atlas-server/src/lib.rs:101-109`: `axum::serve` builds hyper's connection builder without a timer, so hyper's default 30 s header timeout never applies (`hyper-1.11.1/src/common/time.rs:70-78` drops a default timeout when no timer is set).
- `crates/atlas-server/src/routes/mod.rs:75-85`: no timeout or concurrency layer.
- No `RLIMIT_NOFILE` handling anywhere.

**What is wrong:**
- Connections that send a partial header, or nothing at all, are kept forever. Keep-alive connections never idle out.
- There is no overall cap on HTTP connections.
- Graceful shutdown waits for every HTTP connection, with no deadline. A single half-sent request keeps the process alive after SIGTERM.
  - Docker then sends SIGKILL after 10 s.
  - `engine.shutdown()` and `store.flush()` never run.
  - Up to 10 s of non-durable commits and the shutdown rank write (ARCHITECTURE 3.2, B5) are lost.
- Recent Docker gives containers a soft `nofile` limit of 1024 by default, and Rust does not raise it. About 1,000 idle sockets from one host would then exhaust descriptors:
  - `accept` fails (axum logs an error and sleeps 1 s per failure);
  - outbound upstream connects and GeoIP file opens fail too.

**Verified (local probes):**
- `python3 $S/slow.py 200 45`: of 200 partial-header and 200 idle connections, 0 were closed after 45 s.
- `python3 $S/shutdown_probe.py <pid> partial`: after SIGTERM, the server logged "shutdown requested" and exited only when the client closed its socket 30 s later.
- The 1024 soft limit inside Flux containers is not verified. Check with `cat /proc/1/limits` in a running app container.

**Suggested fix:**
- Serve through `hyper_util::server::conn::auto::Builder` with `TokioTimer`, a `header_read_timeout` (for example 10 s) and an HTTP/1 keep-alive idle timeout. Alternatively wrap `axum::serve` with a listener that enforces both.
- Cap concurrent connections with a semaphore at accept.
- Add a request timeout layer for non-WebSocket routes (for example 30 s).
- Give graceful shutdown a 5 s deadline, then continue to `engine.shutdown()` and `flush()` regardless.
- Raise the soft `RLIMIT_NOFILE` to the hard limit at startup.

### M2. User-driven explorer lookups share the ingest's upstream budget and circuit breakers

**Location:**
- `crates/atlas-server/src/state.rs:96`: the explorer gets `engine.clients().clone()`, the same `HttpClient`, host gates and failover sets the engine uses.
- `crates/atlas-flux/src/http.rs:70-79`: the gateway gate is 4 rps with 4 concurrent requests.
- `http.rs:298-303`: the gate permit is held across the token wait and the request.
- `crates/atlas-flux/src/upstream.rs:79-87, 194-216`: the breaker is shared.
- `crates/atlas-flux/src/error.rs:66-79`: `TooLarge`, `Parse`, `Timeout`, 429 and 5xx count as faults.
- Callers: `crates/atlas-server/src/explorer.rs:199, 225` (gateway `getblock` and `getblockheader`) and `explorer.rs:174, 247, 282, 319` (Insight).

**What is wrong:**
- Every uncached explorer lookup takes a permit and a token from the same gate as the engine's T1 path (`getblock` per block, `currentwinner`, the mempool fetches, and so on). The tokio semaphore is FIFO, so an engine `getblock` waits behind every queued user fetch.
- Gateway-backed user requests are common, not exotic:
  - `/blocks/{h}` for any block older than the 32 recent ones (the tx list is fetched every time it is not cached);
  - hash searches (`getblockheader`);
  - the supply fallback.
- At 16 queued user fetches and 4 rps, the next block decode waits about 4 s. That breaks the T1 target of 3 s or less.
- Faults caused by user lookups count against the shared breaker. Five in a row open the gateway's breaker for 30 s. Engine reads then go to the dynamic failover nodes, which are random community nodes (see M3).
- The Insight `utxo` lookup is also risky:
  - it accepts 64 MiB bodies (`clients.rs:601`), but its cache holds only 4 MiB (`explorer.rs:112`);
  - an address with a very large UTXO set is therefore refetched in full on every page;
  - its `TooLarge` or `Timeout` failures count as Insight faults.

**Verified:**
- Code reading.
- I did not reproduce the latency against the real gateway, because the brief forbids loading external services.

**Suggested fix:**
- Give interactive lookups their own `HttpClient`, with their own gates (for example 1 to 2 rps per host) and their own `Health`. The ingest budget and breakers then cannot be consumed or tripped by users.
- Alternatively, add a priority lane so engine calls bypass queued user calls.
- Cap the utxo body near the cache size, and page it upstream if Insight supports that.

### M3. Failover reads trust any node operator; the documented ±2 height check does not exist

**Location:**
- `crates/atlas-flux/src/upstream.rs:40`: `height_acceptable` is never called outside tests.
- `crates/atlas-engine/src/jobs/chain.rs:660-690`: the failover pool takes the first 5 confirmed, reachable nodes, with no height probe.
- `chain.rs:355-378`: a fetched block's hash is never compared with the requested one.
- `crates/atlas-flux/src/clients.rs:437`: failover reads of the full permanent-message history allow 256 MB bodies.

**What is wrong:**
- Once the gateway breaker is open (M2 shows users can contribute to that), every FluxOS read goes to community nodes. Their answers are accepted as is:
  - a forged `getblock` with arbitrary payouts, starts or height is applied, published and stored;
  - a height near `u32::MAX` jumps the tip there and wedges the sync (the height arithmetic wraps in release builds).
- ARCHITECTURE 3.1 promises the ±2 check.

**Verified:** code reading (parsers sub-review).

**Suggested fix:**
- Reject a block whose hash differs from the request, or whose height is far beyond the known tip.
- Gate pool nodes on `block_count` with `height_acceptable`.
- Keep chain-critical reads (blocks, the node list) off node failover, or require two nodes to agree.
- Cap failover bodies at the node default of 4 MB.

### M4. One node operator can forge or erase the peer mesh through `/flux/topology`

**Location:**
- `crates/atlas-engine/src/jobs/topology.rs:74-91`: every reporter named in a reply is accepted, with no cap on peers.
- `topology.rs:17, 80`: each named reporter is marked covered for 25 minutes.
- `crates/atlas-engine/src/reducer.rs:965-1009` and `crates/atlas-engine/src/state/mesh.rs:173`: one report adds an edge.

**What is wrong:** a queried node can do three things:
- name every node as a reporter, so honest nodes are skipped for 25 minutes;
- list about 190,000 forged peers within the 4 MB response cap;
- send empty lists that count toward removing real edges.

**Measured** with the real merge code: each forged reply added 190,650 edges; four replies brought the mesh to 762,600 edges and +62 MB of RSS. Each such reply becomes:
- an approximately 2.3 MB `mesh` live message to every browser (also kept in the replay ring);
- a handshake on the globe for each added edge;
- a `mesh.bin` rebuild;
- 7 days of `mesh_events` rows.

**Suggested fix:**
- Cap peers per reporter (about 200) and reporters per reply (about 100). Drop the whole reply when either cap is exceeded.
- Mark a reporter covered only if its list passes the caps.
- Cap added edges per call.
- This overlaps B7's "mesh outlier hosts" work: fold it in there.

### M5. A dead reducer, store writer or job freezes the server while health stays green

**Location:**
- `crates/atlas-engine/src/lib.rs:436-462`: the reducer thread handle is dropped and job tasks are never checked.
- `crates/atlas-engine/src/reducer.rs:61-91`: the writer thread is not watched; its sends are `let _ =`.
- `crates/atlas-server/src/routes/ops.rs:16-47`: `/healthz` always returns 200.
- `Cargo.toml`: `panic = "unwind"`.

**What is wrong:**
- A panic ends only its thread or task.
- WebSocket pings keep flowing, so browsers look connected while the published state is frozen.
- `/readyz` checks only `stale`; `/healthz` reports "degraded" after 600 s but still returns 200, so `atlas healthcheck` passes.
- If the store writer dies, every later commit is silently dropped.
- No release-mode panic on untrusted input was found (there is no `unwrap` or `expect` outside tests). The risk comes from dependencies (redb, serde, maxminddb) and future code.

**Verified:** code reading; grep found no `catch_unwind`, panic hook or `is_finished`.

**Suggested fix:**
- Set `panic = "abort"` in the release profile, or install a panic hook that exits the process. Docker or FluxOS then restarts it on the persisted state.
- Make `/healthz` fail when the reducer has not ticked or published for N minutes.

### M6. Any client steers hot-app polling and watch probes, using upstream budget and crowding out real watchers

**Location:**
- `crates/atlas-server/src/live/ws.rs:323-327, 387-406`: app names are only charset-checked and are not matched against the catalog.
- `crates/atlas-engine/src/jobs/apps.rs:115-150`: the union of all watched apps is sorted and truncated to 16, then `/apps/location/<name>` is polled on the gateway every 7 s.
- `crates/atlas-engine/src/jobs/watch_probe.rs:33, 49-58`: up to 256 hosts in IP order, re-probed 500 ms after any watch change.

**What is wrong:**
- Sixteen arbitrary names cost 16 gateway calls every 7 s, about 2.3 of the gateway's 4 rps, permanently, even for nonexistent apps.
- The names that sort first win the 16 slots. One client sending names like `-`, `0` or `00` takes every slot, and real users' open apps are never polled.
- Watch probes have the same shape:
  - the 256 lowest node IPs win;
  - a client that changes its watch list in a loop restarts probe rounds back to back, instead of every 60 s.
- Every `sub` also rebuilds the union of all connections' watches under a mutex (`crates/atlas-engine/src/lib.rs:736-750`), which is O(connections x 80) per message.
- A name of `..` passes the check. `seg("..")` leaves it unescaped, and URL normalisation turns `/apps/location/..` into a request to `/apps/` (info-level, see I2).

**Verified:** code reading.

**Suggested fix:**
- Accept only names present in the app catalog.
- Pick the hot apps by watcher count, not alphabetically.
- Count per-connection contributions fairly, and cap per IP.
- Debounce watch changes to at most one probe round per 60 s.
- Rate-limit `sub` (see L1).

### M7. Per-request CPU work without caching or limits; compression runs on the only async worker

**Location:**
- `crates/atlas-server/src/routes/timeline.rs:57-84`: cached per exact millisecond `t`, with get-then-insert (no single flight).
- `crates/atlas-server/src/routes/nodes.rs:127-185`: filter and sort per request; `geo_str` allocates per comparison (`nodes.rs:100`).
- `crates/atlas-server/src/routes/network.rs:368-385`: the metrics cache key includes `from`, so a step-aligned change of `from` misses. A minute-resolution query reads up to 30 days of rows (43,200).
- `crates/atlas-server/src/body.rs:224, 255-261`: `json_response` and first-use `CachedBody` compression (brotli q5) run inline in the handler.

**What is wrong:**
- Under the spec's 1 CPU, tokio sizes the runtime to one worker. Every per-request serialization, sort and compression runs on it, and no per-IP limit exists outside the explorer.
- `/timeline/state` is the cheapest to abuse: about 14 ms per distinct `t` (reconstruction 3 to 6 ms plus brotli 9 ms), likely 2 to 3 times more on a Flux vCPU. The 24 MiB cache holds about 28 bodies.
- `/operator/{address}` reads up to 400 payment rows per node for an operator with 180+ nodes, uncached (B7 is changing this route).

**Measured** (server pinned to one core, this desktop):
- `/nodes?limit=1000&sort=org` with brotli, 8 concurrent: 83 to 106 requests a second saturated the core.
- During that load, a 20 rps probe of `/network/summary` went from p50 0.12 ms / p99 0.18 ms to p50 7.4 ms / p99 51 ms (`bash $S/load2.sh '<url>' 8 -H 'Accept-Encoding: br'`).
- The live stream held up: message delay p99 stayed 4 ms (`bash $S/latency_under_load.sh`).
- Distinct `t` on `/timeline/state` with brotli: 14 to 20 ms each (curl timings; confirmed by the correctness sub-review's benchmark).

**Suggested fix:**
- Round `t` to 60 s (the client already rounds to `RES_MS`) and use moka `get_with`.
- Key metrics on a bucketed `from`.
- Compress per-request bodies inside `spawn_blocking`, or skip brotli for per-request bodies (gzip level 1 or zstd level 1 is several times cheaper).
- Add a small per-IP token bucket for derived routes (`/nodes`, `/timeline/state`, `/metrics`, `/operator`, `/search`) once H1 gives real client IPs.

### M8. Mesh deltas are lost on most snapshot resumes because `mesh.bin` lags

**Location:**
- `web/src/store/network.ts:363`: the resume seq is `min(bootstrap.seq, nodes.seq)` and ignores `mesh.seq`.
- `network.ts:843-856`: `applyMesh` has no seq guard.
- `crates/atlas-engine/src/publish.rs:160-195` and `reducer.rs:1696-1708`: `mesh.bin` is rebuilt at most every 10 s and otherwise keeps its old seq.

**What is wrong:**
- Mesh deltas between `mesh.seq` and the resume point are never replayed, and nothing detects the gap. Clients miss or keep ghost links until their next resync (about 250 each way per sweep).
- A failed mesh fetch (`runtime.ts:89`) keeps the old mesh while the client resumes from the new seq.

**Verified:** code reading (correctness sub-review).

**Suggested fix:**
- Resume from `min(bootstrap, nodes, mesh)`.
- Skip mesh deltas at or below the mesh snapshot seq.
- Refetch or resume older when the mesh fetch fails.

### M9. The two instances have separate seq spaces and separate node ids

**Location:**
- `crates/atlas-engine/src/lib.rs:395`: seq starts at 0 per process.
- `crates/atlas-engine/src/state/mod.rs` (`intern`): node ids are assigned per store, in order of first sight.
- `web/src/store/ui.ts:17-57`: the watchlist is stored as numeric ids.
- `web/src/app/runtime.ts:85-98`: `nodes.bin` carries no instance identity.

**What is wrong:**
- The spec runs 2 instances behind one domain. The `hello.started_ms` check catches only a WebSocket landing on a different instance from the snapshot.
- Bootstrap and `nodes.bin` can come from different instances undetected, and then deltas patch the wrong rows.
- Node ids differ between instances. A persisted watchlist, or an id-based link or `sel`, can point at a different node on the other instance.
- With per-connection balancing, the hello check turns into a resync loop.

**Verified:**
- Code reading.
- **Not verified:** FDM's session affinity for this domain.

**Suggested fix:**
- Add an instance id (or `started_ms`) to the `nodes.bin` and `mesh.bin` headers and resync on a mismatch.
- Persist watchlists and links by outpoint and map them to ids on load.
- Consider deterministic ids, for example ordered by collateral at first bootstrap.

---

## Low

### L1. Every `sub` replays the whole ring; `sub` is not rate-limited

**Location:** `crates/atlas-server/src/live/ws.rs:342-411`, `crates/atlas-engine/src/replay.rs:89-111`.

**What is wrong:**
- Each `sub` with an old `since_seq` replays up to 4,096 messages, or 16 MiB once the ring is full, which is the steady state per ARCHITECTURE 11.1.
- Each `sub` also resubscribes and recomputes the watch union.
- It works as an egress amplifier: one 91-byte message returns the ring, and a client can do this on 16 connections in a loop.

**Measured:** on `demo_server` with a 256 KB ring, 20 `sub` messages (1,820 B) returned 4,135 frames and 5.1 MB in 3 s, about 2,800 times the request size. Command: `node $S/ws_replay.mjs ws://127.0.0.1:3108/ws 20`.

**Suggested fix:**
- Honour `since_seq` only on the first `sub` of a connection, or at most once every few seconds.
- Allow a few `sub` messages per minute and close the connection on abuse.

### L2. Compaction blocks every store read, and requests have no timeout

**Location:** `crates/atlas-store/src/store.rs:214-229` (a write lock over the `Database`); `crates/atlas-server/src/state.rs:139-146`.

**What is wrong:**
- Compaction is weekly and after a budget prune. While it runs, every store-backed request blocks a blocking-pool thread, with no timeout. The store writer's unbounded channel (L7) grows meanwhile.
- 0.2 to 0.8 s was measured on small files. A year-old file of about 4.6 GB on a slow node disk could take much longer.

**Suggested fix:**
- Measure compaction on a full-size file.
- Time out store reads at the handler (503 with `Retry-After`).
- Schedule compaction off-peak.

### L3. The container runs as root with Docker's default capabilities

**Location:** `deploy/Dockerfile:49`.

**Assessment:**
- The documented reason holds: FluxOS bind-mounts a root-owned volume and the spec cannot pass `--user` or `--cap-drop`.
- The image is scratch, with no shell or helpers, and the process is memory-safe Rust with no `unsafe` beyond the mmap.
- The residual risk is a post-exploitation one. A memory-safety bug in a dependency would run as uid 0 with `CAP_NET_RAW`, `CAP_DAC_OVERRIDE`, `CAP_SETUID` and `CAP_SYS_CHROOT` inside the container.

**Suggested fix:**
- After binding and opening the data directory, have the binary drop its own privileges: set `PR_SET_NO_NEW_PRIVS` and clear all capability sets (for example with the `caps` crate).
- uid 0 without `CAP_DAC_OVERRIDE` can still write the root-owned volume, because it owns it.
- No secrets are in the image or the repository (grep checked).

### L4. The operator-managed GeoIP file can crash the process with SIGBUS if it is rewritten in place

**Location:** `crates/atlas-geoip/src/lib.rs:152-167` (the mmap) and `crates/atlas-engine/src/jobs/geoip.rs:93-102` (reload on mtime change).

**What is wrong:**
- The downloaded-file path is sound: stage, check, hard-link to the previous file, then rename.
- With `ATLAS_GEOIP_DB`, an in-place rewrite such as `cp new old` truncates the mapped file, and the next lookup on the reducer thread kills the process.

**Verified:** probe; the lookup before was `Some("London")`, after an in-place truncate `Bus error`, exit 135.

**Suggested fix:** copy the operator file through the same stage, check and rename flow, and map the copy.

### L5. GeoIP download caps are loose, it follows redirects, and nothing checks free disk

**Location:** `crates/atlas-geoip/src/fetch.rs:54-61, 78`; `crates/atlas-geoip/src/install.rs:48`.

**What is wrong:**
- The client uses reqwest's default policy of 10 redirects, without `https_only`.
- The compressed download is capped at 1 GiB, the same as the output, though the real file is about 60 MB.
- The timeout is 20 minutes.
- A compromised or redirected source could stage about 2 GB on the shared 10 GB volume.

**What is sound:** rustls, a streaming size cap, the CRC check, staging cleanup, and the metadata and probe checks before install.

**Suggested fix:**
- `Policy::limited(3)` with `https_only(true)`.
- Cap the download at 256 MB and the output at 512 MB.
- Check free space before staging.

### L6. Integer overflow on upstream values wraps silently in release builds

**Location:**
- `crates/atlas-core/src/amount.rs:211-254` (unchecked `Amount` arithmetic), used on upstream sums at `crates/atlas-flux/src/decode.rs:287-288`, `crates/atlas-engine/src/derive/block.rs:84` and `crates/atlas-core/src/emission.rs:184-195`.
- `decode.rs:307` (`time * 1000`).
- `crates/atlas-flux/src/txsize.rs:152-153`.
- `crates/atlas-engine/src/jobs/chain.rs:516, 521, 535` (`th + 1`, `h - th`).

**Suggested fix:** checked or saturating arithmetic at these sites. This matters most together with M3.

### L7. The store writer channel is unbounded and its failures are invisible

**Location:** `crates/atlas-engine/src/reducer.rs:65`; sends at `reducer.rs:259, 646, 1370, 1619`.

**Suggested fix:** use a bounded channel, and surface commit errors in `/readyz` and Prometheus.

### L8. The Insight explorer socket accepts the library default of 64 MiB messages

**Location:** `crates/atlas-flux/src/insight_socket/client.rs:275`.

**Suggested fix:** set `max_message_size` to about 1 MiB (real frames are under about 10 KB).

### L9. A malformed percent escape in a `/node/` link replaces the whole app with the error view

**Location:** `web/src/app/router.tsx:72` (an unguarded `decodeURIComponent` inside `useSelectionSync`).

**What is wrong:**
- `https://atlas.app.runonflux.io/node/%ZZ` throws a URIError into the root `errorComponent`, so the globe and the shell disappear.
- Nothing persists and no script runs.

**Suggested fix:** reuse the guarded `seg()` from `web/src/shell/wm/route.ts:10-17`.

### L10. No CSP, no `frame-ancestors` or `X-Frame-Options`, no `nosniff`

**Location:** `crates/atlas-server/src/web.rs` and the API responses.

**What is wrong:**
- Any site can frame the app (clickjacking reaches only harmless toggles).
- There is no defence in depth for a future HTML sink.

**Feasibility:** the built app has no inline script, no `eval`, no workers and no CDN assets.

**Suggested fix:**
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss: ws:; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff` on all responses.
- Test `style-src` against the `motion` library.

### L11. After a reorg, the replacement block's payout often goes to the wrong node

**Location:** `crates/atlas-engine/src/reducer.rs:771-814` (`expected_payees.clear()` at line 781); `crates/atlas-engine/src/derive/block.rs:464-503` (`attribute`).

**What is wrong:**
- The orphaned payout is not undone.
- When the replacement block pays the same node, attribution falls back to the first queued node with that address. That is a different node for multi-node operators.
- The result is a wrong rotation until the reconcile the reorg triggers, plus a permanent wrong payments row.

**Suggested fix:** keep a per-block undo record (the previous `last_paid_height`), or try the orphaned block's (height, tier, address) to node map first.

### L12. Replayed `block` messages rotate ranks twice when `nodes.bin` is newer than bootstrap

**Location:** `web/src/store/network.ts:549-590` (no `seq <= nodes.snapshotSeq` guard, unlike `applyNodes` at line 692).

**What is wrong:** rare, since it needs a publish between the two snapshot fetches. Ranks then stay wrong until the next resync.

**Verified:** vitest repro in `$S/vt/replay.test.ts`; the truth was `[2,3,0,4,1]` and the client ended with `[2,3,4,0,1]`.

**Suggested fix:** skip the node-table part of `applyBlock` when `seq <= nodes.snapshotSeq`.

### L13. A reorg deeper than the window can cascade and delete valid stored history

**Location:** `crates/atlas-engine/src/jobs/chain.rs:500-595` (fallback at line 581).

**What is wrong:**
- Each loop walks back another 11 blocks and deletes stored blocks, judged against a single gateway backend.
- A 1-deep reorg right after a gap jump can delete up to 10 backfilled blocks that are never refetched.

**Suggested fix:**
- Confirm against Insight before deleting deeper than the window.
- Cap the cascade at one window.
- Never delete below the cursor's known range.

### L14. A time-machine request can replay up to 2,000,000 events; `t` before the first keyframe returns a partial globe

**Location:** `crates/atlas-engine/src/timemachine.rs:278, 338-342`.

**Suggested fix:**
- Cap the replay at about 50k events.
- Return 404 for a `t` before the first keyframe (measured: 20 nodes from 93 events).

### L15. `/metrics/prometheus`, `/healthz` and `/readyz` are public

**Location:** `crates/atlas-server/src/routes/mod.rs:79-81`; `crates/atlas-server/src/routes/ops.rs:45-61`.

**What is wrong:** anyone can read the operational detail: upstream hosts and error rates, rate-limit and breaker pressure, WebSocket counts and uptime. This helps an attacker time M2 and M6, and adds an unauthenticated rendering cost.

**Suggested fix:** if no external scraper needs them, serve them only to loopback or an allowlisted peer. Otherwise accept the exposure knowingly.

---

## Info

- **I1.** The API republishes app environment values, including credentials owners put in public specs.
  - Location: `crates/atlas-core/src/app.rs:92`, `crates/atlas-flux/src/models/apps.rs:150, 185`.
  - Example: `/api/v1/apps/131barb1` returns `EARNFM_TOKEN=...` and `RP_API_KEY=...`.
  - The data is public on chain and the UI shows names only, but the API makes it easy to index. Consider returning names only, with values redacted.
- **I2.** `watch_apps: [".."]` passes `valid_app_name` (`ws.rs:323`). `seg()` (`crates/atlas-flux/src/clients.rs:46`) leaves dot segments, so the engine polls `/apps/` instead.
  - The same applies to `/apps/{name}` keys and the frontend `seg()` (`web/src/api/http.ts:82`).
  - Harmless today; reject `.` and `..` explicitly.
- **I3.** The per-IP limiter and the WebSocket counter key IPv6 clients by the full /128. Use /64 (fold into H1).
- **I4.** The SSRF guard has no explicit entry for Azure's wireserver, `168.63.129.16`.
  - Its ports (80 and 32526) are outside the allowed range 16100 to 16299, so it is unreachable.
  - Note it in case the port rule is ever relaxed.
- **I5.** The watchlist is silently truncated.
  - `web/src/store/ui.ts:82-86` has no cap; `ui.ts:44` keeps 500 on load.
  - `web/src/app/runtime.ts:81` and the server cap at 64, with the selection first.
- **I6.** The container image link puts the owner's repotag unencoded into a fixed Docker Hub or Quay host (`web/src/features/inspect/derive/appSpec.ts:96-104`). The host cannot change; encode the segments anyway.
- **I7.** The "Open app" link `https://${name}.app.runonflux.io` is safe only because `/apps/{name}` enforces `[A-Za-z0-9_.-]` (`crates/atlas-server/src/routes/apps.rs:24`). Keep the two in sync.
- **I8.** Events that share a keyframe's millisecond are lost from time-machine replay (`timemachine.rs:333-337`). Key the boundary on the store event counter.
- **I9.** Rank operations are O(N) per call: client `queueSize` and `shiftQueue` (`network.ts:757-812`) and server `ClientRanks::position` (`queue.rs:191-196`). Acceptable today.
- **I10.** The bracketed IPv6 endpoint parser accepts port 0 (`crates/atlas-core/src/net.rs:84-95`). The SSRF port range rejects it.
- **I11.** The GeoIP client inherits automatic gzip, brotli and zstd decoding. If DB-IP ever sends `Content-Encoding: gzip`, updates would silently fail. Turn decoding off on that client.
- **I12.** `atlas_server::fixtures` (test and demo data) is compiled into the production binary (`crates/atlas-server/src/lib.rs:20`). There is no security impact.
- **I13.** Dependency audits are clean:
  - `cargo audit`: 314 crates, no advisories;
  - `npm audit --omit=dev` in `web/`: 0 vulnerabilities.

---

## Checked and found sound

**Input validation on routes:**
- Path parameters are capped at 1,024 bytes for the path and 160 for the parameter, and reject control characters (`crates/atlas-server/src/extract.rs`). The query string is capped at 2,048 bytes.
- Txids, hashes and heights are strictly parsed (`crates/atlas-server/src/routes/explorer.rs:89-105, 241-247`).
- Addresses are base58check-validated before any upstream call.
- App names are restricted to `[A-Za-z0-9_.-]`, 1 to 64 characters.
- Cursors are at most 9 digits; page limits are 100, 200, 500 and 1,000 depending on the route.
- `/metrics`:
  - at most 16 known series;
  - a span of 400 days or less;
  - at most 5,000 points;
  - steps that are whole minutes.
- `/nodes/{key}/history` windows are 366 days or less, capped at 5,000 events.
- `/timeline/state` rejects a future `t`.

**SSRF guard** (`crates/atlas-flux/src/ssrf.rs`):
- Endpoints are IP literals only, so there is no DNS and no rebinding.
- It blocks:
  - IPv4 loopback, RFC 1918, CGNAT (including Alibaba metadata at `100.100.100.200`), link-local (`169.254.169.254`), `192.0.0.0/24` (including Oracle's `192.0.0.192`), documentation, benchmarking, multicast and reserved ranges;
  - in IPv6, everything outside `2000::/3`, plus ULA (including AWS `fd00:ec2::254`), mapped, compatible, NAT64, 6to4 and Teredo forms.
- Only ports 16100 to 16299 are allowed.
- `GuardedEndpoint` is the only way to build a node request.
- The main client never follows redirects.
- Node requests have a 6 s total timeout, 1 attempt, a 4 MB cap after decompression and a 2 rps limit per IP.

**Upstream bodies:** the size caps apply after decompression (`crates/atlas-flux/src/http.rs:366-383`), so compression bombs are bounded. Error mapping does not leak upstream URLs.

**WebSocket limits:**
- 64 KiB messages, 8 malformed messages tolerated, the idle timeout, a 10 s write timeout and a bounded broadcast queue.
- Slow consumers are dropped, the per-IP and total caps are enforced, and the slot is released on drop.
- Subscribe-then-replay with seq dedupe is correct; a resync follows on an unknown seq or a gap.

**Static files:** `..` and backslash segments are rejected, and the body cache only grows with assets that exist.

**Panics:** no `unwrap`, `expect` or `panic!` outside tests; `unsafe` is forbidden apart from the mmap; poisoned locks are recovered.

**Binary decoders:**
- The Rust decoders use checked offsets.
- The web decoders survived 200,000 fuzzed `nodes.bin` inputs with only typed errors (`$S/fuzz/fuzz.ts`).

**Frontend:**
- There are no `innerHTML`, `dangerouslySetInnerHTML` or `eval` sinks.
- Every network string renders as React text or canvas text.
- External links carry `noopener noreferrer`.
- URL search parameters are allow-listed.
- There are no service workers, postMessage listeners or CDN assets.
- Every localStorage read is shape-checked inside try/catch.

**Rank contract:** the server's client model (`state/queue.rs`, `state/mod.rs:707-743`) and `network.ts` apply deltas in the same order, and reconcile ranks are authoritative without shifting. `cargo test -p atlas-engine --lib -- queue rank reorg replay` passes.

**Reorg cleanup:** blocks, hashes, payouts, payments and node txs of orphaned heights are deleted, the tip moves, and a reconcile is triggered.

**Shutdown signals:** SIGTERM and SIGINT are handled by PID 1 (the binary itself). WebSockets are closed with 1001 before the engine stops. This is apart from the drain deadline in M1.

**Secrets:** there are no credentials in the code, the image or the deploy spec.

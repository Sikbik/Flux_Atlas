# Flux API research: network, nodes, apps, benchmarks, geolocation, chain, payments

Status: research note for Flux Atlas v2. Every claim below was either probed live on **2026-09-30 (UTC, around chain height 2,996,915)** or read from upstream source at the commits listed in "Sources". Where the two disagree, or where something could not be verified, this note says so.

Scope: FluxOS node API (`/daemon`, `/flux`, `/benchmark`, `/apps`), the Flux stats service (`stats.runonflux.io`), direct node access, and the Flux daemon (`fluxd`) semantics behind them. Block-explorer features (blocks, txs, addresses, supply, rich list, `/explorer/*`, `explorer.runonflux.io`) belong to a teammate and appear here only where they touch node payments or block producers.

Status vocabulary in the catalog: `verified` (probed live, works as documented here), `partial` (works with caveats), `failing` (errors or 404 in production), `untested` (from source only).

---

## 1. Headline facts

| Fact | Value (2026-09-30) | Source |
|---|---|---|
| Confirmed FluxNodes | **6,724** (Cumulus 3,378 / Nimbus 1,582 / Stratus 1,764) | `/daemon/getfluxnodecount`, `/daemon/viewdeterministicfluxnodelist` |
| Distinct hosts (IPs) | 2,655 (up to 8 nodes per IP via UPnP ports) | node list |
| Distinct payment addresses | 840; distinct operator ZelIDs 1,135 | node list, stats `fluxinfo` |
| Consensus | **Proof of Node (PoN)** since block **2,020,000** (2025-10-25 18:00 UTC). No PoW mining any more. | `getblockchaininfo.upgrades`, block headers |
| Block time | **30.0 s** target; measured 29.99 s over the last 2,880 blocks and 30.04 s over the last 17,280 | block header timestamps |
| Block reward | 14 FLUX: 0.5 dev fund, 1 Cumulus, 3.5 Nimbus, 9 Stratus. **One node of each tier is paid in every block.** Producer gets no separate subsidy. | coinbase of blocks 2,996,900 and 2,996,916; `fluxd` `GetFluxnodeSubsidy` |
| Emission schedule | Subsidy drops 10% every 1,051,200 blocks. First reduction at height **3,071,200**, about **2026-10-26** at the current pace | `fluxd` `chainparams.cpp`, `GetBlockSubsidy` |
| FluxOS version | 8.20.0 on 6,565 of 6,571 reachable nodes (released 2026-09-25) | stats `fluxinfo` |
| fluxd version | 9010050 (v9.1.0) on 6,521 nodes; 9000650 (v9.0.6) on 49 | stats `fluxinfo` |
| ArcaneOS share | 6,182 of 6,571 reachable nodes (94%) report `arcaneVersion` ("jolly wombat") | stats `fluxinfo`, `/flux/isarcaneos` |
| Registered apps | 1,882 (spec versions 2 to 8); 1,779 have running instances; 8,274 instance locations | `/apps/globalappsspecifications`, `/apps/locations` |
| Enterprise (encrypted) apps | 906 of 1,573 v8 apps. Their `compose` is empty in public specs. | `/apps/globalappsspecifications` |
| Latest app spec version | **8**. No v9 in source or on chain (a web summary claimed v9 enforcement "late October 2026"; it is unverified and absent from FluxOS 8.20.0 source). | `/apps/latestspecificationversion`, `ZelBack/config/default.js` |
| Network capacity (benchmarked) | 54,451 cores, about 182 TB RAM, about 3.19 PB SSD, about 3.8 Tbps aggregate download | stats `fluxinfo` |
| App-locked resources | 14,612 cores (27%), about 29 TB RAM (16%), about 386 TB disk (12%) | stats `fluxinfo` `apps.resources` |
| Geography | 54 countries, 234 ASNs; top operators by org: Hetzner (about 24% combined across two org spellings), GHOSTnet 7.4%, Stofa 6.3% | stats `fluxinfo` |

### Changes since the v1 assumptions (facts only)

v1 called: `/daemon/listfluxnodes`, per-node `/flux/connectedpeers`, `/flux/incomingconnections`, `/flux/isarcaneos`, `/benchmark/getbenchmarks`, `/apps/installedapps`, and `/apps/globalappsspecifications`. **All still answer** (the peer ones are marked deprecated in FluxOS source). What changed around them:

1. **Consensus and block time.** PoN replaced PoW at height 2,020,000. Blocks are 30 s (was 120 s). Every block pays all three tiers (was one rotating payee per block). Block headers now carry a producer collateral (`collateral`) and signature (`blocksig`), with `version: 100` and `type: "PON"`. `difficulty` and `networkhashps` are PoN lottery-target artefacts, not hashrate.
2. **The node list has no `status` field.** Every entry in `viewdeterministicfluxnodelist` / `listfluxnodes` is CONFIRMED by definition. It does have an integer `rank` (payment-queue position within its tier) that older samples did not show.
3. **Aggregated per-node data exists.** `https://stats.runonflux.io/fluxinfo` returns the full `/flux/info` of every node (benchmarks, versions, ArcaneOS, geolocation, running apps) in one call, and it supports `?projection=`. You do not need to crawl each node for hardware, geo or versions.
4. **Aggregated peer topology exists.** `/flux/topology` (new in FluxOS 8.x) returns the peer lists that a node's neighbours report about themselves: about 60 reporters and about 1,900 peers per call. Around 120 to 200 calls rebuild the whole overlay graph, compared with 2 calls per node before.
5. **Payments are exactly attributable.** `fluxnodecurrentwinner` at height H names the three collaterals paid in block H+1 (verified). The node list's `last_paid_height` gives exact payee collaterals for the last full cycle.
6. **App changes have an on-chain change feed.** Every app register or update is a transaction to the app address with an OP_RETURN carrying the message hash (verified). You can fetch the message with `/apps/permanentmessages?hash=`.
7. **Node expiry is time-shifted.** A node must reconfirm within 640 blocks (about 5.3 h). Start transactions expire after 240 blocks, and DOS bans last 720 blocks. All PoN-era values come from `fluxd` `fluxnode.h`.
8. **App expiry is in blocks, and blocks are now 4x faster.** FluxOS multiplies block-based allowances by 4 after the PoN fork. `expire` values in specs registered before height 2,020,000 are in 2-minute blocks and need conversion (see section 5.4).
9. **The official docs are stale.** docs.runonflux.io/fluxapi shows "version 6.6.1", and its advertised `fluxapi.json` / `fluxapi.yaml` return 404. `RunOnFlux/flux-spec` is an empty repo. The authoritative path list is `ZelBack/src/routes.js` in `RunOnFlux/flux`.

---

## 2. Transport, envelopes, caching, auth

- **Base URLs.** `https://api.runonflux.io` resolves to `fdm-lb-main.runonflux.io` (5.161.44.226). `https://api.runonflux.com` resolves to the same host. Every one of about 90 probes during this session returned the same `fluxnode: server20_94.130.137.2` response header. The balancer is either sticky or has one backend for this client, so **node-local endpoints (`/flux/info`, `/apps/installedapps`, `/flux/peers` and so on) on api.runonflux.io describe that one node, not the network.**
- **Envelope.** Every FluxOS response is `{"status":"success"|"error","data":...}`. **Errors usually arrive as HTTP 200** with `status:"error"` and `data:{code?,name,message}`. For example, `/flux/peerhistory` returns HTTP 200 with `{"status":"error","data":{"code":401,"name":"Unauthorized",...}}`. Parse the envelope and ignore the HTTP code.
- **Compression.** api.runonflux.io serves `content-encoding: br` when asked. The node list shrinks from 4.17 MB to 546 KB with brotli (795 KB with gzip).
- **ETag and caching.** Express weak ETags (`W/"len-hash"`) are sent, and `If-None-Match` returns **304** (verified on `/flux/version`). FluxOS caches at **two layers**:
  1. **apicache**, keyed on the full URL: 30 s for most routes, 5 s for `/flux/topology`, `/flux/networkhealth` and `/apps/temporarymessages`, 2 min for `/apps/permanentmessages`, 5 min for `latestspecificationversion`. `cache-control: max-age` shows the *remaining* TTL. **A unique query string (e.g. `?nc=<ts>`) bypasses it** (verified).
  2. **The internal daemon-RPC cache** (`daemonGenericCache`), 20 s, keyed on RPC name and parameters. It applies to every `/daemon/*` call except `getBlock` and `getRawTransaction`, which use 1 h caches keyed by hash or height, so they never go stale. Only *successful* results are cached. This layer cannot be bypassed over HTTP; section 6 shows how to work around it.

  The node-list ETag changes every block, so 304s only help on slow-moving resources. stats.runonflux.io sits behind Cloudflare with `apicache` (`max-age=93` on `/fluxinfo`) and also sends ETags.
- **CORS.** `access-control-allow-origin: *` on api.runonflux.io, stats.runonflux.io and direct node APIs. Preflight returns 204 with GET/POST allowed. Direct node APIs are plain HTTP on port 16127 (or the UPnP port), so a browser on an HTTPS page cannot call them (mixed content). TLS is also served on **apiport+1** (16128 verified for a default-port node; certificate not validated in this test).
- **Rate limits.** None observed. FluxOS source says in `routes.js` that "the API has no rate limiting". Nothing documents the load balancer's limits. We stayed at 2 req/s or less.
- **Auth.** Routes under `// GET PROTECTED API` in `routes.js` (user, FluxNode owner, and FluxTeam levels) need a `zelidauth` header, which is a wallet-signed login. v2 must avoid them. Relevant examples: `/flux/peerhistory`, `/apps/appstats`, `/apps/applog`, `/apps/appmonitor`, `/apps/appinspect`, `/flux/*log`, `/id/loggedsessions`, all `/syncthing/*` except `deviceid` and metrics, and `/backup/*`. Everything listed in section 4 is public.
- **Push and streaming.** There is **no public push feed.**
  - `GET /flux/eventstream` (SSE) exists in source but returns `404 {"status":"error","data":{"message":"Event stream not enabled"}}` in production.
  - WebSockets are `/ws/flux` and `/ws/flux/:port`, the node-to-node peer protocol with a signed handshake. They are not a consumer feed.
  - `/ws/id/:loginphrase`, `/ws/sign/:message` and `/ws/payment/:paymentid` serve the login and payment flows.
  - socket.io namespaces cover app logs, the docker terminal and debug, all authenticated.
  - `getinfo` reports `zmqEnabled: true` on the daemon, but ZMQ is not exposed publicly (untested).
  - Change detection must use polling: block height, ETags, OP_RETURN app messages, and stats `roundTime`.

---

## 3. Identity, addressing and node semantics (Q1 in depth)

### 3.1 Stable identity
- **Primary key: the collateral outpoint `txhash:outidx`.** In the node list it appears as `collateral: "COutPoint(<64-hex>, <n>)"` plus separate `txhash` (string) and `outidx` (string). No duplicates exist among 6,724 entries. The key lives as long as the collateral UTXO is unspent. If the operator moves the collateral, the result is a new node.
- **IP is not stable.** 4,478 of 6,571 reachable nodes report `staticIp: false`. FluxOS tracks IP changes (`maxNumberOfIpChanges`), and several nodes share an IP. Key everything by collateral and treat IP as an attribute with history.
- **Operator groupings.**
  - `payment_address` is shared across many nodes: 840 unique, and the biggest has 424 nodes.
  - `pubkey` is the node operator key, often shared. 5,514 pubkeys are uncompressed (130 hex) and 1,210 are compressed (66 hex).
  - `flux.zelid` (in `/flux/info` and stats) is the operator's Flux ID: 1,135 unique.
  - `t3...` payment addresses are P2SH, i.e. multisig or delegate setups.
- **Block producers are reported with a truncated outpoint** (section 6.3).

### 3.2 IP formats (verified across all 6,724 entries)
| Form | Count | Meaning |
|---|---|---|
| `a.b.c.d` | 2,384 | API on default port 16127 |
| `a.b.c.d:PORT`, PORT in {16137, 16147, 16157, 16167, 16177, 16187, 16197} | 4,328 | UPnP / multi-node hosts; API on that port (TLS on PORT+1) |
| `""` with `network: ""` | 12 | Confirmed node with no IP recorded (upstream data gap) |
| IPv6 / onion | 0 | `getfluxnodecount` reports `ipv6: 0, onion: 0`. No bracketed forms observed, so the IPv6 format is untested |

- `/apps/locations`, stats `fluxinfo.flux.ip`, `/flux/ip` and `/flux/topology` **always include the port** (`:16127` included). The node list **omits `:16127`**. Normalise to `host:port` on ingest.
- Upstream quirk: `getfluxnodecount.ipv4` (2,384) counts only port-less entries, because `fluxd` `CountNetworks` parses `ip:port` strings as invalid. Do not use it as an IPv4 count.
- `/apps/enterprisenodes` lists only port-less (default-port) nodes: 2,385. It is not an ArcaneOS list.

### 3.3 Status values
- Node list entries are all CONFIRMED. There is no `status` field.
- `/daemon/getfluxnodestatus` (node-local) returns `status` in {`CONFIRMED`, `STARTED`, `DOS`, `OFFLINE`, `expired`} (fluxd `FluxnodeLocationToString`; `expired` is lower-case upstream).
- Pre-confirmation and banned nodes live in separate lists:
  - `/daemon/getstartlist` holds started, not yet confirmed nodes, with `expires_in` blocks (expiry is 240 blocks post-PoN).
  - `/daemon/getdoslist` holds nodes that failed to confirm, with `eligible_in` blocks (the ban is 720 blocks).
- FluxOS-level health lives elsewhere:
  - `flux.dos.dosState`: 0 is fine and higher means penalised. Values seen: 0, 0.13, 2, 4, 6.24, 8, 12, 100.
  - `benchmark.bench.status`: `CUMULUS`, `NIMBUS` or `STRATUS` when passing. It shows `running` during a benchmark and `failed` with `error` text otherwise.
  - `benchmark.status.status`: `online`.
  - stats `error: {}` means unreachable.

### 3.4 Tier representation
| Field | Values |
|---|---|
| node list `tier` | `CUMULUS`, `NIMBUS`, `STRATUS` |
| node list `amount` (collateral, string) | `"1000.00"`, `"12500.00"`, `"40000.00"` |
| `getfluxnodecount` | `cumulus-enabled` / `nimbus-enabled` / `stratus-enabled`, plus legacy aliases `basic-enabled` / `super-enabled` / `bamf-enabled` |
| `/flux/nodetier` (node-local) | lower-case plus suffix, e.g. `stratus_new` |
| benchmark `status` | tier name when passing |

No new tiers exist on chain. FluxEdge, Titan and "enterprise" are not tiers. Enterprise is an app property (spec v8 plus ArcaneOS nodes). FluxEdge shows up only as ordinary apps (e.g. `fluxedgenode1_edgenode1` containers).

### 3.5 Heights, timestamps and the payment queue
| Field | Type | Meaning (verified) |
|---|---|---|
| `added_height` | int | Height of the node's start transaction. Oldest live node: 1,268,415 |
| `confirmed_height` | int | Height at which the node was first confirmed (typically `added_height` + 2 to + 100) |
| `last_confirmed_height` | int | Height of the node's most recent confirmation. Nodes must reconfirm within 640 blocks or they expire. The observed range across the list was exactly [tip-639, tip]. |
| `last_paid_height` | int | Height of the last block that paid this node. `0` = never paid (191 nodes) |
| `activesince` | **string** (unix s) | Time of confirmation |
| `lastpaid` | **string** (unix s) | Time of the `last_paid_height` block. Sentinel `"1516980000"` when never paid |
| `rank` | int | 0-based position in **its tier's** payment queue. `rank 0` is paid in the next block |

**Queue semantics (verified).** Within each tier, sorting by `rank` matches ascending `max(last_paid_height, confirmed_height)` with zero inversions. Never-paid nodes queue by `confirmed_height`. One node per tier is paid per block, so the **cycle length in blocks is about the tier's node count**:

| Tier | Nodes | Cycle | Per-payment | Approx FLUX/node/day |
|---|---|---|---|---|
| Cumulus | 3,378 | about 3,317 to 3,378 blocks, about 28 h | 1.0 | 0.85 |
| Nimbus | 1,582 | about 1,573 blocks, about 13.2 h | 3.5 | 6.4 |
| Stratus | 1,764 | about 1,706 to 1,764 blocks, about 14.7 h | 9.0 | 14.7 |

`/daemon/fluxnodecurrentwinner` returns the rank-0 node of each tier. At height 2,996,915 it named payment addresses `t1ZJR468…`, `t1UfW786…` and `t1eEx91E…`. The coinbase of block 2,996,916 paid exactly those addresses (1 / 3.5 / 9 FLUX).

---

## 4. Endpoint catalog

Latency is the total time from this client (US) for one request, with api.runonflux.io served from Germany. Size is the transferred brotli-compressed size / decompressed size. All probes ran on 2026-09-30. Fixture paths are relative to `docs/research/fixtures/flux/`.

### 4.1 Daemon module (`/daemon/*`, proxied RPCs to fluxd)

| Method + path | Status | Latency | Size (br / raw) | Fixture | Powers |
|---|---|---|---|---|---|
| GET `/daemon/viewdeterministicfluxnodelist/:filter?` (alias `listfluxnodes`, deprecated `viewdeterministiczelnodelist`, `listzelnodes`) | verified 2026-09-30 | 0.6 to 1.0 s | 546 KB / 4.17 MB (6,724 items) | `daemon_viewdeterministicfluxnodelist.json` | Node registry, globe, payment queue, churn |
| same, with `:filter` = substring of IP or payment address | verified | 0.3 to 0.4 s | 1 to 3 KB | `daemon_viewdeterministicfluxnodelist_filter_ip.json`, `_filter_address.json` | Operator view, per-IP lookups |
| GET `/daemon/getfluxnodecount` (alias `getzelnodecount`) | verified | 0.26 s | 217 B | `daemon_getfluxnodecount.json` | Tier counts ticker |
| GET `/daemon/fluxnodecurrentwinner` | verified | 0.28 s | 980 B | `daemon_fluxnodecurrentwinner.json` | Next-block payees ("who gets paid next") |
| GET `/daemon/getstartlist` | verified | 0.27 s | 1.1 KB (5 items) | `daemon_getstartlist.json` | Joining nodes, churn in |
| GET `/daemon/getdoslist` | verified | 0.25 s | 0.7 KB (3 items) | `daemon_getdoslist.json` | Failed/banned nodes |
| GET `/daemon/getfluxnodestatus` | verified (node-local) | 0.26 s | 665 B | `daemon_getfluxnodestatus.json` | Per-node status when probing a node |
| GET `/daemon/getinfo` | verified | 0.38 s | 292 B | `daemon_getinfo.json` | Height, daemon version |
| GET `/daemon/getblockchaininfo` | verified | 0.29 s | 1.25 KB | `daemon_getblockchaininfo.json` | Height, best hash, upgrades (PON activation), value pools |
| GET `/daemon/getmininginfo` | verified | 0.28 s | 300 B | `daemon_getmininginfo.json` | `ponminter` flag, mempool size |
| GET `/daemon/getblockcount`, `/daemon/getbestblockhash` | untested (trivial) | - | - | - | Tip polling |
| GET `/daemon/getblockhash/:index` | verified | about 0.3 s | about 100 B | - | Height to hash |
| GET `/daemon/getblockheader/:hash/:verbose?` | verified | 0.27 to 0.33 s | 845 B | `daemon_getblockheader_pon_2996900.json`, `_pon_first_2020000.json`, `_pow_2019999.json` | Producer, time, PoN/PoW type |
| GET `/daemon/getblock/:hashheight/:verbosity?` (height accepted) | verified | 0.25 to 0.46 s | v1: 2.1 KB; v2: 11 to 13 KB | `daemon_getblock_2996900_verbosity1.json`, `_verbosity2.json`, `daemon_getblock_2996916_verbosity2.json` | Payment pulses (coinbase), producer arcs |
| GET `/daemon/getblocksubsidy/:height` | verified | 0.27 s | 40 B | `daemon_getblocksubsidy_2996900.json` | Returns only `{"miner":14}` post-PoN (tier split is not itemised) |
| GET `/daemon/getrawtransaction/:txid/1` | verified | 0.45 s | 2.7 KB | `daemon_getrawtransaction_appmessage.json` | Decode app-message OP_RETURN |
| GET `/daemon/getbenchmarks` | verified (node-local) | 0.27 s | 735 B | `daemon_getbenchmarks.json` | **`data` is a JSON-encoded string**, so decode twice. Prefer `/benchmark/getbenchmarks` |
| GET `/daemon/getbenchstatus` | verified (node-local) | 0.30 s | 151 B | `daemon_getbenchstatus.json` | Same string-encoding quirk |
| GET `/daemon/getdifficulty`, `getnetworkhashps`, `getnetworksolps` | untested / not useful | - | - | - | PoN lottery target, not hashrate |
| GET `/daemon/getpeerinfo`, `getnettotals`, `getnetworkinfo` | untested | - | - | - | Daemon P2P (node-local) |

**Node list record (`data[]`), all 6,724 records share one shape:**

| Field | Type | Meaning |
|---|---|---|
| `collateral` | string | `COutPoint(<txhash>, <outidx>)`, full 64-hex here |
| `txhash` | string | Collateral txid (primary key part 1) |
| `outidx` | **string** | Collateral vout (primary key part 2) |
| `ip` | string | See 3.2 |
| `network` | string | `ipv4` or `""` |
| `added_height`, `confirmed_height`, `last_confirmed_height`, `last_paid_height` | int | See 3.5 |
| `tier` | string | `CUMULUS` / `NIMBUS` / `STRATUS` |
| `payment_address` | string | t1 (P2PKH) or t3 (P2SH) |
| `pubkey` | string | Node operator pubkey, hex (66 or 130 chars). Verifies `blocksig` |
| `activesince`, `lastpaid` | string (unix s) | See 3.5 |
| `amount` | string | Collateral, e.g. `"40000.00"` |
| `rank` | int | Queue position within the tier |

Trimmed sample:
```json
{"collateral":"COutPoint(511f0838…d4b776f4, 0)","txhash":"511f0838…d4b776f4","outidx":"0","ip":"85.164.135.56:16187","network":"ipv4","added_height":2970084,"confirmed_height":2970181,"last_confirmed_height":2996453,"last_paid_height":2996915,"tier":"STRATUS","payment_address":"t1bDZ8MF…","pubkey":"043d38…","activesince":"1789991194","lastpaid":"1790797174","amount":"40000.00","rank":1763}
```

**`getfluxnodecount`:** `{"total":6724,"stable":6724,"basic-enabled":3378,"super-enabled":1582,"bamf-enabled":1764,"cumulus-enabled":3378,"nimbus-enabled":1582,"stratus-enabled":1764,"ipv4":2384,"ipv6":0,"onion":0}`. `stable` always equals `total` in source.

**`fluxnodecurrentwinner`:** `{"CUMULUS Winner":{collateral,ip,added_height,confirmed_height,last_confirmed_height,last_paid_height,tier,payment_address}, "NIMBUS Winner":{…}, "STRATUS Winner":{…}}`. Keys contain spaces, and there is no `pubkey`, `rank` or `txhash`.

**`getstartlist[]`:** `{collateral, added_height, payment_address, expires_in, amount}`. **`getdoslist[]`:** `{collateral, added_height, payment_address, eligible_in, amount}`. Both have no IP and no tier; tier comes from `amount`.

**Block (verbosity 1) PoN fields:**

| Field | Type | Meaning |
|---|---|---|
| `version` | int | `100` for PoN blocks, `4` for PoW |
| `type` | string | `"PON"` or `"POW"` |
| `collateral` | string | **Producer's collateral outpoint, truncated to the first 10 hex chars of the txid**: `"COutPoint(b5ffc02035, 0)"` |
| `blocksig` | hex | DER ECDSA signature by the producer over the block hash (checkable with the node's `pubkey`) |
| `bits` / `difficulty` | | PoN target |
| `time` | int | Unix seconds |
| `tx` | array | Txids (v1) or full txs (v2) |
| `valuePools` | array | Sprout/Sapling shielded pools (supply is the teammate's area) |

PoW-only fields `nonce` and `solution` are present only in pre-2,020,000 headers.

**Coinbase (tx[0] in verbosity 2), verified order:** `vout[0]` 0.5 FLUX to the dev fund `t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA`; `vout[1]` Cumulus payee (1.0); `vout[2]` Nimbus payee (3.5); `vout[3]` Stratus payee (9.0). Amounts scale with the 10% annual reduction. Observed coinbase totals are exactly 14.0. How fees are handled was not verified.

### 4.2 Flux module (`/flux/*`, FluxOS node state)

Unless noted, these are **node-local**. On api.runonflux.io they describe the balancer's backend node. Probe individual nodes at `http://<ip>:<port>/…`.

| Method + path | Status | Latency (api / direct) | Size | Fixture | Powers |
|---|---|---|---|---|---|
| GET `/flux/info` | verified | 0.54 s / 0.35 to 1.7 s | 1.5 to 1.7 KB br / about 3 KB | `flux_info.json`, `node_flux_info_upnp.json`, `node_flux_info_arm64_nonarcane.json`, `node_flux_info_fluxos_8_18.json` | Everything per node in one call (see below) |
| GET `/flux/version` | verified | 0.41 s | 36 B | `flux_version.json` | FluxOS version |
| GET `/flux/nodetier` | verified | 0.28 s | 41 B | `flux_nodetier.json` | e.g. `stratus_new` |
| GET `/flux/geolocation` | verified | 0.28 s | 350 B | `flux_geolocation.json` | Node's own ip-api geolocation |
| GET `/flux/ip` | verified | 0.26 s | 48 B | `flux_ip.json` | `host:port` |
| GET `/flux/staticip` | verified | 0.27 s | 32 B | `flux_staticip.json` | bool |
| GET `/flux/isarcaneos` | verified | 0.27 s / 0.11 to 0.55 s | 32 B | `flux_isarcaneos_true.json`, `flux_isarcaneos_false.json` | ArcaneOS flag. Matches presence of `flux.arcaneVersion` in `/flux/info` on all 14 nodes probed |
| GET `/flux/health` | verified (new in 8.19) | 0.27 s | 112 B | `flux_health.json` | `{db,syncthing,docker,hardware,dos,appsDos}` in {`ok`, `degraded`, `unmeasured`}; the first failing check comes back as an error envelope |
| GET `/flux/dosstate` | verified | 0.32 s | 60 B | `flux_dosstate.json` | `{dosState, dosMessage}` |
| GET `/flux/uptime` | verified | 0.28 s | 34 B | `flux_uptime.json` | FluxOS process uptime, seconds |
| GET `/flux/timezone` | verified | 0.27 s | 43 B | `flux_timezone.json` | IANA tz |
| GET `/flux/topology` | verified (new in 8.x) | 0.27 s / 0.35 to 0.72 s | 6 to 14 KB br / 27 to 63 KB | `flux_topology.json` (5 reporters) | **Overlay graph from few calls** |
| GET `/flux/peers/:filter?` | verified (new) | 0.26 s / 0.31 to 0.44 s | 2.4 KB br / 22 KB (about 39 peers) | `flux_peers.json` | Rich per-peer link stats: latency, bytes, uptime, remoteVersion, capabilities |
| GET `/flux/networkhealth` | verified (new) | 0.32 s | 82 B | `flux_networkhealth.json` | `{status:"HEALTHY", inSteadyState, history[]}` |
| GET `/flux/unstablenodes` | verified (new) | 0.27 s | 116 B | `flux_unstablenodes.json` | `[{ip, port, disconnects, firstDisconnect(ms)}]`: flapping peers as seen by this node |
| GET `/flux/connectedpeers`, `/flux/incomingconnections` | verified (deprecated) | 0.27 s | about 0.3 KB | `flux_connectedpeers.json`, `flux_incomingconnections.json` | Bare IPs **without ports**. Use `/flux/peers` or `/flux/topology` |
| GET `/flux/connectedpeersinfo` | verified (deprecated) | 0.28 s | 1.5 KB | `flux_connectedpeersinfo.json` | `{ip, port, latency, lastPingTime}` |
| GET `/flux/peerhistory` | failing: auth required (401 in a 200 envelope) | 0.26 s | 101 B | `flux_peerhistory_unauthorized.json` | Avoid |
| GET `/flux/enterpriseappowners` | verified | 0.28 s | 140 B | `flux_enterpriseappowners.json` | 3 ZelIDs allowed to target enterprise nodes |
| GET `/flux/marketplaceurl` | verified | 0.26 s | 77 B | `flux_marketplaceurl.json` | Points to `stats.runonflux.io/marketplace/listapps` |
| GET `/flux/eventstream` | failing: 404 "Event stream not enabled" | 0.28 s | 64 B | `flux_eventstream_404.json` | Not usable |
| GET `/flux/checkfluxavailability/:ip/:port` | untested | - | - | - | Reachability check via a node |

**`/flux/info` shape** (identical to each element of stats `fluxinfo` minus the stats wrapper fields):

- `daemon.info` has the same shape as `getinfo` (daemon `version` int, `blocks`, `connections`, `difficulty`). `daemon.zmqEnabled` is a bool.
- `node.status` has the same shape as `getfluxnodestatus` plus `status`.
- `benchmark.info` is `{version (fluxbench, "6.3.1"), rpcport}`.
- `benchmark.status` is `{status:"online", benchmarking:<tier|failed|running>, flux:"connected", systemsecure:bool}`.
- `benchmark.bench` is the hardware block (below).
- `flux` holds versions and the operator identity:
  - versions: `version` (FluxOS), `nodeJsVersion`, `syncthingVersion`, `dockerVersion`, `mongoDbVersion`, `os`, `osVersion`, `osPrettyName`, `arcaneVersion` (string, absent if not ArcaneOS), `arcaneHumanVersion`
  - network: `ip` (`host:port`), `staticIp`, `upnp`, `maxNumberOfIpChanges`, `numberOfConnectionsOut`, `numberOfConnectionsIn`
  - identity and state: `zelid` (operator), `timezone`, `dos{dosState,dosMessage}`, `appsDos{…}`, `dosStaging`, `development`
  - `explorerScannedHeigth{generalScannedHeight}` is an **upstream typo, keep it as-is**. It is absent on some nodes.
- `apps.fluxusage` is `{totalApps, runningApps, stoppedApps, nodeSpecs{cpuCores, ram (MB float), ssdStorage (GB)}}`. `stoppedApps` can be **negative** (observed -2; upstream quirk).
- `apps.runningapps[]` is `{Names:["/flux<component>_<app>"], State, Status}`.
- `apps.resources` is `{appsCpusLocked, appsRamLocked (MB), appsHddLocked (GB)}`.
- `geolocation` is `{ip, continent, continentCode, country, countryCode, region, regionName, lat, lon, org, isp, asn ("AS24940 Hetzner Online GmbH"), mobile, proxy, hosting, static, dataCenter}`.
- `appsHashesTotal` and `hashesPresent` are ints (app-message sync completeness).

**Hardware block `benchmark.bench`:**

| Field | Type | Meaning |
|---|---|---|
| `ipaddress` | string | IP (and port for UPnP) the benchmark saw |
| `architecture` | string | `amd64` (6,526), `arm64` (7), `""` (unreachable) |
| `armboard` | string | Board string for ARM (e.g. "Raspberry Pi 5 Model B Rev 1.1"), usually `""` |
| `status` | string | Tier name when passing, `running`, `failed`, or `"0"` for the stats placeholder |
| `time` | int | Unix s of the last benchmark |
| `cores` | int | Logical cores |
| `real_cores` | int | Only in the stats placeholder object |
| `ram` | number | GB |
| `ssd`, `hdd`, `totalstorage` | number | GB |
| `ddwrite` | float | MB/s disk write |
| `disksinfo[]` | array | `{disk, size, writespeed}` (ArcaneOS shows `flux_crypt`) |
| `eps`, `eps_singlethread`, `eps_multithread` | float | CPU events/s (the tier requirement, e.g. Stratus needs 1,520) |
| `ping` | float | ms |
| `download_speed`, `upload_speed` | float | Mbps |
| `bench_version`, `speed_version` | string | Tool versions (`0.0.0` when failed) |
| `systemsecure` | bool | |
| `error` | string | Failure reason text |

**`/flux/topology`:** `{reporters:int, knownPeers:int, topology:{"<host:port>":{outbound:["host:port",…], inbound:[…]}}}`. It contains the peer sets that this node's neighbours reported to it through the peer-exchange protocol (cap `PEER_TOPOLOGY_MAX_REPORTERS`), so one call gives full adjacency for about 60 nodes. With 7 calls (1 via the API plus 6 direct) we collected 362 reporters, 14,061 directed edges, and saw 5,541 of the 6,702 addressable nodes.

**`/flux/peers[]`:** `{ip, port, direction, latency, missedPongs, lastPingTime, lastPongTime, connectedAt, uptime, source ("inbound"|"deterministic"), isAlive, badMessages, capabilities[], remoteClockOffsetMs, lastTransmissionDelay, messagesReceived, messagesSent, bytesReceived, bytesSent, remoteVersion, reconnects}`.

### 4.3 Benchmark module (`/benchmark/*`, node-local)

| Method + path | Status | Latency | Size | Fixture |
|---|---|---|---|---|
| GET `/benchmark/getbenchmarks` | verified (api and 6 nodes) | 0.28 to 0.49 s | about 510 B | `benchmark_getbenchmarks.json` (same shape as `benchmark.bench`) |
| GET `/benchmark/getstatus` | verified | 0.27 s | 111 B | `benchmark_getstatus.json` |
| GET `/benchmark/getinfo` | verified | 0.26 s | 63 B | `benchmark_getinfo.json` (`{version, rpcport}`) |
| GET `/benchmark/getstoredbenchmark` | verified (cached 1 h) | 0.28 s | 541 B | `benchmark_getstoredbenchmark.json` (`{benchmark:{…}, tier}`) |

**Aggregated source: yes. Use stats `fluxinfo` (section 4.5) rather than per-node calls.**

### 4.4 Apps module (`/apps/*`)

Global (network-wide DB, the same answer from any synced node): `globalappsspecifications`, `locations`, `permanentmessages`, `temporarymessages`, `hashes`, `installingerrorslocations`, `placementlocations`, `enterprisenodes`, `deploymentinformation`, `registrationinformation`. Node-local: `installedapps`, `listrunningapps`, `listallapps`, `fluxusage`, `appsresources`.

| Method + path | Status | Latency | Size (br / raw) | Fixture | Powers |
|---|---|---|---|---|---|
| GET `/apps/globalappsspecifications/:hash?/:owner?/:appname?` (also `?appname=`, `?owner=`, `?hash=`) | verified | 0.95 s | **1.22 MB / 2.53 MB** (1,882 apps; enterprise blobs barely compress) | `apps_globalappsspecifications.json`, `apps_globalappsspecifications_appname.json` | App catalog, constellations |
| GET `/apps/appspecifications/:appname` | verified | 0.28 s | 557 B | `apps_appspecifications.json` | Single app |
| GET `/apps/locations` | verified | 0.40 s | 315 KB / 2.40 MB (8,274 rows) | `apps_locations.json` | **Instance to node mapping** |
| GET `/apps/location/:appname` | verified | 0.27 s | 0.9 KB | `apps_location_appname.json` | Per-app instances |
| GET `/apps/permanentmessages/:hash?/:owner?/:appname?` (also query form) | verified | **7.4 s** full; 0.27 to 0.5 s filtered | **24.5 MB / 92.7 MB** full (70,908 msgs) | `apps_permanentmessages.json`, `apps_permanentmessages_appname.json`, `apps_permanentmessages_hash.json` | Spec history, spend history |
| GET `/apps/temporarymessages/:hash?` | verified | 0.31 s | 12.8 KB / 23.8 KB (14 msgs) | `apps_temporarymessages.json` | Pending (unconfirmed) registrations and updates, 1 h TTL |
| GET `/apps/hashes` | verified | 1.6 s | 5.4 MB / 15.9 MB (70,997) | `apps_hashes.json` | Message index `{txid,height,hash,value,message,messageNotFound}` |
| GET `/apps/installinglocations` | verified | 0.27 s | 30 B (empty) | `apps_installinglocations.json` | In-flight installs |
| GET `/apps/installingerrorslocations`, `/apps/installingerrorslocation/:appname` | verified | 0.27 s | 13.5 KB / 121 KB (322) | `apps_installingerrorslocations.json` | Install failures `{hash, ip, name, broadcastedAt, error (JSON string)}` |
| GET `/apps/appowner/:appname`, `/apps/apporiginalowner/:appname` | verified | 0.27 to 0.28 s | 64 B | `apps_appowner.json`, `apps_apporiginalowner.json` | Ownership transfers |
| GET `/apps/messagescount/:appowner` | verified (errors without owner) | 0.29 s | 33 B | `apps_messagescount_owner.json`, `apps_messagescount_error_no_owner.json` | |
| GET `/apps/latestspecificationversion` | verified | 0.25 s | 29 B | `apps_latestspecificationversion.json` | `8` |
| GET `/apps/registrationinformation` | verified | 0.27 s | 6.5 KB | `apps_registrationinformation.json` | Pricing history, `appSpecsEnforcementHeights`, app addresses, port rules |
| GET `/apps/deploymentinformation` | verified | 0.25 s | 1.4 KB | `apps_deploymentinformation.json` | `address` (app payment address), `minimumInstances` 3, `maximumInstances` 100, allowances |
| GET `/apps/getappspecsusdprice` | verified | 0.25 s | 178 B | `apps_getappspecsusdprice.json` | USD price per resource unit |
| GET `/apps/placementlocations` | verified (new) | 0.30 s | 4.2 KB | `apps_placementlocations.json` | **Nodes, fault domains and tier counts per continent and country** |
| GET `/apps/enterprisenodes` | verified | 0.62 s | 171 KB / 1.0 MB (2,385) | `apps_enterprisenodes.json` | Enterprise trust score per default-port node |
| GET `/apps/tamperingevents/:appname?` | verified (empty) | 0.27 s | 30 B | `apps_tamperingevents.json` | Tamper detections |
| GET `/apps/installedapps/:appname?` | verified (node-local) | 0.25 s / 0.11 to 0.55 s | 0.03 to 5 KB | `apps_installedapps.json`, `node_apps_installedapps*.json` | Specs of apps on that node |
| GET `/apps/listrunningapps` | verified (node-local) | 0.27 s | 610 B | `apps_listrunningapps.json` | Docker containers |
| GET `/apps/fluxusage`, `/apps/appsresources` | verified (node-local) | 0.25 s | about 0.1 KB | `apps_fluxusage.json`, `apps_appsresources.json` | |
| GET `/apps/availableapps` | verified | 1.1 s | 1.22 MB | `apps_availableapps.json` (10 items) | Same app set as global specs (1,887 rows / 1,882 names). Redundant |
| GET `/apps/whitelistedrepositories` | verified (deprecated, always `[]`) | 0.29 s | 30 B | `apps_whitelistedrepositories.json` | |
| POST `/apps/placementfeasibility`, `/apps/calculateprice` | untested | - | - | - | "What would it cost" or "where could it run" tools |

#### 4.4.1 App spec versions in the wild (1,882 apps, 2026-09-30)

| Version | Apps | Enforced from height | Top-level fields |
|---|---|---|---|
| 1 | 0 live (3 historical messages) | 0 | `name, description, owner, repotag, port, containerPort, enviromentParameters, commands, containerData, cpu, ram, hdd, tiered` |
| 2 | 2 | 0 | v1 fields with plural `ports`, `containerPorts`, plus `domains` |
| 3 | 27 | 983,000 | v2 + `instances` |
| 4 | 11 | 1,004,000 | `name, description, owner, compose[], instances` |
| 5 | 3 | 1,142,000 | v4 + `contacts[], geolocation[]` |
| 6 | 65 | 1,300,000 | v5 + `expire` |
| 7 | 201 | 1,420,000 | v6 + `nodes[], staticip`; compose adds `repoauth, secrets` |
| 8 | 1,573 | 1,932,380 | v7 + `enterprise` (encrypted blob); 12 apps also carry `datacenter` (bool, new); compose drops `tiered` and `secrets` |

Every spec also carries `hash` (the latest message hash) and `height` (the height of the latest register or update). The field spellings are fixed upstream quirks: **`enviromentParameters`** (sic) in v1 to v3 and **`environmentParameters`** in v4+.

Compose component (v4+): `name, description, repotag, ports[int], containerPorts[int], domains[string], environmentParameters[string], commands[string], containerData (string; prefixes like "g:" and "r:" select the syncthing sync mode, and "|m:…" adds extra mounts), cpu (float), ram (MB int), hdd (GB int)`. v4 to v7 also have `tiered` (bool). v7 adds `secrets` and `repoauth`, v8 keeps `repoauth`. In v2 and v3 the `ports` and `containerPorts` values are **strings**; in v4+ they are ints. No live app uses `tiered: true`, so the tiered fields (`cpubasic` and so on) are never seen.

- **Enterprise apps.** 906 v8 apps have `enterprise` (base64 ciphertext, about 1 to 3 KB) and `compose: []`. Their images, ports, domains and resources are **not public**. Only name, owner, instances, geolocation, expire, nodes and staticip are visible. The legacy message types `zelappregister` and `zelappupdate` also appear carrying v8 specs.
- **Geolocation restrictions.** `geolocation[]` strings take the forms `ac<CONT>`, `ac<CONT>_<CC>` and `ac<CONT>_<CC>_<Region>` to allow a location, and `a!c…` to forbid one (66 apps use a forbid). Examples: `acEU_DE`, `acNA_US_North Carolina`.
- **Pinned nodes.** `nodes[]` lists IPs pinned for enterprise or private apps (12 apps).
- **Domains.** `compose[].domains[]` runs parallel to `ports`. 101 components have a custom domain. Flux also auto-assigns `<app>.app.runonflux.io`-style FDM domains (not in the spec).
- **Expiry.** Expiry height is `height + (expire ?? default)` blocks. `default` = `blocksLasting` (22,000), multiplied by 4 after the PoN fork. Specs registered before 2,020,000 had their remaining blocks converted 4x (`appSpecHelpers.js`). Common `expire` values: 88,000 (about 30.6 days at 30 s), 20,160 (7 days), 1,056,000 (max, about 1 year).
- **Owner.** `owner` is a ZelID (a Bitcoin-style `1…` address). Owner can change via update, and `/apps/apporiginalowner` returns the first owner. Across 1,882 apps there are 1,306 distinct owners, and the largest owns 244 apps (Flux's own account).
- **Images.** `repotag` registries are Docker Hub (1,072), ghcr.io (39), and quay, lscr, ECR, GitLab and codeberg (a few each).

#### 4.4.2 Locations (`/apps/locations[]`, "running")
`{ip ("host:port", always with port), name, hash (spec hash running), broadcastedAt (ISO), expireAt (ISO, broadcastedAt + 2 h 5 min), osUptime (s), staticIp (bool), runningSince (ISO)}`

- Rows are re-broadcast by the hosting node roughly hourly and drop out after `expireAt`.
- **Registered vs running:** registered = `globalappsspecifications`, running = distinct `name` in `locations`, and the gap is what's pending or failed.
- Comparing `hash` with the spec's current `hash` shows instances still running an older version.

#### 4.4.3 Permanent messages (spec history)
Each message is `{type ("fluxappregister" | "fluxappupdate" | legacy "zelappregister" | "zelappupdate"), version (message format, always 1), appSpecifications (full spec at that time), hash, timestamp (ms, signer clock), signature, txid, height, valueSat (FLUX paid, in satoshis)}`.

- The full history is 70,908 messages for 23,351 distinct app names. The first dates from height 694,307 (2020-09).
- 19,314 messages fall after the PoN fork.
- Spec-version mix: v7 21,942; v4 15,983; v8 15,272; v6 10,875; v5 4,892; v3 1,689; v2 252; v1 3.
- **Filtering:** `?appname=`, `?owner=` and `?hash=` work. There is **no height filter**, so do not poll the full dump.

**On-chain change feed (verified):**
1. Each message's `txid` pays `deploymentinformation.address` (currently `t3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX`).
2. The same tx has an OP_RETURN whose data is the ASCII of the 64-hex message hash.
3. The block pipeline can spot these outputs.
4. Fetch each spotted message with `/apps/permanentmessages?hash=<hash>` (0.27 s, about 2 KB).

`/apps/temporarymessages` shows messages that have been broadcast but not yet mined (TTL 1 h, with an `arcaneSender` bool). Use it for "incoming deployment" animations.

#### 4.4.4 Resource totals and marketplace
- **Network totals:** there is no global endpoint. Sum stats `fluxinfo[].apps.resources` (locked) and `benchmark.bench` (capacity), or sum spec `compose[].cpu/ram/hdd × instances` (public apps only).
- **Marketplace:** `https://stats.runonflux.io/marketplace/listapps` returns 106 templates `{name, description, category, version, instances, compose[], priceUSD|price, multiplier?, visible, enabled, lockedValues?, userEnvironmentParameters?, contacts?, geolocation?, geolocationOptions?, expire?, nodes?, staticip?}`. `/marketplace/listdevapps` is the dev variant (untested). Deployed marketplace apps are named `<lowercased template><unix-ms>` (e.g. `palworld1789838545590`, `presearchnode1780599757621`), so they map back to the template by name prefix and `repotag`. There is no "featured" flag beyond `visible` and `category`.

#### 4.4.5 Placement and enterprise
- **`/apps/placementlocations`:** `{tableAvailable, tableGenerated (ISO), total:{nodes, domains}, unresolved, continents:{EU:{nodes, domains, tiers:{CUMULUS,NIMBUS,STRATUS}, countries:{DE:{nodes, domains, tiers}}}}}`.
  - Built from the node list joined with the IP-location table (section 5.2).
  - `domains` means **fault domains**: distinct organisations, falling back to /16 prefixes.
  - Sample values: 263 domains network-wide; EU 4,813 nodes.
- **`/apps/enterprisenodes[]`:** `{tier, payment_address, txhash, outidx, pubkey, ip, collateralPoints, maturityPoints, pubKeyPoints, enterprisePoints, enterpriseApps, score}`, sorted by score. Only nodes with port-less IPs are included.

### 4.5 Stats service (`https://stats.runonflux.io`)
This is the Flux team's aggregation service (Express behind Cloudflare, with apicache). FluxOS itself depends on it for its geolocation fallback, the marketplace, USD prices, and module minimum versions.

| Method + path | Status | Latency | Size (br / raw) | Fixture | Powers |
|---|---|---|---|---|---|
| GET `/fluxinfo` | verified | 1.2 s | **1.63 MB / 22.1 MB** (6,723 nodes) | `stats_fluxinfo.json` | **All-node hardware, versions, ArcaneOS, geo, running apps** |
| GET `/fluxinfo?projection=a,b.c,…` (Mongo-style, nested dotted paths OK) | verified | 0.8 to 1.2 s | geo projection 318 KB / 3.36 MB; bench+versions 686 KB / 5.48 MB | `stats_fluxinfo_projection_geo.json`, `stats_fluxinfo_projection_bench.json` | Cheap periodic pulls |
| GET `/fluxinfo/<anything>` | partial: the path segment is treated as a projection, so every row comes back `{}` | 0.26 s | 20 KB raw | - | No per-IP filter here |
| GET `/fluxlocation/<ip>` | verified | 0.47 to 0.49 s | 210 B | `stats_fluxlocation_ip.json`, `stats_fluxlocation_ip_unreachable_node.json` | Per-IP geo `{ip, continent, continentCode, country, countryCode, region, regionName, lat, lon, org}`. **Works for unreachable nodes** |
| GET `/fluxlocation` (no IP) | failing: 404 | - | - | - | No bulk variant |
| GET `/fluxhistorystats` | verified | 0.37 s | 22 KB / 160 KB (2,585 points) | `stats_fluxhistorystats.json` | `{"<unix ms>":{cumulus,nimbus,stratus}}`, about every 14.5 min, covering the last 30 days. **Instant backfill for node-count charts** |
| GET `/marketplace/listapps` | verified | 0.56 s | 12 KB / 75 KB | `stats_marketplace_listapps.json` | Marketplace |
| GET `/apps/getappspecsusdprice` | verified | 0.38 s | 178 B | `stats_apps_getappspecsusdprice.json` | Pricing |
| GET `/getmodulesminimumversions` | verified | 0.24 s | 68 B | `stats_getmodulesminimumversions.json` | `{syncthing, docker}` minimums |
| GET `/api/v1/richlist` | untested (teammate's scope) | - | - | - | Referenced by the dashboard bundle |

**stats `fluxinfo[]` element:** the full `/flux/info` object (4.2) plus wrapper fields:
- `ip` (`host`, or `host:port` for non-16127)
- `tier`, `paymentAddress`, `collateralHash`, `collateralIndex` (int)
- `addedHeight`, `confirmedHeight`, `lastConfirmedHeight`, `lastPaidHeight` (ints, camelCase)
- `activeSince` (string)
- `scannedHeight`
- `roundTime` (ms; one value per collection round)
- `dataCollectedAt` (ms, per node; a round spans about 18 min)
- `error: {}` when the node was unreachable

Observed variants (all in the fixture):
- **Normal:** 6,571 rows.
- **Unreachable: 152 rows** carry `error: {}`, and every nested field is a **zeroed placeholder**: `lat: 0, lon: 0`, empty strings, `daemon.info.version: 0`, `benchmark.bench.status: "0"`, `real_cores: 0`, `disksinfo: [{"disk":"sda",…}]`, `apps.fluxusage: "0"` (**a string, not an object**), and a reduced `geolocation` key set. **Treat these as missing, not as (0,0).**
- **Geolocation key sets:** 17 keys normally, 10 keys for placeholders, and 16 keys (no `ip`) on one node.
- **Benchmark statuses:** tier names, `running` (68), `failed` (29).
- **Other variants:** Debian vs Ubuntu, `development: true` (8), FluxOS 8.18 and 8.19 stragglers, and fluxd v9.0.6.

Joining: `(collateralHash, collateralIndex)` equals the node list's `(txhash, int(outidx))`. Out of 6,724 list entries, 6,723 matched and 1 was missing (it had joined since the round).

---

## 5. Answers to the six questions

### 5.1 Q1: full node list
**Use `/daemon/viewdeterministicfluxnodelist`** (identical to `/daemon/listfluxnodes`; both verified byte-for-byte equal in size). It returns 6,724 rows: 4.17 MB raw, 546 KB brotli, 0.6 to 1.0 s. Fields, identity, IP formats, statuses, tiers, rank/queue and heights are covered in sections 3 and 4.1. Supplements:
- `getstartlist` for nodes joining (confirmation pending, expires in 240 blocks).
- `getdoslist` for failed confirmations (banned for 720 blocks).
- `getfluxnodecount` as a cheap change hint.
- The `:filter` path segment for operator and IP lookups.

### 5.2 Q2: geolocation for all nodes
- **Best: `stats.runonflux.io/fluxinfo?projection=ip,tier,collateralHash,collateralIndex,geolocation`.** One request, 318 KB brotli, about 0.8 s, and it covers all nodes. It provides lat/lon, continent, country, region, org, ISP, ASN, and the `hosting`/`dataCenter`/`proxy`/`mobile`/`static` flags. The source is FluxOS's own ip-api lookup (`geolocationService.js`, with stats as fallback).
- **Gaps:** about 150 unreachable nodes per round get zeroed geo. Backfill these through **`/fluxlocation/<ip>`** (verified to resolve an unreachable node) at about 0.5 s each, spread out, and cache by IP. Nodes with IP `""` (12) cannot be located.
- **Quality notes:**
  - `org` spellings differ for the same provider ("Hetzner" vs "Hetzner Online GmbH"). Group by the ASN prefix of `asn` (`AS24940`) instead.
  - ip-api city-level lat/lon clusters at datacenter or city centroids, so many nodes share exact coordinates. Jitter them for display.
- **Local fallback: recommended, as belt-and-braces and for determinism.** Two free sources:
  1. **`RunOnFlux/fluxos-network-policy/iplocation.bin.gz`** (4.6 MB). This is the table FluxOS placement itself uses. It is IPv4 range to (organisation, country, ISO-3166-2 region), built from DB-IP City Lite and RIR allocation data and refreshed monthly by CI. The binary format is documented in `ZelBack/src/services/appPlacement/ipLocationStore.js` (magic `FLXGEO` v2, JSON header, LEB128 varint rows, at least 1.5 M rows). **It has no lat/lon.** Using it makes v2's "fault domain" counts match `/apps/placementlocations` exactly.
  2. **DB-IP City Lite mmdb** (CC-BY 4.0, monthly) for lat/lon. Attribution is required.
- **Per-node cost if nothing else existed:** `/flux/geolocation` on each of 6,724 node APIs, about 0.3 to 1.7 s each. Roughly 2% of nodes are unreachable per round, and at 2 req/s the sweep takes about 1 h. Not needed.

### 5.3 Q3: hardware, benchmarks and versions
- **Aggregated: yes.** Pull **`stats.runonflux.io/fluxinfo`**. Either take it whole (1.63 MB brotli) or use the projection `ip,collateralHash,collateralIndex,benchmark.bench,benchmark.status,benchmark.info.version,flux.version,flux.arcaneVersion,flux.arcaneHumanVersion,flux.upnp,flux.staticIp,flux.os,flux.osVersion,flux.dockerVersion,daemon.info.version,apps.resources,apps.fluxusage,dataCollectedAt` (about 0.7 MB brotli).
- **What it contains:**
  - Hardware: cores, RAM (GB), SSD/HDD (GB), EPS (single-thread and multi-thread), disk write MB/s, up/down Mbps, ping, architecture, ARM board.
  - Benchmark: status, error, `systemsecure`.
  - Versions: FluxOS, fluxbench (`benchmark.info.version`), `bench_version` and `speed_version`, fluxd (`daemon.info.version`, int-encoded, e.g. 9010050 is 9.1.0), Node.js, Docker, MongoDB, syncthing, OS, and ArcaneOS build and name.
- **Freshness:** one round takes about 15 to 18 minutes (`roundTime`, `dataCollectedAt`). Benchmarks themselves re-run on nodes every few hours (`bench.time`).
- **Per-node fallback:** `/flux/info` (about 3 KB, 0.35 to 1.7 s), or `/benchmark/getbenchmarks` for hardware only.
- **ArcaneOS flag:** `flux.arcaneVersion` present means ArcaneOS. This was checked on 14 nodes against `/flux/isarcaneos`.

### 5.4 Q4: apps
Covered in 4.4. Summary of best sources:

| Need | Source |
|---|---|
| Specs, all fields | `/apps/globalappsspecifications` (1.22 MB; poll with ETag) |
| Instance to node mapping | `/apps/locations` (315 KB) |
| Running vs registered | locations vs specs |
| Spec history | `/apps/permanentmessages?appname=` |
| Change feed | OP_RETURN hash + `?hash=` |
| Pending changes | `/apps/temporarymessages` |
| Resource totals | stats `fluxinfo.apps.resources` for locked, spec `compose` for requested (public apps only) |
| Marketplace | stats `/marketplace/listapps` |
| Owner | spec `owner`, or `/apps/apporiginalowner` for the first owner |
| Expiry | `height + expire` (see 4.4.1 for PoN conversion) |
| Domains | `compose[].domains` |
| Geo restrictions | `geolocation[]` |
| Enterprise and private apps | `enterprise` non-empty (opaque), `nodes[]`, `flux/enterpriseappowners`, `apps/enterprisenodes` |
| Failed installs | `/apps/installingerrorslocations` |

Ambiguity to flag: **the per-app "cost" (valueSat) of each update is in permanent messages, but the FLUX/USD conversion rate at that time is not.** `registrationinformation.fluxUSDRate` is current only.

### 5.5 Q5: chain summary
- **Height, best block, block time:** `/daemon/getblockchaininfo` (`blocks`, `bestblockhash`, `upgrades.76b809bb` = PON active from 2,020,000). Block time is about 30.0 s.
- **Difficulty and hashrate:** there is no PoW. `difficulty` is the PoN target, adjusted every block with a Digishield-style window (fluxd `GetNextPONWorkRequired`). `networkhashps`/`networksolps` are vestigial. `getmininginfo.ponminter` reports whether *this* node runs the PoN minter.
- **Supply and emission:** 14 FLUX/block × 2,880 blocks/day = **40,320 FLUX/day** until height 3,071,200, then 10% less each 1,051,200 blocks. The teammate's scope covers the supply totals (`gettxoutsetinfo`, explorer). `getblocksubsidy` returns only `{"miner":14}`.
- **Node count by tier:** `/daemon/getfluxnodecount`. For history, stats `/fluxhistorystats` gives about 30 days at about 15-minute resolution.
- **Rewards per tier:** 1 / 3.5 / 9 FLUX, plus 0.5 to the dev fund.
- **Which nodes got paid in each block (exact):**
  - (a) Poll `fluxnodecurrentwinner` at each new height H. Its three collaterals are the payees of block H+1. Confirm this against the coinbase addresses (`vout[1..3]`).
  - (b) Backfill: in any node-list snapshot, for each tier the node with `last_paid_height == h` is the payee of block h. This covers about one cycle back (about 13 to 28 h). Coverage is 1,479 to 1,499 of the last 1,500 heights per tier; the gaps are nodes that have since been re-paid or left.
  - The coinbase alone gives only the payment address, which is ambiguous: up to 424 nodes share one.
- **Who produced each block:** header `collateral` (first 10 hex of txid plus vout). Match it by prefix against the node list: no collisions among 6,724 current nodes. Producers that have left the list cannot be resolved without history, so **keep a collateral index from the first ingest onward**. `blocksig` can be verified against the node's `pubkey`. Eligibility is a per-slot lottery: `hash(collateral, prevBlockHash, slot) < target` (fluxd `pon.cpp`), and any confirmed node of any tier can win. Emergency blocks signed by a fixed emergency collateral are possible (fluxd `emergencyblock.cpp`; none observed).
- **Upstream ambiguity:** the truncated 10-hex collateral in `getblock` / `getblockheader` comes from `COutPoint::ToString()` (`primitives/transaction.cpp`), while fluxnode RPCs use `ToFullString()`. This is an upstream inconsistency. It could change in a future fluxd, so parse both forms.

### 5.6 Q6: streaming, caching, limits, CORS, auth
See section 2. In short:
- There is no public push (SSE disabled, websockets are peer or login only). Poll.
- Weak ETags + 304 work. `max-age=30` on FluxOS, 93 s on stats.
- `ACAO: *` everywhere.
- No documented rate limits.
- Avoid `zelidauth` routes (the PROTECTED sections of `routes.js`).
- The error envelope arrives with HTTP 200.
- Section 6 covers real-time.

---

## 6. Real-time sources

Goal: animate events as they happen instead of refreshing every 30 minutes. All latencies below were measured on 2026-09-30 between about 20:00 and 20:17 UTC from one US client. They are small samples, so treat them as indicative.

### 6.1 Push channels in FluxOS (source: `lib/socketHandlers.js`, `lib/socketIoHandlers/*`, `routes.js`)

| Channel | Public? | Emits | Usable by v2? |
|---|---|---|---|
| WS `/ws/flux`, `/ws/flux/:port` | Upgrade is open, but it is the node-to-node peer protocol with capability headers | Gossip: `fluxappregister`/`fluxappupdate` (temp messages), `fluxapprunning`, `fluxappremoved`, `fluxappinstalling`, `fluxappinstallingerror`, `fluxipchanged`, `fluxnodesigterm`, `fluxpolicy*`, plus `*sync` bulk transfers | **No.** It is undocumented internal protocol, the connection takes a peer slot on a production node, and nodes may close non-node origins (close codes 4003 to 4008). **Not tested; do not use.** |
| WS `/ws/id/:loginphrase`, `/ws/sign/:message` | Yes, but only for the login flow | Signed login result for one phrase | No |
| WS `/ws/payment/:paymentid` | Yes, for one payment id | Payment confirmation relay | No |
| socket.io namespaces `debug`, `terminal`, `applogs` | **No.** `verifyPrivilege` with zelidauth | Debug output, docker terminal, container log lines | No |
| SSE `GET /flux/eventstream` | Route exists | FluxEventBus events | **failing: 404 "Event stream not enabled" in production** (verified) |
| fluxd ZMQ | `zmqEnabled: true` on nodes, but the port is not published | hashblock/rawtx | No (not reachable; untested) |

**Conclusion: there is no public push channel.** Real time has to come from tight polling of cheap indicators (6.2). That works well because of one uncached RPC.

### 6.2 Cheapest change indicators (measured)

| Indicator | Request | Size | Latency (req) | Freshness caveat | Measured detection delay |
|---|---|---|---|---|---|
| **Next block exists** | `GET /daemon/getblockhash/<tip+1>?nc=<ts>` | 94 B success / 93 B error (`code -8 "Block height out of range"`) | 0.3 s | Errors are **not cached** at either layer, so the first success comes straight from fluxd | **0.9 to 2.2 s after header `time`** (6 blocks, 1.2 s poll) |
| Best block hash | `GET /daemon/getbestblockhash` | 94 B | 0.34 s | apicache 30 s + daemon cache 20 s | 27 to 30 s typical (7 blocks), and one block was missed entirely |
| Best block hash, cache-busted | `…/getbestblockhash?nc=<ts>` | 94 B | 0.34 s | daemon cache 20 s remains | 1.9 to 19.7 s, median 10.4 s (7 blocks) |
| Block count on 3 sources | api + 2 direct nodes, round-robin | 35 B | 0.3 to 0.6 s | Each node has its own 20 s cache phase | Sources disagreed by up to 19.8 s for the same block |
| Node counts | `/daemon/getfluxnodecount` | 217 B | 0.26 s | 50 s worst case (30 + 20) | - |
| Mempool | `/daemon/getmempoolinfo` (64 B), `/daemon/getrawmempool/true` (2.3 KB for 7 txs) | small | 0.3 to 0.44 s | 20 s daemon cache | Shows fee-0 fluxnode confirm txs and app-payment txs before they are mined |
| Pending app messages | `/apps/temporarymessages` | 12.8 KB br | 0.31 s | apicache 5 s only (DB-backed) | App change visible **16 s to 4.7 min before the block** (see 6.3) |
| Installs in progress | `/apps/installinglocations` | 30 B when empty | 0.27 to 0.39 s | 30 s | Empty in both samples |
| Instance locations | `/apps/locations` | 318 KB br / 2.4 MB | 0.76 to 0.87 s | 30 s | See 6.4 |

**Chosen tip detector: poll `getblockhash/<tip+1>` about once per second.** When it succeeds, fetch `getblock/<hash>/2` (block cache keyed by hash, so it is never stale). That gives coinbase payees, the producer and all fluxnode and app txs within about 1 to 3 s of the block. Politeness trade-off: this bypasses FluxOS caching, but it is one tiny RPC per second. Rotate across 3 to 5 healthy nodes (from the node list, preferring stats `fluxinfo` rows without `error`) instead of hammering the load balancer. The owner should sign off on this rate.

### 6.3 Pending (unconfirmed) app registrations and updates
- **Yes, they are exposed.** `/apps/temporarymessages` lists signed `fluxappregister` / `fluxappupdate` messages as soon as the owner broadcasts them, before the payment tx is mined. Each row is `{appSpecifications, type, version, hash, timestamp (owner-signed ms), signature, receivedAt, expireAt (receivedAt + 1 h), arcaneSender}`.
- **Measured on 13 messages:**
  - The owner's signature `timestamp` to this node's `receivedAt` took 1.2 to 5.9 s (gossip propagation). One outlier showed -23.7 s, from signer clock skew.
  - `receivedAt` to the block containing the payment took 15.7 s to 281.6 s, **median about 168 s**, across 11 mined messages.
  - **2 of 13 were never mined** (still unpaid 35+ min later). They show up as "pending" and then expire after 1 h. Only show them as pending, never as deployed.
- **Promotion to permanent:** watch blocks for OP_RETURN outputs to the app address (4.4.3) and match them to the pending `hash`. The pending item then becomes a confirmed deploy.
- The mempool also shows the payment tx (an OP_RETURN to `t3NryfAQ…`) before mining, but the temp message arrives earlier and carries the spec, so the mempool adds little here.

### 6.4 App-instance changes (spawn and removal)
Mechanics, from `appMessaging/peerNotification.js`, `messageStore.js`, `appConstants.js` and `config/default.js`:
- **Spawn.** When an install completes, the node broadcasts `fluxapprunning` immediately (`setOnInstallComplete` calls `checkAndNotifyPeersOfRunningApps`). Peers upsert a location row with `broadcastedAt`, `runningSince` and `expireAt = broadcastedAt + 7,500 s`.
- **Heartbeat.** Every node re-announces all its running apps every `floor(7500 × 0.96 / 2)` = **3,600 s**. Measured row ages ran from 0 to 60 min, spread evenly, and a few reached up to 115 min.
- **Explicit removal.** `fluxappremoved` deletes the row immediately (`findOneAndDeleteInDatabase`). The message is accepted for 65 min after `broadcastedAt`.
- **Node clean shutdown.** `fluxnodesigterm` makes peers drop the node's rows after a 420 s grace.
- **Crash or network loss.** The row lingers until `expireAt`, up to 125 min.
- **IP change.** `fluxipchanged` rewrites the rows.
- **In progress.** `fluxappinstalling` rows appear in `/apps/installinglocations` (TTL 900 s). Failures appear in `/apps/installingerrorslocations`.

Measured diff of `/apps/locations` 67 s apart (20:15:40 and 20:16:47): 8,277 rows became 8,276, with 0 added, 1 removed (`mscopy002` on `219.117.251.150:16197`, an explicit removal well before its `expireAt`), 363 refreshed `broadcastedAt`, and 0 hash changes.

**Fastest detection:**
- Diff `/apps/locations` every 60 s (after the 30 s apicache), keyed on `(name, ip)`:
  - a new key, or a `runningSince` within the last few minutes, means a spawn
  - a missing key means removal or expiry
  - a changed `hash` means a rolling update
- Expected delay is 30 to 90 s, at about 450 MB/day at a 60 s interval (318 KB br each). Use 120 s for about 225 MB/day.
- `/apps/installinglocations` every 10 s (30 B) gives an earlier "installing" signal.
- To follow one app closely (e.g. the one a user is looking at), poll `/apps/location/<name>` (0.9 KB) every 5 to 10 s.
- **Crashes cannot be detected faster than 60 to 125 min** through this data. Only a direct probe of the node (`/apps/listrunningapps`) can tell sooner.

### 6.5 Node lifecycle from blocks (no full-list refetch)
Every node state change is a **v5 fluxnode transaction in a block** (see fluxd `rpc/rawtransaction.cpp` `TxToJSON`; fixtures `daemon_getblock_2996861_verbosity2_fluxnode_start.json`, `daemon_getblock_2996886_verbosity2_fluxnode_initial_confirm.json`, `daemon_getblock_2996900_verbosity2.json`):

| Event | Tx `type` | Distinguishing fields | Notes |
|---|---|---|---|
| **Node started** | `"Starting a fluxnode"` | `collateral` (full), `txhash`, `outidx`, `ip: ""`, `sigtime`, `sig`, `collateral_pubkey` or `redeemscript` (P2SH), `zelnode_pubkey` (base64 node key), optional `fluxnode_upgraded_tx_version`, `using_delegates`, `delegate_data` | The node enters `getstartlist`. The tier comes from the collateral amount, so look up the collateral output |
| **Node confirmed (joined)** | `"Confirming a fluxnode"`, `update_type: 0` | `ip` (with port for UPnP), `benchmark_tier`, `benchmark_sigtime`, `benchmark_sig` | Example: `7d5f19bb…` started at 2,996,879 and confirmed at 2,996,886 (7 blocks) |
| **Heartbeat** | `"Confirming a fluxnode"`, `update_type: 1` | Same fields; `ip` is the current IP | Allowed only after ≥ 500 blocks since the last confirm (`FLUXNODE_CONFIRM_UPDATE_MIN_HEIGHT_V3`) and required within 640 (`…EXPIRATION_HEIGHT_V4`). **Measured: 98.9% of nodes last confirmed ≤ 500 blocks ago, so the heartbeat period is about 500 to 520 blocks (about 4.2 h).** 13 to 16 confirm txs per block observed (6,724 / 500 ≈ 13.4) |
| **IP change** | Confirm tx whose `ip` differs from the stored IP | | Permitted 5 blocks after the previous confirm (`…MIN_HEIGHT_IP_CHANGE_V1`) |
| **Paid** | Coinbase `vout[1..3]` + `fluxnodecurrentwinner` of the previous height | | Exact collateral (see 3.5) |
| **Produced a block** | Header `collateral` (10-hex prefix) + `blocksig` | | See 5.5 |
| **Expired** | *No tx.* Derived: `H - last_confirmed_height > 640` | | Compute it on each block |
| **DOS'd** | *No tx.* Derived: started but not confirmed within 240 blocks, then banned for 720 blocks | | Cross-check with `getdoslist` |
| **Collateral spent** | Any tx whose `vin` spends a node's `txhash:outidx` | | Immediate removal. Needs `vin` from the block ingest (teammate's pipeline) |

The zero-fee confirm txs are also visible in the mempool (`getrawmempool/true`) up to one block early. That is not needed, since blocks arrive every 30 s.

### 6.6 Change detection on the deterministic node list
- **No cheap change detection exists.** There is no list hash, version or "since height" filter.
  - The weak ETag changes every block, because `last_paid_height`, `rank` and `last_confirmed_height` shift.
  - The `:filter` segment is only a substring match on IP or payment address.
  - Responses are up to 50 s stale (apicache 30 s + daemon cache 20 s; cache-busting skips only the first layer).
  - `getfluxnodecount` changes only when totals change.
- **Recommendation:** keep the node list as a **block-driven state machine** built from the events in 6.5, and recompute `rank` locally with the verified rule (3.5). Reconcile against a full `viewdeterministicfluxnodelist` fetch every 10 to 30 min, or whenever `getfluxnodecount` totals disagree with the local state. Log any diff as a bug signal.

### 6.7 Recommended real-time ingestion design

**Within about 1 to 3 s of it happening (block-driven, about 1 req/s):**
- New block: height, hash, time, and producer collateral, joined to the node for a producer arc.
- Three tier payouts, pre-announced one block ahead from `fluxnodecurrentwinner`. Fetch that right after each new tip, and use a cache-busted query string because it is 30 s apicache + 20 s daemon cache.
- Node started, confirmed, heartbeat, IP change and collateral spent, from block txs. Expiry and DOS are derived per block.
- App registration or update *confirmed*: an OP_RETURN in the block, then `permanentmessages?hash=` for the spec and the price paid.

**Within about 5 to 60 s:**
- Pending app deploys and updates: `/apps/temporarymessages` every 5 s (apicache is 5 s; 12.8 KB br, about 220 MB/day at that rate). Poll every 10 to 15 s to halve that. It typically leads the block by about 3 min.
- Installs starting: `/apps/installinglocations` every 10 s.
- Hot-app instance tracking: `/apps/location/<name>` every 5 to 10 s, only for apps on screen.

**Within about 1 to 2 min:**
- Instance spawn, removal and rolling updates network-wide: `/apps/locations` diff every 60 to 120 s.
- Join and DOS queues: `getstartlist` / `getdoslist` every 60 s. These are redundant with block events and serve as a cross-check.

**Within about 15 to 20 min (per stats round):**
- Hardware, benchmarks, versions, ArcaneOS, geolocation, per-node running containers and locked resources: stats `/fluxinfo`, fetched when `roundTime` changes.

**Only through rolling per-node crawls:**
- Peer-overlay topology (`/flux/topology`, about 150 nodes per 30 min sweep) and per-link latency (`/flux/peers`).
- Per-node health (`/flux/health`) and uptime.
- Crash detection faster than the 125 min location TTL (`/apps/listrunningapps`).
- `/flux/info` for nodes that stats marks `error`.
- None of these can be real-time at network scale without thousands of requests.

---

## 7. Recommended ingestion plan

Sizes are brotli-compressed transfer. "Per day" assumes steady state.

| Endpoint | Interval | Rationale | Approx bytes/day |
|---|---|---|---|
| `/daemon/getblockhash/<tip+1>?nc=<ts>` (rotate 3 to 5 healthy nodes) | 1 s | Detect new blocks within about 1 to 3 s; errors are uncached (section 6.2) | 86,400 × 0.1 KB ≈ 8 MB |
| `/daemon/getblock/<h>/2` (shared with explorer ingest) | each new block | Coinbase payees, producer `collateral`, app-message OP_RETURNs | 2,880 × 5 KB ≈ 14 MB |
| `/daemon/fluxnodecurrentwinner?nc=<ts>` | each new block | Exact collateral of the next payees (payment pulses); cache-bust apicache, and treat it as stale if its `last_paid_height` values lag | 2,880 × 1 KB ≈ 2.8 MB |
| `/daemon/getfluxnodecount` | 60 s | Cheap tier-count ticker | 1,440 × 0.2 KB ≈ 0.3 MB |
| `/daemon/getstartlist` + `/daemon/getdoslist` | 60 s | Joins and failures in near real time | 1,440 × 1.1 KB ≈ 1.6 MB |
| `/daemon/viewdeterministicfluxnodelist` | 10 to 30 min reconciliation (state is maintained from block events, section 6.5) | Authoritative registry cross-check | 48 to 144 × 546 KB ≈ **26 to 79 MB** |
| stats `/fluxinfo` (full) | every new `roundTime` (check about 5 min; rounds about 15 to 18 min) | Hardware, versions, ArcaneOS, geo, running apps, locked resources | about 80 × 1.63 MB ≈ **130 MB** (projection variant about 55 MB) |
| stats `/fluxlocation/<ip>` | on demand for IPs with zeroed geo, cached 7 days | Geo backfill | < 200 × 0.2 KB/day |
| stats `/fluxhistorystats` | once at bootstrap, then daily | Backfill 30 days of tier counts | 22 KB |
| `/apps/globalappsspecifications` | 10 min with `If-None-Match`, plus an immediate refresh when an app OP_RETURN appears in a block | Full catalog. Changes arrive through the block feed; this is the reconciliation pass | ≤ 144 × 1.22 MB ≈ 176 MB worst case, typically far less with 304s |
| `/apps/permanentmessages?hash=<h>` | per app OP_RETURN seen in a block (about 20 to 60/day observed) | Exact spec change + price paid | about 60 × 2 KB ≈ 0.1 MB |
| `/apps/permanentmessages` (full) | **once at bootstrap** (7.4 s, 24.5 MB) | Full 6-year spec history | one-off |
| `/apps/locations` | 60 to 120 s (diff on `(name, ip)`) | Instance spawn, removal and rolling updates (section 6.4) | 720 to 1,440 × 318 KB ≈ 225 to 450 MB |
| `/apps/temporarymessages` | 10 s (5 s for the most real-time feel) | Pending deployments, about 3 min ahead of the block | 8,640 × 13 KB ≈ 110 MB (220 MB at 5 s) |
| `/apps/installinglocations` | 10 s | Installs starting | 8,640 × 0.1 KB ≈ 0.9 MB |
| `/apps/installingerrorslocations` | 15 min | Failure heat | 96 × 14 KB ≈ 1.3 MB |
| `/apps/placementlocations`, `/apps/deploymentinformation`, `/apps/registrationinformation` | 1 h | Fault-domain counts, pricing, addresses | < 0.3 MB |
| stats `/marketplace/listapps` | 1 h | Template mapping | 24 × 12 KB ≈ 0.3 MB |
| `/flux/topology` on about 150 rotating reachable nodes | 1 sweep / 30 min at ≤ 2 req/s (75 s per sweep) | Overlay peer graph | 48 × 150 × 10 KB ≈ 72 MB (optional feature) |
| `fluxos-network-policy/iplocation.bin.gz` (raw.githubusercontent) | weekly | Local IP to org/country/region (placement-consistent) | 4.6 MB/week |
| DB-IP City Lite mmdb | monthly | Local lat/lon fallback | about 130 MB/month |

Total steady state is about 0.7 to 1.1 GB/day, dominated by the `/apps/locations` diffing, stats `fluxinfo`, temporary messages and specs. The biggest lever is the `/apps/locations` interval. The node list is cheap, because block events keep it current.

Operational notes:
- Use `Accept-Encoding: br, gzip` always. The enterprise blobs in specs are near-incompressible.
- api.runonflux.io appears pinned to one backend. Give the client a fallback list of healthy nodes (from the node list) that serve the same global endpoints, and compare their `getblockcount` to avoid lagging nodes.
- Parse permissively. Ints are sometimes strings (`outidx`, `activesince`, `lastpaid`, `amount`, v2/v3 ports). Objects are sometimes strings (`apps.fluxusage: "0"`, `daemon/getbenchmarks.data`). There are typos (`explorerScannedHeigth`, `enviromentParameters`). Treat zero placeholders as null.

---

## 8. Feature opportunities

1. **Payment pulses.** Every 30 s, three nodes light up, one per tier: 1, 3.5 and 9 FLUX. They are known *one block ahead* from `fluxnodecurrentwinner`, so the globe can pre-aim a pulse and fire it when the block lands. The ticker could read "Next Stratus payout: Helsinki, in ~12 s".
2. **Block-producer arcs.** Each block is signed by a lottery-selected node (header `collateral`), and the same block pays three other nodes. Draw an arc from the producer to the three payees for a per-block "constellation" moment. Over a day you get a producer heatmap ("which countries mint blocks") and a PoN fairness chart: expected wins ∝ node count vs actual.
3. **Payment-queue visualiser.** Each tier is a ring ordered by `rank`, with a cursor sweeping one slot per block. Cycle times are Cumulus about 28 h, Nimbus about 13 h, Stratus about 15 h. Clicking a node shows "you're #417 in line, paid in about 3.5 h". New nodes enter at the back (`confirmed_height`).
4. **Overlay-network graph.** Rebuild the real peer graph from `/flux/topology` with far fewer calls than a full crawl. Show edges on the globe (latency from `/flux/peers`), flapping links (`/flux/unstablenodes`) and `remoteVersion` upgrade waves spreading through the mesh.
5. **App constellations.** Group each app's instances (`/apps/locations`) as a coloured constellation across the globe, linked back to its marketplace template by name prefix. Instances on an old `hash` glow differently during a rolling update. "Incoming" instances come from `temporarymessages`, and failures come from `installingerrorslocations`.
6. **Live deploy feed.** App OP_RETURN in a block, then `permanentmessages?hash=`, then a toast: "Palworld server updated: 2 instances, Asia (SG, JP, HK…), 12.96 FLUX". Combined with `valueSat` history, this gives network revenue per day or month and per-app lifetime spend.
7. **Spec archaeology.** 70,908 messages since 2020 allow a timeline slider through six years of app history: v1 to v8 adoption, the rise of enterprise (encrypted) apps, Docker image popularity, and custom domains over time.
8. **Decentralisation scorecard.** Measure concentration by ASN, org, country and continent (Nakamoto-style coefficients), matched to FluxOS's own fault domains (`placementlocations` and the policy iplocation table). Show hosting vs residential share (`geolocation.hosting`/`dataCenter`), UPnP multi-node hosts (up to 8 per IP), and operator concentration (ZelID, payment address, pubkey).
9. **Capacity and utilisation.** Compare locked with total CPU, RAM and SSD per tier, country and org: 27% CPU, 16% RAM and 12% disk are locked today. Chart EPS and bandwidth distributions, and "where could a 4-core/12 GB app run right now". Pair this with POST `/apps/placementfeasibility` (untested) for a what-if tool.
10. **Version-adoption waves.** Chart FluxOS, fluxd, fluxbench, ArcaneOS build, Docker and OS versions over time as stacked areas. 8.20.0 reached 97.6% within 5 days of release. Show "stragglers" per operator.
11. **Node churn and lifecycle.** Track start list, then confirmed, then (reconfirm every ≤ 640 blocks), then expiry or DOS, with churn in and out per hour and by country. Show age distribution (`added_height`; the oldest node dates from height 1,268,415) and survival curves. Include DOS events and benchmark failures (`bench.status=failed` with reasons).
12. **Operator views.** Group nodes by ZelID or payment address to show fleet map, earnings per day (queue math), next payouts, hardware mix, apps hosted, and uptime (`flux/uptime`, `osUptime`). Collectors of 400+ nodes become visible "constellations" of their own.
13. **Emission countdown.** The first 10% subsidy cut lands at height 3,071,200 (about 2026-10-26). Show a live countdown and projected tier rewards (0.9 / 3.15 / 8.1).
14. **Screensaver mode.** Show payment pulses, producer arcs, deploy toasts and an ambient mesh shimmer from topology, with a day/night terminator and nodes brightening by timezone (`flux.timezone`).
15. **Health overlays.** Use `/flux/networkhealth` status and `/flux/health` per node (sampled), `dosState` heat, benchmark errors and unreachable nodes (stats `error`) as a network weather map.

---

## 9. Fixtures and raw dumps

Fixtures (`docs/research/fixtures/flux/`, 100 files, about 450 KB total, each under 150 KB) are real responses captured 2026-09-30.
- Small responses are byte-for-byte copies.
- Large arrays were trimmed to at most 25 items, first including one example of every observed variant, with key order and value types preserved and re-serialised compactly:
  - node list: each tier's rank 0, empty-IP, never-paid, compressed pubkey, t3 payee, each UPnP port, default port
  - specs: v2 to v8, enterprise, non-enterprise v8, `datacenter`, `nodes`, `secrets`, `staticip`, domains, multi-component, 100-instance, forbid-geo, sync-mode `containerData`
  - permanent messages: every (type, spec version) pair
  - stats `fluxinfo`: unreachable placeholder, arm64, non-ArcaneOS, failed and running benchmarks, Debian, development, old FluxOS/fluxd, DOS, `systemsecure: false`, each tier
  - marketplace: each key-set variant
- `flux_topology.json` keeps 5 reporters. `stats_fluxhistorystats.json` keeps the first 5 and last 20 points.
- Node-direct samples are prefixed `node_`.
- Block samples with fluxnode lifecycle txs: `daemon_getblock_2996861_verbosity2_fluxnode_start.json` (start tx) and `daemon_getblock_2996886_verbosity2_fluxnode_initial_confirm.json` (`update_type` 0 and 1). The uncached out-of-range error is `daemon_getblockhash_out_of_range.json`.

Full untrimmed dumps for perf testing: `/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/team/raw/flux/`

| File | Size (bytes) | Items |
|---|---|---|
| `apps_permanentmessages.json` | 92,731,209 | 70,908 |
| `stats_fluxinfo.json` | 22,086,661 | 6,723 |
| `apps_hashes.json` | 15,888,373 | 70,997 |
| `stats_fluxinfo_projection_bench.json` | 5,482,197 | 6,723 |
| `daemon_viewdeterministicfluxnodelist.json` | 4,174,883 | 6,724 |
| `stats_fluxinfo_projection_geo.json` | 3,355,693 | 6,723 |
| `apps_globalappsspecifications.json` | 2,525,986 | 1,882 |
| `apps_locations.json` | 2,403,097 | 8,274 |
| `apps_enterprisenodes.json` | 1,014,364 | 2,385 |
| `stats_fluxhistorystats.json` | 160,299 | 2,585 |
| `apps_installingerrorslocations.json` | 120,660 | 322 |
| `flux_topology.json` + 6 × `node_*_flux_topology.json` | 27,148 to 63,068 each | 7 snapshots |
| `probe_log_api.txt`, `probe_log_nodes.txt` | - | Per-request status, latency and size log |

---

## 10. Open questions and unverified items

- **Load balancer behaviour:** is api.runonflux.io sticky per client or single-backend? Every request in this session hit `server20_94.130.137.2`. Its rate limits are also undocumented.
- **Fee handling in PoN coinbase:** the observed totals are exactly 14.0, and where transaction fees go was not traced.
- **IPv6 node IP format:** none exist on chain today, so parsing is untested.
- **Producer resolution for departed nodes:** the 10-hex truncation means historic producers not in our index are ambiguous. Resolving them may need the teammate's explorer data or a full-outpoint source (none found).
- **stats `fluxinfo` provenance:** the stats service is a Flux-team service without public docs. Its cadence (about 15 to 18 min rounds, history every 14.5 min) was inferred from timestamps. Projection behaviour was inferred from tests.
- **"Spec v9 enforcement late October 2026"** (web search summary) is not reflected in FluxOS 8.20.0 source (`latestAppSpecification: 8`). Treat it as unconfirmed.
- **PNR (Progressive Node Rewards):** Flux blog posts say PNR shares FluxCloud revenue with ArcaneOS nodes. No PNR endpoint or on-chain PNR payment was found in FluxOS 8.20.0 routes or in the coinbase. It may be paid off-chain or by separate transactions (teammate's explorer data could show it).
- **HTTPS on apiport+1:** it answered, but certificate validity was not checked.

## Sources
- FluxOS `RunOnFlux/flux` @ `3ca1ab9f` (v8.20.0, 2026-09-25): `ZelBack/src/routes.js`, `ZelBack/config/default.js`, `services/fluxCommunication.js`, `services/utils/FluxPeerManager.js`, `services/enterpriseNodesService.js`, `services/appPlacement/{placementFeasibility,ipLocationStore}.js`, `services/appMessaging/messageVerifier.js`, `services/utils/appSpecHelpers.js`, `services/appDatabase/registryManager.js`, `lib/socketHandlers.js`.
- fluxd `RunOnFlux/fluxd` @ `8a60ee63` (2026-09-08; release v9.1.0): `src/rpc/{blockchain,fluxnode,mining}.cpp`, `src/pon/pon.cpp`, `src/fluxnode/fluxnode.{h,cpp}`, `src/main.cpp` (`GetBlockSubsidy`, `GetFluxnodeSubsidy`), `src/chainparams.cpp`, `src/primitives/transaction.cpp`.
- `RunOnFlux/fluxos-network-policy` @ `286bc3d9` (2026-09-21): README, `iplocation.bin.gz`.
- FluxOS release notes v8.19.0 (PR #1801 "Narrow the node's HTTP surface", `/flux/health`) and v8.20.0.
- Flux announcements: "Forking Flux: Proof of Useful Work v2" (runonflux.com), and RunOnFlux on X about PoN (30 s blocks, per-tier payment every block). Blog posts on Progressive Node Rewards and ArcaneOS.
- stats.runonflux.io dashboard bundle (`/js/index.js`) for `/fluxinfo`, `/fluxhistorystats` and `/marketplace/listapps` usage.
- docs.runonflux.io/fluxapi (stale, v6.6.1).

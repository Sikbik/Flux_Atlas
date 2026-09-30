# Flux Atlas v2: Block Explorer API Research

Status: research, live-probed 2026-09-30 between 19:38 and 19:55 UTC, chain tip about height 2,996,914 to 2,996,940.
Scope: blocks, transactions, addresses, UTXOs, mempool, supply and emission, rich list, node-related transactions, search.
Out of scope, covered by the node/app/network teammate: the full fluxnode list, app specs, benchmarks, geolocation. This doc touches them only where the explorer needs them, for example to attribute payments to nodes.

All facts below describe the upstream APIs as probed. Verification words: `verified` means it worked live on 2026-09-30 with the shape shown; `partial` means it works with caveats; `failing` means it errored or is gone; `untested` means it comes from source or docs only.

Fixtures are in `docs/research/fixtures/explorer/` and are listed in section 10. Raw dumps, the probe log (`probe_log.tsv`, one line per request with status, latency, size and CORS), the explorer JS bundle, and the fluxd source excerpts are in
`/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/team/raw/explorer/`.

---

## 0. Key findings (read this first)

1. **The official explorer is a new React/Vite SPA on top of a bitcore-node Insight API.** `https://explorer.runonflux.io` serves `window.apiPrefix = '/api'`, and its bundle (`assets/index-B9InpKTW.js`) calls about 35 Insight-style endpoints plus a socket.io v2 (EIO=3) push channel. The API has `Access-Control-Allow-Origin: *`, sits behind Cloudflare, and sends no rate-limit headers. Two identical mirrors exist: `explorer2.runonflux.io` and `explorer.flux.zelcore.io`.
2. **The chain moved to Proof of Node (PoN, "PoUW v2") at height 2,020,000 on 2025-10-25 at about 18:00 UTC.** That was fluxd v9.0.0; nodes now run v9.1.0 (`version` 9010050). There is no GPU mining. Blocks come every 30 s and the reward is 14 FLUX. Every PoN block header carries the **producer node's collateral outpoint** and a **block signature** (block `version` 100).
3. **Every PoN coinbase has exactly 4 outputs:** the dev fund `t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA` gets 0.5 FLUX plus all tx fees, one Cumulus payee gets 1.0, one Nimbus payee gets 3.5, and one Stratus payee gets 9.0. **The producer node gets no extra reward.** Insight's `minedBy` field on PoN blocks is just the Stratus payee (the last output), not the producer. Do not label it "miner".
4. **The first 10% emission cut is at height 3,071,200.** At 30 s blocks that is about 2026-10-26, roughly 26 days after this research. The reward drops from 14 to 12.6 FLUX, and the tier split stays proportional. After that the reward falls 10% every 1,051,200 blocks, for up to 20 cuts.
5. **Fluxnode start/confirm txs (v5/v6) have no vin/vout**, so no address index covers them. No public API gives "all node txs for collateral X". v2 must build that history by scanning blocks itself. It is cheap: about 10 to 20 such txs per block.
6. **The best way to know which node was paid in block H** is to read the coinbase payee addresses and match them against the deterministic node list (`last_paid_height == H`, same tier, same `payment_address`). `last_paid_height` is overwritten on each payment, so we must record the attribution at ingest time. Addresses alone are ambiguous: one payment address (`t1erTe9...`) belongs to 180 nodes.
7. **Real-time is solved by push.** The Insight socket.io `inv` room delivers new blocks a median 0.94 s after the header time, and every mempool tx (about 23/min). One FluxOS `getblock/{hash}` call (about 160 ms, about 10 KB) then yields all decoded Flux semantics for the block. FluxOS gateway polling is 30 s-cached and lagged about 27 s. See section 6.

---

## 1. Sources discovered

| Source | Base URL | Software | CORS | Notes |
|---|---|---|---|---|
| Official explorer API | `https://explorer.runonflux.io/api` | bitcore-node + insight-api (`/api/version` returns `1.3.0`; `/api/sync` returns `type: "bitcore node"`), Flux-patched | `*` | Cloudflare in front. Decodes fluxnode tx fields and PoN block fields. Also has statistics, rich list, supply, price, and socket.io push. |
| Explorer mirrors | `https://explorer2.runonflux.io/api`, `https://explorer.flux.zelcore.io/api` | same | `*` | Both at the same tip. explorer2 reported daemon `9000650` (v9.0.6) versus the main one's `9010050`. Useful for failover. |
| FluxOS public gateway | `https://api.runonflux.io` | FluxOS (reports `/flux/version` = `8.20.0`), behind a load balancer | `*` (plus `access-control-expose-headers: *`) | Sends a `fluxnode: server20_94.130.137.2` response header naming the backend node. The backend looked sticky across 5 sequential calls. Envelope is `{status, data}`, and **errors come back as HTTP 200** with `status:"error"`. |
| Blockbook | `https://blockbook.runonflux.io/api/v2` | Blockbook 0.6.0 (backend reports `version: "zebra"`) | **none** (server-side use only) | Its `about` field says: "Blockbook - blockchain indexer for Trezor Suite ... Do not use for any other purpose." Treat it as a best-effort fallback only. It does **not** decode fluxnode txs (they show as empty vin/vout plus hex), and its mempool showed 0 while the daemon showed 20. |
| CoinGecko | `https://api.coingecko.com/api/v3` | public | `*` | Coin id is `zelcash`. The official explorer uses it for price history. |
| stats.runonflux.io | `https://stats.runonflux.io/fluxhistorystats` | Flux stats service | not probed by me | The official explorer uses it for "nodes by tier (30d)". The node teammate owns it. |

Not found or dead: `explorer.zel.network`, `explorer.zelcash.online`, `explorer.zelcore.io`, `blockbookflux.zelcore.io`, `flux.blockbook.zelcore.io` (DNS failure or timeout). `/explorer/fluxtxs` on FluxOS is documented at docs.runonflux.io/fluxapi/explorer but **returns 404 live and is absent from `routes.js` on master**, so it is `failing`.

### Rate limits
- **Insight (explorer.runonflux.io):** no `RateLimit-*` or `Retry-After` headers seen, and no limit documented. We stayed at 2 req/s or less and never got throttled. Cloudflare may challenge bursts. **Limit: unknown.** Assume a budget of 5 req/s or less from our backend.
- **FluxOS gateway:** no HTTP rate-limit headers. The FluxOS source has `lruRateLimit(ip, 20/s)`, but that is used for websockets and peer messages. **HTTP limit: unknown.** Many routes set their own `cache-control: max-age<=30` through an apicache `cache('30 seconds')` middleware, so identical calls within 30 s are served from cache.
- **Blockbook:** none observed. It is not meant for third-party use, per its own banner.
- **CoinGecko keyless public API:** documented historically at about 5 to 15 calls/min, and responses carry `cache-control: max-age=30, s-maxage=60`. A free Demo key gives about 30 calls/min and 10k calls/month. **These are CoinGecko's published figures from memory, not verified today.** Poll at most once per 60 s from the backend.

---

## 2. Capability to source matrix

Latencies are single cold samples from this host (Miami Cloudflare POP) and are indicative only.

| Capability | Best source | Fallback | Latency / size | Pagination | Notes |
|---|---|---|---|---|---|
| Latest blocks list | Insight `GET /api/blocks?limit=N` | FluxOS `getblockcount` + `getblock/{h}/1` per block | 270 ms / 2.7 KB for 10 | `blockDate=YYYY-MM-DD` + `startTimestamp` cursor (`pagination.moreTs`) | Gives height, hash, time, size, txlength and minedBy. It does **not** give the producer collateral; that needs `/api/block/{hash}`. Live updates come from socket.io `block` events. |
| Block by height | Insight `GET /api/block-index/{h}` then `/api/block/{hash}` (2 calls) | FluxOS `GET /daemon/getblock/{h}` (1 call; accepts height or hash) | 250 ms + 260 ms; FluxOS 360 to 430 ms / 8 to 15 KB | n/a | FluxOS `getblock/{h}` defaults to verbosity 2, which returns **all txs decoded** (fluxnode fields included) in one call. `getblock/{h}/1` returns txids only. |
| Block by hash | Insight `GET /api/block/{hash}` | FluxOS `getblock/{hash}`, `getblockheader/{hash}` (844 B) | 260 ms / 2 KB | Insight tx list: `GET /api/txs?block={hash}&pageNum=N`, **10 txs/page**, `pagesTotal` | Insight adds `isPON`, `blockType`, `nodesCollateral{hash,index}`, `blockSignature`, `reward`, `minedBy`. |
| Tx by id, decoded with input values and addresses | Insight `GET /api/tx/{txid}` | Blockbook `/api/v2/tx/{txid}` (values in sat strings; no fluxnode decode); FluxOS `getrawtransaction/{txid}/1` (**no input values or addresses**) | 250 to 500 ms / 1 to 2 KB | n/a | Insight gives `vin[].addr/value/valueSat`, `vout[].spentTxId/spentHeight`, `fees`, `valueIn/valueOut`, and fluxnode fields. Works for mempool txs (`blockheight: -1`). |
| Address summary | Insight `GET /api/addr/{a}/?noTxList=1` | FluxOS `getaddressbalance/{a}` (balance+received only, sat); Blockbook `/api/v2/address/{a}?details=basic` | 250 ms small; **4.7 s cold for an 80k-tx address** / 0.3 KB | n/a | Fields: balance, totalReceived, totalSent (FLUX + Sat), unconfirmedBalance, `txApperances` (sic). |
| Address tx history | Insight `GET /api/addrs/{a}/txs?from=X&to=Y` | Insight `GET /api/txs?address={a}&pageNum=N` (10/page); Blockbook `/api/v2/address/{a}?page=N&pageSize=M&details=txs`; FluxOS `getaddresstxids/{a}/{start}/{end}` (txids by height range) | 290 ms for 5 txs / 16 KB; 620 ms for 60 / 166 KB | offset `from`/`to` (60 worked; stock Insight caps at 50) with `totalItems`; or `pageNum` with `pagesTotal` | Newest first. Fully decoded txs. Accepts comma-separated addresses. |
| Address UTXOs | Insight `GET /api/addr/{a}/utxo` | FluxOS `getaddressutxos/{a}`, Blockbook `/api/v2/utxo/{a}` | 250 ms small; 435 ms / 137 KB for a large operator | **none**: full list | Insight includes `coinbase: true/false` and confirmations. Large node operators have thousands of UTXOs. |
| Address balance history | Blockbook `GET /api/v2/balancehistory/{a}?from=&to=&groupBy=86400` | our own index | 290 ms / 3.4 KB | time range | Per-bucket received/sent/sentToSelf in sat. The only source for balance-over-time charts. No CORS. |
| Mempool | FluxOS `GET /daemon/getrawmempool/true` (size, fee, time, height, depends) + Insight `/api/tx/{txid}` per tx | socket.io `inv` `tx` events; FluxOS `getmempoolinfo` | 380 ms / 3.5 KB for 20 txs | none | Insight has **no** mempool list endpoint; the official explorer's "Live transactions" page is socket-only. The Flux mempool is tiny, 10 to 20 txs, almost all fluxnode confirms. |
| Network/sync status | Insight `/api/sync`, `/api/status?q=getInfo`, `/api/status?q=getLastBlockHash` | FluxOS `getblockchaininfo`, `getinfo`, `getbestblockhash` | 250 to 460 ms | n/a | FluxOS `getblockchaininfo` also has `valuePools` (shielded pool totals) and `size_on_disk`. |
| Supply (total / circulating / max) | FluxOS `GET /daemon/gettxoutsetinfo` (`total_amount`, transparent) + `getblockchaininfo.valuePools` (shielded) | Insight `/api/statistics/circulating-supply?format=object`; socket.io `info.supply` | **3.1 s** / 312 B | n/a | Max is **not** served by any API; see section 5. Insight `total-supply` returns the circulating value under the key `circulatingSupply` (a bug). |
| Rich list | Insight `GET /api/statistics/richest-addresses-list` | none | 560 ms / 90 KB | none (fixed 1000 rows) | `{address, blocks_mined, balance}`. Also `/statistics/richer-than` (USD thresholds) and `/statistics/balance-intervals` (histogram). |
| Charts/stats | Insight `GET /api/statistics/{supply,transactions,fees,outputs,difficulty,network-hash}?days=N` (N in 30,60,180,365,730,all) | our own index | 370 to 700 ms for 30d; **16 s for `network-hash?days=all`** | none | Daily series, newest first. `difficulty` and `network-hash` are PoW-era concepts and are near-meaningless under PoN. |
| Per-day "pools" (payee share) | Insight `/api/statistics/pools[?date=]`, `/statistics/pools-last-hour`, `/statistics/total` | n/a | 270 ms / 28 KB | per day | Under PoN these count `minedBy` (Stratus payee) addresses, not producers. |
| Price | Insight `GET /api/markets/info` (price, price_btc, market_cap_usd, total_volume_24h, delta_24h) + socket `markets_info` | CoinGecko `simple/price?ids=zelcash` | 300 ms | n/a | This is a **Flux-provided** price. Its upstream is probably CoinGecko or CMC, which is unverified. History: CoinGecko `coins/zelcash/market_chart`. |
| Producer node of block | Insight `/api/block/{hash}.nodesCollateral` or FluxOS `getblock` `.collateral` (short form) | n/a | as block | n/a | Resolve it to a node with FluxOS `viewdeterministicfluxnodelist/{collateralTxid}`. |
| Paid nodes of block | coinbase vouts + node list (`last_paid_height`) | FluxOS `fluxnodecurrentwinner` (next winners) | n/a | n/a | See section 5.3. |
| Address to owned nodes | FluxOS `GET /daemon/viewdeterministicfluxnodelist/{address}` (substring filter) | Insight `/api/status?q=getFluxNodes` (4.2 MB, full list) | 760 ms / 114 KB for 180 nodes | none | The filter matches on payment address, IP, or collateral txid. |
| Live push | Insight socket.io `wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket`, room `inv` (block seen 0.94 s median after header time) | Blockbook WS `subscribeNewBlock` (3.1 s); Insight poll `getLastBlockHash` every 2 s (2.5 s). **Not** FluxOS polling (27 s, due to the 30 s cache) | about 1 frame/2 s | n/a | Events: `tx` (every mempool tx), `block` (hash), `info` (getInfo + miningInfo + supply), `markets_info`. Room `bitcoind/addresstxid` with `[address]` gives per-address pushes (untested). |

---

## 3. Endpoint catalog

Legend: **V** is the verification state (`verified` / `partial` / `failing` / `untested`, all dated 2026-09-30). Sizes and latencies are from the probe log.

### 3.1 Insight API: `https://explorer.runonflux.io/api`

All responses are plain JSON with no envelope. Errors are HTTP status plus a text body (`404 "Not found"`, `400 "Invalid address: ... Code:1"`, `400 "Block height out of range. Code:-8"`). Amounts: `vout[].value` is a **string** in FLUX ("0.50000000"), `vin[].value` is a number in FLUX, and `*Sat` fields are integers.

| Method + path | Params | V | Latency / size | Response shape (trimmed) |
|---|---|---|---|---|
| `GET /status?q=getInfo` | | verified | 450 ms / 254 B | `{info:{version:9010050, protocolversion:170021, blocks, connections, difficulty, relayfee, network:"livenet", reward:937500000}}`. `reward` is a stale PoW-formula value in sat; ignore it. |
| `GET /status?q=getLastBlockHash` | | verified | 250 ms / 165 B | `{syncTipHash, lastblockhash}` |
| `GET /status?q=getMiningInfo` | | verified | 260 ms / 75 B | `{miningInfo:{difficulty, networkhashps}}` |
| `GET /status?q=getPeerInfo` | | untested | | used by the explorer's /network page |
| `GET /status?q=getFluxNodes` | | verified | 1.1 s / **4.2 MB** | `{fluxNodes:[{collateral, txhash, outidx, ip, network, added_height, confirmed_height, last_confirmed_height, last_paid_height, tier, payment_address, pubkey, activesince, lastpaid, amount, rank}]}` (6,722 nodes). Same as the daemon's `viewdeterministicfluxnodelist`. |
| `GET /sync` | | verified | 460 ms / 121 B | `{status:"finished", blockChainHeight, syncPercentage, height, error, type:"bitcore node"}` |
| `GET /version` | | verified | 250 ms | `{version:"1.3.0"}` |
| `GET /peer` | | verified | 290 ms | `{connected:true, host:"127.0.0.1", port:null}` |
| `GET /blocks` | `limit`, `blockDate=YYYY-MM-DD`, `startTimestamp` | verified | 270 ms / 2.7 KB (10) | `{blocks:[{height, size, hash, time, difficulty, txlength, poolInfo:{}, isMainChain, minedBy}], length, pagination:{next, prev, currentTs, current, isToday, more, moreTs}}` |
| `GET /block/{hash}` | hash only (height gives 404) | verified | 260 ms / 2 KB | `{hash, size, height, version:100, merkleroot, tx:[txid...], time, bits, difficulty (scaled x10^7 vs the daemon; do not use), chainwork, confirmations, previousblockhash, nextblockhash, reward:14, isMainChain, minedBy, poolInfo, isPON:true, blockType:"Proof of Node", nodesCollateral:{hash, index}, blockSignature}`. PoW blocks have `blockType:"Proof of Work"`, `nonce`, `solution`, and no `nodesCollateral`. |
| `GET /block-index/{height}` | | verified | 250 ms / 80 B | `{blockHash}`; returns `400 "Block height out of range. Code:-8"` past the tip |
| `GET /rawblock/{hash}` | | untested | | stock Insight |
| `GET /txs?block={hash}&pageNum={n}` | | verified | 350 to 450 ms / 6 to 9 KB | `{pagesTotal, txs:[tx...]}`, 10 per page |
| `GET /txs?address={a}&pageNum={n}` | | verified | 280 to 830 ms / 17 to 29 KB | `{pagesTotal, txs:[tx...]}`, 10 per page, newest first |
| `GET /addrs/{a[,b,...]}/txs` | `from`, `to` | verified | 290 ms (5) to 620 ms (60 / 166 KB) | `{totalItems, from, to, items:[tx...]}` |
| `GET /addrs/{a[,b]}/utxo` | | untested | | stock Insight multi-address UTXO |
| `GET /tx/{txid}` | | verified | 250 to 780 ms / 0.7 to 2 KB | see section 5 for all 3 shapes (regular, coinbase, fluxnode) |
| `GET /rawtx/{txid}` | | verified | 270 ms | `{rawtx:"hex"}` |
| `POST /tx/send` | `{rawtx}` | untested (write) | | broadcast |
| `GET /addr/{a}` | `noTxList=1`, `from`, `to` | verified | 250 ms to 4.7 s | `{addrStr, balance, balanceSat, totalReceived, totalReceivedSat, totalSent, totalSentSat, unconfirmedBalance, unconfirmedBalanceSat, unconfirmedTxApperances, txApperances, transactions:[txid x up to 1000]}` |
| `GET /addr/{a}/balance` / `totalReceived` / `totalSent` / `unconfirmedBalance` | | verified (first two) | 240 ms / 15 B | bare integer in sat |
| `GET /addr/{a}/utxo` | | verified | 250 to 435 ms | `[{address, txid, vout, scriptPubKey, amount, satoshis, height, confirmations, coinbase}]` |
| `GET /utils/estimatefee` | `nbBlocks` | verified | 280 ms | `{"2":-1}` (no estimate; fees are tiny) |
| `GET /currency` | | verified | 240 ms | `{status:200, data:{rate:0.0747, short:"FLUX"}}` (USD rate) |
| `GET /markets/info` | | verified | 300 ms | `{price, price_btc, market_cap_usd, total_volume_24h, delta_24h}` |
| `POST /messages/verify` | `{address, signature, message}` | untested | | |
| `GET /statistics/total` | | verified | 280 ms / 29 KB | last-24h rollup: `{n_blocks_mined:2881, time_between_blocks:29.98, mined_currency_amount (sat), transaction_fees, number_of_transactions, outputs_volume, difficulty, network_hash_ps, blocks_by_pool:[{address, poolName:"Unknown", url, blocks_found, percent_total}]}` |
| `GET /statistics/pools` | `date=YYYY-MM-DD` | verified | 270 ms / 28 KB | `{date, n_blocks_mined, blocks_by_pool:[...]}` |
| `GET /statistics/pools-last-hour` | | verified | 280 ms / 5 KB | `{n_blocks_mined:122, blocks_by_pool:[...]}` |
| `GET /statistics/{type}` | `days` = 30/60/180/365/730/all; type = `supply`, `transactions`, `fees`, `outputs`, `difficulty`, `network-hash` | verified | 370 ms to 16 s | `supply`: `[{date, sum:"430655620.5"}]`; `transactions`: `[{date, transaction_count, block_count}]`; `fees`: `[{date, fee}]` (avg per tx); `outputs`: `[{date, sum}]` |
| `GET /statistics/richest-addresses-list` | | verified | 560 ms / 90 KB | `[{address, blocks_mined, balance}]` x 1000 |
| `GET /statistics/richer-than` | | verified | 230 ms | `[{amount_usd, count_addresses}]` |
| `GET /statistics/balance-intervals` | | verified | 270 ms | `[{min, max, count, sum}]` |
| `GET /statistics/circulating-supply` | `format=object` | verified | 240 ms | `{"circulatingSupply":"420590294.4991484"}` or a bare number |
| `GET /statistics/total-supply` | `format=object` | partial | 250 ms | returns the **same value and key as circulating** (bug) |

**Socket.io (EIO=3, socket.io v2)** at `wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket`. The polling handshake echoes the Origin in ACAO. Send `42["subscribe","inv"]`. A 75 s capture (`insight_socketio_inv_capture.json`) had 38 `tx`, 3 `block`, 3 `info`, and 1 `markets_info` frames.
- `tx`: `{txid, valueOut, vout:[{addr: sat}], isRBF}`. Fluxnode txs show up with empty vout.
- `block`: `"<hash>"`
- `info`: `{info:{...getInfo}, miningInfo:{...}, supply:"430655732.5"}`
- `markets_info`: same as `/markets/info`
- The address room is `emit('subscribe','bitcoind/addresstxid',[addr])` and yields events `{address, txid}` (from the bundle; untested).
- Keepalive: client sends `2` every 25 s or less, server answers `3`.

### 3.2 FluxOS gateway: `https://api.runonflux.io`

Envelope is `{"status":"success","data":...}`, or `{"status":"error","data":{code,name,message}}` **with HTTP 200**. Always check `status`. Amounts in daemon RPCs are FLUX numbers plus `valueZat`/`valueSat` on vouts. Source of truth: `ZelBack/src/routes.js` (master). Everything below is public (unauthenticated) unless marked.

| Method + path | V | Latency / size | Notes / shape |
|---|---|---|---|
| `GET /daemon/getinfo` | verified | 460 ms | `{version, protocolversion, blocks, connections, difficulty, relayfee, ...}` |
| `GET /daemon/getblockchaininfo` | verified | 385 ms / 1.3 KB | `{chain, blocks, headers, bestblockhash, difficulty, verificationprogress, chainwork, size_on_disk, commitments, valuePools:[{id:"sprout"/"sapling", chainValue, chainValueZat}], softforks, upgrades, consensus}` |
| `GET /daemon/getblockcount` | verified | 360 ms / 35 B | `data: 2996915` |
| `GET /daemon/getbestblockhash` | verified | 360 ms | `data: "<hash>"` |
| `GET /daemon/getblockhash/{height}` | verified | 360 ms | `data: "<hash>"` |
| `GET /daemon/getblock/{hashOrHeight}/{verbosity?}` | verified | 360 to 690 ms / 8 to 78 KB | default verbosity is 2 (full txs); `/1` gives txids. Fields: `hash, confirmations, size, height, version, merkleroot, finalsaplingroot, tx[], time, type:"PON"/"POW", collateral:"COutPoint(6d12b8f9ac, 0)" (short txid), blocksig, bits, difficulty, chainwork, anchor, valuePools[] (with valueDelta), previousblockhash, nextblockhash`. **Cheapest single call for block ingest.** |
| `GET /daemon/getblockheader/{hash}/{verbose?}` | verified | 370 ms / 844 B | same header fields incl. `type`, `collateral`, `blocksig`. Error: `{"status":"error","data":{"code":-5,"message":"Block not found"}}` |
| `GET /daemon/getblockdeltas/{hash}` | verified | 370 ms / 2.8 KB | `{..., deltas:[{txid, index, inputs:[{address, satoshis, index, prevtxid, prevout}], outputs:[{address, satoshis, index}]}]}`. Gives **input addresses and values for a whole block in one call** (needs addressindex/spentindex, which the gateway nodes have). |
| `GET /daemon/getblockhashes/{high}/{low}` | untested | | timestamp-range to hashes |
| `GET /daemon/getblocksubsidy/{height}` | verified | 360 ms | `{miner:14}`. The whole PoN subsidy is labelled "miner". |
| `GET /daemon/getrawtransaction/{txid}/1` | verified | 360 to 380 ms / 1 to 2 KB | Decoded tx; **vin has only `txid/vout`**, no values or addresses. Fluxnode txs come back decoded (see section 5). Not found: `code -5 "No information available about transaction"`. |
| `GET /daemon/decoderawtransaction/{hex}` | untested | | |
| `GET /daemon/getrawmempool/{verbose?}` | verified | 380 to 480 ms | `data: [txid]` or `{txid:{size, fee, time, height, startingpriority, currentpriority, depends}}` |
| `GET /daemon/getmempoolinfo` | verified | 380 ms | `{size, bytes, usage}` |
| `GET /daemon/gettxout/{txid}/{n}/{includemempool?}` | verified | 395 ms | `{bestblock, confirmations, value, scriptPubKey{asm,hex,reqSigs,type,addresses}, version, coinbase}`; `data: null` if spent. **Cheapest "is this collateral still unspent" check.** |
| `GET /daemon/gettxoutsetinfo` | verified | **3.1 s** | `{height, bestblock, transactions, txouts, bytes_serialized, hash_serialized, total_amount}`. Cache it for at least 10 min. |
| `GET /daemon/getspentinfo/{txid}/{index}` | verified | 365 ms | `{txid, index, height}` of the spending tx |
| `GET /daemon/getaddressbalance/{addr}` | verified | 430 ms | `{balance, received}` in sat (no `sent`; compute received minus balance) |
| `GET /daemon/getaddresstxids/{addr}/{start?}/{end?}` | verified | 385 ms | `[txid]` ascending in a height range. Without a range it returns **all** txids (can be MBs). |
| `GET /daemon/getaddressdeltas/{addr}/{start}/{end}/{chaininfo?}` | verified | 390 ms | `[{address, blockindex, height, index, satoshis (+/-), txid}]`. `end` beyond the tip gives `code -5 "Start or end is outside chain range"`. |
| `GET /daemon/getaddressutxos/{addr}` | verified | 820 ms / 230 KB | `[{address, txid, outputIndex, script, satoshis, height}]`, unpaginated |
| `GET /daemon/getaddressmempool/{addr}` | verified | 360 ms | `[]` or mempool deltas |
| `GET /daemon/validateaddress/{addr}` | verified | 366 ms | `{isvalid, address, scriptPubKey, isscript}` |
| `GET /daemon/zvalidateaddress/{zaddr}` | untested | | for zs/zc addresses |
| `GET /daemon/fluxnodecurrentwinner` | verified | 375 ms / 1 KB | `{"CUMULUS Winner":{collateral, ip, added_height, confirmed_height, last_confirmed_height, last_paid_height, tier, payment_address}, "NIMBUS Winner":{...}, "STRATUS Winner":{...}}`: who gets paid **next** |
| `GET /daemon/getfluxnodecount` | verified | 480 ms | `{total:6722, stable, cumulus-enabled:3376, nimbus-enabled:1582, stratus-enabled:1764, ipv4:2384, ipv6:0, onion:0}` plus legacy `basic/super/bamf` aliases |
| `GET /daemon/viewdeterministicfluxnodelist/{filter?}` | verified | 405 to 760 ms | node list. `filter` does a substring match on collateral txid, IP, or payment address. Owned by the node teammate. |
| `GET /daemon/getpeerinfo`, `getnettotals`, `getnetworkinfo`, `getmininginfo`, `getdifficulty`, `getchaintips` | untested | | exist in routes |
| `GET /explorer/balance/{addr}` | verified | 480 ms | `data: <sat>` (FluxOS's own Mongo index) |
| `GET /explorer/transactions/{addr}` | partial | 1.3 s / **2.5 MB** | `[{txid}]`, entire history, unpaginated. Do not use. |
| `GET /explorer/utxo/{addr}` | verified | 790 ms / 250 KB | `[{address, txid, vout, height, satoshis, scriptPubKey, confirmations}]` |
| `GET /explorer/scannedheight` | verified | 370 ms | `{generalScannedHeight}` |
| `GET /explorer/issynced` | verified | 370 ms | `data: true` (docs say it needs User auth; live it was public) |
| `GET /explorer/fluxtxs/{filter}` | failing | 404 | documented, removed |

### 3.3 Blockbook: `https://blockbook.runonflux.io/api/v2` (no CORS; fallback only)

| Path | V | Notes |
|---|---|---|
| `GET /api/v2` | verified | `{blockbook:{coin:"Flux", bestHeight, inSync, mempoolSize, ...}, backend:{blocks, bestBlockHash, version:"zebra", consensus}}` |
| `GET /block/{heightOrHash}?page=` | verified | 1000 txs/page. Txs carry `vin[].addresses/value` (sat strings) and `vout[]`. No PoN fields. |
| `GET /block-index/{h}` | verified | `{blockHash}` |
| `GET /tx/{txid}` | verified | `{txid, version, vin, vout, blockHash, blockHeight, confirmations, blockTime, size, value, valueIn, fees, hex}`. Fluxnode tx: empty vin/vout, hex only. Not found: `400 {"error":"Transaction '...' not found"}`. |
| `GET /address/{a}?page=&pageSize=&details=basic/txids/txs` | verified | `{page, totalPages, itemsOnPage, address, balance, totalReceived, totalSent, unconfirmedBalance, unconfirmedTxs, txs, transactions}` |
| `GET /utxo/{a}` | verified | `[{txid, vout, value, height, confirmations}]` |
| `GET /balancehistory/{a}?from=&to=&groupBy=` | verified | `[{time, txs, received, sent, sentToSelf}]` |
| `GET /estimatefee/{n}` | verified | `{result:"-1"}` |
| `GET /tickers` | failing | `400 No tickers found!` |

### 3.4 CoinGecko

| Path | V | Notes |
|---|---|---|
| `GET /api/v3/simple/price?ids=zelcash&vs_currencies=usd,btc&include_24hr_change=true&include_market_cap=true` | verified, 210 ms | `{zelcash:{usd, usd_market_cap, usd_24h_change, btc, ...}}` |
| `GET /api/v3/coins/zelcash/market_chart?vs_currency=usd&days=N&interval=daily` | untested (used by the official explorer) | `{prices:[[ms, usd]], market_caps, total_volumes}` |

---

## 4. Search resolution

### 4.1 Input classes (Flux mainnet)

| Class | Pattern | Notes |
|---|---|---|
| Block height | `^\d{1,8}$` and `<= tip` | Also accept `#123` and thousands separators, stripped. |
| 64-hex | `^[0-9a-fA-F]{64}$` | Can be a **block hash, a txid, or a collateral txid** (collateral is also a txid). |
| Transparent P2PKH | `^t1[1-9A-HJ-NP-Za-km-z]{33}$` | 35 chars base58check, version bytes `1CB8`. |
| Transparent P2SH | `^t3[1-9A-HJ-NP-Za-km-z]{33}$` | version `1CBD`. Used by multisig node collateral (1,422 of 6,722 nodes pay to t3), the dev fund, and the swap pool. |
| Sapling shielded | `^zs1[02-9ac-hj-np-z]{75}$` (bech32, 78 chars) | **Not indexed anywhere public.** Show "shielded address; balances are private". Shielded pool totals come from `valuePools`. |
| Sprout shielded | `^zc[1-9A-HJ-NP-Za-km-z]{93}$` | legacy, same treatment |
| Testnet (`tm`, `t2`) | | reject with "testnet address" |
| Fluxnode IP | IPv4 `a.b.c.d(:port)?`, IPv6 `[...]` | Default port 16127 is often omitted in the list. Multiple nodes share one IP on ports 16127/16137/.../16197. |
| Collateral outpoint | `^[0-9a-f]{64}[:\-_ ,]\d{1,3}$`, or `COutPoint(<64hex>, <n>)` | Normalize to `txid:n`. |
| App name | `^[a-zA-Z0-9]{3,63}$` minus the above | resolve via the node/app teammate's app spec endpoint (untested here) |

### 4.2 Algorithm (cheapest first, local before remote)

```
q = trim(input); strip leading "#", internal spaces/commas in numbers
1. if COutPoint(...) or <64hex>:<n>        -> collateral outpoint
     local node table lookup; else FluxOS viewdeterministicfluxnodelist/<txid>
     (filter on txid, then match outidx); if not active: gettxout/<txid>/<n>
     -> "node (active)" or "collateral output (spent / not a node)"
2. if ^\d+$ and int <= local_tip           -> block height (no network call if the block is in local DB,
                                              else Insight /block-index/{h})
3. if 64-hex:
     a. local DB: blocks.hash, txs.txid, nodes.collateral_txid   (covers the recent window)
     b. if it starts with >= 5 hex zeros -> try block first (PoW-era hashes: 00000017b26f...),
        else try tx first. PoN block hashes have no leading zeros (2c9937766668...), so the
        prefix only helps for heights < 2,020,000.
     c. fire in parallel: Insight /api/tx/{q} and FluxOS /daemon/getblockheader/{q}
        (both ~250-400 ms, both 404/-5 fast on miss). Take whichever succeeds.
        A hash that is both is cryptographically impossible in practice.
     d. if the tx hit has version>=5 or appears as collateral in the node table, link "node" too.
4. if t1/t3 regex -> address (cheap local base58check validation; no call needed to route)
     optional enrichment: FluxOS viewdeterministicfluxnodelist/<addr> -> "owns N nodes"
5. if zs1/zc regex -> shielded notice
6. if IPv4/IPv6(:port)? -> node by IP (local node table; else FluxOS viewdeterministicfluxnodelist/<ip>)
7. else -> app name (local app table, from the teammate's ingest), else fuzzy suggestions
```

Cheapest disambiguators: **the regex classes** (free), then the **local DB** (recent blocks and txs, the full node table), then **one parallel pair of calls** for an unknown 64-hex. Do not use Insight `/addr` to validate addresses: it costs 250 ms to 4.7 s. base58check with the version bytes is local and exact. The official explorer's own search (in its bundle) runs sequentially: 64-hex tries `/block` then `/tx`; digits use `/block-index`; anything else tries `/addr`. It has no IP, collateral, or app support.

---

## 5. Flux transaction anatomy

### 5.1 Consensus facts (from fluxd source, confirmed by live data)

| Fact | Value | Evidence |
|---|---|---|
| PoN activation | height **2,020,000**; block time 1761415235 = **2025-10-25 18:00:35 UTC** | `chainparams.cpp` `UPGRADE_PON.nActivationHeight = 2020000`. Live: block 2,019,999 is `version 4, type POW`; 2,020,000 is `version 100, type PON`. |
| Block time | target **30 s** (`nPonTargetSpacing = 30`); measured 29.98 s avg over 24 h, and 2,868 to 2,878 blocks/day | `/statistics/total`, `/statistics/transactions` |
| Difficulty window | 30 blocks (15 min) | `nPonDifficultyWindow = 30` |
| Block reward | **14 FLUX** (`nPONInitialSubsidy`), cut 10% (`x9/10`, integer sat math) every **1,051,200 blocks** from the activation height, capped at 20 cuts (`nPONMaxReductions`), constant after that | `GetBlockSubsidy()` in `main.cpp` |
| Next cuts | h **3,071,200**: 12.6; h 4,122,400: 11.34; ... ; h 23,044,000 and later: 1.70207313 forever | computed from the source |
| Tier split | Cumulus 1.0 / Nimbus 3.5 / Stratus 9.0 of 14, scaled by the current subsidy. The dev fund gets the remainder: `subsidy - sum(tiers)` = 0.5 **plus all fees** (coinbase checks `>= min`). | `GetFluxnodeSubsidy`, `GetMinDevFundAmount`; live block 2,996,907 dev output is `0.5000003` with a 3e-7 fee tx |
| Dev fund address | `t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA` | `chainparams.cpp` `strDevFundAddress` |
| Emission/day | 14 x 2880 = **40,320 FLUX/day**; `/statistics/total` shows `mined_currency_amount 4033400000000` sat per 24 h | |
| Producer selection | Each confirmed node computes `PONHash = H(collateralOutpoint, prevBlockHash, slot)` with `slot = (time - genesisTime)/30`. It may produce when the hash is below the target (`nBits`). The node signs the header (`vchBlockSig`, not committed to the block hash). On a same-height fork, the lower PON hash wins. **The producer earns nothing extra.** | `pon/pon.cpp`, `main.cpp` |
| Emergency blocks | header collateral `1111...1111:?` (all 1s) is a special emergency path | `emergencyCollateralHash` |
| Pre-PoN (for history) | PoW Equihash (ZelHash), 2-min blocks, subsidy 150 FLUX halved every 655,350 blocks. It was frozen at 37.5 after 2 halvings (h 1,076,532 in Mar 2022, then about Jun 2025). PoW coinbase: miner 18.75 + Cumulus 2.8125 + Nimbus 4.6875 + Stratus 11.25 (block 2,019,999). One-time outputs: foundation 2.5M at h 836,994; swap pool 22M every 21,600 blocks x10 from h 837,714 (`t3ThbWogDoAjGuS6DEnmN1GWJBRbVjSUK4T`, still the #1 rich-list entry at 160M). | `chainparams.cpp`, live block |
| Collateral per tier (current, "V2") | **Cumulus 1,000 / Nimbus 12,500 / Stratus 40,000 FLUX** (V1 was 10,000 / 25,000 / 100,000) | `fluxnode.h` `V2_FLUXNODE_COLLAT_*`; live `amount:"12500.00"` and collateral outputs of 12500 and 40000 |
| Node confirm cadence | an UPDATE_CONFIRM is allowed every 500 or more blocks (`..._MIN_HEIGHT_V3`, about 4 h); the node expires after 640 blocks without one (`..._EXPIRATION_HEIGHT_V4`, about 5.3 h) | `fluxnode.h` |
| Supply cap | **Unclear.** The PoUW v2 announcement says a "new maximum supply cap of 560 million FLUX". The code's `MAX_MONEY = 440,000,000` is only a per-value sanity range (`MoneyRange`), not a cumulative cap. Transparent+shielded supply is already about 430.66M. The subsidy schedule never reaches zero (the 20-cut floor is 1.70 FLUX/block), so no hard cap is enforced in `GetBlockSubsidy`. The schedule sums to about 546M after 20 years, then +1.79M/yr. **Show "max supply 560M (per Flux announcement)" with a footnote. Do not compute it.** | runonflux.com/forking-flux-proof-of-useful-work-v2, `amount.h` |

Supply numbers seen at about h 2,996,925:
- `gettxoutsetinfo.total_amount` (transparent) = **430,557,127.48**
- `valuePools`: sprout 19,291.18 + sapling 77,188.76 (shielded)
- sum = about **430,653,607**. This matches Insight `/statistics/supply` (430,655,620.5 at day end) and socket `info.supply` (430,655,732.5).
- Insight `circulating-supply` = **420,590,294.50**, about 10.07M lower. The exclusion rule is undocumented; it probably excludes some locked or foundation addresses. **Unverified.** Label it "circulating (per explorer)".

Parallel assets: the Flux "Ten Chains Become Two" post says 8 of 10 parallel-asset chains retire. They go one-directional at main-chain block **3,450,000** (March 2027) and shut down at **3,880,000** (August 2027). This matters only if we ever show parallel-asset supply.

### 5.2 Annotated examples (all in fixtures)

**PoN block header**: `insight_block_pon_2996914.json` / `fluxos_daemon_getblock_2996914_verbose.json`
```jsonc
{ "height": 2996914, "version": 100,            // >=100 means PON block
  "type": "PON",                                 // FluxOS; Insight: isPON:true, blockType:"Proof of Node"
  "collateral": "COutPoint(6d12b8f9ac, 0)",      // FluxOS: SHORT txid (10 hex). Use Insight nodesCollateral.hash for the full id
  "nodesCollateral": {"hash":"6d12b8f9ac958776c443063576dd092c79310879d26f6e4ab06a1d541279331e","index":0}, // producer node
  "blocksig": "30450221...",                     // DER ECDSA sig by the producer's node key
  "reward": 14, "minedBy": "t1eEx91Eic..." }     // minedBy = last coinbase output (Stratus payee), NOT the producer
```
The producer collateral `6d12...:0` resolves (via `viewdeterministicfluxnodelist/6d12...`) to a NIMBUS node at `65.109.63.147:16147`, payment address `t1erTe9pzQRnT1J7irwdoMb6kQqPQDvkktA`. That address is **not** among this block's coinbase outputs.

**PoN coinbase**: `insight_tx_coinbase_pon.json`
```jsonc
{ "version": 4, "isCoinBase": true, "vin": [{"coinbase": "03b2ba2d00"}],   // BIP34 height push: 0x2dbab2 = 2996914
  "vout": [
   {"n":0, "value":"0.50000000", "addresses":["t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA"]}, // dev fund (0.5 + fees)
   {"n":1, "value":"1.00000000", "addresses":["t1ZJR468HBuSt1SW2tgWjoxLfYv2yPHgGge"]}, // CUMULUS payee
   {"n":2, "value":"3.50000000", "addresses":["t1UfW786yy3tzNVLnSAYi2zjnoTTmWPZ5Kj"]}, // NIMBUS payee
   {"n":3, "value":"9.00000000", "addresses":["t1eEx91EiciRa2uxTwUvFoyUpy9vmEFiu28"]}], // STRATUS payee
  "valueOut": 14 }
```
Output order was dev, Cumulus, Nimbus, Stratus in every block sampled (2,020,000 and 2,996,900 to 2,996,914). Still, **identify the tier by amount** (1.0 / 3.5 / 9.0 x the reduction factor), not by index. After h 3,071,200 the amounts become 0.9 / 3.15 / 8.1 plus dev 0.45.

**Fluxnode CONFIRM (v5, nType 4)**: `insight_block_txs_page0_2996914.json`, `fluxos_daemon_getrawtransaction_confirm.json`
```jsonc
// Insight field names                           // FluxOS/daemon field names
{ "version": 5, "type": "Confirming a fluxnode", "nType": 4,   // nType bit 0x04 = CONFIRM
  "collateralOutputHash": "d430804ffb85...c7c7", "collateralOutputIndex": 0,   // txhash / outidx
  "sigTime": 1790797114, "sig": "HLT43o...",     // sigtime / sig  (base64 compact sig)
  "ip": "65.108.73.202",                         // ip (port optional)
  "updateType": 1,                               // update_type: 0 = INITIAL_CONFIRM, 1 = UPDATE_CONFIRM (periodic heartbeat)
  "benchmarkTier": "STRATUS",                    // benchmark_tier (int8 on wire: 1/2/3)
  "benchmarkSigTime": 1790795992, "benchmarkSig": "HB7g..." }
// no vin / vout / fee. Size about 200 B. 8 to 20 per block. They make up almost the entire mempool.
```

**Fluxnode START (v5, normal P2PKH collateral, nType 2)**: `insight_tx_fluxnode_start_v5.json`
```jsonc
{ "version": 5, "type": "Starting a fluxnode", "nType": 2,
  "collateralOutputHash": "d649bc5ec3...3bb6", "collateralOutputIndex": 0,
  "collateralPubKey": "Az73SpFM...",             // pubkey owning the collateral (proves ownership)
  "zelnodePubKey"/"fluxnodePubKey": "BPeS04dv...",// node's operational key (later signs confirms and PoN blocks)
  "sigTime": 1790794106, "sig": "H4qB..." }
```

**Fluxnode START (v6 "upgradeable", P2SH/multisig collateral)**: `insight_tx_fluxnode_start_v6_p2sh.json`
```jsonc
{ "version": 6, "type": "Starting a fluxnode", "nType": 2,
  "nFluxNodeTxVersion": 2,                       // daemon: fluxnode_upgraded_tx_version. Bit 0x01 normal, 0x02 P2SH, 0x0100 delegates feature
  "redeemScript": "2 03a2c8... 03a49c... 2 OP_CHECKMULTISIG",  // 2-of-2 multisig collateral (t3 address)
  "fluxnodePubKey": "AileV+0e..." }
```
Delegates (bit 0x0100, allowed only after PoN) add `fUsingDelegates` and `delegateData{nDelegateVersion, nType (UPDATE/SIGNING), delegateStartingKeys[]}`. We saw none live; this is `untested` against a real sample.

**Collateral output**: `insight_tx_collateral_nimbus.json`, `insight_tx_collateral_stratus.json`. It is an ordinary v4 tx paying exactly 1,000 / 12,500 / 40,000 FLUX to the owner address, usually as `vout[0]`. Collateral txs from 2019 (h 1,120,027) are still unspent and active. A collateral is "live" while `gettxout` returns non-null and the node list contains it. Spending it (`spentTxId` set in Insight) ends the node.

**Regular tx**: `insight_tx_regular.json`. Standard Sapling v4 (`fOverwintered`, `nVersionGroupId 0x892F2085`) with `vin[].addr/value`, `vout[].spentTxId`, `fees: 3e-7`.

### 5.3 Attributing payments and production to nodes

- **Producer:** `nodesCollateral` from the block, matched to the node table by `txhash:outidx`. Exact.
- **Paid nodes (one per tier):** the coinbase gives `(tier by amount, payment_address)`. A match in the node table with `last_paid_height == H` and the same tier and address is exact. We checked this for H = 2,996,914: all 3 matched. However:
  - `last_paid_height` only holds the **latest** payment, so attribution must happen **at ingest time**, within about one payment cycle. The Cumulus cycle is about 3,376 blocks (28 h), since each tier pays one node per block.
  - When backfilling history, address plus tier can map to many nodes (`t1erTe9...` alone runs 180 nodes). Record `payee_address` always, and `node_collateral` only when it is uniquely resolvable.
  - `fluxnodecurrentwinner` gives the **next** payees. Polling it each block gives a second, independent attribution path.

---

## 6. Real-time sources

Measured 2026-09-30 from 19:56 to 20:03 UTC with a single 420 s capture covering 13 blocks, h 2,996,946 to 2,996,958. All detectors ran at the same time from one host. Latency is measured as **first-seen wall-clock time minus the block header `time`**. That includes any clock skew between the producer node and us; the minimum observed was 0.36 s, which suggests the skew is small. Script: `rt.mjs`; analysis: `rt_analyze.py`; raw events: `rt_events.jsonl` (all in the raw dir). Summary fixture: `realtime_blockbook_ws_and_block_fetch_capture.json`.

### 6.1 New-block detection latency (13 blocks)

| Detector | Median | Min | Max | Cost | Verdict |
|---|---|---|---|---|---|
| **Insight socket.io `inv` / `block` event** (explorer.runonflux.io) | **0.94 s** | 0.36 s | 1.36 s | 1 websocket | fastest; primary |
| Insight poll `/api/status?q=getLastBlockHash` every 2 s | 2.50 s | 0.63 s | 2.70 s | 0.5 req/s | good fallback (no cache header; about 150 ms RTT) |
| Blockbook websocket `subscribeNewBlock` | 3.13 s | 2.79 s | 4.18 s | 1 websocket | works; second fallback (server-side only) |
| FluxOS gateway poll `/daemon/getblockcount` every 2 s | **27.6 s** | 27.4 s | 27.7 s | 0.5 req/s | **unusable for tip detection.** The route is wrapped in a 30 s apicache (`cache-control: max-age` counts down from 30 to 1), so the cached value lags up to one full block. The same applies to `getbestblockhash`, `getblockchaininfo`, and `getrawmempool` (all `max-age<=30`). |

Block interval over the capture was about 30 s, so the socket delivers a block in about 3% of the block interval.

### 6.2 Insight socket.io (explorer.runonflux.io): verified 2026-09-30

- Endpoint: `wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket` (socket.io v2 / Engine.IO 3). The polling handshake `GET /socket.io/?EIO=3&transport=polling` returns `{"sid":..., "upgrades":["websocket"], "pingInterval":25000, "pingTimeout":20000}` and echoes the request Origin in `Access-Control-Allow-Origin`.
- Protocol: send `42["subscribe","inv"]` after open. Send `2` (ping) at least every 25 s; the server answers `3`. Events arrive as `42["<event>", payload]`.
- Payloads:
  - `block`: `"<blockhash>"` (a string only; fetch the block yourself).
  - `tx`: `{txid, valueOut, vout:[{"<address>": <sat>}], isRBF}`, about 140 B. Fluxnode start/confirm txs arrive with `valueOut: 0` and `vout: []`. Coinbase txs are also emitted when a block connects: `valueOut 14` with the 4 payout outputs, which is a free way to see the payees before fetching the block.
  - `info`: `{info:{...getInfo}, miningInfo:{difficulty, networkhashps}, supply:"430655732.5"}`, about 1 per block.
  - `markets_info`: `{price, price_btc, market_cap_usd, total_volume_24h, delta_24h}`, occasional.
- Per-address room (from the bundle; untested): `42["subscribe","bitcoind/addresstxid",["t1..."]]` gives `["bitcoind/addresstxid", {address, txid}]`.
- Mirrors with the same socket endpoint (handshake verified): `explorer2.runonflux.io`, `explorer.flux.zelcore.io`.
- Reconnect behaviour and server-side limits on concurrent sockets were not tested. The official SPA reconnects with `reconnectionDelay: 500`.

### 6.3 Blockbook websocket (blockbook.runonflux.io): partial, 2026-09-30

- Endpoint: `wss://blockbook.runonflux.io/websocket`, JSON-RPC-ish frames `{"id","method","params"}` in and `{"id","data"}` out. It needs no CORS, but the host sends no ACAO on HTTP and its banner restricts third-party use, so treat it as **server-side fallback only**.
- `getInfo`: verified. Returns `{name:"Flux", shortcut:"FLUX", decimals:8, version:"0.5.0", bestHeight, bestHash, block0Hash, testnet:false, backend:{version:"9000650", subversion:"/MagicBean:9.0.6(flux)/", consensus}}`. The WS reports version 0.5.0 while HTTP `/api/v2` reports 0.6.0; same host.
- `subscribeNewBlock`: **enabled.** Ack `{"subscribed":true}`, then per block `{"id":"nb","data":{"height":2996946,"hash":"de07..."}}`, 2.8 to 4.2 s after the header time.
- `subscribeNewTransaction`: **disabled.** `{"subscribed":false,"message":"subscribeNewTransaction not enabled, use -enablesubnewtx flag to enable."}`
- `subscribeAddresses`: ack `{"subscribed":true}`, but **0 notifications** over 13 blocks for the dev-fund address, which receives a coinbase output in every block. Blockbook address notifications fire for mempool and regular txs, not coinbase, so this is expected. Regular-tx notifications are untested.

### 6.4 Mempool streaming

- Size: 10 to 20 txs, 2 to 4 KB total (`getmempoolinfo` returned `size 20, bytes 4039`; later 11). Almost all are fluxnode confirms (fee 0, about 200 B).
- Rate from the socket over 420 s: **163 tx events, about 23 tx/min**. Only **15 (9%) had outputs**, so regular transfers run about 2/min. The rest are fluxnode confirms and starts.
- Cheapest stream: **Insight socket `tx` events (push).** They are free, arrive as soon as the explorer node relays the tx, and carry value and outputs. To label an empty-vout tx as confirm vs start and get its node fields (collateral, IP, tier), fetch `/api/tx/{txid}` (about 250 ms, about 700 B). A cheaper option is to **batch-classify once per block** from the block itself, since most mempool txs confirm within 1 or 2 blocks.
- Polling `getrawmempool/true` is a poor fit because of the 30 s gateway cache. Use it only as a periodic (60 s) reconciliation of the mempool set.

### 6.5 Per-block derivation from one fetch

**Yes: one `GET https://api.runonflux.io/daemon/getblock/{hash}` (default verbosity 2) is enough.** Measured on the 13 blocks, fetched immediately on the Insight `block` event: **median 158 ms (157 to 179 ms) and median 10 KB (6.7 to 23 KB), 7 to 18 txs.** The earlier cold single calls took 360 to 430 ms. The fetch succeeded for every block right away, so the gateway backend had already connected it.

That single response contains:
- **Coinbase payouts per tier**: `tx[0].vout[]` with `value`/`valueSat` and `scriptPubKey.addresses`. Classify by amount: 0.5+fees to the dev fund, 1.0 Cumulus, 3.5 Nimbus, 9.0 Stratus.
- **Producer**: `collateral: "COutPoint(6d12b8f9ac, 0)"`, a **10-hex prefix** plus the index, and `blocksig`. Resolve it by prefix match against the local node table. A 40-bit prefix across about 6.7k nodes makes collisions negligible. To get the full txid without the node table, add Insight `/api/block/{hash}` (`nodesCollateral.hash`), which costs one more call of about 260 ms and 2 KB.
- **Fluxnode txs, fully decoded**: `version 5/6`, `type` ("Starting a fluxnode" / "Confirming a fluxnode"), `collateral` (full), `txhash`/`outidx`, `ip`, `update_type` (0 initial / 1 update), `benchmark_tier`, `sigtime`, and, for starts, `collateral_pubkey`/`zelnode_pubkey`/`redeemscript`/`fluxnode_upgraded_tx_version`.
- **Regular txs**: vouts are complete. **Vin values and addresses are not included**; only `txid`/`vout` are present. If the live view needs sender addresses or fees for transfers, add `GET /daemon/getblockdeltas/{hash}` (370 ms, about 3 KB, all inputs with address and satoshis). An alternative is Insight `/api/tx/{txid}` for only the handful of regular txs (about 0 to 2 per block).

Insight has no single-call equivalent. `/api/block` gives txids only, and `/api/txs?block=` pages at 10 txs, so a 16-tx block needs 2 calls. Blockbook `/block/{h}` gives inputs with values but no fluxnode fields and no producer.

### 6.6 Recommended real-time design

```
                +---------------------------------------------+
 Insight socket | wss explorer.runonflux.io  (primary)        |--+
 (inv room)     | wss explorer2.runonflux.io (hot standby)    |--+--> dedupe by block hash / txid
                +---------------------------------------------+  |
 Blockbook WS subscribeNewBlock (fallback #1, ~3 s)  ------------+
 Insight poll getLastBlockHash @2s (fallback #2, ~2.5 s; only    |
   while no socket is healthy)                                    |
                                                                  v
             on new block hash H:
               getblock/H (FluxOS, ~160-400 ms, ~10 KB)
               [+ getblockdeltas/H if transfer inputs are needed]
               check prevhash == our tip; else reorg/gap handling
               derive: payouts(3 tiers + dev), producer (prefix->node), node txs, transfers
               persist + push to clients (own WS/SSE) within ~1.2-1.6 s of block time
             on tx event: push to clients immediately (value/outputs); classify empty-vout
               as node-tx; enrich lazily or at block time
```

- Run **two Insight sockets at once** (main and the explorer2 mirror) and dedupe. Each is cheap and it removes a single point of failure. Declare a socket unhealthy if no `block` arrives for 90 s (3 missed blocks) or a ping times out. The Flux chain never goes 90 s without a block under normal PoN operation.
- **Gap and reorg handling:** every block fetch compares `previousblockhash` to our stored tip. On a mismatch, walk back by height with `getblock/{h}` until hashes agree, then replay. On a gap (a missed event), fetch the missing heights. The ingest loop is idempotent by hash.
- **Never use FluxOS gateway polling for liveness.** Its 30 s cache makes it about 27 s late. Use the gateway only for per-hash fetches, where cached responses are immutable and fine.
- **Clients never talk to upstream.** Our backend fans out one normalized event stream: `block` (with payouts, producer, and node-tx counts), `tx`, `mempool` snapshot, and `stats`. That keeps us to about 3 upstream calls per block regardless of viewer count.
- End-to-end budget: socket event 0.4 to 1.4 s after block time, plus getblock 0.16 to 0.4 s, plus derive and push well under 50 ms. **Viewers see a new block about 1 to 2 s after it is produced.** Worst case, on fallback polling, is about 3 s.

---

## 7. Proxy / cache / index strategy

Principle: the chain is immutable below a small reorg depth. **Everything confirmed more than about 10 blocks deep can be cached forever. Only tip, mempool, address aggregates and stats expire.** PoN reorgs do happen: fluxd v9.0.2 to v9.0.5 fixed reorg issues right after the fork, and `main.cpp` has explicit same-height tie-breaking. Use a 10-block finality window (5 min).

### 7.1 Persist in our DB (ingest loop, 1 block per 30 s)

Per new block (triggered by the socket, see section 6.6): 1 call to FluxOS `getblock/{hash}` (decoded txs, about 10 KB), plus 1 Insight `/api/block/{hash}` for the full `nodesCollateral` txid. The alternative for that txid is to match the short prefix locally against the node table. Optionally add 1 `getblockdeltas/{hash}` for input addresses and values. That is about 3 req/30 s, or 0.1 req/s.

| Table | Rows / growth | Size estimate | Contents |
|---|---|---|---|
| `blocks` | 2,880/day | about 200 B/row, so about 200 KB/day and 70 MB/yr | height, hash, prev, time, size, tx_count, version, type, producer_collateral, blocksig (optional), fees, dev_amount |
| `block_payouts` | 3/block | about 100 B/row, so about 300 KB/day | height, tier, amount_sat, payee_address, node_collateral (nullable) |
| `node_txs` | about 12/block, so about 35k/day | about 150 B/row, so about 5 MB/day (sigs dropped) | txid, height, collateral, nType, update_type, ip, benchmark_tier, sigtime. **This is the only source of per-node start/confirm history.** |
| `txs` (non-node) | tens to hundreds/day | small | txid, height, value_out, fee, in/out address summary |
| `mempool_snapshot` | rolling | tiny | txid, first_seen, size, fee, kind |
| `daily_stats` | 1/day | tiny | derived from our blocks: tx count, fees, emission, unique payees, producer tier share |

Backfill: **keep the last N = 30 days (about 86k blocks) fully indexed.** That is about 86k `getblock` calls. At 2 req/s it takes about 12 h once. Older blocks are proxied on demand and written through to the cache. A full-history backfill (about 3M blocks) is feasible but costs about 17 days at 2 req/s, or needs our own fluxd. Recommendation: **do not do this in v2.0.**

### 7.2 Proxy on demand, with TTLs

| Endpoint | TTL | Why |
|---|---|---|
| block/tx with confirmations >= 10 | immutable (store it) | |
| block/tx at depth < 10 | 30 s | reorg or confirmations changing |
| `/api/tx/{txid}` for mempool | 10 s | |
| address summary `/addr/{a}?noTxList=1` | 30 s (60 s for addresses with >10k txs, since the upstream cold call takes 4.7 s) | |
| address tx page (`/addrs/{a}/txs?from&to`) | page 0: 30 s; deeper pages: 10 min (append-only history shifts offsets, so key by `(addr, from, to, tip_height)`) | |
| address UTXOs | 30 s | |
| Blockbook balancehistory | 1 h | |
| rich list, richer-than, balance-intervals | 30 min (the official explorer uses `staleTime` 10 min) | |
| `/statistics/{type}?days=N` | 1 h; **`network-hash?days=all` 24 h** (16 s upstream) | |
| `gettxoutsetinfo` | 10 min (3 s upstream) | |
| circulating-supply | 10 min | |
| sync/status/getInfo/bestblockhash | 10 s, or push from our ingest loop | |
| mempool (`getrawmempool/true`) | 5 s, or socket-driven | |
| `markets/info` / CoinGecko price | 60 s | |
| node-list lookups by filter | the teammate's node cache (30 s to 60 s) | |

Upstream policy: Insight primary for anything needing input values, address aggregates or stats. FluxOS primary for ingest and raw daemon facts. Insight mirrors (`explorer2`, `explorer.flux.zelcore.io`) as failover. Blockbook only server-side and only for balance history. Global client-side limiter of **4 req/s per upstream host**, circuit breaker on 5xx or timeouts. **Always check the FluxOS `status` field**, because errors arrive as HTTP 200.

Live: subscribe our backend to Insight socket.io `inv` (one connection) and fan out over our own WebSocket/SSE. That gives new-block and mempool-tx events in real time without polling. Treat it as a hint, confirm by fetching the block, and fall back to polling `getbestblockhash` every 10 s.

---

## 8. Feature opportunities for a next-gen explorer

1. **Live PoN block rail.** A 30-s heartbeat ticker. Each block card shows the producer node (tier icon, geo pin from the node teammate's data), the 3 paid nodes, and the tx mix (confirms, starts, transfers). Animate an arc on the 3D globe from producer to payees each block. Data: our `blocks` + `block_payouts` + socket `block`.
2. **"Who produced / who got paid" globe overlay.** Heatmaps of production share by country, provider or tier over 24 h. Since the producer earns nothing extra, show the fairness of the lottery: producer share vs node count per tier. This is novel; no Flux explorer shows it.
3. **Address to owned nodes.** On an address page, show "operates N nodes (x Cumulus, y Nimbus, z Stratus)", a mini-map, the collateral locked, a payment timeline (a dot per coinbase payout), and expected vs actual earnings. Data: node filter by address + `block_payouts`.
4. **Node lifecycle timeline.** Per collateral: collateral tx, START, INITIAL_CONFIRM, the UPDATE_CONFIRM heartbeat every 500 or more blocks (IP changes highlighted), payments, and collateral spend (node death). Only possible with our own `node_txs` index, since no public API offers it.
5. **Emission and supply curves with the countdown.** Supply to date, the 10%/yr step schedule, "next reward cut in N blocks / D days" (h 3,071,200, about 2026-10-26), the tier split, and the announced 560M reference line. Also the dev-fund inflow (0.5/block plus fees).
6. **Mempool as a "confirmation pulse".** The mempool is 10 to 20 txs, nearly all node confirms. Show it as a pulsing ring of nodes checking in, with tx transfers highlighted as flares. Show a "network heartbeat" metric: confirms per block vs the expected 6,722/500.
7. **Tx flow visualization.** A Sankey of inputs to outputs, collapsing change back to the sender. Tag known entities: dev fund, swap pool, rich-list rank, node operator.
8. **Payout predictor.** "Your node will likely be paid in about X blocks": the position in the tier's payment queue (`last_paid_height` ordering) plus `fluxnodecurrentwinner`.
9. **Rich list with node context.** Rank, balance, % of supply, nodes operated, and locked collateral vs liquid. Distribution charts from `balance-intervals`.
10. **Search that understands Flux.** One box for height, hash, txid, t1/t3/zs, IP(:port), collateral outpoint, and app name, with typed result chips.
11. **Screensaver mode.** A block-rail and payout-arc animation driven purely by socket events; no polling needed.

---

## 9. Open questions / uncertainty

- The exclusion rule behind `circulating-supply` (about 10.07M below total) is unknown.
- Whether "max supply 560M" is enforced anywhere in consensus: it was not found in `GetBlockSubsidy` or `MAX_MONEY`. Ask Flux, or read the whitepaper.
- Rate limits for Insight and the FluxOS gateway are unknown. We did not stress-test, per policy.
- `api.runonflux.io` routes to different FluxOS nodes. Heights can differ by 1 or 2 between backends. Never assume read-your-writes consistency.
- Blockbook's backend says `version: "zebra"` and its banner restricts use. Treat its availability as best-effort.
- The explorer's socket `bitcoind/addresstxid` room, `/addrs/.../utxo`, `/rawblock`, and `/status?q=getPeerInfo` are untested.
- The CoinGecko keyless rate limit is quoted from its docs from memory (about 5 to 15/min). Re-check before relying on it.
- Output order in the PoN coinbase was consistent in all samples, but it is not asserted by consensus. Classify outputs by amount and address.

---

## 10. Fixture index (`docs/research/fixtures/explorer/`)

All fixtures were fetched 2026-09-30. Files are **verbatim** response bodies unless the name ends in `_trimmedN`. Trimmed files are re-serialized compact JSON with only the named top-level array truncated to N items; the structure is otherwise unchanged. The largest file is under 140 KB.

Required set:
- recent block: `insight_block_pon_2996914.json`, `fluxos_daemon_getblock_2996914_verbose.json`, `insight_blocks_latest10.json`
- block with node payments: the same as above, plus `insight_block_txs_page0_2996914.json`, `fluxos_daemon_getblock_first_pon_2020000.json`, `fluxos_daemon_getblock_pow_2019999.json` (PoW payments), `blockbook_block_2996914.json`
- coinbase tx: `insight_tx_coinbase_pon.json`, `fluxos_daemon_getrawtransaction_coinbase.json`, `blockbook_tx_coinbase.json`
- regular tx: `insight_tx_regular.json`, `insight_rawtx.json`
- fluxnode start/confirm: `insight_tx_fluxnode_start_v5.json`, `insight_tx_fluxnode_start_v6_p2sh.json`, `fluxos_daemon_getrawtransaction_confirm.json`, `insight_tx_unconfirmed_confirm.json`, `fluxos_daemon_getblock_2996812_with_start_v5.json`, `fluxos_daemon_getblock_2996879_with_start_v6.json`, `insight_block_txs_page0_2996879_with_start.json`, `blockbook_tx_fluxnode_confirm.json`
- collateral: `insight_tx_collateral_nimbus.json`, `insight_tx_collateral_stratus.json`, `fluxos_daemon_gettxout_collateral.json`, `fluxos_daemon_getspentinfo.json`
- address summary: `insight_addr_summary.json`, `insight_addr_summary_large_operator.json`, `insight_addr_with_txlist_trimmed100.json`, `fluxos_daemon_getaddressbalance.json`, `fluxos_explorer_balance.json`
- address tx page: `insight_addr_txs_page0.json`, `insight_addrs_txs_from_to.json`, `blockbook_address_txs.json`, `fluxos_daemon_getaddresstxids_range.json`, `fluxos_daemon_getaddressdeltas_range.json`, `fluxos_explorer_transactions_trimmed100.json`
- UTXOs: `insight_addr_utxo.json`, `blockbook_utxo.json`, `fluxos_daemon_getaddressutxos_trimmed200.json`
- mempool: `fluxos_daemon_getrawmempool.json`, `fluxos_daemon_getrawmempool_verbose.json`, `fluxos_daemon_getmempoolinfo.json`, `fluxos_daemon_getaddressmempool.json`, `insight_socketio_inv_capture.json` (derived: a wrapper object with the frames array from a 75 s websocket capture)
- supply/status: `fluxos_daemon_gettxoutsetinfo.json`, `fluxos_daemon_getblockchaininfo.json`, `fluxos_daemon_getinfo.json`, `fluxos_daemon_getblockcount.json`, `fluxos_daemon_getblocksubsidy.json`, `insight_stats_circulating_supply.json`, `insight_stats_total_supply.json`, `insight_stats_supply_30d.json`, `insight_sync.json`, `insight_status_getinfo.json`, `insight_status_lastblockhash.json`, `insight_status_mininginfo.json`, `blockbook_status.json`, `fluxos_explorer_scannedheight.json`

Real-time: `insight_socketio_inv_capture.json` (75 s socket capture), `realtime_blockbook_ws_and_block_fetch_capture.json` (derived summary: Blockbook WS frames, and FluxOS getblock timings and sizes fetched on each socket block event).

Also included: stats series (`insight_stats_*`), rich list (`insight_stats_richest_addresses.json`), price (`insight_markets_info.json`, `insight_currency.json`, `coingecko_simple_price.json`), node lookups (`fluxos_daemon_viewdeterministicfluxnodelist_by_{collateral,ip,address_trimmed25}.json`, `fluxos_daemon_fluxnodecurrentwinner.json`, `fluxos_daemon_getfluxnodecount.json`, `insight_status_getfluxnodes_trimmed40.json`), an error envelope (`fluxos_daemon_error_tx_not_found.json`), `fluxos_daemon_getblockheader.json`, `fluxos_daemon_getblockhash.json`, `fluxos_daemon_getblockdeltas.json`, `fluxos_daemon_getblock_2996914_verbosity1.json`, `insight_block_index_2996914.json`, `insight_blocks_by_date.json`, `insight_block_first_pon_2020000.json`, `insight_block_pow_2019999.json`, `blockbook_balancehistory.json`.

## 11. Sources

- Live probes (see `probe_log.tsv` in the raw dir).
- Explorer bundle `https://explorer.runonflux.io/assets/index-B9InpKTW.js`, which contains the API client object `L`, the socket helper, and the search function.
- FluxOS routes: `https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js`, `ZelBack/src/services/utils/rateLimit.js`.
- fluxd source (master): `src/main.cpp` (`GetBlockSubsidy`, `GetFluxnodeSubsidy`, `GetMinDevFundAmount`, coinbase checks), `src/chainparams.cpp`, `src/pon/pon.cpp`, `src/fluxnode/fluxnode.h`, `src/primitives/transaction.h`, `src/amount.h`.
- fluxd releases: https://github.com/RunOnFlux/fluxd/releases (v9.0.0 on 2025-10-07 activates PoN at 2,020,000; v9.1.0 on 2026-05-19 has no consensus change).
- "Forking Flux: Proof of Useful Work v2": https://runonflux.com/forking-flux-proof-of-useful-work-v2/ (30 s blocks, 14 FLUX, 1/3.5/9/0.5 split, 10% per 1,051,200 blocks, 560M cap).
- "Ten Chains Become Two": https://runonflux.com/ten-chains-become-two
- FluxOS API docs: https://docs.runonflux.io/fluxapi, https://docs.runonflux.io/fluxapi/explorer.md

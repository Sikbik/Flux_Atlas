# atlas-server

The `atlas` binary: the HTTP API (`/api/v1`), the live WebSocket (`/ws`), and the embedded web app,
all served from the ingest engine's published state (`atlas-engine`). See `docs/ARCHITECTURE.md`
sections 3, 6, 7, 8 and 11.

**One process, one port.** `atlas serve` opens exactly one listening socket, `ATLAS_BIND` (TCP,
default `0.0.0.0:3000`), and serves everything on it: the web app, `/api/v1/*`, the `/ws` upgrade,
`/healthz`, `/readyz` and `/metrics/prometheus`. There is no separate metrics, admin or debug port
and no UDP listener; upstream traffic (FluxOS API, the Insight sockets, stats) is outbound only.
`tests/one_port.rs` proves it on the real serve path, and the Flux app spec maps its public port to
container port 3000.

```
atlas serve                      # run the server (ingest from the real Flux network)
atlas healthcheck                # probe /healthz (container HEALTHCHECK); exit 0 when healthy
atlas metrics                    # print /metrics/prometheus (served to loopback only), inside the container
atlas db-stats                   # per-table sizes of a stopped server's database, disk use of the data dir
atlas export-types               # write the TypeScript bindings to web/src/api/generated
```

Every `serve` flag has an environment variable. Flags win over the environment.

## Configuration

| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `ATLAS_BIND` | `--bind` | `0.0.0.0:3000` | Listen address. |
| `ATLAS_DATA_DIR` | `--data-dir` | `/data` | Directory holding `atlas.redb`. The container image sets `/app/backend/data` (the Flux spec's `containerData`). |
| `ATLAS_INGEST` | `--ingest` | `1` | `0`/`off`/`false`/`no` serves the stored state only, never touching the network (fixtures, dev, tests). |
| `ATLAS_BACKFILL_DAYS` | `--backfill-days` | `7` | Days of blocks the bootstrap backfill fetches (resumable, walks downward; `0` disables). |
| `ATLAS_BACKFILL_RPS` | `--backfill-rps` | `1.5` | Block backfill request rate (be polite to the shared gateway). |
| `ATLAS_DB_CACHE_MB` | `--db-cache-mb` | `32` | redb page cache. redb's own default is 1 GiB, which would dominate RSS; the hot state lives in memory anyway. |
| `ATLAS_DISK_BUDGET_MB` | `--disk-budget-mb` | `6144` | Disk budget of the database file. Hourly, the retention tiers prune by age; once the file reaches 90% of the budget the guard prunes the oldest history (never the newest 7 days) down to 75% and compacts. Covers `atlas.redb` only: the GeoIP files in `geoip/` (about 255 MB, 445 MB during the monthly update) sit beside it. Sized for the 10 GiB Flux volume (ARCHITECTURE section 5). |
| `ATLAS_INTERVALS` | `--intervals` | none | Job interval overrides, `key=duration,...` (`500ms`, `10s`, `5m`, `1h`). Keys below. |
| `ATLAS_FLUX_API` | `--flux-api` | `https://api.runonflux.io` | FluxOS gateway. |
| `ATLAS_EXPLORER_API` | `--explorer-api` | `explorer.runonflux.io`, `explorer2.runonflux.io`, `explorer.flux.zelcore.io` | Insight bases, primary first (comma-separated). When set, the tip sockets follow them (`wss://<host>/socket.io/...`); by default they are the two runonflux explorers. |
| `ATLAS_STATS_API` | `--stats-api` | `https://stats.runonflux.io` | Stats service (rounds, geo lookups, history). |
| `ATLAS_UPSTREAM_RPS` | `--upstream-rps` | per host (gateway 4, stats 2) | Caps every upstream host policy at this rate. |
| `ATLAS_GEOIP_AUTO` | `--geoip-auto` | `1` | Download DB-IP "IP to City Lite" (CC BY 4.0, about 60 MB compressed, 127 MB installed) into `<data-dir>/geoip/` in the background (checked about 30 s after start, then daily; the previous month while the current one is not published), verify it and swap it in atomically. Gives nodes their city names, and approximate coordinates when no source locates them. `0` turns the download off (an installed file is still used). |
| `ATLAS_GEOIP_DB` | `--geoip-db` | none | Operator-managed City `.mmdb` used instead of the downloaded file (the download is then off). It is copied to `<data-dir>/geoip/operator-copy.mmdb` and the copy is mapped, so rewriting it in place is safe; a changed file is reloaded within a day. |
| `ATLAS_REPLAY_CAPACITY` | `--replay-capacity` | `4096` | Live messages kept for `since_seq` replay (min 16), and never more than 16 MiB of them (serialized). |
| `ATLAS_TRUSTED_PROXIES` | `--trusted-proxies` | `fdm` | Peers whose `X-Forwarded-For` names the client: `fdm` (the 16 built-in FDM app balancers), `none`, addresses and CIDR blocks, comma-separated (`fdm,10.0.0.0/8` extends the list). Any other peer is the client. ARCHITECTURE section 11.2. |
| `ATLAS_TRUST_PROXY` | `--trust-proxy` | `0` | Legacy: `1` trusts `X-Forwarded-For` from every peer. Unsafe where the port is reachable without the proxy, as on Flux. |
| `ATLAS_HTTP_MAX_CONNECTIONS` | `--http-max-connections` | `8192` | Open TCP connections, WebSockets included (lowered at startup to fit the file descriptor limit). |
| `ATLAS_HTTP_MAX_PER_PEER` | `--http-max-per-peer` | `256` | Open connections per peer that is not a trusted proxy (IPv6 per /64). |
| `ATLAS_METRICS_TOKEN` | `--metrics-token` | none | Bearer token that opens `/metrics/prometheus` to remote scrapers. Without it the exposition is served to loopback only (`atlas metrics`). |
| `ATLAS_CLIENT_RPS` | `--client-rps` | `5` | Upstream-reaching requests per second per client (cache hits are free). A global budget of 20/s holds across clients. |
| `ATLAS_CLIENT_BURST` | `--client-burst` | `20` | Burst of the per-client limiter. |
| `ATLAS_WS_MAX_CONNECTIONS` | `--ws-max-connections` | `6000` | Concurrent WebSocket connections (about 47 KB of memory each, measured), never above the connection cap. |
| `ATLAS_WS_MAX_PER_IP` | `--ws-max-per-ip` | `32` | Concurrent WebSocket connections per client (IPv6 per /64): room for an office or carrier NAT behind one address. |
| `ATLAS_WS_PING` | `--ws-ping` | `20s` | Protocol ping cadence; the idle timeout is 3 pings + 15 s. |
| `ATLAS_LOG` | | `info` | `tracing` filter (for example `info,atlas_engine=debug`). |
| `ATLAS_HEALTHCHECK_ADDR` | `healthcheck --addr` | `127.0.0.1:3000` | Address `atlas healthcheck` and `atlas metrics` read. |

Fixed limits (ARCHITECTURE section 11.2): a 10 s header read timeout that also bounds keep-alive idle time,
a 30 s write stall timeout, a 30 s request timeout (not the WebSocket session), store reads 32 at once
with a 10 s deadline, the compute routes (`/nodes`, `/operator`, `/metrics`, `/timeline/state`, `/search`,
node history and payments) at 15 requests a second per client (burst 60) with 2 global compute slots, and a
shutdown that drains for 4 s and flushes the store within 8 s of SIGTERM.

### `ATLAS_INTERVALS` keys

| Key (aliases) | Default | Job |
|---|---|---|
| `ping` | 20 s | Live keepalive `ping` message. |
| `app_pending` (`pending`) | 10 s | `/apps/temporarymessages`. |
| `app_installing` (`installing`) | 10 s | `/apps/installinglocations`. |
| `app_placement` (`placement`) | 90 s | `/apps/locations` diff. |
| `hot_app` (`hot_apps`) | 7 s | `/apps/location/<name>` for watched apps. |
| `app_catalog` (`catalog`) | 10 min | `/apps/globalappsspecifications`. |
| `install_errors` | 15 min | `/apps/installingerrorslocations`. |
| `node_registry` (`reconcile`) | 10 min | Node-list reconcile (`viewdeterministicfluxnodelist`). |
| `reconcile_min_spacing` | 2 min | Minimum spacing of triggered reconciles (count mismatch, reorg). |
| `node_count` (`count`) | 60 s | `getfluxnodecount`. |
| `start_dos_lists` (`lists`) | 60 s | `getstartlist` / `getdoslist` cross-checks. |
| `mempool_reconcile` (`mempool`) | 20 s | Mempool set reconcile. |
| `price` | 60 s | Market info. |
| `supply` | 10 min | `gettxoutsetinfo`. |
| `stats_round` (`round_check`) | 5 min | Stats `roundTime` check (a new round is fetched when it moves). |
| `topology_sweep` (`topology`) | 12 s | One `/flux/topology` call. |
| `watch_probe` | 60 s | Direct probes of watched nodes. |
| `geo_resolve` (`geo_background`) | 2 s | Background per-IP geo lookups (new IPs are looked up at once). |
| `compaction` (`maintenance`) | 7 days | Store compaction. |
| `events_retention` / `node_events_retention` / `mesh_events_retention` | 30 d / 90 d / 7 d | History retention of the event tables. The other history tables have fixed tiers (blocks 365 d, payments 730 d, node txs 90 d, daily keyframes 365 d; ARCHITECTURE section 5). |

Unknown keys are logged as unapplied at startup.

## Container

`deploy/Dockerfile` builds the production image from the repository root: the web app (`npm ci`,
`npm run build`), a static musl build of `atlas` that embeds `web/dist`, and a `scratch` runtime that
holds only the binary, the CA bundle and `/app/backend/data` (about 34 MB uncompressed, 14.5 MB
compressed). The Flux spec passes no environment variables and no commands, so the image defaults
are the production configuration: `ATLAS_BIND=0.0.0.0:3000`, `ATLAS_DATA_DIR=/app/backend/data`,
`ATLAS_LOG=info`, `EXPOSE 3000` only, and `HEALTHCHECK` running `atlas healthcheck`. With the GeoIP
defaults the server downloads DB-IP City Lite into `/app/backend/data/geoip/` about 30 s after start, so
the container needs outbound HTTPS to `download.db-ip.com` (it runs without cities if that fails).

```
docker build -f deploy/Dockerfile -t flux-atlas:local .
docker run -d --name atlas -p 3000:3000 -v atlas-data:/app/backend/data flux-atlas:local
curl -s localhost:3000/healthz
docker run --rm -v atlas-data:/app/backend/data flux-atlas:local db-stats   # with the server stopped
```

The server runs as root inside the container: FluxOS bind-mounts a root-owned host directory at
`containerData`, and a non-root user cannot create the database there (measured: `Permission denied`
with uid 65532). At startup it drops every Linux capability and sets `no_new_privs` (it needs none:
uid 0 owns the volume and port 3000 is unprivileged), and raises the soft file descriptor limit to the
hard one; the `process hardened` log line reports both. The image has no shell or other binaries to
escalate with. To run the same image as a non-root user elsewhere, give the volume to that user and
pass `--user`.

`/metrics/prometheus` is private: `docker exec <container> atlas metrics` (or FluxOS's "execute
command" with `atlas metrics`) prints it; a remote scraper needs `ATLAS_METRICS_TOKEN` and sends
`Authorization: Bearer <token>`. `/healthz` and `/readyz` stay public.

## Development and tests

- Tests never touch the network: the fixture harness (`fixtures::test_engine_config`) runs the engine
  with ingest disabled, seeds a temp store, waits for the engine's startup publish, then publishes
  the fixture.
- `cargo run -p atlas-server --example demo_server` serves a mainnet-sized fixture network with a
  synthetic live stream (ingest disabled).
- Web smoke against any running server: `ATLAS_E2E_SERVER=http://127.0.0.1:3100 ATLAS_WEB_PORT=4273
  npm run e2e` (in `web/`).
- Release build with the embedded app: `(cd web && npm run build) && cargo build --release -p atlas-server`.

## Third-party data

- **DB-IP "IP to City Lite"** (city names, approximate locations), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The licence requires the credit
  "IP Geolocation by DB-IP" with a link to https://db-ip.com wherever the data is shown. While a
  database is loaded (or stored nodes still carry its data), `/api/v1/bootstrap` lists it in
  `attributions` (text, link, licence,
  dataset month) for the About view. The database is downloaded at run time and never shipped in
  the image or the repository.

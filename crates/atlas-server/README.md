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
atlas db-stats                   # file and per-table sizes of a stopped server's database
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
| `ATLAS_DISK_BUDGET_MB` | `--disk-budget-mb` | `6144` | Disk budget of the database file. Hourly, the retention tiers prune by age; once the file reaches 90% of the budget the guard prunes the oldest history (never the newest 7 days) down to 75% and compacts. Sized for the 10 GiB Flux volume (ARCHITECTURE section 5). |
| `ATLAS_INTERVALS` | `--intervals` | none | Job interval overrides, `key=duration,...` (`500ms`, `10s`, `5m`, `1h`). Keys below. |
| `ATLAS_FLUX_API` | `--flux-api` | `https://api.runonflux.io` | FluxOS gateway. |
| `ATLAS_EXPLORER_API` | `--explorer-api` | `explorer.runonflux.io`, `explorer2.runonflux.io`, `explorer.flux.zelcore.io` | Insight bases, primary first (comma-separated). When set, the tip sockets follow them (`wss://<host>/socket.io/...`); by default they are the two runonflux explorers. |
| `ATLAS_STATS_API` | `--stats-api` | `https://stats.runonflux.io` | Stats service (rounds, geo lookups, history). |
| `ATLAS_UPSTREAM_RPS` | `--upstream-rps` | per host (gateway 4, stats 2) | Caps every upstream host policy at this rate. |
| `ATLAS_GEOIP_DB` | `--geoip-db` | none | Local GeoIP .mmdb. Accepted but not used yet: the engine has no local reader (logged as unapplied). |
| `ATLAS_REPLAY_CAPACITY` | `--replay-capacity` | `4096` | Live messages kept for `since_seq` replay (min 16), and never more than 16 MiB of them (serialized). |
| `ATLAS_TRUST_PROXY` | `--trust-proxy` | `false` | Use the right-most `X-Forwarded-For` as the client IP. |
| `ATLAS_CLIENT_RPS` | `--client-rps` | `5` | Upstream-reaching requests per second per client IP (cache hits are free). |
| `ATLAS_CLIENT_BURST` | `--client-burst` | `20` | Burst of the per-client limiter. |
| `ATLAS_WS_MAX_CONNECTIONS` | `--ws-max-connections` | `10000` | Concurrent WebSocket connections (about 10 KiB of memory each with the 8 KiB read / 16 KiB write buffers). |
| `ATLAS_WS_MAX_PER_IP` | `--ws-max-per-ip` | `16` | Concurrent WebSocket connections per client IP. |
| `ATLAS_WS_PING` | `--ws-ping` | `20s` | Protocol ping cadence; the idle timeout is 3 pings + 15 s. |
| `ATLAS_LOG` | | `info` | `tracing` filter (for example `info,atlas_engine=debug`). |
| `ATLAS_HEALTHCHECK_ADDR` | `healthcheck --addr` | `127.0.0.1:3000` | Address `atlas healthcheck` probes. |

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
| `mempool_reconcile` (`mempool`) | 60 s | Mempool set reconcile. |
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
holds only the binary, the CA bundle and `/app/backend/data` (about 33 MB uncompressed, 14 MB
compressed). The Flux spec passes no environment variables and no commands, so the image defaults
are the production configuration: `ATLAS_BIND=0.0.0.0:3000`, `ATLAS_DATA_DIR=/app/backend/data`,
`ATLAS_LOG=info`, `EXPOSE 3000` only, and `HEALTHCHECK` running `atlas healthcheck`.

```
docker build -f deploy/Dockerfile -t flux-atlas:local .
docker run -d --name atlas -p 3000:3000 -v atlas-data:/app/backend/data flux-atlas:local
curl -s localhost:3000/healthz
docker run --rm -v atlas-data:/app/backend/data flux-atlas:local db-stats   # with the server stopped
```

The server runs as root inside the container: FluxOS bind-mounts a root-owned host directory at
`containerData`, and a non-root user cannot create the database there (measured: `Permission denied`
with uid 65532). The image has no shell or other binaries to escalate with. To run the same image as
a non-root user elsewhere, give the volume to that user and pass `--user`.

## Development and tests

- Tests never touch the network: the fixture harness (`fixtures::test_engine_config`) runs the engine
  with ingest disabled, seeds a temp store, waits for the engine's startup publish, then publishes
  the fixture.
- `cargo run -p atlas-server --example demo_server` serves a mainnet-sized fixture network with a
  synthetic live stream (ingest disabled).
- Web smoke against any running server: `ATLAS_E2E_SERVER=http://127.0.0.1:3100 ATLAS_WEB_PORT=4273
  npm run e2e` (in `web/`).
- Release build with the embedded app: `(cd web && npm run build) && cargo build --release -p atlas-server`.

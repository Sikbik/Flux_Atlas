//! Server configuration (ARCHITECTURE section 10). The CLI (`main.rs`) maps flags and `ATLAS_*`
//! environment variables onto these types.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use atlas_engine::EngineConfig;
use atlas_flux::ClientsConfig;
use atlas_flux::http::HostPolicy;

pub use crate::net::trust::TrustedProxies;

/// Everything `atlas serve` needs.
#[derive(Debug, Clone)]
pub struct ServeConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub clients: ClientsConfig,
    pub engine: EngineConfig,
    pub engine_overrides: EngineOverrides,
    pub server: ServerConfig,
    /// redb page cache in MiB (`ATLAS_DB_CACHE_MB`). redb defaults to 1 GiB, which would
    /// dominate RSS; the hot state lives in memory anyway.
    pub db_cache_mb: usize,
}

/// Default redb page cache (MiB).
pub const DEFAULT_DB_CACHE_MB: usize = 32;

/// Default listen address (`ATLAS_BIND`). The only port the process opens: the Flux app spec
/// maps its public port to container port 3000.
pub const DEFAULT_BIND: &str = "0.0.0.0:3000";

/// Default address `atlas healthcheck` probes (`ATLAS_HEALTHCHECK_ADDR`): the server's port
/// on loopback, from inside the container.
pub const DEFAULT_HEALTHCHECK_ADDR: &str = "127.0.0.1:3000";

impl ServeConfig {
    /// Defaults for a bind address and data directory.
    pub fn new(bind: SocketAddr, data_dir: PathBuf) -> Self {
        Self {
            bind,
            data_dir,
            clients: ClientsConfig::default(),
            engine: EngineConfig::default(),
            engine_overrides: EngineOverrides::default(),
            server: ServerConfig::default(),
            db_cache_mb: DEFAULT_DB_CACHE_MB,
        }
    }
}

/// Runtime knobs of the HTTP/WS layer.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Peers whose `X-Forwarded-For` names the client (`ATLAS_TRUSTED_PROXIES`; default the
    /// FDM app balancers). Every other peer is the client itself.
    pub proxies: TrustedProxies,
    pub http: HttpLimits,
    pub ws: WsConfig,
    pub limits: ClientLimits,
    pub derived: DerivedLimits,
    pub proxy: ProxyTtls,
    /// Published state older than this makes `/readyz` report `degraded` (still 200).
    pub degraded_after: Duration,
    /// Bearer token that opens `/metrics/prometheus` to non-loopback peers
    /// (`ATLAS_METRICS_TOKEN`). Without it the exposition is served to loopback only.
    pub metrics_token: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            proxies: TrustedProxies::default(),
            http: HttpLimits::default(),
            ws: WsConfig::default(),
            limits: ClientLimits::default(),
            derived: DerivedLimits::default(),
            proxy: ProxyTtls::default(),
            degraded_after: Duration::from_secs(600),
            metrics_token: None,
        }
    }
}

/// Connection-level limits of the HTTP listener (ARCHITECTURE section 11.2).
#[derive(Debug, Clone)]
pub struct HttpLimits {
    /// Open TCP connections, upgraded WebSockets included (`ATLAS_HTTP_MAX_CONNECTIONS`).
    /// Lowered at startup to fit the file descriptor limit.
    pub max_connections: usize,
    /// Open connections per peer address (IPv6: per /64) for peers that are not trusted proxies
    /// (`ATLAS_HTTP_MAX_PER_PEER`). Trusted proxies carry many users and are bounded by the
    /// global cap only.
    pub max_per_peer: u32,
    /// Time to receive a complete request head, counted from when the connection starts
    /// waiting for one: it is also the keep-alive idle timeout.
    pub header_read_timeout: Duration,
    /// A connection whose socket accepts no byte for this long is closed.
    pub write_stall_timeout: Duration,
    /// Time to produce a response (not the WebSocket session after the upgrade).
    pub request_timeout: Duration,
    /// On shutdown, how long in-flight requests may take before their connections are
    /// dropped. Leaves room under Docker's 10 s stop grace for the engine flush.
    pub drain_timeout: Duration,
    /// Request head buffer (bounds the header size).
    pub max_buf_bytes: usize,
    /// Most header fields per request.
    pub max_headers: usize,
}

impl Default for HttpLimits {
    fn default() -> Self {
        Self {
            max_connections: 8192,
            max_per_peer: 256,
            header_read_timeout: Duration::from_secs(10),
            write_stall_timeout: Duration::from_secs(30),
            request_timeout: Duration::from_secs(30),
            drain_timeout: Duration::from_secs(4),
            max_buf_bytes: 64 * 1024,
            max_headers: 64,
        }
    }
}

/// Protection of the routes that compute per request (`/nodes`, `/timeline/state`,
/// `/metrics`, `/operator`, `/search`, node history and payments).
#[derive(Debug, Clone, Copy)]
pub struct DerivedLimits {
    /// Sustained requests per second per client.
    pub rps: u32,
    pub burst: u32,
    /// Such requests computing at once, across all clients; more wait up to `queue_timeout`.
    pub concurrency: usize,
    pub queue_timeout: Duration,
}

impl Default for DerivedLimits {
    fn default() -> Self {
        Self {
            rps: 15,
            burst: 60,
            concurrency: 2,
            queue_timeout: Duration::from_secs(5),
        }
    }
}

/// WebSocket limits.
#[derive(Debug, Clone)]
pub struct WsConfig {
    /// Total concurrent connections.
    pub max_connections: usize,
    /// Concurrent connections per client IP.
    pub max_per_ip: u32,
    /// Per-connection queue depth: a client that falls this many messages behind is dropped.
    pub queue: usize,
    /// Protocol-level ping cadence.
    pub ping_interval: Duration,
    /// Close a connection that sent nothing (not even a pong) for this long.
    pub idle_timeout: Duration,
    /// A single socket write (batch) must complete within this time or the client is dropped.
    pub write_timeout: Duration,
    /// Largest accepted client message.
    pub max_message_bytes: usize,
    /// Most node ids / app names honored in one `sub`.
    pub max_watch_nodes: usize,
    pub max_watch_apps: usize,
    /// Per-connection read buffer. Clients only send small `sub` / `pong` messages; the
    /// library default (128 KiB, allocated up front) cost about 180 KiB of RSS per connection.
    pub read_buffer: usize,
    /// Per-connection write buffer target (frames are flushed once it fills).
    pub write_buffer: usize,
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            max_connections: 6000,
            max_per_ip: 32,
            queue: 1024,
            ping_interval: Duration::from_secs(20),
            idle_timeout: Duration::from_secs(75),
            write_timeout: Duration::from_secs(10),
            max_message_bytes: 64 * 1024,
            max_watch_nodes: 64,
            max_watch_apps: 16,
            read_buffer: 8 * 1024,
            write_buffer: 16 * 1024,
        }
    }
}

/// Per-client protection of upstream-backed endpoints.
#[derive(Debug, Clone, Copy)]
pub struct ClientLimits {
    /// Sustained upstream-reaching requests per second per client IP (cache hits are free).
    pub rps: u32,
    pub burst: u32,
    /// Upstream-reaching requests per second across all clients: the global explorer budget,
    /// which holds whatever the forwarding headers claim.
    pub global_rps: u32,
    pub global_burst: u32,
    /// Concurrent on-demand upstream fetches across all clients.
    pub upstream_concurrency: usize,
    /// How long a request may wait for an upstream slot before a 503.
    pub queue_timeout: Duration,
}

impl Default for ClientLimits {
    fn default() -> Self {
        Self {
            rps: 5,
            burst: 20,
            global_rps: 20,
            global_burst: 60,
            upstream_concurrency: 16,
            queue_timeout: Duration::from_secs(10),
        }
    }
}

/// Explorer proxy cache lifetimes (explorer research section 7.2).
#[derive(Debug, Clone, Copy)]
pub struct ProxyTtls {
    /// Blocks and txs at least [`FINALITY_DEPTH`] deep.
    pub immutable: Duration,
    /// Blocks and txs inside the finality window.
    pub recent: Duration,
    /// Unconfirmed transactions.
    pub mempool_tx: Duration,
    pub address: Duration,
    /// Addresses with more than 10k txs (the upstream cold call takes seconds).
    pub address_large: Duration,
    pub address_txs_first: Duration,
    pub address_txs_deep: Duration,
    pub utxos: Duration,
    pub richlist: Duration,
    pub supply: Duration,
    pub mempool: Duration,
    /// Upstream "not found" answers (protects upstream from junk lookups).
    pub not_found: Duration,
}

/// Blocks deeper than this are final (explorer research section 7).
pub const FINALITY_DEPTH: u32 = 10;

impl Default for ProxyTtls {
    fn default() -> Self {
        Self {
            immutable: Duration::from_secs(24 * 3600),
            recent: Duration::from_secs(30),
            mempool_tx: Duration::from_secs(10),
            address: Duration::from_secs(30),
            address_large: Duration::from_secs(60),
            address_txs_first: Duration::from_secs(30),
            address_txs_deep: Duration::from_secs(600),
            utxos: Duration::from_secs(30),
            richlist: Duration::from_secs(1800),
            supply: Duration::from_secs(600),
            mempool: Duration::from_secs(5),
            not_found: Duration::from_secs(15),
        }
    }
}

impl ProxyTtls {
    /// Lifetime of a block or tx with `confirmations` (`None` or 0 = unconfirmed).
    pub fn for_confirmations(&self, confirmations: Option<u32>) -> Duration {
        match confirmations {
            None | Some(0) => self.mempool_tx,
            Some(c) if c >= FINALITY_DEPTH => self.immutable,
            Some(_) => self.recent,
        }
    }
}

/// Engine settings given on the command line or in the environment.
#[derive(Debug, Clone, Default)]
pub struct EngineOverrides {
    /// Per-job interval overrides by job name (see [`INTERVAL_KEYS`]).
    pub intervals: BTreeMap<String, Duration>,
    pub replay_capacity: Option<usize>,
    /// Operator-managed GeoIP database (`ATLAS_GEOIP_DB`, a City `.mmdb`) used instead of the
    /// downloaded DB-IP City Lite file (the download is then off).
    pub geoip_db: Option<PathBuf>,
    /// Download DB-IP City Lite into `<data>/geoip` (`ATLAS_GEOIP_AUTO`, default on).
    pub geoip_auto: Option<bool>,
    /// Run the ingest jobs (`ATLAS_INGEST`). `Some(false)` serves the stored state only.
    pub ingest: Option<bool>,
    /// Days of blocks the bootstrap backfill fetches (`ATLAS_BACKFILL_DAYS`, 0 disables).
    pub backfill_days: Option<u32>,
    /// Request rate of the block backfill (`ATLAS_BACKFILL_RPS`).
    pub backfill_rps: Option<f64>,
    /// Insight socket endpoints (`wss://.../socket.io/?EIO=3&transport=websocket`).
    pub socket_urls: Vec<String>,
    /// Disk budget of the database file in MiB (`ATLAS_DISK_BUDGET_MB`).
    pub disk_budget_mb: Option<u64>,
}

/// Interval override keys accepted by `ATLAS_INTERVALS` (`key=duration,...`). Freshness job
/// names are accepted as aliases where a job has one interval.
pub const INTERVAL_KEYS: &[&str] = &[
    "ping",
    "app_pending",
    "app_installing",
    "app_placement",
    "hot_app",
    "app_catalog",
    "install_errors",
    "node_registry",
    "reconcile_min_spacing",
    "node_count",
    "start_dos_lists",
    "mempool_reconcile",
    "price",
    "supply",
    "stats_round",
    "topology_sweep",
    "watch_probe",
    "geo_resolve",
    "compaction",
    "events_retention",
    "node_events_retention",
    "mesh_events_retention",
];

/// Block backfill rate ceiling (requests per second): be polite to the shared gateway.
pub const DEFAULT_BACKFILL_RPS: f64 = 1.5;

impl EngineOverrides {
    /// Applies what the engine supports and returns the names it could not apply.
    pub fn apply(&self, cfg: &mut EngineConfig) -> Vec<String> {
        let mut unapplied = Vec::new();
        if let Some(n) = self.replay_capacity {
            cfg.replay_capacity = n.max(16);
        }
        let ing = &mut cfg.ingest;
        for (name, d) in &self.intervals {
            let d = *d;
            match name.as_str() {
                "ping" => cfg.ping_interval = d,
                "app_pending" | "pending" => ing.pending_interval = d,
                "app_installing" | "installing" => ing.installing_interval = d,
                "app_placement" | "placement" => ing.placement_interval = d,
                "hot_app" | "hot_apps" => ing.hot_app_interval = d,
                "app_catalog" | "catalog" => ing.catalog_interval = d,
                "install_errors" => ing.install_errors_interval = d,
                "node_registry" | "reconcile" => ing.reconcile_interval = d,
                "reconcile_min_spacing" => ing.reconcile_min_spacing = d,
                "node_count" | "count" => ing.count_interval = d,
                "start_dos_lists" | "lists" => ing.lists_interval = d,
                "mempool_reconcile" | "mempool" => ing.mempool_reconcile_interval = d,
                "price" => ing.price_interval = d,
                "supply" => ing.supply_interval = d,
                "stats_round" | "round_check" => ing.round_check_interval = d,
                "topology_sweep" | "topology" => ing.topology_interval = d,
                "watch_probe" => ing.watch_probe_interval = d,
                "geo_resolve" | "geo_background" => ing.geo_background_interval = d,
                "compaction" | "maintenance" => ing.compaction_interval = d,
                "events_retention" => ing.events_retention = d,
                "node_events_retention" => ing.node_events_retention = d,
                "mesh_events_retention" => ing.mesh_events_retention = d,
                _ => unapplied.push(name.clone()),
            }
        }
        if let Some(on) = self.ingest {
            ing.enabled = on;
        }
        if let Some(days) = self.backfill_days {
            ing.backfill.block_days = days;
        }
        let rps = self.backfill_rps.unwrap_or(DEFAULT_BACKFILL_RPS);
        if rps.is_finite() && rps > 0.0 {
            ing.backfill.blocks_per_second = rps;
        }
        if !self.socket_urls.is_empty() {
            ing.socket.urls.clone_from(&self.socket_urls);
        }
        if let Some(mb) = self.disk_budget_mb {
            ing.disk_budget = atlas_store::DiskBudget::from_mb(mb);
        }
        unapplied
    }

    /// Local GeoIP settings: the operator's file when `ATLAS_GEOIP_DB` is set, else the managed
    /// `<data_dir>/geoip/dbip-city-lite.mmdb`, downloaded unless `ATLAS_GEOIP_AUTO=0`.
    pub fn geoip(&self, data_dir: &std::path::Path) -> atlas_engine::geoip::GeoIpConfig {
        match &self.geoip_db {
            // Mapped through a private copy: the operator may rewrite the file in place.
            Some(p) => {
                atlas_engine::geoip::GeoIpConfig::file_copied(p.clone(), data_dir.join("geoip"))
            }
            None => {
                atlas_engine::geoip::GeoIpConfig::managed(data_dir, self.geoip_auto.unwrap_or(true))
            }
        }
    }
}

/// Parses a boolean switch: `1/0`, `true/false`, `on/off`, `yes/no`.
pub fn parse_switch(s: &str) -> Result<bool, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "on" | "yes" => Ok(true),
        "0" | "false" | "off" | "no" => Ok(false),
        _ => Err(format!(
            "expected 1/0, true/false, on/off or yes/no, got {s:?}"
        )),
    }
}

/// The Insight socket.io endpoint for an Insight API base URL
/// (`https://explorer.runonflux.io` becomes `wss://explorer.runonflux.io/socket.io/...`).
pub fn socket_url_for(insight_base: &str) -> Option<String> {
    let u = url::Url::parse(insight_base.trim()).ok()?;
    let scheme = match u.scheme() {
        "https" => "wss",
        "http" => "ws",
        _ => return None,
    };
    let host = u.host_str()?;
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!(
        "{scheme}://{host}{port}/socket.io/?EIO=3&transport=websocket"
    ))
}

/// Parses `"500ms"`, `"10s"`, `"5m"`, `"1h"`, or a bare number of seconds.
pub fn parse_duration(s: &str) -> Result<Duration, String> {
    let s = s.trim();
    let (num, mul_ms): (&str, u64) = if let Some(n) = s.strip_suffix("ms") {
        (n, 1)
    } else if let Some(n) = s.strip_suffix('s') {
        (n, 1000)
    } else if let Some(n) = s.strip_suffix('m') {
        (n, 60_000)
    } else if let Some(n) = s.strip_suffix('h') {
        (n, 3_600_000)
    } else {
        (s, 1000)
    };
    let v: u64 = num
        .trim()
        .parse()
        .map_err(|_| format!("invalid duration {s:?}"))?;
    if v == 0 {
        return Err(format!("duration must be positive: {s:?}"));
    }
    Ok(Duration::from_millis(v.saturating_mul(mul_ms)))
}

/// Parses `job=duration` pairs separated by commas.
pub fn parse_intervals(s: &str) -> Result<BTreeMap<String, Duration>, String> {
    let mut out = BTreeMap::new();
    for part in s.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let (k, v) = part
            .split_once('=')
            .ok_or_else(|| format!("expected job=duration, got {part:?}"))?;
        let k = k.trim().to_ascii_lowercase();
        if k.is_empty() || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err(format!("invalid job name {k:?}"));
        }
        out.insert(k, parse_duration(v)?);
    }
    Ok(out)
}

/// Applies an `ATLAS_UPSTREAM_RPS` override to every upstream host policy.
pub fn apply_upstream_rps(clients: &mut ClientsConfig, rps: u32) {
    let rps = rps.max(1);
    let adjust = |p: &mut HostPolicy| {
        p.rps = rps;
        p.burst = p.burst.max(1).min(rps.max(1));
    };
    adjust(&mut clients.http.default_policy);
    for p in clients.http.host_policies.values_mut() {
        adjust(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("500ms").unwrap(), Duration::from_millis(500));
        assert_eq!(parse_duration("10s").unwrap(), Duration::from_secs(10));
        assert_eq!(parse_duration("5m").unwrap(), Duration::from_secs(300));
        assert_eq!(parse_duration("2h").unwrap(), Duration::from_secs(7200));
        assert_eq!(parse_duration("7").unwrap(), Duration::from_secs(7));
        assert!(parse_duration("0s").is_err());
        assert!(parse_duration("x").is_err());
    }

    #[test]
    fn intervals_and_overrides() {
        let m = parse_intervals("ping=5s, app_placement=75s").unwrap();
        assert_eq!(m["ping"], Duration::from_secs(5));
        assert!(parse_intervals("bad").is_err());
        assert!(parse_intervals("a b=1s").is_err());
        let mut m = m;
        m.insert("bogus".into(), Duration::from_secs(1));
        m.insert("topology".into(), Duration::from_secs(30));
        let o = EngineOverrides {
            intervals: m,
            replay_capacity: Some(100),
            ingest: Some(false),
            backfill_days: Some(2),
            disk_budget_mb: Some(2048),
            ..EngineOverrides::default()
        };
        let mut cfg = EngineConfig::default();
        let left = o.apply(&mut cfg);
        assert_eq!(cfg.ping_interval, Duration::from_secs(5));
        assert_eq!(cfg.ingest.placement_interval, Duration::from_secs(75));
        assert_eq!(cfg.ingest.topology_interval, Duration::from_secs(30));
        assert_eq!(cfg.replay_capacity, 100);
        assert!(!cfg.ingest.enabled);
        assert_eq!(cfg.ingest.backfill.block_days, 2);
        assert_eq!(cfg.ingest.disk_budget.budget_bytes, 2048 << 20);
        assert_eq!(
            EngineConfig::default().ingest.disk_budget.budget_bytes,
            atlas_store::DEFAULT_DISK_BUDGET_MB << 20
        );
        assert!((cfg.ingest.backfill.blocks_per_second - DEFAULT_BACKFILL_RPS).abs() < 1e-9);
        assert_eq!(left, vec!["bogus".to_owned()]);
    }

    #[test]
    fn geoip_settings() {
        let data = PathBuf::from("/data");
        let managed = PathBuf::from("/data/geoip");
        // Default: the managed file, downloaded.
        let g = EngineOverrides::default().geoip(&data);
        assert_eq!(g.db_path, Some(managed.join("dbip-city-lite.mmdb")));
        assert_eq!(g.auto_dir, Some(managed.clone()));
        // ATLAS_GEOIP_AUTO=0: the managed file if present, never downloaded.
        let g = EngineOverrides {
            geoip_auto: Some(false),
            ..EngineOverrides::default()
        }
        .geoip(&data);
        assert_eq!(g.db_path, Some(managed.join("dbip-city-lite.mmdb")));
        assert_eq!(g.auto_dir, None);
        // ATLAS_GEOIP_DB: the operator's file, no download.
        let g = EngineOverrides {
            geoip_db: Some(PathBuf::from("/srv/city.mmdb")),
            geoip_auto: Some(true),
            ..EngineOverrides::default()
        }
        .geoip(&data);
        assert_eq!(g.db_path, Some(PathBuf::from("/srv/city.mmdb")));
        assert_eq!(g.auto_dir, None);
        assert_eq!(g.copy_dir, Some(managed));
    }

    #[test]
    fn every_interval_key_applies() {
        for k in INTERVAL_KEYS {
            let o = EngineOverrides {
                intervals: [((*k).to_owned(), Duration::from_secs(1))].into(),
                ..EngineOverrides::default()
            };
            assert!(o.apply(&mut EngineConfig::default()).is_empty(), "{k}");
        }
    }

    #[test]
    fn switches_and_socket_urls() {
        assert_eq!(parse_switch("OFF"), Ok(false));
        assert_eq!(parse_switch("1"), Ok(true));
        assert!(parse_switch("maybe").is_err());
        assert_eq!(
            socket_url_for("https://explorer.runonflux.io").as_deref(),
            Some("wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket")
        );
        assert_eq!(
            socket_url_for("http://127.0.0.1:8080/api").as_deref(),
            Some("ws://127.0.0.1:8080/socket.io/?EIO=3&transport=websocket")
        );
        assert_eq!(socket_url_for("nope"), None);
    }

    #[test]
    fn ttl_policy() {
        let t = ProxyTtls::default();
        assert_eq!(t.for_confirmations(None), t.mempool_tx);
        assert_eq!(t.for_confirmations(Some(0)), t.mempool_tx);
        assert_eq!(t.for_confirmations(Some(3)), t.recent);
        assert_eq!(t.for_confirmations(Some(FINALITY_DEPTH)), t.immutable);
    }

    #[test]
    fn upstream_rps() {
        let mut c = ClientsConfig::default();
        apply_upstream_rps(&mut c, 2);
        assert!(
            c.http
                .host_policies
                .values()
                .all(|p| p.rps == 2 && p.burst <= 2)
        );
    }
}

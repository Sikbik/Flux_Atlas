//! Server configuration (ARCHITECTURE section 10). The CLI (`main.rs`) maps flags and `ATLAS_*`
//! environment variables onto these types.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use atlas_engine::EngineConfig;
use atlas_flux::ClientsConfig;
use atlas_flux::http::HostPolicy;

/// Everything `atlas serve` needs.
#[derive(Debug, Clone)]
pub struct ServeConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub clients: ClientsConfig,
    pub engine: EngineConfig,
    pub engine_overrides: EngineOverrides,
    pub server: ServerConfig,
}

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
        }
    }
}

/// Runtime knobs of the HTTP/WS layer.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Use the right-most `X-Forwarded-For` entry as the client IP (set behind a reverse proxy).
    pub trust_proxy: bool,
    pub ws: WsConfig,
    pub limits: ClientLimits,
    pub proxy: ProxyTtls,
    /// Published state older than this makes `/readyz` report `degraded` (still 200).
    pub degraded_after: Duration,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            trust_proxy: false,
            ws: WsConfig::default(),
            limits: ClientLimits::default(),
            proxy: ProxyTtls::default(),
            degraded_after: Duration::from_secs(600),
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
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            max_connections: 10_000,
            max_per_ip: 16,
            queue: 1024,
            ping_interval: Duration::from_secs(20),
            idle_timeout: Duration::from_secs(75),
            write_timeout: Duration::from_secs(10),
            max_message_bytes: 64 * 1024,
            max_watch_nodes: 64,
            max_watch_apps: 16,
        }
    }
}

/// Per-client protection of upstream-backed endpoints.
#[derive(Debug, Clone, Copy)]
pub struct ClientLimits {
    /// Sustained upstream-reaching requests per second per client IP (cache hits are free).
    pub rps: u32,
    pub burst: u32,
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
    /// Per-job interval overrides by job name (`ping`, `app_placement`, `topology`, ...).
    pub intervals: BTreeMap<String, Duration>,
    pub replay_capacity: Option<usize>,
    /// Optional local GeoIP database (.mmdb).
    pub geoip_db: Option<PathBuf>,
}

impl EngineOverrides {
    /// Applies what the engine supports and returns the names it could not apply.
    pub fn apply(&self, cfg: &mut EngineConfig) -> Vec<String> {
        let mut unapplied = Vec::new();
        if let Some(n) = self.replay_capacity {
            cfg.replay_capacity = n.max(16);
        }
        for (name, d) in &self.intervals {
            match name.as_str() {
                "ping" => cfg.ping_interval = *d,
                // INTEGRATION: map the ingest job intervals (tip poll, app placement, topology
                // sweep, stats round, node reconcile, ...) onto the EngineConfig fields B2 adds.
                _ => unapplied.push(name.clone()),
            }
        }
        if self.geoip_db.is_some() {
            // INTEGRATION: pass the GeoIP database path to the engine once it accepts one.
            unapplied.push("geoip_db".to_owned());
        }
        unapplied
    }
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
        let m = parse_intervals("ping=5s, app_placement=90s").unwrap();
        assert_eq!(m["ping"], Duration::from_secs(5));
        assert!(parse_intervals("bad").is_err());
        assert!(parse_intervals("a b=1s").is_err());
        let o = EngineOverrides {
            intervals: m,
            replay_capacity: Some(100),
            geoip_db: None,
        };
        let mut cfg = EngineConfig::default();
        let left = o.apply(&mut cfg);
        assert_eq!(cfg.ping_interval, Duration::from_secs(5));
        assert_eq!(cfg.replay_capacity, 100);
        assert_eq!(left, vec!["app_placement".to_owned()]);
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

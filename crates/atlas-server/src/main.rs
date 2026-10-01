//! The `atlas` binary: `serve`, `healthcheck`, `export-types`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use atlas_server::config::{
    DEFAULT_BIND, DEFAULT_DB_CACHE_MB, DEFAULT_HEALTHCHECK_ADDR, EngineOverrides, ServeConfig,
    apply_upstream_rps, parse_duration, parse_intervals, parse_switch, socket_url_for,
};
use clap::{Args, Parser, Subcommand};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Parser, Debug)]
#[command(
    name = "atlas",
    version,
    about = "Flux Atlas: live map and explorer of the Flux network"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Run the server.
    Serve(Box<ServeArgs>),
    /// Probe a running server's `/healthz`; exit status 0 when healthy (container HEALTHCHECK).
    Healthcheck {
        #[arg(long, env = "ATLAS_HEALTHCHECK_ADDR", default_value = DEFAULT_HEALTHCHECK_ADDR)]
        addr: SocketAddr,
        #[arg(long, default_value_t = 3)]
        timeout_s: u64,
    },
    /// Write the TypeScript API bindings (ts-rs) into a directory.
    ExportTypes {
        #[arg(long, default_value = "web/src/api/generated")]
        out: PathBuf,
    },
}

#[derive(Args, Debug)]
struct ServeArgs {
    /// Listen address.
    #[arg(long, env = "ATLAS_BIND", default_value = DEFAULT_BIND)]
    bind: SocketAddr,
    /// Directory holding the database.
    #[arg(long, env = "ATLAS_DATA_DIR", default_value = "/data")]
    data_dir: PathBuf,
    /// FluxOS gateway base URL.
    #[arg(long, env = "ATLAS_FLUX_API")]
    flux_api: Option<String>,
    /// Insight explorer base URLs, primary first (comma-separated).
    #[arg(long, env = "ATLAS_EXPLORER_API", value_delimiter = ',')]
    explorer_api: Vec<String>,
    /// stats.runonflux.io base URL.
    #[arg(long, env = "ATLAS_STATS_API")]
    stats_api: Option<String>,
    /// Optional local GeoIP database (.mmdb).
    #[arg(long, env = "ATLAS_GEOIP_DB")]
    geoip_db: Option<PathBuf>,
    /// Requests per second allowed to each upstream host.
    #[arg(long, env = "ATLAS_UPSTREAM_RPS")]
    upstream_rps: Option<u32>,
    /// Engine job interval overrides: `job=duration,...` (for example `ping=20s,app_placement=90s`).
    #[arg(long, env = "ATLAS_INTERVALS", value_parser = parse_intervals_arg)]
    intervals: Option<IntervalMap>,
    /// Run the live ingest jobs. `0`/`off` serves the stored state only (fixtures, dev).
    #[arg(long, env = "ATLAS_INGEST", default_value = "1", value_parser = parse_switch_arg)]
    ingest: bool,
    /// Days of blocks the bootstrap backfill fetches (0 disables).
    #[arg(long, env = "ATLAS_BACKFILL_DAYS", default_value_t = 7)]
    backfill_days: u32,
    /// Block backfill requests per second (default 1.5).
    #[arg(long, env = "ATLAS_BACKFILL_RPS")]
    backfill_rps: Option<f64>,
    /// redb page cache in MiB.
    #[arg(long, env = "ATLAS_DB_CACHE_MB", default_value_t = DEFAULT_DB_CACHE_MB)]
    db_cache_mb: usize,
    /// Live messages kept for reconnect replay.
    #[arg(long, env = "ATLAS_REPLAY_CAPACITY")]
    replay_capacity: Option<usize>,
    /// Trust `X-Forwarded-For` from the reverse proxy in front of the server.
    #[arg(long, env = "ATLAS_TRUST_PROXY", default_value_t = false)]
    trust_proxy: bool,
    /// Upstream-reaching requests per second per client IP (cache hits are free).
    #[arg(long, env = "ATLAS_CLIENT_RPS", default_value_t = 5)]
    client_rps: u32,
    /// Burst size of the per-client upstream limiter.
    #[arg(long, env = "ATLAS_CLIENT_BURST", default_value_t = 20)]
    client_burst: u32,
    /// Maximum concurrent WebSocket connections.
    #[arg(long, env = "ATLAS_WS_MAX_CONNECTIONS", default_value_t = 10_000)]
    ws_max_connections: usize,
    /// Maximum concurrent WebSocket connections per client IP.
    #[arg(long, env = "ATLAS_WS_MAX_PER_IP", default_value_t = 16)]
    ws_max_per_ip: u32,
    /// Protocol ping cadence for WebSocket clients (`20s`).
    #[arg(long, env = "ATLAS_WS_PING", value_parser = parse_duration_arg)]
    ws_ping: Option<Duration>,
}

type IntervalMap = std::collections::BTreeMap<String, Duration>;

fn parse_intervals_arg(s: &str) -> Result<IntervalMap, String> {
    parse_intervals(s)
}

fn parse_switch_arg(s: &str) -> Result<bool, String> {
    parse_switch(s)
}

fn parse_duration_arg(s: &str) -> Result<Duration, String> {
    parse_duration(s)
}

fn serve_config(a: ServeArgs) -> ServeConfig {
    let mut cfg = ServeConfig::new(a.bind, a.data_dir);
    if let Some(u) = a.flux_api {
        cfg.clients.fluxos_gateway = u;
    }
    let mut socket_urls = Vec::new();
    if !a.explorer_api.is_empty() {
        socket_urls = a
            .explorer_api
            .iter()
            .filter_map(|b| socket_url_for(b))
            .collect();
        cfg.clients.insight_bases = a.explorer_api;
    }
    if let Some(u) = a.stats_api {
        cfg.clients.stats_base = u;
    }
    if let Some(rps) = a.upstream_rps {
        apply_upstream_rps(&mut cfg.clients, rps);
    }
    cfg.engine_overrides = EngineOverrides {
        intervals: a.intervals.unwrap_or_default(),
        replay_capacity: a.replay_capacity,
        geoip_db: a.geoip_db,
        ingest: Some(a.ingest),
        backfill_days: Some(a.backfill_days),
        backfill_rps: a.backfill_rps,
        socket_urls,
    };
    cfg.db_cache_mb = a.db_cache_mb.max(1);
    cfg.server.trust_proxy = a.trust_proxy;
    cfg.server.limits.rps = a.client_rps.max(1);
    cfg.server.limits.burst = a.client_burst.max(1);
    cfg.server.ws.max_connections = a.ws_max_connections.max(1);
    cfg.server.ws.max_per_ip = a.ws_max_per_ip.max(1);
    if let Some(p) = a.ws_ping {
        cfg.server.ws.ping_interval = p;
        cfg.server.ws.idle_timeout = p * 3 + Duration::from_secs(15);
    }
    cfg
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_env("ATLAS_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .init();
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.cmd {
        Cmd::Serve(args) => {
            init_tracing();
            let cfg = serve_config(*args);
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(anyhow::Error::from)
                .and_then(|rt| rt.block_on(atlas_server::serve(cfg)))
        }
        Cmd::Healthcheck { addr, timeout_s } => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(anyhow::Error::from)
            .and_then(|rt| {
                rt.block_on(atlas_server::healthcheck(
                    addr,
                    Duration::from_secs(timeout_s),
                ))
            }),
        Cmd::ExportTypes { out } => atlas_core::export_typescript(&out)
            .map(|()| eprintln!("wrote TypeScript bindings to {}", out.display()))
            .map_err(anyhow::Error::from),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("atlas: {e:#}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use clap::CommandFactory as _;

    use super::*;

    #[test]
    fn cli_is_well_formed() {
        Cli::command().debug_assert();
    }

    /// One process, one port: the server listens on 0.0.0.0:3000 unless told otherwise, and
    /// the container health probe targets that same port on loopback.
    #[test]
    fn default_port_is_3000() {
        assert_eq!(DEFAULT_BIND, "0.0.0.0:3000");
        assert_eq!(DEFAULT_HEALTHCHECK_ADDR, "127.0.0.1:3000");
        let bind: SocketAddr = DEFAULT_BIND.parse().unwrap();
        let probe: SocketAddr = DEFAULT_HEALTHCHECK_ADDR.parse().unwrap();
        assert_eq!(bind.port(), probe.port());
        assert!(bind.ip().is_unspecified());
        assert!(probe.ip().is_loopback());

        // The parsed CLI defaults (skipped when the environment overrides them).
        if std::env::var_os("ATLAS_BIND").is_none() {
            let Cmd::Serve(a) = Cli::try_parse_from(["atlas", "serve"]).unwrap().cmd else {
                panic!("expected serve");
            };
            assert_eq!(a.bind, bind);
            assert_eq!(serve_config(*a).bind, bind);
        }
        if std::env::var_os("ATLAS_HEALTHCHECK_ADDR").is_none() {
            let Cmd::Healthcheck { addr, .. } =
                Cli::try_parse_from(["atlas", "healthcheck"]).unwrap().cmd
            else {
                panic!("expected healthcheck");
            };
            assert_eq!(addr, probe);
        }
    }
}

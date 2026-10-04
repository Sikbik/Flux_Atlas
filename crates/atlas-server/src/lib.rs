//! Flux Atlas HTTP and WebSocket server.
//!
//! Everything is served from the engine's [`atlas_engine::Published`] state (plus its prebuilt
//! bodies), the store, and on-demand upstream lookups:
//!
//! - hot snapshot bodies (`/bootstrap`, `/nodes.bin`, `/mesh.bin`, `/apps`) come straight from
//!   the engine's pre-compressed bodies with ETag / 304 and content negotiation;
//! - derived views (node index, analytics) are computed once per publish ([`views`]);
//! - explorer lookups go through a TTL cache with single-flight fills and a per-client-IP
//!   limiter ([`proxy`], [`explorer`]);
//! - the live stream is serialized once per message and fanned out to every WebSocket
//!   ([`live`]).
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod body;
pub mod chain_history;
pub mod config;
pub mod derived;
pub mod error;
pub mod explorer;
pub mod extract;
pub mod fixtures;
pub mod keep;
pub mod ledger;
pub mod live;
pub mod metrics;
pub mod net;
pub mod proxy;
pub mod routes;
pub mod search;
pub mod sources;
pub mod state;
pub mod views;
pub mod wallet;
pub mod watch;
pub mod web;

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use anyhow::Context as _;
use atlas_engine::Engine;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

pub use config::{ServeConfig, ServerConfig};
pub use routes::router;
pub use state::AppState;
pub use watch::WatchHooks;

/// File descriptors kept free of connections: the store, GeoIP files, upstream sockets.
const FD_RESERVE: u64 = 512;

/// Everything `atlas serve` does: create the data directory, bind the one listening socket,
/// harden the process (raise `RLIMIT_NOFILE`, drop capabilities, `no_new_privs`; this must
/// run before the runtime starts its threads), then run the server until SIGINT or SIGTERM.
pub fn run(mut cfg: ServeConfig) -> anyhow::Result<()> {
    std::fs::create_dir_all(&cfg.data_dir)
        .with_context(|| format!("creating data dir {}", cfg.data_dir.display()))?;
    let std_listener =
        std::net::TcpListener::bind(cfg.bind).with_context(|| format!("binding {}", cfg.bind))?;
    std_listener
        .set_nonblocking(true)
        .context("listener non-blocking")?;
    let h = net::harden::harden(&cfg.data_dir);
    for e in &h.errors {
        tracing::warn!(error = %e, "hardening step failed");
    }
    if let Some(why) = &h.kept_reason {
        tracing::warn!(
            reason = %why,
            kept = ?net::harden::cap_names(h.caps_kept),
            "data directory holds files of another user; keeping the capabilities to write them"
        );
    }
    tracing::info!(
        nofile_before = h.nofile_before,
        nofile = h.nofile_after,
        caps_before = ?net::harden::cap_names(h.caps_before),
        caps_kept = ?net::harden::cap_names(h.caps_kept),
        bounding_dropped = h.bounding_dropped,
        no_new_privs = h.no_new_privs,
        "process hardened"
    );
    fit_to_fd_limit(&mut cfg.server, h.nofile_after);
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building the runtime")?;
    let result = rt.block_on(async move {
        let listener = tokio::net::TcpListener::from_std(std_listener).context("listener")?;
        serve_on(cfg, listener, shutdown_signal()).await
    });
    // Do not wait forever for blocking tasks (a wedged store read after the engine died): the
    // process must exit to be restarted.
    rt.shutdown_timeout(Duration::from_secs(5));
    result
}

/// Lowers the connection caps so open sockets can never exhaust file descriptors.
pub fn fit_to_fd_limit(server: &mut ServerConfig, nofile: Option<u64>) {
    let Some(n) = nofile else { return };
    let room = usize::try_from(n.saturating_sub(FD_RESERVE).max(64)).unwrap_or(usize::MAX);
    if server.http.max_connections > room {
        tracing::warn!(
            nofile = n,
            from = server.http.max_connections,
            to = room,
            "connection cap lowered to fit the file descriptor limit"
        );
        server.http.max_connections = room;
    }
    if server.ws.max_connections > server.http.max_connections {
        server.ws.max_connections = server.http.max_connections;
    }
}

/// Binds `cfg.bind` and serves (no hardening; [`run`] is the production entry point).
pub async fn serve(cfg: ServeConfig) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(cfg.bind)
        .await
        .with_context(|| format!("binding {}", cfg.bind))?;
    serve_on(cfg, listener, shutdown_signal()).await
}

/// Opens the store, starts the engine and serves on an already bound listener until
/// `shutdown` resolves (tests bind an ephemeral port and pass their own shutdown future).
/// `cfg.bind` is ignored.
///
/// The process opens exactly one listening socket (TCP; default `0.0.0.0:3000`) and serves
/// everything on it: the web app, `/api/v1/*`, `/ws`, `/healthz`, `/readyz` and
/// `/metrics/prometheus`. Upstream traffic (FluxOS API, Insight sockets, stats) is outbound
/// only. See ARCHITECTURE section 11.
///
/// Shutdown fits Docker's 10 s stop grace: live connections are closed (1001) at once, HTTP
/// requests get [`config::HttpLimits::drain_timeout`], then the engine flush gets what is left
/// of [`SHUTDOWN_BUDGET`], and the store is flushed last in every case.
pub async fn serve_on(
    cfg: ServeConfig,
    listener: tokio::net::TcpListener,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&cfg.data_dir)
        .with_context(|| format!("creating data dir {}", cfg.data_dir.display()))?;
    let db = cfg.data_dir.join("atlas.redb");
    let store = atlas_store::Store::open_with(
        &db,
        atlas_store::StoreOptions {
            cache_size_bytes: Some(cfg.db_cache_mb.max(1) << 20),
            ..atlas_store::StoreOptions::default()
        },
    )
    .with_context(|| format!("opening {}", db.display()))?;
    let clients =
        atlas_flux::Clients::new(cfg.clients.clone()).context("building upstream clients")?;
    let mut engine_cfg = cfg.engine.clone();
    let unapplied = cfg.engine_overrides.apply(&mut engine_cfg);
    engine_cfg.geoip = cfg.engine_overrides.geoip(&cfg.data_dir);
    if !unapplied.is_empty() {
        tracing::warn!(
            ?unapplied,
            "engine settings not supported by this engine build"
        );
    }
    tracing::info!(
        ingest = engine_cfg.ingest.enabled,
        backfill_days = engine_cfg.ingest.backfill.block_days,
        backfill_rps = engine_cfg.ingest.backfill.blocks_per_second,
        db_cache_mb = cfg.db_cache_mb,
        geoip_db = ?engine_cfg.geoip.db_path,
        geoip_auto = engine_cfg.geoip.auto_dir.is_some(),
        "engine configuration"
    );
    let engine = Engine::start(engine_cfg, store.clone(), clients);
    let state = AppState::new(engine.clone(), cfg.server.clone());
    let app = router(state.clone());
    let addr = listener.local_addr().context("listener address")?;
    tracing::info!(
        %addr,
        data = %cfg.data_dir.display(),
        trusted_proxies = %net::describe(&cfg.server.proxies),
        max_connections = cfg.server.http.max_connections,
        max_per_peer = cfg.server.http.max_per_peer,
        ws_max = cfg.server.ws.max_connections,
        metrics = if cfg.server.metrics_token.is_some() { "loopback or token" } else { "loopback only" },
        "listening"
    );
    let st = state.clone();
    // A dead engine (a supervised part panicked, stopped or stalled; ARCHITECTURE 3.4) shuts
    // the server down like a signal, and the process then exits non-zero so the container
    // restart policy restarts it on the persisted state instead of serving frozen data.
    let died = std::sync::Arc::new(std::sync::OnceLock::<String>::new());
    let died_set = std::sync::Arc::clone(&died);
    let watched = engine.clone();
    let signalled = std::sync::Arc::new(std::sync::OnceLock::<Instant>::new());
    let sig = std::sync::Arc::clone(&signalled);
    let conns = std::sync::Arc::clone(&state.listener);
    net::listener::serve(
        conns,
        listener,
        app,
        async move {
            tokio::select! {
                () = shutdown => {}
                reason = watched.died() => {
                    tracing::error!(reason, "engine died; shutting down to be restarted");
                    let _ = died_set.set(reason);
                }
            }
            let _ = sig.set(Instant::now());
        },
        move || st.begin_shutdown(),
    )
    .await;
    let started = signalled.get().copied().unwrap_or_else(Instant::now);
    // Upgraded WebSocket connections are owned by the hub: wait briefly for their close frames.
    let ws_deadline = Instant::now() + Duration::from_secs(1);
    while state.hub.connections() > 0 && Instant::now() < ws_deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let left = SHUTDOWN_BUDGET
        .saturating_sub(started.elapsed())
        .max(Duration::from_millis(500));
    if tokio::time::timeout(left, engine.shutdown()).await.is_err() {
        tracing::warn!(
            budget_ms = left.as_millis() as u64,
            "engine shutdown did not finish in time; flushing the store anyway"
        );
    }
    if let Some(reason) = died.get() {
        // A wedged store writer may hold the database: bound the final flush, then exit.
        let s = store.clone();
        let flushed = tokio::time::timeout(
            Duration::from_secs(10),
            tokio::task::spawn_blocking(move || s.flush()),
        )
        .await;
        if !matches!(flushed, Ok(Ok(Ok(_)))) {
            tracing::error!("final store flush did not complete after the engine died");
        }
        anyhow::bail!("engine died: {reason}");
    }
    store.flush().context("final store flush")?;
    tracing::info!(ms = started.elapsed().as_millis() as u64, "stopped");
    Ok(())
}

/// Time from the shutdown signal to the start of the final store flush. Docker sends SIGKILL
/// 10 s after SIGTERM; the flush itself takes well under a second.
pub const SHUTDOWN_BUDGET: Duration = Duration::from_secs(8);

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
    tracing::info!("shutdown requested");
}

/// `GET path` over plain HTTP/1.1 with a raw socket (the image has no curl); the raw response.
async fn raw_get(
    addr: SocketAddr,
    path: &str,
    timeout: Duration,
    max: u64,
) -> anyhow::Result<Vec<u8>> {
    let probe = async {
        let mut s = tokio::net::TcpStream::connect(addr).await?;
        s.write_all(
            format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await?;
        let mut buf = Vec::with_capacity(512);
        s.take(max).read_to_end(&mut buf).await?;
        anyhow::Ok(buf)
    };
    tokio::time::timeout(timeout, probe)
        .await
        .with_context(|| format!("GET {path} timed out"))?
}

/// The Prometheus exposition of the server on `addr` (loopback: `atlas metrics`).
pub async fn scrape_metrics(addr: SocketAddr, timeout: Duration) -> anyhow::Result<String> {
    let buf = raw_get(addr, "/metrics/prometheus", timeout, 32 << 20).await?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .context("malformed HTTP response")?;
    let status = head.split_whitespace().nth(1).unwrap_or("");
    anyhow::ensure!(
        status == "200",
        "metrics: status line {:?}",
        head.lines().next().unwrap_or("")
    );
    Ok(body.to_owned())
}

/// Container health probe: `GET /healthz` over plain HTTP/1.1 on `addr`. Succeeds on a 200 status.
/// Uses a raw socket so the image needs no curl.
pub async fn healthcheck(addr: SocketAddr, timeout: Duration) -> anyhow::Result<()> {
    let buf = raw_get(addr, "/healthz", timeout, 64 * 1024)
        .await
        .context("healthcheck failed")?;
    let head = String::from_utf8_lossy(&buf[..buf.len().min(64)]);
    let status = head.split_whitespace().nth(1).unwrap_or("");
    anyhow::ensure!(
        status == "200",
        "unhealthy: status line {:?}",
        head.lines().next().unwrap_or("")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use atlas_core::api::HealthDto;

    use super::*;

    async fn get_health(addr: SocketAddr, path: &str) -> (String, HealthDto) {
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(
            format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        let status = buf.split_whitespace().nth(1).unwrap().to_owned();
        let body = buf.split("\r\n\r\n").nth(1).unwrap();
        (status, serde_json::from_str(body).unwrap())
    }

    /// M5: a panic in a supervised engine part turns /healthz and /readyz to 503 `dead`, and the
    /// container healthcheck fails, instead of serving frozen data as healthy.
    #[tokio::test]
    async fn dead_engine_fails_health() {
        for fault in [
            atlas_engine::Fault::ReducerPanic,
            atlas_engine::Fault::WriterPanic,
            atlas_engine::Fault::JobPanic,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let engine = fixtures::offline_engine(&dir.path().join("atlas.redb")).unwrap();
            let app = router(AppState::new(engine.clone(), ServerConfig::default()));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, app).await });
            healthcheck(addr, Duration::from_secs(5)).await.unwrap();

            engine.inject_fault(fault).await;
            let reason = tokio::time::timeout(Duration::from_secs(10), engine.died())
                .await
                .expect("the engine reports its death");
            assert!(reason.contains("panicked"), "{fault:?}: {reason}");

            let (status, h) = get_health(addr, "/healthz").await;
            assert_eq!((status.as_str(), h.status.as_str()), ("503", "dead"));
            assert_eq!(h.reason.as_deref(), Some(reason.as_str()));
            let (status, _) = get_health(addr, "/readyz").await;
            assert_eq!(status, "503");
            assert!(healthcheck(addr, Duration::from_secs(5)).await.is_err());
            let metrics = {
                let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
                s.write_all(
                    b"GET /metrics/prometheus HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
                let mut b = String::new();
                s.read_to_string(&mut b).await.unwrap();
                b
            };
            assert!(metrics.contains("\natlas_engine_alive 0\n"), "{fault:?}");
            server.abort();
            engine.shutdown().await;
        }
    }

    #[tokio::test]
    async fn healthz_and_healthcheck() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fixtures::offline_engine(&dir.path().join("atlas.redb")).unwrap();
        let app = router(AppState::new(engine.clone(), ServerConfig::default()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });

        healthcheck(addr, Duration::from_secs(5)).await.unwrap();

        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        let body = buf.split("\r\n\r\n").nth(1).unwrap();
        let h: HealthDto = serde_json::from_str(body).unwrap();
        assert_eq!(h.status, "starting");
        assert_eq!(h.seq, 0);

        // Nothing listens on port 1.
        assert!(
            healthcheck("127.0.0.1:1".parse().unwrap(), Duration::from_secs(2))
                .await
                .is_err()
        );
        server.abort();
        engine.shutdown().await;
    }
}

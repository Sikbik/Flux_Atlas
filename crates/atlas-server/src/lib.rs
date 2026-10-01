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
pub mod config;
pub mod error;
pub mod explorer;
pub mod extract;
pub mod fixtures;
pub mod live;
pub mod metrics;
pub mod proxy;
pub mod routes;
pub mod search;
pub mod state;
pub mod views;
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

/// Opens the store, starts the engine and serves until SIGINT or SIGTERM. Shutdown closes live
/// connections with 1001 before the engine and store stop.
///
/// The process opens exactly one listening socket, `cfg.bind` (TCP; default `0.0.0.0:3000`),
/// and serves everything on it: the web app, `/api/v1/*`, `/ws`, `/healthz`, `/readyz` and
/// `/metrics/prometheus`. Upstream traffic (FluxOS API, Insight sockets, stats) is outbound
/// only. See ARCHITECTURE section 11.
pub async fn serve(cfg: ServeConfig) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(cfg.bind)
        .await
        .with_context(|| format!("binding {}", cfg.bind))?;
    serve_on(cfg, listener, shutdown_signal()).await
}

/// [`serve`] on an already bound listener, until `shutdown` resolves (tests bind an ephemeral
/// port and pass their own shutdown future). `cfg.bind` is ignored.
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
        "engine configuration"
    );
    let engine = Engine::start(engine_cfg, store.clone(), clients);
    let state = AppState::new(engine.clone(), cfg.server.clone());
    let app = router(state.clone());
    let addr = listener.local_addr().context("listener address")?;
    tracing::info!(%addr, data = %cfg.data_dir.display(), "listening");
    let st = state.clone();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown.await;
        st.begin_shutdown();
    })
    .await?;
    // Upgraded WebSocket connections are not tracked by the HTTP server: wait for them to send
    // their close frames.
    let deadline = Instant::now() + Duration::from_secs(5);
    while state.hub.connections() > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    engine.shutdown().await;
    store.flush().context("final store flush")?;
    tracing::info!("stopped");
    Ok(())
}

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

/// Container health probe: `GET /healthz` over plain HTTP/1.1 on `addr`. Succeeds on a 200 status.
/// Uses a raw socket so the image needs no curl.
pub async fn healthcheck(addr: SocketAddr, timeout: Duration) -> anyhow::Result<()> {
    let probe = async {
        let mut s = tokio::net::TcpStream::connect(addr).await?;
        s.write_all(
            format!("GET /healthz HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await?;
        let mut buf = Vec::with_capacity(512);
        s.take(64 * 1024).read_to_end(&mut buf).await?;
        anyhow::Ok(buf)
    };
    let buf = tokio::time::timeout(timeout, probe)
        .await
        .context("healthcheck timed out")??;
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

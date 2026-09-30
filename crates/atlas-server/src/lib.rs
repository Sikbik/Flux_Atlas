//! Flux Atlas HTTP and WebSocket server (skeleton).
//!
//! The router serves `/healthz` only; the `/api/v1` routes and `/ws` are to be added on top of
//! [`AppState`], reading the engine's published state and prebuilt bodies.
#![cfg_attr(test, allow(clippy::unwrap_used))]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::Context as _;
use atlas_core::api::HealthDto;
use atlas_engine::{Engine, EngineConfig, EngineHandle};
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

/// Shared request state.
#[derive(Clone, Debug)]
pub struct AppState {
    pub engine: EngineHandle,
    pub started: Instant,
}

/// Builds the router.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .with_state(state)
}

async fn healthz(State(s): State<AppState>) -> Json<HealthDto> {
    let p = s.engine.published();
    Json(HealthDto {
        status: if p.stale { "starting" } else { "ok" }.to_owned(),
        seq: s.engine.seq(),
        uptime_s: s.started.elapsed().as_secs(),
        tip_height: p.network.tip.as_ref().map(|t| t.height),
    })
}

/// `atlas serve` settings.
#[derive(Debug, Clone)]
pub struct ServeConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
}

/// Opens the store, starts the engine and serves until SIGINT or SIGTERM.
pub async fn serve(cfg: ServeConfig) -> anyhow::Result<()> {
    std::fs::create_dir_all(&cfg.data_dir)
        .with_context(|| format!("creating data dir {}", cfg.data_dir.display()))?;
    let db = cfg.data_dir.join("atlas.redb");
    let store =
        atlas_store::Store::open(&db).with_context(|| format!("opening {}", db.display()))?;
    let clients = atlas_flux::Clients::new(atlas_flux::ClientsConfig::default())
        .context("building upstream clients")?;
    let engine = Engine::start(EngineConfig::default(), store.clone(), clients);
    let app = router(AppState {
        engine: engine.clone(),
        started: Instant::now(),
    });
    let listener = tokio::net::TcpListener::bind(cfg.bind)
        .await
        .with_context(|| format!("binding {}", cfg.bind))?;
    tracing::info!(addr = %cfg.bind, data = %cfg.data_dir.display(), "listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
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
    use super::*;

    #[tokio::test]
    async fn healthz_and_healthcheck() {
        let dir = tempfile::tempdir().unwrap();
        let store = atlas_store::Store::open(dir.path().join("atlas.redb")).unwrap();
        let clients = atlas_flux::Clients::new(atlas_flux::ClientsConfig::default()).unwrap();
        let engine = Engine::start(EngineConfig::default(), store, clients);
        let app = router(AppState {
            engine: engine.clone(),
            started: Instant::now(),
        });
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

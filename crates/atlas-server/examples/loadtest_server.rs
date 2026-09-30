//! Serves a mainnet-sized fixture network (6,724 nodes, 1,900 apps) for HTTP load tests.
//!
//! ```text
//! cargo run --release -p atlas-server --example loadtest_server -- 127.0.0.1:3900 /path/to/tmpdir
//! oha -z 10s -c 64 -H 'accept-encoding: br' http://127.0.0.1:3900/api/v1/nodes.bin
//! ```

use std::net::SocketAddr;
use std::path::PathBuf;

use atlas_server::fixtures::{self, FixtureSpec};
use atlas_server::{AppState, ServerConfig, router};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let addr: SocketAddr = args.next().as_deref().unwrap_or("127.0.0.1:3900").parse()?;
    let dir = args.next().map_or_else(
        || std::env::temp_dir().join(format!("atlas-loadtest-{}", std::process::id())),
        PathBuf::from,
    );
    std::fs::create_dir_all(&dir)?;
    let db = dir.join("atlas-loadtest.redb");
    let _ = std::fs::remove_file(&db);
    let (engine, f) = fixtures::fixture_engine(
        &db,
        fixtures::offline_clients(None),
        fixtures::test_engine_config(),
        FixtureSpec::MAINNET,
    )?;
    let p = engine.published();
    for (name, body) in [
        ("bootstrap", &p.bodies.bootstrap),
        ("nodes.bin", &p.bodies.nodes_bin),
        ("mesh.bin", &p.bodies.mesh_bin),
        ("apps", &p.bodies.apps_index),
    ] {
        if let Some(b) = body {
            println!(
                "{name:<10} raw {:>8} B  br {:>7} B  zstd {:>7} B  gzip {:>7} B",
                b.raw.len(),
                b.br.len(),
                b.zstd.len(),
                b.gzip.len()
            );
        }
    }
    let mut cfg = ServerConfig::default();
    cfg.ws.max_per_ip = 100_000;
    cfg.ws.max_connections = 100_000;
    let app = router(AppState::new(engine, cfg));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!(
        "serving {} nodes / {} apps on http://{addr} (data in {})",
        f.nodes.len(),
        f.apps.len(),
        dir.display()
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    let _ = std::fs::remove_file(&db);
    Ok(())
}

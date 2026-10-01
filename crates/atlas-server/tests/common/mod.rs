//! Shared harness: a real `EngineHandle` on a temp store, seeded and published from fixtures,
//! with upstream clients pointed at a local mock (or a closed port).
#![allow(dead_code, clippy::unwrap_used, clippy::missing_panics_doc)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use atlas_engine::{EngineConfig, EngineHandle};
use atlas_flux::ClientsConfig;
use atlas_server::fixtures::{self, Fixture, FixtureSpec};
use atlas_server::watch::RecordingHooks;
use atlas_server::{AppState, ServerConfig, router};
use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get as route_get;
use bytes::Bytes;
use http_body_util::BodyExt as _;
use tower::ServiceExt as _;

pub struct Env {
    pub dir: tempfile::TempDir,
    pub engine: EngineHandle,
    pub state: AppState,
    pub app: Router,
    pub fixture: Fixture,
    pub hooks: Arc<RecordingHooks>,
}

pub struct EnvBuilder {
    pub server: ServerConfig,
    pub clients: ClientsConfig,
    pub engine: EngineConfig,
    pub spec: FixtureSpec,
}

impl Default for EnvBuilder {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            clients: fixtures::offline_clients(None),
            engine: fixtures::test_engine_config(),
            spec: FixtureSpec::SMALL,
        }
    }
}

impl EnvBuilder {
    pub fn build(self) -> Env {
        let dir = tempfile::tempdir().unwrap();
        let (engine, fixture) = fixtures::fixture_engine(
            &dir.path().join("atlas.redb"),
            self.clients,
            self.engine,
            self.spec,
        )
        .unwrap();
        let hooks = Arc::new(RecordingHooks::default());
        let state = AppState::with_hooks(engine.clone(), self.server, hooks.clone());
        let app = router(state.clone());
        Env {
            dir,
            engine,
            state,
            app,
            fixture,
            hooks,
        }
    }
}

pub fn env() -> Env {
    EnvBuilder::default().build()
}

pub struct Resp {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl Resp {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "not json ({e}): {}",
                String::from_utf8_lossy(&self.body[..self.body.len().min(300)])
            )
        })
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    pub fn error_code(&self) -> String {
        self.json()["error"]["code"]
            .as_str()
            .unwrap_or("")
            .to_owned()
    }
}

pub async fn get_with(app: &Router, uri: &str, headers: &[(&str, &str)]) -> Resp {
    let mut req = Request::builder().uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    Resp {
        status,
        headers,
        body,
    }
}

pub async fn get(app: &Router, uri: &str) -> Resp {
    get_with(app, uri, &[]).await
}

/// Serves the router on a local port with connect info (for WS and client-IP tests).
pub async fn serve(app: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });
    addr
}

pub async fn eventually<F: Fn() -> bool>(what: &str, f: F) {
    for _ in 0..400 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

// ---------------------------------------------------------------------------------------------
// Mock upstream (Insight + FluxOS) serving the research fixtures
// ---------------------------------------------------------------------------------------------

pub fn fixture_text(name: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/research/fixtures/explorer")
        .join(name);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

#[derive(Default)]
pub struct Mock {
    pub hits: Mutex<HashMap<String, u64>>,
    pub total: AtomicU64,
    pub delay_ms: AtomicU64,
    txs: HashMap<String, String>,
}

impl Mock {
    pub fn hits(&self, prefix: &str) -> u64 {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(prefix))
            .map(|(_, v)| *v)
            .sum()
    }
}

pub const MOCK_TX_FIXTURES: [&str; 7] = [
    "insight_tx_regular.json",
    "insight_tx_app_message.json",
    "insight_tx_coinbase_pon.json",
    "insight_tx_fluxnode_start_v5.json",
    "insight_tx_unconfirmed_confirm.json",
    "insight_tx_collateral_nimbus.json",
    "insight_tx_collateral_stratus.json",
];

pub fn fixture_txid(name: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(&fixture_text(name)).unwrap();
    v["txid"].as_str().unwrap().to_owned()
}

async fn mock_record(m: &Mock, key: String) {
    m.total.fetch_add(1, Ordering::SeqCst);
    *m.hits.lock().unwrap().entry(key).or_default() += 1;
    let d = m.delay_ms.load(Ordering::SeqCst);
    if d > 0 {
        tokio::time::sleep(Duration::from_millis(d)).await;
    }
}

fn json_resp(body: String) -> Response {
    ([("content-type", "application/json")], body).into_response()
}

fn fluxos_not_found() -> Response {
    json_resp(fixture_text("fluxos_daemon_error_tx_not_found.json"))
}

async fn m_tx(State(m): State<Arc<Mock>>, Path(txid): Path<String>) -> Response {
    mock_record(&m, format!("tx/{txid}")).await;
    match m.txs.get(&txid) {
        Some(b) => json_resp(b.clone()),
        None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

async fn m_addr(State(m): State<Arc<Mock>>, Path(a): Path<String>) -> Response {
    mock_record(&m, format!("addr/{a}")).await;
    json_resp(fixture_text("insight_addr_summary.json"))
}

async fn m_utxo(State(m): State<Arc<Mock>>, Path(a): Path<String>) -> Response {
    mock_record(&m, format!("utxo/{a}")).await;
    json_resp(fixture_text("insight_addr_utxo.json"))
}

async fn m_addr_txs(State(m): State<Arc<Mock>>, Path(a): Path<String>) -> Response {
    mock_record(&m, format!("addrtxs/{a}")).await;
    json_resp(fixture_text("insight_addrs_txs_from_to.json"))
}

async fn m_rich(State(m): State<Arc<Mock>>) -> Response {
    mock_record(&m, "richest".into()).await;
    json_resp(fixture_text("insight_stats_richest_addresses.json"))
}

async fn m_block(State(m): State<Arc<Mock>>, Path((id, _v)): Path<(String, String)>) -> Response {
    mock_record(&m, format!("getblock/{id}")).await;
    match id.as_str() {
        "2996812" => json_resp(fixture_text(
            "fluxos_daemon_getblock_2996812_with_start_v5.json",
        )),
        _ => fluxos_not_found(),
    }
}

async fn m_header(State(m): State<Arc<Mock>>, Path(hash): Path<String>) -> Response {
    mock_record(&m, format!("header/{hash}")).await;
    let body = fixture_text("fluxos_daemon_getblockheader.json");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    if v["data"]["hash"].as_str() == Some(hash.as_str()) {
        json_resp(body)
    } else {
        fluxos_not_found()
    }
}

async fn m_mempool(State(m): State<Arc<Mock>>) -> Response {
    mock_record(&m, "mempool".into()).await;
    json_resp(fixture_text("fluxos_daemon_getrawmempool_verbose.json"))
}

/// Starts the mock upstream; returns its base URL and state.
pub async fn mock_upstream() -> (String, Arc<Mock>) {
    let mut txs = HashMap::new();
    for f in MOCK_TX_FIXTURES {
        txs.insert(fixture_txid(f), fixture_text(f));
    }
    let m = Arc::new(Mock {
        txs,
        ..Mock::default()
    });
    let app = Router::new()
        .route("/api/tx/{txid}", route_get(m_tx))
        .route("/api/addr/{a}", route_get(m_addr))
        .route("/api/addr/{a}/utxo", route_get(m_utxo))
        .route("/api/addrs/{a}/txs", route_get(m_addr_txs))
        .route("/api/statistics/richest-addresses-list", route_get(m_rich))
        .route("/daemon/getblock/{id}/{v}", route_get(m_block))
        .route("/daemon/getblockheader/{hash}", route_get(m_header))
        .route("/daemon/getrawmempool/true", route_get(m_mempool))
        .with_state(Arc::clone(&m));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    (format!("http://{addr}"), m)
}

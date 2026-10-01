//! Explorer proxy: upstream mapping, TTL cache, single-flight, negative caching and per-IP
//! rate limits, against a local mock upstream serving the research fixtures.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use atlas_core::api::TxLite;
use atlas_core::chain::TxKind;
use atlas_core::live::LiveBody;
use atlas_core::{Amount, Hash32};
use atlas_server::ServerConfig;
use atlas_server::fixtures;
use axum::http::StatusCode;
use common::{EnvBuilder, fixture_txid, get, get_with, mock_upstream};

async fn env_with_mock(server: ServerConfig) -> (common::Env, Arc<common::Mock>) {
    let (base, mock) = mock_upstream().await;
    let e = EnvBuilder {
        server,
        clients: fixtures::offline_clients(Some(&base)),
        ..EnvBuilder::default()
    }
    .build();
    (e, mock)
}

#[tokio::test]
async fn tx_mapping_cache_and_negative_cache() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    let txid = fixture_txid("insight_tx_regular.json");
    let r = get(&e.app, &format!("/api/v1/tx/{txid}")).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let j = r.json();
    assert_eq!(j["kind"], "transfer");
    assert_eq!(j["inputs"][0]["value"], "58.71086756");
    assert!(j["fee"].is_string());
    // 8 confirmations at the fixture tip: still inside the finality window.
    assert_eq!(j["confirmations"], 8);
    assert_eq!(r.header("cache-control"), Some("public, max-age=10"));
    for _ in 0..5 {
        assert_eq!(
            get(&e.app, &format!("/api/v1/tx/{txid}")).await.status,
            StatusCode::OK
        );
    }
    assert_eq!(mock.hits(&format!("tx/{txid}")), 1, "served from cache");

    // Fluxnode start: annotated with the node when the collateral is known locally.
    let start = fixture_txid("insight_tx_fluxnode_start_v5.json");
    let s = get(&e.app, &format!("/api/v1/tx/{start}")).await.json();
    assert_eq!(s["kind"], "node_start");
    assert!(s["node_tx"]["collateral"].is_string());

    // Unknown txid: 404, and the miss is cached briefly.
    let unknown = "ab".repeat(32);
    for _ in 0..3 {
        let r = get(&e.app, &format!("/api/v1/tx/{unknown}")).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND);
        assert_eq!(r.error_code(), "not_found");
    }
    assert_eq!(mock.hits(&format!("tx/{unknown}")), 1);
    let stats = &e.state.explorer.txs.stats;
    assert!(stats.hits.load(Ordering::Relaxed) >= 7);
}

#[tokio::test]
async fn app_payment_names_its_app() {
    use atlas_core::app::{AppMessageRecord, AppSpec, PendingAppMessage};
    use atlas_core::event::AppMessageKind;
    let (e, _mock) = env_with_mock(ServerConfig::default()).await;
    let txid = fixture_txid("insight_tx_app_message.json");
    // The OP_RETURN of the live-captured payment (block 2,998,352).
    let hash = Hash32::from_hex("4a474ea9e79e7ba84ec93651b1ea13b979d413508d7cef9662c9cc14cce5bd85")
        .unwrap();
    let spec = AppSpec {
        spec_version: 8,
        name: "WebShop".into(),
        ..AppSpec::default()
    };
    // Unknown message: an app payment without a reference.
    let j = get(&e.app, &format!("/api/v1/tx/{txid}")).await.json();
    assert_eq!(j["kind"], "app_message");
    assert!(j.get("app_ref").is_none(), "{j}");
    // Pending (unmined) message: named, without height or price.
    let mut b = atlas_store::WriteBatch::default();
    b.put_pending(PendingAppMessage {
        hash,
        kind: AppMessageKind::Register,
        timestamp_ms: 1,
        received_ms: 1,
        expires_ms: u64::MAX,
        arcane_sender: None,
        spec: spec.clone(),
    });
    e.state.engine.store().commit(b).unwrap();
    let j = get(&e.app, &format!("/api/v1/tx/{txid}")).await.json();
    assert_eq!(j["app_ref"]["name"], "webshop");
    assert_eq!(j["app_ref"]["kind"], "register");
    assert!(j["app_ref"]["height"].is_null() && j["app_ref"]["paid"].is_null());
    // Mined: the permanent message decides.
    let mut b = atlas_store::WriteBatch::default();
    b.put_app_message(AppMessageRecord {
        hash,
        txid: Some(Hash32::from_hex(&txid).unwrap()),
        height: 2_998_352,
        timestamp_ms: 1,
        kind: AppMessageKind::Update,
        paid: Amount::from_flux(25) + Amount(93_000_000),
        spec,
    });
    e.state.engine.store().commit(b).unwrap();
    let j = get(&e.app, &format!("/api/v1/tx/{txid}")).await.json();
    let r = &j["app_ref"];
    assert_eq!(r["name"], "webshop");
    assert_eq!(r["display_name"], "WebShop");
    assert_eq!(r["kind"], "update");
    assert_eq!(r["spec_version"], 8);
    assert_eq!(r["message_hash"], hash.to_hex());
    assert_eq!(r["height"], 2_998_352);
    assert_eq!(r["paid"], "25.93000000");
    // A transfer never carries one.
    let t = get(
        &e.app,
        &format!("/api/v1/tx/{}", fixture_txid("insight_tx_regular.json")),
    )
    .await
    .json();
    assert!(t.get("app_ref").is_none());
}

#[tokio::test]
async fn single_flight_coalesces_concurrent_misses() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    mock.delay_ms.store(200, Ordering::SeqCst);
    let txid = fixture_txid("insight_tx_coinbase_pon.json");
    let mut tasks = Vec::new();
    for _ in 0..25 {
        let app = e.app.clone();
        let uri = format!("/api/v1/tx/{txid}");
        tasks.push(tokio::spawn(async move { get(&app, &uri).await.status }));
    }
    for t in tasks {
        assert_eq!(
            t.await.unwrap(),
            StatusCode::OK,
            "joiners are not rate limited"
        );
    }
    assert_eq!(
        mock.hits(&format!("tx/{txid}")),
        1,
        "one upstream call for 25 requests"
    );
    assert_eq!(e.state.explorer.txs.stats.misses.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn ttl_expiry_refetches() {
    let mut server = ServerConfig::default();
    server.proxy.mempool = Duration::from_millis(200);
    let (e, mock) = env_with_mock(server).await;
    let m1 = get(&e.app, "/api/v1/mempool").await;
    assert_eq!(m1.status, StatusCode::OK);
    let j = m1.json();
    assert!(j["size"].as_u64().unwrap() > 0);
    assert_eq!(
        j["txs"][0]["kind"], "unknown",
        "not seen on the live stream yet"
    );
    get(&e.app, "/api/v1/mempool").await;
    assert_eq!(mock.hits("mempool"), 1);
    tokio::time::sleep(Duration::from_millis(350)).await;

    // The live stream classifies a mempool tx; the next snapshot is enriched with it.
    let first: Hash32 = j["txs"][0]["txid"].as_str().unwrap().parse().unwrap();
    e.engine.emit(
        None,
        LiveBody::Mempool {
            txs: vec![TxLite {
                txid: first,
                value: Amount::from_flux(3),
                kind: TxKind::NodeConfirm,
                size: None,
            }],
        },
    );
    common::eventually("hub saw the mempool message", || {
        e.state.hub.mempool_tx(&first).is_some()
    })
    .await;
    let m2 = get(&e.app, "/api/v1/mempool").await.json();
    assert_eq!(mock.hits("mempool"), 2, "expired entry refetched");
    let tx = m2["txs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["txid"] == first.to_hex())
        .unwrap();
    assert_eq!(tx["kind"], "node_confirm");
    assert!(tx["size"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn per_ip_rate_limit_charges_only_upstream_misses() {
    let mut server = ServerConfig::default();
    server.limits.rps = 1;
    server.limits.burst = 2;
    let (e, mock) = env_with_mock(server).await;
    let a = fixture_txid("insight_tx_regular.json");
    let b = fixture_txid("insight_tx_coinbase_pon.json");
    let c = fixture_txid("insight_tx_collateral_nimbus.json");
    assert_eq!(
        get(&e.app, &format!("/api/v1/tx/{a}")).await.status,
        StatusCode::OK
    );
    assert_eq!(
        get(&e.app, &format!("/api/v1/tx/{b}")).await.status,
        StatusCode::OK
    );
    let limited = get(&e.app, &format!("/api/v1/tx/{c}")).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.error_code(), "rate_limited");
    assert!(
        limited
            .header("retry-after")
            .unwrap()
            .parse::<u64>()
            .unwrap()
            >= 1
    );
    // Cached answers stay free.
    for _ in 0..10 {
        assert_eq!(
            get(&e.app, &format!("/api/v1/tx/{a}")).await.status,
            StatusCode::OK
        );
    }
    // Per-client isolation is covered by the trusted-proxy test below.
    assert!(e.state.explorer.guard.rate_limited.load(Ordering::Relaxed) >= 1);
    assert_eq!(
        mock.hits(&format!("tx/{c}")),
        0,
        "the limited request never reached upstream"
    );
}

#[tokio::test]
async fn rate_limit_is_per_client_ip_behind_trusted_proxy() {
    let mut server = ServerConfig::default();
    server.limits.rps = 1;
    server.limits.burst = 1;
    server.proxies = atlas_server::config::TrustedProxies::all();
    let (e, _mock) = env_with_mock(server).await;
    let a = fixture_txid("insight_tx_regular.json");
    let b = fixture_txid("insight_tx_coinbase_pon.json");
    let x = [("x-forwarded-for", "203.0.113.5")];
    let y = [("x-forwarded-for", "10.1.1.1, 198.51.100.7")];
    assert_eq!(
        get_with(&e.app, &format!("/api/v1/tx/{a}"), &x)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        get_with(&e.app, &format!("/api/v1/tx/{b}"), &x)
            .await
            .status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        get_with(&e.app, &format!("/api/v1/tx/{b}"), &y)
            .await
            .status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn address_views() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    let addr = "t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv";
    let a = get(&e.app, &format!("/api/v1/address/{addr}")).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    let a = a.json();
    assert_eq!(a["kind"], "p2pkh");
    assert_eq!(a["balance"], "58.57148821");
    assert_eq!(a["tx_count"], 5609);
    let t = get(&e.app, &format!("/api/v1/address/{addr}/txs?limit=5"))
        .await
        .json();
    assert!(!t["items"].as_array().unwrap().is_empty());
    assert!(t["total"].as_u64().unwrap() > 0);
    let u = get(&e.app, &format!("/api/v1/address/{addr}/utxos"))
        .await
        .json();
    assert_eq!(u["total"], 1);
    assert_eq!(u["total_value"], "58.57148821");
    assert_eq!(u["items"][0]["vout"], 1);
    get(&e.app, &format!("/api/v1/address/{addr}")).await;
    assert_eq!(mock.hits("addr/"), 1);
    let rich = get(&e.app, "/api/v1/richlist").await.json();
    assert_eq!(rich["entries"][0]["rank"], 1);
    assert!(rich["entries"][0]["share_pct"].as_f64().unwrap() > 1.0);
    assert!(rich["updated_ms"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn block_from_upstream_when_not_stored() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    let r = get(&e.app, "/api/v1/blocks/2996812").await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let j = r.json();
    assert_eq!(j["block"]["height"], 2_996_812);
    assert_eq!(j["txs"][0]["kind"], "coinbase");
    assert!(
        j["node_txs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["kind"] == "start")
    );
    assert_eq!(j["confirmations"], fixtures::TIP - 2_996_812 + 1);
    assert_eq!(j["block"]["payouts"].as_array().unwrap().len(), 3);
    get(&e.app, "/api/v1/blocks/2996812").await;
    assert_eq!(mock.hits("getblock/2996812"), 1);
    assert_eq!(
        get(&e.app, "/api/v1/blocks/2996813").await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn search_probes_upstream_only_for_unknown_hashes() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    // A stored block hash: answered locally.
    let stored = e.fixture.blocks.last().unwrap().hash.to_hex();
    let r = get(&e.app, &format!("/api/v1/search?q={stored}"))
        .await
        .json();
    assert_eq!(r["hits"][0]["kind"], "block");
    assert_eq!(mock.total.load(Ordering::SeqCst), 0);
    // A collateral txid: node, locally.
    let coll = e.fixture.nodes[3].outpoint.txid.to_hex();
    let r = get(&e.app, &format!("/api/v1/search?q={coll}"))
        .await
        .json();
    assert_eq!(r["hits"][0]["kind"], "node");
    assert_eq!(mock.total.load(Ordering::SeqCst), 0);
    // Unknown hash: tx and header probed in parallel.
    let txid = fixture_txid("insight_tx_regular.json");
    let r = get(&e.app, &format!("/api/v1/search?q={txid}"))
        .await
        .json();
    assert_eq!(r["hits"][0]["kind"], "tx");
    assert_eq!(mock.hits("tx/"), 1);
    assert_eq!(mock.hits("header/"), 1);
    // A block hash known only upstream.
    let header: serde_json::Value =
        serde_json::from_str(&common::fixture_text("fluxos_daemon_getblockheader.json")).unwrap();
    let bh = header["data"]["hash"].as_str().unwrap();
    let r = get(&e.app, &format!("/api/v1/search?q={bh}")).await.json();
    assert!(
        r["hits"]
            .as_array()
            .unwrap()
            .iter()
            .any(|h| h["kind"] == "block" && h["key"] == "2996914")
    );
    // Nothing anywhere: empty, not an error.
    let r = get(&e.app, &format!("/api/v1/search?q={}", "cd".repeat(32))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.json()["hits"].as_array().unwrap().is_empty());
}

/// Explorer lookups draw from the interactive upstream lane: its own gates, counters and
/// breakers, never the engine's ingest lane (X1 M2).
#[tokio::test]
async fn explorer_uses_the_interactive_lane() {
    let (e, mock) = env_with_mock(ServerConfig::default()).await;
    assert_eq!(
        e.state.explorer.clients().lane(),
        atlas_flux::Lane::Interactive
    );
    assert_eq!(e.engine.clients().lane(), atlas_flux::Lane::Ingest);
    let txid = fixture_txid("insight_tx_regular.json");
    assert_eq!(
        get(&e.app, &format!("/api/v1/tx/{txid}")).await.status,
        StatusCode::OK
    );
    assert_eq!(mock.hits(&format!("tx/{txid}")), 1);
    let user: u64 = e
        .state
        .explorer
        .clients()
        .http
        .lane_stats()
        .iter()
        .map(|h| h.ok)
        .sum();
    assert_eq!(user, 1, "counted on the interactive lane");
    assert!(
        e.engine.clients().http.lane_stats().is_empty(),
        "nothing on the ingest lane"
    );
}

//! Wallet intelligence over HTTP: `/wallet/{addr}`, `/wallet/{addr}/parallel-assets` and
//! `/prices`, on the fixture network with fixed market sources (and with the live sources
//! pointed at a closed port, for the failure paths).
#![allow(clippy::unwrap_used, clippy::too_many_lines)]

mod common;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use atlas_server::fixtures::{self, FixtureSpec, operator_address};
use atlas_server::sources::{FixedSources, MarketSources};
use atlas_server::watch::RecordingHooks;
use atlas_server::{AppState, ServerConfig, router};
use axum::Router;
use axum::http::StatusCode;
use common::{get, get_with};

struct WalletEnv {
    _dir: tempfile::TempDir,
    app: Router,
    src: Arc<FixedSources>,
}

/// The fixture network with `sources` (fixed answers when `Some`, the offline live clients
/// otherwise).
fn env_with(fixed: bool) -> WalletEnv {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _f) = fixtures::fixture_engine(
        &dir.path().join("atlas.redb"),
        fixtures::offline_clients(None),
        fixtures::test_engine_config(),
        FixtureSpec::SMALL,
    )
    .unwrap();
    let src = Arc::new(FixedSources::default());
    let sources: Option<Arc<dyn MarketSources>> =
        fixed.then(|| src.clone() as Arc<dyn MarketSources>);
    let state = AppState::with_parts(
        engine,
        ServerConfig::default(),
        Arc::new(RecordingHooks::default()),
        sources,
    );
    WalletEnv {
        _dir: dir,
        app: router(state),
        src,
    }
}

#[tokio::test]
async fn wallet_view_of_a_mixed_fleet() {
    let e = env_with(true);
    // Operator 1 runs nodes 8 to 15: Stratus 8 and 9, Cumulus 10 to 14, Nimbus 15; node 9 runs
    // an older FluxOS.
    let addr = operator_address(1);
    let r = get(&e.app, &format!("/api/v1/wallet/{addr}")).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let w = r.json();
    assert_eq!(w["address"], addr.as_str());
    assert_eq!(w["tip_height"], fixtures::TIP);
    assert_eq!(w["nodes"].as_array().unwrap().len(), 8);
    let tiers = &w["tiers"];
    assert_eq!(
        (
            tiers["cumulus"].as_u64(),
            tiers["nimbus"].as_u64(),
            tiers["stratus"].as_u64()
        ),
        (Some(5), Some(1), Some(2))
    );

    let standing = &w["standing"];
    assert!(
        standing["balance"].is_null(),
        "the explorer is offline: unknown, not 0"
    );
    assert!(standing["liquid"].is_null());
    assert_eq!(standing["collateral_locked"], "97500.00000000");
    assert!(standing["operator_rank"].as_u64().unwrap() >= 1);
    assert!(standing["operator_count"].as_u64().unwrap() > 1);
    let share = standing["share_of_tier"]["stratus"].as_f64().unwrap();
    assert!(share > 0.0 && share < 1.0);

    let earn = &w["earnings"];
    let rate: f64 = earn["native_per_day"].as_str().unwrap().parse().unwrap();
    assert!(rate > 0.0);
    assert_eq!(earn["pa_per_day"], earn["native_per_day"]);
    // The fixture stores 40 blocks: too few for the 24 hour window, which is unknown (as the
    // operator view's is), never a partial sum.
    assert!(earn["earned_24h"].is_null() && earn["pa_earned_24h"].is_null());
    // Each realized day carries its parallel-asset accrual beside what the main chain paid.
    let days = earn["days"].as_array().unwrap();
    assert!(!days.is_empty());
    for d in days {
        assert_eq!(d["pa"], d["native"], "{d}");
    }
    let proj = earn["projection"].as_array().unwrap();
    assert_eq!(proj.len(), 365);
    assert_eq!(proj[0]["native"], earn["native_per_day"]);
    assert!(earn["reduction"]["height"].as_u64().unwrap() > fixtures::TIP.into());
    assert!(
        earn["expected_payments"].as_u64().unwrap() >= earn["received_payments"].as_u64().unwrap()
    );

    // Each confirmed node's next payment, soonest first.
    let payouts = w["payouts"].as_array().unwrap();
    assert_eq!(payouts.len(), 8);
    assert!(
        payouts
            .windows(2)
            .all(|p| p[0]["height"].as_u64() <= p[1]["height"].as_u64())
    );
    assert!(payouts[0]["node_key"].as_str().unwrap().contains(':'));

    // Node 9 runs FluxOS 8.19.1 where the network runs 8.20.0.
    let attention = w["health"]["attention"].as_array().unwrap();
    let outdated = attention.iter().any(|a| {
        a["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["kind"] == "version_outdated" && r["metric"] == "flux_os")
    });
    assert!(outdated, "{attention:?}");
    assert_eq!(
        w["health"]["healthy"].as_u64().unwrap() + attention.len() as u64,
        8
    );

    let bench = w["benchmarks"].as_array().unwrap();
    assert!(
        bench
            .iter()
            .any(|b| b["tier"] == "stratus" && b["metric"] == "eps")
    );
    assert!(bench.iter().all(|b| b["tier"] != "unknown"));
    let eps = bench
        .iter()
        .find(|b| b["tier"] == "cumulus" && b["metric"] == "eps")
        .unwrap();
    assert_eq!(eps["minimum"], 240.0);
    assert!(eps["network"]["p10"].as_f64().unwrap() <= eps["network"]["p90"].as_f64().unwrap());

    let conc = w["concentration"].as_array().unwrap();
    assert_eq!(
        conc.iter()
            .map(|c| c["by"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["country", "city", "provider"]
    );
    for c in conc {
        let hhi = c["hhi"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&hhi));
    }
    assert!(w["apps"]["instances"].as_u64().unwrap() > 0);
    let fleet = w["fleet_history"].as_array().unwrap();
    assert_eq!(fleet.last().unwrap()["stratus"], 2, "today is live");
    assert!(w["activity"].as_array().unwrap().len() <= 200);

    // A second request within 30 s is the same body (one computation per address).
    let etag = r.header("etag").unwrap().to_owned();
    let again = get_with(
        &e.app,
        &format!("/api/v1/wallet/{addr}"),
        &[("if-none-match", &etag)],
    )
    .await;
    assert_eq!(again.status, StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn wallet_without_nodes_and_bad_addresses() {
    let e = env_with(true);
    let unknown = atlas_server::search::t1_address([9; 20]);
    let r = get(&e.app, &format!("/api/v1/wallet/{unknown}")).await;
    assert_eq!(r.status, StatusCode::OK);
    let w = r.json();
    assert!(w["nodes"].as_array().unwrap().is_empty());
    assert_eq!(w["tiers"]["total"], 0);
    assert!(w["standing"]["operator_rank"].is_null());
    assert_eq!(w["earnings"]["native_per_day"], "0.00000000");
    assert_eq!(w["earnings"]["projection"].as_array().unwrap().len(), 365);
    assert!(w["payouts"].as_array().unwrap().is_empty());
    assert!(w["benchmarks"].as_array().unwrap().is_empty());
    assert_eq!(w["health"]["healthy"], 0);
    for bad in [
        "x",
        "0OIl0OIl0OIl0OIl0OIl0OIl0OIl",
        // A ZelID is not a wallet.
        &fixtures::operator_zelid(0),
    ] {
        let r = get(&e.app, &format!("/api/v1/wallet/{bad}")).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.error_code(), "bad_request");
    }
}

#[tokio::test]
async fn parallel_assets_are_cached_and_fail_cleanly() {
    let e = env_with(true);
    let addr = operator_address(1);
    let r = get(&e.app, &format!("/api/v1/wallet/{addr}/parallel-assets")).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let pa = r.json();
    let chains = pa["chains"].as_array().unwrap();
    assert_eq!(chains.len(), 10);
    let erg = chains.iter().find(|c| c["chain"] == "erg").unwrap();
    assert_eq!(erg["active"], false);
    assert_eq!(erg["name"], "Ergo");
    let claimable = pa["claimable"].as_f64().unwrap();
    let multi = pa["multi"]["claimable"].as_f64().unwrap();
    assert!(multi < claimable, "the claim-all leaves erg out");
    assert!(pa["accrual_per_day"].as_f64().unwrap() > 0.0);
    let per_chain = pa["accrual_per_chain_per_day"].as_f64().unwrap();
    assert!((per_chain * 10.0 - pa["accrual_per_day"].as_f64().unwrap()).abs() < 1e-6);
    let claims = pa["claims"].as_array().unwrap();
    assert!(
        claims
            .windows(2)
            .all(|c| c[0]["time_ms"].as_u64() >= c[1]["time_ms"].as_u64())
    );
    assert!(
        chains
            .iter()
            .all(|c| c["explorer_tx"].as_str().unwrap().contains("{txid}"))
    );

    // Cached: the second request does not ask Fusion; the fee table is asked once.
    let r2 = get(&e.app, &format!("/api/v1/wallet/{addr}/parallel-assets")).await;
    assert_eq!(r2.status, StatusCode::OK);
    assert_eq!(e.src.count(0), 1);
    assert_eq!(e.src.count(1), 1);

    // Fusion down: a new address answers 503 `upstream_unavailable`; the cached one is served.
    e.src.fail.store(true, Ordering::SeqCst);
    let other = operator_address(2);
    let down = get(&e.app, &format!("/api/v1/wallet/{other}/parallel-assets")).await;
    assert_eq!(down.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(down.error_code(), "upstream_unavailable");
    assert!(down.header("retry-after").is_some());
    let cached = get(&e.app, &format!("/api/v1/wallet/{addr}/parallel-assets")).await;
    assert_eq!(cached.status, StatusCode::OK);
    // The rest of the API is untouched.
    assert_eq!(
        get(&e.app, &format!("/api/v1/wallet/{other}")).await.status,
        StatusCode::OK
    );

    let bad = get(&e.app, "/api/v1/wallet/notanaddress/parallel-assets").await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn live_sources_offline_answer_upstream_unavailable() {
    let e = env_with(false);
    let addr = operator_address(1);
    let r = get(&e.app, &format!("/api/v1/wallet/{addr}/parallel-assets")).await;
    assert_eq!(
        r.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(r.error_code(), "upstream_unavailable");
    // No CoinGecko and no published price: the same error.
    let p = get(&e.app, "/api/v1/prices").await;
    assert_eq!(p.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(p.error_code(), "upstream_unavailable");
    // The wallet itself does not depend on either.
    assert_eq!(
        get(&e.app, &format!("/api/v1/wallet/{addr}")).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn prices_and_their_cache() {
    let e = env_with(true);
    let r = get(&e.app, "/api/v1/prices").await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let p = r.json();
    let spot = p["spot"].as_object().unwrap();
    assert_eq!(spot.len(), 16);
    for c in ["usd", "eur", "gbp", "jpy", "krw", "idr", "btc"] {
        assert!(spot[c].as_f64().unwrap() > 0.0, "{c}");
    }
    assert!(p["change_24h_pct"].is_number());
    let h = p["history"].as_array().unwrap();
    assert_eq!(h.len(), 365);
    assert!(
        h.windows(2)
            .all(|w| w[0]["day_ms"].as_u64() < w[1]["day_ms"].as_u64())
    );
    // Served from the kept copies: CoinGecko is asked once per lifetime.
    get(&e.app, "/api/v1/prices").await;
    e.src.fail.store(true, Ordering::SeqCst);
    let again = get(&e.app, "/api/v1/prices").await;
    assert_eq!(again.status, StatusCode::OK, "the last good copy");
    assert_eq!((e.src.count(2), e.src.count(3)), (1, 1));
}

#[tokio::test]
async fn a_fleet_of_1500_nodes_stays_fast() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = fixtures::Fixture::build(FixtureSpec::MAINNET);
    let big = operator_address(9_999);
    for n in f.nodes.iter_mut().take(1_500) {
        n.payment_address = big.as_str().into();
    }
    let (engine, _f) = fixtures::fixture_engine_from(
        &dir.path().join("atlas.redb"),
        fixtures::offline_clients(None),
        fixtures::test_engine_config(),
        f,
        |_| Ok(()),
    )
    .unwrap();
    let src: Arc<dyn MarketSources> = Arc::new(FixedSources::default());
    let state = AppState::with_parts(
        engine,
        ServerConfig::default(),
        Arc::new(RecordingHooks::default()),
        Some(src),
    );
    let app = router(state);
    let t = std::time::Instant::now();
    let r = get(&app, &format!("/api/v1/wallet/{big}")).await;
    let cold = t.elapsed();
    assert_eq!(r.status, StatusCode::OK);
    let w = r.json();
    assert_eq!(w["nodes"].as_array().unwrap().len(), 1_500);
    assert!(w["activity"].as_array().unwrap().len() <= 200);
    let t = std::time::Instant::now();
    assert_eq!(
        get(&app, &format!("/api/v1/wallet/{big}")).await.status,
        StatusCode::OK
    );
    let warm = t.elapsed();
    eprintln!(
        "1,500-node wallet: cold {cold:?}, warm {warm:?}, {} bytes",
        r.body.len()
    );
    // Generous bounds (debug builds, a shared CI machine): the point is no quadratic path.
    assert!(cold < std::time::Duration::from_secs(10), "{cold:?}");
    assert!(warm < std::time::Duration::from_millis(500), "{warm:?}");
}

//! Explorer analytics over HTTP: `/chain/daily`, `/richlist` (shared copy, stale while the
//! explorer fails) and `/richlist/movers` with the daily rich-list snapshots, on the fixture
//! network with fixed sources.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use atlas_core::Amount;
use atlas_core::now_ms;
use atlas_server::fixtures::{self, FixtureSpec};
use atlas_server::richlist::{SnapshotStep, snapshot_step};
use atlas_server::sources::{FIXED_SERIES_FROM_MS, FixedSources, MarketSources};
use atlas_server::watch::RecordingHooks;
use atlas_server::{AppState, ServerConfig, router};
use atlas_store::{RichHolding, RichSnapshot, WriteBatch};
use axum::Router;
use axum::http::StatusCode;
use common::{get, get_with};

const DAY_MS: u64 = 86_400_000;

struct Env {
    _dir: tempfile::TempDir,
    app: Router,
    state: AppState,
    src: Arc<FixedSources>,
}

fn env(server: ServerConfig) -> Env {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _f) = fixtures::fixture_engine(
        &dir.path().join("atlas.redb"),
        fixtures::offline_clients(None),
        fixtures::test_engine_config(),
        FixtureSpec::SMALL,
    )
    .unwrap();
    let src = Arc::new(FixedSources::default());
    let state = AppState::with_parts(
        engine,
        server,
        Arc::new(RecordingHooks::default()),
        Some(src.clone() as Arc<dyn MarketSources>),
    );
    Env {
        _dir: dir,
        app: router(state.clone()),
        state,
        src,
    }
}

#[tokio::test]
async fn chain_daily_windows_share_one_fetch() {
    let e = env(ServerConfig::default());
    let today = now_ms() / DAY_MS * DAY_MS;
    let r = get(&e.app, "/api/v1/chain/daily").await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(r.header("cache-control"), Some("public, max-age=600"));
    let j = r.json();
    let days = j["days"].as_array().unwrap();
    assert_eq!(days.len(), 365, "the default window");
    assert_eq!(days.last().unwrap()["day_ms"], today);
    assert_eq!(j["first_day_ms"], FIXED_SERIES_FROM_MS);
    let d = &days[0];
    for key in [
        "transactions",
        "blocks",
        "fees",
        "fees_total",
        "outputs",
        "supply",
        "difficulty",
        "network_hash",
    ] {
        assert!(d[key].is_number(), "{key}: {d}");
    }
    assert!(j["generated_ms"].as_u64().unwrap() > 0);
    let n = |q: &str| {
        let app = e.app.clone();
        let q = q.to_owned();
        async move {
            get(&app, &format!("/api/v1/chain/daily?days={q}"))
                .await
                .json()["days"]
                .as_array()
                .unwrap()
                .len()
        }
    };
    assert_eq!(n("30").await, 30);
    assert_eq!(n("90").await, 90);
    assert_eq!(n("365").await, 365);
    let all = get(&e.app, "/api/v1/chain/daily?days=all").await.json();
    let all = all["days"].as_array().unwrap();
    assert_eq!(all[0]["day_ms"], FIXED_SERIES_FROM_MS);
    // The network-hash series starts later: unknown is null, never 0.
    assert!(all[0]["network_hash"].is_null());
    assert!(all[0]["supply"].is_number());
    assert_eq!(e.src.count(4), 6, "six series calls for every window");
    // ETag revalidation.
    let r = get(&e.app, "/api/v1/chain/daily?days=30").await;
    let etag = r.header("etag").unwrap().to_owned();
    let r = get_with(
        &e.app,
        "/api/v1/chain/daily?days=30",
        &[("if-none-match", &etag)],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_MODIFIED);
    // Anything else is a 400.
    for bad in ["7", "all-time", "-1"] {
        let r = get(&e.app, &format!("/api/v1/chain/daily?days={bad}")).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.error_code(), "bad_request");
    }
}

#[tokio::test]
async fn chain_daily_without_any_copy_is_an_upstream_error() {
    let e = env(ServerConfig::default());
    e.src.fail.store(true, Ordering::SeqCst);
    let r = get(&e.app, "/api/v1/chain/daily").await;
    assert!(r.status.is_server_error(), "{:?}", r.status);
    assert_eq!(r.error_code(), "upstream_unavailable");
    // The failure is not retried at once: a second request makes no calls.
    let calls = e.src.count(4);
    let r = get(&e.app, "/api/v1/chain/daily").await;
    assert!(r.status.is_server_error());
    assert_eq!(e.src.count(4), calls);
}

#[tokio::test]
async fn richlist_is_shared_and_kept_while_the_explorer_fails() {
    let mut cfg = ServerConfig::default();
    cfg.proxy.richlist = Duration::from_millis(150);
    let e = env(cfg);
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let app = e.app.clone();
        tasks.push(tokio::spawn(
            async move { get(&app, "/api/v1/richlist").await },
        ));
    }
    let mut first = None;
    for t in tasks {
        let r = t.await.unwrap();
        assert_eq!(r.status, StatusCode::OK);
        first = Some(r.json());
    }
    assert_eq!(
        e.src.count(5),
        1,
        "concurrent first requests share one fill"
    );
    let j = first.unwrap();
    assert_eq!(j["stale"], false);
    assert_eq!(j["entries"].as_array().unwrap().len(), 1_000);
    assert_eq!(j["entries"][0]["rank"], 1);
    let updated = j["updated_ms"].as_u64().unwrap();
    // Near the top are fixture operators: they run nodes.
    assert!(
        j["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["node_count"].as_u64().unwrap() > 0)
    );
    // The explorer goes down: the expired copy is served, then flagged stale once the refresh
    // failed, never an error.
    e.src.fail.store(true, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let r = get(&e.app, "/api/v1/richlist").await;
    assert_eq!(r.status, StatusCode::OK);
    common::eventually("the refresh to fail", || e.src.count(5) == 2).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let j = get(&e.app, "/api/v1/richlist").await.json();
    assert_eq!(j["stale"], true);
    assert_eq!(j["updated_ms"], updated, "the last good copy");
    assert_eq!(e.src.count(5), 2, "no retry inside the pause");
    // Back up: the next refresh replaces the copy.
    e.src.fail.store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(1_100)).await;
    get(&e.app, "/api/v1/richlist").await;
    common::eventually("the refresh", || e.src.count(5) == 3).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let j = get(&e.app, "/api/v1/richlist").await.json();
    assert_eq!(j["stale"], false);
    assert!(j["updated_ms"].as_u64().unwrap() > updated);
}

#[tokio::test]
async fn richlist_without_any_copy_is_an_upstream_error() {
    let e = env(ServerConfig::default());
    e.src.fail.store(true, Ordering::SeqCst);
    let r = get(&e.app, "/api/v1/richlist").await;
    assert!(r.status.is_server_error(), "{:?}", r.status);
    assert_eq!(r.error_code(), "upstream");
}

fn seed(e: &Env, days: &[u64]) {
    let today = now_ms() / DAY_MS * DAY_MS;
    let mut b = WriteBatch::new();
    for &back in days {
        let day_ms = today - back * DAY_MS;
        let rows = FixedSources::richest_on(day_ms)
            .into_iter()
            .map(|r| RichHolding {
                balance: Amount::from_flux_f64(r.balance).unwrap(),
                address: r.address,
            })
            .collect();
        b.put_rich_snapshot(&RichSnapshot {
            day_ms,
            fetched_ms: day_ms + 60_000,
            supply: Some(Amount::from_flux(420_000_000)),
            rows,
        })
        .unwrap();
    }
    e.state.engine.store().commit(b).unwrap();
}

#[tokio::test]
async fn movers_compare_the_newest_snapshot_with_the_window() {
    let e = env(ServerConfig::default());
    // No snapshot yet: an empty answer the UI hides.
    let j = get(&e.app, "/api/v1/richlist/movers?window=7d")
        .await
        .json();
    assert_eq!(j["snapshots"], 0);
    assert!(j["from_ms"].is_null());
    assert!(j["gainers"].as_array().unwrap().is_empty());
    assert!(j["concentration"].as_array().unwrap().is_empty());
    let today = now_ms() / DAY_MS * DAY_MS;
    seed(&e, &[0, 1, 3, 7, 30]);
    for (window, back) in [("1d", 1u64), ("7d", 7), ("30d", 30)] {
        let r = get(&e.app, &format!("/api/v1/richlist/movers?window={window}")).await;
        assert_eq!(r.status, StatusCode::OK);
        let j = r.json();
        assert_eq!(j["window"], window);
        assert_eq!(j["snapshots"], 5);
        assert_eq!(j["to_ms"], today + 60_000);
        assert_eq!(j["from_ms"], today - back * DAY_MS + 60_000);
        let g = j["gainers"].as_array().unwrap();
        let l = j["losers"].as_array().unwrap();
        assert!(!g.is_empty() && g.len() <= 15, "{window}");
        assert!(!l.is_empty() && l.len() <= 15, "{window}");
        assert!(g[0]["delta"].as_str().unwrap().parse::<f64>().unwrap() > 0.0);
        assert!(l[0]["delta"].as_str().unwrap().starts_with('-'));
        let c = j["concentration"].as_array().unwrap();
        assert_eq!(c.len(), 5);
        assert_eq!(c[0]["day_ms"], today - 30 * DAY_MS);
        let top10 = c[4]["top10_pct"].as_f64().unwrap();
        let top1000 = c[4]["top1000_pct"].as_f64().unwrap();
        assert!(
            top10 > 30.0 && top10 < top1000 && top1000 < 100.0,
            "{top10} {top1000}"
        );
        if window == "30d" {
            assert!(!j["entered"].as_array().unwrap().is_empty());
            assert!(!j["left"].as_array().unwrap().is_empty());
            let ranks: Vec<u64> = j["entered"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x["rank"].as_u64().unwrap())
                .collect();
            assert!(ranks.windows(2).all(|w| w[0] < w[1]), "by rank");
        }
    }
    // The 7-day window falls back to the closest stored day when the exact one is missing.
    let e2 = env(ServerConfig::default());
    seed(&e2, &[0, 5, 10]);
    let j = get(&e2.app, "/api/v1/richlist/movers").await.json();
    assert_eq!(j["window"], "7d", "the default window");
    assert_eq!(j["from_ms"], today - 5 * DAY_MS + 60_000);
    let r = get(&e2.app, "/api/v1/richlist/movers?window=2d").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // One snapshot only: empty lists, but the concentration row.
    let e3 = env(ServerConfig::default());
    seed(&e3, &[0]);
    let j = get(&e3.app, "/api/v1/richlist/movers?window=1d")
        .await
        .json();
    assert!(j["from_ms"].is_null());
    assert!(j["losers"].as_array().unwrap().is_empty());
    assert_eq!(j["concentration"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn the_daily_snapshot_is_stored_once_through_the_writer() {
    let e = env(ServerConfig::default());
    let today = now_ms() / DAY_MS * DAY_MS;
    assert_eq!(
        snapshot_step(&e.state).await.unwrap(),
        SnapshotStep::Stored(today)
    );
    let store = e.state.engine.store().clone();
    common::eventually("the snapshot commit", || {
        store.rich_snapshot_days().unwrap() == vec![today]
    })
    .await;
    assert_eq!(
        snapshot_step(&e.state).await.unwrap(),
        SnapshotStep::Present(today)
    );
    let snap = store.rich_snapshot(today).unwrap().unwrap();
    assert_eq!(snap.rows.len(), 1_000);
    assert_eq!(snap.supply, Some(Amount::from_flux(420_590_294)));
    assert_eq!(e.src.count(5), 1, "the snapshot reused the shared copy");
    // The explorer down with no copy: nothing stored, an error to retry later.
    let e2 = env(ServerConfig::default());
    e2.src.fail.store(true, Ordering::SeqCst);
    assert!(snapshot_step(&e2.state).await.is_err());
    assert!(
        e2.state
            .engine
            .store()
            .rich_snapshot_days()
            .unwrap()
            .is_empty()
    );
}

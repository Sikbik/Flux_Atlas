//! The network hub endpoints (B13) against a fixture-published engine.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use atlas_server::fixtures::{TIP, operator_address, operator_zelid};
use axum::http::StatusCode;
use common::{env, get, get_with};

#[tokio::test]
async fn operators_leaderboard() {
    let e = env();
    let r = get(&e.app, "/api/v1/network/operators").await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.header("cache-control"), Some("public, max-age=5"));
    let d = r.json();
    assert_eq!(d["by"], "zelid");
    let total = d["total_nodes"].as_u64().unwrap();
    let rows = d["operators"].as_array().unwrap();
    // Every fixture operator reports a ZelID on 6 of its 8 nodes: the other two group by address.
    assert_eq!(d["total_operators"].as_u64().unwrap() as usize, rows.len());
    assert_eq!(
        rows.iter()
            .map(|o| o["nodes"].as_u64().unwrap())
            .sum::<u64>(),
        total
    );
    let first = &rows[0];
    assert_eq!(first["rank"], 1);
    assert_eq!(first["key_kind"], "zelid");
    assert!(first["key"].as_str().unwrap().starts_with('1'));
    assert!(
        first["native_per_day"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap()
            > 0.0
    );
    assert!(first["top_country"]["code"].is_string());
    assert!(first["top_provider"]["label"].is_string());
    assert_eq!(first["addresses"], 1);
    assert!(rows.iter().any(|o| o["key_kind"] == "address"));
    // Ranked by nodes, then key.
    assert!(rows.windows(2).all(|w| {
        let (a, b) = (w[0]["nodes"].as_u64(), w[1]["nodes"].as_u64());
        a > b || (a == b && w[0]["key"].as_str() < w[1]["key"].as_str())
    }));

    let by_address = get(&e.app, "/api/v1/network/operators?by=address&limit=3")
        .await
        .json();
    assert_eq!(by_address["by"], "address");
    let rows = by_address["operators"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|o| o["key_kind"] == "address"));
    let keys: Vec<&str> = rows.iter().map(|o| o["key"].as_str().unwrap()).collect();
    assert!(
        (0..15).any(|k| keys.contains(&operator_address(k).as_str())),
        "{keys:?}"
    );
    assert!(
        !(0..15).any(|k| keys.contains(&operator_zelid(k).as_str())),
        "{keys:?}"
    );

    // Revalidation and bad queries.
    let etag = r.header("etag").unwrap().to_owned();
    let nm = get_with(
        &e.app,
        "/api/v1/network/operators",
        &[("if-none-match", &etag)],
    )
    .await;
    assert_eq!(nm.status, StatusCode::NOT_MODIFIED);
    for bad in ["limit=0", "limit=501", "by=owner", "limit=x"] {
        assert_eq!(
            get(&e.app, &format!("/api/v1/network/operators?{bad}"))
                .await
                .status,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }
}

#[tokio::test]
async fn nodes_overview() {
    let e = env();
    let r = get(&e.app, "/api/v1/network/nodes-overview").await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let d = r.json();
    assert!(!d["benchmarks"].as_array().unwrap().is_empty());
    let b = &d["benchmarks"][0];
    assert_eq!(b["tier"], "cumulus");
    assert_eq!(b["metric"], "eps");
    assert!(b["nodes"].as_u64().unwrap() > 0);
    assert_eq!(b["minimum"], 240.0);
    let age = d["age"].as_array().unwrap();
    assert_eq!(age.len(), 6);
    assert_eq!(age[0]["label"], "<7d");
    assert_eq!(age[5]["max_days"], serde_json::Value::Null);
    // The fixture's nodes were all confirmed 60 days ago.
    assert_eq!(
        age[2]["nodes"].as_u64().unwrap(),
        d["status"]["confirmed"].as_u64().unwrap()
    );
    assert_eq!(d["newest"].as_array().unwrap().len(), 10);
    let churn = d["churn"].as_array().unwrap();
    assert_eq!(churn[0]["window"], "24h");
    assert_eq!(churn[1]["window"], "7d");
    // The fixture stores node 0's confirmation 20 days ago and confirmed its nodes 60 days
    // ago: outside both windows.
    assert_eq!(churn[1]["joined"], 0);
    // It records no minute metrics rows, so nothing says the server ran through the window.
    assert_eq!(churn[1]["complete"], false);
    let s = &d["status"];
    assert!(s["unreachable"].as_u64().unwrap() >= 1);
    assert!(s["healthy"].as_u64().unwrap() > 0);
    assert!(s["started"].as_u64().unwrap() >= 1);
}

#[tokio::test]
async fn apps_overview() {
    let e = env();
    let r = get(&e.app, "/api/v1/network/apps-overview").await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let d = r.json();
    assert_eq!(d["tip_height"], TIP);
    assert_eq!(d["history_complete"], true);
    // 12 apps over 7 owners, 3 instances each.
    assert_eq!(d["total_owners"], 7);
    let owners = d["owners"].as_array().unwrap();
    assert_eq!(owners.len(), 7);
    assert_eq!(owners[0]["apps"], 2);
    assert_eq!(owners[0]["instances"], 6);
    let instances: u64 = d["countries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["instances"].as_u64().unwrap())
        .sum::<u64>()
        + d["unlocated_instances"].as_u64().unwrap();
    assert_eq!(instances, 36);
    // `used` and `network` are the capacity view's figures.
    let c = get(&e.app, "/api/v1/network/capacity").await.json();
    assert_eq!(
        d["resources"]["network"]["cores"].as_f64(),
        c["total"]["cores"].as_f64()
    );
    let used_ram = d["resources"]["used"]["ram_gb"].as_f64().unwrap();
    assert!((used_ram - c["apps_locked"]["ram_mb"].as_f64().unwrap() / 1024.0).abs() < 1e-9);
    let days = d["deployments"].as_array().unwrap();
    assert_eq!(days.len(), 90);
    assert_eq!(
        days.iter()
            .map(|x| x["registered"].as_u64().unwrap() + x["updated"].as_u64().unwrap())
            .sum::<u64>(),
        3
    );
    let newest = d["newest"].as_array().unwrap();
    assert_eq!(newest.len(), 1);
    assert_eq!(newest[0]["name"], "kadenanode");
    assert_eq!(newest[0]["display_name"], "KadenaNode");
    assert_eq!(newest[0]["instances"], 3);
    let expiring = d["expiring"].as_array().unwrap();
    assert_eq!(expiring.len(), 10);
    assert!(
        expiring
            .windows(2)
            .all(|w| w[0]["blocks_left"].as_u64() <= w[1]["blocks_left"].as_u64())
    );
    assert_eq!(d["enterprise"]["apps"], 0);
}

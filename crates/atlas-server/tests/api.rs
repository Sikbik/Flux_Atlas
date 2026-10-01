//! Handler tests against a fixture-published engine (no network).
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use std::io::Read as _;

use atlas_core::codec::mesh_bin::decode_mesh_bin;
use atlas_core::codec::nodes_bin::decode_nodes_bin;
use atlas_core::node::NodeStatus;
use atlas_server::fixtures::{self, TIP, operator_address, operator_zelid};
use axum::http::StatusCode;
use common::{env, get, get_with};

// ---------------------------------------------------------------------------------------------
// Hot bodies: ETag, 304, negotiation
// ---------------------------------------------------------------------------------------------

fn decode(enc: Option<&str>, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    match enc {
        None => out.extend_from_slice(body),
        Some("br") => {
            brotli::Decompressor::new(body, 4096)
                .read_to_end(&mut out)
                .unwrap();
        }
        Some("gzip") => {
            flate2::read::GzDecoder::new(body)
                .read_to_end(&mut out)
                .unwrap();
        }
        Some("zstd") => out = zstd::stream::decode_all(body).unwrap(),
        Some(other) => panic!("unexpected encoding {other}"),
    }
    out
}

#[tokio::test]
async fn hot_bodies_negotiate_and_revalidate() {
    let e = env();
    for path in [
        "/api/v1/bootstrap",
        "/api/v1/nodes.bin",
        "/api/v1/mesh.bin",
        "/api/v1/apps",
    ] {
        let plain = get(&e.app, path).await;
        assert_eq!(plain.status, StatusCode::OK, "{path}");
        assert_eq!(plain.header("content-encoding"), None);
        assert_eq!(plain.header("vary"), Some("accept-encoding"));
        assert_eq!(plain.header("cache-control"), Some("public, no-cache"));
        assert_eq!(plain.header("access-control-allow-origin"), Some("*"));
        let etag = plain.header("etag").unwrap().to_owned();
        assert!(etag.starts_with('"') && etag.len() == 34, "{etag}");

        for (accept, want) in [
            ("gzip, deflate, br, zstd", Some("zstd")),
            ("gzip, br", Some("br")),
            ("gzip", Some("gzip")),
            ("zstd;q=0, br;q=0, gzip", Some("gzip")),
            ("identity", None),
        ] {
            let r = get_with(&e.app, path, &[("accept-encoding", accept)]).await;
            assert_eq!(r.status, StatusCode::OK);
            assert_eq!(r.header("content-encoding"), want, "{path} {accept}");
            assert_eq!(
                r.header("etag"),
                Some(etag.as_str()),
                "same entity, same etag"
            );
            assert_eq!(
                decode(want, &r.body),
                plain.body.to_vec(),
                "{path} {accept}"
            );
        }

        let nm = get_with(&e.app, path, &[("if-none-match", &etag)]).await;
        assert_eq!(nm.status, StatusCode::NOT_MODIFIED, "{path}");
        assert!(nm.body.is_empty());
        assert_eq!(nm.header("etag"), Some(etag.as_str()));
        let weak = format!("W/{etag}, \"other\"");
        let nm = get_with(&e.app, path, &[("if-none-match", &weak)]).await;
        assert_eq!(nm.status, StatusCode::NOT_MODIFIED);
        let miss = get_with(&e.app, path, &[("if-none-match", "\"nope\"")]).await;
        assert_eq!(miss.status, StatusCode::OK);
    }

    let b = get(&e.app, "/api/v1/bootstrap").await.json();
    assert_eq!(b["network"]["tip"]["height"], TIP);
    assert_eq!(b["stale"], false);
    assert_eq!(b["tiers"].as_array().unwrap().len(), 3);
    let nodes = decode_nodes_bin(&get(&e.app, "/api/v1/nodes.bin").await.body).unwrap();
    assert_eq!(nodes.len(), e.fixture.nodes.len());
    let mesh = decode_mesh_bin(&get(&e.app, "/api/v1/mesh.bin").await.body).unwrap();
    assert_eq!(mesh.edge_count(), e.fixture.mesh.len());
    let apps = get(&e.app, "/api/v1/apps").await.json();
    assert_eq!(apps["apps"].as_array().unwrap().len(), e.fixture.apps.len());
}

#[tokio::test]
async fn hot_bodies_fall_back_to_published_state() {
    let e = env();
    let mut p = (*e.engine.published()).clone();
    p.bodies = atlas_engine::PrebuiltBodies::default();
    e.engine.publish(p);
    let b = get(&e.app, "/api/v1/bootstrap").await;
    assert_eq!(b.status, StatusCode::OK);
    assert_eq!(
        b.json()["network"]["node_count"],
        e.fixture.summary().node_count
    );
    let etag = b.header("etag").unwrap().to_owned();
    let again = get_with(&e.app, "/api/v1/bootstrap", &[("if-none-match", &etag)]).await;
    assert_eq!(
        again.status,
        StatusCode::NOT_MODIFIED,
        "derived body is cached per publish"
    );
    let n = get_with(&e.app, "/api/v1/nodes.bin", &[("accept-encoding", "br")]).await;
    assert_eq!(n.header("content-encoding"), Some("br"));
    assert_eq!(
        decode_nodes_bin(&decode(Some("br"), &n.body))
            .unwrap()
            .len(),
        e.fixture.nodes.len()
    );
    assert_eq!(
        decode_mesh_bin(&get(&e.app, "/api/v1/mesh.bin").await.body)
            .unwrap()
            .edge_count(),
        0
    );
    assert_eq!(get(&e.app, "/api/v1/apps").await.status, StatusCode::OK);
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn nodes_table_filters_sorts_and_pages() {
    let e = env();
    let all = get(&e.app, "/api/v1/nodes?limit=1000").await.json();
    assert_eq!(all["total"], e.fixture.nodes.len());
    assert!(all["next_cursor"].is_null());

    let c = get(&e.app, "/api/v1/nodes?tier=cumulus&limit=1000")
        .await
        .json();
    assert!(
        c["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["tier"] == "cumulus")
    );

    let de = get(&e.app, "/api/v1/nodes?country=de&limit=1000")
        .await
        .json();
    assert!(de["total"].as_u64().unwrap() > 0);
    assert!(
        de["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["country_code"] == "DE")
    );

    // One ASN, two org spellings (DE + FI).
    let asn = get(&e.app, "/api/v1/nodes?org=AS24940&limit=1000")
        .await
        .json();
    let countries: std::collections::BTreeSet<String> = asn["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["country_code"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(countries.into_iter().collect::<Vec<_>>(), vec!["DE", "FI"]);

    let host = get(&e.app, "/api/v1/nodes?q=5.0.0.1:").await.json();
    assert_eq!(host["total"], 2, "the UPnP pair");

    let st = get(&e.app, "/api/v1/nodes?status=started&limit=1000")
        .await
        .json();
    assert!(
        st["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["status"] == "started")
    );

    let ranked = get(
        &e.app,
        "/api/v1/nodes?tier=stratus&sort=rank&desc=true&limit=5",
    )
    .await
    .json();
    let ranks: Vec<u64> = ranked["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["rank"].as_u64().unwrap())
        .collect();
    assert!(ranks.windows(2).all(|w| w[0] > w[1]), "{ranks:?}");

    let p1 = get(&e.app, "/api/v1/nodes?limit=50").await.json();
    assert_eq!(p1["items"].as_array().unwrap().len(), 50);
    let cursor = p1["next_cursor"].as_str().unwrap().to_owned();
    let p2 = get(&e.app, &format!("/api/v1/nodes?limit=50&cursor={cursor}"))
        .await
        .json();
    assert_eq!(p2["items"][0]["id"], 50);

    for bad in [
        "/api/v1/nodes?tier=bogus",
        "/api/v1/nodes?limit=0",
        "/api/v1/nodes?limit=5000",
        "/api/v1/nodes?cursor=abc",
        "/api/v1/nodes?country=Germany",
        "/api/v1/nodes?sort=nope",
        "/api/v1/nodes?desc=maybe",
    ] {
        let r = get(&e.app, bad).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.error_code(), "bad_request", "{bad}");
        assert_eq!(r.header("cache-control"), Some("no-store"));
    }
    let long_q = format!("/api/v1/nodes?q={}", "a".repeat(3000));
    assert_eq!(get(&e.app, &long_q).await.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn node_detail_by_every_key_form() {
    let e = env();
    let n0 = &e.fixture.nodes[0];
    let txid = n0.outpoint.txid.to_hex();
    for key in [
        "0".to_owned(),
        "5.0.0.1:16127".to_owned(),
        format!("{txid}:0"),
        format!("{txid}-0"),
        format!("COutPoint({txid},%200)"),
        txid.clone(),
    ] {
        let r = get(&e.app, &format!("/api/v1/nodes/{key}")).await;
        assert_eq!(r.status, StatusCode::OK, "{key}: {:?}", r.body);
        assert_eq!(r.json()["node"]["id"], 0, "{key}");
    }
    let d = get(&e.app, "/api/v1/nodes/0").await.json();
    assert_eq!(d["co_hosted"], serde_json::json!([1]));
    assert!(d["payment_eta"]["eta_blocks"].as_u64().unwrap() >= 1);
    assert!(d["payment_eta"]["tier_size"].as_u64().unwrap() > 0);
    assert!(d["expires_in_blocks"].as_u64().is_some());
    assert_eq!(d["node"]["ui_url"], "http://5.0.0.1:16126");
    assert!(
        d["apps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["name"] == "kadenanode")
    );
    let kinds: Vec<&str> = d["recent_events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["kind"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains(&"node_heartbeat") && kinds.contains(&"node_paid"),
        "{kinds:?}"
    );

    assert_eq!(
        get(&e.app, "/api/v1/nodes/5.0.0.1:16137").await.json()["node"]["id"],
        1
    );
    // A bare IP means the default API port, like the node list itself.
    assert_eq!(
        get(&e.app, "/api/v1/nodes/5.0.0.1").await.json()["node"]["id"],
        0
    );
    // Shared collateral txid.
    let shared = e.fixture.nodes[5].outpoint.txid.to_hex();
    assert_eq!(
        get(&e.app, &format!("/api/v1/nodes/{shared}")).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, &format!("/api/v1/nodes/{shared}:1"))
            .await
            .json()["node"]["id"],
        6
    );
    assert_eq!(
        get(&e.app, "/api/v1/nodes/999999").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/nodes/9.9.9.9").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/nodes/not-a-node").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, "/api/v1/nodes/99999999999").await.status,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn node_history_payments_peers() {
    let e = env();
    let h = get(&e.app, "/api/v1/nodes/0/history").await;
    assert_eq!(h.status, StatusCode::OK);
    let h = h.json();
    let up = h["uptime_pct"].as_f64().unwrap();
    assert!(up > 90.0 && up < 100.0, "an outage of 6 h in 7 days: {up}");
    assert!(
        h["segments"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["status"] == "offline")
    );
    let month = get(
        &e.app,
        &format!(
            "/api/v1/nodes/0/history?from={}",
            e.fixture.now_ms - 25 * 86_400_000
        ),
    )
    .await
    .json();
    assert!(
        month["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["kind"] == "node_started")
    );
    for bad in [
        "/api/v1/nodes/0/history?from=10&to=5",
        "/api/v1/nodes/0/history?from=0&to=40000000000",
        "/api/v1/nodes/0/history?from=abc",
    ] {
        assert_eq!(
            get(&e.app, bad).await.status,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }

    // A node paid in the fixture blocks.
    let paid = e.fixture.blocks.last().unwrap().payouts[0].node.unwrap();
    let p = get(&e.app, &format!("/api/v1/nodes/{paid}/payments?limit=1"))
        .await
        .json();
    assert_eq!(p["items"].as_array().unwrap().len(), 1);
    assert_eq!(p["items"][0]["height"], TIP);
    assert!(p["items"][0]["time_ms"].as_u64().unwrap() > 0);
    assert_ne!(p["total_paid"], "0.00000000");
    if let Some(c) = p["next_cursor"].as_str() {
        let p2 = get(
            &e.app,
            &format!("/api/v1/nodes/{paid}/payments?limit=1&cursor={c}"),
        )
        .await
        .json();
        assert!(p2["items"][0]["height"].as_u64().unwrap() < u64::from(TIP));
    }
    assert_eq!(
        get(&e.app, "/api/v1/nodes/0/payments?cursor=x")
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, "/api/v1/nodes/0/payments?limit=201")
            .await
            .status,
        StatusCode::BAD_REQUEST
    );

    let peers = get(&e.app, "/api/v1/nodes/0/peers").await.json();
    assert_eq!(peers["peers"][0]["id"], 1);
    assert_eq!(peers["peers"][0]["direction"], "both");
    assert!(peers["peers"][0]["lat"].is_number());
    let peers2 = get(&e.app, "/api/v1/nodes/2/peers").await.json();
    assert_eq!(peers2["peers"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn operator_by_address_and_zelid() {
    let e = env();
    let a = get(&e.app, &format!("/api/v1/operator/{}", operator_address(0))).await;
    assert_eq!(a.status, StatusCode::OK);
    let a = a.json();
    assert_eq!(
        a["nodes"].as_array().unwrap().len(),
        fixtures::NODES_PER_OPERATOR
    );
    assert!(a["next_payments"].as_array().unwrap().len() >= 5);
    assert_ne!(a["collateral_locked"], "0.00000000");
    let z = get(&e.app, &format!("/api/v1/operator/{}", operator_zelid(0)))
        .await
        .json();
    assert_eq!(z["nodes"].as_array().unwrap().len(), 6);
    let unknown = atlas_server::search::t1_address([9; 20]);
    assert_eq!(
        get(&e.app, &format!("/api/v1/operator/{unknown}"))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/operator/x").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, "/api/v1/operator/0OIl0OIl0OIl0OIl0OIl0OIl0OIl")
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
}

// ---------------------------------------------------------------------------------------------
// Apps, analytics, metrics
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn app_detail_and_history() {
    let e = env();
    let d = get(&e.app, "/api/v1/apps/KadenaNode").await;
    assert_eq!(d.status, StatusCode::OK);
    let d = d.json();
    assert_eq!(d["name"], "kadenanode");
    assert_eq!(d["display_name"], "KadenaNode");
    assert_eq!(d["instances"].as_array().unwrap().len(), 3);
    assert!(d["instances"][0]["lat"].is_number());
    let h = get(&e.app, "/api/v1/apps/kadenanode/history").await.json();
    let kinds: Vec<&str> = h["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, vec!["registered", "updated", "renewed"]);
    assert_eq!(h["entries"][1]["changed"], serde_json::json!(["instances"]));
    assert_eq!(
        get(&e.app, "/api/v1/apps/nope").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/apps/nope/history").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/apps/bad%21name").await.status,
        StatusCode::BAD_REQUEST
    );
    let long = format!("/api/v1/apps/{}", "a".repeat(80));
    assert_eq!(get(&e.app, &long).await.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn analytics_are_cached_per_publish() {
    let e = env();
    let p = get(&e.app, "/api/v1/network/providers").await;
    assert_eq!(p.status, StatusCode::OK);
    let pj = p.json();
    let hetzner = pj["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["asn"] == 24940)
        .unwrap();
    assert_eq!(hetzner["countries"], 2, "grouped by ASN across spellings");
    assert!(pj["hosting_share"].as_f64().unwrap() > 0.5);
    let etag = p.header("etag").unwrap().to_owned();
    assert_eq!(
        get_with(
            &e.app,
            "/api/v1/network/providers",
            &[("if-none-match", &etag)]
        )
        .await
        .status,
        StatusCode::NOT_MODIFIED
    );
    let geo = get(&e.app, "/api/v1/network/geo").await.json();
    assert!(geo["unlocated"].as_u64().unwrap() >= 1);
    assert_eq!(geo["continents"].as_array().unwrap().len(), 5);
    let v = get(&e.app, "/api/v1/network/versions").await.json();
    assert_eq!(v["flux_os"][0]["key"], "8.20.0");
    let c = get(&e.app, "/api/v1/network/capacity").await.json();
    assert!(c["total"]["cores"].as_u64().unwrap() > 0);
    assert!(c["apps_locked"]["ram_mb"].as_u64().unwrap() > 0);
    let d = get(&e.app, "/api/v1/network/decentralization").await.json();
    assert!(d["nakamoto_country"].as_u64().unwrap() >= 1);
    assert!(d["nakamoto_operator"].as_u64().unwrap() > 1);
    let s = get(&e.app, "/api/v1/network/summary").await.json();
    assert_eq!(s["tip"]["height"], TIP);

    // A new publish changes the body.
    let mut next = (*e.engine.published()).clone();
    let mut nodes = next.nodes.to_vec();
    for n in &mut nodes {
        if let Some(g) = n.geo.as_mut() {
            g.asn = Some(1);
        }
    }
    next.nodes = nodes.into();
    e.engine.publish(next);
    let p2 = get_with(
        &e.app,
        "/api/v1/network/providers",
        &[("if-none-match", &etag)],
    )
    .await;
    assert_eq!(p2.status, StatusCode::OK);
    assert_eq!(p2.json()["providers"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn metrics_series() {
    let e = env();
    let r = get(
        &e.app,
        "/api/v1/metrics?series=node_count,block_count,avg_block_time_ms",
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let j = r.json();
    let t = j["t"].as_array().unwrap();
    assert!(!t.is_empty());
    assert_eq!(j["series"]["node_count"].as_array().unwrap().len(), t.len());
    assert!(
        j["series"]["node_count"]
            .as_array()
            .unwrap()
            .iter()
            .any(serde_json::Value::is_number)
    );
    let hourly = get(&e.app, "/api/v1/metrics?series=node_count&step=1h")
        .await
        .json();
    assert_eq!(hourly["step_ms"], 3_600_000);
    for bad in [
        "/api/v1/metrics",
        "/api/v1/metrics?series=nope",
        "/api/v1/metrics?series=node_count&step=1s",
        "/api/v1/metrics?series=node_count&from=0&step=60000",
        "/api/v1/metrics?series=node_count&from=9&to=3",
    ] {
        assert_eq!(
            get(&e.app, bad).await.status,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Explorer (store-backed, upstream offline)
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn blocks_from_published_and_store() {
    let e = env();
    let b = get(&e.app, "/api/v1/blocks").await.json();
    let items = b["items"].as_array().unwrap();
    assert_eq!(items.len(), 20);
    assert_eq!(items[0]["height"], TIP);
    let deep = get(
        &e.app,
        &format!("/api/v1/blocks?before={}&limit=15", TIP - 25),
    )
    .await
    .json();
    let hs: Vec<u64> = deep["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["height"].as_u64().unwrap())
        .collect();
    assert_eq!(hs.len(), 14, "store runs out at the first fixture block");
    assert_eq!(hs[0], u64::from(TIP - 26));
    assert!(deep["next_before"].is_null());

    // Stored block while upstream is down: served from the store with node txs.
    let d = get(&e.app, &format!("/api/v1/blocks/{TIP}")).await;
    assert_eq!(d.status, StatusCode::OK, "{:?}", d.body);
    let d = d.json();
    assert_eq!(d["confirmations"], 1);
    assert_eq!(d["node_txs"].as_array().unwrap().len(), 1);
    assert!(d["producer_ref"]["id"].is_number());
    assert_eq!(d["block"]["payouts"].as_array().unwrap().len(), 3);
    let hash = d["block"]["hash"].as_str().unwrap().to_owned();
    let by_hash = get(&e.app, &format!("/api/v1/blocks/{hash}")).await.json();
    assert_eq!(by_hash["block"]["height"], TIP);
    let prev = get(&e.app, &format!("/api/v1/blocks/{}", TIP - 1))
        .await
        .json();
    assert_eq!(prev["next_hash"], hash);

    assert_eq!(
        get(&e.app, &format!("/api/v1/blocks/{}", TIP + 5))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/api/v1/blocks/xyz").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, "/api/v1/blocks?limit=101").await.status,
        StatusCode::BAD_REQUEST
    );
    // Not stored and upstream unreachable: an upstream error, not a crash.
    let r = get(&e.app, "/api/v1/blocks/100").await;
    assert!(r.status.is_server_error(), "{}", r.status);
    assert_eq!(r.error_code(), "upstream");
}

#[tokio::test]
async fn explorer_validation() {
    let e = env();
    for bad in [
        "/api/v1/tx/abc",
        "/api/v1/tx/zz".to_owned().as_str(),
        "/api/v1/address/nope",
        "/api/v1/address/t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebw",
        "/api/v1/address/zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        "/api/v1/address/t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv/txs?limit=51",
        "/api/v1/address/t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv/utxos?cursor=-1",
    ] {
        let r = get(&e.app, bad).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.error_code(), "bad_request");
    }
    let nodes = get(
        &e.app,
        &format!("/api/v1/address/{}/nodes", operator_address(1)),
    )
    .await
    .json();
    assert_eq!(
        nodes["nodes"].as_array().unwrap().len(),
        fixtures::NODES_PER_OPERATOR
    );
    let s = get(&e.app, "/api/v1/supply").await.json();
    assert_eq!(s["reward"], "14.00000000");
    assert_eq!(s["next_reduction_height"], 3_071_200);
    assert_eq!(s["blocks_to_reduction"], 3_071_200 - TIP);
    assert_eq!(s["max_supply_reference"], "560000000.00000000");
    assert!(s["supply"]["transparent"].is_string());
}

// ---------------------------------------------------------------------------------------------
// Time machine, ops, routing
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn timeline_and_state_at() {
    let e = env();
    let t = get(&e.app, "/api/v1/timeline").await.json();
    assert_eq!(t["keyframes_ms"].as_array().unwrap().len(), 2);
    assert!(t["first_ms"].as_u64().is_some());
    assert!(t["event_count"].as_u64().unwrap() >= 6);

    let listed: Vec<&atlas_core::NodeRecord> = e
        .fixture
        .nodes
        .iter()
        .filter(|n| !matches!(n.status, NodeStatus::Departed | NodeStatus::Unknown))
        .collect();
    let now = e.fixture.now_ms;

    // After the newest keyframe: the whole listed set, in the section 7 format.
    let at = now - 1000;
    let s = get(&e.app, &format!("/api/v1/timeline/state?t={at}")).await;
    assert_eq!(s.status, StatusCode::OK);
    assert_eq!(s.header("content-type"), Some("application/octet-stream"));
    assert!(s.header("etag").is_some());
    let bin = decode_nodes_bin(&s.body).unwrap();
    assert_eq!(bin.seq, 0);
    assert_eq!(bin.generated_ms, at);
    assert_eq!(bin.len(), listed.len());
    let ids: Vec<u32> = listed.iter().map(|n| n.id.0).collect();
    assert_eq!(bin.ids, ids);
    let located = listed
        .iter()
        .position(|n| {
            n.geo
                .as_ref()
                .is_some_and(atlas_core::node::Geo::has_coords)
        })
        .unwrap();
    let g = listed[located].geo.as_ref().unwrap();
    assert!((bin.lat[located] - g.lat).abs() < 1e-4);
    assert!((bin.lon[located] - g.lon).abs() < 1e-4);
    assert_eq!(bin.tier[located], listed[located].tier as u8);
    // Ranks are not recorded by keyframes: the column is absent, not zero-filled. The rest of
    // the format-2 keyframe columns are there, with the recorded values.
    use atlas_core::codec::nodes_bin::kind;
    assert!(!bin.has(kind::RANK));
    for k in [
        kind::VERSION,
        kind::CORES,
        kind::LAST_PAID,
        kind::APP_COUNT,
        kind::FLAGS,
    ] {
        assert!(bin.has(k), "column {k}");
    }
    let with_hw = listed.iter().position(|n| n.hw.is_some()).unwrap();
    assert_eq!(
        bin.cores[with_hw],
        listed[with_hw].hw.as_ref().unwrap().cores
    );
    let with_version = listed
        .iter()
        .position(|n| n.versions.flux_os.is_some())
        .unwrap();
    assert_eq!(
        bin.versions[bin.version_idx[with_version] as usize],
        listed[with_version].versions.flux_os.as_deref().unwrap()
    );

    // Same t: served from cache with the same ETag; If-None-Match gives 304.
    let again = get(&e.app, &format!("/api/v1/timeline/state?t={at}")).await;
    assert_eq!(again.header("etag"), s.header("etag"));
    let nm = get_with(
        &e.app,
        &format!("/api/v1/timeline/state?t={at}"),
        &[("if-none-match", s.header("etag").unwrap())],
    )
    .await;
    assert_eq!(nm.status, StatusCode::NOT_MODIFIED);

    // Between the keyframes: the last node had not joined yet.
    let s = get(
        &e.app,
        &format!("/api/v1/timeline/state?t={}", now - 2 * 3_600_000 + 1),
    )
    .await;
    let bin = decode_nodes_bin(&s.body).unwrap();
    let last = e.fixture.nodes.last().unwrap().id.0;
    assert!(!bin.ids.contains(&last));
    assert!(bin.len() + 1 >= listed.len());

    // The state carries this server's origin: its node ids are this instance's.
    assert_eq!(
        bin.origin.map(|o| o.instance_hex()),
        Some(e.engine.server_info().instance.clone())
    );

    // Before the first keyframe: an explicit "no data before", not a partial globe (L14).
    let s = get(
        &e.app,
        &format!("/api/v1/timeline/state?t={}", now - 3 * 3_600_000),
    )
    .await;
    assert_eq!(s.status, StatusCode::NOT_FOUND);
    let err = s.json();
    assert_eq!(err["error"]["code"], "no_history");
    assert!(
        err["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("no data before "),
        "{err}"
    );
    assert_eq!(
        t["first_ms"], t["keyframes_ms"][0],
        "first_ms is the first keyframe"
    );

    assert_eq!(
        get(&e.app, "/api/v1/timeline/state").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&e.app, "/api/v1/timeline/state?t=99999999999999")
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn ops_endpoints() {
    let e = env();
    let h = get(&e.app, "/healthz").await;
    assert_eq!(h.status, StatusCode::OK);
    assert_eq!(h.json()["status"], "ok");
    assert_eq!(get(&e.app, "/readyz").await.status, StatusCode::OK);
    assert_eq!(get(&e.app, "/api/v1/readyz").await.status, StatusCode::OK);
    let _ = get(&e.app, "/api/v1/nodes/0").await;
    let m = get(&e.app, "/metrics/prometheus").await;
    assert_eq!(m.status, StatusCode::OK);
    let text = String::from_utf8(m.body.to_vec()).unwrap();
    for needle in [
        "atlas_http_requests_total{route=\"/api/v1/nodes/{key}\",status=\"2xx\"} 1",
        "atlas_http_request_duration_seconds_bucket{route=\"/api/v1/nodes/{key}\",le=\"+Inf\"} 1",
        "atlas_published_seq",
        "atlas_ws_connections 0",
        "atlas_ws_messages_sent_total",
        "atlas_ws_messages_dropped_total",
        "atlas_proxy_cache_requests_total{cache=\"tx\",result=\"hit\"}",
        // Engine families.
        "atlas_ingest_job_runs_total{job=\"stats_round\"}",
        "atlas_ingest_job_errors_total{job=\"node_registry\"} 0",
        "atlas_ingest_job_stale{job=\"block_decoder\"}",
        "# TYPE atlas_upstream_request_duration_seconds histogram",
        "# TYPE atlas_ingest_job_upstream_seconds_total counter",
        "atlas_store_commit_duration_seconds_bucket{le=\"+Inf\"}",
        "atlas_publish_duration_seconds_count",
        "atlas_replay_ring_messages{ring=\"hub\"}",
        "atlas_replay_ring_capacity{ring=\"engine\"}",
        "atlas_engine_internal_errors_total 0",
    ] {
        assert!(text.contains(needle), "missing {needle}\n{text}");
    }
    // Low cardinality: every family stays small (bounded label sets).
    let mut per_family = std::collections::BTreeMap::<&str, usize>::new();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let name = line.split(['{', ' ']).next().unwrap();
        *per_family.entry(name).or_default() += 1;
    }
    for (name, n) in &per_family {
        assert!(*n <= 200, "{name} has {n} series");
    }
    // Unknown is absent, not 0: no job has succeeded in a stale-free fixture without ingest.
    assert!(!text.contains("atlas_ingest_job_last_success_age_seconds{job=\"stats_round\"}"));

    // A stale engine is alive but not ready.
    let dir = tempfile::tempdir().unwrap();
    let stale = atlas_server::fixtures::offline_engine(&dir.path().join("x.redb")).unwrap();
    let app = atlas_server::router(atlas_server::AppState::new(
        stale,
        atlas_server::ServerConfig::default(),
    ));
    assert_eq!(get(&app, "/healthz").await.json()["status"], "starting");
    let r = get(&app, "/readyz").await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    let _ = NodeStatus::Confirmed;
}

#[tokio::test]
async fn routing_cors_and_spa() {
    let e = env();
    let r = get(&e.app, "/api/v1/nope").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.error_code(), "not_found");
    let r = get(&e.app, "/api/v2/anything").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.error_code(), "not_found");

    let pre = common::get_with(&e.app, "/api/v1/nodes", &[]).await;
    assert_eq!(pre.header("access-control-allow-origin"), Some("*"));
    let req = axum::http::Request::builder()
        .method("OPTIONS")
        .uri("/api/v1/nodes")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = tower::ServiceExt::oneshot(e.app.clone(), req)
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert!(resp.headers().contains_key("access-control-allow-methods"));

    let spa = get(&e.app, "/nodes/123").await;
    assert_eq!(spa.status, StatusCode::OK);
    assert!(spa.header("content-type").unwrap().starts_with("text/html"));
    assert_eq!(spa.header("cache-control"), Some("no-cache"));
    let root = get(&e.app, "/").await;
    assert_eq!(root.status, StatusCode::OK);
    assert_eq!(
        get(&e.app, "/assets/missing-abcdef12.js").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&e.app, "/../etc/passwd").await.status,
        StatusCode::BAD_REQUEST
    );
    let post = axum::http::Request::builder()
        .method("POST")
        .uri("/somewhere")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = tower::ServiceExt::oneshot(e.app.clone(), post)
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
}

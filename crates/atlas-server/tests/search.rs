//! Search classes (explorer research section 4.2), resolved locally against the fixture.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use atlas_server::fixtures::{TIP, operator_address, operator_zelid};
use axum::http::StatusCode;
use common::{env, get};

async fn hits(app: &axum::Router, q: &str) -> Vec<(String, String)> {
    let enc: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
    let r = get(app, &format!("/api/v1/search?q={enc}")).await;
    assert_eq!(r.status, StatusCode::OK, "{q}: {:?}", r.body);
    let j = r.json();
    assert_eq!(j["q"], q.trim());
    j["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            (
                h["kind"].as_str().unwrap().to_owned(),
                h["key"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn first(h: &[(String, String)]) -> (&str, &str) {
    let (k, v) = h.first().expect("at least one hit");
    (k.as_str(), v.as_str())
}

#[tokio::test]
async fn search_classes() {
    let e = env();
    let app = &e.app;

    // Heights, with separators and `#`.
    assert_eq!(first(&hits(app, "2996914").await), ("block", "2996914"));
    assert_eq!(first(&hits(app, "#2,996,900").await), ("block", "2996900"));
    assert!(
        hits(app, &(TIP + 100).to_string())
            .await
            .iter()
            .all(|(k, _)| k != "block")
    );

    // Collateral outpoints in every form, and the bare collateral txid.
    let txid = e.fixture.nodes[0].outpoint.txid.to_hex();
    for q in [
        format!("{txid}:0"),
        format!("{txid}-0"),
        format!("{txid} 0"),
        format!("COutPoint({txid}, 0)"),
        txid.clone(),
    ] {
        assert_eq!(first(&hits(app, &q).await), ("node", "0"), "{q}");
    }
    // Outpoint that is not a node.
    let other = "ef".repeat(32);
    assert_eq!(first(&hits(app, &format!("{other}:3")).await).0, "tx");

    // Stored block hash.
    let bh = e.fixture.blocks[5].hash.to_hex();
    assert_eq!(
        first(&hits(app, &bh).await),
        ("block", e.fixture.blocks[5].height.to_string().as_str())
    );

    // Transparent address that pays nodes: address plus operator plus nodes.
    let addr = operator_address(2);
    let h = hits(app, &addr).await;
    assert_eq!(first(&h), ("address", addr.as_str()));
    assert!(h.iter().any(|(k, v)| k == "operator" && *v == addr));
    assert!(h.iter().any(|(k, _)| k == "node"));
    // A valid address unknown locally: address only, no upstream call needed.
    let dev = atlas_server::fixtures::DEV_FUND;
    assert_eq!(
        hits(app, dev).await,
        vec![("address".to_owned(), dev.to_owned())]
    );
    // Bad checksum: nothing.
    let mut bad = addr.clone();
    bad.pop();
    bad.push(if addr.ends_with('a') { 'b' } else { 'a' });
    assert!(hits(app, &bad).await.iter().all(|(k, _)| k != "address"));

    // ZelID operator.
    let z = operator_zelid(1);
    let h = hits(app, &z).await;
    assert_eq!(first(&h), ("operator", z.as_str()));

    // Shielded.
    let zs = format!("zs1{}", "q".repeat(75));
    assert_eq!(first(&hits(app, &zs).await).0, "shielded");

    // IP, IP:port, prefix.
    let h = hits(app, "5.0.0.1").await;
    assert_eq!(first(&h), ("host", "5.0.0.1"));
    assert_eq!(h.iter().filter(|(k, _)| k == "node").count(), 2);
    assert_eq!(first(&hits(app, "5.0.0.1:16137").await), ("node", "1"));
    let h = hits(app, "5.0.0.").await;
    assert!(h.iter().filter(|(k, _)| k == "host").count() >= 5);

    // Apps: exact (case-insensitive), prefix, fuzzy.
    assert_eq!(first(&hits(app, "KadenaNode").await), ("app", "kadenanode"));
    assert_eq!(first(&hits(app, "fluxapp2").await), ("app", "fluxapp2"));
    let h = hits(app, "fluxapp1").await;
    let top: Vec<&str> = h.iter().take(2).map(|(_, v)| v.as_str()).collect();
    assert_eq!(
        top,
        vec!["fluxapp10", "fluxapp11"],
        "prefix matches rank above fuzzy ones"
    );
    assert!(h.len() > 2, "near misses follow");
    assert_eq!(first(&hits(app, "kadenanod").await), ("app", "kadenanode"));
    assert_eq!(
        first(&hits(app, "kadenamode").await),
        ("app", "kadenanode"),
        "fuzzy"
    );

    // Countries, providers, versions.
    assert_eq!(first(&hits(app, "germany").await), ("country", "DE"));
    assert_eq!(first(&hits(app, "DE").await), ("country", "DE"));
    assert_eq!(first(&hits(app, "AS24940").await), ("provider", "AS24940"));
    let h = hits(app, "hetzner").await;
    assert_eq!(first(&h), ("provider", "AS24940"));
    assert_eq!(
        h.iter().filter(|(k, _)| k == "provider").count(),
        1,
        "grouped by ASN"
    );
    assert_eq!(
        first(&hits(app, "8.20.0").await),
        ("version", "flux_os:8.20.0")
    );
    assert_eq!(
        first(&hits(app, "v9.1.0").await),
        ("version", "daemon:9.1.0")
    );
    assert_eq!(
        first(&hits(app, "jolly wombat").await),
        ("version", "arcane:jolly wombat")
    );

    // Unknown text: no hits, not an error.
    assert!(hits(app, "zzzzqqqq").await.is_empty());

    // Validation.
    assert_eq!(
        get(app, "/api/v1/search").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(app, "/api/v1/search?q=%20").await.status,
        StatusCode::BAD_REQUEST
    );
    let long = format!("/api/v1/search?q={}", "a".repeat(200));
    assert_eq!(get(app, &long).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        get(app, "/api/v1/search?q=a%01b").await.status,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn unknown_hash_with_upstream_down_is_an_upstream_error() {
    let e = env();
    let r = get(&e.app, &format!("/api/v1/search?q={}", "12".repeat(32))).await;
    assert!(r.status.is_server_error());
    assert_eq!(r.error_code(), "upstream");
}

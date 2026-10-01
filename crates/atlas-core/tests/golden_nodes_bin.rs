//! Golden `nodes.bin` built from real node fixtures. The web decoder tests read the same bytes
//! (`tests/golden/nodes.bin`) and the same expectation (`tests/golden/nodes.expected.json`).
//!
//! The golden files are written when missing, or when `ATLAS_UPDATE_GOLDEN=1` is set. Otherwise
//! the test fails if the encoder output no longer matches the committed bytes.
#![allow(
    clippy::unwrap_used,
    clippy::too_many_lines,
    clippy::float_cmp,
    clippy::naive_bytecount
)] // exact f32 round-trip is the point

use std::path::PathBuf;

use atlas_core::codec::Origin;
use atlas_core::codec::nodes_bin::{NodeBinInput, decode_nodes_bin, encode_nodes_bin_from};
use atlas_core::node::{Geo, GeoSource, Hardware, Versions};
use atlas_core::{Hash32, NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier};
use serde_json::{Value, json};

const SEQ: u64 = 42;
const GENERATED_MS: u64 = 1_790_797_000_000;
const TIP: u32 = 2_996_915;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/research/fixtures/flux")
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

fn load(name: &str) -> Value {
    serde_json::from_slice(&std::fs::read(fixtures().join(name)).unwrap()).unwrap()
}

fn num(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn nz(v: &Value) -> Option<u32> {
    num(v).map(|x| x as u32).filter(|x| *x > 0)
}

/// Node records from the node-list fixture plus the stats rows that are not in the list.
fn records() -> Vec<NodeRecord> {
    let list = load("daemon_viewdeterministicfluxnodelist.json");
    let stats = load("stats_fluxinfo.json");
    let mut out: Vec<NodeRecord> = Vec::new();
    fn push(out: &mut Vec<NodeRecord>, mut r: NodeRecord, new: bool) {
        r.id = NodeId(out.len() as u32);
        r.first_seen_ms = if new {
            GENERATED_MS - 3_600_000
        } else {
            GENERATED_MS - 172_800_000
        };
        r.last_seen_ms = GENERATED_MS;
        out.push(r);
    }
    let stats_rows = stats["data"].as_array().unwrap();
    let stats_for = |txid: &str, idx: u64| {
        stats_rows
            .iter()
            .find(|r| r["collateralHash"] == txid && num(&r["collateralIndex"]) == Some(idx))
    };
    for (i, e) in list["data"].as_array().unwrap().iter().enumerate() {
        let txid = e["txhash"].as_str().unwrap();
        let vout = num(&e["outidx"]).unwrap();
        let mut rec = NodeRecord {
            outpoint: Outpoint::new(Hash32::from_hex(txid).unwrap(), vout as u32),
            endpoint: NodeEndpoint::parse_opt(e["ip"].as_str().unwrap()).unwrap(),
            tier: Tier::parse_lenient(e["tier"].as_str().unwrap()),
            status: NodeStatus::Confirmed,
            payment_address: e["payment_address"].as_str().unwrap().into(),
            pubkey: e["pubkey"].as_str().unwrap().into(),
            rank: num(&e["rank"]).map(|v| v as u32),
            added_height: num(&e["added_height"]).unwrap() as u32,
            confirmed_height: nz(&e["confirmed_height"]),
            last_confirmed_height: nz(&e["last_confirmed_height"]),
            last_paid_height: nz(&e["last_paid_height"]),
            ..NodeRecord::default()
        };
        if let Some(row) = stats_for(txid, vout) {
            apply_stats(&mut rec, row);
        }
        push(&mut out, rec, i < 3);
    }
    for row in stats_rows {
        let txid = row["collateralHash"].as_str().unwrap();
        let vout = num(&row["collateralIndex"]).unwrap() as u32;
        let op = Outpoint::new(Hash32::from_hex(txid).unwrap(), vout);
        if out.iter().any(|r| r.outpoint == op) {
            continue;
        }
        let mut rec = NodeRecord {
            outpoint: op,
            endpoint: NodeEndpoint::parse_opt(row["ip"].as_str().unwrap()).unwrap(),
            tier: Tier::parse_lenient(row["tier"].as_str().unwrap()),
            status: NodeStatus::Confirmed,
            payment_address: row["paymentAddress"].as_str().unwrap_or_default().into(),
            added_height: num(&row["addedHeight"]).unwrap_or(0) as u32,
            confirmed_height: nz(&row["confirmedHeight"]),
            last_confirmed_height: nz(&row["lastConfirmedHeight"]),
            last_paid_height: nz(&row["lastPaidHeight"]),
            ..NodeRecord::default()
        };
        apply_stats(&mut rec, row);
        push(&mut out, rec, false);
    }
    out
}

/// Geo, hardware, versions, ArcaneOS and app count from a stats row (placeholders skipped).
fn apply_stats(rec: &mut NodeRecord, row: &Value) {
    if row.get("error").is_some() {
        rec.reachable = Some(false);
        return;
    }
    rec.reachable = Some(true);
    let g = &row["geolocation"];
    rec.geo = Some(Geo {
        lat: g["lat"].as_f64().unwrap() as f32,
        lon: g["lon"].as_f64().unwrap() as f32,
        continent_code: g["continentCode"].as_str().unwrap_or_default().into(),
        country_code: g["countryCode"].as_str().unwrap_or_default().into(),
        country: g["country"].as_str().unwrap_or_default().into(),
        region: g["regionName"].as_str().unwrap_or_default().into(),
        city: "".into(),
        org: g["org"].as_str().unwrap_or_default().into(),
        asn: None,
        hosting: g["hosting"].as_bool(),
        source: GeoSource::NodeReported,
    });
    let b = &row["benchmark"]["bench"];
    rec.hw = Some(Hardware {
        cores: b["cores"].as_f64().unwrap_or(0.0) as u16,
        ram_gb: b["ram"].as_f64().unwrap_or(0.0) as f32,
        ssd_gb: b["ssd"].as_f64().unwrap_or(0.0) as f32,
        ..Hardware::default()
    });
    rec.versions = Versions {
        flux_os: row["flux"]["version"].as_str().map(Into::into),
        ..Versions::default()
    };
    rec.arcane = Some(row["flux"].get("arcaneVersion").is_some());
    rec.app_count = row["apps"]["runningapps"].as_array().map_or(0, Vec::len) as u16;
}

fn f32_json(v: f32) -> Value {
    if v.is_nan() {
        Value::Null
    } else {
        json!(f64::from(v))
    }
}

/// Section table as written in the file.
fn section_table(buf: &[u8]) -> Vec<Value> {
    let n = u32::from_le_bytes(buf[28..32].try_into().unwrap()) as usize;
    (0..n)
        .map(|i| {
            let b = 32 + i * 12;
            json!({
                "kind": u16::from_le_bytes(buf[b..b + 2].try_into().unwrap()),
                "dtype": u16::from_le_bytes(buf[b + 2..b + 4].try_into().unwrap()),
                "offset": u32::from_le_bytes(buf[b + 4..b + 8].try_into().unwrap()),
                "byte_len": u32::from_le_bytes(buf[b + 8..b + 12].try_into().unwrap()),
            })
        })
        .collect()
}

#[test]
fn golden_nodes_bin() {
    let recs = records();
    assert!(
        recs.len() >= 45,
        "expected about 49 fixture nodes, got {}",
        recs.len()
    );
    let rows: Vec<NodeBinInput> = recs
        .iter()
        .map(|r| NodeBinInput::from_record(r, TIP, GENERATED_MS, false))
        .collect();
    let origin = Origin {
        started_ms: GENERATED_MS - 600_000,
        instance: 0x00c0_ffee_1234_abcd,
    };
    let buf = encode_nodes_bin_from(SEQ, GENERATED_MS, &rows, &[], Some(origin));
    let d = decode_nodes_bin(&buf).unwrap();

    // Decoded values agree with the inputs.
    assert_eq!(d.len(), rows.len());
    for (i, r) in rows.iter().enumerate() {
        assert_eq!(d.ids[i], r.id.0);
        assert_eq!(d.tier[i], r.tier.as_u8());
        assert_eq!(d.node_flags[i], r.flags);
        assert_eq!(d.ips[i], r.endpoint);
        assert_eq!(d.outpoints.as_ref().unwrap()[i], r.outpoint.unwrap());
        assert_eq!(d.rank[i], r.rank.map_or(0, |x| x + 1));
        assert_eq!(d.versions[d.version_idx[i] as usize], r.version);
        assert_eq!(d.orgs[d.org[i] as usize], r.org);
        match r.lat {
            Some(lat) => assert_eq!(d.lat[i], lat),
            None => assert!(d.lat[i].is_nan()),
        }
    }
    assert!(
        d.lat.iter().any(|v| v.is_nan()),
        "golden covers unlocated nodes"
    );
    assert!(
        d.lat.iter().any(|v| !v.is_nan()),
        "golden covers located nodes"
    );
    assert!(
        d.ips.iter().any(String::is_empty),
        "golden covers an empty-ip node"
    );

    let first5: Vec<Value> = (0..5)
        .map(|i| {
            json!({
                "id": d.ids[i],
                "lat": f32_json(d.lat[i]),
                "lon": f32_json(d.lon[i]),
                "tier": d.tier[i],
                "status": d.status[i],
                "flags": d.node_flags[i],
                "loc": d.loc[i],
                "country": d.country[i],
                "org": d.org[i],
                "app_count": d.app_count[i],
                "rank": d.rank[i],
                "last_paid": d.last_paid[i],
                "cores": d.cores[i],
                "ram_gb": d.ram_gb[i],
                "ssd_gb": d.ssd_gb[i],
                "version": d.version_idx[i],
                "ip": d.ips[i],
                "outpoint": d.outpoints.as_ref().unwrap()[i].to_string(),
            })
        })
        .collect();
    let locations: Vec<Value> = d
        .locations
        .iter()
        .map(|l| {
            json!({
                "lat": f32_json(l.lat),
                "lon": f32_json(l.lon),
                "country": l.country,
                "node_count": l.node_count,
                "city": l.city,
            })
        })
        .collect();
    let tier_counts: Vec<usize> = [1u8, 2, 3]
        .iter()
        .map(|t| d.tier.iter().filter(|x| *x == t).count())
        .collect();
    let sum = |v: &[u32]| v.iter().map(|x| u64::from(*x)).sum::<u64>();
    let expected = json!({
        "format": "nodes.bin",
        "magic": "FXAT",
        "version": d.version,
        "flags": d.flags,
        "seq": d.seq,
        "generated_ms": d.generated_ms,
        "origin": {
            "started_ms": d.origin.unwrap().started_ms,
            "instance": d.origin.unwrap().instance_hex(),
        },
        "count": d.len(),
        "byte_len": buf.len(),
        "sections": section_table(&buf),
        "first5": first5,
        "countries": d.countries,
        "orgs": d.orgs,
        "versions": d.versions,
        "locations": locations,
        "checks": {
            "sum_ids": sum(&d.ids),
            "sum_rank": sum(&d.rank),
            "sum_last_paid": sum(&d.last_paid),
            "sum_loc": sum(&d.loc),
            "sum_app_count": d.app_count.iter().map(|x| u64::from(*x)).sum::<u64>(),
            "sum_flags": d.node_flags.iter().map(|x| u64::from(*x)).sum::<u64>(),
            "located": d.lat.iter().filter(|v| !v.is_nan()).count(),
            "tier_counts": tier_counts,
        },
    });

    let dir = golden_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let bin_path = dir.join("nodes.bin");
    let json_path = dir.join("nodes.expected.json");
    let json_text = serde_json::to_string_pretty(&expected).unwrap() + "\n";
    let update = std::env::var("ATLAS_UPDATE_GOLDEN").is_ok_and(|v| v == "1");
    if update || !bin_path.exists() || !json_path.exists() {
        std::fs::write(&bin_path, &buf).unwrap();
        std::fs::write(&json_path, &json_text).unwrap();
    } else {
        let committed = std::fs::read(&bin_path).unwrap();
        assert!(
            committed == buf,
            "nodes.bin encoder output changed; rerun with ATLAS_UPDATE_GOLDEN=1 and update the web decoder"
        );
        // Compare text: parsing floats back through serde_json can differ in the last ulp.
        let committed_json = std::fs::read_to_string(&json_path).unwrap();
        assert!(
            committed_json == json_text,
            "nodes.expected.json is out of date"
        );
    }
    // The committed file decodes to the same values.
    let reread = decode_nodes_bin(&std::fs::read(&bin_path).unwrap()).unwrap();
    // NaN coordinates make PartialEq unusable here; compare the debug form instead.
    assert_eq!(format!("{reread:?}"), format!("{d:?}"));
}

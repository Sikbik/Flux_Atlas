//! Shared fixture helpers for the engine tests (no network).
#![allow(dead_code, clippy::unwrap_used)]

use std::path::PathBuf;

use atlas_core::app::{AppComponent, AppRecord, AppSpec};
use atlas_core::node::{Geo, GeoSource, Hardware, Versions};
use atlas_core::{Hash32, NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier};
use atlas_engine::state::{NetworkState, Tick};
use serde::de::DeserializeOwned;

pub fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/research/fixtures")
}

pub fn read(rel: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(rel)).unwrap_or_else(|e| panic!("fixture {rel}: {e}"))
}

/// Parses a FluxOS envelope fixture.
pub fn envelope<T: DeserializeOwned>(rel: &str) -> T {
    atlas_flux::envelope::parse_envelope("fixture", &read(rel)).unwrap()
}

/// Full untrimmed dumps from the research phase, when present on this machine.
pub fn raw_dump(name: &str) -> Option<Vec<u8>> {
    let base = std::env::var("ATLAS_RAW_DUMPS").ok().map(PathBuf::from).or_else(|| {
        let p = PathBuf::from(
            "/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/team/raw/flux",
        );
        p.exists().then_some(p)
    })?;
    std::fs::read(base.join(name)).ok()
}

/// A decoded block from a `getblock` verbosity-2 fixture.
pub fn block(rel: &str) -> atlas_flux::decode::DecodedBlock {
    let b: atlas_flux::models::daemon::DaemonBlock = envelope(rel);
    atlas_flux::decode::decode_block(&b).unwrap()
}

/// The node-list fixture normalized.
pub fn node_list() -> Vec<atlas_flux::models::nodes::ListedNode> {
    let v: Vec<atlas_flux::models::nodes::NodeListEntry> =
        envelope("flux/daemon_viewdeterministicfluxnodelist.json");
    v.iter()
        .filter_map(atlas_flux::models::nodes::NodeListEntry::normalize)
        .collect()
}

/// A state seeded from the node-list fixture (initial reconcile), armed for expiry.
pub fn seeded() -> NetworkState {
    let mut st = NetworkState::default();
    let mut tick = Tick::new(1_790_000_000_000);
    atlas_engine::derive::reconcile::reconcile(&mut st, &mut tick, &node_list());
    st.large_transfer = atlas_core::Amount::from_flux(10_000);
    st
}

pub fn hash(n: u32) -> Hash32 {
    let mut b = [0u8; 32];
    b[..4].copy_from_slice(&n.to_be_bytes());
    b[31] = 7;
    Hash32(b)
}

/// A realistic synthetic node (for timing tests).
pub fn synthetic_node(i: u32) -> NodeRecord {
    let tier = Tier::ALL[(i % 3) as usize];
    let ip = format!(
        "{}.{}.{}.{}",
        20 + i % 200,
        (i / 7) % 250,
        (i / 13) % 250,
        1 + i % 250
    );
    let port = 16127 + 10 * (i % 8) as u16;
    NodeRecord {
        id: NodeId(i),
        outpoint: Outpoint::new(hash(i), i % 3),
        endpoint: Some(NodeEndpoint::new(ip.parse().unwrap(), port)),
        tier,
        status: NodeStatus::Confirmed,
        payment_address: format!("t1synthetic{i:030}").into(),
        pubkey: "04abcdef".into(),
        rank: Some(i / 3),
        added_height: 2_900_000 + i,
        confirmed_height: Some(2_900_010 + i),
        last_confirmed_height: Some(2_996_000 + i % 500),
        last_paid_height: Some(2_990_000 + i),
        geo: Some(Geo {
            lat: -60.0 + (i % 1200) as f32 / 10.0,
            lon: -170.0 + (i % 3400) as f32 / 10.0,
            continent_code: ["EU", "NA", "AS", "OC"][(i % 4) as usize].into(),
            country_code: format!("C{}", i % 80).into(),
            country: format!("Country {}", i % 80).into(),
            region: "Region".into(),
            city: String::new().into(),
            org: format!("Provider number {} GmbH", i % 300).into(),
            asn: Some(1000 + i % 300),
            hosting: Some(true),
            source: GeoSource::NodeReported,
        }),
        hw: Some(Hardware {
            cores: 4 + (i % 4) as u16 * 4,
            ram_gb: 8.0 + (i % 4) as f32 * 8.0,
            ssd_gb: 220.0 + (i % 5) as f32 * 100.0,
            ..Hardware::default()
        }),
        versions: Versions {
            flux_os: Some(format!("8.{}.0", 15 + i % 6).into()),
            ..Versions::default()
        },
        app_count: (i % 5) as u16,
        first_seen_ms: 1_700_000_000_000,
        last_seen_ms: 1_790_000_000_000,
        ..NodeRecord::default()
    }
}

/// A synthetic app with one component.
pub fn synthetic_app(i: u32) -> AppRecord {
    let spec = AppSpec {
        spec_version: 8,
        name: format!("SyntheticApp{i}"),
        description: "A synthetic application used for timing tests".into(),
        owner: format!("1Owner{i:028}"),
        instances: 3 + i % 5,
        components: vec![AppComponent {
            name: "web".into(),
            repotag: format!("example/app{i}:latest"),
            ports: vec![30_000 + (i % 1000) as u16],
            cpu: 0.5,
            ram_mb: 1000,
            hdd_gb: 10,
            ..AppComponent::default()
        }],
        ..AppSpec::default()
    };
    AppRecord::from_spec(spec, Some(hash(100_000 + i)), 2_990_000, 1_790_000_000_000)
}

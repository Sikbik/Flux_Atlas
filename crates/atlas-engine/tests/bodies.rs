//! Body rebuild timing: a full publish (nodes.bin, mesh.bin, apps index, bootstrap, each in
//! br + gzip + zstd) at network scale must stay under 150 ms (release build).
#![allow(clippy::unwrap_used)]

mod common;

use std::collections::HashSet;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;

use atlas_core::api::{NetworkSummary, ServerInfo, TierCounts};
use atlas_core::{Amount, NodeId, NodeRecord};
use atlas_engine::publish::{PublishJob, build};
use atlas_engine::state::apps::index_entry;
use atlas_engine::{PrebuiltBodies, Published};

fn job(nodes: Arc<[NodeRecord]>, apps: usize, prev: Arc<Published>) -> PublishJob {
    let apps: Vec<_> = (0..apps as u32)
        .map(|i| index_entry(&common::synthetic_app(i)))
        .collect();
    let edges: Vec<(NodeId, NodeId, u8)> = (0..20_000u32)
        .map(|i| (NodeId(i % 6700), NodeId((i * 7 + 13) % 6700), (i % 4) as u8))
        .collect();
    PublishJob {
        seq: 42,
        generated_ms: 1_790_000_000_000,
        stale: false,
        server: ServerInfo {
            name: "t".into(),
            version: "0".into(),
            api_version: 1,
            started_ms: 0,
        },
        network: summary(),
        tiers: Vec::new(),
        blocks: Arc::from(Vec::new()),
        nodes,
        nodes_changed: true,
        enterprise: Arc::new(HashSet::new()),
        tip: 2_996_950,
        apps: apps.into(),
        apps_changed: true,
        mesh: Some(edges),
        mesh_edge_count: 20_000,
        freshness: Vec::new(),
        next_payees: Vec::new(),
        mempool: Vec::new(),
        prev,
    }
}

fn summary() -> NetworkSummary {
    NetworkSummary {
        node_count: 6724,
        host_count: 2655,
        tiers: TierCounts::default(),
        country_count: 70,
        provider_count: 300,
        arcane_count: 0,
        unreachable_count: 0,
        app_count: 1882,
        instance_count: 8274,
        tip: None,
        reward: Amount::from_flux(14),
        next_reduction_height: None,
        supply: None,
        price: None,
        mempool_size: 0,
    }
}

fn empty_prev() -> Arc<Published> {
    Arc::new(Published {
        seq: 0,
        generated_ms: 0,
        stale: true,
        server: ServerInfo {
            name: "t".into(),
            version: "0".into(),
            api_version: 1,
            started_ms: 0,
        },
        network: summary(),
        nodes: Arc::from(Vec::new()),
        apps: Arc::from(Vec::new()),
        blocks: Arc::from(Vec::new()),
        bodies: PrebuiltBodies::default(),
        tiers: Arc::from(Vec::new()),
        freshness: Arc::from(Vec::new()),
        next_payees: Arc::from(Vec::new()),
        mesh_edge_count: 0,
        mempool: Arc::from(Vec::new()),
    })
}

fn brotli_ms(raw: &[u8], q: u32) -> (f64, usize) {
    let s = Instant::now();
    let mut out = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut out, 64 * 1024, q, 22);
        w.write_all(raw).unwrap();
        w.flush().unwrap();
    }
    (s.elapsed().as_secs_f64() * 1000.0, out.len())
}

#[test]
fn full_rebuild_is_fast() {
    let nodes: Arc<[NodeRecord]> = (0..6724)
        .map(common::synthetic_node)
        .collect::<Vec<_>>()
        .into();
    // Warm-up (allocator, code paths).
    let _ = build(job(Arc::clone(&nodes), 1882, empty_prev()));
    let mut best = u64::MAX;
    let mut last = None;
    for _ in 0..3 {
        let (p, t) = build(job(Arc::clone(&nodes), 1882, empty_prev()));
        eprintln!("rebuild timing {t:?}");
        best = best.min(t.total_ms);
        last = Some(p);
    }
    let p = last.unwrap();
    let b = &p.bodies;
    for (name, body) in [
        ("nodes.bin", b.nodes_bin.as_ref()),
        ("mesh.bin", b.mesh_bin.as_ref()),
        ("apps", b.apps_index.as_ref()),
        ("bootstrap", b.bootstrap.as_ref()),
    ] {
        let body = body.unwrap();
        eprintln!(
            "{name}: raw {} br {} gzip {} zstd {}",
            body.raw.len(),
            body.br.len(),
            body.gzip.len(),
            body.zstd.len()
        );
        let sweep: Vec<String> = [4u32, 5, 6, 7, 9, 11]
            .iter()
            .map(|q| {
                let (ms, len) = brotli_ms(&body.raw, *q);
                format!("q{q}={ms:.1}ms/{len}B")
            })
            .collect();
        eprintln!("  brotli sweep: {}", sweep.join(" "));
    }
    let limit = if cfg!(debug_assertions) { 1_500 } else { 150 };
    assert!(
        best < limit,
        "full rebuild took {best} ms (limit {limit} ms)"
    );
}

#[test]
fn unchanged_parts_are_reused() {
    let nodes: Arc<[NodeRecord]> = (0..500)
        .map(common::synthetic_node)
        .collect::<Vec<_>>()
        .into();
    let (p1, _) = build(job(Arc::clone(&nodes), 50, empty_prev()));
    let p1 = Arc::new(p1);
    let mut j = job(Arc::clone(&nodes), 50, Arc::clone(&p1));
    j.nodes_changed = false;
    j.apps_changed = false;
    j.mesh = None;
    j.seq = 43;
    let (p2, t) = build(j);
    assert_eq!(t.nodes_bin_ms + t.apps_ms + t.mesh_bin_ms, 0);
    assert!(Arc::ptr_eq(&p1.nodes, &p2.nodes), "node slice is shared");
    assert_eq!(
        p1.bodies.nodes_bin.as_ref().unwrap().etag,
        p2.bodies.nodes_bin.as_ref().unwrap().etag
    );
    assert_ne!(
        p1.bodies.bootstrap.as_ref().unwrap().etag,
        p2.bodies.bootstrap.as_ref().unwrap().etag,
        "bootstrap carries the new seq"
    );
}

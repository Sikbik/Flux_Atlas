//! Engine-level tests: observations through the reducer (synthetic reorg, restore, flush),
//! chain cursor, time machine.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use atlas_core::event::{Event, EventEnvelope};
use atlas_core::live::LiveBody;
use atlas_core::{Hash32, NodeEndpoint, NodeId, NodeRecord, NodeStatus, Outpoint, Tier};
use atlas_flux::ClientsConfig;
use atlas_flux::decode::DecodedBlock;
use atlas_store::WriteBatch;

use super::*;
use crate::timemachine::{NetworkSnapshot, SnapNode, state_at, test_geo};

fn fixture_block(rel: &str) -> DecodedBlock {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/research/fixtures")
        .join(rel);
    let raw = std::fs::read(p).unwrap();
    let b: atlas_flux::models::daemon::DaemonBlock =
        atlas_flux::envelope::parse_envelope("fixture", &raw).unwrap();
    atlas_flux::decode::decode_block(&b).unwrap()
}

fn h(n: u32) -> Hash32 {
    let mut b = [0u8; 32];
    b[..4].copy_from_slice(&n.to_be_bytes());
    b[31] = 0x5a;
    Hash32(b)
}

/// A synthetic block at `height` with `hash(height, fork)` linked to `prev`.
fn synth(base: &DecodedBlock, height: u32, fork: u32, prev: Hash32) -> DecodedBlock {
    let mut d = base.clone();
    d.summary.height = height;
    d.summary.hash = h(height * 10 + fork);
    d.summary.prev_hash = prev;
    d.summary.time_ms = 1_790_000_000_000 + u64::from(height) * 30_000;
    d.app_payments.clear();
    d
}

fn start(store: Store) -> EngineHandle {
    let clients = Clients::new(ClientsConfig::default()).unwrap();
    let cfg = EngineConfig {
        ping_interval: Duration::from_secs(3600),
        ingest: IngestConfig::disabled(),
        ..EngineConfig::default()
    };
    Engine::start(cfg, store, clients)
}

async fn inject(h: &EngineHandle, o: Obs) {
    let tx = h.inner.obs_tx.lock().unwrap().clone().unwrap();
    tx.send(o).await.unwrap();
}

async fn until(what: &str, mut f: impl FnMut() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(
            t.elapsed() < Duration::from_secs(10),
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn synthetic_reorg_replaces_orphaned_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    let eng = start(store);
    let base = fixture_block("flux/daemon_getblock_2996916_verbosity2.json");
    let b0 = synth(&base, 3_000_000, 0, h(1));
    let b1 = synth(&base, 3_000_001, 0, b0.summary.hash);
    let b2 = synth(&base, 3_000_002, 0, b1.summary.hash);
    let b1x = synth(&base, 3_000_001, 1, b0.summary.hash);
    let b2x = synth(&base, 3_000_002, 1, b1x.summary.hash);
    let mut rx = eng.subscribe();
    for (b, disc) in [(&b0, true), (&b1, false), (&b2, false)] {
        inject(
            &eng,
            Obs::Block {
                block: Box::new(b.clone()),
                received_ms: now_ms(),
                discontinuous: disc,
            },
        )
        .await;
    }
    until("tip b2", || {
        eng.published().network.tip.as_ref().map(|t| t.hash) == Some(b2.summary.hash)
    })
    .await;
    assert!(!eng.published().stale, "live data clears stale");
    inject(
        &eng,
        Obs::Reorg {
            fork_height: 3_000_000,
            old_tip: 3_000_002,
            orphaned: vec![b1.summary.hash, b2.summary.hash],
        },
    )
    .await;
    for b in [&b1x, &b2x] {
        inject(
            &eng,
            Obs::Block {
                block: Box::new(b.clone()),
                received_ms: now_ms(),
                discontinuous: false,
            },
        )
        .await;
    }
    until("tip b2x", || {
        eng.published().network.tip.as_ref().map(|t| t.hash) == Some(b2x.summary.hash)
    })
    .await;
    let p = eng.published();
    let heights: Vec<(u32, Hash32)> = p.blocks.iter().map(|b| (b.height, b.hash)).collect();
    assert_eq!(
        &heights[..3],
        &[
            (3_000_002, b2x.summary.hash),
            (3_000_001, b1x.summary.hash),
            (3_000_000, b0.summary.hash)
        ]
    );
    // Live stream: blocks, then a reorg message, then the replacement blocks.
    let mut kinds = Vec::new();
    while let Ok(m) = rx.try_recv() {
        match &m.body {
            LiveBody::Block(b) => kinds.push(format!("block {}", b.height)),
            LiveBody::Reorg(r) => kinds.push(format!("reorg {}", r.fork_height)),
            _ => {}
        }
    }
    assert_eq!(
        kinds,
        vec![
            "block 3000000",
            "block 3000001",
            "block 3000002",
            "reorg 3000000",
            "block 3000001",
            "block 3000002"
        ]
    );
    eng.shutdown().await;
    let s = eng.store();
    assert_eq!(s.block(3_000_001).unwrap().unwrap().hash, b1x.summary.hash);
    assert_eq!(s.block(3_000_002).unwrap().unwrap().hash, b2x.summary.hash);
    assert!(s.block_by_hash(&b1.summary.hash).unwrap().is_none());
    let events = s.latest_events(10_000).unwrap();
    assert!(
        events
            .iter()
            .any(|(_, e)| matches!(e.event, Event::Reorg { .. }))
    );
    assert_eq!(eng.stats().reorgs, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restores_and_publishes_stale_then_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    let mut b = WriteBatch::new();
    for i in 0..30u32 {
        let op = Outpoint::new(h(i), 0);
        b.intern_node(op, NodeId(i));
        b.put_node(NodeRecord {
            id: NodeId(i),
            outpoint: op,
            endpoint: Some(NodeEndpoint::new(
                format!("8.8.{}.{}", i / 200, 1 + i % 200).parse().unwrap(),
                16127,
            )),
            tier: Tier::ALL[(i % 3) as usize],
            status: if i == 29 {
                NodeStatus::Departed
            } else {
                NodeStatus::Confirmed
            },
            rank: Some(i / 3),
            confirmed_height: Some(100 + i),
            ..NodeRecord::default()
        });
    }
    store.commit(b).unwrap();
    let eng = start(store);
    let p = eng.published();
    assert!(p.stale);
    assert_eq!(p.nodes.len(), 29, "departed nodes are not published");
    assert_eq!(p.network.node_count, 29);
    until("bodies", || eng.published().bodies.nodes_bin.is_some()).await;
    let p = eng.published();
    assert!(p.stale);
    let bin =
        atlas_core::codec::nodes_bin::decode_nodes_bin(&p.bodies.nodes_bin.as_ref().unwrap().raw)
            .unwrap();
    assert_eq!(bin.len(), 29);
    assert!(p.bodies.bootstrap.is_some() && p.bodies.apps_index.is_some());
    assert_eq!(p.tiers.len(), 3);
    assert_eq!(p.freshness.len(), crate::freshness::JOBS.len());
    eng.shutdown().await;
}

#[test]
fn chain_cursor() {
    use crate::jobs::chain_cursor_for_tests as Cursor;
    let mut c = Cursor::new(&[(10, h(10)), (11, h(11))]);
    assert_eq!(c.tip(), Some((11, h(11))));
    c.push(12, h(12));
    assert!(c.contains(&h(12)));
    // Pushing a lower height drops everything above it (a replacement).
    c.push(11, h(111));
    assert_eq!(c.tip(), Some((11, h(111))));
    assert!(!c.contains(&h(12)));
    assert_eq!(c.truncate_above(10), vec![h(111)]);
    assert_eq!(c.tip(), Some((10, h(10))));
    c.reset(500, h(500));
    assert_eq!(c.get(10), None);
}

fn snap_node(i: u32) -> SnapNode {
    SnapNode {
        id: NodeId(i),
        outpoint: Outpoint::new(h(i), 0),
        tier: Tier::ALL[(i % 3) as usize],
        status: NodeStatus::Confirmed,
        endpoint: Some(NodeEndpoint::new(
            format!("9.{}.{}.{}", i / 60_000, (i / 250) % 250, 1 + i % 250)
                .parse()
                .unwrap(),
            16127,
        )),
        lat: Some(10.0),
        lon: Some(20.0),
        country_code: "DE".into(),
        country: "Germany".into(),
        org: "Hetzner".into(),
    }
}

fn env(ts: u64, e: Event) -> EventEnvelope {
    EventEnvelope {
        seq: 1,
        observed_ms: ts,
        event_ms: None,
        event: e,
    }
}

#[test]
fn time_machine_reconstruction() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    let mut b = WriteBatch::new();
    b.put_snapshot(
        1_000,
        &NetworkSnapshot {
            ts_ms: 1_000,
            tip_height: 50,
            nodes: (1..=3).map(snap_node).collect(),
        },
    )
    .unwrap();
    let ep: NodeEndpoint = "1.1.1.1:16137".parse().unwrap();
    b.push_event(env(
        2_000,
        Event::NodeAdded {
            node: NodeId(4),
            outpoint: Outpoint::new(h(4), 0),
            tier: Tier::Stratus,
            endpoint: None,
        },
    ));
    b.push_event(env(
        2_000,
        Event::NodeIpChanged {
            node: NodeId(1),
            old: None,
            new: Some(ep),
            cause: atlas_core::event::Cause::Block,
        },
    ));
    b.push_event(env(
        3_000,
        Event::NodeRemoved {
            node: NodeId(2),
            reason: atlas_core::event::RemovalReason::Expired,
        },
    ));
    b.push_event(env(
        3_000,
        Event::NodeLocated {
            node: NodeId(4),
            geo: Box::new(test_geo(48.1, 11.6, "DE")),
        },
    ));
    b.put_snapshot(
        5_000,
        &NetworkSnapshot {
            ts_ms: 5_000,
            tip_height: 60,
            nodes: vec![snap_node(7)],
        },
    )
    .unwrap();
    store.commit(b).unwrap();

    let s = state_at(&store, 1_500).unwrap();
    assert_eq!((s.snapshot_ms, s.replayed, s.nodes.len()), (1_000, 0, 3));
    let s = state_at(&store, 2_500).unwrap();
    assert_eq!(s.nodes.len(), 4);
    assert_eq!(s.nodes[0].endpoint, Some(ep));
    assert_eq!(s.nodes[3].tier, Tier::Stratus);
    assert_eq!(s.nodes[3].lat, None);
    let s = state_at(&store, 3_500).unwrap();
    assert_eq!(
        s.nodes.iter().map(|n| n.id.0).collect::<Vec<_>>(),
        vec![1, 3, 4]
    );
    assert_eq!(s.nodes[2].lat, Some(48.1));
    let s = state_at(&store, 6_000).unwrap();
    assert_eq!((s.snapshot_ms, s.tip_height, s.nodes.len()), (5_000, 60, 1));
    // Before any keyframe: replay from the start.
    let s = state_at(&store, 500).unwrap();
    assert!(s.nodes.is_empty());
    // Binary form decodes.
    let bin = state_at(&store, 3_500).unwrap().to_nodes_bin(9);
    assert_eq!(
        atlas_core::codec::nodes_bin::decode_nodes_bin(&bin)
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn time_machine_is_fast_at_network_scale() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    let mut b = WriteBatch::new();
    b.put_snapshot(
        10_000,
        &NetworkSnapshot {
            ts_ms: 10_000,
            tip_height: 1,
            nodes: (0..6_724).map(snap_node).collect(),
        },
    )
    .unwrap();
    // One hour of events (about 2,400 heartbeats and payouts plus some lifecycle changes).
    for i in 0..2_400u32 {
        let e = match i % 20 {
            0 => Event::NodeRemoved {
                node: NodeId(i),
                reason: atlas_core::event::RemovalReason::Expired,
            },
            1 => Event::NodeLocated {
                node: NodeId(i),
                geo: Box::new(test_geo(1.0, 2.0, "US")),
            },
            _ => Event::NodeHeartbeat {
                node: NodeId(i),
                height: i,
                txid: h(i),
                endpoint: None,
                benchmark_tier: None,
            },
        };
        b.push_event(env(10_001 + u64::from(i), e));
    }
    store.commit(b).unwrap();
    let t = Instant::now();
    let s = state_at(&store, 20_000).unwrap();
    let ms = t.elapsed().as_millis();
    eprintln!("state_at: {ms} ms, {} events replayed", s.replayed);
    assert_eq!(s.replayed, 2_400);
    assert_eq!(s.nodes.len(), 6_724 - 120);
    let limit = if cfg!(debug_assertions) { 1_000 } else { 50 };
    assert!(ms < limit, "reconstruction took {ms} ms");
}

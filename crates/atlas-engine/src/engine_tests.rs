//! Engine-level tests: observations through the reducer (synthetic reorg, restore, flush),
//! chain cursor, time machine.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use atlas_core::event::{Event, EventEnvelope};
use atlas_core::live::{DeltaCause, LiveBody};
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
        city: "Falkenstein".into(),
        flux_os: Some("6.4.0".into()),
        hw: Some(crate::timemachine::SnapHw {
            cores: 8,
            ram_gb: 32,
            ssd_gb: 240,
        }),
        last_paid: None,
        app_count: 0,
        arcane: Some(false),
        first_seen_ms: 1,
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
    // Binary form decodes; ranks are not recorded, so the column is absent (not zeros).
    use atlas_core::codec::nodes_bin::{decode_nodes_bin, kind};
    let bin = state_at(&store, 3_500).unwrap().to_nodes_bin(9);
    let d = decode_nodes_bin(&bin).unwrap();
    assert_eq!(d.len(), 3);
    assert!(!d.has(kind::RANK));
    assert!(d.has(kind::VERSION) && d.has(kind::CORES) && d.has(kind::LAST_PAID));
    assert_eq!(d.versions[d.version_idx[0] as usize], "6.4.0");
    assert_eq!(d.cores[0], 8);
    // Node 4 joined after the keyframe: its hardware and version are unknown (0 / index 0).
    assert_eq!((d.cores[2], d.version_idx[2]), (0, 0));
    assert_eq!(d.locations[d.loc[0] as usize].city, "Falkenstein");
}

#[test]
fn time_machine_replays_versions_hardware_payments_and_apps() {
    use atlas_core::codec::nodes_bin::{decode_nodes_bin, flags, kind};
    use atlas_core::node::{Hardware, Versions};
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("d.redb")).unwrap();
    let mut b = WriteBatch::new();
    b.put_snapshot(
        1_000,
        &NetworkSnapshot {
            ts_ms: 1_000,
            tip_height: 100,
            nodes: (1..=2).map(snap_node).collect(),
        },
    )
    .unwrap();
    b.push_event(env(
        2_000,
        Event::NodeVersionChanged {
            node: NodeId(1),
            versions: Box::new(Versions {
                flux_os: Some("6.5.0".into()),
                ..Versions::default()
            }),
        },
    ));
    b.push_event(env(
        2_000,
        Event::NodeHardwareChanged {
            node: NodeId(2),
            hardware: Box::new(Hardware {
                cores: 16,
                ram_gb: 64.0,
                ssd_gb: 1_000.0,
                ..Hardware::default()
            }),
        },
    ));
    b.push_event(env(
        2_000,
        Event::NodePaid {
            node: Some(NodeId(2)),
            tier: Tier::Nimbus,
            address: "t1x".into(),
            amount: Amount::from_flux(3),
            height: 105,
        },
    ));
    let ep1 = snap_node(1).endpoint.unwrap();
    b.push_event(env(
        2_000,
        Event::AppInstanceStarted {
            app: "web".into(),
            node: None,
            endpoint: ep1,
        },
    ));
    let mut blk = fixture_block("flux/daemon_getblock_2996916_verbosity2.json").summary;
    blk.height = 110;
    b.push_event(env(2_500, Event::BlockAdded(Box::new(blk))));
    store.commit(b).unwrap();

    let s = state_at(&store, 3_000).unwrap();
    assert!(s.detail);
    assert_eq!(s.tip_height, 110);
    assert_eq!(s.nodes[0].flux_os.as_deref(), Some("6.5.0"));
    assert_eq!(s.nodes[0].app_count, 1, "instance resolved by endpoint");
    assert_eq!(s.nodes[1].hw.map(|h| h.cores), Some(16));
    assert_eq!(s.nodes[1].last_paid, Some(105));
    let d = decode_nodes_bin(&s.to_nodes_bin(0)).unwrap();
    assert!(d.has(kind::FLAGS) && d.has(kind::APP_COUNT) && d.has(kind::LAST_PAID));
    assert!(!d.has(kind::RANK));
    assert_eq!(d.last_paid, vec![0, 105]);
    assert_eq!(d.app_count, vec![1, 0]);
    assert_ne!(d.node_flags[0] & flags::HAS_APPS, 0);
    assert_ne!(d.node_flags[1] & flags::RECENTLY_PAID, 0);
    assert_eq!(d.ram_gb[1], 64);
}

#[test]
fn time_machine_reads_format_1_keyframes_without_inventing_columns() {
    use atlas_core::codec::nodes_bin::{decode_nodes_bin, kind};
    // The format-1 keyframe shape, written as the engine wrote it before format 2.
    #[derive(serde::Serialize)]
    struct V1Node {
        id: NodeId,
        outpoint: Outpoint,
        tier: Tier,
        status: NodeStatus,
        endpoint: Option<NodeEndpoint>,
        lat: Option<f32>,
        lon: Option<f32>,
        country_code: String,
        country: String,
        org: String,
    }
    #[derive(serde::Serialize)]
    struct V1 {
        ts_ms: u64,
        tip_height: u32,
        nodes: Vec<V1Node>,
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v1.redb");
    {
        let raw = postcard::to_allocvec(&V1 {
            ts_ms: 1_000,
            tip_height: 7,
            nodes: (1..=2)
                .map(|i| {
                    let n = snap_node(i);
                    V1Node {
                        id: n.id,
                        outpoint: n.outpoint,
                        tier: n.tier,
                        status: n.status,
                        endpoint: n.endpoint,
                        lat: n.lat,
                        lon: n.lon,
                        country_code: n.country_code,
                        country: n.country,
                        org: n.org,
                    }
                })
                .collect(),
        })
        .unwrap();
        let mut blob = vec![1u8];
        blob.extend(zstd::bulk::compress(&raw, 3).unwrap());
        // Let the store lay out its schema, then write the legacy blob under it.
        drop(Store::open(&path).unwrap());
        let db = redb::Database::open(&path).unwrap();
        let w = db.begin_write().unwrap();
        {
            let def: redb::TableDefinition<'_, u64, &[u8]> =
                redb::TableDefinition::new("snapshots");
            let mut t = w.open_table(def).unwrap();
            t.insert(1_000u64, blob.as_slice()).unwrap();
        }
        w.commit().unwrap();
    }
    let store = Store::open(&path).unwrap();
    let s = state_at(&store, 2_000).unwrap();
    assert!(!s.detail);
    assert_eq!(s.nodes.len(), 2);
    assert_eq!(s.nodes[0].country_code, "DE");
    assert_eq!(s.nodes[0].flux_os, None);
    let d = decode_nodes_bin(&s.to_nodes_bin(0)).unwrap();
    for k in [kind::RANK, kind::LAST_PAID, kind::APP_COUNT, kind::FLAGS] {
        assert!(
            !d.has(k),
            "column {k} was not recorded by a format-1 keyframe"
        );
    }
    assert_eq!(d.version_idx, vec![0, 0], "unknown version");
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

fn fixture_daemon_block(rel: &str) -> atlas_flux::models::daemon::DaemonBlock {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/research/fixtures")
        .join(rel);
    atlas_flux::envelope::parse_envelope("fixture", &std::fs::read(p).unwrap()).unwrap()
}

#[test]
fn mempool_txs_use_the_block_classifier() {
    use crate::jobs::chain::classify_mempool_tx;
    use atlas_core::chain::TxKind;
    let b = fixture_daemon_block("explorer/fluxos_daemon_getblock_2996879_with_start_v6.json");
    let kinds: Vec<(TxKind, Option<u32>)> = b
        .full_txs()
        .iter()
        .filter_map(|tx| match classify_mempool_tx(tx)? {
            Obs::MempoolClassified { kind, size, .. } => Some((kind, size)),
            _ => None,
        })
        .collect();
    // Block txs carry no height of their own in verbosity 2: they classify like mempool txs.
    assert!(kinds.contains(&(TxKind::NodeStart, Some(221))), "{kinds:?}");
    assert!(kinds.iter().any(|(k, _)| *k == TxKind::NodeConfirm));
    assert!(kinds.iter().all(|(_, s)| s.is_some()));
    // A mined transaction (getrawtransaction with a height) is not a mempool tx.
    let mut mined = b.full_txs()[1].clone();
    mined.height = Some(2_996_879);
    assert!(classify_mempool_tx(&mined).is_none());
}

#[test]
fn enricher_queue() {
    use crate::jobs::chain::Enricher;
    let mut q = Enricher::default();
    q.push(h(1));
    q.push(h(2));
    q.push(h(1));
    q.done(h(3));
    let set: std::collections::HashSet<Hash32> = [h(2), h(3), h(4)].into_iter().collect();
    q.snapshot(&set);
    // Newest first; h(3) was complete from the socket; each txid at most once.
    assert_eq!(q.next(), Some(h(4)));
    assert_eq!(q.next(), Some(h(2)));
    assert_eq!(q.next(), Some(h(1)));
    assert_eq!(q.next(), None);
    q.snapshot(&set);
    assert!(q.is_empty(), "handled txids are not fetched again");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mempool_classification_refines_and_discovers() {
    use atlas_core::chain::TxKind;
    use atlas_flux::insight_socket::SocketTx;
    use atlas_flux::models::apps::APP_PAYMENT_ADDRESS;
    let dir = tempfile::tempdir().unwrap();
    let eng = start(Store::open(dir.path().join("m.redb")).unwrap());
    let mut rx = eng.subscribe();
    let socket = |txid, outputs: Vec<(String, Amount)>| Obs::MempoolTx {
        tx: SocketTx {
            txid,
            value_out: outputs.iter().map(|(_, v)| *v).sum(),
            outputs,
            is_rbf: false,
        },
        received_ms: now_ms(),
    };
    // A socket fluxnode push (no outputs): its txid resolves nowhere, so it is ignored.
    inject(&eng, socket(h(9), Vec::new())).await;
    // A socket app payment: `app_message` until the fetch reads its OP_RETURN.
    inject(
        &eng,
        socket(
            h(10),
            vec![(APP_PAYMENT_ADDRESS.to_string(), Amount::from_flux(1))],
        ),
    )
    .await;
    let set: std::collections::HashMap<Hash32, u32> =
        [(h(10), 201), (h(11), 0)].into_iter().collect();
    inject(&eng, Obs::MempoolSnapshot(set)).await;
    let classified = |txid, kind| Obs::MempoolClassified {
        txid,
        kind,
        value: Amount::ZERO,
        size: Some(199),
        output_count: 0,
    };
    // Refines the socket tx (no message hash: a plain transfer to the app address); adds h(11),
    // which the socket never pushed; ignores h(12), which is not in the reconciled set (mined
    // meanwhile).
    inject(&eng, classified(h(10), TxKind::Transfer)).await;
    inject(&eng, classified(h(11), TxKind::NodeStart)).await;
    inject(&eng, classified(h(12), TxKind::NodeStart)).await;
    until("classified mempool published", || {
        let p = eng.published();
        p.mempool.len() == 2
            && p.mempool
                .iter()
                .any(|(t, _)| t.txid == h(10) && t.kind == TxKind::Transfer)
    })
    .await;
    let p = eng.published();
    let by: std::collections::HashMap<Hash32, &atlas_core::api::TxLite> =
        p.mempool.iter().map(|(t, _)| (t.txid, t)).collect();
    assert_eq!(by[&h(10)].size, Some(201), "size from the reconcile");
    assert_eq!(by[&h(11)].size, Some(199), "size from the fetched tx");
    assert_eq!(by[&h(11)].kind, TxKind::NodeStart);
    assert!(!by.contains_key(&h(9)), "socket node push ignored");
    assert!(!by.contains_key(&h(12)));
    // Live: the socket app payment, then the discovered node tx; refinements are not re-sent and
    // the socket node push never reaches browsers.
    let mut seen: Vec<(Hash32, TxKind)> = Vec::new();
    until("mempool messages", || {
        while let Ok(m) = rx.try_recv() {
            if let LiveBody::Mempool { txs } = &m.body {
                seen.extend(txs.iter().map(|t| (t.txid, t.kind)));
            }
        }
        seen.len() >= 2
    })
    .await;
    assert_eq!(
        seen,
        vec![(h(10), TxKind::AppMessage), (h(11), TxKind::NodeStart)]
    );
}

/// The upstream payment queue of a small synthetic network: every node has its own payment
/// address, each block pays the head of every tier, and the paid node moves to the back.
struct UpstreamQueue {
    nodes: Vec<atlas_flux::models::nodes::ListedNode>,
    height: u32,
}

impl UpstreamQueue {
    fn new(per_tier: u32, height: u32) -> Self {
        let mut nodes = Vec::new();
        for (t, tier) in Tier::ALL.iter().enumerate() {
            for i in 0..per_tier {
                let k = t as u32 * 1_000 + i;
                nodes.push(atlas_flux::models::nodes::ListedNode {
                    outpoint: Outpoint::new(h(50_000 + k), 0),
                    endpoint: Some(NodeEndpoint::new(
                        format!("8.9.{t}.{}", i + 1).parse().unwrap(),
                        16127,
                    )),
                    tier: *tier,
                    status: NodeStatus::Confirmed,
                    payment_address: format!("t1synthetic{k:06}").into(),
                    pubkey: "".into(),
                    rank: None,
                    added_height: 100,
                    confirmed_height: Some(100),
                    last_confirmed_height: Some(height - 50),
                    last_paid_height: Some(height - per_tier + i),
                    active_since_ms: None,
                    last_paid_ms: None,
                    collateral_amount: None,
                });
            }
        }
        let mut q = Self { nodes, height };
        q.rerank();
        q
    }

    fn rerank(&mut self) {
        for tier in Tier::ALL {
            let mut idx: Vec<usize> = (0..self.nodes.len())
                .filter(|i| self.nodes[*i].tier == tier)
                .collect();
            idx.sort_by_key(|i| self.nodes[*i].last_paid_height);
            for (r, i) in idx.into_iter().enumerate() {
                self.nodes[i].rank = Some(r as u32);
            }
        }
    }

    /// Mines the next block: pays every tier's head. Returns the block's payouts.
    fn advance(&mut self) -> Vec<atlas_core::chain::Payout> {
        self.height += 1;
        let mut payouts = Vec::new();
        for tier in Tier::ALL {
            let head = (0..self.nodes.len())
                .filter(|i| self.nodes[*i].tier == tier)
                .min_by_key(|i| self.nodes[*i].last_paid_height)
                .unwrap();
            self.nodes[head].last_paid_height = Some(self.height);
            payouts.push(atlas_core::chain::Payout {
                tier,
                address: self.nodes[head].payment_address.clone(),
                amount: atlas_core::Amount::from_flux(1),
                node: None,
            });
        }
        self.rerank();
        payouts
    }

    fn ranks(&self) -> HashMap<Outpoint, Option<u32>> {
        self.nodes.iter().map(|n| (n.outpoint, n.rank)).collect()
    }
}

/// A synthetic block paying `payouts`, without node transactions.
fn paying_block(
    base: &DecodedBlock,
    height: u32,
    prev: Hash32,
    payouts: Vec<atlas_core::chain::Payout>,
) -> DecodedBlock {
    let mut d = synth(base, height, 0, prev);
    d.summary.payouts = payouts.into_iter().collect();
    d.summary.producer_collateral = None;
    d.node_txs.clear();
    d.spent.clear();
    d.transfers.clear();
    d
}

fn published_ranks(eng: &EngineHandle) -> HashMap<Outpoint, Option<u32>> {
    eng.published()
        .nodes
        .iter()
        .map(|r| (r.outpoint, r.rank))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_after_downtime_replays_blocks_without_rank_corrections() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    let base = fixture_block("flux/daemon_getblock_2996916_verbosity2.json");
    let start_height = 3_000_000;
    let mut up = UpstreamQueue::new(8, start_height - 1);
    // One node stops confirming and expires during the downtime: fluxd drops it with the block
    // `last_confirmed + 641` = start_height + 5.
    let doomed = up
        .nodes
        .iter()
        .position(|n| n.tier == Tier::Stratus && n.rank == Some(7))
        .unwrap();
    up.nodes[doomed].last_confirmed_height = Some(start_height + 5 - 641);
    let doomed_op = up.nodes[doomed].outpoint;

    // Before the restart: a first block, the initial list, three more blocks and a clean
    // reconcile.
    let eng = start(store.clone());
    let mut prev = h(1);
    for i in 0..4 {
        let b = paying_block(&base, start_height + i, prev, up.advance());
        prev = b.summary.hash;
        inject(
            &eng,
            Obs::Block {
                block: Box::new(b),
                received_ms: now_ms(),
                discontinuous: i == 0,
            },
        )
        .await;
        if i == 0 {
            inject(&eng, Obs::NodeList(up.nodes.clone())).await;
        }
    }
    inject(&eng, Obs::NodeList(up.nodes.clone())).await;
    until("second reconcile", || eng.stats().reconciles == 2).await;
    let s = eng.stats();
    assert_eq!(s.reconcile_diffs, 0, "steady state is clean: {s:?}");
    until("ranks before the restart", || {
        published_ranks(&eng) == up.ranks()
    })
    .await;
    let stored_ranks = up.ranks();
    let doomed_id = eng
        .published()
        .nodes
        .iter()
        .find(|r| r.outpoint == doomed_op)
        .map(|r| r.id)
        .unwrap();
    eng.shutdown().await;
    drop(eng);

    // Downtime: four blocks are mined while the server is down; the doomed node expires with
    // the second of them and leaves the upstream list.
    let missed: Vec<DecodedBlock> = (4..8)
        .map(|i| {
            let b = paying_block(&base, start_height + i, prev, up.advance());
            prev = b.summary.hash;
            if start_height + i == start_height + 5 {
                up.nodes.retain(|n| n.outpoint != doomed_op);
                up.rerank();
            }
            b
        })
        .collect();

    // Restart: the restored ranks are exact for the stored tip before anything else happens.
    let eng = start(store.clone());
    assert_eq!(
        published_ranks(&eng),
        stored_ranks,
        "restored ranks match the stored tip"
    );
    assert_eq!(
        eng.published().network.tip.as_ref().map(|t| t.height),
        Some(start_height + 3)
    );
    // The first publish already names the next block's payees (the restored queue heads), so
    // the bootstrap carries them before any block arrives.
    let p = eng.published();
    assert_eq!(p.next_payees.len(), 3);
    assert!(p.next_payees.iter().all(|x| x.node.is_some()));
    let np = crate::publish::next_payees_msg(start_height + 3, &p.next_payees).unwrap();
    assert_eq!(np.height, start_height + 4);

    // The registry job is usually faster than the block catch-up: the list (already at the
    // real tip) lands before the missed blocks are applied. It must wait for them.
    let mut rx = eng.subscribe();
    inject(&eng, Obs::NodeList(up.nodes.clone())).await;
    for b in &missed {
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
    until("deferred reconcile after the catch-up", || {
        eng.stats().reconciles == 1
    })
    .await;
    let s = eng.stats();
    assert_eq!(
        s.reconcile_diffs, 0,
        "first reconcile after the restart: {s:?}"
    );
    assert_eq!(
        s.payouts_exact, 12,
        "every missed payout hits the queue head"
    );
    until("ranks after the catch-up", || {
        published_ranks(&eng) == up.ranks()
    })
    .await;
    assert_eq!(eng.stats().rank_corrections, 0, "no correction burst");
    let mut corrections = 0;
    let mut expired_by_block = false;
    while let Ok(m) = rx.try_recv() {
        if let LiveBody::Nodes(d) = &m.body {
            corrections += d.changed.iter().filter(|c| c.rank.is_some()).count();
            // (The catch-up and the deferred reconcile may share one tick, so the status in
            // the block delta can already be the final `departed`.)
            expired_by_block |= d.cause == DeltaCause::Block
                && d.changed
                    .iter()
                    .any(|c| c.id == doomed_id && c.status.is_some());
        }
    }
    assert_eq!(
        corrections, 0,
        "clients rotate ranks from the block payouts alone"
    );
    // The replayed blocks derive expiry like live ones (the restored model is armed), so the
    // node leaves the queue at its real height, not at the first reconcile.
    assert!(
        expired_by_block,
        "the catch-up expired the node at its height"
    );
    eng.shutdown().await;
}

fn geoip_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../atlas-geoip/tests/fixtures/GeoIP2-City-Test.mmdb")
}

/// Two confirmed nodes on test-database addresses: London with a reported location (no city),
/// Linkoping without any location.
fn seed_geo_nodes(store: &Store) {
    let mut b = WriteBatch::new();
    for (i, ip, geo) in [
        (0u32, "81.2.69.142", Some(test_geo(51.5, -0.1, "GB"))),
        (1, "89.160.20.128", None),
    ] {
        let op = Outpoint::new(h(70_000 + i), 0);
        b.intern_node(op, NodeId(i));
        b.put_node(NodeRecord {
            id: NodeId(i),
            outpoint: op,
            endpoint: Some(NodeEndpoint::new(ip.parse().unwrap(), 16127)),
            tier: Tier::Cumulus,
            status: NodeStatus::Confirmed,
            geo,
            ..NodeRecord::default()
        });
    }
    store.commit(b).unwrap();
}

fn cities(eng: &EngineHandle) -> Vec<(String, atlas_core::node::GeoSource)> {
    eng.published()
        .nodes
        .iter()
        .map(|r| {
            let g = r.geo.clone().unwrap_or_default();
            (g.city.to_string(), g.source)
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn geoip_database_at_start_enriches_before_the_first_publish() {
    use atlas_core::node::GeoSource;
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    seed_geo_nodes(&store);
    let clients = Clients::new(ClientsConfig::default()).unwrap();
    let cfg = EngineConfig {
        ping_interval: Duration::from_secs(3600),
        ingest: IngestConfig::disabled(),
        geoip: crate::geoip::GeoIpConfig::file(geoip_fixture()),
        ..EngineConfig::default()
    };
    let eng = Engine::start(cfg, store, clients);
    // The very first published state already has the cities.
    assert_eq!(
        cities(&eng),
        vec![
            ("London".to_owned(), GeoSource::StatsLookup),
            ("Linköping".to_owned(), GeoSource::LocalDb)
        ]
    );
    let p = eng.published();
    assert_eq!(p.attributions.len(), 1);
    assert_eq!(p.attributions[0].text, "IP Geolocation by DB-IP");
    assert_eq!(p.attributions[0].url, "https://db-ip.com");
    until("bodies", || eng.published().bodies.bootstrap.is_some()).await;
    let boot: atlas_core::api::BootstrapDto =
        serde_json::from_slice(&eng.published().bodies.bootstrap.as_ref().unwrap().raw).unwrap();
    assert_eq!(boot.attributions.unwrap()[0].license, "CC BY 4.0");
    let bin = atlas_core::codec::nodes_bin::decode_nodes_bin(
        &eng.published().bodies.nodes_bin.as_ref().unwrap().raw,
    )
    .unwrap();
    let names: Vec<&str> = bin
        .loc
        .iter()
        .map(|l| bin.locations[*l as usize].city.as_str())
        .collect();
    assert_eq!(names, vec!["London", "Linköping"]);
    assert_eq!(
        bin.node_flags[0] & atlas_core::codec::nodes_bin::flags::GEO_APPROX,
        0
    );
    assert_ne!(
        bin.node_flags[1] & atlas_core::codec::nodes_bin::flags::GEO_APPROX,
        0
    );
    eng.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn geoip_database_loaded_later_streams_a_geo_delta() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("a.redb")).unwrap();
    seed_geo_nodes(&store);
    let eng = start(store.clone());
    assert!(eng.published().attributions.is_empty());
    assert!(cities(&eng).iter().all(|(c, _)| c.is_empty()));
    let mut rx = eng.subscribe();
    let g = crate::geoip::LoadedGeoIp::open(&geoip_fixture()).unwrap();
    inject(&eng, Obs::GeoIp(g)).await;
    until("cities published", || {
        cities(&eng).iter().all(|(c, _)| !c.is_empty())
    })
    .await;
    assert_eq!(eng.published().attributions.len(), 1);
    let mut delta_cities = Vec::new();
    until("geo delta", || {
        while let Ok(m) = rx.try_recv() {
            if let LiveBody::Nodes(d) = &m.body {
                assert_eq!(d.cause, atlas_core::live::DeltaCause::Geo);
                delta_cities.extend(d.changed.iter().filter_map(|c| c.city.clone()));
            }
        }
        delta_cities.len() == 2
    })
    .await;
    delta_cities.sort();
    assert_eq!(
        delta_cities,
        vec!["Linköping".to_owned(), "London".to_owned()]
    );
    eng.shutdown().await;
    drop(eng);
    // Restarted without the database: the stored cities still came from DB-IP, so the credit
    // stays (without a version).
    let eng = start(store);
    let p = eng.published();
    assert_eq!(p.attributions.len(), 1);
    assert_eq!(p.attributions[0].version, None);
    assert!(cities(&eng).iter().all(|(c, _)| !c.is_empty()));
    eng.shutdown().await;
}

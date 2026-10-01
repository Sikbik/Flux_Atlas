//! Integration tests for atlas-store on a temporary directory.
#![allow(clippy::unwrap_used)]

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::{Duration, Instant};

use tempfile::TempDir;

use atlas_core::Amount;
use atlas_core::app::{AppMessageRecord, AppRecord, AppSpec, PendingAppMessage};
use atlas_core::chain::{BlockKind, BlockSummary, NodeTx, NodeTxKind, Payout};
use atlas_core::event::{AppMessageKind, Event, EventEnvelope};
use atlas_core::ids::{Hash32, NodeId, Outpoint};
use atlas_core::node::{Geo, NodeRecord, Tier};
use atlas_store::{
    CHAIN_SAMPLE_GRID, ChainPoint, DAY_MS, EventKey, HOUR_MS, MINUTE_MS, MeshChangeRecord,
    MeshEdgeRecord, MeshReporter, MetricsRow, Order, Resolution, RetentionPolicy, SCHEMA_VERSION,
    Store, StoreError, StoreOptions, WriteBatch, meta_keys,
};

fn tmp() -> (TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("atlas.redb");
    (dir, path)
}

fn outpoint(n: u32) -> Outpoint {
    let mut txid = [0u8; 32];
    txid[..4].copy_from_slice(&n.to_be_bytes());
    Outpoint::new(Hash32(txid), n % 3)
}

fn hash(n: u32, salt: u8) -> Hash32 {
    let mut h = [salt; 32];
    h[..4].copy_from_slice(&n.to_be_bytes());
    Hash32(h)
}

fn node(id: u32) -> NodeRecord {
    NodeRecord {
        id: NodeId(id),
        outpoint: outpoint(id),
        endpoint: Some(format!("10.0.0.{}:16127", id % 250).parse().unwrap()),
        tier: Tier::from_u8((id % 3 + 1) as u8),
        payment_address: format!("t1node{id}").into(),
        added_height: 100 + id,
        first_seen_ms: 1_000,
        last_seen_ms: 2_000,
        ..NodeRecord::default()
    }
}

fn block(height: u32, salt: u8, paid: &[(Tier, Option<u32>)]) -> BlockSummary {
    BlockSummary {
        height,
        hash: hash(height, salt),
        prev_hash: hash(height.wrapping_sub(1), salt),
        time_ms: u64::from(height) * 30_000,
        size: 3_000,
        tx_count: 16,
        kind: BlockKind::Pon,
        version: 100,
        producer_collateral: None,
        producer: Some(NodeId(1)),
        payouts: paid
            .iter()
            .map(|(tier, n)| Payout {
                tier: *tier,
                address: "t1payee".into(),
                amount: Amount(i64::from(tier.as_u8()) * 100_000_000 + i64::from(height)),
                node: n.map(NodeId),
            })
            .collect(),
        dev_fund: Amount(50_000_000),
        fees: Amount::ZERO,
        reward: Amount::from_flux(14),
        value_out: Amount::ZERO,
        confirm_count: 12,
        start_count: 0,
        transfer_count: 1,
    }
}

fn node_tx(height: u32, node: Option<u32>, n: u32) -> NodeTx {
    NodeTx {
        txid: hash(n, 0x77),
        height: Some(height),
        kind: NodeTxKind::UpdateConfirm,
        collateral: outpoint(node.unwrap_or(9_999)),
        endpoint: None,
        benchmark_tier: Some(Tier::Cumulus),
        sig_time: 1,
        tx_version: 5,
        upgraded_version: None,
        p2sh: false,
        node: node.map(NodeId),
    }
}

fn env(seq: u64, observed_ms: u64, event: Event) -> EventEnvelope {
    EventEnvelope {
        seq,
        observed_ms,
        event_ms: None,
        event,
    }
}

fn spec(name: &str) -> AppSpec {
    AppSpec {
        spec_version: 8,
        name: name.into(),
        description: "a test application with a reasonably long description".into(),
        owner: "1ownerzelid".into(),
        instances: 3,
        contacts: vec!["ops@example.com".into()],
        ..AppSpec::default()
    }
}

fn app_msg(name: &str, height: u32, n: u32) -> AppMessageRecord {
    AppMessageRecord {
        hash: hash(n, 0xAA),
        txid: Some(hash(n, 0xBB)),
        height,
        timestamp_ms: u64::from(height) * 1_000,
        kind: if n.is_multiple_of(5) {
            AppMessageKind::Register
        } else {
            AppMessageKind::Update
        },
        paid: Amount::from_flux(1),
        spec: spec(name),
    }
}

fn pending(n: u32, expires_ms: u64) -> PendingAppMessage {
    PendingAppMessage {
        hash: hash(n, 0xCC),
        kind: AppMessageKind::Register,
        timestamp_ms: 1,
        received_ms: 2,
        expires_ms,
        arcane_sender: None,
        spec: spec("pendingapp"),
    }
}

fn metrics(ts_ms: u64, node_count: u32, block_count: u32) -> MetricsRow {
    MetricsRow {
        ts_ms,
        node_count: Some(node_count),
        block_count: Some(block_count),
        avg_block_time_ms: Some(30_000),
        samples: 1,
        ..MetricsRow::default()
    }
}

#[test]
fn open_creates_tables_and_schema_version() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    assert_eq!(
        store.meta_u64(meta_keys::SCHEMA_VERSION).unwrap(),
        Some(SCHEMA_VERSION)
    );
    assert!(store.meta_u64(meta_keys::CREATED_MS).unwrap().is_some());
    let counts = store.table_counts().unwrap();
    assert_eq!(counts.len(), 25);
    assert!(counts.iter().all(|(name, n)| *name == "meta" || *n == 0));
}

#[test]
fn reopen_keeps_data_and_interning_is_stable() {
    let (_dir, path) = tmp();
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(store.next_node_id().unwrap(), NodeId(0));
        let mut b = WriteBatch::new();
        for id in 0..50 {
            b.intern_node(outpoint(id), NodeId(id)).put_node(node(id));
        }
        b.set_meta_u64(meta_keys::TIP_HEIGHT, 3_000_000)
            .set_meta("blob", b"hello");
        store.commit(b).unwrap();
        // Non-durable commit followed by an explicit flush.
        let mut b = WriteBatch::new();
        b.put_app(AppRecord::from_spec(spec("MyApp"), None, 10, 5));
        store.commit(b).unwrap();
        store.flush().unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert_eq!(store.next_node_id().unwrap(), NodeId(50));
    for id in [0, 7, 49] {
        assert_eq!(store.node_id_for(&outpoint(id)).unwrap(), Some(NodeId(id)));
        assert_eq!(store.outpoint_for(NodeId(id)).unwrap(), Some(outpoint(id)));
        assert_eq!(store.node(NodeId(id)).unwrap(), Some(node(id)));
    }
    assert_eq!(store.node_id_for(&outpoint(500)).unwrap(), None);
    let ids = store.node_ids().unwrap();
    assert_eq!(ids.len(), 50);
    assert!(ids.windows(2).all(|w| w[0].1 < w[1].1));
    assert_eq!(store.nodes().unwrap().len(), 50);
    assert_eq!(
        store.meta_u64(meta_keys::TIP_HEIGHT).unwrap(),
        Some(3_000_000)
    );
    assert_eq!(store.meta_bytes("blob").unwrap().unwrap(), b"hello");
    assert_eq!(store.app("MYAPP").unwrap().unwrap().display_name, "MyApp");

    // Re-interning the same mapping is a no-op.
    let mut b = WriteBatch::new();
    b.intern_node(outpoint(3), NodeId(3));
    store.commit(b).unwrap();
}

#[test]
fn failed_batch_is_atomic() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    b.intern_node(outpoint(1), NodeId(1));
    store.commit(b).unwrap();

    // Everything before the conflicting op must be rolled back too.
    let mut b = WriteBatch::new();
    b.put_node(node(2))
        .push_event(env(1, 10, Event::NodeRecovered { node: NodeId(2) }))
        .put_block(block(10, 1, &[]))
        .intern_node(outpoint(1), NodeId(7));
    let err = store.commit(b).unwrap_err();
    assert!(matches!(err, StoreError::InternConflict(_)), "{err}");
    assert_eq!(store.node(NodeId(2)).unwrap(), None);
    assert!(store.latest_events(10).unwrap().is_empty());
    assert_eq!(store.block(10).unwrap(), None);

    // The reverse direction conflicts as well.
    let mut b = WriteBatch::new();
    b.intern_node(outpoint(2), NodeId(1));
    assert!(matches!(
        store.commit(b),
        Err(StoreError::InternConflict(_))
    ));
    assert_eq!(store.node_id_for(&outpoint(1)).unwrap(), Some(NodeId(1)));
}

#[test]
fn events_are_ordered_and_indexed() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    // Out-of-order observation times, and several events in the same millisecond sharing the
    // same publish seq.
    for (i, ts) in [500u64, 100, 300, 300, 300, 200, 400].iter().enumerate() {
        b.push_event(env(
            7,
            *ts,
            Event::NodeAtRisk {
                node: NodeId((i % 2) as u32),
                blocks_since_confirm: i as u32,
            },
        ));
    }
    b.push_event(env(8, 350, Event::AppExpired { app: "Demo".into() }));
    b.push_event(env(
        8,
        360,
        Event::RankShift {
            tier: Tier::Nimbus,
            changed: 3,
        },
    ));
    store.commit(b).unwrap();

    let all = store.events(.., Order::Asc, 100).unwrap();
    assert_eq!(all.len(), 9);
    assert!(all.windows(2).all(|w| w[0].0 < w[1].0));
    let times: Vec<u64> = all.iter().map(|(k, _)| k.ts_ms).collect();
    assert_eq!(times, vec![100, 200, 300, 300, 300, 350, 360, 400, 500]);
    // Same-ms events keep insertion order (i = 2, 3, 4).
    let same_ms: Vec<u32> = all
        .iter()
        .filter(|(k, _)| k.ts_ms == 300)
        .map(|(_, e)| match e.event {
            Event::NodeAtRisk {
                blocks_since_confirm,
                ..
            } => blocks_since_confirm,
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(same_ms, vec![2, 3, 4]);

    let latest = store.latest_events(3).unwrap();
    let latest_ts: Vec<u64> = latest.iter().map(|(k, _)| k.ts_ms).collect();
    assert_eq!(latest_ts, vec![500, 400, 360]);

    // Paging with a cursor.
    let page2 = store.events(..latest[2].0, Order::Desc, 2).unwrap();
    let page2_ts: Vec<u64> = page2.iter().map(|(k, _)| k.ts_ms).collect();
    assert_eq!(page2_ts, vec![350, 300]);

    // Time range, inclusive both ends.
    let mid = store
        .events(
            EventKey::first_at(200)..=EventKey::last_at(300),
            Order::Asc,
            100,
        )
        .unwrap();
    assert_eq!(mid.len(), 4);

    // Node index: node 0 got i = 0, 2, 4, 6 at ts 500, 300, 300, 400.
    let n0 = store.node_events(NodeId(0), .., Order::Asc, 100).unwrap();
    let n0_ts: Vec<u64> = n0.iter().map(|(k, _)| k.ts_ms).collect();
    assert_eq!(n0_ts, vec![300, 300, 400, 500]);
    let n0_desc = store
        .node_events(NodeId(0), ..EventKey::first_at(500), Order::Desc, 2)
        .unwrap();
    let n0_desc_ts: Vec<u64> = n0_desc.iter().map(|(k, _)| k.ts_ms).collect();
    assert_eq!(n0_desc_ts, vec![400, 300]);
    let n1 = store
        .node_events(
            NodeId(1),
            EventKey::first_at(0)..EventKey::first_at(250),
            Order::Asc,
            100,
        )
        .unwrap();
    assert_eq!(n1.len(), 2);
    assert!(
        store
            .node_events(NodeId(2), .., Order::Asc, 10)
            .unwrap()
            .is_empty()
    );

    // App index is case-insensitive.
    let a = store.app_events("DEMO", .., Order::Desc, 10).unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].0.ts_ms, 350);
    assert!(
        store
            .app_events("other", .., Order::Asc, 10)
            .unwrap()
            .is_empty()
    );

    // Row sequence keeps increasing across commits and reopen.
    let last_seq = all.iter().map(|(k, _)| k.seq).max().unwrap();
    drop(store);
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    b.push_event(env(9, 50, Event::NodeRecovered { node: NodeId(0) }));
    store.commit(b).unwrap();
    let first = store.events(.., Order::Asc, 1).unwrap();
    assert_eq!(first[0].0.ts_ms, 50);
    assert!(first[0].0.seq > last_seq);
}

#[test]
fn blocks_payments_and_node_txs() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    for h in 100..120u32 {
        // Node 5 is paid on even heights, node 6 on odd ones; Stratus payee is unknown.
        let payee = if h % 2 == 0 { 5 } else { 6 };
        b.put_block(block(
            h,
            1,
            &[(Tier::Cumulus, Some(payee)), (Tier::Stratus, None)],
        ));
        b.put_node_tx(h, 0, node_tx(h, Some(payee), h));
        b.put_node_tx(h, 1, node_tx(h, None, h + 1_000));
    }
    store.commit(b).unwrap();

    assert_eq!(store.tip_block().unwrap().unwrap().height, 119);
    assert_eq!(
        store.block_by_hash(&hash(110, 1)).unwrap().unwrap().height,
        110
    );
    assert_eq!(store.block_by_hash(&hash(110, 2)).unwrap(), None);
    let heights: Vec<u32> = store
        .blocks_before(u32::MAX, 5)
        .unwrap()
        .iter()
        .map(|b| b.height)
        .collect();
    assert_eq!(heights, vec![119, 118, 117, 116, 115]);
    let heights: Vec<u32> = store
        .blocks_before(102, 5)
        .unwrap()
        .iter()
        .map(|b| b.height)
        .collect();
    assert_eq!(heights, vec![101, 100]);
    assert_eq!(store.blocks_range(105, 107).unwrap().len(), 3);

    let payouts = store.block_payouts(110).unwrap();
    assert_eq!(payouts.len(), 2);
    assert_eq!(payouts[0].tier, Tier::Cumulus);
    assert_eq!(payouts[1].node, None);

    let pay = store.payments_for_node(NodeId(5), None, 3).unwrap();
    let pay_h: Vec<u32> = pay.iter().map(|p| p.0).collect();
    assert_eq!(pay_h, vec![118, 116, 114]);
    assert_eq!(pay[0].1, Amount(100_000_000 + 118));
    let next = store.payments_for_node(NodeId(5), Some(114), 100).unwrap();
    assert_eq!(next.first().unwrap().0, 112);
    assert_eq!(next.last().unwrap().0, 100);
    assert!(
        store
            .payments_for_node(NodeId(7), None, 10)
            .unwrap()
            .is_empty()
    );

    let txs = store.node_txs_for_node(NodeId(6), None, 3).unwrap();
    let tx_h: Vec<u32> = txs.iter().map(|t| t.height.unwrap()).collect();
    assert_eq!(tx_h, vec![119, 117, 115]);
    let txs = store.node_txs_for_node(NodeId(6), Some(115), 100).unwrap();
    assert_eq!(txs.len(), 7);
    let at = store.node_txs_at_height(110).unwrap();
    assert_eq!(at.len(), 2);
    assert_eq!(at[0].node, Some(NodeId(5)));
    assert_eq!(at[1].node, None);
}

#[test]
fn reorg_deletes_blocks_and_dependent_rows() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    for h in 100..110u32 {
        b.put_block(block(h, 1, &[(Tier::Nimbus, Some(3))]));
        b.put_node_tx(h, 0, node_tx(h, Some(3), h));
    }
    store.commit(b).unwrap();

    let mut b = WriteBatch::new();
    b.delete_blocks_from(105);
    for h in 105..107u32 {
        b.put_block(block(h, 2, &[(Tier::Nimbus, Some(4))]));
    }
    store.commit(b).unwrap();

    assert_eq!(store.tip_block().unwrap().unwrap().height, 106);
    assert_eq!(store.block(107).unwrap(), None);
    assert_eq!(store.block_by_hash(&hash(107, 1)).unwrap(), None);
    assert_eq!(store.block_by_hash(&hash(105, 1)).unwrap(), None);
    assert_eq!(
        store.block_by_hash(&hash(105, 2)).unwrap().unwrap().height,
        105
    );
    let pay3: Vec<u32> = store
        .payments_for_node(NodeId(3), None, 100)
        .unwrap()
        .iter()
        .map(|p| p.0)
        .collect();
    assert_eq!(pay3, vec![104, 103, 102, 101, 100]);
    assert_eq!(
        store.payments_for_node(NodeId(4), None, 100).unwrap().len(),
        2
    );
    assert_eq!(store.block_payouts(108).unwrap().len(), 0);
    assert_eq!(store.block_payouts(105).unwrap()[0].node, Some(NodeId(4)));
    assert!(store.node_txs_at_height(105).unwrap().is_empty());
    assert_eq!(
        store.node_txs_for_node(NodeId(3), None, 100).unwrap().len(),
        5
    );

    // Replacing a height without an explicit delete also drops the old hash and payment.
    let mut b = WriteBatch::new();
    b.put_block(block(104, 3, &[(Tier::Nimbus, Some(4))]));
    store.commit(b).unwrap();
    assert_eq!(store.block_by_hash(&hash(104, 1)).unwrap(), None);
    assert_eq!(
        store.payments_for_node(NodeId(3), None, 1).unwrap()[0].0,
        103
    );
    assert_eq!(
        store.payments_for_node(NodeId(4), None, 10).unwrap().len(),
        3
    );
}

fn point(time_s: u32, difficulty: Option<f64>) -> ChainPoint {
    ChainPoint { time_s, difficulty }
}

#[test]
fn chain_points_reorg_overwrite_and_delete() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    for h in 100..110u32 {
        b.put_block(block(h, 1, &[]));
        b.put_chain_point(h, point(h * 30, Some(1.0)));
    }
    store.commit(b).unwrap();
    // A reorg at 105: the old rows above the fork go, the replacement blocks overwrite.
    let mut b = WriteBatch::new();
    b.delete_blocks_from(105);
    b.put_chain_point(105, point(105 * 30 + 7, Some(2.0)));
    store.commit(b).unwrap();
    let rows = store.chain_points(100, 200).unwrap();
    assert_eq!(rows.len(), 6);
    assert_eq!(rows.last().unwrap(), &(105, point(105 * 30 + 7, Some(2.0))));
    assert_eq!(store.chain_point(107).unwrap(), None);
    // Replacing a height without a delete (a sample fetched again) also overwrites.
    let mut b = WriteBatch::new();
    b.put_chain_point(104, point(1, Some(3.0)));
    store.commit(b).unwrap();
    assert_eq!(store.chain_point(104).unwrap(), Some(point(1, Some(3.0))));
    assert_eq!(store.latest_chain_point().unwrap().unwrap().0, 105);
    assert!(store.chain_points(9, 3).unwrap().is_empty());
}

#[test]
fn chain_points_thin_to_the_grid_and_list_missing_samples() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let g = CHAIN_SAMPLE_GRID;
    // Per-block rows for heights 0..=3g at 30 s, the newest third newer than the cutoff.
    let mut b = WriteBatch::new();
    for h in 0..=3 * g {
        b.put_chain_point(h, point(1_000_000 + h * 30, Some(f64::from(h))));
    }
    store.commit(b).unwrap();
    let cutoff_ms = u64::from(1_000_000 + 2 * g * 30) * 1000;
    let removed = store.thin_chain_points_before(cutoff_ms).unwrap();
    // Every row older than the cutoff goes except the grid heights 0 and g.
    assert_eq!(removed, u64::from(2 * g - 2));
    let rows = store.chain_points(0, 3 * g).unwrap();
    assert_eq!(rows[0].0, 0);
    assert_eq!(rows[1].0, g);
    assert_eq!(rows[2].0, 2 * g);
    assert_eq!(rows.len() as u32, g + 3);
    assert_eq!(store.thin_chain_points_before(cutoff_ms).unwrap(), 0);

    // Missing samples: grid heights without a row with a difficulty.
    assert!(store.chain_grid_missing(g, 3 * g).unwrap().is_empty());
    let mut b = WriteBatch::new();
    b.put_chain_point(g, point(5, None));
    store.commit(b).unwrap();
    assert_eq!(
        store.chain_grid_missing(g, 6 * g + 1).unwrap(),
        vec![g, 4 * g, 5 * g, 6 * g]
    );
}

#[test]
fn chain_points_seed_from_stored_blocks_once() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    for h in 100..110u32 {
        b.put_block(block(h, 1, &[]));
    }
    b.put_chain_point(108, point(9, Some(4.0)));
    b.put_chain_daily(DAY_MS, 11.5);
    b.put_chain_daily(0, 10.5);
    store.commit(b).unwrap();
    // Blocks at or after 103 (time_ms = height x 30 s) without a row get one, time only.
    assert_eq!(
        store.seed_chain_points_from_blocks(103 * 30_000).unwrap(),
        6
    );
    assert_eq!(store.seed_chain_points_from_blocks(0).unwrap(), 3);
    assert_eq!(store.chain_point(104).unwrap(), Some(point(104 * 30, None)));
    assert_eq!(store.chain_point(108).unwrap(), Some(point(9, Some(4.0))));
    assert_eq!(
        store.chain_daily().unwrap(),
        vec![(0, 10.5), (DAY_MS, 11.5)]
    );
}

#[test]
fn apps_messages_and_pending() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    b.put_app(AppRecord::from_spec(spec("Alpha"), None, 10, 1))
        .put_app(AppRecord::from_spec(spec("beta"), None, 11, 1));
    for (i, h) in [300u32, 100, 200].iter().enumerate() {
        b.put_app_message(app_msg("Alpha", *h, i as u32));
    }
    b.put_app_message(app_msg("beta", 150, 10));
    b.put_pending(pending(1, 1_000))
        .put_pending(pending(2, 5_000));
    store.commit(b).unwrap();

    let names: Vec<String> = store.apps().unwrap().into_iter().map(|a| a.name).collect();
    assert_eq!(names, vec!["alpha", "beta"]);
    let heights: Vec<u32> = store
        .app_messages_for_app("ALPHA")
        .unwrap()
        .iter()
        .map(|m| m.height)
        .collect();
    assert_eq!(heights, vec![100, 200, 300]);
    assert_eq!(
        store.app_message(&hash(10, 0xAA)).unwrap().unwrap().height,
        150
    );

    // Re-storing a message at another height moves its index row.
    let mut b = WriteBatch::new();
    b.put_app_message(app_msg("Alpha", 400, 1))
        .delete_app("BETA");
    store.commit(b).unwrap();
    let heights: Vec<u32> = store
        .app_messages_for_app("alpha")
        .unwrap()
        .iter()
        .map(|m| m.height)
        .collect();
    assert_eq!(heights, vec![200, 300, 400]);
    assert_eq!(store.app("beta").unwrap(), None);
    assert_eq!(store.app_messages_for_app("beta").unwrap().len(), 1);

    assert_eq!(store.pending_app_messages().unwrap().len(), 2);
    assert_eq!(store.prune_pending(1_000).unwrap(), 1);
    let left = store.pending_app_messages().unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].hash, hash(2, 0xCC));
    let mut b = WriteBatch::new();
    b.delete_pending(hash(2, 0xCC));
    store.commit(b).unwrap();
    assert!(store.pending_app_messages().unwrap().is_empty());
}

#[test]
fn mesh_edges_and_changes() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let edge = MeshEdgeRecord {
        flags: 1,
        first_seen_ms: 10,
        last_seen_ms: 20,
    };
    let mut b = WriteBatch::new();
    b.put_mesh_edge(NodeId(9), NodeId(2), edge)
        .put_mesh_edge(NodeId(1), NodeId(3), edge)
        .push_mesh_change(MeshChangeRecord {
            ts_ms: 20,
            reporter: MeshReporter::Endpoint("1.2.3.4:16127".parse().unwrap()),
            added: vec![(NodeId(2), NodeId(9))],
            removed: vec![],
        })
        .push_mesh_change(MeshChangeRecord {
            ts_ms: 10,
            reporter: MeshReporter::Node(NodeId(1)),
            added: vec![(NodeId(1), NodeId(3))],
            removed: vec![(NodeId(4), NodeId(5))],
        });
    store.commit(b).unwrap();
    let edges = store.mesh_edges().unwrap();
    assert_eq!(
        edges,
        vec![(NodeId(1), NodeId(3), edge), (NodeId(2), NodeId(9), edge)]
    );
    let mut b = WriteBatch::new();
    b.delete_mesh_edge(NodeId(3), NodeId(1));
    store.commit(b).unwrap();
    assert_eq!(store.mesh_edges().unwrap().len(), 1);
    let changes = store.mesh_changes(.., Order::Asc, 10).unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0].1.reporter, MeshReporter::Node(NodeId(1)));
    let desc = store.mesh_changes(.., Order::Desc, 1).unwrap();
    assert_eq!(desc[0].0.ts_ms, 20);
}

#[test]
fn metrics_rollup_and_prune() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let base = 1_000 * HOUR_MS;
    let mut b = WriteBatch::new();
    // Three hours of minute rows (the third is incomplete relative to `now`), with an odd
    // offset inside each minute to check key flooring.
    for m in 0..150u64 {
        b.put_metrics_1m(metrics(base + m * MINUTE_MS + 7, 1_000 + m as u32, 2));
    }
    store.commit(b).unwrap();

    let rows = store
        .metrics_range(base, base + 10 * MINUTE_MS, Resolution::Minute)
        .unwrap();
    assert_eq!(rows.len(), 11);
    assert!(rows.windows(2).all(|w| w[0].ts_ms < w[1].ts_ms));

    let now = base + 2 * HOUR_MS + 30 * MINUTE_MS;
    assert_eq!(store.rollup_metrics_1h(now).unwrap(), 2);
    assert_eq!(store.rollup_metrics_1h(now).unwrap(), 0, "idempotent");
    let hours = store.metrics_range(0, u64::MAX, Resolution::Hour).unwrap();
    assert_eq!(hours.len(), 2);
    assert_eq!(hours[0].ts_ms, base);
    assert_eq!(
        hours[0].node_count,
        Some(1_059),
        "gauge = last minute of the hour"
    );
    assert_eq!(hours[0].block_count, Some(120), "counter = sum");
    assert_eq!(hours[0].price_usd, None, "unknown stays unknown");
    assert_eq!(hours[0].samples, 60);
    assert_eq!(hours[1].ts_ms, base + HOUR_MS);

    // Later, the third hour completes.
    assert_eq!(store.rollup_metrics_1h(now + HOUR_MS).unwrap(), 1);
    assert_eq!(
        store
            .metrics_range(0, u64::MAX, Resolution::Hour)
            .unwrap()
            .len(),
        3
    );

    assert_eq!(store.prune_metrics_1m(base + HOUR_MS).unwrap(), 60);
    let left = store
        .metrics_range(0, u64::MAX, Resolution::Minute)
        .unwrap();
    assert_eq!(left.len(), 90);
    assert!(
        store
            .metrics_range(base + 5, base, Resolution::Minute)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn snapshots_roundtrip_and_thinning() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let big: Vec<NodeRecord> = (0..2_000).map(node).collect();
    let mut b = WriteBatch::new();
    b.put_snapshot(1_000, &big).unwrap();
    store.commit(b).unwrap();
    let (ts, back): (u64, Vec<NodeRecord>) = store.latest_snapshot().unwrap().unwrap();
    assert_eq!(ts, 1_000);
    assert_eq!(back, big);

    // Hourly snapshots over 40 days.
    let now = 40 * DAY_MS;
    let mut b = WriteBatch::new();
    for h in 0..(40 * 24) {
        b.put_snapshot(h * HOUR_MS, &h).unwrap();
    }
    store.commit(b).unwrap();
    let (ts, v): (u64, u64) = store
        .snapshot_at_or_before(5 * HOUR_MS + 1)
        .unwrap()
        .unwrap();
    assert_eq!((ts, v), (5 * HOUR_MS, 5));
    assert!(store.snapshot_at_or_before::<u64>(0).unwrap().is_some());

    // The 1_000 ms snapshot shares day 0 with the hourly ones; the first of day 0 is ts 0.
    let removed = store.thin_snapshots(now, 30 * DAY_MS).unwrap();
    assert_eq!(removed, 10 * 23 + 1);
    let times = store.snapshot_times().unwrap();
    assert_eq!(times.len(), 10 + 30 * 24);
    assert_eq!(&times[..3], &[0, DAY_MS, 2 * DAY_MS]);
    assert_eq!(store.thin_snapshots(now, 30 * DAY_MS).unwrap(), 0);
    let (latest, v): (u64, u64) = store.latest_snapshot().unwrap().unwrap();
    assert_eq!(latest, (40 * 24 - 1) * HOUR_MS);
    assert_eq!(v, 40 * 24 - 1);
}

#[test]
fn geo_cache_ttl() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let v4 = IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4));
    let v6 = IpAddr::V6(Ipv6Addr::LOCALHOST);
    let geo = Geo {
        lat: 50.1,
        lon: 8.6,
        country_code: "DE".into(),
        asn: Some(24_940),
        ..Geo::default()
    };
    let mut b = WriteBatch::new();
    b.put_geo(v4, geo.clone(), 100)
        .put_geo(v6, geo.clone(), 900);
    store.commit(b).unwrap();
    assert_eq!(store.geo(v4).unwrap(), Some((geo.clone(), 100)));
    assert_eq!(store.prune_geo(500).unwrap(), 1);
    assert_eq!(store.geo(v4).unwrap(), None);
    assert_eq!(store.geo(v6).unwrap().unwrap().1, 900);

    let report = store
        .run_retention(1_000 + 7 * DAY_MS, &RetentionPolicy::default())
        .unwrap();
    assert_eq!(report.geo_pruned, 1);
}

#[test]
fn durability_policy() {
    let (_dir, path) = tmp();
    let store = Store::open_with(
        &path,
        StoreOptions {
            durable_interval: Duration::from_secs(3_600),
            cache_size_bytes: Some(16 << 20),
        },
    )
    .unwrap();
    let one = |id| {
        let mut b = WriteBatch::new();
        b.put_node(node(id));
        b
    };
    let s1 = store.commit(one(1)).unwrap();
    assert!(s1.durable, "first commit is immediate");
    assert_eq!(s1.ops, 1);
    assert!(!store.commit(one(2)).unwrap().durable);
    assert!(store.commit_durable(one(3)).unwrap().durable);
    assert!(!store.commit(one(4)).unwrap().durable);
    // Non-durable commits are visible to readers at once.
    assert!(store.node(NodeId(4)).unwrap().is_some());

    let (_dir2, path2) = tmp();
    let eager = Store::open_with(
        &path2,
        StoreOptions {
            durable_interval: Duration::ZERO,
            cache_size_bytes: None,
        },
    )
    .unwrap();
    assert!(eager.commit(one(1)).unwrap().durable);
    assert!(eager.commit(one(2)).unwrap().durable);
}

#[test]
fn stored_version_mismatch_is_reported() {
    let (_dir, path) = tmp();
    {
        let store = Store::open(&path).unwrap();
        let mut b = WriteBatch::new();
        b.put_node(node(1));
        store.commit_durable(b).unwrap();
    }
    {
        let db = redb::Database::create(&path).unwrap();
        let txn = db.begin_write().unwrap();
        {
            let def: redb::TableDefinition<'_, u32, &[u8]> =
                redb::TableDefinition::new("node_state");
            let mut t = txn.open_table(def).unwrap();
            t.insert(2, [42u8, 0, 0].as_slice()).unwrap();
        }
        txn.commit().unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert!(store.node(NodeId(1)).unwrap().is_some());
    match store.node(NodeId(2)) {
        Err(StoreError::VersionMismatch {
            what,
            expected,
            found,
        }) => {
            assert_eq!(what, "NodeRecord");
            assert_eq!(expected, 1);
            assert_eq!(found, 42);
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn newer_schema_is_refused() {
    let (_dir, path) = tmp();
    drop(Store::open(&path).unwrap());
    {
        let db = redb::Database::create(&path).unwrap();
        let txn = db.begin_write().unwrap();
        {
            let def: redb::TableDefinition<'_, &str, &[u8]> = redb::TableDefinition::new("meta");
            let mut t = txn.open_table(def).unwrap();
            t.insert(meta_keys::SCHEMA_VERSION, 99u64.to_be_bytes().as_slice())
                .unwrap();
        }
        txn.commit().unwrap();
    }
    assert!(matches!(
        Store::open(&path),
        Err(StoreError::SchemaTooNew { found: 99, .. })
    ));
}

#[test]
fn concurrent_readers_and_compaction() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let writer = store.clone();
    let handle = std::thread::spawn(move || {
        for chunk in 0..20u32 {
            let mut b = WriteBatch::new();
            for i in 0..100 {
                let id = chunk * 100 + i;
                b.intern_node(outpoint(id), NodeId(id)).put_node(node(id));
            }
            writer.commit(b).unwrap();
        }
    });
    let mut last = 0;
    while !handle.is_finished() {
        let n = store.nodes().unwrap().len();
        assert!(
            n >= last && n.is_multiple_of(100),
            "readers see whole commits only"
        );
        last = n;
    }
    handle.join().unwrap();
    assert_eq!(store.nodes().unwrap().len(), 2_000);

    let mut b = WriteBatch::new();
    for id in 0..2_000 {
        b.delete_node(NodeId(id));
    }
    store.commit(b).unwrap();
    store.compact().unwrap();
    assert!(store.nodes().unwrap().is_empty());
    assert_eq!(store.next_node_id().unwrap(), NodeId(2_000));
}

#[test]
fn large_app_message_batch() {
    const N: u32 = 70_000;
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::with_capacity(N as usize);
    for i in 0..N {
        b.put_app_message(app_msg(&format!("App{}", i % 3_000), 1_000_000 + i, i));
    }
    let started = Instant::now();
    let stats = store.commit_durable(b).unwrap();
    let elapsed = started.elapsed();
    eprintln!("committed {N} app messages in {elapsed:?}");
    assert_eq!(stats.ops, N as usize);
    // Generous bound for unoptimized test builds on slow CI machines.
    assert!(elapsed < Duration::from_secs(60), "took {elapsed:?}");
    let msgs = store.app_messages_for_app("app7").unwrap();
    assert_eq!(msgs.len(), (N / 3_000 + 1) as usize);
    assert!(msgs.windows(2).all(|w| w[0].height < w[1].height));
    let counts = store.table_counts().unwrap();
    let get = |name: &str| counts.iter().find(|(n, _)| *n == name).unwrap().1;
    assert_eq!(get("app_messages"), u64::from(N));
    assert_eq!(get("app_messages_by_app"), u64::from(N));
}

#[test]
fn prune_events_drops_old_rows_and_keeps_app_timeline() {
    let (_dir, path) = tmp();
    let store = Store::open(&path).unwrap();
    let mut b = WriteBatch::new();
    b.intern_node(outpoint(0), NodeId(0));
    b.intern_node(outpoint(1), NodeId(1));
    for (i, ts) in [100u64, 200, 300, 400].iter().enumerate() {
        b.push_event(env(
            i as u64 + 1,
            *ts,
            Event::NodeAtRisk {
                node: NodeId((i % 2) as u32),
                blocks_since_confirm: i as u32,
            },
        ));
    }
    b.push_event(env(9, 150, Event::AppExpired { app: "Demo".into() }));
    store.commit(b).unwrap();

    let (ev, node_ev, mesh_ev) = store.prune_events(300, 250, 0).unwrap();
    assert_eq!((ev, node_ev, mesh_ev), (3, 2, 0));
    let left: Vec<u64> = store
        .events(.., Order::Asc, 100)
        .unwrap()
        .iter()
        .map(|(k, _)| k.ts_ms)
        .collect();
    assert_eq!(left, vec![300, 400]);
    assert_eq!(
        store
            .node_events(NodeId(0), .., Order::Asc, 10)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store
            .node_events(NodeId(1), .., Order::Asc, 10)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store.app_events("Demo", .., Order::Asc, 10).unwrap().len(),
        1
    );
    // Zero cutoffs leave everything alone.
    assert_eq!(store.prune_events(0, 0, 0).unwrap(), (0, 0, 0));
}

//! Disk budget: retention tiers, the oldest-first guard and the size report on a real store.
#![allow(clippy::unwrap_used)]

use atlas_core::Amount;
use atlas_core::app::{AppMessageRecord, AppSpec};
use atlas_core::chain::{BlockKind, BlockSummary, NodeTx, NodeTxKind, Payout};
use atlas_core::event::{AppMessageKind, Event, EventEnvelope};
use atlas_core::ids::{Hash32, NodeId, Outpoint};
use atlas_core::node::Tier;
use atlas_store::{
    DAY_MS, DiskBudget, HistoryRetention, Store, StoreOptions, WriteBatch, db_stats_at,
};

/// Blocks per simulated day (keeps the test fast; heights still advance 2,880 per day so the
/// height and time estimates of the store line up).
const BLOCKS_PER_DAY: u32 = 2_880;
const SAMPLE: u32 = 48;
const DAYS: u32 = 40;
/// Height of the first simulated block (well after Proof of Node).
const H0: u32 = 2_900_000;
const T0: u64 = 1_780_000_000_000;

fn hash(n: u32, salt: u8) -> Hash32 {
    let mut h = [salt; 32];
    h[..4].copy_from_slice(&n.to_be_bytes());
    Hash32(h)
}

fn outpoint(n: u32) -> Outpoint {
    Outpoint::new(hash(n, 0x11), 0)
}

fn height_of(day: u32, i: u32) -> u32 {
    H0 + day * BLOCKS_PER_DAY + i * (BLOCKS_PER_DAY / SAMPLE)
}

fn time_of(height: u32) -> u64 {
    T0 + u64::from(height - H0) * 30_000
}

fn block(height: u32) -> BlockSummary {
    BlockSummary {
        height,
        hash: hash(height, 0xB0),
        prev_hash: hash(height - 1, 0xB0),
        time_ms: time_of(height),
        size: 3_000,
        tx_count: 16,
        kind: BlockKind::Pon,
        version: 100,
        producer_collateral: None,
        producer: Some(NodeId(1)),
        payouts: [Tier::Cumulus, Tier::Nimbus, Tier::Stratus]
            .iter()
            .enumerate()
            .map(|(k, tier)| Payout {
                tier: *tier,
                address: "t1payee".into(),
                amount: Amount::from_flux(1),
                node: Some(NodeId(height % 50 + k as u32)),
            })
            .collect(),
        dev_fund: Amount(50_000_000),
        fees: Amount::ZERO,
        reward: Amount::from_flux(14),
        value_out: Amount::ZERO,
        confirm_count: 2,
        start_count: 0,
        transfer_count: 0,
    }
}

fn node_tx(height: u32, node: u32) -> NodeTx {
    NodeTx {
        txid: hash(height * 4 + node, 0x77),
        height: Some(height),
        kind: NodeTxKind::UpdateConfirm,
        collateral: outpoint(node),
        endpoint: None,
        benchmark_tier: Some(Tier::Cumulus),
        sig_time: 1,
        tx_version: 5,
        upgraded_version: None,
        p2sh: false,
        node: Some(NodeId(node)),
    }
}

fn app_msg(height: u32, n: u32) -> AppMessageRecord {
    AppMessageRecord {
        hash: hash(n, 0xAA),
        txid: Some(hash(n, 0xBB)),
        height,
        timestamp_ms: time_of(height),
        kind: AppMessageKind::Update,
        paid: Amount::from_flux(1),
        spec: AppSpec {
            spec_version: 8,
            name: format!("app{}", n % 7),
            description: "x".repeat(200),
            owner: "1owner".into(),
            instances: 3,
            ..AppSpec::default()
        },
    }
}

/// A store with `DAYS` days of history in every budgeted table.
fn filled() -> (tempfile::TempDir, Store, u64) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open_with(
        dir.path().join("atlas.redb"),
        StoreOptions {
            durable_interval: std::time::Duration::ZERO,
            cache_size_bytes: Some(4 << 20),
        },
    )
    .unwrap();
    let mut b = WriteBatch::new();
    for n in 0..60 {
        b.intern_node(outpoint(n), NodeId(n));
    }
    store.commit(b).unwrap();
    let mut seq = 0;
    let mut msg = 0;
    for day in 0..DAYS {
        let mut b = WriteBatch::new();
        for i in 0..SAMPLE {
            let h = height_of(day, i);
            b.put_block(block(h));
            for k in 0..4 {
                b.put_node_tx(h, k as u16, node_tx(h, (h + k) % 60));
            }
            seq += 1;
            b.push_event(EventEnvelope {
                seq,
                observed_ms: time_of(h),
                event_ms: None,
                event: Event::NodeRecovered {
                    node: NodeId(h % 60),
                },
            });
        }
        let t = time_of(height_of(day, 0));
        b.put_snapshot(t, &vec![day; 2_000]).unwrap();
        msg += 1;
        b.put_app_message(app_msg(height_of(day, 1), msg));
        store.commit(b).unwrap();
    }
    let now = time_of(height_of(DAYS, 0));
    (dir, store, now)
}

fn rows(store: &Store, table: &str) -> u64 {
    store
        .table_rows()
        .unwrap()
        .into_iter()
        .find(|(n, _)| n == table)
        .map_or(0, |(_, r)| r)
}

#[test]
fn retention_tiers_cut_each_table_at_its_age() {
    let (_dir, store, now) = filled();
    let before_blocks = rows(&store, "blocks");
    let tiers = HistoryRetention {
        blocks_ms: Some(30 * DAY_MS),
        payments_ms: Some(35 * DAY_MS),
        node_txs_ms: Some(10 * DAY_MS),
        keyframes_ms: Some(20 * DAY_MS),
        app_messages_ms: None,
        app_events_ms: None,
        chain_blocks_ms: None,
    };
    let removed = store.prune_history(now, &tiers).unwrap();
    let got = |t: &str| removed.iter().find(|r| r.0 == t).map_or(0, |r| r.1);
    // 40 days stored: blocks keep 30, payments 35, node txs 10, keyframes 20.
    assert_eq!(got("blocks"), u64::from(10 * SAMPLE));
    assert_eq!(got("block_hash"), u64::from(10 * SAMPLE));
    assert_eq!(got("block_payouts"), u64::from(10 * SAMPLE * 3));
    assert_eq!(got("payments"), u64::from(5 * SAMPLE * 3));
    assert_eq!(got("node_txs"), u64::from(30 * SAMPLE * 4));
    assert_eq!(got("node_txs_by_node"), u64::from(30 * SAMPLE * 4));
    assert_eq!(got("snapshots"), 20);
    assert_eq!(got("app_messages"), 0);
    assert_eq!(
        rows(&store, "blocks"),
        before_blocks - u64::from(10 * SAMPLE)
    );
    assert_eq!(rows(&store, "app_messages"), u64::from(DAYS));
    // The surviving rows are the newest ones and the indexes stay consistent.
    let oldest_block = store.blocks_range(0, u32::MAX).unwrap()[0].height;
    assert_eq!(oldest_block, height_of(10, 0));
    assert!(
        store
            .block_by_hash(&hash(height_of(9, 0), 0xB0))
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .block_by_hash(&hash(oldest_block, 0xB0))
            .unwrap()
            .is_some()
    );
    let txs = store
        .node_txs_for_node(NodeId(5), None, usize::MAX)
        .unwrap();
    assert!(txs.iter().all(|t| t.height.unwrap() >= height_of(30, 0)));
    // Idempotent.
    assert!(store.prune_history(now, &tiers).unwrap().is_empty());
}

#[test]
fn guard_prunes_oldest_first_and_keeps_the_minimum_history() {
    let (dir, store, now) = filled();
    let stats = store.db_stats().unwrap();
    assert!(stats.tables_bytes() > 0);
    assert!(stats.table("node_txs").unwrap().rows > 0);

    // A budget the data comfortably fits in: nothing happens.
    let roomy = DiskBudget::from_mb(10_000);
    let r = store.enforce_budget(now, &roomy).unwrap();
    assert_eq!(r.action, "ok");
    assert_eq!(rows(&store, "blocks"), u64::from(DAYS * SAMPLE));

    // A budget below the data: the guard prunes whole days, oldest first, until the estimated
    // live data is under the low-water mark (or only the 7-day minimum is left).
    let live_before = stats.tables_bytes();
    let tight = DiskBudget::from_mb(1);
    let r = store.enforce_budget(now, &tight).unwrap();
    assert_eq!(r.action, "pruned");
    let p = r.pruned.as_ref().unwrap();
    assert!(p.steps >= 1, "{p:?}");
    assert!(r.compacted);
    assert!(r.used_after < r.used_before, "{r:?}");
    let live_after = store.db_stats().unwrap().tables_bytes();
    assert!(live_after < live_before);
    assert!(
        p.hit_min_history || p.freed_estimate >= live_before - tight.low_bytes(),
        "{p:?}"
    );
    // The survivors are the newest days, never fewer than seven.
    let floor = p.floor_ms.unwrap();
    let blocks = store.blocks_range(0, u32::MAX).unwrap();
    assert!(blocks.len() >= (7 * SAMPLE) as usize);
    assert!(blocks.len() < (DAYS * SAMPLE) as usize);
    assert!(blocks.iter().all(|b| b.time_ms + 30_000 >= floor));
    assert_eq!(
        blocks.last().unwrap().height,
        height_of(DAYS - 1, SAMPLE - 1)
    );
    assert!(rows(&store, "snapshots") >= 7 && rows(&store, "snapshots") < u64::from(DAYS));
    assert!(rows(&store, "events") >= u64::from(7 * SAMPLE));
    // Current state is untouched.
    assert_eq!(rows(&store, "node_ids"), 60);

    // A budget below even the minimum history stops at seven days.
    let floor_budget = DiskBudget {
        budget_bytes: 16 << 10,
        ..DiskBudget::from_mb(1)
    };
    let r = store.enforce_budget(now, &floor_budget).unwrap();
    let p = r.pruned.unwrap();
    assert!(p.hit_min_history, "{p:?}");
    let blocks = store.blocks_range(0, u32::MAX).unwrap();
    assert_eq!(blocks.len(), (7 * SAMPLE) as usize);
    assert!(blocks.iter().all(|b| b.time_ms >= now - 7 * DAY_MS));
    assert_eq!(rows(&store, "snapshots"), 7);
    assert_eq!(rows(&store, "app_messages"), 7);

    drop(store);
    let report = db_stats_at(&dir.path().join("atlas.redb")).unwrap();
    assert!(report.render().contains("node_txs"));
}

#[test]
fn guard_measures_before_pruning_a_slack_file() {
    let (_dir, store, now) = filled();
    // Delete most history by age, leaving a file full of free pages.
    store
        .prune_history(
            now,
            &HistoryRetention {
                blocks_ms: Some(DAY_MS),
                payments_ms: Some(DAY_MS),
                node_txs_ms: Some(DAY_MS),
                keyframes_ms: Some(DAY_MS),
                app_messages_ms: None,
                app_events_ms: None,
                chain_blocks_ms: None,
            },
        )
        .unwrap();
    let used = store.file_usage().unwrap().used_bytes();
    let live = store.db_stats().unwrap().tables_bytes();
    assert!(live < used);
    // A budget whose high-water mark is the file size: the file is over it, but the live data
    // is under the low-water mark, so the guard compacts instead of pruning.
    let b = DiskBudget {
        budget_bytes: (used as f64 / 0.9).ceil() as u64,
        ..DiskBudget::default()
    };
    assert!(used >= b.high_bytes());
    assert!(live <= b.low_bytes(), "live {live} used {used}");
    let r = store.enforce_budget(now, &b).unwrap();
    assert_eq!(r.action, "compacted", "{r:?}");
    assert!(r.pruned.is_none());
    assert!(r.used_after < used);
    assert_eq!(rows(&store, "blocks"), u64::from(SAMPLE));
}

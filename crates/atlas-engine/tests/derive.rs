//! Fixture-driven derivation tests (no network): block events, queue model, reconcile diff,
//! stats-round placeholders, app placement, mesh.
#![allow(clippy::unwrap_used, clippy::too_many_lines)]

mod common;

use std::collections::BTreeSet;

use atlas_core::app::{AppInstance, PendingAppMessage};
use atlas_core::event::{AppMessageKind, Event};
use atlas_core::live::{DeltaCause, LiveBody};
use atlas_core::node::Geo;
use atlas_core::{Amount, Hash32, NodeEndpoint, NodeId, NodeStatus, Outpoint, Tier};
use atlas_engine::derive::block::{Attribution, apply_block};
use atlas_engine::derive::reconcile::reconcile;
use atlas_engine::derive::round::{RoundNode, apply_round};
use atlas_engine::state::mesh::{Mesh, Report};
use atlas_engine::state::queue::rank_inversions;
use atlas_engine::state::{NetworkState, Tick, mask, rank_corrections};
use atlas_flux::decode::{AppPayment, SpentOutpoint};

const NOW: u64 = 1_790_800_000_000;

fn id_of(st: &NetworkState, txid_prefix: &str, vout: u32) -> NodeId {
    st.nodes
        .iter()
        .find(|e| {
            e.rec.outpoint.txid.to_hex().starts_with(txid_prefix) && e.rec.outpoint.vout == vout
        })
        .map_or_else(|| panic!("no node {txid_prefix}:{vout}"), |e| e.rec.id)
}

fn block_msg(tick: &Tick) -> &atlas_core::live::BlockMsg {
    let blocks: Vec<_> = tick
        .primary
        .iter()
        .filter_map(|(b, _)| match b {
            LiveBody::Block(m) => Some(m),
            _ => None,
        })
        .collect();
    assert_eq!(blocks.len(), 1, "exactly one block message per block");
    blocks[0]
}

#[test]
fn start_tx_creates_a_started_node() {
    let mut st = common::seeded();
    st.expiry_armed = false;
    let d = common::block("flux/daemon_getblock_2996861_verbosity2_fluxnode_start.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    assert_eq!(tick.count("node_started"), 1);
    let started = id_of(&st, "5c760d8d8384", 0);
    let r = st.nodes.rec(started).unwrap();
    assert_eq!(r.status, NodeStatus::Started);
    assert_eq!(r.added_height, 2_996_861);
    let msg = block_msg(&tick);
    assert_eq!(msg.starts.len(), 1);
    assert_eq!(msg.starts[0].id, started);
    assert_eq!(msg.heartbeats.len(), 16);
    assert!(
        tick.node_delta(DeltaCause::Block)
            .unwrap()
            .added
            .contains(&started)
    );
    // The start is not in the payment queue.
    assert!(!st.queue.tier(Tier::Cumulus).unwrap().contains(started));
    assert_eq!(tick.count("block_added"), 1);
    assert_eq!(tick.count("next_payees"), 1);
}

#[test]
fn initial_confirm_and_heartbeats() {
    let mut st = common::seeded();
    let d = common::block("flux/daemon_getblock_2996886_verbosity2_fluxnode_initial_confirm.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    assert_eq!(tick.count("node_confirmed"), 1);
    assert_eq!(tick.count("node_heartbeat"), 12);
    let joined = id_of(&st, "7d5f19bb2543", 0);
    let r = st.nodes.rec(joined).unwrap();
    assert_eq!(r.status, NodeStatus::Confirmed);
    assert_eq!(r.confirmed_height, Some(2_996_886));
    assert_eq!(r.last_confirmed_height, Some(2_996_886));
    assert_eq!(r.tier, Tier::Stratus, "tier from benchmark_tier");
    assert_eq!(r.endpoint, Some("185.248.24.211:16127".parse().unwrap()));
    // Newly confirmed nodes join the back of their tier queue.
    let q = st.queue.tier(Tier::Stratus).unwrap();
    assert!(q.contains(joined));
    assert_eq!(q.iter().last(), Some(joined));
    let msg = block_msg(&tick);
    assert_eq!(msg.confirms, vec![joined]);
    assert_eq!(msg.heartbeats.len(), 12);
    // Every heartbeat node carries its new last confirmed height.
    for h in &msg.heartbeats {
        assert_eq!(
            st.nodes.rec(*h).unwrap().last_confirmed_height,
            Some(2_996_886)
        );
    }
    // Feed: one join.
    assert_eq!(tick.feed.len(), 1);
}

#[test]
fn heartbeat_with_new_ip_is_an_ip_change() {
    let mut st = common::seeded();
    let nimbus = id_of(&st, "fdd46cee8626", 0);
    let old: NodeEndpoint = "1.2.3.4:16127".parse().unwrap();
    st.nodes.set_endpoint(nimbus, Some(old));
    let d = common::block("explorer/fluxos_daemon_getblock_2996914_verbose.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    let ev = tick
        .events
        .iter()
        .find_map(|(e, _)| match e {
            Event::NodeIpChanged { node, old, new, .. } if *node == nimbus => Some((*old, *new)),
            _ => None,
        })
        .expect("ip change event");
    assert_eq!(ev.0, Some(old));
    assert_eq!(ev.1, Some("91.192.45.99:16147".parse().unwrap()));
    assert!(block_msg(&tick).updates.contains(&nimbus));
    assert_eq!(
        st.nodes.by_endpoint(&"91.192.45.99:16147".parse().unwrap()),
        Some(nimbus)
    );
    assert_eq!(st.nodes.by_endpoint(&old), None);
}

#[test]
fn payouts_hit_queue_heads_and_move_them_to_the_back() {
    let mut st = common::seeded();
    let records: Vec<_> = st.nodes.listed().map(|e| e.rec.clone()).collect();
    assert_eq!(
        rank_inversions(records.iter()),
        0,
        "fixture queue has no inversions"
    );
    // The model's order equals the upstream ranks.
    for tier in Tier::ALL {
        let model: Vec<u32> = st
            .queue
            .tier(tier)
            .unwrap()
            .iter()
            .map(|id| st.nodes.rec(id).unwrap().rank.unwrap())
            .collect();
        let mut sorted = model.clone();
        sorted.sort_unstable();
        assert_eq!(model, sorted, "{tier} order");
    }
    let heads: Vec<NodeId> = Tier::ALL
        .iter()
        .map(|t| st.queue.head(*t).unwrap())
        .collect();
    let cumulus_len = st.queue.tier(Tier::Cumulus).unwrap().len() as u32;
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    let mut tick = Tick::new(NOW);
    let rep = apply_block(&mut st, &mut tick, &d, false);
    assert_eq!(rep.attributions, vec![Attribution::QueueHead; 3]);
    let msg = block_msg(&tick);
    assert_eq!(msg.payouts.len(), 3);
    for (p, head) in msg.payouts.iter().zip(&heads) {
        assert_eq!(p.node, Some(*head));
        let r = st.nodes.rec(*head).unwrap();
        assert_eq!(r.last_paid_height, Some(2_996_916));
    }
    // Paid Cumulus head moved to the back (behind nodes first seen confirming in this block);
    // the old rank 1 is next.
    let paid = heads[0];
    let q = st.queue.tier(Tier::Cumulus).unwrap();
    assert!(
        q.len() as u32 > cumulus_len,
        "unknown heartbeat nodes joined the queue"
    );
    assert_eq!(q.iter().last(), Some(paid));
    assert_eq!(st.nodes.rec(paid).unwrap().rank, Some(q.len() as u32 - 1));
    let next = st.queue.head(Tier::Cumulus).unwrap();
    assert_eq!(st.nodes.rec(next).unwrap().rank, Some(0));
    assert!(
        st.nodes
            .rec(next)
            .unwrap()
            .outpoint
            .txid
            .to_hex()
            .starts_with("809144452d70")
    );
    assert_eq!(tick.count("node_paid"), 3);
    // Next payees follow the new heads.
    assert_eq!(st.next_payees[0].node, Some(next));
    // Fees and dev fund.
    assert_eq!(msg.dev_fund, d.summary.dev_fund);
    assert_eq!(msg.reward, Amount::from_flux(14));
}

#[test]
fn rank_contract_rotation_and_corrections() {
    let mut st = common::seeded();
    st.client_ranks.reset(&st.queue);
    let heads: Vec<NodeId> = Tier::ALL
        .iter()
        .map(|t| st.queue.head(*t).unwrap())
        .collect();
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    let deltas = tick.take_node_deltas();
    // No per-block rank stream: payees carry no rank; clients rotate them from the payouts.
    for (_, b) in &deltas {
        for h in &heads {
            assert_eq!(b.changed.get(h).copied().unwrap_or(0) & mask::RANK, 0);
        }
    }
    let fixes = rank_corrections(&mut st, &deltas);
    println!("corrections after block: {}", fixes.len());
    // Rotation plus ranked additions explain the block: no corrections needed.
    assert!(fixes.is_empty(), "unexpected corrections {fixes:?}");
    // A divergence (a node the model moved without telling clients) is corrected with
    // authoritative ranks for exactly the nodes that differ.
    let q = st.queue.tier(Tier::Stratus).unwrap();
    let ids: Vec<NodeId> = q.iter().take(3).collect();
    let r = st.nodes.rec(ids[0]).unwrap().clone();
    st.queue
        .upsert(ids[0], Tier::Stratus, (u32::MAX, 0, [0; 32], 0));
    let fixes = rank_corrections(&mut st, &[]);
    assert!(fixes.contains(&ids[0]) && fixes.contains(&ids[1]) && fixes.contains(&ids[2]));
    assert_eq!(st.nodes.rec(ids[1]).unwrap().rank, Some(0));
    assert_eq!(st.nodes.rec(ids[0]).unwrap().tier, r.tier);
    // The model is exact again afterwards.
    assert!(rank_corrections(&mut st, &[]).is_empty());

    // A node the queue drops while it stays confirmed (no status exit to tell clients): the
    // correction carries the explicit unranked signal, `rank: null`.
    let q = st.queue.tier(Tier::Nimbus).unwrap();
    let ids: Vec<NodeId> = q.iter().take(2).collect();
    st.queue.remove(ids[0]);
    let fixes = rank_corrections(&mut st, &[]);
    assert!(fixes.contains(&ids[0]), "dropped node is corrected");
    assert!(fixes.contains(&ids[1]), "the node behind it moves up");
    let rec = st.nodes.rec(ids[0]).unwrap();
    assert_eq!(rec.status, NodeStatus::Confirmed);
    assert_eq!(rec.rank, None);
    let change = atlas_engine::state::node_change(rec, mask::RANK, 3_000_000, NOW);
    assert_eq!(change.rank, Some(None));
    let json = serde_json::to_value(&change).unwrap();
    assert!(json["rank"].is_null() && json.as_object().unwrap().contains_key("rank"));
    assert!(rank_corrections(&mut st, &[]).is_empty());

    // Clients apply `rank: null` outside a reconcile as an exit, like a status exit: the server
    // model mirrors it, so no correction follows.
    let q = st.queue.tier(Tier::Cumulus).unwrap();
    let gone = q.iter().nth(5).unwrap();
    st.queue.remove(gone);
    let mut b = atlas_engine::state::NodesDeltaBuilder::default();
    b.changed.insert(gone, mask::RANK);
    let fixes = rank_corrections(&mut st, &[(DeltaCause::Block, b)]);
    assert!(fixes.is_empty(), "unexpected corrections {fixes:?}");
}

#[test]
fn shared_payment_address_pays_the_queue_head_not_a_lagging_winner() {
    let mut st = common::seeded();
    let q: Vec<NodeId> = st
        .queue
        .tier(Tier::Cumulus)
        .unwrap()
        .iter()
        .take(2)
        .collect();
    let (head, second) = (q[0], q[1]);
    // One operator: both nodes share the head's payment address.
    let addr = st.nodes.rec(head).unwrap().payment_address.clone();
    st.nodes.get_mut(second).unwrap().rec.payment_address = addr.clone();
    // A lagging currentwinner answer names the second node for this height.
    st.expected_payees.insert(
        2_996_916,
        vec![(Tier::Cumulus, Some(second), addr.to_string())],
    );
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    let mut tick = Tick::new(NOW);
    let rep = apply_block(&mut st, &mut tick, &d, false);
    assert_eq!(rep.attributions[0], Attribution::QueueHead);
    assert_eq!(
        st.nodes.rec(head).unwrap().last_paid_height,
        Some(2_996_916)
    );
    assert_ne!(
        st.nodes.rec(second).unwrap().last_paid_height,
        Some(2_996_916)
    );
    assert_eq!(st.queue.head(Tier::Cumulus), Some(second));
}

#[test]
fn producer_prefix_resolution() {
    let mut st = common::seeded();
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    // Header: COutPoint(4514d3d380, 0). Add a node with that collateral prefix.
    let txid = Hash32::from_hex(&format!("4514d3d380{}", "ab".repeat(27))).unwrap();
    let (id, _) = st.nodes.intern(Outpoint::new(txid, 0), NOW);
    st.nodes.set_status(id, NodeStatus::Confirmed, NOW);
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    assert_eq!(block_msg(&tick).producer.as_ref().map(|p| p.id), Some(id));

    // A second node with the same prefix makes it ambiguous: no producer.
    let mut st = common::seeded();
    for fill in ["ab", "cd"] {
        let txid = Hash32::from_hex(&format!("4514d3d380{}", fill.repeat(27))).unwrap();
        let (id, _) = st.nodes.intern(Outpoint::new(txid, 0), NOW);
        st.nodes.set_status(id, NodeStatus::Confirmed, NOW);
    }
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    assert!(block_msg(&tick).producer.is_none());
}

#[test]
fn app_payment_named_from_pending_and_collateral_spend() {
    let mut st = common::seeded();
    let mut d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    assert_eq!(d.app_payments.len(), 1, "fixture carries one app payment");
    let hash = d.app_payments[0].message_hash;
    let spec = common::synthetic_app(7).spec;
    st.apps.pending.insert(
        hash,
        PendingAppMessage {
            hash,
            kind: AppMessageKind::Update,
            timestamp_ms: NOW,
            received_ms: NOW,
            expires_ms: NOW + 3_600_000,
            arcane_sender: None,
            spec,
        },
    );
    // Add a synthetic extra payment and a collateral spend of a queued node.
    d.app_payments.push(AppPayment {
        txid: common::hash(1),
        message_hash: common::hash(2),
        value: Amount::from_flux(3),
    });
    let victim = id_of(&st, "21eb104962c5", 0);
    let victim_op = st.nodes.rec(victim).unwrap().outpoint;
    d.spent.push(SpentOutpoint {
        outpoint: victim_op,
        spent_by: common::hash(3),
    });
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    let msg = block_msg(&tick);
    assert_eq!(msg.app_payments.len(), 2);
    assert_eq!(msg.app_payments[0].app.as_deref(), Some("syntheticapp7"));
    assert_eq!(msg.app_payments[0].kind, Some(AppMessageKind::Update));
    assert_eq!(msg.app_payments[1].app, None);
    assert_eq!(msg.collateral_spent, vec![victim]);
    assert_eq!(st.nodes.rec(victim).unwrap().status, NodeStatus::Departed);
    assert!(!st.queue.tier(Tier::Cumulus).unwrap().contains(victim));
    assert_eq!(tick.count("node_collateral_spent"), 1);
    assert_eq!(tick.count("node_removed"), 1);
    assert!(
        tick.node_delta(DeltaCause::Block)
            .unwrap()
            .removed
            .contains(&victim)
    );

    // The chain feed then resolves the message: pending promoted, update applied.
    let mut rec = atlas_core::app::AppMessageRecord {
        hash,
        txid: Some(d.app_payments[0].txid),
        height: 2_996_916,
        timestamp_ms: NOW,
        kind: AppMessageKind::Update,
        paid: Amount::from_flux(1),
        spec: common::synthetic_app(7).spec,
    };
    rec.spec.instances = 9;
    st.apps
        .records
        .insert("syntheticapp7".into(), common::synthetic_app(7));
    let mut tick = Tick::new(NOW);
    assert!(atlas_engine::derive::apps::apply_app_message(
        &mut st, &mut tick, &rec
    ));
    assert_eq!(tick.count("app_pending_resolved"), 1);
    assert_eq!(tick.count("app_updated"), 1);
    assert!(st.apps.pending.is_empty());
    assert_eq!(st.apps.records["syntheticapp7"].spec.instances, 9);
    // Applying the same message twice is a no-op.
    let mut tick = Tick::new(NOW);
    assert!(!atlas_engine::derive::apps::apply_app_message(
        &mut st, &mut tick, &rec
    ));
}

#[test]
fn expiry_at_risk_and_dos_derivation() {
    let mut st = common::seeded();
    let node = id_of(&st, "4fc1db993815", 0); // last confirmed 2,996,465
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    // Move the block far enough: 2,996,465 + 560 = at risk, + 641 = expired (fluxd still lists
    // the node at + 640).
    let mut at_risk = d.clone();
    at_risk.summary.height = 2_996_465 + 565;
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &at_risk, false);
    assert!(
        tick.events
            .iter()
            .any(|(e, _)| matches!(e, Event::NodeAtRisk { node: n, .. } if *n == node))
    );
    let mut last_block = d.clone();
    last_block.summary.height = 2_996_465 + 640;
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &last_block, false);
    assert!(
        !tick
            .events
            .iter()
            .any(|(e, _)| matches!(e, Event::NodeExpired { node: n, .. } if *n == node))
    );
    assert_eq!(st.nodes.rec(node).unwrap().status, NodeStatus::Confirmed);
    let mut expired = d.clone();
    expired.summary.height = 2_996_465 + 641;
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &expired, false);
    assert!(
        tick.events.iter().any(
            |(e, _)| matches!(e, Event::NodeExpired { node: n, predicted: true } if *n == node)
        )
    );
    assert_eq!(st.nodes.rec(node).unwrap().status, NodeStatus::Expired);
    // A discontinuous block never predicts expiry.
    let mut st = common::seeded();
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &expired, true);
    assert_eq!(tick.count("node_expired"), 0);
}

/// A confirmed node with the given heights (real collateral `txid:0`).
fn put_confirmed(
    st: &mut NetworkState,
    txid: &str,
    tier: Tier,
    confirmed: u32,
    last_confirmed: u32,
    last_paid: Option<u32>,
) -> NodeId {
    let op = Outpoint::new(Hash32::from_hex(txid).unwrap(), 0);
    let (id, _) = st.nodes.intern(op, NOW);
    {
        let e = st.nodes.get_mut(id).unwrap();
        e.rec.tier = tier;
        e.rec.added_height = confirmed - 2;
        e.rec.confirmed_height = Some(confirmed);
        e.rec.last_confirmed_height = Some(last_confirmed);
        e.rec.last_paid_height = last_paid;
        e.rec.payment_address = format!("t1{}", &txid[..8]).into();
    }
    st.nodes.set_status(id, NodeStatus::Confirmed, NOW);
    let key = atlas_engine::state::queue::key_of(st.nodes.rec(id).unwrap());
    st.queue.upsert(id, tier, key);
    id
}

/// The deterministic list as fluxd would print it from the model (confirmed nodes only).
fn list_from_model(st: &NetworkState) -> Vec<atlas_flux::models::nodes::ListedNode> {
    st.nodes
        .listed()
        .filter(|e| e.rec.status == NodeStatus::Confirmed)
        .map(|e| atlas_flux::models::nodes::ListedNode {
            outpoint: e.rec.outpoint,
            endpoint: e.rec.endpoint,
            tier: e.rec.tier,
            status: NodeStatus::Confirmed,
            payment_address: e.rec.payment_address.clone(),
            pubkey: e.rec.pubkey.clone(),
            rank: e.rec.rank,
            added_height: e.rec.added_height,
            confirmed_height: e.rec.confirmed_height,
            last_confirmed_height: e.rec.last_confirmed_height,
            last_paid_height: e.rec.last_paid_height,
            active_since_ms: e.rec.active_since_ms,
            last_paid_ms: None,
            collateral_amount: None,
        })
        .collect()
}

/// A block at `height` with no transactions or payouts of its own.
fn empty_block(height: u32) -> atlas_flux::decode::DecodedBlock {
    let mut d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    d.summary.height = height;
    d.summary.payouts.clear();
    d.node_txs.clear();
    d.transfers.clear();
    d.app_payments.clear();
    d.spent.clear();
    d
}

#[test]
fn expiry_boundary_matches_fluxd_real_case() {
    // B5 soak, 3105, 2026-10-01 03:38:57Z: "reconcile found differences (bug signal)
    // list_height=2997871 diffs={"expiry_mispredicted": 1} rank_diffs=352". The node was
    // c6ec3309...:0 (Nimbus, last confirmed 2,997,231, last paid 2,997,529). The engine expired
    // it with the block 2,997,871 (= 2,997,231 + 640), the list at 2,997,871 still held it, and
    // the next block expired it again. fluxd drops a node at the first block H with
    // `last_confirmed < H - 640` (fluxnode.cpp GetUndoDataForExpiredConfirmFluxnodes), so the
    // block 2,997,872. Verified live as well: 7feb2f4f...:0 (last confirmed 2,997,359) was
    // listed at 2,997,999 and gone at 2,998,000.
    let mut st = NetworkState {
        expiry_armed: true,
        ..NetworkState::default()
    };
    let node = put_confirmed(
        &mut st,
        "c6ec3309423478b744c3db3a86e05a7d2263a5c577143707106035fea8f80757",
        Tier::Nimbus,
        2_936_250,
        2_997_231,
        Some(2_997_529),
    );
    // Neighbours queued around it, and one that confirmed in the list's last block (so the list
    // height is 2,997,871).
    put_confirmed(
        &mut st,
        "0ab0111a01e66656a46e20a27a94a0169169572a06add3ed8b562a9e10505eb6",
        Tier::Nimbus,
        2_936_751,
        2_997_814,
        Some(2_996_479),
    );
    put_confirmed(
        &mut st,
        "edc30fae3fb415a9fc3aeb1a31c56f7a7b783ce1ab0a2b69227533783e20d425",
        Tier::Nimbus,
        2_157_023,
        2_997_871,
        Some(2_997_692),
    );
    st.apply_ranks();
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &empty_block(2_997_871), false);
    assert_eq!(tick.count("node_expired"), 0);
    assert_eq!(st.nodes.rec(node).unwrap().status, NodeStatus::Confirmed);
    assert_eq!(st.nodes.rec(node).unwrap().rank, Some(1));

    // The list at 2,997,871 still holds it: the reconcile is clean.
    let list = list_from_model(&st);
    assert!(
        list.iter()
            .any(|n| n.outpoint == st.nodes.rec(node).unwrap().outpoint)
    );
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert_eq!(rep.list_height, 2_997_871);
    assert_eq!(rep.total_diffs(), 0, "{rep:?}");
    assert_eq!(rep.diffs.get("expiry_mispredicted"), None);

    // The block 2,997,872 drops it; the list at that height no longer has it.
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &empty_block(2_997_872), false);
    assert!(
        tick.events.iter().any(
            |(e, _)| matches!(e, Event::NodeExpired { node: n, predicted: true } if *n == node)
        )
    );
    assert_eq!(st.nodes.rec(node).unwrap().status, NodeStatus::Expired);
    let mut list = list_from_model(&st);
    // The list's height: a node confirmed in 2,997,872.
    list[0].last_confirmed_height = Some(2_997_872);
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert_eq!(rep.removed, 1);
    assert_eq!(rep.diffs.get("expiry_mispredicted"), None);
    assert_eq!(rep.diffs.get("last_confirmed_height"), Some(&1));
    assert_eq!(rep.rank_diffs, 0, "{rep:?}");
    assert_eq!(st.nodes.rec(node).unwrap().status, NodeStatus::Departed);
}

#[test]
fn queue_ties_follow_fluxd_outpoint_order() {
    // Live list, height 2,997,987: never-paid Cumulus nodes confirmed in the same block are
    // ranked by fluxd's COutPoint order (txid bytes reversed, then vout), not by the hex text.
    // 2,996,110: cca52c03...ed55 (rank 1406) before 3c858d2b...6fea (rank 1407).
    // 2,996,126: f593e4db...bc3b (rank 1424) before 09701dd2...82a4 (rank 1425).
    let mut st = NetworkState::default();
    let first_110 = put_confirmed(
        &mut st,
        "cca52c03b90da1fbb1b49a4ea97242441bf933f24b1bf88e44575f351419ed55",
        Tier::Cumulus,
        2_996_110,
        2_997_621,
        None,
    );
    let second_110 = put_confirmed(
        &mut st,
        "3c858d2b7c77ec2134ca5d4ca87b719850c68ab99d4b3309f793b29bd8ac6fea",
        Tier::Cumulus,
        2_996_110,
        2_997_621,
        None,
    );
    let first_126 = put_confirmed(
        &mut st,
        "f593e4db9a613d66f7c306f8f84fb92fdb9f615a1309a6e303b8dd21614abc3b",
        Tier::Cumulus,
        2_996_126,
        2_997_638,
        None,
    );
    let second_126 = put_confirmed(
        &mut st,
        "09701dd2db5c0b201dd9d71826dc1281b3c6f9cf261ddc346b38e40c8e2782a4",
        Tier::Cumulus,
        2_996_126,
        2_997_638,
        None,
    );
    // A node paid at 2,996,110 queues after the never-paid nodes confirmed at that height.
    let paid_110 = put_confirmed(
        &mut st,
        "0000000000000000000000000000000000000000000000000000000000000001",
        Tier::Cumulus,
        2_000_000,
        2_997_600,
        Some(2_996_110),
    );
    let order: Vec<NodeId> = st.queue.tier(Tier::Cumulus).unwrap().iter().collect();
    assert_eq!(
        order,
        vec![first_110, second_110, paid_110, first_126, second_126]
    );
    // A restart rebuilds the same order from the records alone.
    let mut q = atlas_engine::state::queue::PaymentQueue::default();
    q.rebuild(st.nodes.listed().map(|e| &e.rec));
    let rebuilt: Vec<NodeId> = q.tier(Tier::Cumulus).unwrap().iter().collect();
    assert_eq!(rebuilt, order);
}

#[test]
fn dos_window_and_ban_end_match_fluxd() {
    let mut st = common::seeded();
    let started = id_of(&st, "5da658c1ec44", 0);
    st.queue.remove(started);
    st.nodes.set_status(started, NodeStatus::Started, NOW);
    st.nodes.get_mut(started).unwrap().rec.added_height = 2_997_000;
    let step = |st: &mut NetworkState, h: u32| {
        let mut tick = Tick::new(NOW);
        apply_block(st, &mut tick, &empty_block(h), false);
        tick
    };
    // CheckForExpiredStartTx: DOS at exactly added + 240.
    step(&mut st, 2_997_239);
    assert_eq!(st.nodes.rec(started).unwrap().status, NodeStatus::Started);
    let tick = step(&mut st, 2_997_240);
    assert_eq!(tick.count("node_dosed"), 1);
    assert_eq!(st.nodes.rec(started).unwrap().status, NodeStatus::Dos);
    // GetUndoDataForExpiredFluxnodeDosScores: the ban ends at added + 720.
    step(&mut st, 2_997_719);
    assert_eq!(st.nodes.rec(started).unwrap().status, NodeStatus::Dos);
    let tick = step(&mut st, 2_997_720);
    assert_eq!(st.nodes.rec(started).unwrap().status, NodeStatus::Departed);
    assert!(
        tick.node_delta(DeltaCause::Block)
            .unwrap()
            .removed
            .contains(&started)
    );
}

#[test]
fn reconcile_fills_an_unknown_payment_address_without_a_bug_signal() {
    let mut st = common::seeded();
    let list = common::node_list();
    // A node that started and confirmed between two start-list polls: no address yet.
    let a = id_of(&st, "5da658c1ec44", 0);
    st.nodes.get_mut(a).unwrap().rec.payment_address = "".into();
    // A real mismatch stays a bug signal, with its detail.
    let b = id_of(&st, "0772379987b1", 0);
    st.nodes.get_mut(b).unwrap().rec.payment_address = "t1Wrong".into();
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert_eq!(rep.filled.get("payment_address"), Some(&1));
    assert_eq!(rep.diffs.get("payment_address"), Some(&1));
    assert!(
        rep.samples
            .iter()
            .any(|s| s.contains("payment_address t1Wrong")),
        "{:?}",
        rep.samples
    );
    assert!(!st.nodes.rec(a).unwrap().payment_address.is_empty());
}

#[test]
fn reconcile_diff_counts_bug_signals() {
    let mut st = common::seeded();
    let list = common::node_list();
    // Break the model: wrong endpoint, wrong last paid, a node the list does not have,
    // and drop a node the list has.
    let a = id_of(&st, "5da658c1ec44", 0);
    st.nodes
        .set_endpoint(a, Some("9.9.9.9:16127".parse().unwrap()));
    let b = id_of(&st, "0772379987b1", 0);
    st.nodes.get_mut(b).unwrap().rec.last_paid_height = Some(1);
    let (ghost, _) = st.nodes.intern(Outpoint::new(common::hash(9), 0), NOW);
    {
        let e = st.nodes.get_mut(ghost).unwrap();
        e.rec.tier = Tier::Cumulus;
        e.rec.last_confirmed_height = Some(2_996_800);
    }
    st.nodes.set_status(ghost, NodeStatus::Confirmed, NOW);
    let dropped = id_of(&st, "f5736b6a6349", 0);
    st.nodes.set_status(dropped, NodeStatus::Departed, NOW);
    st.queue.remove(dropped);
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert!(!rep.initial);
    assert_eq!(rep.list_height, 2_996_914);
    assert_eq!(rep.diffs.get("endpoint"), Some(&1));
    assert_eq!(rep.diffs.get("last_paid_height"), Some(&1));
    assert_eq!(rep.diffs.get("missing_upstream"), Some(&1));
    assert_eq!(rep.diffs.get("missing_local"), Some(&1));
    assert_eq!(rep.removed, 1);
    assert_eq!(st.nodes.rec(ghost).unwrap().status, NodeStatus::Departed);
    assert_eq!(st.nodes.rec(dropped).unwrap().status, NodeStatus::Confirmed);
    assert_eq!(
        st.nodes.rec(a).unwrap().endpoint,
        Some("80.208.17.20:16167".parse().unwrap())
    );
    // A second pass over the same list is clean.
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert_eq!(rep.total_diffs(), 0, "{rep:?}");

    // Nodes changed by a newer block than the list are left alone.
    let mut st = common::seeded();
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &list);
    assert_eq!(rep.total_diffs(), 0, "{rep:?}");
    assert!(rep.skipped_newer >= 3);
}

#[test]
fn first_boot_block_before_the_list_is_attributed_by_the_reconcile() {
    // The heads the list puts first in each tier: the payees of block 2,996,916.
    let seeded = common::seeded();
    let heads: Vec<NodeId> = Tier::ALL
        .iter()
        .map(|t| seeded.queue.head(*t).unwrap())
        .collect();
    let outpoints: Vec<Outpoint> = heads
        .iter()
        .map(|h| seeded.nodes.rec(*h).unwrap().outpoint)
        .collect();

    // First boot: the tip block lands before the first node list, so nobody is attributed.
    let mut st = NetworkState::default();
    let d = common::block("flux/daemon_getblock_2996916_verbosity2.json");
    let mut tick = Tick::new(NOW);
    apply_block(&mut st, &mut tick, &d, false);
    assert!(block_msg(&tick).payouts.iter().all(|p| p.node.is_none()));

    // The initial reconcile (list at 2,996,914) attributes them and rotates them to the back.
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &common::node_list());
    assert_eq!(rep.reattributed, 3);
    for (tier, op) in Tier::ALL.iter().zip(&outpoints) {
        let (id, _) = st.nodes.intern(*op, NOW);
        let r = st.nodes.rec(id).unwrap();
        assert_eq!(r.last_paid_height, Some(2_996_916));
        let q = st.queue.tier(*tier).unwrap();
        assert_eq!(q.iter().last(), Some(id), "{tier} payee at the back");
        assert_ne!(q.head(), Some(id));
        assert_eq!(r.rank, Some(q.len() as u32 - 1));
    }
    let blk = st.recent.iter().find(|b| b.height == 2_996_916).unwrap();
    assert!(blk.payouts.iter().all(|p| p.node.is_some()));
    // Nodes the block heartbeated are newer than the list, but the list still fills what the
    // block could not know (tier, payment address, confirm height).
    let listed: BTreeSet<Outpoint> = common::node_list().iter().map(|n| n.outpoint).collect();
    let mut filled = 0;
    for e in st.nodes.listed() {
        if !listed.contains(&e.rec.outpoint) {
            continue;
        }
        assert!(
            !e.rec.payment_address.is_empty(),
            "node {} address",
            e.rec.id.0
        );
        assert!(
            e.rec.confirmed_height.is_some(),
            "node {} confirmed",
            e.rec.id.0
        );
        filled += 1;
    }
    assert!(filled > 0);
    // A second pass has nothing left to attribute, and finds no differences.
    let mut tick = Tick::new(NOW);
    let rep = reconcile(&mut st, &mut tick, &common::node_list());
    assert_eq!(rep.reattributed, 0);
    assert_eq!(rep.total_diffs(), 0, "{rep:?}");
}

#[test]
fn stats_round_location_gets_the_local_geoip_city() {
    let mut st = common::seeded();
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../atlas-geoip/tests/fixtures/GeoIP2-City-Test.mmdb");
    st.geoip = Some(atlas_engine::geoip::LoadedGeoIp::open(&fixture).unwrap());
    let id = st.nodes.listed().next().unwrap().rec.id;
    st.nodes
        .set_endpoint(id, Some("81.2.69.142:16127".parse().unwrap()));
    let outpoint = st.nodes.rec(id).unwrap().outpoint;
    let reported = Geo {
        lat: 51.5,
        lon: -0.12,
        country_code: "GB".into(),
        country: "United Kingdom".into(),
        org: "Andrews & Arnold Ltd".into(),
        asn: Some(20_712),
        source: atlas_core::node::GeoSource::NodeReported,
        ..Geo::default()
    };
    let row = RoundNode {
        outpoint,
        reachable: true,
        geo: Some(reported),
        ..RoundNode::default()
    };
    let mut tick = Tick::new(NOW);
    apply_round(&mut st, &mut tick, NOW, std::slice::from_ref(&row));
    let g = st.nodes.rec(id).unwrap().geo.clone().unwrap();
    assert_eq!(g.city, "London");
    assert_eq!(g.region, "England");
    assert_eq!(g.org, "Andrews & Arnold Ltd", "org from the source");
    assert_eq!((g.lat, g.lon), (51.5, -0.12), "coordinates from the source");
    assert_eq!(g.source, atlas_core::node::GeoSource::NodeReported);
    // The same report again changes nothing (the enriched city is kept).
    let mut tick = Tick::new(NOW);
    let rep = apply_round(&mut st, &mut tick, NOW, &[row]);
    assert_eq!(rep.located, 0);
    assert_eq!(
        st.nodes.rec(id).unwrap().geo.as_ref().unwrap().city,
        "London"
    );
}

#[test]
fn stats_round_diff_ignores_zero_placeholders() {
    let rows: Vec<atlas_flux::models::stats::StatsNodeRow> =
        common::envelope("flux/stats_fluxinfo.json");
    let nodes: Vec<RoundNode> = rows.iter().filter_map(RoundNode::from_row).collect();
    let unreachable: Vec<&RoundNode> = nodes.iter().filter(|n| !n.reachable).collect();
    assert!(!unreachable.is_empty(), "fixture has placeholder rows");
    for u in &unreachable {
        assert!(u.hw.is_none() && u.geo.is_none() && u.versions.flux_os.is_none());
    }
    let mut st = NetworkState::default();
    for n in &nodes {
        let (id, _) = st.nodes.intern(n.outpoint, NOW);
        st.nodes.set_status(id, NodeStatus::Confirmed, NOW);
    }
    // A placeholder node we already located stays where it is.
    let known = st.nodes.id_of(&unreachable[0].outpoint).unwrap();
    let berlin = Geo {
        lat: 52.5,
        lon: 13.4,
        country_code: "DE".into(),
        ..Geo::default()
    };
    st.nodes.get_mut(known).unwrap().rec.geo = Some(berlin.clone());
    st.nodes.get_mut(known).unwrap().rec.reachable = Some(true);
    let mut tick = Tick::new(NOW);
    let rep = apply_round(&mut st, &mut tick, 1_790_000_000_000, &nodes);
    assert_eq!(rep.matched, nodes.len());
    assert_eq!(rep.unreachable as usize, unreachable.len());
    assert_eq!(rep.went_unreachable, 1);
    let r = st.nodes.rec(known).unwrap();
    assert_eq!(r.reachable, Some(false));
    assert_eq!(r.geo.as_ref(), Some(&berlin), "never overwritten by (0, 0)");
    for n in &unreachable {
        let r = st.nodes.rec(st.nodes.id_of(&n.outpoint).unwrap()).unwrap();
        assert!(r.geo.as_ref().is_none_or(Geo::has_coords));
        assert!(r.hw.is_none() || r.id == known);
    }
    // First sight of hardware and versions fills the records without "changed" events.
    assert_eq!((rep.hardware_changed, rep.versions_changed), (0, 0));
    assert_eq!(tick.count("node_hardware_changed"), 0);
    assert!(rep.located > 0);
    let reachable = nodes
        .iter()
        .find(|n| n.reachable && n.hw.is_some())
        .unwrap();
    let rid = st.nodes.id_of(&reachable.outpoint).unwrap();
    assert!(st.nodes.rec(rid).unwrap().hw.is_some());
    assert!(st.nodes.rec(rid).unwrap().versions.flux_os.is_some());
    assert_eq!(tick.count("stats_round"), 1);
    // The same round again changes nothing.
    let mut tick = Tick::new(NOW);
    let rep = apply_round(&mut st, &mut tick, 1_790_000_000_000, &nodes);
    assert_eq!(
        (
            rep.hardware_changed,
            rep.versions_changed,
            rep.located,
            rep.went_unreachable
        ),
        (0, 0, 0, 0)
    );
    // A real benchmark change is reported.
    let mut changed = nodes.clone();
    let row = changed
        .iter_mut()
        .find(|n| n.outpoint == reachable.outpoint)
        .unwrap();
    row.hw.as_mut().unwrap().cores += 4;
    let mut tick = Tick::new(NOW);
    let rep = apply_round(&mut st, &mut tick, 1_790_000_060_000, &changed);
    assert_eq!(rep.hardware_changed, 1);
}

fn inst(ep: &str, hash: u32) -> AppInstance {
    AppInstance {
        node: None,
        endpoint: ep.parse().unwrap(),
        spec_hash: Some(common::hash(hash)),
        broadcast_ms: NOW,
        expire_ms: NOW + 7_500_000,
        running_since_ms: Some(NOW),
        os_uptime_s: 1,
        static_ip: false,
    }
}

#[test]
fn app_placement_spawn_remove_rolling_update() {
    let mut st = common::seeded();
    let mut app = common::synthetic_app(1);
    app.locations = vec![
        inst("80.72.20.160:16137", 1),
        inst("80.208.17.20:16167", 1),
        inst("67.165.64.194:16137", 1),
    ];
    st.apps.records.insert(app.name.clone(), app);
    st.apps.placement_loaded = true;
    let rows = vec![
        ("SyntheticApp1".to_owned(), inst("80.72.20.160:16137", 1)), // unchanged
        ("syntheticapp1".to_owned(), inst("80.208.17.20:16167", 2)), // rolling update
        ("syntheticapp1".to_owned(), inst("170.203.128.89:16167", 2)), // spawn
                                                                     // 67.165.64.194:16137 removed
    ];
    let mut tick = Tick::new(NOW);
    let diff = atlas_engine::derive::apps::apply_placement(&mut st, &mut tick, rows, None);
    assert_eq!(diff.count(), (1, 1, 1));
    assert_eq!(tick.count("app_instance_started"), 1);
    assert_eq!(tick.count("app_instance_removed"), 1);
    assert_eq!(tick.count("app_instance_updated"), 1);
    let delta = tick.app_delta(DeltaCause::Sweep).unwrap();
    let [started, removed, updated] = &delta.instances["syntheticapp1"];
    assert_eq!(
        started.len() + removed.len() + updated.len(),
        3,
        "node ids resolved"
    );
    // Node app counts follow the instances.
    let spawned = st
        .nodes
        .by_endpoint(&"170.203.128.89:16167".parse().unwrap())
        .unwrap();
    assert_eq!(st.nodes.rec(spawned).unwrap().app_count, 1);
    let gone = st
        .nodes
        .by_endpoint(&"67.165.64.194:16137".parse().unwrap())
        .unwrap();
    assert_eq!(st.nodes.rec(gone).unwrap().app_count, 0);

    // Hot-app polling only touches its app.
    let mut other = common::synthetic_app(2);
    other.locations = vec![inst("80.72.20.160:16137", 5)];
    st.apps.records.insert(other.name.clone(), other);
    let mut tick = Tick::new(NOW);
    let diff = atlas_engine::derive::apps::apply_placement(
        &mut st,
        &mut tick,
        vec![("syntheticapp1".to_owned(), inst("80.72.20.160:16137", 1))],
        Some("syntheticapp1"),
    );
    assert_eq!(diff.count(), (0, 2, 0));
    assert_eq!(st.apps.records["syntheticapp2"].locations.len(), 1);

    // A cold first load emits no events.
    let mut st = common::seeded();
    st.apps
        .records
        .insert("syntheticapp1".into(), common::synthetic_app(1));
    let mut tick = Tick::new(NOW);
    atlas_engine::derive::apps::apply_placement(
        &mut st,
        &mut tick,
        vec![("syntheticapp1".to_owned(), inst("80.72.20.160:16137", 1))],
        None,
    );
    assert_eq!(tick.count("app_instance_started"), 0);
    assert_eq!(st.apps.records["syntheticapp1"].locations.len(), 1);
}

#[test]
fn mesh_diff() {
    let n = NodeId;
    let set = |v: &[u32]| v.iter().map(|x| NodeId(*x)).collect::<BTreeSet<_>>();
    let rep = |out: &[u32], inn: &[u32], at: u64| Report {
        outbound: set(out),
        inbound: set(inn),
        at_ms: at,
    };
    let continent = |x: NodeId| if x.0 >= 100 { "NA" } else { "EU" };
    let cross = |a: NodeId, b: NodeId| continent(a) != continent(b);
    let mut m = Mesh::default();
    // 1 reports 2 (out) and 100 (in).
    let d = m.merge(vec![(n(1), rep(&[2], &[100], 10))], &cross);
    assert_eq!(d.added, vec![(n(1), n(2), 0), (n(1), n(100), 2)]);
    assert!(d.removed.is_empty());
    // 2 reports 1 back: the edge becomes bidirectional (reflagged, not re-added).
    let d = m.merge(vec![(n(2), rep(&[1], &[], 20))], &cross);
    assert!(d.added.is_empty());
    assert_eq!(d.reflagged, vec![(n(1), n(2), 1)]);
    // 1 drops 100 but keeps 2: one report without the link is not evidence enough (hysteresis),
    // nothing changes yet.
    let d = m.merge(vec![(n(1), rep(&[2], &[], 30))], &cross);
    assert!(d.is_empty(), "{d:?}");
    assert_eq!(m.edge_count(), 2);
    // The next report covering 1-100 without it removes it.
    let d = m.merge(vec![(n(1), rep(&[2], &[], 32))], &cross);
    assert_eq!(d.removed, vec![(n(1), n(100))]);
    assert!(d.reflagged.is_empty() && d.added.is_empty());
    assert_eq!(m.edge_count(), 1);
    // 2 reports without 1 while 1 still lists 2 (the two lists disagree, as they do for a while
    // after a reconnect): the link stays, no longer bidirectional.
    let d = m.merge(vec![(n(2), rep(&[3], &[], 40))], &cross);
    assert!(d.removed.is_empty());
    assert_eq!(d.added, vec![(n(2), n(3), 0)]);
    assert_eq!(d.reflagged, vec![(n(1), n(2), 0)]);
    // 1 lists 2 again: the miss streak resets, so a later single omission still keeps it.
    let d = m.merge(vec![(n(1), rep(&[2], &[], 41))], &cross);
    assert!(d.is_empty(), "{d:?}");
    let d = m.merge(vec![(n(2), rep(&[3], &[], 42))], &cross);
    assert!(d.removed.is_empty(), "{d:?}");
    // Two consecutive covering reports without it (one from each side): gone.
    let d = m.merge(vec![(n(1), rep(&[], &[], 43))], &cross);
    assert_eq!(d.removed, vec![(n(1), n(2))]);
    // Duplicate reporting of one connection from both sides is still one undirected edge.
    let d = m.merge(vec![(n(3), rep(&[], &[2], 45))], &cross);
    assert_eq!(d.reflagged, vec![(n(2), n(3), 1)]);
    assert_eq!(m.edge_count(), 1);
    // Every report older than the cutoff expires: the edge disappears.
    let d = m.expire(50, &cross);
    assert_eq!(d.removed, vec![(n(2), n(3))]);
    assert_eq!(m.edge_count(), 0);
    // Restored edges expire unless a sweep refreshes them.
    let mut r = Mesh::restore(vec![(n(8), n(9), 1, 1)], 100);
    assert_eq!(r.edge_count(), 1);
    assert!(r.expire(50, &cross).is_empty());
    assert_eq!(r.expire(101, &cross).removed, vec![(n(8), n(9))]);
    // mesh.bin round trip of the current edges.
    m.merge(vec![(n(5), rep(&[6, 7], &[], 40))], &cross);
    let raw = atlas_core::codec::mesh_bin::encode_mesh_bin(1, 2, m.edge_list());
    let back = atlas_core::codec::mesh_bin::decode_mesh_bin(&raw).unwrap();
    assert_eq!(back.edge_count(), 2);
    // A departed node loses its edges.
    let d = m.remove_node(n(6));
    assert_eq!(d.removed, vec![(n(5), n(6))]);
}

#[test]
fn mesh_outlier_calls_are_discarded() {
    use atlas_engine::state::mesh::{
        CallScreen, OUTLIER_MIN_ADDED, OUTLIER_WARMUP, OUTLIER_WINDOW, Verdict,
    };
    // Judgement is relative to the median of recent calls, per reporter.
    let mut s = CallScreen::default();
    // Cold: nothing is judged before the window is warm, however large.
    for _ in 0..OUTLIER_WARMUP {
        assert_eq!(s.judge(3_000, 60), Verdict::Accept);
    }
    let mut s = CallScreen::default();
    for i in 0..OUTLIER_WARMUP {
        assert_eq!(s.judge(240 + i, 60), Verdict::Accept);
    }
    // About 4 links per reporter: 3,000 from 60 reporters is far over 4x; rejected.
    assert!(matches!(
        s.judge(3_000, 60),
        Verdict::Reject { added: 3_000, .. }
    ));
    // A call that adds a lot from many reporters is not an outlier per reporter.
    assert_eq!(s.judge(1_200, 300), Verdict::Accept);
    // Below the absolute floor nothing is rejected, even at a high rate.
    assert_eq!(s.judge(OUTLIER_MIN_ADDED - 1, 10), Verdict::Accept);
    assert_eq!((s.rejected_calls, s.rejected_links), (1, 3_000));
    // A lasting change of regime (every call large) moves the median within half a window.
    let mut accepted_after = None;
    for i in 0..OUTLIER_WINDOW {
        if s.judge(3_000, 60) == Verdict::Accept {
            accepted_after = Some(i);
            break;
        }
    }
    assert!(accepted_after.is_some_and(|i| i <= OUTLIER_WINDOW / 2 + 1));

    // In the mesh: an outlier call changes nothing, a normal one merges.
    let set = |v: std::ops::Range<u32>| v.map(NodeId).collect::<BTreeSet<_>>();
    let cross = |_: NodeId, _: NodeId| false;
    let mut m = Mesh::default();
    for i in 0..OUTLIER_WARMUP as u32 {
        // Each warm-up call: 10 reporters with 2 new links each.
        let batch: Vec<(NodeId, Report)> = (0..10)
            .map(|r| {
                let id = NodeId(10_000 + i * 10 + r);
                let base = 20_000 + (i * 10 + r) * 2;
                (
                    id,
                    Report {
                        outbound: set(base..base + 2),
                        inbound: BTreeSet::new(),
                        at_ms: u64::from(i),
                    },
                )
            })
            .collect();
        let (v, d) = m.merge_screened(batch, &cross);
        assert_eq!(v, Verdict::Accept);
        assert_eq!(d.added.len(), 20);
    }
    let before = m.edge_count();
    let huge: Vec<(NodeId, Report)> = (0..10)
        .map(|r| {
            let base = 50_000 + r * 100;
            (
                NodeId(10_000 + r),
                Report {
                    outbound: set(base..base + 100),
                    inbound: BTreeSet::new(),
                    at_ms: 99,
                },
            )
        })
        .collect();
    assert_eq!(m.preview_added(&huge), 1_000);
    let (v, d) = m.merge_screened(huge, &cross);
    assert!(matches!(v, Verdict::Reject { added: 1_000, .. }), "{v:?}");
    assert!(d.is_empty() && d.reporters.is_empty());
    assert_eq!(m.edge_count(), before);
    // The rejected copy did not replace the reporter's list: its links are all still there.
    assert_eq!(m.reported_at(NodeId(10_000)), Some(0));
}

#[test]
fn full_dump_queue_has_zero_inversions() {
    // Optional: the untrimmed 6,724-node dump from the research phase.
    let Some(raw) = common::raw_dump("daemon_viewdeterministicfluxnodelist.json") else {
        eprintln!("full dump not present; skipped");
        return;
    };
    let v: Vec<atlas_flux::models::nodes::NodeListEntry> =
        atlas_flux::envelope::parse_envelope("dump", &raw).unwrap();
    let list: Vec<_> = v
        .iter()
        .filter_map(atlas_flux::models::nodes::NodeListEntry::normalize)
        .collect();
    let mut st = NetworkState::default();
    let mut tick = Tick::new(NOW);
    reconcile(&mut st, &mut tick, &list);
    let recs: Vec<_> = st.nodes.listed().map(|e| e.rec.clone()).collect();
    assert_eq!(recs.len(), 6724);
    assert_eq!(rank_inversions(recs.iter()), 0);
    // The model reproduces every upstream rank exactly.
    let mismatched = list
        .iter()
        .filter(|n| {
            let id = st.nodes.id_of(&n.outpoint).unwrap();
            st.nodes.rec(id).unwrap().rank != n.rank
        })
        .count();
    assert_eq!(mismatched, 0);
}

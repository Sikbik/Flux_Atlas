//! Applies one decoded block to the network state (BlockDecoder, PayoutAttribution,
//! NodeRegistry block path, Expiry watch, NextPayees local model).
//!
//! Order inside a block: payouts first (the payees were chosen from the queue as it stood
//! before this block), then fluxnode transactions in block order, then collateral spends, then
//! expiry / DOS derivation at the new height, then ranks and next payees.

use atlas_core::api::{PayoutDto, TipInfo};
use atlas_core::chain::{BlockSummary, NodeTxKind, TxKind};
use atlas_core::event::{Event, NextPayee, RemovalReason};
use atlas_core::live::{
    BlockAppPayment, BlockMsg, DeltaCause, FeedKind, FeedRef, LiveBody, NextPayeeDto, NextPayeesMsg,
};
use atlas_core::node::windows;
use atlas_core::{Amount, NodeId, NodeStatus, Tier};
use atlas_flux::decode::DecodedBlock;

use crate::state::queue::{CLASS_CONFIRMED, CLASS_PAID};
use crate::state::{NetworkState, Tick, mask, tx_lite};

/// How a payout was attributed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attribution {
    /// `fluxnodecurrentwinner` named this node for the height.
    Winner,
    /// The local queue head of the tier.
    QueueHead,
    /// Another queued node with the same address (model drift).
    Fallback,
    None,
}

/// Outcome counters of one block (for engine stats).
#[derive(Debug, Clone, Default)]
pub struct BlockReport {
    pub attributions: Vec<Attribution>,
}

const DEV: DeltaCause = DeltaCause::Block;

/// Applies `d` and fills `tick`. Returns the `block` live message (also pushed onto
/// `tick.primary`) and attribution stats.
pub fn apply_block(
    st: &mut NetworkState,
    tick: &mut Tick,
    d: &DecodedBlock,
    discontinuous: bool,
) -> BlockReport {
    let now = tick.now_ms;
    let h = d.summary.height;
    let time_ms = d.summary.time_ms;
    let mut summary: BlockSummary = d.summary.clone();
    let mut report = BlockReport::default();
    let mut msg_payouts = Vec::new();
    let mut heartbeats = Vec::new();
    let mut confirms = Vec::new();
    let mut starts = Vec::new();
    let mut updates = Vec::new();
    let mut spent_nodes = Vec::new();

    // Producer: header collateral (often a 10-hex prefix) resolved against listed nodes.
    summary.producer = summary.producer_collateral.as_ref().and_then(|c| {
        if let Some(full) = c.as_full() {
            return st.nodes.id_of(full);
        }
        let mut found = None;
        for e in st.nodes.listed() {
            if c.matches(&e.rec.outpoint) {
                if found.is_some() {
                    return None;
                }
                found = Some(e.rec.id);
            }
        }
        found
    });

    // Payouts.
    let expected = st.expected_payees.remove(&h);
    for p in &mut summary.payouts {
        let (node, how) = attribute(st, expected.as_deref(), p.tier, &p.address);
        report.attributions.push(how);
        p.node = node;
        st.interval.payouts += p.amount;
        if let Some(id) = node {
            if let Some(e) = st.nodes.get_mut(id) {
                e.rec.last_paid_height = Some(h);
                e.rec.last_seen_ms = now;
                e.touched = h;
            }
            st.queue.upsert(id, p.tier, (h, CLASS_PAID, 0));
            // Clients rotate the payee themselves from the block's payouts (rank contract).
            st.client_ranks.rotate(id);
            st.nodes.touch_persist(id);
            tick.node_changed(DEV, id, mask::PAID);
        }
        tick.event(
            Event::NodePaid {
                node,
                tier: p.tier,
                address: p.address.clone(),
                amount: p.amount,
                height: h,
            },
            Some(time_ms),
        );
        msg_payouts.push(PayoutDto {
            tier: p.tier,
            node,
            address: p.address.to_string(),
            amount: p.amount,
        });
    }

    // Fluxnode transactions in block order.
    for (i, ntx) in d.node_txs.iter().enumerate() {
        let (id, created) = st.nodes.intern(ntx.collateral, now);
        let mut tx = ntx.clone();
        tx.node = Some(id);
        tick.batch.put_node_tx(h, i as u16, tx);
        if created {
            tick.event(
                Event::NodeAdded {
                    node: id,
                    outpoint: ntx.collateral,
                    tier: ntx.benchmark_tier.unwrap_or(Tier::Unknown),
                    endpoint: ntx.endpoint,
                },
                Some(time_ms),
            );
        }
        if let Some(e) = st.nodes.get_mut(id) {
            e.touched = h;
            e.rec.last_seen_ms = now;
            if e.rec.tier == Tier::Unknown
                && let Some(t) = ntx.benchmark_tier
            {
                e.rec.tier = t;
            }
        }
        match ntx.kind {
            NodeTxKind::Start => {
                if let Some(e) = st.nodes.get_mut(id) {
                    e.rec.added_height = h;
                    e.rec.confirmed_height = None;
                    e.at_risk = false;
                }
                st.queue.remove(id);
                let old = st.nodes.set_status(id, NodeStatus::Started, now);
                status_event(tick, id, old, NodeStatus::Started, time_ms);
                tick.event(
                    Event::NodeStarted {
                        node: id,
                        outpoint: ntx.collateral,
                        height: h,
                        txid: ntx.txid,
                        tx_version: ntx.tx_version,
                        p2sh: ntx.p2sh,
                    },
                    Some(time_ms),
                );
                if created || old.is_some_and(|s| !crate::state::is_listed(s)) {
                    tick.node_added(DEV, id);
                } else {
                    tick.node_changed(DEV, id, mask::STATUS);
                }
                if let Some(r) = st.node_ref(id) {
                    starts.push(r);
                }
            }
            NodeTxKind::InitialConfirm => {
                if let Some(e) = st.nodes.get_mut(id) {
                    e.rec.confirmed_height = Some(h);
                    e.rec.last_confirmed_height = Some(h);
                    e.rec.active_since_ms = Some(time_ms);
                    e.at_risk = false;
                }
                let was_listed = st
                    .nodes
                    .rec(id)
                    .is_some_and(|r| crate::state::is_listed(r.status));
                ip_change(st, tick, id, ntx.endpoint, &mut updates, time_ms);
                let old = st.nodes.set_status(id, NodeStatus::Confirmed, now);
                status_event(tick, id, old, NodeStatus::Confirmed, time_ms);
                if let Some(t) = st.nodes.rec(id).map(|r| r.tier) {
                    st.queue.upsert(id, t, (h, CLASS_CONFIRMED, i as u32));
                }
                st.nodes.touch_persist(id);
                tick.event(
                    Event::NodeConfirmed {
                        node: id,
                        height: h,
                        txid: ntx.txid,
                    },
                    Some(time_ms),
                );
                if created || !was_listed {
                    tick.node_added(DEV, id);
                } else {
                    tick.node_changed(
                        DEV,
                        id,
                        mask::STATUS | mask::CONFIRMED | mask::RANK | mask::TIER,
                    );
                }
                confirms.push(id);
                tick.feed(
                    FeedKind::NodeJoined,
                    vec![FeedRef::Node { id }, FeedRef::Block { height: h }],
                    &[("tier", tier_of(st, id).to_string())],
                    time_ms,
                );
            }
            NodeTxKind::UpdateConfirm | NodeTxKind::OtherConfirm => {
                if let Some(e) = st.nodes.get_mut(id) {
                    e.rec.last_confirmed_height = Some(h);
                    e.at_risk = false;
                    if e.rec.confirmed_height.is_none() {
                        e.rec.confirmed_height = Some(h);
                    }
                }
                ip_change(st, tick, id, ntx.endpoint, &mut updates, time_ms);
                let old = st.nodes.set_status(id, NodeStatus::Confirmed, now);
                status_event(tick, id, old, NodeStatus::Confirmed, time_ms);
                let needs_queue = st
                    .nodes
                    .rec(id)
                    .is_some_and(|r| st.queue.tier(r.tier).is_some_and(|q| !q.contains(id)));
                if needs_queue && let Some(r) = st.nodes.rec(id) {
                    let key = crate::state::queue::key_of(r, i as u32);
                    let t = r.tier;
                    st.queue.upsert(id, t, key);
                }
                st.nodes.touch_persist(id);
                tick.event(
                    Event::NodeHeartbeat {
                        node: id,
                        height: h,
                        txid: ntx.txid,
                        endpoint: ntx.endpoint,
                        benchmark_tier: ntx.benchmark_tier,
                    },
                    Some(time_ms),
                );
                if created || old.is_some_and(|s| !crate::state::is_listed(s)) {
                    tick.node_added(DEV, id);
                } else {
                    let mut m = mask::CONFIRMED;
                    if old.is_some() {
                        m |= mask::STATUS;
                    }
                    tick.node_changed(DEV, id, m);
                }
                heartbeats.push(id);
            }
        }
    }

    // Collateral spends: the node is gone now.
    for s in &d.spent {
        let Some(id) = st.nodes.id_of(&s.outpoint) else {
            continue;
        };
        let listed = st
            .nodes
            .rec(id)
            .is_some_and(|r| crate::state::is_listed(r.status));
        if !listed {
            continue;
        }
        st.queue.remove(id);
        if let Some(e) = st.nodes.get_mut(id) {
            e.touched = h;
        }
        let old = st.nodes.set_status(id, NodeStatus::Departed, now);
        status_event(tick, id, old, NodeStatus::Departed, time_ms);
        tick.event(
            Event::NodeCollateralSpent {
                node: id,
                txid: s.spent_by,
                height: h,
            },
            Some(time_ms),
        );
        tick.event(
            Event::NodeRemoved {
                node: id,
                reason: RemovalReason::CollateralSpent,
            },
            Some(time_ms),
        );
        tick.node_removed(DEV, id);
        tick.feed(
            FeedKind::CollateralSpent,
            vec![FeedRef::Node { id }, FeedRef::Tx { txid: s.spent_by }],
            &[],
            time_ms,
        );
        spent_nodes.push(id);
    }

    // Expiry, at-risk and DOS derivation at the new height.
    if st.expiry_armed && !discontinuous {
        derive_expiry(st, tick, h, time_ms);
    }

    // Transfers above the threshold.
    let mut big = Vec::new();
    for t in &d.transfers {
        st.mempool.remove(&t.txid);
        if t.value_out >= st.large_transfer && !st.large_transfer.is_zero() {
            tick.event(
                Event::LargeTransfer {
                    txid: t.txid,
                    value: t.value_out,
                    height: Some(h),
                },
                Some(time_ms),
            );
            tick.feed(
                FeedKind::LargeTransfer,
                vec![FeedRef::Tx { txid: t.txid }, FeedRef::Block { height: h }],
                &[("value", t.value_out.to_string())],
                time_ms,
            );
            big.push(tx_lite(t.txid, t.value_out, TxKind::Transfer, 0));
        }
    }
    for n in &d.node_txs {
        st.mempool.remove(&n.txid);
    }

    // App payments: name them when the message was pending.
    let app_payments: Vec<BlockAppPayment> = d
        .app_payments
        .iter()
        .map(|p| {
            let pending = st.apps.pending.get(&p.message_hash);
            BlockAppPayment {
                txid: p.txid,
                hash: p.message_hash,
                value: p.value,
                app: pending.map(|m| m.spec.key()),
                kind: pending.map(|m| m.kind),
            }
        })
        .collect();

    // Ranks and next payees.
    // Ranks are not streamed per block: clients rotate them, and the reducer sends
    // authoritative corrections wherever that rotation diverges from this model.
    st.apply_ranks();
    let payees = next_payees(st);
    st.next_payees.clone_from(&payees);

    // Interval counters.
    st.interval.blocks += 1;
    st.interval.txs += summary.tx_count;
    st.interval.node_txs += d.node_txs.len() as u32;
    st.interval.fees += summary.fees;
    if let Some(prev) = &st.tip
        && prev.height + 1 == h
        && time_ms > prev.time_ms
    {
        st.interval.block_interval_sum_ms += time_ms - prev.time_ms;
        st.interval.block_intervals += 1;
    }

    st.tip = Some(TipInfo {
        height: h,
        hash: summary.hash,
        time_ms,
        producer: summary.producer,
    });
    if st.live_floor.is_none_or(|f| h < f) {
        st.live_floor = Some(h);
    }
    st.summary_dirty = true;

    let msg = BlockMsg {
        height: h,
        hash: summary.hash,
        prev_hash: summary.prev_hash,
        time_ms,
        size: summary.size,
        tx_count: summary.tx_count,
        producer: summary.producer.and_then(|p| st.node_ref(p)),
        payouts: msg_payouts,
        heartbeats,
        confirms,
        starts,
        updates,
        transfers_over_threshold: big,
        reward: summary.reward,
        fees: summary.fees,
        dev_fund: summary.dev_fund,
        app_payments,
        collateral_spent: spent_nodes,
    };
    tick.batch.put_block(summary.clone());
    tick.event(Event::BlockAdded(Box::new(summary.clone())), Some(time_ms));
    st.push_recent(summary);
    tick.primary.push((LiveBody::Block(msg), Some(time_ms)));

    tick.event(
        Event::NextPayees {
            height: h + 1,
            payees: payees.clone(),
        },
        None,
    );
    tick.after.push((
        LiveBody::NextPayees(NextPayeesMsg {
            height: h + 1,
            payees: payees.iter().map(payee_dto).collect(),
        }),
        None,
    ));
    tick.publish_now = true;
    report
}

pub fn payee_dto(p: &NextPayee) -> NextPayeeDto {
    NextPayeeDto {
        tier: p.tier,
        node: p.node,
        address: p.address.to_string(),
    }
}

/// Queue heads per tier.
pub fn next_payees(st: &NetworkState) -> Vec<NextPayee> {
    Tier::ALL
        .iter()
        .map(|t| {
            let node = st.queue.head(*t);
            NextPayee {
                tier: *t,
                node,
                address: node
                    .and_then(|n| st.nodes.rec(n))
                    .map(|r| r.payment_address.clone())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn tier_of(st: &NetworkState, id: NodeId) -> Tier {
    st.nodes.rec(id).map_or(Tier::Unknown, |r| r.tier)
}

pub(crate) fn attribute(
    st: &NetworkState,
    expected: Option<&[(Tier, Option<NodeId>, String)]>,
    tier: Tier,
    address: &str,
) -> (Option<NodeId>, Attribution) {
    // The queue head comes first: operators often share one payment address across many
    // nodes, and a currentwinner answer can lag a block, so an address match on the expected
    // winner alone could pick the wrong node of the same operator.
    let q = st.queue.tier(tier);
    if let Some(head) = q.and_then(crate::state::queue::TierQueue::head)
        && st
            .nodes
            .rec(head)
            .is_some_and(|r| r.payment_address == address)
    {
        return (Some(head), Attribution::QueueHead);
    }
    if let Some(exp) = expected
        && let Some((_, Some(n), _)) = exp
            .iter()
            .find(|(t, n, a)| *t == tier && n.is_some() && a == address)
    {
        return (Some(*n), Attribution::Winner);
    }
    let Some(q) = q else {
        return (None, Attribution::None);
    };
    for id in q.iter() {
        if st
            .nodes
            .rec(id)
            .is_some_and(|r| r.payment_address == address)
        {
            return (Some(id), Attribution::Fallback);
        }
    }
    (None, Attribution::None)
}

fn status_event(tick: &mut Tick, id: NodeId, old: Option<NodeStatus>, new: NodeStatus, t: u64) {
    if let Some(from) = old
        && from != NodeStatus::Unknown
    {
        tick.event(
            Event::NodeStatusChanged {
                node: id,
                from,
                to: new,
            },
            Some(t),
        );
    }
}

fn ip_change(
    st: &mut NetworkState,
    tick: &mut Tick,
    id: NodeId,
    ep: Option<atlas_core::NodeEndpoint>,
    updates: &mut Vec<NodeId>,
    t: u64,
) {
    let Some(ep) = ep else {
        return;
    };
    if let Some(old) = st.nodes.set_endpoint(id, Some(ep)) {
        tick.event(
            Event::NodeIpChanged {
                node: id,
                old,
                new: Some(ep),
                cause: atlas_core::event::Cause::Block,
            },
            Some(t),
        );
        tick.node_changed(DEV, id, mask::ENDPOINT | mask::GEO);
        if old.is_some() {
            updates.push(id);
            tick.feed(
                FeedKind::NodeIpChanged,
                vec![FeedRef::Node { id }],
                &[("endpoint", ep.to_string())],
                t,
            );
        }
    }
}

/// Expiry watch: at-risk (>= 560 blocks since the last confirm), predicted expiry (>= 640),
/// and DOS for starts not confirmed within 240 blocks.
pub fn derive_expiry(st: &mut NetworkState, tick: &mut Tick, h: u32, t: u64) {
    let now = tick.now_ms;
    let mut at_risk = Vec::new();
    let mut expired = Vec::new();
    let mut dosed = Vec::new();
    for e in st.nodes.listed() {
        match e.rec.status {
            NodeStatus::Confirmed => {
                let Some(since) = e.rec.blocks_since_confirm(h) else {
                    continue;
                };
                if since >= windows::EXPIRATION_BLOCKS {
                    expired.push(e.rec.id);
                } else if since >= windows::AT_RISK_BLOCKS && !e.at_risk {
                    at_risk.push((e.rec.id, since));
                }
            }
            NodeStatus::Started
                if e.rec.added_height > 0
                    && h.saturating_sub(e.rec.added_height) > windows::START_EXPIRATION_BLOCKS =>
            {
                dosed.push(e.rec.id);
            }
            _ => {}
        }
    }
    for (id, since) in at_risk {
        if let Some(e) = st.nodes.get_mut(id) {
            e.at_risk = true;
        }
        tick.event(
            Event::NodeAtRisk {
                node: id,
                blocks_since_confirm: since,
            },
            Some(t),
        );
        tick.feed(
            FeedKind::NodeAtRisk,
            vec![FeedRef::Node { id }],
            &[("blocks", since.to_string())],
            t,
        );
    }
    for id in expired {
        st.queue.remove(id);
        if let Some(e) = st.nodes.get_mut(id) {
            e.touched = h;
        }
        let old = st.nodes.set_status(id, NodeStatus::Expired, now);
        status_event(tick, id, old, NodeStatus::Expired, t);
        tick.event(
            Event::NodeExpired {
                node: id,
                predicted: true,
            },
            Some(t),
        );
        tick.node_changed(DEV, id, mask::STATUS);
        tick.feed(FeedKind::NodeExpired, vec![FeedRef::Node { id }], &[], t);
    }
    for id in dosed {
        if let Some(e) = st.nodes.get_mut(id) {
            e.touched = h;
        }
        let old = st.nodes.set_status(id, NodeStatus::Dos, now);
        status_event(tick, id, old, NodeStatus::Dos, t);
        tick.event(
            Event::NodeDosed {
                node: id,
                height: h,
            },
            Some(t),
        );
        tick.node_changed(DEV, id, mask::STATUS);
        tick.feed(FeedKind::NodeDosed, vec![FeedRef::Node { id }], &[], t);
    }
}

/// Reward at the next height (bootstrap).
pub fn reward_at(h: u32) -> Amount {
    atlas_core::emission::pon_subsidy(h).unwrap_or(Amount::ZERO)
}

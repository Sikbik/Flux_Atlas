//! NodeRegistry reconciliation against the deterministic node list, the start list and the
//! DOS list. Every difference from the block-driven model is counted per field and logged as a
//! bug signal by the caller.
//!
//! The list is up to ~50 s stale (apicache plus daemon cache). Its height `L` is the highest
//! `last_confirmed_height` / `last_paid_height` it contains. Nodes the model changed from a
//! block above `L` are left alone: the list has not seen those changes yet.

use std::collections::{BTreeMap, HashMap, HashSet};

use atlas_core::event::{Cause, Event, RemovalReason};
use atlas_core::live::{DeltaCause, FeedKind, FeedRef};
use atlas_core::node::windows;
use atlas_core::{Amount, Collateral, NodeId, NodeStatus, Tier};
use atlas_flux::models::daemon::PendingNodeEntry;
use atlas_flux::models::nodes::ListedNode;

use crate::state::queue::{CLASS_PAID, key_of};
use crate::state::{NetworkState, Tick, is_listed, mask};

const RC: DeltaCause = DeltaCause::Reconcile;

/// What a reconcile found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReconcileReport {
    /// Height the list reflects.
    pub list_height: u32,
    pub listed: usize,
    /// First load into an empty model (differences are expected, not bugs).
    pub initial: bool,
    pub added: u32,
    pub removed: u32,
    /// Field differences between model and list (bug signals), by field.
    pub diffs: BTreeMap<&'static str, u32>,
    /// Nodes whose queue rank the model had wrong.
    pub rank_diffs: u32,
    /// Nodes skipped because the model already applied newer blocks to them.
    pub skipped_newer: u32,
    /// Payouts of blocks above the list height attributed only now (their block arrived
    /// before its payees were known).
    pub reattributed: u32,
}

impl ReconcileReport {
    pub fn total_diffs(&self) -> u32 {
        self.diffs.values().sum::<u32>() + self.rank_diffs
    }

    fn diff(&mut self, field: &'static str) {
        *self.diffs.entry(field).or_default() += 1;
    }
}

/// Attributes the payouts of recent blocks above the list height that were applied before their
/// payees were known (a first boot applies the tip block before the first node list lands), and
/// moves those payees to the back of their queues. Clients never rotated them (their `block`
/// message named no node), so the rank corrections after this tick bring them in line.
fn reattribute_recent_payouts(st: &mut NetworkState, tick: &mut Tick, list_height: u32) -> u32 {
    let heights: Vec<u32> = st
        .recent
        .iter()
        .filter(|b| b.height > list_height && b.payouts.iter().any(|p| p.node.is_none()))
        .map(|b| b.height)
        .collect();
    let mut n = 0;
    for h in heights {
        let Some(pos) = st.recent.iter().position(|b| b.height == h) else {
            continue;
        };
        let mut block = st.recent[pos].clone();
        let mut changed = false;
        for p in &mut block.payouts {
            if p.node.is_some() {
                continue;
            }
            let (Some(id), _) = crate::derive::block::attribute(st, None, p.tier, &p.address)
            else {
                continue;
            };
            p.node = Some(id);
            changed = true;
            n += 1;
            if let Some(e) = st.nodes.get_mut(id)
                && e.rec.last_paid_height.is_none_or(|lp| lp < h)
            {
                e.rec.last_paid_height = Some(h);
                e.touched = e.touched.max(h);
                st.queue.upsert(id, p.tier, (h, CLASS_PAID, 0));
                st.nodes.touch_persist(id);
                tick.node_changed(RC, id, mask::PAID);
            }
        }
        if changed {
            tick.batch.put_block(block.clone());
            st.recent[pos] = block;
            st.blocks_dirty = true;
        }
    }
    n
}

/// Height a node list reflects: the highest `last_confirmed_height` / `last_paid_height` in it.
pub fn list_height(list: &[ListedNode]) -> u32 {
    list.iter()
        .map(|n| {
            n.last_confirmed_height
                .unwrap_or(0)
                .max(n.last_paid_height.unwrap_or(0))
        })
        .max()
        .unwrap_or(0)
}

/// True when the model holds too few confirmed nodes for a list diff to mean anything (a first
/// load, or a model far behind, e.g. only the few nodes seen confirming in blocks before the
/// first list arrived). Such a reconcile is not a bug signal.
pub fn is_initial(st: &NetworkState, list: &[ListedNode]) -> bool {
    st.nodes
        .listed()
        .filter(|e| e.rec.status == NodeStatus::Confirmed)
        .count()
        * 2
        < list.len()
}

/// Fills fields a node list knows and the model does not (empty or unknown) into a node that
/// newer blocks already changed. Those blocks never set them (a node first seen in a block has
/// no tier, payment address or confirm height), so taking them from the list is not a rollback.
fn fill_unknown(st: &mut NetworkState, id: NodeId, n: &ListedNode) -> u16 {
    let Some(e) = st.nodes.get_mut(id) else {
        return 0;
    };
    let r = &mut e.rec;
    let mut m = 0;
    if r.tier == Tier::Unknown && n.tier != Tier::Unknown {
        r.tier = n.tier;
        m |= mask::TIER;
    }
    if r.payment_address.is_empty() {
        r.payment_address.clone_from(&n.payment_address);
    }
    if r.pubkey.is_empty() {
        r.pubkey.clone_from(&n.pubkey);
    }
    if r.confirmed_height.is_none() && n.confirmed_height.is_some() {
        r.confirmed_height = n.confirmed_height;
    }
    if r.last_paid_height.is_none() && n.last_paid_height.is_some() {
        r.last_paid_height = n.last_paid_height;
        m |= mask::PAID;
    }
    if r.added_height == 0 {
        r.added_height = n.added_height;
    }
    if r.active_since_ms.is_none() {
        r.active_since_ms = n.active_since_ms;
    }
    m
}

/// Reconciles the model with a full node list.
pub fn reconcile(st: &mut NetworkState, tick: &mut Tick, list: &[ListedNode]) -> ReconcileReport {
    let now = tick.now_ms;
    let mut rep = ReconcileReport {
        listed: list.len(),
        list_height: list_height(list),
        initial: is_initial(st, list),
        ..ReconcileReport::default()
    };
    let l = rep.list_height;
    let armed = st.expiry_armed && !rep.initial;
    let ranks_before: HashMap<NodeId, u32> = st.queue.ranks().collect();
    let keys_before: HashMap<NodeId, (u32, u8)> = ranks_before
        .keys()
        .filter_map(|id| st.queue.key(*id).map(|k| (*id, (k.0, k.1))))
        .collect();
    let mut seen: HashSet<NodeId> = HashSet::with_capacity(list.len());
    let mut list_rank: HashMap<NodeId, u32> = HashMap::with_capacity(list.len());
    let mut skipped: HashSet<NodeId> = HashSet::new();

    for n in list {
        let (id, created) = st.nodes.intern(n.outpoint, now);
        seen.insert(id);
        if let Some(r) = n.rank {
            list_rank.insert(id, r);
        }
        let touched = st.nodes.get(id).map_or(0, |e| e.touched);
        if !created && touched > l {
            rep.skipped_newer += 1;
            skipped.insert(id);
            let m = fill_unknown(st, id, n);
            st.nodes.touch_persist(id);
            if m != 0 {
                tick.node_changed(RC, id, m);
            }
            continue;
        }
        let (old_status, was_listed) = st.nodes.rec(id).map_or((NodeStatus::Unknown, false), |r| {
            (r.status, is_listed(r.status))
        });
        let mut m = 0u16;
        {
            let Some(e) = st.nodes.get_mut(id) else {
                continue;
            };
            let r = &mut e.rec;
            let check = !created && old_status == NodeStatus::Confirmed;
            macro_rules! adopt {
                ($field:ident, $value:expr, $name:literal, $bit:expr) => {{
                    let v = $value;
                    if r.$field != v {
                        if check {
                            rep.diff($name);
                            tracing::debug!(node = id.0, field = $name, model = ?r.$field, list = ?v, "reconcile field diff");
                        }
                        r.$field = v;
                        m |= $bit;
                    }
                }};
            }
            if n.tier != Tier::Unknown {
                adopt!(tier, n.tier, "tier", mask::TIER);
            }
            if r.payment_address != n.payment_address {
                if check {
                    rep.diff("payment_address");
                    tracing::debug!(node = id.0, model = %r.payment_address, list = %n.payment_address, status = ?old_status, "reconcile field diff payment_address");
                }
                r.payment_address.clone_from(&n.payment_address);
            }
            adopt!(confirmed_height, n.confirmed_height, "confirmed_height", 0);
            adopt!(
                last_confirmed_height,
                n.last_confirmed_height,
                "last_confirmed_height",
                mask::CONFIRMED
            );
            adopt!(
                last_paid_height,
                n.last_paid_height,
                "last_paid_height",
                mask::PAID
            );
            r.pubkey.clone_from(&n.pubkey);
            r.added_height = n.added_height;
            if n.active_since_ms.is_some() {
                r.active_since_ms = n.active_since_ms;
            }
            r.last_seen_ms = now;
            e.at_risk = n
                .last_confirmed_height
                .is_some_and(|c| l.saturating_sub(c) >= windows::AT_RISK_BLOCKS);
        }
        if let Some(old) = st.nodes.set_endpoint(id, n.endpoint) {
            if !created && old_status == NodeStatus::Confirmed {
                rep.diff("endpoint");
                tick.event(
                    Event::NodeIpChanged {
                        node: id,
                        old,
                        new: n.endpoint,
                        cause: Cause::Reconcile,
                    },
                    None,
                );
            }
            m |= mask::ENDPOINT | mask::GEO;
        }
        if let Some(old) = st.nodes.set_status(id, NodeStatus::Confirmed, now) {
            if old != NodeStatus::Unknown {
                tick.event(
                    Event::NodeStatusChanged {
                        node: id,
                        from: old,
                        to: NodeStatus::Confirmed,
                    },
                    None,
                );
            }
            if !rep.initial {
                rep.diff(if old == NodeStatus::Expired {
                    "expiry_mispredicted"
                } else {
                    "status"
                });
            }
            m |= mask::STATUS;
        }
        st.nodes.touch_persist(id);
        if created || !was_listed {
            rep.added += 1;
            let (tier, endpoint) = st
                .nodes
                .rec(id)
                .map_or((Tier::Unknown, None), |r| (r.tier, r.endpoint));
            tick.event(
                Event::NodeAdded {
                    node: id,
                    outpoint: n.outpoint,
                    tier,
                    endpoint,
                },
                None,
            );
            tick.node_added(RC, id);
            if !rep.initial {
                rep.diff("missing_local");
            }
        } else if m != 0 {
            tick.node_changed(RC, id, m);
        }
    }

    // Nodes the model lists as confirmed (or predicted expired) but the list does not.
    let gone: Vec<(NodeId, NodeStatus, Option<u32>)> = st
        .nodes
        .listed()
        .filter(|e| {
            matches!(e.rec.status, NodeStatus::Confirmed | NodeStatus::Expired)
                && !seen.contains(&e.rec.id)
                && e.touched <= l
        })
        .map(|e| (e.rec.id, e.rec.status, e.rec.last_confirmed_height))
        .collect();
    for (id, status, last_conf) in gone {
        let expired = status == NodeStatus::Expired
            || last_conf.is_some_and(|c| l.saturating_sub(c) >= windows::EXPIRATION_BLOCKS);
        if status == NodeStatus::Confirmed && armed {
            rep.diff(if expired {
                "expiry_missed"
            } else {
                "missing_upstream"
            });
        }
        st.queue.remove(id);
        st.nodes.set_status(id, NodeStatus::Departed, now);
        tick.event(
            Event::NodeRemoved {
                node: id,
                reason: if expired {
                    RemovalReason::Expired
                } else {
                    RemovalReason::Missing
                },
            },
            None,
        );
        if status == NodeStatus::Confirmed {
            tick.event(
                Event::NodeExpired {
                    node: id,
                    predicted: false,
                },
                None,
            );
        }
        tick.node_removed(RC, id);
        tick.feed(
            if expired {
                FeedKind::NodeExpired
            } else {
                FeedKind::NodeLeft
            },
            vec![FeedRef::Node { id }],
            &[],
            now,
        );
        rep.removed += 1;
    }

    // Queue: adopt the list order (upstream rank as the tie-break) for every node the list is
    // current for; nodes changed by newer blocks keep their model key.
    let ids = st.nodes.ids();
    for id in ids {
        let Some(r) = st.nodes.rec(id) else { continue };
        if r.status != NodeStatus::Confirmed {
            st.queue.remove(id);
            continue;
        }
        let tier = r.tier;
        if skipped.contains(&id) || !seen.contains(&id) {
            let queued = st.queue.tier(tier).is_some_and(|q| q.contains(id));
            if !queued {
                let key = key_of(r, u32::MAX);
                st.queue.upsert(id, tier, key);
            }
        } else {
            let key = key_of(r, list_rank.get(&id).copied().unwrap_or(u32::MAX));
            st.queue.upsert(id, tier, key);
        }
    }
    rep.reattributed = reattribute_recent_payouts(st, tick, l);
    st.apply_ranks();
    if !rep.initial {
        for (id, r) in st.queue.ranks() {
            if seen.contains(&id) && ranks_before.get(&id).is_some_and(|b| *b != r) {
                rep.rank_diffs += 1;
            }
            if let (Some(b), Some(k)) = (keys_before.get(&id), st.queue.key(id))
                && (k.0, k.1) != *b
            {
                tracing::debug!(node = id.0, before = ?b, after = ?(k.0, k.1), rank_before = ?ranks_before.get(&id), rank = r, "reconcile queue key diff");
            }
        }
    }
    st.expiry_armed = true;
    st.summary_dirty = true;
    tick.publish = true;
    rep
}

/// Parses a start/DOS list collateral.
fn outpoint(e: &PendingNodeEntry) -> Option<atlas_core::Outpoint> {
    match Collateral::parse(&e.collateral).ok()? {
        Collateral::Full(o) => Some(o),
        Collateral::Prefix(_) => None,
    }
}

/// Cross-checks the start list: nodes started (start mined) but not yet confirmed. Fills tier
/// and payment address, which start transactions do not carry. Returns differences.
pub fn apply_start_list(st: &mut NetworkState, tick: &mut Tick, list: &[PendingNodeEntry]) -> u32 {
    let now = tick.now_ms;
    let tip = st.tip_height();
    let mut diffs = 0;
    for e in list {
        let Some(op) = outpoint(e) else { continue };
        let (id, created) = st.nodes.intern(op, now);
        let status = st.nodes.rec(id).map_or(NodeStatus::Unknown, |r| r.status);
        if status == NodeStatus::Confirmed {
            continue;
        }
        let tier = e
            .amount
            .parse::<Amount>()
            .map_or(Tier::Unknown, Tier::from_collateral);
        let mut m = 0;
        if let Some(n) = st.nodes.get_mut(id) {
            if n.rec.tier == Tier::Unknown && tier != Tier::Unknown {
                n.rec.tier = tier;
                m |= mask::TIER;
            }
            if n.rec.payment_address.is_empty() {
                n.rec.payment_address = e.payment_address.as_str().into();
            }
            if n.rec.added_height == 0 {
                n.rec.added_height = e.added_height;
            }
        }
        st.nodes.touch_persist(id);
        if status != NodeStatus::Started {
            if st.expiry_armed && e.added_height + 2 < tip {
                diffs += 1;
            }
            st.nodes.set_status(id, NodeStatus::Started, now);
            if created {
                tick.event(
                    Event::NodeAdded {
                        node: id,
                        outpoint: op,
                        tier,
                        endpoint: None,
                    },
                    None,
                );
                tick.event(
                    Event::NodeStatusChanged {
                        node: id,
                        from: NodeStatus::Unknown,
                        to: NodeStatus::Started,
                    },
                    None,
                );
            } else {
                tick.event(
                    Event::NodeStatusChanged {
                        node: id,
                        from: status,
                        to: NodeStatus::Started,
                    },
                    None,
                );
            }
            tick.node_added(RC, id);
        } else if m != 0 {
            tick.node_changed(RC, id, m);
        }
    }
    diffs
}

/// Cross-checks the DOS list. Returns differences (nodes our derivation had not marked).
pub fn apply_dos_list(st: &mut NetworkState, tick: &mut Tick, list: &[PendingNodeEntry]) -> u32 {
    let now = tick.now_ms;
    let tip = st.tip_height();
    let mut diffs = 0;
    for e in list {
        let Some(op) = outpoint(e) else { continue };
        let Some(id) = st.nodes.id_of(&op) else {
            continue;
        };
        let status = st.nodes.rec(id).map_or(NodeStatus::Unknown, |r| r.status);
        if matches!(status, NodeStatus::Confirmed | NodeStatus::Dos) {
            continue;
        }
        if status == NodeStatus::Started && st.expiry_armed {
            diffs += 1;
        }
        let was_listed = is_listed(status);
        st.queue.remove(id);
        st.nodes.set_status(id, NodeStatus::Dos, now);
        tick.event(
            Event::NodeDosed {
                node: id,
                height: tip,
            },
            None,
        );
        if was_listed {
            tick.node_changed(RC, id, mask::STATUS);
        } else {
            tick.node_added(RC, id);
        }
    }
    diffs
}

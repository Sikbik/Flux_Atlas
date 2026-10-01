//! Local payment-queue model (PayoutAttribution, NextPayees).
//!
//! Verified rule (flux-api.md 3.5, rechecked against the full 6,724-node dump): within a tier the
//! queue is ordered by ascending `max(last_paid_height, confirmed_height)`. Inside one height a
//! node that was *confirmed* at that height comes before the node that was *paid* at it (all 145
//! tie groups of the dump follow this). The order among several nodes confirmed in the same
//! block is not derivable from the list; we use the order of their confirm transactions in the
//! block, and for nodes loaded from the list we keep the upstream rank as the final tie-break.
//!
//! One node per tier is paid per block; the paid node moves to the back with key
//! `(height, PAID, 0)`.

use std::collections::{BTreeSet, HashMap};

use atlas_core::{NodeId, NodeRecord, Tier};

/// Queue key: `(height, class, sub)`. `class` 0 = confirmed at `height`, 1 = paid at `height`.
pub type QKey = (u32, u8, u32);

pub const CLASS_CONFIRMED: u8 = 0;
pub const CLASS_PAID: u8 = 1;

/// Queue key of a record. `sub` breaks ties inside one `(height, class)` group.
pub fn key_of(rec: &NodeRecord, sub: u32) -> QKey {
    let paid = rec.last_paid_height.unwrap_or(0);
    let conf = rec.confirmed_height.unwrap_or(0);
    if paid > 0 && paid >= conf {
        (paid, CLASS_PAID, sub)
    } else {
        (conf, CLASS_CONFIRMED, sub)
    }
}

/// One tier's queue.
#[derive(Debug, Default, Clone)]
pub struct TierQueue {
    set: BTreeSet<(QKey, NodeId)>,
    keys: HashMap<NodeId, QKey>,
}

impl TierQueue {
    pub fn insert(&mut self, id: NodeId, key: QKey) {
        if let Some(old) = self.keys.insert(id, key) {
            self.set.remove(&(old, id));
        }
        self.set.insert((key, id));
    }

    pub fn remove(&mut self, id: NodeId) -> bool {
        match self.keys.remove(&id) {
            Some(k) => {
                self.set.remove(&(k, id));
                true
            }
            None => false,
        }
    }

    pub fn contains(&self, id: NodeId) -> bool {
        self.keys.contains_key(&id)
    }

    pub fn head(&self) -> Option<NodeId> {
        self.set.first().map(|(_, id)| *id)
    }

    pub fn len(&self) -> usize {
        self.set.len()
    }

    pub fn is_empty(&self) -> bool {
        self.set.is_empty()
    }

    /// Nodes in payment order (rank 0 first).
    pub fn iter(&self) -> impl Iterator<Item = NodeId> + '_ {
        self.set.iter().map(|(_, id)| *id)
    }

    pub fn clear(&mut self) {
        self.set.clear();
        self.keys.clear();
    }
}

/// The three tier queues.
#[derive(Debug, Default, Clone)]
pub struct PaymentQueue {
    tiers: [TierQueue; 3],
}

impl PaymentQueue {
    pub fn tier(&self, tier: Tier) -> Option<&TierQueue> {
        tier.index().map(|i| &self.tiers[i])
    }

    pub fn tier_mut(&mut self, tier: Tier) -> Option<&mut TierQueue> {
        tier.index().map(|i| &mut self.tiers[i])
    }

    /// Inserts (or re-keys) a node in its tier's queue. Unknown tiers are not queued.
    pub fn upsert(&mut self, id: NodeId, tier: Tier, key: QKey) {
        for (i, q) in self.tiers.iter_mut().enumerate() {
            if Some(i) != tier.index() {
                q.remove(id);
            }
        }
        if let Some(q) = self.tier_mut(tier) {
            q.insert(id, key);
        }
    }

    pub fn remove(&mut self, id: NodeId) {
        for q in &mut self.tiers {
            q.remove(id);
        }
    }

    pub fn head(&self, tier: Tier) -> Option<NodeId> {
        self.tier(tier).and_then(TierQueue::head)
    }

    /// The queue key of `id`, when queued.
    pub fn key(&self, id: NodeId) -> Option<QKey> {
        self.tiers.iter().find_map(|q| q.keys.get(&id).copied())
    }

    /// True when `id` is queued in any tier.
    pub fn contains(&self, id: NodeId) -> bool {
        self.tiers.iter().any(|q| q.contains(id))
    }

    pub fn clear(&mut self) {
        for q in &mut self.tiers {
            q.clear();
        }
    }

    /// `(node, rank)` for every queued node.
    pub fn ranks(&self) -> impl Iterator<Item = (NodeId, u32)> + '_ {
        self.tiers
            .iter()
            .flat_map(|q| q.iter().enumerate().map(|(r, id)| (id, r as u32)))
    }

    /// Rebuilds all queues from records (for restore): key from heights, the stored rank as the
    /// final tie-break.
    pub fn rebuild<'a>(&mut self, records: impl Iterator<Item = &'a NodeRecord>) {
        self.clear();
        for r in records {
            if r.status == atlas_core::NodeStatus::Confirmed {
                let sub = r.rank.unwrap_or(u32::MAX);
                self.upsert(r.id, r.tier, key_of(r, sub));
            }
        }
    }
}

/// The payment queue as clients hold it (ARCHITECTURE section 8, rank contract). Clients never
/// receive per-block rank streams; they rotate ranks themselves:
///
/// 1. `block`: each known payee moves to the back of its tier, the nodes behind it move up.
/// 2. `nodes` deltas, in message order: `removed` nodes leave (the gap closes); a change to a
///    status other than `Confirmed` leaves the queue too; `added` nodes, and changed nodes
///    that carry a rank while unranked, enter at that rank (ascending, the rest shifts back);
///    a rank on an already ranked node is authoritative and set as is.
///
/// The engine applies the same rules here, then diffs against the true queue and sends a
/// `nodes` delta (`cause: reconcile`) with authoritative ranks for every node that differs,
/// after which this model equals the truth again.
#[derive(Debug, Default, Clone)]
pub struct ClientRanks {
    tiers: [Vec<NodeId>; 3],
}

impl ClientRanks {
    /// Resets the model to the true queue.
    pub fn reset(&mut self, q: &PaymentQueue) {
        for (i, t) in q.tiers.iter().enumerate() {
            self.tiers[i] = t.iter().collect();
        }
    }

    fn position(&self, id: NodeId) -> Option<(usize, usize)> {
        self.tiers
            .iter()
            .enumerate()
            .find_map(|(t, v)| v.iter().position(|x| *x == id).map(|p| (t, p)))
    }

    pub fn contains(&self, id: NodeId) -> bool {
        self.position(id).is_some()
    }

    /// Rule 1: a payee moves to the back of its tier.
    pub fn rotate(&mut self, id: NodeId) {
        if let Some((t, p)) = self.position(id) {
            let v = &mut self.tiers[t];
            v.remove(p);
            v.push(id);
        }
    }

    /// Leaves the queue (the gap closes).
    pub fn remove(&mut self, id: NodeId) {
        if let Some((t, p)) = self.position(id) {
            self.tiers[t].remove(p);
        }
    }

    /// Enters `tier` at `rank` (clamped to the tier size); the rest shifts back.
    pub fn insert(&mut self, tier: Tier, rank: u32, id: NodeId) {
        self.remove(id);
        if let Some(i) = tier.index() {
            let v = &mut self.tiers[i];
            let at = (rank as usize).min(v.len());
            v.insert(at, id);
        }
    }

    /// Nodes whose client-model rank differs from the true queue: nodes the clients rank
    /// elsewhere or not at all, and nodes the clients still rank that are not queued (they get
    /// the explicit unranked signal, `rank: null`). The model is reset to the truth afterwards.
    pub fn sync(&mut self, q: &PaymentQueue) -> Vec<NodeId> {
        let mut out = Vec::new();
        for model in &self.tiers {
            out.extend(model.iter().filter(|id| !q.contains(**id)));
        }
        for (i, t) in q.tiers.iter().enumerate() {
            let truth: Vec<NodeId> = t.iter().collect();
            let model = &self.tiers[i];
            let mut pos: HashMap<NodeId, usize> = HashMap::with_capacity(model.len());
            for (p, id) in model.iter().enumerate() {
                pos.insert(*id, p);
            }
            for (r, id) in truth.iter().enumerate() {
                if pos.get(id) != Some(&r) {
                    out.push(*id);
                }
            }
            self.tiers[i] = truth;
        }
        out
    }
}

/// Counts queue-order inversions against the verified rule over a set of records that carry
/// upstream ranks: within each tier, sorted by rank, the key `max(last_paid, confirmed)` must
/// never decrease.
pub fn rank_inversions<'a>(records: impl Iterator<Item = &'a NodeRecord>) -> usize {
    let mut by_tier: [Vec<(u32, u32)>; 3] = Default::default();
    for r in records {
        if let (Some(i), Some(rank)) = (r.tier.index(), r.rank) {
            by_tier[i].push((rank, key_of(r, 0).0));
        }
    }
    by_tier
        .iter_mut()
        .map(|v| {
            v.sort_unstable();
            v.windows(2).filter(|w| w[0].1 > w[1].1).count()
        })
        .sum()
}

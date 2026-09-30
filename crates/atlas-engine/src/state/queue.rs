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

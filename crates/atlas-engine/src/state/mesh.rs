//! Overlay mesh model fed by TopologySweep.
//!
//! Every `/flux/topology` call returns the peer lists that about 60 reporters sent to the
//! queried node. Each reporter's list replaces its previous one. An undirected edge `{a, b}`
//! exists while a fresh report of `a` lists `b` or a fresh report of `b` lists `a`; it is
//! bidirectional when both do. Reports expire after [`REPORT_TTL_MS`].

use std::collections::{BTreeMap, BTreeSet, HashMap};

use atlas_core::NodeId;
use atlas_core::codec::mesh_bin::flags;

/// A reporter's peer list is dropped when not refreshed for this long.
pub const REPORT_TTL_MS: u64 = 3 * 3_600_000;

/// One reporter's latest peer list.
#[derive(Debug, Clone, Default)]
pub struct Report {
    pub outbound: BTreeSet<NodeId>,
    pub inbound: BTreeSet<NodeId>,
    pub at_ms: u64,
}

impl Report {
    fn peers(&self) -> impl Iterator<Item = NodeId> + '_ {
        self.outbound.iter().chain(self.inbound.iter()).copied()
    }

    fn lists(&self, n: NodeId) -> bool {
        self.outbound.contains(&n) || self.inbound.contains(&n)
    }
}

/// Changes produced by one merge.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MeshDiff {
    /// New edges `(a, b, flags)` with `a < b`.
    pub added: Vec<(NodeId, NodeId, u8)>,
    pub removed: Vec<(NodeId, NodeId)>,
    /// Existing edges whose flags changed.
    pub reflagged: Vec<(NodeId, NodeId, u8)>,
    /// Reporters whose lists this merge refreshed.
    pub reporters: Vec<NodeId>,
}

impl MeshDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.reflagged.is_empty()
    }
}

/// The mesh.
#[derive(Debug, Default)]
pub struct Mesh {
    reports: HashMap<NodeId, Report>,
    /// Current edges `(a, b)` with `a < b`, and their flags.
    pub edges: BTreeMap<(NodeId, NodeId), u8>,
    /// First time each edge was seen (persisted with the edge).
    pub first_seen: HashMap<(NodeId, NodeId), u64>,
    pub dirty: bool,
}

fn ordered(a: NodeId, b: NodeId) -> (NodeId, NodeId) {
    if a < b { (a, b) } else { (b, a) }
}

impl Mesh {
    /// Restores persisted edges (reports are rebuilt by the next sweeps).
    pub fn restore(edges: Vec<(NodeId, NodeId, u8, u64)>) -> Self {
        let mut m = Self::default();
        for (a, b, f, first) in edges {
            let k = ordered(a, b);
            m.edges.insert(k, f);
            m.first_seen.insert(k, first);
        }
        m.dirty = true;
        m
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn reporter_count(&self) -> usize {
        self.reports.len()
    }

    /// Time of the last report from `n`.
    pub fn reported_at(&self, n: NodeId) -> Option<u64> {
        self.reports.get(&n).map(|r| r.at_ms)
    }

    /// Peer counts `(out, in)` of a reporter.
    pub fn peer_counts(&self, n: NodeId) -> Option<(u16, u16)> {
        self.reports
            .get(&n)
            .map(|r| (r.outbound.len() as u16, r.inbound.len() as u16))
    }

    /// Merges a batch of reports. `cross` tells whether two nodes are on different continents.
    pub fn merge(
        &mut self,
        reports: Vec<(NodeId, Report)>,
        cross: &dyn Fn(NodeId, NodeId) -> bool,
    ) -> MeshDiff {
        let mut candidates: BTreeSet<(NodeId, NodeId)> = BTreeSet::new();
        let mut diff = MeshDiff::default();
        for (r, rep) in reports {
            if let Some(old) = self.reports.get(&r) {
                for p in old.peers() {
                    if p != r {
                        candidates.insert(ordered(r, p));
                    }
                }
            }
            for p in rep.peers() {
                if p != r {
                    candidates.insert(ordered(r, p));
                }
            }
            self.reports.insert(r, rep);
            diff.reporters.push(r);
        }
        self.recompute(candidates, cross, &mut diff);
        diff
    }

    /// Drops reports older than `before_ms` and the edges only they supported.
    pub fn expire(&mut self, before_ms: u64, cross: &dyn Fn(NodeId, NodeId) -> bool) -> MeshDiff {
        let stale: Vec<NodeId> = self
            .reports
            .iter()
            .filter(|(_, r)| r.at_ms < before_ms)
            .map(|(n, _)| *n)
            .collect();
        let mut candidates = BTreeSet::new();
        for n in stale {
            if let Some(r) = self.reports.remove(&n) {
                for p in r.peers() {
                    if p != n {
                        candidates.insert(ordered(n, p));
                    }
                }
            }
        }
        let mut diff = MeshDiff::default();
        self.recompute(candidates, cross, &mut diff);
        diff
    }

    /// Removes a node entirely (it left the network).
    pub fn remove_node(&mut self, n: NodeId) -> MeshDiff {
        self.reports.remove(&n);
        for r in self.reports.values_mut() {
            r.outbound.remove(&n);
            r.inbound.remove(&n);
        }
        let doomed: Vec<(NodeId, NodeId)> = self
            .edges
            .keys()
            .filter(|(a, b)| *a == n || *b == n)
            .copied()
            .collect();
        let mut diff = MeshDiff::default();
        for k in doomed {
            self.edges.remove(&k);
            self.first_seen.remove(&k);
            diff.removed.push(k);
        }
        if !diff.is_empty() {
            self.dirty = true;
        }
        diff
    }

    fn recompute(
        &mut self,
        candidates: BTreeSet<(NodeId, NodeId)>,
        cross: &dyn Fn(NodeId, NodeId) -> bool,
        diff: &mut MeshDiff,
    ) {
        for (a, b) in candidates {
            let by_a = self.reports.get(&a).is_some_and(|r| r.lists(b));
            let by_b = self.reports.get(&b).is_some_and(|r| r.lists(a));
            let key = (a, b);
            if by_a || by_b {
                let mut f = 0u8;
                if by_a && by_b {
                    f |= flags::BIDIRECTIONAL;
                }
                if cross(a, b) {
                    f |= flags::CROSS_CONTINENT;
                }
                match self.edges.insert(key, f) {
                    None => diff.added.push((a, b, f)),
                    Some(old) if old != f => diff.reflagged.push((a, b, f)),
                    Some(_) => {}
                }
            } else if self.edges.remove(&key).is_some() {
                self.first_seen.remove(&key);
                diff.removed.push(key);
            }
        }
        if !diff.is_empty() {
            self.dirty = true;
        }
    }

    /// Edges for `mesh.bin`.
    pub fn edge_list(&self) -> Vec<(NodeId, NodeId, u8)> {
        self.edges.iter().map(|((a, b), f)| (*a, *b, *f)).collect()
    }
}

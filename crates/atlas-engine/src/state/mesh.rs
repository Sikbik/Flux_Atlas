//! Overlay mesh model fed by TopologySweep.
//!
//! Every `/flux/topology` call returns the peer lists that about 60 reporters sent to the
//! queried node. Each reporter's list replaces its previous one. An undirected edge `{a, b}`
//! is decided by the newer of the two reports (a connection one side dropped since the other
//! side last reported is gone); with one report, that report decides. It is bidirectional
//! when both reports list each other. Edges are undirected `NodeId` pairs (`a < b`) and
//! peers that resolve to no node never enter the set. Reports expire after
//! [`REPORT_TTL_MS`], about two full sweep cycles, and their edges are removed.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use atlas_core::NodeId;
use atlas_core::codec::mesh_bin::flags;

/// A reporter's peer list is dropped when not refreshed for this long.
pub const REPORT_TTL_MS: u64 = 3_600_000;

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
    /// Restores persisted edges. Each edge is backed by a synthetic report stamped `now_ms`, so
    /// newer sweeps override it and unrefreshed edges expire like any other report.
    pub fn restore(edges: Vec<(NodeId, NodeId, u8, u64)>, now_ms: u64) -> Self {
        let mut m = Self::default();
        for (a, b, f, first) in edges {
            let k = ordered(a, b);
            m.edges.insert(k, f);
            m.first_seen.insert(k, first);
            let mut add = |from: NodeId, to: NodeId| {
                let r = m.reports.entry(from).or_insert_with(|| Report {
                    at_ms: now_ms,
                    ..Report::default()
                });
                r.outbound.insert(to);
            };
            add(k.0, k.1);
            if f & flags::BIDIRECTIONAL != 0 {
                add(k.1, k.0);
            }
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
            // Edges held up only by other reporters' older lists are re-decided too.
            for (o, orep) in &self.reports {
                if *o != r && orep.lists(r) {
                    candidates.insert(ordered(r, *o));
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
            let ra = self.reports.get(&a);
            let rb = self.reports.get(&b);
            let by_a = ra.is_some_and(|r| r.lists(b));
            let by_b = rb.is_some_and(|r| r.lists(a));
            let present = match (ra, rb) {
                (Some(x), Some(y)) if x.at_ms > y.at_ms => by_a,
                (Some(x), Some(y)) if y.at_ms > x.at_ms => by_b,
                _ => by_a || by_b,
            };
            let key = (a, b);
            if present {
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

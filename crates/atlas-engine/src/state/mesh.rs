//! Overlay mesh model fed by TopologySweep.
//!
//! Every `/flux/topology` call returns the peer lists that about 60 reporters sent to the
//! queried node. Each reporter's list replaces its previous one. Edges are undirected `NodeId`
//! pairs (`a < b`); peers that resolve to no node never enter the set.
//!
//! **Hysteresis.** An edge `{a, b}` appears as soon as a report from `a` or `b` lists it. It is
//! removed only on real evidence: [`MISSES_TO_REMOVE`] consecutive reports covering it (new
//! reports from either endpoint) that do not list it, or no unexpired report of either endpoint
//! left. One report that omits the edge is not enough: the copies of a reporter's list that
//! different queried nodes hold differ in age, and the two endpoints' lists disagree for a while
//! after any reconnect, so a single omission was mostly noise (measured on 3106: about a third
//! of the removed links came back within 10 minutes). It is bidirectional when both latest
//! reports list each other. Reports expire after [`REPORT_TTL_MS`], about two full sweep cycles.
//!
//! **Outlier calls.** Upstream reports carry no timestamp, and some queried hosts hold copies of
//! the reporters' lists with far more links than any other host's copies (measured: a block of
//! hosts in 5.230.0.0/16, every port, adds 3,300 links per call on average where other hosts add
//! about 370, and the next covering reports from other hosts remove them again). Those hosts
//! also come in runs, since the sweep walks the node list in id order. Before a call is merged,
//! [`CallScreen`] counts the links it would add per reporter and compares that rate with the
//! median rate of the recent *accepted* calls: a call above [`OUTLIER_FACTOR`] times the median
//! that would also add at least [`OUTLIER_MIN_ADDED`] links is discarded whole (no report
//! replaced, no link added or removed). A real network-wide change (every host suddenly adding
//! many links) is told apart by its spread: when at least half of the last
//! [`OUTLIER_RECENT`] calls were over the limit and they came from at least
//! [`OUTLIER_SPREAD`] different networks (IPv4 /16), calls are accepted again, so the median
//! follows the new level instead of rejecting forever. A run of outliers from one network never
//! reaches that spread. Whatever the median, a call adding more than [`OUTLIER_MAX_ADDED`] links
//! is discarded (and TopologySweep drops implausible replies before they get here: see
//! `jobs::topology::plausible_reports`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use atlas_core::NodeId;
use atlas_core::codec::mesh_bin::flags;

/// A reporter's peer list is dropped when not refreshed for this long.
pub const REPORT_TTL_MS: u64 = 3_600_000;

/// Consecutive covering reports without the edge that remove it.
pub const MISSES_TO_REMOVE: u8 = 2;

/// A call adding links at more than this multiple of the recent median rate is an outlier.
pub const OUTLIER_FACTOR: f64 = 4.0;
/// A call adding fewer links than this is never an outlier, whatever the median.
pub const OUTLIER_MIN_ADDED: usize = 500;
/// A call that would add more links than this is always discarded (the reply caps of
/// TopologySweep bound a reply to 25,600 links; a cold start adds at most about 6,000).
pub const OUTLIER_MAX_ADDED: usize = 10_000;
/// Accepted calls in the rolling window.
pub const OUTLIER_WINDOW: usize = 64;
/// Accepted calls needed in the window before any call is judged.
pub const OUTLIER_WARMUP: usize = 16;
/// Recent calls looked at to tell a network-wide change from a run of outlier hosts.
pub const OUTLIER_RECENT: usize = 16;
/// Distinct networks among the recent over-limit calls that mark a network-wide change.
pub const OUTLIER_SPREAD: usize = 4;

/// What [`CallScreen::judge`] decided about one call.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Verdict {
    Accept,
    /// Discard the call: it would add `added` links at `rate` per reporter, over `limit`.
    Reject {
        added: usize,
        rate: f64,
        limit: f64,
    },
}

/// Rolling per-call statistics for the outlier rule (see the module docs).
#[derive(Debug, Default, Clone)]
pub struct CallScreen {
    /// Links added per reporter of the recent accepted calls, oldest first.
    rates: VecDeque<f64>,
    /// The last calls: over the limit or not, and the network of the queried host.
    recent: VecDeque<(bool, u64)>,
    /// Calls discarded and the links they would have added (lifetime counters).
    pub rejected_calls: u64,
    pub rejected_links: u64,
}

impl CallScreen {
    /// Median of the window, once warm.
    pub fn median(&self) -> Option<f64> {
        if self.rates.len() < OUTLIER_WARMUP {
            return None;
        }
        let mut v: Vec<f64> = self.rates.iter().copied().collect();
        v.sort_by(f64::total_cmp);
        let m = v.len() / 2;
        Some(if v.len().is_multiple_of(2) {
            f64::midpoint(v[m - 1], v[m])
        } else {
            v[m]
        })
    }

    /// Judges a call to a host in `network` that would add `added` links from `reporters`
    /// reports, and records it.
    pub fn judge(&mut self, added: usize, reporters: usize, network: u64) -> Verdict {
        let rate = added as f64 / reporters.max(1) as f64;
        let limit = self.median().map(|m| OUTLIER_FACTOR * m.max(0.5));
        if added > OUTLIER_MAX_ADDED {
            self.rejected_calls += 1;
            self.rejected_links += added as u64;
            return Verdict::Reject {
                added,
                rate,
                limit: OUTLIER_MAX_ADDED as f64 / reporters.max(1) as f64,
            };
        }
        let over = limit.is_some_and(|l| added >= OUTLIER_MIN_ADDED && rate > l);
        self.recent.push_back((over, network));
        while self.recent.len() > OUTLIER_RECENT {
            self.recent.pop_front();
        }
        let widespread = over && {
            let over_calls = self.recent.iter().filter(|(o, _)| *o).count();
            let networks: HashSet<u64> = self
                .recent
                .iter()
                .filter(|(o, _)| *o)
                .map(|(_, n)| *n)
                .collect();
            over_calls * 2 >= OUTLIER_RECENT && networks.len() >= OUTLIER_SPREAD
        };
        if over && !widespread {
            self.rejected_calls += 1;
            self.rejected_links += added as u64;
            return Verdict::Reject {
                added,
                rate,
                limit: limit.unwrap_or_default(),
            };
        }
        if reporters > 0 {
            self.rates.push_back(rate);
            while self.rates.len() > OUTLIER_WINDOW {
                self.rates.pop_front();
            }
        }
        Verdict::Accept
    }
}

/// The network a host belongs to for [`CallScreen`]: its IPv4 /16, or its IPv6 /32.
pub fn network_of(ip: std::net::IpAddr) -> u64 {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let o = v4.octets();
            u64::from(u16::from_be_bytes([o[0], o[1]]))
        }
        std::net::IpAddr::V6(v6) => {
            let o = v6.octets();
            (1 << 32) | u64::from(u32::from_be_bytes([o[0], o[1], o[2], o[3]]))
        }
    }
}

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
    /// Consecutive covering reports that did not list an edge (edges with at least one miss).
    misses: HashMap<(NodeId, NodeId), u8>,
    /// Edges by endpoint.
    adj: HashMap<NodeId, BTreeSet<NodeId>>,
    /// Per-call outlier statistics.
    pub screen: CallScreen,
    pub dirty: bool,
}

fn ordered(a: NodeId, b: NodeId) -> (NodeId, NodeId) {
    if a < b { (a, b) } else { (b, a) }
}

/// Edge state before a change, recorded the first time a change touches the edge, so one merge
/// reports only net changes.
#[derive(Default)]
struct Touched(BTreeMap<(NodeId, NodeId), Option<u8>>);

impl Touched {
    fn note(&mut self, m: &Mesh, k: (NodeId, NodeId)) {
        self.0.entry(k).or_insert_with(|| m.edges.get(&k).copied());
    }
}

impl Mesh {
    /// Restores persisted edges. Each edge is backed by a synthetic report stamped `now_ms`, so
    /// newer sweeps override it and unrefreshed edges expire like any other report.
    pub fn restore(edges: Vec<(NodeId, NodeId, u8, u64)>, now_ms: u64) -> Self {
        let mut m = Self::default();
        for (a, b, f, first) in edges {
            let k = ordered(a, b);
            m.link(k, f);
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

    fn link(&mut self, k: (NodeId, NodeId), f: u8) {
        self.edges.insert(k, f);
        self.adj.entry(k.0).or_default().insert(k.1);
        self.adj.entry(k.1).or_default().insert(k.0);
    }

    fn unlink(&mut self, k: (NodeId, NodeId)) {
        self.edges.remove(&k);
        self.first_seen.remove(&k);
        self.misses.remove(&k);
        for (x, y) in [(k.0, k.1), (k.1, k.0)] {
            if let Some(s) = self.adj.get_mut(&x) {
                s.remove(&y);
                if s.is_empty() {
                    self.adj.remove(&x);
                }
            }
        }
    }

    /// Flags of an edge from the latest reports.
    fn flags_of(&self, (a, b): (NodeId, NodeId), cross: &dyn Fn(NodeId, NodeId) -> bool) -> u8 {
        let by_a = self.reports.get(&a).is_some_and(|r| r.lists(b));
        let by_b = self.reports.get(&b).is_some_and(|r| r.lists(a));
        let mut f = 0u8;
        if by_a && by_b {
            f |= flags::BIDIRECTIONAL;
        }
        if cross(a, b) {
            f |= flags::CROSS_CONTINENT;
        }
        f
    }

    /// Distinct links a batch of reports would add (read-only).
    pub fn preview_added(&self, reports: &[(NodeId, Report)]) -> usize {
        let mut new: HashSet<(NodeId, NodeId)> = HashSet::new();
        for (r, rep) in reports {
            for p in rep.peers().filter(|p| p != r) {
                let k = ordered(*r, p);
                if !self.edges.contains_key(&k) {
                    new.insert(k);
                }
            }
        }
        new.len()
    }

    /// Screens one call's reports (from a host in `network`, see [`network_of`]) with the
    /// outlier rule, then merges them unless the call is an outlier. Returns the verdict and the diff (empty when rejected).
    pub fn merge_screened(
        &mut self,
        reports: Vec<(NodeId, Report)>,
        network: u64,
        cross: &dyn Fn(NodeId, NodeId) -> bool,
    ) -> (Verdict, MeshDiff) {
        let added = self.preview_added(&reports);
        let verdict = self.screen.judge(added, reports.len(), network);
        match verdict {
            Verdict::Accept => (verdict, self.merge(reports, cross)),
            Verdict::Reject { .. } => (verdict, MeshDiff::default()),
        }
    }

    /// Merges a batch of reports. `cross` tells whether two nodes are on different continents.
    pub fn merge(
        &mut self,
        reports: Vec<(NodeId, Report)>,
        cross: &dyn Fn(NodeId, NodeId) -> bool,
    ) -> MeshDiff {
        let mut touched = Touched::default();
        let mut diff = MeshDiff::default();
        for (r, rep) in reports {
            let listed: BTreeSet<NodeId> = rep.peers().filter(|p| *p != r).collect();
            let linked: Vec<NodeId> = self
                .adj
                .get(&r)
                .map(|s| s.iter().copied().collect())
                .unwrap_or_default();
            self.reports.insert(r, rep);
            diff.reporters.push(r);
            for p in &listed {
                let k = ordered(r, *p);
                touched.note(self, k);
                self.misses.remove(&k);
                if !self.edges.contains_key(&k) {
                    self.link(k, 0);
                }
            }
            for p in linked {
                if listed.contains(&p) {
                    continue;
                }
                let k = ordered(r, p);
                touched.note(self, k);
                let n = {
                    let n = self.misses.entry(k).or_insert(0);
                    *n += 1;
                    *n
                };
                if n >= MISSES_TO_REMOVE {
                    self.unlink(k);
                }
            }
        }
        self.finish(touched, cross, &mut diff);
        diff
    }

    /// Drops reports older than `before_ms`; an edge with no unexpired report listing it goes.
    pub fn expire(&mut self, before_ms: u64, cross: &dyn Fn(NodeId, NodeId) -> bool) -> MeshDiff {
        let stale: Vec<NodeId> = self
            .reports
            .iter()
            .filter(|(_, r)| r.at_ms < before_ms)
            .map(|(n, _)| *n)
            .collect();
        let mut touched = Touched::default();
        for n in &stale {
            self.reports.remove(n);
        }
        for n in stale {
            let linked: Vec<NodeId> = self
                .adj
                .get(&n)
                .map(|s| s.iter().copied().collect())
                .unwrap_or_default();
            for x in linked {
                let k = ordered(n, x);
                touched.note(self, k);
                if !self.reports.get(&x).is_some_and(|r| r.lists(n)) {
                    self.unlink(k);
                }
            }
        }
        let mut diff = MeshDiff::default();
        self.finish(touched, cross, &mut diff);
        diff
    }

    /// Removes a node entirely (it left the network).
    pub fn remove_node(&mut self, n: NodeId) -> MeshDiff {
        self.reports.remove(&n);
        for r in self.reports.values_mut() {
            r.outbound.remove(&n);
            r.inbound.remove(&n);
        }
        let linked: Vec<NodeId> = self
            .adj
            .get(&n)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default();
        let mut diff = MeshDiff::default();
        let mut doomed: Vec<(NodeId, NodeId)> = linked.into_iter().map(|x| ordered(n, x)).collect();
        doomed.sort_unstable();
        for k in doomed {
            self.unlink(k);
            diff.removed.push(k);
        }
        if !diff.is_empty() {
            self.dirty = true;
        }
        diff
    }

    /// Turns the touched edges into a net diff (sorted) and refreshes their flags.
    fn finish(
        &mut self,
        touched: Touched,
        cross: &dyn Fn(NodeId, NodeId) -> bool,
        diff: &mut MeshDiff,
    ) {
        for (k, before) in touched.0 {
            if !self.edges.contains_key(&k) {
                if before.is_some() {
                    diff.removed.push(k);
                }
                continue;
            }
            let f = self.flags_of(k, cross);
            self.edges.insert(k, f);
            match before {
                None => diff.added.push((k.0, k.1, f)),
                Some(old) if old != f => diff.reflagged.push((k.0, k.1, f)),
                Some(_) => {}
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

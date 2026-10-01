//! Watch bookkeeping (X1 M6): every connection's watched nodes and apps, the union the reducer
//! reads ([`WatchSet`]), and a fair-share pick of the hot apps and probe targets.
//!
//! - **Incremental.** A `sub` costs O(length of that connection's lists): reference counts
//!   change for the entries it adds or drops, and only the entries whose count crosses zero
//!   change the union. Nothing is rebuilt from every connection.
//! - **Fair share.** Each connection votes for its first few entries, in its own order (the
//!   client sends its selection first). Picks rank entries by voters (one vote per connection),
//!   then by share (a connection's vote is split across the entries it votes for, so a client
//!   that watches one app outweighs one that spreads over many), then by a per-process seeded
//!   hash (neither alphabetical nor predictable). One connection therefore adds at most a few
//!   entries to the contest, and many names from one client cannot crowd out other clients.
//!   Free slots are filled round robin from the connections' remaining entries.
//! - **Per IP.** The client IP is not known at this boundary; the server caps WebSocket
//!   connections per IP, which bounds one IP's votes.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{BuildHasher, Hash, RandomState};

use atlas_core::NodeId;

use crate::WatchSet;

/// Apps one connection votes for (its first ones).
pub const APP_VOTES_PER_CONN: usize = 4;
/// Nodes one connection votes for (its first ones).
pub const NODE_VOTES_PER_CONN: usize = 16;
/// Engine-side cap of the apps kept per connection (the server caps lower).
pub const MAX_APPS_PER_CONN: usize = 64;
/// Engine-side cap of the nodes kept per connection (the server caps lower).
pub const MAX_NODES_PER_CONN: usize = 256;

/// Share units of one connection's vote: divisible by every vote count up to 16.
const SHARE_UNITS: u64 = 720_720;

#[derive(Debug, Clone, Copy, Default)]
struct Vote {
    voters: u32,
    share: u64,
}

/// Reference counts and votes of one kind of key.
#[derive(Debug)]
struct Tally<K> {
    refs: HashMap<K, u32>,
    votes: HashMap<K, Vote>,
    per_conn: usize,
}

impl<K: Hash + Eq + Clone> Tally<K> {
    fn new(per_conn: usize) -> Self {
        Self {
            refs: HashMap::new(),
            votes: HashMap::new(),
            per_conn,
        }
    }

    fn vote_share(&self, list: &[K]) -> u64 {
        let k = list.len().min(self.per_conn).max(1) as u64;
        SHARE_UNITS / k
    }

    /// Replaces one connection's list `old` by `new`; returns the union changes
    /// `(added, removed)`.
    fn replace(&mut self, old: &[K], new: &[K]) -> (Vec<K>, Vec<K>) {
        let share = self.vote_share(old);
        for k in old.iter().take(self.per_conn) {
            if let Some(v) = self.votes.get_mut(k) {
                v.voters = v.voters.saturating_sub(1);
                v.share = v.share.saturating_sub(share);
                if v.voters == 0 {
                    self.votes.remove(k);
                }
            }
        }
        let share = self.vote_share(new);
        for k in new.iter().take(self.per_conn) {
            let v = self.votes.entry(k.clone()).or_default();
            v.voters += 1;
            v.share += share;
        }
        let mut gone: HashSet<K> = HashSet::new();
        for k in old {
            if let Some(n) = self.refs.get_mut(k) {
                *n -= 1;
                if *n == 0 {
                    self.refs.remove(k);
                    gone.insert(k.clone());
                }
            }
        }
        let mut added = Vec::new();
        for k in new {
            let n = self.refs.entry(k.clone()).or_insert(0);
            *n += 1;
            if *n == 1 && !gone.remove(k) {
                added.push(k.clone());
            }
        }
        (added, gone.into_iter().collect())
    }

    /// Up to `n` keys: voted keys by (voters, share, seeded hash), then the connections'
    /// remaining keys round robin.
    fn pick<'a>(
        &self,
        lists: impl Iterator<Item = &'a [K]>,
        n: usize,
        hasher: &RandomState,
    ) -> Vec<K>
    where
        K: 'a,
    {
        if n == 0 {
            return Vec::new();
        }
        let mut ranked: Vec<(u32, u64, u64, &K)> = self
            .votes
            .iter()
            .map(|(k, v)| (v.voters, v.share, hasher.hash_one(k), k))
            .collect();
        let order = |a: &(u32, u64, u64, &K), b: &(u32, u64, u64, &K)| {
            b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2))
        };
        if ranked.len() > n {
            ranked.select_nth_unstable_by(n - 1, order);
            ranked.truncate(n);
        }
        ranked.sort_unstable_by(order);
        let mut out: Vec<K> = ranked.into_iter().map(|r| r.3.clone()).collect();
        if out.len() < n {
            let lists: Vec<&[K]> = lists.collect();
            let mut chosen: HashSet<&K> = self.votes.keys().collect();
            let longest = lists.iter().map(|l| l.len()).max().unwrap_or(0);
            'fill: for pos in self.per_conn..longest {
                for l in &lists {
                    if let Some(k) = l.get(pos)
                        && chosen.insert(k)
                    {
                        out.push(k.clone());
                        if out.len() >= n {
                            break 'fill;
                        }
                    }
                }
            }
        }
        out
    }
}

/// One connection's watches, in its own order.
#[derive(Debug, Default)]
struct ConnWatch {
    nodes: Vec<NodeId>,
    apps: Vec<String>,
}

/// Union changes of one `set` or `clear`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct WatchDelta {
    pub nodes_added: Vec<NodeId>,
    pub nodes_removed: Vec<NodeId>,
    pub apps_added: Vec<String>,
    pub apps_removed: Vec<String>,
}

impl WatchDelta {
    pub fn is_empty(&self) -> bool {
        self.nodes_added.is_empty()
            && self.nodes_removed.is_empty()
            && self.apps_added.is_empty()
            && self.apps_removed.is_empty()
    }

    /// Applies the changes to a union; true if it changed.
    pub fn apply(&self, set: &mut WatchSet) -> bool {
        let mut changed = false;
        for n in &self.nodes_removed {
            changed |= set.nodes.remove(n);
        }
        for n in &self.nodes_added {
            changed |= set.nodes.insert(*n);
        }
        for a in &self.apps_removed {
            changed |= set.apps.remove(a);
        }
        for a in &self.apps_added {
            changed |= set.apps.insert(a.clone());
        }
        changed
    }
}

/// Every connection's watches with reference counts and votes.
#[derive(Debug)]
pub struct WatchIndex {
    conns: BTreeMap<u64, ConnWatch>,
    nodes: Tally<NodeId>,
    apps: Tally<String>,
    hasher: RandomState,
}

impl Default for WatchIndex {
    fn default() -> Self {
        Self {
            conns: BTreeMap::new(),
            nodes: Tally::new(NODE_VOTES_PER_CONN),
            apps: Tally::new(APP_VOTES_PER_CONN),
            hasher: RandomState::new(),
        }
    }
}

/// Keeps the first occurrence of each entry, in order, up to `max`.
fn dedup_ordered<K: Hash + Eq + Clone>(v: impl IntoIterator<Item = K>, max: usize) -> Vec<K> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for k in v {
        if out.len() >= max {
            break;
        }
        if seen.insert(k.clone()) {
            out.push(k);
        }
    }
    out
}

impl WatchIndex {
    /// Replaces the watches of `conn` (empty lists drop it). App names are lowercased; empty
    /// names and the dot segments `.` and `..` are dropped. Order is kept (first occurrence
    /// wins): a connection votes for its first entries.
    pub fn set(&mut self, conn: u64, nodes: Vec<NodeId>, apps: Vec<String>) -> WatchDelta {
        let nodes = dedup_ordered(nodes, MAX_NODES_PER_CONN);
        let apps = dedup_ordered(
            apps.into_iter()
                .map(|a| a.trim().to_ascii_lowercase())
                .filter(|a| !a.is_empty() && a != "." && a != ".."),
            MAX_APPS_PER_CONN,
        );
        let old = if nodes.is_empty() && apps.is_empty() {
            self.conns.remove(&conn).unwrap_or_default()
        } else {
            self.conns
                .insert(
                    conn,
                    ConnWatch {
                        nodes: nodes.clone(),
                        apps: apps.clone(),
                    },
                )
                .unwrap_or_default()
        };
        self.delta(&old, &nodes, &apps)
    }

    /// Drops every watch of `conn`.
    pub fn clear(&mut self, conn: u64) -> WatchDelta {
        let old = self.conns.remove(&conn).unwrap_or_default();
        self.delta(&old, &[], &[])
    }

    fn delta(&mut self, old: &ConnWatch, nodes: &[NodeId], apps: &[String]) -> WatchDelta {
        let (nodes_added, nodes_removed) = self.nodes.replace(&old.nodes, nodes);
        let (apps_added, apps_removed) = self.apps.replace(&old.apps, apps);
        WatchDelta {
            nodes_added,
            nodes_removed,
            apps_added,
            apps_removed,
        }
    }

    /// Connections with at least one watch.
    pub fn connections(&self) -> usize {
        self.conns.len()
    }

    /// Up to `n` apps to poll, by fair share.
    pub fn hot_apps(&self, n: usize) -> Vec<String> {
        self.apps.pick(
            self.conns.values().map(|c| c.apps.as_slice()),
            n,
            &self.hasher,
        )
    }

    /// Up to `n` nodes to probe, by fair share.
    pub fn probe_nodes(&self, n: usize) -> Vec<NodeId> {
        self.nodes.pick(
            self.conns.values().map(|c| c.nodes.as_slice()),
            n,
            &self.hasher,
        )
    }

    /// The union, rebuilt from every connection (tests compare it with the incremental one).
    #[cfg(test)]
    pub fn union(&self) -> WatchSet {
        let mut set = WatchSet::default();
        for c in self.conns.values() {
            set.nodes.extend(c.nodes.iter().copied());
            set.apps.extend(c.apps.iter().cloned());
        }
        set
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apps(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| (*s).to_owned()).collect()
    }

    fn applied(idx: &mut WatchIndex, set: &mut WatchSet, d: &WatchDelta) {
        d.apply(set);
        assert_eq!(*set, idx.union(), "incremental union matches a rebuild");
    }

    #[test]
    fn union_is_incremental_and_exact() {
        let mut idx = WatchIndex::default();
        let mut set = WatchSet::default();
        let d = idx.set(
            1,
            vec![NodeId(1), NodeId(2)],
            apps(&["Demo", "demo", " x "]),
        );
        assert_eq!(d.nodes_added.len(), 2);
        assert_eq!(d.apps_added, apps(&["demo", "x"]));
        applied(&mut idx, &mut set, &d);
        let d = idx.set(2, vec![NodeId(2), NodeId(3)], vec![]);
        assert_eq!(d.nodes_added, vec![NodeId(3)], "2 is already watched");
        applied(&mut idx, &mut set, &d);
        // Replacing a list moves only the entries that cross zero.
        let d = idx.set(1, vec![NodeId(2), NodeId(4)], apps(&["demo"]));
        assert_eq!(d.nodes_added, vec![NodeId(4)]);
        assert_eq!(d.nodes_removed, vec![NodeId(1)]);
        assert_eq!(d.apps_removed, apps(&["x"]));
        applied(&mut idx, &mut set, &d);
        // Same list again: no change at all.
        let d = idx.set(1, vec![NodeId(2), NodeId(4)], apps(&["demo"]));
        assert!(d.is_empty());
        assert!(!d.apply(&mut set));
        let d = idx.clear(1);
        assert_eq!(
            d.nodes_removed,
            vec![NodeId(4)],
            "2 stays: connection 2 has it"
        );
        applied(&mut idx, &mut set, &d);
        let d = idx.set(2, vec![], vec![]);
        applied(&mut idx, &mut set, &d);
        assert!(set.nodes.is_empty() && set.apps.is_empty());
        assert_eq!(idx.connections(), 0);
        assert!(idx.nodes.refs.is_empty() && idx.nodes.votes.is_empty());
        assert!(idx.apps.refs.is_empty() && idx.apps.votes.is_empty());
        // Clearing an unknown connection is a no-op.
        assert!(idx.clear(9).is_empty());
    }

    #[test]
    fn dot_segments_and_empty_names_are_dropped() {
        let mut idx = WatchIndex::default();
        let d = idx.set(1, vec![], apps(&[".", "..", " ", "ok"]));
        assert_eq!(d.apps_added, apps(&["ok"]));
        assert_eq!(idx.hot_apps(16), apps(&["ok"]));
    }

    #[test]
    fn one_client_with_many_names_cannot_take_every_hot_slot() {
        let mut idx = WatchIndex::default();
        // A client sends 64 names that sort first.
        let spam: Vec<String> = (0..64).map(|i| format!("0{i:02}")).collect();
        idx.set(1, vec![], spam.clone());
        // Twenty real clients, each with one open app.
        for c in 0..20u64 {
            idx.set(100 + c, vec![], vec![format!("app{c}")]);
        }
        let hot = idx.hot_apps(16);
        assert_eq!(hot.len(), 16);
        let spam_slots = hot.iter().filter(|a| a.starts_with('0')).count();
        assert_eq!(
            spam_slots, 0,
            "single-app watchers outweigh a spread vote: {hot:?}"
        );
        // With few other watchers, the spammer only gets its share plus free slots.
        let mut idx = WatchIndex::default();
        idx.set(1, vec![], spam);
        idx.set(2, vec![], apps(&["kadena", "wordpress"]));
        let hot = idx.hot_apps(16);
        assert!(hot.contains(&"kadena".to_owned()) && hot.contains(&"wordpress".to_owned()));
        assert_eq!(hot.len(), 16);
    }

    #[test]
    fn most_watched_apps_win() {
        let mut idx = WatchIndex::default();
        // "popular" is open in 5 connections, each also watching 3 other apps.
        for c in 0..5u64 {
            idx.set(
                c,
                vec![],
                vec![
                    format!("solo{c}a"),
                    format!("solo{c}b"),
                    "popular".to_owned(),
                    format!("solo{c}c"),
                ],
            );
        }
        // "second" is open in 3 connections.
        for c in 10..13u64 {
            idx.set(c, vec![], apps(&["second"]));
        }
        let hot = idx.hot_apps(2);
        assert_eq!(hot, apps(&["popular", "second"]));
        // A connection's votes stop after its first entries: the fifth app does not vote.
        let mut idx = WatchIndex::default();
        idx.set(1, vec![], apps(&["a", "b", "c", "d", "late"]));
        idx.set(2, vec![], apps(&["late"]));
        idx.set(3, vec![], apps(&["late"]));
        assert_eq!(idx.hot_apps(1), apps(&["late"]));
        assert_eq!(idx.apps.votes["late"].voters, 2);
    }

    #[test]
    fn probe_targets_are_shared_fairly() {
        let mut idx = WatchIndex::default();
        // One client watching 256 low ids, five clients with two nodes each.
        idx.set(1, (0..256).map(NodeId).collect(), vec![]);
        for c in 0..5u32 {
            idx.set(
                10 + u64::from(c),
                vec![NodeId(10_000 + c), NodeId(20_000 + c)],
                vec![],
            );
        }
        let picked = idx.probe_nodes(32);
        assert_eq!(picked.len(), 32);
        for c in 0..5u32 {
            assert!(picked.contains(&NodeId(10_000 + c)));
            assert!(picked.contains(&NodeId(20_000 + c)));
        }
        let from_one = picked.iter().filter(|n| n.0 < 256).count();
        assert_eq!(from_one, 22, "the big list fills the remaining slots only");
        // The fill is bounded by n and never repeats an entry.
        let all = idx.probe_nodes(10_000);
        assert_eq!(all.len(), 266);
        assert_eq!(all.iter().collect::<HashSet<_>>().len(), 266);
    }
}

//! App model: records (spec + instances), pending messages, installs, and the placement diff.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use atlas_core::api::AppIndexEntry;
use atlas_core::app::{AppInstance, AppRecord, PendingAppMessage};
use atlas_core::{Hash32, NodeEndpoint};

/// One instance move found by the placement diff.
#[derive(Debug, Clone, PartialEq)]
pub enum InstanceChange {
    Started(AppInstance),
    Removed(AppInstance),
    /// Spec hash changed on the same endpoint (rolling update).
    Updated(AppInstance),
}

impl InstanceChange {
    pub fn instance(&self) -> &AppInstance {
        match self {
            Self::Started(i) | Self::Removed(i) | Self::Updated(i) => i,
        }
    }
}

/// Result of diffing one placement fetch.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PlacementDiff {
    /// app -> changes, in endpoint order.
    pub changes: BTreeMap<String, Vec<InstanceChange>>,
    /// Apps whose running count changed.
    pub touched: Vec<String>,
    /// Rows for apps we have no record of (not yet in the catalog).
    pub unknown_apps: usize,
}

impl PlacementDiff {
    pub fn count(&self) -> (usize, usize, usize) {
        let mut c = (0, 0, 0);
        for v in self.changes.values() {
            for ch in v {
                match ch {
                    InstanceChange::Started(_) => c.0 += 1,
                    InstanceChange::Removed(_) => c.1 += 1,
                    InstanceChange::Updated(_) => c.2 += 1,
                }
            }
        }
        c
    }
}

/// Recently applied chain-feed message hashes, bounded.
#[derive(Debug, Default, Clone)]
pub struct SeenHashes {
    set: HashSet<Hash32>,
    order: VecDeque<Hash32>,
}

impl SeenHashes {
    const CAP: usize = 4096;

    pub fn insert(&mut self, h: Hash32) -> bool {
        if !self.set.insert(h) {
            return false;
        }
        self.order.push_back(h);
        while self.order.len() > Self::CAP {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        true
    }

    pub fn contains(&self, h: &Hash32) -> bool {
        self.set.contains(h)
    }
}

/// All apps plus transient app activity.
#[derive(Debug, Default)]
pub struct AppTable {
    pub records: BTreeMap<String, AppRecord>,
    pub pending: HashMap<Hash32, PendingAppMessage>,
    /// Chain-feed hashes already applied (register/update events emitted).
    pub applied: SeenHashes,
    /// In-progress installs `(app, endpoint)` from the last poll.
    pub installing: HashSet<(String, NodeEndpoint)>,
    /// Install-error keys already reported.
    pub install_errors: HashSet<(String, String, NodeEndpoint)>,
    /// A full placement was applied at least once (the first cold fetch emits no events).
    pub placement_loaded: bool,
    /// Catalog loaded at least once.
    pub catalog_loaded: bool,
    /// Something in the app index changed.
    pub dirty: bool,
}

impl AppTable {
    pub fn restore(records: Vec<AppRecord>, pending: Vec<PendingAppMessage>) -> Self {
        let placement_loaded = records.iter().any(|r| !r.locations.is_empty());
        Self {
            catalog_loaded: !records.is_empty(),
            placement_loaded,
            records: records.into_iter().map(|r| (r.name.clone(), r)).collect(),
            pending: pending.into_iter().map(|p| (p.hash, p)).collect(),
            dirty: true,
            ..Self::default()
        }
    }

    pub fn instance_count(&self) -> usize {
        self.records.values().map(|r| r.locations.len()).sum()
    }

    /// Running instances per endpoint.
    pub fn endpoint_counts(&self) -> HashMap<NodeEndpoint, u16> {
        let mut m: HashMap<NodeEndpoint, u16> = HashMap::new();
        for r in self.records.values() {
            for i in &r.locations {
                *m.entry(i.endpoint).or_default() += 1;
            }
        }
        m
    }

    /// Endpoints hosting at least one enterprise app.
    pub fn enterprise_endpoints(&self) -> HashSet<NodeEndpoint> {
        self.records
            .values()
            .filter(|r| r.spec.enterprise)
            .flat_map(|r| r.locations.iter().map(|i| i.endpoint))
            .collect()
    }

    /// Diffs placement rows against the current instances and applies them.
    ///
    /// `scope = None` means the rows are the full `/apps/locations` set (apps missing from it
    /// lose all instances); `Some(app)` limits the diff to one app (hot-app polling).
    pub fn apply_locations(
        &mut self,
        rows: Vec<(String, AppInstance)>,
        scope: Option<&str>,
    ) -> PlacementDiff {
        let mut incoming: BTreeMap<String, BTreeMap<NodeEndpoint, AppInstance>> = BTreeMap::new();
        for (name, inst) in rows {
            let name = name.to_ascii_lowercase();
            if scope.is_some_and(|s| s != name) {
                continue;
            }
            incoming
                .entry(name)
                .or_default()
                .insert(inst.endpoint, inst);
        }
        let mut diff = PlacementDiff::default();
        let names: Vec<String> = if let Some(s) = scope {
            vec![s.to_ascii_lowercase()]
        } else {
            let mut v: Vec<String> = self.records.keys().cloned().collect();
            v.extend(incoming.keys().cloned());
            v.sort();
            v.dedup();
            v
        };
        for name in names {
            let new = incoming.remove(&name).unwrap_or_default();
            let Some(rec) = self.records.get_mut(&name) else {
                if !new.is_empty() {
                    diff.unknown_apps += 1;
                }
                continue;
            };
            let old: BTreeMap<NodeEndpoint, AppInstance> = rec
                .locations
                .iter()
                .map(|i| (i.endpoint, i.clone()))
                .collect();
            let mut changes = Vec::new();
            for (ep, inst) in &new {
                match old.get(ep) {
                    None => changes.push(InstanceChange::Started(inst.clone())),
                    Some(o)
                        if o.spec_hash.is_some()
                            && inst.spec_hash.is_some()
                            && o.spec_hash != inst.spec_hash =>
                    {
                        changes.push(InstanceChange::Updated(inst.clone()));
                    }
                    Some(_) => {}
                }
            }
            for (ep, inst) in &old {
                if !new.contains_key(ep) {
                    changes.push(InstanceChange::Removed(inst.clone()));
                }
            }
            let count_changed = old.len() != new.len();
            // Keep node ids already resolved on unchanged instances.
            rec.locations = new
                .into_values()
                .map(|mut i| {
                    if i.node.is_none() {
                        i.node = old.get(&i.endpoint).and_then(|o| o.node);
                    }
                    i
                })
                .collect();
            if !changes.is_empty() || count_changed {
                diff.touched.push(name.clone());
            }
            if !changes.is_empty() {
                diff.changes.insert(name, changes);
            }
        }
        if scope.is_none() {
            self.placement_loaded = true;
        }
        if !diff.touched.is_empty() {
            self.dirty = true;
        }
        diff
    }

    /// Index rows, name order.
    pub fn index(&self) -> Vec<AppIndexEntry> {
        self.records.values().map(index_entry).collect()
    }
}

/// App index row of a record.
pub fn index_entry(r: &AppRecord) -> AppIndexEntry {
    AppIndexEntry {
        name: r.name.clone(),
        display_name: r.display_name.clone(),
        owner: r.spec.owner.clone(),
        spec_version: r.spec.spec_version,
        instances_target: r.spec.instances,
        instances_running: r.locations.len() as u32,
        component_count: r.spec.components.len() as u32,
        enterprise: r.spec.enterprise,
        per_instance: r.spec.per_instance(),
        totals: r.totals,
        height: r.height,
        expire_height: r.expire_height,
    }
}

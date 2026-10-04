//! [`FleetLedger`]: confirmed nodes per payment address and tier at the end of every UTC day
//! the stored keyframes cover (the wallet view's `fleet_history`).
//!
//! Keyframes record node ids, not payment addresses, so the ids are mapped through the stored
//! node records (departed ones included). One keyframe per day is read: the last of the day.
//! Counts are kept as change points per address, so a year of a few thousand operators stays
//! small (most fleets change on a handful of days).

use std::collections::{BTreeMap, HashMap};

use atlas_core::NodeStatus;
use atlas_core::api::FleetDay;
use atlas_store::Store;
use compact_str::CompactString;

use crate::error::ApiError;

const DAY_MS: u64 = 86_400_000;

/// Daily fleet sizes by address (see the module docs).
#[derive(Debug, Default)]
pub struct FleetLedger {
    /// The UTC days with a keyframe, ascending.
    days: Vec<u64>,
    /// Per address: `(index into days, [cumulus, nimbus, stratus])` whenever the counts change
    /// (a zero row when the address had no confirmed node any more).
    changes: HashMap<CompactString, Vec<(u32, [u32; 3])>>,
}

impl FleetLedger {
    /// Reads the last keyframe of every stored day.
    pub fn build(st: &Store) -> Result<Self, ApiError> {
        let mut last_of_day: BTreeMap<u64, u64> = BTreeMap::new();
        for ts in st.snapshot_times()? {
            let e = last_of_day.entry(ts / DAY_MS * DAY_MS).or_default();
            *e = (*e).max(ts);
        }
        if last_of_day.is_empty() {
            return Ok(Self::default());
        }
        let address: HashMap<u32, CompactString> = st
            .nodes()?
            .into_iter()
            .filter(|n| !n.payment_address.is_empty())
            .map(|n| (n.id.0, n.payment_address))
            .collect();
        let mut rows: Vec<(u64, HashMap<CompactString, [u32; 3]>)> = Vec::new();
        for (&day, &ts) in &last_of_day {
            let Some((_, nodes)) = atlas_engine::timemachine::keyframe_nodes(st, ts)? else {
                continue;
            };
            let mut counts: HashMap<CompactString, [u32; 3]> = HashMap::new();
            for n in nodes.iter().filter(|n| n.status == NodeStatus::Confirmed) {
                let (Some(t), Some(a)) = (n.tier.index(), address.get(&n.id.0)) else {
                    continue;
                };
                counts.entry(a.clone()).or_default()[t] += 1;
            }
            rows.push((day, counts));
        }
        Ok(Self::from_days(rows))
    }

    /// Builds the change points from per-day counts (ascending days).
    pub fn from_days(rows: Vec<(u64, HashMap<CompactString, [u32; 3]>)>) -> Self {
        let mut days = Vec::with_capacity(rows.len());
        let mut changes: HashMap<CompactString, Vec<(u32, [u32; 3])>> = HashMap::new();
        let mut prev: HashMap<CompactString, [u32; 3]> = HashMap::new();
        for (i, (day, counts)) in rows.into_iter().enumerate() {
            days.push(day);
            let i = i as u32;
            for (a, c) in &counts {
                if prev.get(a) != Some(c) {
                    changes.entry(a.clone()).or_default().push((i, *c));
                }
            }
            for a in prev.keys() {
                if !counts.contains_key(a) {
                    changes.entry(a.clone()).or_default().push((i, [0; 3]));
                }
            }
            prev = counts;
        }
        Self { days, changes }
    }

    /// The UTC days covered.
    pub fn day_count(&self) -> usize {
        self.days.len()
    }

    /// Daily counts of `address` from the first stored day, oldest first (zeros before the
    /// address had confirmed nodes).
    pub fn history(&self, address: &str) -> Vec<FleetDay> {
        let points = self.changes.get(address).map_or(&[][..], Vec::as_slice);
        let mut cur = [0u32; 3];
        let mut next = 0usize;
        self.days
            .iter()
            .enumerate()
            .map(|(i, &day_ms)| {
                while next < points.len() && points[next].0 as usize <= i {
                    cur = points[next].1;
                    next += 1;
                }
                FleetDay {
                    day_ms,
                    cumulus: cur[0],
                    nimbus: cur[1],
                    stratus: cur[2],
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_points_expand_to_days() {
        let day = |d: u64, rows: &[(&str, [u32; 3])]| {
            (
                d * DAY_MS,
                rows.iter()
                    .map(|(a, c)| (CompactString::from(*a), *c))
                    .collect::<HashMap<_, _>>(),
            )
        };
        let l = FleetLedger::from_days(vec![
            day(1, &[("A", [0, 0, 2])]),
            day(2, &[("A", [0, 0, 2]), ("B", [1, 0, 0])]),
            day(3, &[("A", [0, 1, 2])]),
            day(5, &[("A", [0, 1, 2]), ("B", [2, 0, 0])]),
        ]);
        assert_eq!(l.day_count(), 4);
        let a = l.history("A");
        assert_eq!(a.len(), 4);
        assert_eq!((a[0].stratus, a[0].nimbus), (2, 0));
        assert_eq!((a[2].stratus, a[2].nimbus), (2, 1));
        assert_eq!(a[3].day_ms, 5 * DAY_MS);
        let b = l.history("B");
        assert_eq!(
            b.iter().map(|d| d.cumulus).collect::<Vec<_>>(),
            [0, 1, 0, 2],
            "a day without the address is a zero"
        );
        assert!(
            l.history("nobody")
                .iter()
                .all(|d| d.cumulus + d.nimbus + d.stratus == 0)
        );
        assert_eq!(l.changes["A"].len(), 2, "unchanged days are not stored");
    }
}

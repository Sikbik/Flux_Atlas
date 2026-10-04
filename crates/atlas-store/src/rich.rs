//! Rich-list history (`rich_snapshots`): the explorer's top 1,000 addresses once per UTC day,
//! for the rich-list movers. Kept [`crate::HistoryRetention::rich_snapshots_ms`] (400 days) and
//! pruned oldest-first with the other history by the disk budget guard.

use crate::codec;
use crate::error::Result;
use crate::records::{RICH_SNAPSHOT_FORMAT_VERSION, RichSnapshot};
use crate::store::Store;
use crate::tables;

impl Store {
    /// Days (UTC day start, unix ms) with a stored rich list, ascending.
    pub fn rich_snapshot_days(&self) -> Result<Vec<u64>> {
        self.read(|txn| {
            let t = txn.open_table(tables::RICH_SNAPSHOTS)?;
            let mut out = Vec::new();
            for item in t.range::<u64>(..)? {
                out.push(item?.0.value());
            }
            Ok(out)
        })
    }

    /// The rich list stored for the UTC day starting at `day_ms`.
    pub fn rich_snapshot(&self, day_ms: u64) -> Result<Option<RichSnapshot>> {
        self.read(|txn| {
            let t = txn.open_table(tables::RICH_SNAPSHOTS)?;
            t.get(day_ms)?
                .map(|v| codec::decode_blob(v.value(), RICH_SNAPSHOT_FORMAT_VERSION))
                .transpose()
        })
    }

    /// Calls `f` with every stored rich list, oldest first, decoding one at a time (a year of
    /// them would be about 50 MB decoded at once).
    pub fn for_each_rich_snapshot(
        &self,
        mut f: impl FnMut(RichSnapshot) -> Result<()>,
    ) -> Result<()> {
        self.read(|txn| {
            let t = txn.open_table(tables::RICH_SNAPSHOTS)?;
            for item in t.range::<u64>(..)? {
                let (_, v) = item?;
                f(codec::decode_blob(v.value(), RICH_SNAPSHOT_FORMAT_VERSION)?)?;
            }
            Ok(())
        })
    }

    /// Deletes the rich lists of days before `before_ms`. Returns rows removed.
    pub fn prune_rich_snapshots_before(&self, before_ms: u64) -> Result<u64> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::RICH_SNAPSHOTS)?;
            let mut n = 0;
            t.retain_in(..before_ms, |_, _| {
                n += 1;
                false
            })?;
            Ok(n)
        })
    }
}

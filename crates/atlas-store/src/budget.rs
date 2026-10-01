//! Disk budget (ARCHITECTURE section 5): age-based retention tiers for the history tables, and
//! a guard that prunes oldest-first when the database file nears its budget.
//!
//! Two mechanisms keep the file bounded:
//!
//! 1. **Retention tiers** ([`HistoryRetention`]): every history table has an age limit that the
//!    hourly maintenance applies. With today's rates these alone level the database off far
//!    below the budget. redb reuses the pages pruning frees, so the file stops growing once
//!    pruning keeps pace with ingest; compaction only gives the slack back to the filesystem.
//! 2. **The budget guard** ([`Store::enforce_budget`]): when the file reaches the high-water
//!    mark, it measures the live data (a full page walk) and either compacts (the file is mostly
//!    slack) or deletes the oldest day of every history table (thinning `chain_points` to its
//!    sample grid), repeatedly, until the estimated
//!    live data is under the low-water mark, then compacts. It never prunes the newest
//!    [`DiskBudget::min_history_ms`] of history, and never touches current state (nodes, apps,
//!    mesh, meta).

use std::collections::BTreeMap;

use redb::{ReadableTable, ReadableTableMetadata, WriteTransaction};

use atlas_core::chain::{BlockSummary, NodeTx};
use atlas_core::emission::{PON_ACTIVATION_HEIGHT, PON_TARGET_SPACING_S};

use crate::codec;
use crate::error::Result;
use crate::records::DAY_MS;
use crate::stats::DbStats;
use crate::store::Store;
use crate::tables;

/// Default disk budget for the database file (MiB, `ATLAS_DISK_BUDGET_MB`). The Flux app gets a
/// 10 GiB volume (about 9.5 GiB usable after ext4 overhead); the budget leaves over 3 GiB of
/// headroom for redb's copy-on-write pages between commits, growth steps and compaction.
pub const DEFAULT_DISK_BUDGET_MB: u64 = 6 * 1024;

/// Block spacing before Proof of Node (seconds).
const PRE_PON_SPACING_S: u64 = 120;

/// Age limits of the history tables (`None` keeps rows until the disk budget needs the space).
/// The event tables (`events`, `node_events`, `mesh_events`) keep their own limits in the
/// engine configuration, and `snapshots` are thinned to one per day after 30 days by
/// [`crate::RetentionPolicy`]; `keyframes_ms` bounds those daily keyframes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryRetention {
    /// `blocks`, `block_hash`, `block_payouts`: the explorer's block list, producer and payout
    /// views (older blocks are proxied from upstream on demand).
    pub blocks_ms: Option<u64>,
    /// `payments`: node payment history (node inspector, operator earnings).
    pub payments_ms: Option<u64>,
    /// `node_txs`, `node_txs_by_node`: confirm/start history (heartbeat timeline, lifecycle).
    pub node_txs_ms: Option<u64>,
    /// Daily `snapshots` keyframes (time machine).
    pub keyframes_ms: Option<u64>,
    /// `app_messages`, `app_messages_by_app`: app spec history (six years from the bootstrap
    /// backfill, growing by tens of messages a day).
    pub app_messages_ms: Option<u64>,
    /// `app_events`: app timelines.
    pub app_events_ms: Option<u64>,
    /// `chain_points` off the sample grid: per-block time and difficulty (the 24 h to 30 d
    /// chain-history windows). Older history keeps the grid rows only.
    pub chain_blocks_ms: Option<u64>,
}

impl Default for HistoryRetention {
    fn default() -> Self {
        Self {
            blocks_ms: Some(365 * DAY_MS),
            payments_ms: Some(730 * DAY_MS),
            node_txs_ms: Some(90 * DAY_MS),
            keyframes_ms: Some(365 * DAY_MS),
            app_messages_ms: None,
            app_events_ms: None,
            chain_blocks_ms: Some(31 * DAY_MS),
        }
    }
}

/// The disk budget of the database file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DiskBudget {
    pub budget_bytes: u64,
    /// The guard acts once the file reaches this fraction of the budget.
    pub high_water: f64,
    /// Pruning stops once the estimated live data is under this fraction of the budget.
    pub low_water: f64,
    /// The newest history the guard never prunes.
    pub min_history_ms: u64,
    /// History removed per pruning step (oldest first).
    pub step_ms: u64,
}

impl Default for DiskBudget {
    fn default() -> Self {
        Self::from_mb(DEFAULT_DISK_BUDGET_MB)
    }
}

impl DiskBudget {
    /// A budget of `mb` MiB with the default marks (90% high, 75% low, 7 days kept, 1-day steps).
    pub fn from_mb(mb: u64) -> Self {
        Self {
            budget_bytes: mb.max(1) << 20,
            high_water: 0.90,
            low_water: 0.75,
            min_history_ms: 7 * DAY_MS,
            step_ms: DAY_MS,
        }
    }

    pub fn high_bytes(&self) -> u64 {
        (self.budget_bytes as f64 * self.high_water) as u64
    }

    pub fn low_bytes(&self) -> u64 {
        (self.budget_bytes as f64 * self.low_water) as u64
    }

    /// What the guard should do with a file of `used` bytes holding `live` bytes of table
    /// pages (`live` is only measured once `used` crosses the high-water mark).
    pub fn assess(&self, used: u64, live: Option<u64>) -> Pressure {
        if used < self.high_bytes() {
            return Pressure::Below;
        }
        match live {
            None => Pressure::Measure,
            Some(live) if live <= self.low_bytes() => Pressure::Compact,
            Some(live) => Pressure::Prune {
                free_bytes: live - self.low_bytes(),
            },
        }
    }
}

/// The guard's verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pressure {
    /// Under the high-water mark: nothing to do.
    Below,
    /// Over the high-water mark: measure the live data first.
    Measure,
    /// The file is mostly slack: compaction alone brings it back under the budget.
    Compact,
    /// Delete about this many bytes of the oldest history, then compact.
    Prune { free_bytes: u64 },
}

/// What the guard prunes, oldest first. [`Store`] implements it over the history tables; tests
/// substitute a model.
pub trait History {
    /// Timestamp (unix ms) of the oldest row in any budgeted table.
    fn oldest_ms(&mut self) -> Result<Option<u64>>;
    /// Deletes every budgeted row older than `before_ms`. Returns rows removed per table.
    fn prune_before(&mut self, before_ms: u64) -> Result<Vec<(&'static str, u64)>>;
}

/// What a pruning run did.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PruneOutcome {
    /// History older than this is gone (the last step's cutoff).
    pub floor_ms: Option<u64>,
    /// Estimated bytes freed (rows removed times each table's average row size).
    pub freed_estimate: u64,
    /// Rows removed per table.
    pub rows: BTreeMap<&'static str, u64>,
    pub steps: u32,
    /// Stopped at [`DiskBudget::min_history_ms`] before freeing enough: the budget is too small
    /// for the minimum history.
    pub hit_min_history: bool,
}

/// Deletes the oldest history one step at a time until about `need_bytes` are freed, never
/// cutting into the newest `budget.min_history_ms`. `bytes_per_row` estimates what each
/// removed row frees (from [`DbStats`]).
pub fn prune_oldest_first(
    history: &mut impl History,
    need_bytes: u64,
    bytes_per_row: &BTreeMap<String, f64>,
    now_ms: u64,
    budget: &DiskBudget,
) -> Result<PruneOutcome> {
    let limit = now_ms.saturating_sub(budget.min_history_ms);
    let step = budget.step_ms.max(1);
    let mut out = PruneOutcome::default();
    let mut last_cut = 0;
    while out.freed_estimate < need_bytes {
        let Some(oldest) = history.oldest_ms()? else {
            break;
        };
        if oldest >= limit {
            out.hit_min_history = true;
            break;
        }
        // Always move forward, even if a table reports an oldest row the last cut should have
        // removed (it then gets removed by this larger cut).
        let cut = oldest.saturating_add(step).max(last_cut + step).min(limit);
        let removed = history.prune_before(cut)?;
        for (table, rows) in removed {
            let bpr = bytes_per_row.get(table).copied().unwrap_or(0.0);
            out.freed_estimate += (rows as f64 * bpr) as u64;
            *out.rows.entry(table).or_default() += rows;
        }
        out.steps += 1;
        out.floor_ms = Some(cut);
        last_cut = cut;
        if cut >= limit {
            out.hit_min_history = out.freed_estimate < need_bytes;
            break;
        }
    }
    Ok(out)
}

/// What [`Store::enforce_budget`] found and did.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BudgetReport {
    pub budget_bytes: u64,
    pub used_before: u64,
    /// Bytes in table pages, when the guard measured them.
    pub live_before: Option<u64>,
    /// `"ok"`, `"compacted"` or `"pruned"`.
    pub action: &'static str,
    pub pruned: Option<PruneOutcome>,
    pub compacted: bool,
    pub used_after: u64,
}

/// Rows removed by an age-based retention pass, per table.
pub type PruneCounts = Vec<(&'static str, u64)>;

/// Estimated time of a block height, anchored on a known `(height, time_ms)` (the newest
/// stored block). Heights before Proof of Node had 2-minute spacing.
fn height_time(anchor: (u32, u64), height: u32) -> u64 {
    let (ah, at) = anchor;
    if height >= ah {
        return at + u64::from(height - ah) * u64::from(PON_TARGET_SPACING_S) * 1000;
    }
    let pon = PON_ACTIVATION_HEIGHT;
    let blocks_pon = u64::from(ah.max(pon) - height.max(pon));
    let blocks_pre = u64::from(ah.min(pon).saturating_sub(height));
    at.saturating_sub(
        (blocks_pon * u64::from(PON_TARGET_SPACING_S) + blocks_pre * PRE_PON_SPACING_S) * 1000,
    )
}

/// The first height whose estimated time is at or after `ts_ms` (inverse of [`height_time`]).
fn height_at(anchor: (u32, u64), ts_ms: u64) -> u32 {
    let (ah, at) = anchor;
    if ts_ms >= at {
        return ah;
    }
    let back_s = (at - ts_ms) / 1000;
    let pon = u64::from(PON_ACTIVATION_HEIGHT);
    let pon_span_s = u64::from(ah).saturating_sub(pon) * u64::from(PON_TARGET_SPACING_S);
    let h = if back_s <= pon_span_s {
        u64::from(ah) - back_s / u64::from(PON_TARGET_SPACING_S)
    } else {
        let pre = (back_s - pon_span_s) / PRE_PON_SPACING_S;
        pon.min(u64::from(ah)).saturating_sub(pre)
    };
    h as u32
}

impl Store {
    /// `(height, time)` of the newest stored block, the anchor for height and time estimates.
    fn block_anchor(&self) -> Result<Option<(u32, u64)>> {
        Ok(self.tip_block()?.map(|b| (b.height, b.time_ms)))
    }

    /// Applies the age limits of `retention` at `now_ms`. Returns rows removed per table.
    pub fn prune_history(&self, now_ms: u64, retention: &HistoryRetention) -> Result<PruneCounts> {
        let cut = |age: Option<u64>| age.map(|a| now_ms.saturating_sub(a));
        let mut out = Vec::new();
        let anchor = self.block_anchor()?;
        if let (Some(c), Some(a)) = (cut(retention.blocks_ms), anchor) {
            out.extend(self.prune_blocks_before(height_at(a, c))?);
        }
        if let (Some(c), Some(a)) = (cut(retention.payments_ms), anchor) {
            out.push(("payments", self.prune_payments_before(height_at(a, c))?));
        }
        if let (Some(c), Some(a)) = (cut(retention.node_txs_ms), anchor) {
            out.extend(self.prune_node_txs_before(height_at(a, c))?);
        }
        if let Some(c) = cut(retention.keyframes_ms) {
            out.push(("snapshots", self.prune_snapshots_before(c)?));
        }
        if let (Some(c), Some(a)) = (cut(retention.app_messages_ms), anchor) {
            out.extend(self.prune_app_messages_before(height_at(a, c))?);
        }
        if let Some(c) = cut(retention.app_events_ms) {
            out.push(("app_events", self.prune_app_events_before(c)?));
        }
        if let Some(c) = cut(retention.chain_blocks_ms) {
            out.push(("chain_points", self.thin_chain_points_before(c)?));
        }
        out.retain(|(_, n)| *n > 0);
        Ok(out)
    }

    /// Deletes blocks below `height` with their `block_hash` and `block_payouts` rows
    /// (`payments` and `node_txs` have their own tiers).
    pub fn prune_blocks_before(&self, height: u32) -> Result<PruneCounts> {
        self.write(|txn| {
            let mut blocks = txn.open_table(tables::BLOCKS)?;
            let mut hashes = txn.open_table(tables::BLOCK_HASH)?;
            let mut payouts = txn.open_table(tables::BLOCK_PAYOUTS)?;
            let mut doomed = Vec::new();
            for item in blocks.range(..height)? {
                let (k, v) = item?;
                let b: BlockSummary = codec::decode(v.value())?;
                doomed.push((k.value(), b.hash));
            }
            let mut n_hash = 0;
            for (h, hash) in &doomed {
                if hashes.get(&hash.0)?.is_some_and(|g| g.value() == *h) {
                    hashes.remove(&hash.0)?;
                    n_hash += 1;
                }
            }
            let mut n_pay = 0;
            payouts.retain_in(..(height, 0u8), |_, _| {
                n_pay += 1;
                false
            })?;
            blocks.retain_in(..height, |_, _| false)?;
            Ok(vec![
                ("blocks", doomed.len() as u64),
                ("block_hash", n_hash),
                ("block_payouts", n_pay),
            ])
        })
    }

    /// Deletes `payments` rows below `height` (one range per known node id).
    pub fn prune_payments_before(&self, height: u32) -> Result<u64> {
        self.write(|txn| {
            let ids = node_ids(txn)?;
            let mut t = txn.open_table(tables::PAYMENTS)?;
            let mut n = 0;
            for id in ids {
                t.retain_in((id, 0u32)..(id, height), |_, _| {
                    n += 1;
                    false
                })?;
            }
            Ok(n)
        })
    }

    /// Deletes `node_txs` below `height` and their `node_txs_by_node` index rows.
    pub fn prune_node_txs_before(&self, height: u32) -> Result<PruneCounts> {
        self.write(|txn| {
            let mut txs = txn.open_table(tables::NODE_TXS)?;
            let mut idx = txn.open_table(tables::NODE_TXS_BY_NODE)?;
            let mut doomed = Vec::new();
            for item in txs.range(..(height, 0u16))? {
                let (k, v) = item?;
                let tx: NodeTx = codec::decode(v.value())?;
                doomed.push((k.value(), tx.node));
            }
            let mut n_idx = 0;
            for ((h, i), node) in &doomed {
                if let Some(node) = node
                    && idx.remove((node.0, *h, *i))?.is_some()
                {
                    n_idx += 1;
                }
            }
            txs.retain_in(..(height, 0u16), |_, _| false)?;
            Ok(vec![
                ("node_txs", doomed.len() as u64),
                ("node_txs_by_node", n_idx),
            ])
        })
    }

    /// Deletes snapshots (keyframes) older than `before_ms`.
    pub fn prune_snapshots_before(&self, before_ms: u64) -> Result<u64> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::SNAPSHOTS)?;
            let mut n = 0;
            t.retain_in(..before_ms, |_, _| {
                n += 1;
                false
            })?;
            Ok(n)
        })
    }

    /// Deletes app messages mined below `height` (both tables). Scans the index keys.
    pub fn prune_app_messages_before(&self, height: u32) -> Result<PruneCounts> {
        self.write(|txn| {
            let mut idx = txn.open_table(tables::APP_MESSAGES_BY_APP)?;
            let mut msgs = txn.open_table(tables::APP_MESSAGES)?;
            let mut doomed: Vec<(String, u32, [u8; 32])> = Vec::new();
            for item in idx.range::<(&str, u32, &[u8; 32])>(..)? {
                let (k, _) = item?;
                let (name, h, hash) = k.value();
                if h < height {
                    doomed.push((name.to_owned(), h, *hash));
                }
            }
            let mut n_msg = 0;
            for (name, h, hash) in &doomed {
                idx.remove((name.as_str(), *h, hash))?;
                if msgs.remove(hash)?.is_some() {
                    n_msg += 1;
                }
            }
            Ok(vec![
                ("app_messages", n_msg),
                ("app_messages_by_app", doomed.len() as u64),
            ])
        })
    }

    /// Deletes app events observed before `before_ms` (scans the keys).
    pub fn prune_app_events_before(&self, before_ms: u64) -> Result<u64> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::APP_EVENTS)?;
            let mut n = 0;
            t.retain(|k, _| {
                let keep = k.1 >= before_ms;
                if !keep {
                    n += 1;
                }
                keep
            })?;
            Ok(n)
        })
    }

    /// Oldest timestamp across the budgeted history tables (estimated from heights for the
    /// block-keyed ones).
    fn oldest_history_ms(&self) -> Result<Option<u64>> {
        let anchor = self.block_anchor()?;
        self.read(|txn| {
            let mut oldest: Option<u64> = None;
            let mut see = |t: u64| oldest = Some(oldest.map_or(t, |o| o.min(t)));
            if let Some((k, _)) = txn.open_table(tables::EVENTS)?.first()? {
                see(k.value().0);
            }
            if let Some((k, _)) = txn.open_table(tables::MESH_EVENTS)?.first()? {
                see(k.value().0);
            }
            if let Some((k, _)) = txn.open_table(tables::SNAPSHOTS)?.first()? {
                see(k.value());
            }
            if let Some((_, v)) = txn.open_table(tables::BLOCKS)?.first()? {
                let b: BlockSummary = codec::decode(v.value())?;
                see(b.time_ms);
            }
            if let Some(a) = anchor {
                if let Some((k, _)) = txn.open_table(tables::NODE_TXS)?.first()? {
                    see(height_time(a, k.value().0));
                }
                let ids = {
                    let rev = txn.open_table(tables::NODE_IDS_REV)?;
                    let mut v = Vec::new();
                    for item in rev.range::<u32>(..)? {
                        v.push(item?.0.value());
                    }
                    v
                };
                let pay = txn.open_table(tables::PAYMENTS)?;
                let ev = txn.open_table(tables::NODE_EVENTS)?;
                for id in ids {
                    if let Some(item) = pay.range((id, 0u32)..=(id, u32::MAX))?.next() {
                        see(height_time(a, item?.0.value().1));
                    }
                    if let Some(item) = ev
                        .range((id, 0u64, 0u64)..=(id, u64::MAX, u64::MAX))?
                        .next()
                    {
                        see(item?.0.value().1);
                    }
                }
                let idx = txn.open_table(tables::APP_MESSAGES_BY_APP)?;
                let mut min_h = None::<u32>;
                for item in idx.range::<(&str, u32, &[u8; 32])>(..)? {
                    let h = item?.0.value().1;
                    min_h = Some(min_h.map_or(h, |m| m.min(h)));
                }
                if let Some(h) = min_h {
                    see(height_time(a, h));
                }
            }
            let app_events = txn.open_table(tables::APP_EVENTS)?;
            if app_events.len()? > 0 {
                for item in app_events.range::<(&str, u64, u64)>(..)? {
                    see(item?.0.value().1);
                }
            }
            Ok(oldest)
        })
    }

    /// Deletes every budgeted history row older than `before_ms` (all tiers at once).
    fn prune_all_before(&self, before_ms: u64) -> Result<PruneCounts> {
        let mut out = Vec::new();
        let (e, ne, me) = self.prune_events(before_ms, before_ms, before_ms)?;
        out.push(("events", e as u64));
        out.push(("node_events", ne as u64));
        out.push(("mesh_events", me as u64));
        out.push(("snapshots", self.prune_snapshots_before(before_ms)?));
        out.push(("app_events", self.prune_app_events_before(before_ms)?));
        // The sample grid stays: it is the whole chain's history in a few hundred kilobytes.
        out.push(("chain_points", self.thin_chain_points_before(before_ms)?));
        if let Some(a) = self.block_anchor()? {
            let h = height_at(a, before_ms);
            out.extend(self.prune_blocks_before(h)?);
            out.push(("payments", self.prune_payments_before(h)?));
            out.extend(self.prune_node_txs_before(h)?);
            out.extend(self.prune_app_messages_before(h)?);
        }
        Ok(out)
    }

    /// Runs the disk budget guard at `now_ms` (see the module docs). Call it from a blocking
    /// context: the page walk, pruning and compaction can take seconds on a large file.
    pub fn enforce_budget(&self, now_ms: u64, budget: &DiskBudget) -> Result<BudgetReport> {
        let used_before = self.file_usage()?.used_bytes();
        let mut report = BudgetReport {
            budget_bytes: budget.budget_bytes,
            used_before,
            action: "ok",
            used_after: used_before,
            ..BudgetReport::default()
        };
        if budget.assess(used_before, None) == Pressure::Below {
            return Ok(report);
        }
        let stats = self.db_stats()?;
        report.live_before = Some(stats.tables_bytes());
        match budget.assess(used_before, Some(stats.tables_bytes())) {
            Pressure::Below | Pressure::Measure => return Ok(report),
            Pressure::Compact => report.action = "compacted",
            Pressure::Prune { free_bytes } => {
                let bpr = bytes_per_row(&stats);
                let mut h = StoreHistory(self);
                let outcome = prune_oldest_first(&mut h, free_bytes, &bpr, now_ms, budget)?;
                if outcome.hit_min_history {
                    tracing::error!(
                        budget_mb = budget.budget_bytes >> 20,
                        min_history_days = budget.min_history_ms / DAY_MS,
                        "disk budget too small for the minimum history; raise ATLAS_DISK_BUDGET_MB"
                    );
                }
                report.action = "pruned";
                report.pruned = Some(outcome);
            }
        }
        report.compacted = self.compact()?;
        report.used_after = self.file_usage()?.used_bytes();
        tracing::warn!(?report, "disk budget guard acted");
        Ok(report)
    }
}

/// Average bytes per row of every table.
pub fn bytes_per_row(stats: &DbStats) -> BTreeMap<String, f64> {
    stats
        .tables
        .iter()
        .map(|t| (t.name.clone(), t.bytes_per_row()))
        .collect()
}

/// The store's history tables as a [`History`].
struct StoreHistory<'a>(&'a Store);

impl History for StoreHistory<'_> {
    fn oldest_ms(&mut self) -> Result<Option<u64>> {
        self.0.oldest_history_ms()
    }

    fn prune_before(&mut self, before_ms: u64) -> Result<Vec<(&'static str, u64)>> {
        self.0.prune_all_before(before_ms)
    }
}

/// Every interned node id.
fn node_ids(txn: &WriteTransaction) -> Result<Vec<u32>> {
    let rev = txn.open_table(tables::NODE_IDS_REV)?;
    let mut v = Vec::new();
    for item in rev.range::<u32>(..)? {
        v.push(item?.0.value());
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_and_assessment() {
        let b = DiskBudget::from_mb(1000);
        assert_eq!(b.budget_bytes, 1000 << 20);
        assert_eq!(b.high_bytes(), (1000u64 << 20) * 9 / 10);
        assert_eq!(b.assess(b.high_bytes() - 1, None), Pressure::Below);
        assert_eq!(b.assess(b.high_bytes(), None), Pressure::Measure);
        // Mostly slack: compaction is enough.
        assert_eq!(
            b.assess(b.high_bytes(), Some(b.low_bytes())),
            Pressure::Compact
        );
        // Live data over the low-water mark: prune the difference.
        assert_eq!(
            b.assess(b.budget_bytes * 2, Some(b.low_bytes() + 123)),
            Pressure::Prune { free_bytes: 123 }
        );
        // Below the high-water mark the live size is irrelevant.
        assert_eq!(b.assess(0, Some(u64::MAX)), Pressure::Below);
    }

    #[test]
    fn default_budget_fits_a_10_gb_volume() {
        let b = DiskBudget::default();
        // FluxOS sizes the volume in GiB (`hdd: 10`); ext4 metadata takes a few percent.
        let volume = (10u64 << 30) * 95 / 100;
        assert!(
            volume - b.budget_bytes >= 3 << 30,
            "keep at least 3 GiB of the volume as headroom"
        );
        assert!(b.budget_bytes >= 4 << 30, "room for a year of history");
        assert!(b.low_bytes() < b.high_bytes() && b.high_bytes() < b.budget_bytes);
    }

    #[test]
    fn heights_and_times_round_trip() {
        let anchor = (3_000_000, 1_790_000_000_000);
        for h in [2_999_000u32, 2_500_000, 2_020_000, 2_019_000, 1_000_000] {
            let t = height_time(anchor, h);
            assert_eq!(height_at(anchor, t), h, "height {h}");
        }
        // 30 s per block after PoN, 120 s before.
        assert_eq!(height_time(anchor, 2_999_000), anchor.1 - 1000 * 30 * 1000);
        let pon_t = height_time(anchor, PON_ACTIVATION_HEIGHT);
        assert_eq!(
            height_time(anchor, PON_ACTIVATION_HEIGHT - 10),
            pon_t - 10 * 120 * 1000
        );
        // Times at or after the anchor map to the anchor.
        assert_eq!(height_at(anchor, anchor.1 + 5), anchor.0);
    }

    /// A model history: rows per table per day, oldest first.
    struct Model {
        /// (day start ms, table, rows)
        rows: Vec<(u64, &'static str, u64)>,
        calls: Vec<u64>,
    }

    impl History for Model {
        fn oldest_ms(&mut self) -> Result<Option<u64>> {
            Ok(self.rows.iter().map(|r| r.0).min())
        }
        fn prune_before(&mut self, before_ms: u64) -> Result<Vec<(&'static str, u64)>> {
            self.calls.push(before_ms);
            let mut out: BTreeMap<&'static str, u64> = BTreeMap::new();
            self.rows.retain(|(t, table, n)| {
                if *t < before_ms {
                    *out.entry(*table).or_default() += *n;
                    false
                } else {
                    true
                }
            });
            Ok(out.into_iter().collect())
        }
    }

    fn model(days: u64, now: u64) -> Model {
        let mut rows = Vec::new();
        for d in 0..days {
            let t = now - (days - d) * DAY_MS;
            rows.push((t, "node_txs", 1000));
            rows.push((t, "blocks", 100));
        }
        Model {
            rows,
            calls: Vec::new(),
        }
    }

    #[test]
    fn prunes_oldest_first_until_enough_is_freed() {
        let now = 400 * DAY_MS;
        let mut m = model(60, now);
        let bpr: BTreeMap<String, f64> =
            [("node_txs".to_owned(), 10.0), ("blocks".to_owned(), 100.0)].into();
        // Each day frees 1000 * 10 + 100 * 100 = 20,000 bytes: three days for 50,000.
        let out = prune_oldest_first(&mut m, 50_000, &bpr, now, &DiskBudget::from_mb(1)).unwrap();
        assert_eq!(out.steps, 3);
        assert_eq!(out.freed_estimate, 60_000);
        assert_eq!(out.rows["node_txs"], 3000);
        assert_eq!(out.rows["blocks"], 300);
        assert!(!out.hit_min_history);
        // The oldest three days went, nothing newer.
        let oldest_left = m.rows.iter().map(|r| r.0).min().unwrap();
        assert_eq!(oldest_left, now - 57 * DAY_MS);
        // Cuts strictly increase.
        assert!(m.calls.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn never_cuts_into_the_minimum_history() {
        let now = 400 * DAY_MS;
        let mut m = model(30, now);
        let bpr: BTreeMap<String, f64> = [("node_txs".to_owned(), 10.0)].into();
        let b = DiskBudget::from_mb(1);
        let out = prune_oldest_first(&mut m, u64::MAX, &bpr, now, &b).unwrap();
        assert!(out.hit_min_history);
        assert_eq!(out.floor_ms, Some(now - b.min_history_ms));
        // The newest seven days survive.
        assert_eq!(m.rows.len(), 7 * 2);
        assert!(m.rows.iter().all(|r| r.0 >= now - b.min_history_ms));
    }

    #[test]
    fn jumps_over_gaps_and_stops_when_empty() {
        let now = 4000 * DAY_MS;
        // One very old row (years back) and recent history: the first step jumps to it.
        let mut m = Model {
            rows: vec![
                (10 * DAY_MS, "app_messages", 5),
                (now - 20 * DAY_MS, "blocks", 10),
            ],
            calls: Vec::new(),
        };
        let bpr: BTreeMap<String, f64> =
            [("app_messages".to_owned(), 1.0), ("blocks".to_owned(), 1.0)].into();
        let out = prune_oldest_first(&mut m, 12, &bpr, now, &DiskBudget::from_mb(1)).unwrap();
        assert_eq!(out.steps, 2);
        assert_eq!(m.calls[0], 11 * DAY_MS);
        assert_eq!(m.calls[1], now - 19 * DAY_MS);
        assert!(m.rows.is_empty());
        // Nothing left: a further run stops at once.
        let out = prune_oldest_first(&mut m, 1, &bpr, now, &DiskBudget::from_mb(1)).unwrap();
        assert_eq!(out.steps, 0);
        assert!(!out.hit_min_history);
    }
}

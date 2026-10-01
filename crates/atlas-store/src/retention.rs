//! Retention and maintenance: metrics pruning and hourly rollup, snapshot thinning, pending
//! message expiry, geo cache TTL. Each helper runs in its own immediate write transaction.

use redb::{ReadableTable, WriteTransaction};

use atlas_core::app::PendingAppMessage;
use atlas_core::node::Geo;

use crate::codec;
use crate::error::Result;
use crate::records::{DAY_MS, HOUR_MS, MetricsRow, Resolution};
use crate::store::{Store, read_meta_u64};
use crate::tables::{self, meta_keys};

/// Retention windows used by [`Store::run_retention`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// Keep `metrics_1m` rows this long (default 30 days). `metrics_1h` is kept forever.
    pub metrics_1m_ms: u64,
    /// Keep every snapshot this long (default 30 days); older ones are thinned to the first
    /// snapshot of each UTC day.
    pub snapshots_all_ms: u64,
    /// Geo cache entries older than this are dropped (default 7 days).
    pub geo_ttl_ms: u64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            metrics_1m_ms: 30 * DAY_MS,
            snapshots_all_ms: 30 * DAY_MS,
            geo_ttl_ms: 7 * DAY_MS,
        }
    }
}

/// What [`Store::run_retention`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RetentionReport {
    /// Hour rows written by the rollup.
    pub hours_rolled_up: usize,
    /// `metrics_1m` rows deleted.
    pub metrics_1m_pruned: usize,
    /// Snapshots deleted by daily thinning.
    pub snapshots_thinned: usize,
    /// Expired pending app messages deleted.
    pub pending_pruned: usize,
    /// Stale geo cache entries deleted.
    pub geo_pruned: usize,
}

impl Store {
    /// Runs every retention step for `now_ms`: rollup first (so no minute data is pruned
    /// before it is aggregated), then pruning and thinning.
    pub fn run_retention(&self, now_ms: u64, policy: &RetentionPolicy) -> Result<RetentionReport> {
        let report = RetentionReport {
            hours_rolled_up: self.rollup_metrics_1h(now_ms)?,
            metrics_1m_pruned: self
                .prune_metrics_1m(now_ms.saturating_sub(policy.metrics_1m_ms))?,
            snapshots_thinned: self.thin_snapshots(now_ms, policy.snapshots_all_ms)?,
            pending_pruned: self.prune_pending(now_ms)?,
            geo_pruned: self.prune_geo(now_ms.saturating_sub(policy.geo_ttl_ms))?,
        };
        tracing::info!(?report, "store retention");
        Ok(report)
    }

    /// Deletes `metrics_1m` rows older than `before_ms`. Returns the number removed.
    pub fn prune_metrics_1m(&self, before_ms: u64) -> Result<usize> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::METRICS_1M)?;
            let mut removed = 0;
            t.retain_in(..before_ms, |_, _| {
                removed += 1;
                false
            })?;
            Ok(removed)
        })
    }

    /// Rolls complete hours of `metrics_1m` into `metrics_1h` (see [`MetricsRow::rollup`]),
    /// from the stored cursor up to the hour containing `now_ms` (exclusive), then advances
    /// the cursor. Idempotent. Returns the number of hour rows written.
    pub fn rollup_metrics_1h(&self, now_ms: u64) -> Result<usize> {
        self.write(|txn| rollup(txn, Resolution::Hour.floor(now_ms)))
    }

    /// Keeps every snapshot newer than `now_ms - keep_all_ms`; older snapshots are thinned to
    /// the earliest one of each UTC day. Returns the number removed.
    pub fn thin_snapshots(&self, now_ms: u64, keep_all_ms: u64) -> Result<usize> {
        let cutoff = now_ms.saturating_sub(keep_all_ms);
        self.write(|txn| {
            let mut t = txn.open_table(tables::SNAPSHOTS)?;
            let mut doomed = Vec::new();
            let mut last_day = None;
            for item in t.range(..cutoff)? {
                let (k, _) = item?;
                let ts = k.value();
                let day = ts / DAY_MS;
                if last_day == Some(day) {
                    doomed.push(ts);
                } else {
                    last_day = Some(day);
                }
            }
            for ts in &doomed {
                t.remove(*ts)?;
            }
            Ok(doomed.len())
        })
    }

    /// Prunes event-like rows (B2 addition): `events` older than `events_before_ms`,
    /// `node_events` older than `node_events_before_ms`, and `mesh_events` older than
    /// `mesh_events_before_ms`. `app_events` are kept forever (small, and they are the app
    /// timeline). Pass `0` to keep a table untouched. Returns the number of rows removed per
    /// table as `(events, node_events, mesh_events)`.
    pub fn prune_events(
        &self,
        events_before_ms: u64,
        node_events_before_ms: u64,
        mesh_events_before_ms: u64,
    ) -> Result<(usize, usize, usize)> {
        self.write(|txn| {
            let mut removed = (0, 0, 0);
            if events_before_ms > 0 {
                let mut t = txn.open_table(tables::EVENTS)?;
                t.retain_in(..(events_before_ms, 0u64), |_, _| {
                    removed.0 += 1;
                    false
                })?;
            }
            if node_events_before_ms > 0 {
                let ids: Vec<u32> = {
                    let rev = txn.open_table(tables::NODE_IDS_REV)?;
                    let mut v = Vec::new();
                    for item in rev.range::<u32>(..)? {
                        v.push(item?.0.value());
                    }
                    v
                };
                let mut t = txn.open_table(tables::NODE_EVENTS)?;
                for n in ids {
                    t.retain_in((n, 0u64, 0u64)..(n, node_events_before_ms, 0u64), |_, _| {
                        removed.1 += 1;
                        false
                    })?;
                }
            }
            if mesh_events_before_ms > 0 {
                let mut t = txn.open_table(tables::MESH_EVENTS)?;
                t.retain_in(..(mesh_events_before_ms, 0u64), |_, _| {
                    removed.2 += 1;
                    false
                })?;
            }
            Ok(removed)
        })
    }

    /// Deletes pending app messages whose `expires_ms <= now_ms`. Returns the number removed.
    pub fn prune_pending(&self, now_ms: u64) -> Result<usize> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::PENDING_APP_MESSAGES)?;
            let mut doomed = Vec::new();
            for item in t.range::<&[u8; 32]>(..)? {
                let (k, v) = item?;
                let msg: PendingAppMessage = codec::decode(v.value())?;
                if msg.expires_ms <= now_ms {
                    doomed.push(*k.value());
                }
            }
            for k in &doomed {
                t.remove(k)?;
            }
            Ok(doomed.len())
        })
    }

    /// Deletes geo cache entries fetched before `before_ms`. Returns the number removed.
    pub fn prune_geo(&self, before_ms: u64) -> Result<usize> {
        self.write(|txn| {
            let mut t = txn.open_table(tables::GEO_CACHE)?;
            let mut doomed = Vec::new();
            for item in t.range::<&[u8]>(..)? {
                let (k, v) = item?;
                let (_, fetched_ms): (Geo, u64) = codec::decode(v.value())?;
                if fetched_ms < before_ms {
                    doomed.push(k.value().to_vec());
                }
            }
            for k in &doomed {
                t.remove(k.as_slice())?;
            }
            Ok(doomed.len())
        })
    }
}

fn rollup(txn: &WriteTransaction, end_hour: u64) -> Result<usize> {
    let mut meta = txn.open_table(tables::META)?;
    let minutes = txn.open_table(tables::METRICS_1M)?;
    let mut hours = txn.open_table(tables::METRICS_1H)?;

    let cursor = match read_meta_u64(&meta, meta_keys::ROLLUP_CURSOR_MS)? {
        Some(c) => c,
        None => match minutes.first()? {
            Some((k, _)) => Resolution::Hour.floor(k.value()),
            None => return Ok(0),
        },
    };
    if cursor >= end_hour {
        return Ok(0);
    }

    let mut written = 0;
    let mut bucket: Option<u64> = None;
    let mut rows: Vec<MetricsRow> = Vec::new();
    let mut flush = |hour: u64, rows: &mut Vec<MetricsRow>| -> Result<()> {
        if let Some(row) = MetricsRow::rollup(hour, rows) {
            hours.insert(hour, codec::encode(&row)?.as_slice())?;
            written += 1;
        }
        rows.clear();
        Ok(())
    };
    for item in minutes.range(cursor..end_hour)? {
        let (k, v) = item?;
        let hour = k.value() - k.value() % HOUR_MS;
        if let Some(b) = bucket
            && b != hour
        {
            flush(b, &mut rows)?;
        }
        bucket = Some(hour);
        rows.push(codec::decode_metrics(v.value())?);
    }
    if let Some(b) = bucket {
        flush(b, &mut rows)?;
    }
    meta.insert(
        meta_keys::ROLLUP_CURSOR_MS,
        end_hour.to_be_bytes().as_slice(),
    )?;
    Ok(written)
}

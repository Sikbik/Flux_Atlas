//! Record types owned by the store (metrics rows, mesh records) and small query/result types.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use atlas_core::Amount;
use atlas_core::ids::NodeId;
use atlas_core::net::NodeEndpoint;

/// Milliseconds per minute.
pub const MINUTE_MS: u64 = 60_000;
/// Milliseconds per hour.
pub const HOUR_MS: u64 = 60 * MINUTE_MS;
/// Milliseconds per day.
pub const DAY_MS: u64 = 24 * HOUR_MS;

/// One row of network gauges, stored per minute (`metrics_1m`) and per hour (`metrics_1h`).
///
/// Fields fall into three groups, which decides how [`MetricsRow::rollup`] aggregates them:
/// - **gauges** (state at `ts_ms`): the rollup keeps the value of the last row in the bucket;
/// - **counters** (activity during the interval): the rollup sums them;
/// - **averages**: the rollup computes a weighted mean (see the field docs).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct MetricsRow {
    /// Sample time, unix ms. Rolled-up rows carry the bucket start.
    pub ts_ms: u64,

    // Gauges.
    /// Chain tip height.
    pub tip_height: u32,
    /// Nodes in the active set.
    pub node_count: u32,
    /// Active nodes per tier: Cumulus, Nimbus, Stratus.
    pub tier_counts: [u32; 3],
    /// Distinct host IPs.
    pub host_count: u32,
    /// Distinct countries with at least one node.
    pub country_count: u32,
    /// Hosts running ArcaneOS.
    pub arcane_count: u32,
    /// Nodes that failed the last reachability check.
    pub unreachable_count: u32,
    /// Registered (unexpired) apps.
    pub app_count: u32,
    /// Running app instances.
    pub instance_count: u32,
    /// Pending (broadcast, unmined) app messages.
    pub pending_app_count: u32,
    /// Sum of benchmarked cores over active nodes.
    pub total_cores: u32,
    /// Sum of benchmarked RAM over active nodes, GB.
    pub total_ram_gb: u64,
    /// Sum of benchmarked storage over active nodes, GB.
    pub total_storage_gb: u64,
    /// Circulating supply.
    pub supply: Amount,
    /// FLUX price in USD (0 when unknown).
    pub price_usd: f64,
    /// Transactions in the mempool.
    pub mempool_size: u32,
    /// Known overlay mesh edges.
    pub mesh_edge_count: u32,

    // Counters over the interval.
    /// Blocks added during the interval.
    pub block_count: u32,
    /// Transactions mined during the interval.
    pub tx_count: u32,
    /// Fluxnode start/confirm transactions mined during the interval.
    pub node_tx_count: u32,
    /// Fees paid during the interval.
    pub fees: Amount,
    /// Total node payouts during the interval.
    pub payouts: Amount,

    // Averages.
    /// Mean block interval during the interval, ms (0 when no block landed). Rolled up as a
    /// mean weighted by `block_count`.
    pub avg_block_time_ms: u32,
    /// How many raw samples this row aggregates (1 for a minute row written directly).
    pub samples: u32,
}

impl MetricsRow {
    /// Aggregates `rows` (sorted by `ts_ms`) into one row stamped `bucket_ts`.
    ///
    /// Gauges take the last row's value, counters are summed, `avg_block_time_ms` is the
    /// block-weighted mean (falling back to the last row's value when no blocks landed), and
    /// `samples` is the sum of the inputs' samples (each counted as at least 1).
    /// Returns `None` for an empty input.
    pub fn rollup(bucket_ts: u64, rows: &[MetricsRow]) -> Option<MetricsRow> {
        let last = rows.last()?;
        let mut out = MetricsRow {
            ts_ms: bucket_ts,
            block_count: 0,
            tx_count: 0,
            node_tx_count: 0,
            fees: Amount::ZERO,
            payouts: Amount::ZERO,
            avg_block_time_ms: 0,
            samples: 0,
            ..last.clone()
        };
        let mut weighted: u64 = 0;
        for r in rows {
            out.block_count = out.block_count.saturating_add(r.block_count);
            out.tx_count = out.tx_count.saturating_add(r.tx_count);
            out.node_tx_count = out.node_tx_count.saturating_add(r.node_tx_count);
            out.fees = out.fees.saturating_add(r.fees);
            out.payouts = out.payouts.saturating_add(r.payouts);
            out.samples = out.samples.saturating_add(r.samples.max(1));
            weighted += u64::from(r.avg_block_time_ms) * u64::from(r.block_count);
        }
        out.avg_block_time_ms = if out.block_count > 0 {
            (weighted / u64::from(out.block_count)) as u32
        } else {
            last.avg_block_time_ms
        };
        Some(out)
    }
}

/// Resolution of a metrics series.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Resolution {
    /// `metrics_1m`.
    Minute,
    /// `metrics_1h`.
    Hour,
}

impl Resolution {
    /// Bucket width in ms.
    pub const fn bucket_ms(self) -> u64 {
        match self {
            Self::Minute => MINUTE_MS,
            Self::Hour => HOUR_MS,
        }
    }

    /// Start of the bucket containing `ts_ms` (the row key).
    pub const fn floor(self, ts_ms: u64) -> u64 {
        ts_ms - ts_ms % self.bucket_ms()
    }
}

/// One overlay mesh edge between two nodes. Stored under `(a, b)` with `a < b`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct MeshEdgeRecord {
    /// Engine-defined bit flags (for example direction or reporter agreement).
    pub flags: u8,
    /// First time any reporter listed this edge, unix ms.
    pub first_seen_ms: u64,
    /// Last time any reporter listed this edge, unix ms.
    pub last_seen_ms: u64,
}

/// Who reported a mesh change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeshReporter {
    /// A known node.
    Node(NodeId),
    /// An endpoint that did not resolve to a known node.
    Endpoint(NodeEndpoint),
}

/// One merged topology observation: the edges it added and removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshChangeRecord {
    /// Observation time, unix ms (the row key's time component).
    pub ts_ms: u64,
    /// Node (or unresolved endpoint) whose peer list produced the change.
    pub reporter: MeshReporter,
    /// Edges that appeared, each as `(smaller id, larger id)`.
    pub added: Vec<(NodeId, NodeId)>,
    /// Edges that disappeared, each as `(smaller id, larger id)`.
    pub removed: Vec<(NodeId, NodeId)>,
}

/// Key of a row in an event-like table (`events`, `node_events`, `app_events`, `mesh_events`).
///
/// `ts_ms` is the observation time; `seq` is a store-assigned row sequence that is strictly
/// increasing across all event-like rows, so rows written at the same millisecond keep their
/// insertion order. (The envelope's own `seq` is the publish sequence and may repeat.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct EventKey {
    /// Observation time, unix ms.
    pub ts_ms: u64,
    /// Store-assigned row sequence.
    pub seq: u64,
}

impl EventKey {
    /// The smallest key at `ts_ms` (use as an inclusive lower bound).
    pub const fn first_at(ts_ms: u64) -> Self {
        Self { ts_ms, seq: 0 }
    }

    /// The largest key at `ts_ms` (use as an inclusive upper bound).
    pub const fn last_at(ts_ms: u64) -> Self {
        Self {
            ts_ms,
            seq: u64::MAX,
        }
    }

    pub(crate) const fn tuple(self) -> (u64, u64) {
        (self.ts_ms, self.seq)
    }

    pub(crate) const fn from_tuple((ts_ms, seq): (u64, u64)) -> Self {
        Self { ts_ms, seq }
    }
}

/// Scan direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Order {
    /// Oldest / lowest key first.
    #[default]
    Asc,
    /// Newest / highest key first.
    Desc,
}

/// What a commit did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitStats {
    /// Operations applied from the batch.
    pub ops: usize,
    /// True when the commit was fsynced (`Durability::Immediate`).
    pub durable: bool,
    /// Wall time spent encoding, writing and committing.
    pub elapsed: Duration,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollup_semantics() {
        let a = MetricsRow {
            ts_ms: 0,
            node_count: 10,
            block_count: 2,
            avg_block_time_ms: 30_000,
            fees: Amount(5),
            samples: 1,
            ..MetricsRow::default()
        };
        let b = MetricsRow {
            ts_ms: MINUTE_MS,
            node_count: 12,
            block_count: 1,
            avg_block_time_ms: 60_000,
            fees: Amount(7),
            samples: 0,
            ..MetricsRow::default()
        };
        let r = MetricsRow::rollup(0, &[a, b]).unwrap();
        assert_eq!(r.ts_ms, 0);
        assert_eq!(r.node_count, 12, "gauge keeps the last value");
        assert_eq!(r.block_count, 3, "counter is summed");
        assert_eq!(r.fees, Amount(12));
        assert_eq!(r.avg_block_time_ms, 40_000, "block-weighted mean");
        assert_eq!(r.samples, 2);
        assert!(MetricsRow::rollup(0, &[]).is_none());
    }

    #[test]
    fn resolution_floor() {
        assert_eq!(Resolution::Minute.floor(61_234), 60_000);
        assert_eq!(Resolution::Hour.floor(HOUR_MS + 5), HOUR_MS);
    }
}

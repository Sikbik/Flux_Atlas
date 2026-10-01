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
/// **Unknown is `None`, never 0.** A value the engine did not observe for the row (a series
/// that a backfilled row does not carry, a source that has not reported yet) stays `None`, and
/// the `/metrics` projection serves it as `null`.
///
/// Fields fall into three groups, which decides how [`MetricsRow::rollup`] aggregates them:
/// - **gauges** (state at `ts_ms`): the rollup keeps the last known value in the bucket;
/// - **counters** (activity during the interval): the rollup sums the known values;
/// - **averages**: the rollup computes a weighted mean (see the field docs).
///
/// Stored as schema version 2. Version 1 rows (plain numbers, 0 for unknown) are converted on
/// read by [`MetricsRowV1::upgrade`].
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct MetricsRow {
    /// Sample time, unix ms. Rolled-up rows carry the bucket start.
    pub ts_ms: u64,

    // Gauges.
    /// Chain tip height.
    pub tip_height: Option<u32>,
    /// Nodes in the active set.
    pub node_count: Option<u32>,
    /// Active nodes per tier: Cumulus, Nimbus, Stratus.
    pub tier_counts: Option<[u32; 3]>,
    /// Distinct host IPs.
    pub host_count: Option<u32>,
    /// Distinct countries with at least one node.
    pub country_count: Option<u32>,
    /// Hosts running ArcaneOS.
    pub arcane_count: Option<u32>,
    /// Nodes that failed the last reachability check.
    pub unreachable_count: Option<u32>,
    /// Registered (unexpired) apps.
    pub app_count: Option<u32>,
    /// Running app instances.
    pub instance_count: Option<u32>,
    /// Pending (broadcast, unmined) app messages.
    pub pending_app_count: Option<u32>,
    /// Sum of benchmarked cores over active nodes.
    pub total_cores: Option<u32>,
    /// Sum of benchmarked RAM over active nodes, GB.
    pub total_ram_gb: Option<u64>,
    /// Sum of benchmarked storage over active nodes, GB.
    pub total_storage_gb: Option<u64>,
    /// Circulating supply.
    pub supply: Option<Amount>,
    /// FLUX price in USD.
    pub price_usd: Option<f64>,
    /// Transactions in the mempool.
    pub mempool_size: Option<u32>,
    /// Known overlay mesh edges.
    pub mesh_edge_count: Option<u32>,

    // Counters over the interval.
    /// Blocks added during the interval.
    pub block_count: Option<u32>,
    /// Transactions mined during the interval.
    pub tx_count: Option<u32>,
    /// Fluxnode start/confirm transactions mined during the interval.
    pub node_tx_count: Option<u32>,
    /// Fees paid during the interval.
    pub fees: Option<Amount>,
    /// Total node payouts during the interval.
    pub payouts: Option<Amount>,

    // Averages.
    /// Mean block interval during the interval, ms (`None` when no block interval was
    /// measured). Rolled up as a mean weighted by `block_count`.
    pub avg_block_time_ms: Option<u32>,
    /// How many raw samples this row aggregates (1 for a minute row written directly).
    pub samples: u32,

    // Gauges added by the engine (B2).
    /// Distinct providers (ASN, falling back to org) with at least one active node.
    pub provider_count: Option<u32>,
    /// Active nodes 560 or more blocks past their last confirmation.
    pub at_risk_count: Option<u32>,
    /// Nodes started but not yet confirmed.
    pub started_count: Option<u32>,
    /// Nodes on the DOS list.
    pub dos_count: Option<u32>,
    /// Sum of benchmarked SSD over active nodes, GB.
    pub total_ssd_gb: Option<u64>,
    /// CPU cores locked by running apps (stats round).
    pub locked_cores: Option<f64>,
    /// RAM locked by running apps, GB (stats round).
    pub locked_ram_gb: Option<f64>,
    /// Storage locked by running apps, GB (stats round).
    pub locked_storage_gb: Option<f64>,
}

/// Last known value of a gauge in `rows` (sorted by time).
fn last_known<T: Copy>(rows: &[MetricsRow], f: impl Fn(&MetricsRow) -> Option<T>) -> Option<T> {
    rows.iter().rev().find_map(f)
}

/// Sum of the known values of a counter; `None` when no row knows it.
fn sum_known<T: Copy>(
    rows: &[MetricsRow],
    f: impl Fn(&MetricsRow) -> Option<T>,
    add: impl Fn(T, T) -> T,
) -> Option<T> {
    rows.iter().filter_map(f).reduce(add)
}

impl MetricsRow {
    /// Aggregates `rows` (sorted by `ts_ms`) into one row stamped `bucket_ts`.
    ///
    /// Gauges take the last known value, counters sum the known values (`None` when no row
    /// knows them), `avg_block_time_ms` is the block-weighted mean over rows that know both
    /// values, and `samples` is the sum of the inputs' samples (each counted as at least 1).
    /// Returns `None` for an empty input.
    pub fn rollup(bucket_ts: u64, rows: &[MetricsRow]) -> Option<MetricsRow> {
        if rows.is_empty() {
            return None;
        }
        let add_u32 = |a: u32, b: u32| a.saturating_add(b);
        let add_amount = |a: Amount, b: Amount| a.saturating_add(b);
        let (mut weighted, mut blocks) = (0u64, 0u64);
        for r in rows {
            if let (Some(avg), Some(n)) = (r.avg_block_time_ms, r.block_count)
                && n > 0
            {
                weighted += u64::from(avg) * u64::from(n);
                blocks += u64::from(n);
            }
        }
        Some(MetricsRow {
            ts_ms: bucket_ts,
            tip_height: last_known(rows, |r| r.tip_height),
            node_count: last_known(rows, |r| r.node_count),
            tier_counts: last_known(rows, |r| r.tier_counts),
            host_count: last_known(rows, |r| r.host_count),
            country_count: last_known(rows, |r| r.country_count),
            arcane_count: last_known(rows, |r| r.arcane_count),
            unreachable_count: last_known(rows, |r| r.unreachable_count),
            app_count: last_known(rows, |r| r.app_count),
            instance_count: last_known(rows, |r| r.instance_count),
            pending_app_count: last_known(rows, |r| r.pending_app_count),
            total_cores: last_known(rows, |r| r.total_cores),
            total_ram_gb: last_known(rows, |r| r.total_ram_gb),
            total_storage_gb: last_known(rows, |r| r.total_storage_gb),
            supply: last_known(rows, |r| r.supply),
            price_usd: last_known(rows, |r| r.price_usd),
            mempool_size: last_known(rows, |r| r.mempool_size),
            mesh_edge_count: last_known(rows, |r| r.mesh_edge_count),
            block_count: sum_known(rows, |r| r.block_count, add_u32),
            tx_count: sum_known(rows, |r| r.tx_count, add_u32),
            node_tx_count: sum_known(rows, |r| r.node_tx_count, add_u32),
            fees: sum_known(rows, |r| r.fees, add_amount),
            payouts: sum_known(rows, |r| r.payouts, add_amount),
            avg_block_time_ms: (blocks > 0).then(|| (weighted / blocks) as u32),
            samples: rows
                .iter()
                .fold(0u32, |acc, r| acc.saturating_add(r.samples.max(1))),
            provider_count: last_known(rows, |r| r.provider_count),
            at_risk_count: last_known(rows, |r| r.at_risk_count),
            started_count: last_known(rows, |r| r.started_count),
            dos_count: last_known(rows, |r| r.dos_count),
            total_ssd_gb: last_known(rows, |r| r.total_ssd_gb),
            locked_cores: last_known(rows, |r| r.locked_cores),
            locked_ram_gb: last_known(rows, |r| r.locked_ram_gb),
            locked_storage_gb: last_known(rows, |r| r.locked_storage_gb),
        })
    }
}

/// Schema version 1 of [`MetricsRow`]: plain numbers, with 0 standing for "unknown". Kept only
/// to read rows written before version 2.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub(crate) struct MetricsRowV1 {
    pub ts_ms: u64,
    pub tip_height: u32,
    pub node_count: u32,
    pub tier_counts: [u32; 3],
    pub host_count: u32,
    pub country_count: u32,
    pub arcane_count: u32,
    pub unreachable_count: u32,
    pub app_count: u32,
    pub instance_count: u32,
    pub pending_app_count: u32,
    pub total_cores: u32,
    pub total_ram_gb: u64,
    pub total_storage_gb: u64,
    pub supply: Amount,
    pub price_usd: f64,
    pub mempool_size: u32,
    pub mesh_edge_count: u32,
    pub block_count: u32,
    pub tx_count: u32,
    pub node_tx_count: u32,
    pub fees: Amount,
    pub payouts: Amount,
    pub avg_block_time_ms: u32,
    pub samples: u32,
    pub provider_count: u32,
    pub at_risk_count: u32,
    pub started_count: u32,
    pub dos_count: u32,
    pub total_ssd_gb: u64,
    pub locked_cores: f64,
    pub locked_ram_gb: f64,
    pub locked_storage_gb: f64,
}

impl MetricsRowV1 {
    /// Converts a version 1 row, recovering "unknown" from the zeros it stored:
    ///
    /// - `tip_height == 0` marks a row the engine did not record live (the bootstrap backfill
    ///   of `fluxhistorystats`): only `node_count` and `tier_counts` are known.
    /// - In a live row, 0 is unknown for gauges that are never 0 on a populated network
    ///   (supply, price, hardware and locked totals, countries, providers, ArcaneOS hosts,
    ///   unreachable nodes, apps, instances, mesh edges) and for `avg_block_time_ms`; counters
    ///   and the small gauges that are legitimately 0 (mempool, pending apps, at risk,
    ///   started, DOS) are kept as recorded.
    pub(crate) fn upgrade(self) -> MetricsRow {
        let nz32 = |v: u32| (v != 0).then_some(v);
        let nz64 = |v: u64| (v != 0).then_some(v);
        let nzf = |v: f64| (v != 0.0 && v.is_finite()).then_some(v);
        if self.tip_height == 0 {
            return MetricsRow {
                ts_ms: self.ts_ms,
                node_count: Some(self.node_count),
                tier_counts: Some(self.tier_counts),
                samples: self.samples,
                ..MetricsRow::default()
            };
        }
        MetricsRow {
            ts_ms: self.ts_ms,
            tip_height: Some(self.tip_height),
            node_count: Some(self.node_count),
            tier_counts: Some(self.tier_counts),
            host_count: nz32(self.host_count),
            country_count: nz32(self.country_count),
            arcane_count: nz32(self.arcane_count),
            unreachable_count: nz32(self.unreachable_count),
            app_count: nz32(self.app_count),
            instance_count: nz32(self.instance_count),
            pending_app_count: Some(self.pending_app_count),
            total_cores: nz32(self.total_cores),
            total_ram_gb: nz64(self.total_ram_gb),
            total_storage_gb: nz64(self.total_storage_gb),
            supply: (!self.supply.is_zero()).then_some(self.supply),
            price_usd: nzf(self.price_usd),
            mempool_size: Some(self.mempool_size),
            mesh_edge_count: nz32(self.mesh_edge_count),
            block_count: Some(self.block_count),
            tx_count: Some(self.tx_count),
            node_tx_count: Some(self.node_tx_count),
            fees: Some(self.fees),
            payouts: Some(self.payouts),
            avg_block_time_ms: nz32(self.avg_block_time_ms),
            samples: self.samples,
            provider_count: nz32(self.provider_count),
            at_risk_count: Some(self.at_risk_count),
            started_count: Some(self.started_count),
            dos_count: Some(self.dos_count),
            total_ssd_gb: nz64(self.total_ssd_gb),
            locked_cores: nzf(self.locked_cores),
            locked_ram_gb: nzf(self.locked_ram_gb),
            locked_storage_gb: nzf(self.locked_storage_gb),
        }
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

/// Heights on this grid are the chain-history samples kept forever; per-block rows off the grid
/// are thinned away once older than the per-block tier (`HistoryRetention::chain_blocks_ms`).
/// One sample every 720 blocks is 6 hours after Proof of Node and a day before it.
pub const CHAIN_SAMPLE_GRID: u32 = 720;

/// Time and difficulty of one block (`chain_points`, keyed by height). Recent blocks have a row
/// each (live blocks and the block backfill); older history keeps the [`CHAIN_SAMPLE_GRID`]
/// heights, which the chain sampler fetches. A reorg overwrites the rows of its heights.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct ChainPoint {
    /// Block header time, unix seconds.
    pub time_s: u32,
    /// Block difficulty; `None` when the source did not carry it (rows seeded from stored
    /// blocks).
    pub difficulty: Option<f64>,
}

impl ChainPoint {
    /// Header time in unix ms.
    pub const fn time_ms(&self) -> u64 {
        self.time_s as u64 * 1000
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
            node_count: Some(10),
            price_usd: Some(0.5),
            block_count: Some(2),
            avg_block_time_ms: Some(30_000),
            fees: Some(Amount(5)),
            samples: 1,
            ..MetricsRow::default()
        };
        let b = MetricsRow {
            ts_ms: MINUTE_MS,
            node_count: Some(12),
            block_count: Some(1),
            avg_block_time_ms: Some(60_000),
            fees: Some(Amount(7)),
            samples: 0,
            ..MetricsRow::default()
        };
        let r = MetricsRow::rollup(0, &[a, b]).unwrap();
        assert_eq!(r.ts_ms, 0);
        assert_eq!(r.node_count, Some(12), "gauge keeps the last value");
        assert_eq!(r.price_usd, Some(0.5), "gauge keeps the last known value");
        assert_eq!(r.supply, None, "unknown stays unknown");
        assert_eq!(r.block_count, Some(3), "counter is summed");
        assert_eq!(r.tx_count, None, "a counter no row knows stays unknown");
        assert_eq!(r.fees, Some(Amount(12)));
        assert_eq!(r.avg_block_time_ms, Some(40_000), "block-weighted mean");
        assert_eq!(r.samples, 2);
        assert!(MetricsRow::rollup(0, &[]).is_none());
    }

    #[test]
    fn v1_rows_recover_unknown() {
        let backfilled = MetricsRowV1 {
            ts_ms: 1,
            node_count: 6_700,
            tier_counts: [3_300, 1_600, 1_800],
            samples: 1,
            ..MetricsRowV1::default()
        }
        .upgrade();
        assert_eq!(backfilled.node_count, Some(6_700));
        assert_eq!(backfilled.tier_counts, Some([3_300, 1_600, 1_800]));
        assert_eq!(backfilled.tip_height, None);
        assert_eq!(backfilled.price_usd, None);
        assert_eq!(backfilled.supply, None);
        assert_eq!(backfilled.block_count, None);
        assert_eq!(backfilled.mempool_size, None);
        let live = MetricsRowV1 {
            ts_ms: 2,
            tip_height: 3_000_000,
            node_count: 6_700,
            supply: Amount::from_flux(400_000_000),
            mempool_size: 0,
            block_count: 2,
            ..MetricsRowV1::default()
        }
        .upgrade();
        assert_eq!(live.tip_height, Some(3_000_000));
        assert_eq!(live.supply, Some(Amount::from_flux(400_000_000)));
        assert_eq!(live.price_usd, None, "0 price was unknown");
        assert_eq!(live.total_cores, None, "0 cores was unknown");
        assert_eq!(live.mempool_size, Some(0), "an empty mempool is a real 0");
        assert_eq!(live.block_count, Some(2));
        assert_eq!(live.avg_block_time_ms, None);
    }

    #[test]
    fn resolution_floor() {
        assert_eq!(Resolution::Minute.floor(61_234), 60_000);
        assert_eq!(Resolution::Hour.floor(HOUR_MS + 5), HOUR_MS);
    }
}

//! Flux Atlas persistence on redb.
//!
//! - [`Store`] is the database handle: `Clone + Send + Sync`, synchronous (call it from
//!   `spawn_blocking` or a dedicated thread in async code).
//! - [`WriteBatch`] collects one engine tick of writes; [`Store::commit`] applies it in one
//!   write transaction with the durability policy described on [`StoreOptions`].
//! - Values are `[schema_version] ++ postcard(value)`; snapshots are
//!   `[format_version] ++ zstd(postcard(value))`. Keys use redb native types.
//! - Event-like tables are keyed by [`EventKey`] (`observed_ms`, store-assigned row seq).
//!
//! Tables: `meta`, `node_ids`, `node_ids_rev`, `node_state`, `node_events`, `events`,
//! `snapshots`, `metrics_1m`, `metrics_1h`, `blocks`, `block_hash`, `block_payouts`, `payments`,
//! `node_txs`, `node_txs_by_node`, `apps`, `app_events`, `app_messages`, `app_messages_by_app`,
//! `pending_app_messages`, `mesh_edges`, `mesh_events`, `geo_cache`.
#![cfg_attr(test, allow(clippy::unwrap_used))]

mod batch;
mod budget;
mod codec;
mod error;
mod read;
mod records;
mod retention;
mod stats;
mod store;
mod tables;

pub use batch::{SNAPSHOT_FORMAT_VERSION, WriteBatch};
pub use budget::{
    BudgetReport, DEFAULT_DISK_BUDGET_MB, DiskBudget, History, HistoryRetention, Pressure,
    PruneCounts, PruneOutcome, bytes_per_row, prune_oldest_first,
};
pub use error::{Result, StoreError};
pub use records::{
    CommitStats, DAY_MS, EventKey, HOUR_MS, MINUTE_MS, MeshChangeRecord, MeshEdgeRecord,
    MeshReporter, MetricsRow, Order, Resolution,
};
pub use retention::{RetentionPolicy, RetentionReport};
pub use stats::{DbStats, FileUsage, TableSize, db_stats_at, dir_usage};
pub use store::{SCHEMA_VERSION, Store, StoreOptions};
pub use tables::meta_keys;

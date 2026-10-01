//! redb table definitions and well-known `meta` keys.
//!
//! Structured values are `&[u8]` holding the versioned codec (see [`crate::codec`]); scalar
//! values use redb native types.

use redb::{TableDefinition, WriteTransaction};

use crate::error::Result;

/// `meta`: key -> raw bytes (u64 values are 8 bytes big-endian).
pub(crate) const META: TableDefinition<'_, &str, &[u8]> = TableDefinition::new("meta");
/// `node_ids`: outpoint key (`Outpoint::to_key`) -> interned node id.
pub(crate) const NODE_IDS: TableDefinition<'_, &[u8; 36], u32> = TableDefinition::new("node_ids");
/// `node_ids_rev`: node id -> outpoint key.
pub(crate) const NODE_IDS_REV: TableDefinition<'_, u32, &[u8; 36]> =
    TableDefinition::new("node_ids_rev");
/// `node_state`: node id -> NodeRecord.
pub(crate) const NODE_STATE: TableDefinition<'_, u32, &[u8]> = TableDefinition::new("node_state");
/// `node_events`: (node, ts_ms, row seq) -> EventEnvelope.
pub(crate) const NODE_EVENTS: TableDefinition<'_, (u32, u64, u64), &[u8]> =
    TableDefinition::new("node_events");
/// `events`: (ts_ms, row seq) -> EventEnvelope.
pub(crate) const EVENTS: TableDefinition<'_, (u64, u64), &[u8]> = TableDefinition::new("events");
/// `snapshots`: ts_ms -> `[version] ++ zstd(postcard(snapshot))`.
pub(crate) const SNAPSHOTS: TableDefinition<'_, u64, &[u8]> = TableDefinition::new("snapshots");
/// `metrics_1m`: minute start -> MetricsRow.
pub(crate) const METRICS_1M: TableDefinition<'_, u64, &[u8]> = TableDefinition::new("metrics_1m");
/// `metrics_1h`: hour start -> MetricsRow.
pub(crate) const METRICS_1H: TableDefinition<'_, u64, &[u8]> = TableDefinition::new("metrics_1h");
/// `blocks`: height -> BlockSummary.
pub(crate) const BLOCKS: TableDefinition<'_, u32, &[u8]> = TableDefinition::new("blocks");
/// `block_hash`: block hash -> height.
pub(crate) const BLOCK_HASH: TableDefinition<'_, &[u8; 32], u32> =
    TableDefinition::new("block_hash");
/// `block_payouts`: (height, tier) -> Payout.
pub(crate) const BLOCK_PAYOUTS: TableDefinition<'_, (u32, u8), &[u8]> =
    TableDefinition::new("block_payouts");
/// `payments`: (node, height) -> amount in base units.
pub(crate) const PAYMENTS: TableDefinition<'_, (u32, u32), i64> = TableDefinition::new("payments");
/// `node_txs`: (height, index in block) -> NodeTx.
pub(crate) const NODE_TXS: TableDefinition<'_, (u32, u16), &[u8]> =
    TableDefinition::new("node_txs");
/// `node_txs_by_node`: (node, height, index) -> ().
pub(crate) const NODE_TXS_BY_NODE: TableDefinition<'_, (u32, u32, u16), ()> =
    TableDefinition::new("node_txs_by_node");
/// `apps`: lowercase name -> AppRecord.
pub(crate) const APPS: TableDefinition<'_, &str, &[u8]> = TableDefinition::new("apps");
/// `app_events`: (lowercase name, ts_ms, row seq) -> EventEnvelope.
pub(crate) const APP_EVENTS: TableDefinition<'_, (&str, u64, u64), &[u8]> =
    TableDefinition::new("app_events");
/// `app_messages`: message hash -> AppMessageRecord.
pub(crate) const APP_MESSAGES: TableDefinition<'_, &[u8; 32], &[u8]> =
    TableDefinition::new("app_messages");
/// `app_messages_by_app`: (lowercase name, height, hash) -> ().
pub(crate) const APP_MESSAGES_BY_APP: TableDefinition<'_, (&str, u32, &[u8; 32]), ()> =
    TableDefinition::new("app_messages_by_app");
/// `pending_app_messages`: message hash -> PendingAppMessage.
pub(crate) const PENDING_APP_MESSAGES: TableDefinition<'_, &[u8; 32], &[u8]> =
    TableDefinition::new("pending_app_messages");
/// `mesh_edges`: (a, b) with a <= b -> MeshEdgeRecord.
pub(crate) const MESH_EDGES: TableDefinition<'_, (u32, u32), &[u8]> =
    TableDefinition::new("mesh_edges");
/// `mesh_events`: (ts_ms, row seq) -> MeshChangeRecord.
pub(crate) const MESH_EVENTS: TableDefinition<'_, (u64, u64), &[u8]> =
    TableDefinition::new("mesh_events");
/// `geo_cache`: IP octets (4 or 16 bytes) -> (Geo, fetched_ms).
pub(crate) const GEO_CACHE: TableDefinition<'_, &[u8], &[u8]> = TableDefinition::new("geo_cache");
/// `chain_points`: height -> ChainPoint (block time and difficulty: per block for recent
/// history, the sample grid for older history).
pub(crate) const CHAIN_POINTS: TableDefinition<'_, u32, &[u8]> =
    TableDefinition::new("chain_points");
/// `chain_daily`: UTC day start (unix ms) -> difficulty from Insight's daily series.
pub(crate) const CHAIN_DAILY: TableDefinition<'_, u64, f64> = TableDefinition::new("chain_daily");

/// Creates every table (idempotent).
pub(crate) fn create_all(txn: &WriteTransaction) -> Result<()> {
    txn.open_table(META)?;
    txn.open_table(NODE_IDS)?;
    txn.open_table(NODE_IDS_REV)?;
    txn.open_table(NODE_STATE)?;
    txn.open_table(NODE_EVENTS)?;
    txn.open_table(EVENTS)?;
    txn.open_table(SNAPSHOTS)?;
    txn.open_table(METRICS_1M)?;
    txn.open_table(METRICS_1H)?;
    txn.open_table(BLOCKS)?;
    txn.open_table(BLOCK_HASH)?;
    txn.open_table(BLOCK_PAYOUTS)?;
    txn.open_table(PAYMENTS)?;
    txn.open_table(NODE_TXS)?;
    txn.open_table(NODE_TXS_BY_NODE)?;
    txn.open_table(APPS)?;
    txn.open_table(APP_EVENTS)?;
    txn.open_table(APP_MESSAGES)?;
    txn.open_table(APP_MESSAGES_BY_APP)?;
    txn.open_table(PENDING_APP_MESSAGES)?;
    txn.open_table(MESH_EDGES)?;
    txn.open_table(MESH_EVENTS)?;
    txn.open_table(GEO_CACHE)?;
    txn.open_table(CHAIN_POINTS)?;
    txn.open_table(CHAIN_DAILY)?;
    Ok(())
}

/// Well-known `meta` keys. The engine may use any other key for its own cursors.
pub mod meta_keys {
    /// Schema version of the database file (u64).
    pub const SCHEMA_VERSION: &str = "schema_version";
    /// Unix ms when the database was created (u64).
    pub const CREATED_MS: &str = "created_ms";
    /// Last store-assigned event row sequence (u64). Managed by the store.
    pub const ROW_SEQ: &str = "row_seq";
    /// Start of the next hour to roll up from `metrics_1m` into `metrics_1h` (u64). Managed by
    /// the store.
    pub const ROLLUP_CURSOR_MS: &str = "rollup_1h_cursor_ms";
    /// Suggested key for the ingest tip height cursor (u64).
    pub const TIP_HEIGHT: &str = "tip_height";
    /// Suggested key for the first ingest time (u64).
    pub const FIRST_INGEST_MS: &str = "first_ingest_ms";
}

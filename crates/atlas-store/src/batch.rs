//! [`WriteBatch`]: everything one engine tick wants persisted, applied by
//! [`crate::Store::commit`] in a single write transaction.

use std::net::IpAddr;

use serde::Serialize;

use atlas_core::app::{AppMessageRecord, AppRecord, PendingAppMessage};
use atlas_core::chain::{BlockSummary, NodeTx};
use atlas_core::event::EventEnvelope;
use atlas_core::ids::{Hash32, NodeId, Outpoint};
use atlas_core::node::{Geo, NodeRecord};

use crate::codec;
use crate::error::Result;
use crate::records::{MeshChangeRecord, MeshEdgeRecord, MetricsRow, Resolution};

/// Format version byte of snapshot blobs. The snapshot type itself is chosen by the engine; if
/// its shape changes incompatibly, bump this constant. [`crate::Store::snapshot_at_or_before`]
/// only decodes the current version; [`crate::Store::snapshot_blob_at_or_before`] hands older
/// versions to the engine, which reads its legacy shapes.
///
/// Version 2 (B4): time-machine keyframes also record city, FluxOS version, hardware, last
/// payment, app count, ArcaneOS and first-seen time per node.
pub const SNAPSHOT_FORMAT_VERSION: u8 = 2;

/// One queued write. Applied in push order.
#[derive(Debug)]
pub(crate) enum Op {
    SetMeta(String, Vec<u8>),
    DeleteMeta(String),
    InternNode(Outpoint, NodeId),
    PutNode(Box<NodeRecord>),
    DeleteNode(NodeId),
    PushEvent(Box<EventEnvelope>),
    PutBlock(Box<BlockSummary>),
    DeleteBlocksFrom(u32),
    PutNodeTx {
        height: u32,
        index: u16,
        tx: Box<NodeTx>,
    },
    PutApp(Box<AppRecord>),
    DeleteApp(String),
    PutAppMessage(Box<AppMessageRecord>),
    PutPending(Box<PendingAppMessage>),
    DeletePending(Hash32),
    PutMeshEdge(NodeId, NodeId, MeshEdgeRecord),
    DeleteMeshEdge(NodeId, NodeId),
    PushMeshChange(Box<MeshChangeRecord>),
    PutMetrics(Resolution, Box<MetricsRow>),
    PutSnapshot(u64, Vec<u8>),
    DeleteSnapshot(u64),
    PutGeo(IpAddr, Box<Geo>, u64),
    DeleteGeo(IpAddr),
}

/// A set of writes applied atomically by [`crate::Store::commit`].
///
/// The engine fills one batch per tick. Operations are applied in the order they were pushed,
/// so a later `put_*` for the same key wins. Nothing touches the database until commit; if the
/// commit fails, none of the batch is applied.
#[derive(Debug, Default)]
pub struct WriteBatch {
    pub(crate) ops: Vec<Op>,
}

impl WriteBatch {
    /// An empty batch.
    pub fn new() -> Self {
        Self::default()
    }

    /// An empty batch with room for `n` operations (useful for bootstrap imports).
    pub fn with_capacity(n: usize) -> Self {
        Self {
            ops: Vec::with_capacity(n),
        }
    }

    /// Number of queued operations.
    pub fn len(&self) -> usize {
        self.ops.len()
    }

    /// True when nothing is queued.
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    /// Sets a raw `meta` value.
    pub fn set_meta(&mut self, key: &str, value: &[u8]) -> &mut Self {
        self.push(Op::SetMeta(key.to_owned(), value.to_vec()))
    }

    /// Sets a `meta` value to a u64 (8 bytes big-endian).
    pub fn set_meta_u64(&mut self, key: &str, value: u64) -> &mut Self {
        self.push(Op::SetMeta(key.to_owned(), value.to_be_bytes().to_vec()))
    }

    /// Removes a `meta` value.
    pub fn delete_meta(&mut self, key: &str) -> &mut Self {
        self.push(Op::DeleteMeta(key.to_owned()))
    }

    /// Records the interning `outpoint <-> id` in `node_ids` / `node_ids_rev`.
    ///
    /// Re-inserting an identical mapping is a no-op. Mapping an outpoint or id that is already
    /// mapped differently fails the whole commit with [`crate::StoreError::InternConflict`].
    pub fn intern_node(&mut self, outpoint: Outpoint, id: NodeId) -> &mut Self {
        self.push(Op::InternNode(outpoint, id))
    }

    /// Upserts the latest record of a node (keyed by `record.id`).
    pub fn put_node(&mut self, record: NodeRecord) -> &mut Self {
        self.push(Op::PutNode(Box::new(record)))
    }

    /// Removes a node record (interning and history are kept).
    pub fn delete_node(&mut self, id: NodeId) -> &mut Self {
        self.push(Op::DeleteNode(id))
    }

    /// Appends an event to `events`, and to `node_events` / `app_events` when
    /// `event.node()` / `event.app()` name one. The row key time is `observed_ms`.
    pub fn push_event(&mut self, event: EventEnvelope) -> &mut Self {
        self.push(Op::PushEvent(Box::new(event)))
    }

    /// Upserts a block: writes `blocks`, `block_hash`, `block_payouts`, and `payments` for
    /// every payout attributed to a node. Replacing an existing height first removes the old
    /// block's hash, payout and payment rows.
    pub fn put_block(&mut self, block: BlockSummary) -> &mut Self {
        self.push(Op::PutBlock(Box::new(block)))
    }

    /// Reorg: removes every block at `height` and above together with its hash, payout,
    /// payment, and node-tx rows (and their by-node index rows).
    pub fn delete_blocks_from(&mut self, height: u32) -> &mut Self {
        self.push(Op::DeleteBlocksFrom(height))
    }

    /// Stores a mined fluxnode tx at `(height, index)`; indexes it by node when `tx.node` is
    /// set. `index` is the tx position within the block.
    pub fn put_node_tx(&mut self, height: u32, index: u16, tx: NodeTx) -> &mut Self {
        self.push(Op::PutNodeTx {
            height,
            index,
            tx: Box::new(tx),
        })
    }

    /// Upserts an app (keyed by its lowercase `name`).
    pub fn put_app(&mut self, app: AppRecord) -> &mut Self {
        self.push(Op::PutApp(Box::new(app)))
    }

    /// Removes an app record (its events and messages are kept).
    pub fn delete_app(&mut self, name: &str) -> &mut Self {
        self.push(Op::DeleteApp(name.to_ascii_lowercase()))
    }

    /// Stores a permanent app message and indexes it under its app (`spec.name`, lowercase)
    /// and height.
    pub fn put_app_message(&mut self, message: AppMessageRecord) -> &mut Self {
        self.push(Op::PutAppMessage(Box::new(message)))
    }

    /// Upserts a pending app message.
    pub fn put_pending(&mut self, message: PendingAppMessage) -> &mut Self {
        self.push(Op::PutPending(Box::new(message)))
    }

    /// Removes a pending app message (mined or expired).
    pub fn delete_pending(&mut self, hash: Hash32) -> &mut Self {
        self.push(Op::DeletePending(hash))
    }

    /// Upserts a mesh edge. The pair is normalized so the smaller id comes first.
    pub fn put_mesh_edge(&mut self, a: NodeId, b: NodeId, edge: MeshEdgeRecord) -> &mut Self {
        let (a, b) = ordered(a, b);
        self.push(Op::PutMeshEdge(a, b, edge))
    }

    /// Removes a mesh edge (either order).
    pub fn delete_mesh_edge(&mut self, a: NodeId, b: NodeId) -> &mut Self {
        let (a, b) = ordered(a, b);
        self.push(Op::DeleteMeshEdge(a, b))
    }

    /// Appends a mesh change to `mesh_events` (row time = `change.ts_ms`).
    pub fn push_mesh_change(&mut self, change: MeshChangeRecord) -> &mut Self {
        self.push(Op::PushMeshChange(Box::new(change)))
    }

    /// Upserts a `metrics_1m` row, keyed by the minute containing `row.ts_ms`.
    pub fn put_metrics_1m(&mut self, row: MetricsRow) -> &mut Self {
        self.push(Op::PutMetrics(Resolution::Minute, Box::new(row)))
    }

    /// Upserts a `metrics_1h` row, keyed by the hour containing `row.ts_ms`.
    pub fn put_metrics_1h(&mut self, row: MetricsRow) -> &mut Self {
        self.push(Op::PutMetrics(Resolution::Hour, Box::new(row)))
    }

    /// Serializes and compresses a snapshot now (zstd), to be stored at `ts_ms` on commit.
    pub fn put_snapshot<T: Serialize>(&mut self, ts_ms: u64, snapshot: &T) -> Result<&mut Self> {
        let blob = codec::encode_blob(snapshot, SNAPSHOT_FORMAT_VERSION)?;
        Ok(self.push(Op::PutSnapshot(ts_ms, blob)))
    }

    /// Removes the snapshot stored at `ts_ms`.
    pub fn delete_snapshot(&mut self, ts_ms: u64) -> &mut Self {
        self.push(Op::DeleteSnapshot(ts_ms))
    }

    /// Caches the geolocation of `ip`, fetched at `fetched_ms`.
    pub fn put_geo(&mut self, ip: IpAddr, geo: Geo, fetched_ms: u64) -> &mut Self {
        self.push(Op::PutGeo(ip, Box::new(geo), fetched_ms))
    }

    /// Drops the cached geolocation of `ip`.
    pub fn delete_geo(&mut self, ip: IpAddr) -> &mut Self {
        self.push(Op::DeleteGeo(ip))
    }

    fn push(&mut self, op: Op) -> &mut Self {
        self.ops.push(op);
        self
    }
}

fn ordered(a: NodeId, b: NodeId) -> (NodeId, NodeId) {
    if a <= b { (a, b) } else { (b, a) }
}

/// IP address bytes used as the `geo_cache` key.
pub(crate) fn ip_key(ip: IpAddr) -> Vec<u8> {
    match ip {
        IpAddr::V4(v4) => v4.octets().to_vec(),
        IpAddr::V6(v6) => v6.octets().to_vec(),
    }
}

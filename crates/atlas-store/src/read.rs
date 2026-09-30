//! Read APIs. Each call runs in its own MVCC read transaction.

use std::net::IpAddr;
use std::ops::{Bound, RangeBounds};

use redb::{AccessGuard, Key, Range, ReadableTable, ReadableTableMetadata, Value};
use serde::de::DeserializeOwned;

use atlas_core::Amount;
use atlas_core::app::{AppMessageRecord, AppRecord, PendingAppMessage};
use atlas_core::chain::{BlockSummary, NodeTx, Payout};
use atlas_core::event::EventEnvelope;
use atlas_core::ids::{Hash32, NodeId, Outpoint};
use atlas_core::node::{Geo, NodeRecord};

use crate::batch::{SNAPSHOT_FORMAT_VERSION, ip_key};
use crate::codec::{self, Stored};
use crate::error::{Result, StoreError};
use crate::records::{EventKey, MeshChangeRecord, MeshEdgeRecord, MetricsRow, Order, Resolution};
use crate::store::{Store, read_meta_u64};
use crate::tables;

/// Walks `range` in `order`, mapping up to `limit` entries.
fn scan<'a, K, V, T>(
    mut range: Range<'a, K, V>,
    order: Order,
    limit: usize,
    mut map: impl FnMut(AccessGuard<'a, K>, AccessGuard<'a, V>) -> Result<T>,
) -> Result<Vec<T>>
where
    K: Key + 'static,
    V: Value + 'static,
{
    let mut out = Vec::new();
    while out.len() < limit {
        let item = match order {
            Order::Asc => range.next(),
            Order::Desc => range.next_back(),
        };
        let Some(item) = item else { break };
        let (k, v) = item?;
        out.push(map(k, v)?);
    }
    Ok(out)
}

/// Maps `EventKey` bounds onto a composite key, replacing unbounded ends with `lo` / `hi`.
fn key_bounds<R, T>(range: &R, lo: T, hi: T, f: impl Fn(EventKey) -> T) -> (Bound<T>, Bound<T>)
where
    R: RangeBounds<EventKey>,
{
    let start = match range.start_bound() {
        Bound::Included(k) => Bound::Included(f(*k)),
        Bound::Excluded(k) => Bound::Excluded(f(*k)),
        Bound::Unbounded => Bound::Included(lo),
    };
    let end = match range.end_bound() {
        Bound::Included(k) => Bound::Included(f(*k)),
        Bound::Excluded(k) => Bound::Excluded(f(*k)),
        Bound::Unbounded => Bound::Included(hi),
    };
    (start, end)
}

/// Decodes every value of a full-table scan.
fn all_values<K, T>(table: &impl ReadableTable<K, &'static [u8]>) -> Result<Vec<T>>
where
    K: Key + 'static,
    T: Stored,
{
    let mut out = Vec::new();
    for item in table.range::<K::SelfType<'_>>(..)? {
        let (_, v) = item?;
        out.push(codec::decode(v.value())?);
    }
    Ok(out)
}

impl Store {
    // ---- meta -------------------------------------------------------------------------------

    /// Raw `meta` value.
    pub fn meta_bytes(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.read(|txn| {
            let t = txn.open_table(tables::META)?;
            Ok(t.get(key)?.map(|g| g.value().to_vec()))
        })
    }

    /// `meta` value written with [`crate::WriteBatch::set_meta_u64`].
    pub fn meta_u64(&self, key: &str) -> Result<Option<u64>> {
        self.read(|txn| read_meta_u64(&txn.open_table(tables::META)?, key))
    }

    // ---- node interning and state ---------------------------------------------------------

    /// Interned id of `outpoint`, if known.
    pub fn node_id_for(&self, outpoint: &Outpoint) -> Result<Option<NodeId>> {
        let key = outpoint.to_key();
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_IDS)?;
            Ok(t.get(&key)?.map(|g| NodeId(g.value())))
        })
    }

    /// Outpoint interned as `id`, if any.
    pub fn outpoint_for(&self, id: NodeId) -> Result<Option<Outpoint>> {
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_IDS_REV)?;
            Ok(t.get(id.0)?.map(|g| Outpoint::from_key(g.value())))
        })
    }

    /// The id to assign to the next new node: the highest interned id plus one (0 when empty).
    pub fn next_node_id(&self) -> Result<NodeId> {
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_IDS_REV)?;
            Ok(NodeId(t.last()?.map_or(0, |(k, _)| k.value() + 1)))
        })
    }

    /// Every interned `(outpoint, id)` pair, in id order (to rebuild the in-memory map).
    pub fn node_ids(&self) -> Result<Vec<(Outpoint, NodeId)>> {
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_IDS_REV)?;
            scan(t.range::<u32>(..)?, Order::Asc, usize::MAX, |k, v| {
                Ok((Outpoint::from_key(v.value()), NodeId(k.value())))
            })
        })
    }

    /// Latest record of a node.
    pub fn node(&self, id: NodeId) -> Result<Option<NodeRecord>> {
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_STATE)?;
            t.get(id.0)?.map(|g| codec::decode(g.value())).transpose()
        })
    }

    /// Every node record (active and departed), in id order.
    pub fn nodes(&self) -> Result<Vec<NodeRecord>> {
        self.read(|txn| all_values::<u32, _>(&txn.open_table(tables::NODE_STATE)?))
    }

    // ---- events -----------------------------------------------------------------------------

    /// Global events in `range` (inclusive/exclusive as given), up to `limit`, in `order`.
    ///
    /// Build bounds with [`EventKey::first_at`] / [`EventKey::last_at`] for time ranges, or
    /// reuse a returned key as a paging cursor (`..cursor` with `Order::Desc`).
    pub fn events(
        &self,
        range: impl RangeBounds<EventKey>,
        order: Order,
        limit: usize,
    ) -> Result<Vec<(EventKey, EventEnvelope)>> {
        let bounds = key_bounds(&range, (0, 0), (u64::MAX, u64::MAX), EventKey::tuple);
        self.read(|txn| {
            let t = txn.open_table(tables::EVENTS)?;
            scan(t.range(bounds)?, order, limit, |k, v| {
                Ok((EventKey::from_tuple(k.value()), codec::decode(v.value())?))
            })
        })
    }

    /// The newest `limit` events, newest first.
    pub fn latest_events(&self, limit: usize) -> Result<Vec<(EventKey, EventEnvelope)>> {
        self.events(.., Order::Desc, limit)
    }

    /// Events of one node in `range`, up to `limit`, in `order`.
    pub fn node_events(
        &self,
        node: NodeId,
        range: impl RangeBounds<EventKey>,
        order: Order,
        limit: usize,
    ) -> Result<Vec<(EventKey, EventEnvelope)>> {
        let n = node.0;
        let bounds = key_bounds(&range, (n, 0, 0), (n, u64::MAX, u64::MAX), |k| {
            (n, k.ts_ms, k.seq)
        });
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_EVENTS)?;
            scan(t.range(bounds)?, order, limit, |k, v| {
                let (_, ts_ms, seq) = k.value();
                Ok((EventKey { ts_ms, seq }, codec::decode(v.value())?))
            })
        })
    }

    /// Events of one app (name is case-insensitive) in `range`, up to `limit`, in `order`.
    pub fn app_events(
        &self,
        app: &str,
        range: impl RangeBounds<EventKey>,
        order: Order,
        limit: usize,
    ) -> Result<Vec<(EventKey, EventEnvelope)>> {
        let name = app.to_ascii_lowercase();
        let a = name.as_str();
        let bounds = key_bounds(&range, (a, 0, 0), (a, u64::MAX, u64::MAX), |k| {
            (a, k.ts_ms, k.seq)
        });
        self.read(|txn| {
            let t = txn.open_table(tables::APP_EVENTS)?;
            scan(t.range(bounds)?, order, limit, |k, v| {
                let (_, ts_ms, seq) = k.value();
                Ok((EventKey { ts_ms, seq }, codec::decode(v.value())?))
            })
        })
    }

    // ---- blocks and chain -----------------------------------------------------------------

    /// Block at `height`.
    pub fn block(&self, height: u32) -> Result<Option<BlockSummary>> {
        self.read(|txn| {
            let t = txn.open_table(tables::BLOCKS)?;
            t.get(height)?.map(|g| codec::decode(g.value())).transpose()
        })
    }

    /// Block with `hash`.
    pub fn block_by_hash(&self, hash: &Hash32) -> Result<Option<BlockSummary>> {
        self.read(|txn| {
            let idx = txn.open_table(tables::BLOCK_HASH)?;
            let Some(height) = idx.get(&hash.0)?.map(|g| g.value()) else {
                return Ok(None);
            };
            let t = txn.open_table(tables::BLOCKS)?;
            t.get(height)?.map(|g| codec::decode(g.value())).transpose()
        })
    }

    /// Highest stored block.
    pub fn tip_block(&self) -> Result<Option<BlockSummary>> {
        self.read(|txn| {
            let t = txn.open_table(tables::BLOCKS)?;
            t.last()?.map(|(_, v)| codec::decode(v.value())).transpose()
        })
    }

    /// Up to `limit` blocks strictly below `height`, highest first. Pass `u32::MAX` for the
    /// newest blocks, or the last returned height as the next page cursor.
    pub fn blocks_before(&self, height: u32, limit: usize) -> Result<Vec<BlockSummary>> {
        self.read(|txn| {
            let t = txn.open_table(tables::BLOCKS)?;
            scan(t.range(..height)?, Order::Desc, limit, |_, v| {
                codec::decode(v.value())
            })
        })
    }

    /// Blocks with `from <= height <= to`, ascending.
    pub fn blocks_range(&self, from: u32, to: u32) -> Result<Vec<BlockSummary>> {
        self.read(|txn| {
            let t = txn.open_table(tables::BLOCKS)?;
            scan(t.range(from..=to)?, Order::Asc, usize::MAX, |_, v| {
                codec::decode(v.value())
            })
        })
    }

    /// Payout rows of the block at `height`, in tier order.
    pub fn block_payouts(&self, height: u32) -> Result<Vec<Payout>> {
        self.read(|txn| {
            let t = txn.open_table(tables::BLOCK_PAYOUTS)?;
            scan(
                t.range((height, 0u8)..=(height, u8::MAX))?,
                Order::Asc,
                usize::MAX,
                |_, v| codec::decode(v.value()),
            )
        })
    }

    /// Payments to `node` as `(height, amount)`, newest first, strictly below `before_height`
    /// when given (paging cursor).
    pub fn payments_for_node(
        &self,
        node: NodeId,
        before_height: Option<u32>,
        limit: usize,
    ) -> Result<Vec<(u32, Amount)>> {
        let n = node.0;
        let end = before_height.map_or(Bound::Included((n, u32::MAX)), |h| Bound::Excluded((n, h)));
        self.read(|txn| {
            let t = txn.open_table(tables::PAYMENTS)?;
            scan(
                t.range((Bound::Included((n, 0)), end))?,
                Order::Desc,
                limit,
                |k, v| Ok((k.value().1, Amount(v.value()))),
            )
        })
    }

    /// Fluxnode txs of `node`, newest first, strictly below `before_height` when given.
    pub fn node_txs_for_node(
        &self,
        node: NodeId,
        before_height: Option<u32>,
        limit: usize,
    ) -> Result<Vec<NodeTx>> {
        let n = node.0;
        let end = before_height.map_or(Bound::Included((n, u32::MAX, u16::MAX)), |h| {
            Bound::Excluded((n, h, 0))
        });
        self.read(|txn| {
            let idx = txn.open_table(tables::NODE_TXS_BY_NODE)?;
            let txs = txn.open_table(tables::NODE_TXS)?;
            scan(
                idx.range((Bound::Included((n, 0, 0)), end))?,
                Order::Desc,
                limit,
                |k, _| {
                    let (_, h, i) = k.value();
                    let v = txs
                        .get((h, i))?
                        .ok_or(StoreError::Inconsistent("node_txs_by_node"))?;
                    codec::decode(v.value())
                },
            )
        })
    }

    /// Fluxnode txs mined at `height`, in block order.
    pub fn node_txs_at_height(&self, height: u32) -> Result<Vec<NodeTx>> {
        self.read(|txn| {
            let t = txn.open_table(tables::NODE_TXS)?;
            scan(
                t.range((height, 0u16)..=(height, u16::MAX))?,
                Order::Asc,
                usize::MAX,
                |_, v| codec::decode(v.value()),
            )
        })
    }

    // ---- apps -------------------------------------------------------------------------------

    /// Every stored app, in name order.
    pub fn apps(&self) -> Result<Vec<AppRecord>> {
        self.read(|txn| all_values::<&str, _>(&txn.open_table(tables::APPS)?))
    }

    /// One app (name is case-insensitive).
    pub fn app(&self, name: &str) -> Result<Option<AppRecord>> {
        let key = name.to_ascii_lowercase();
        self.read(|txn| {
            let t = txn.open_table(tables::APPS)?;
            t.get(key.as_str())?
                .map(|g| codec::decode(g.value()))
                .transpose()
        })
    }

    /// One permanent app message by hash.
    pub fn app_message(&self, hash: &Hash32) -> Result<Option<AppMessageRecord>> {
        self.read(|txn| {
            let t = txn.open_table(tables::APP_MESSAGES)?;
            t.get(&hash.0)?
                .map(|g| codec::decode(g.value()))
                .transpose()
        })
    }

    /// Permanent messages of one app (case-insensitive), in height order.
    pub fn app_messages_for_app(&self, name: &str) -> Result<Vec<AppMessageRecord>> {
        let key = name.to_ascii_lowercase();
        let k = key.as_str();
        self.read(|txn| {
            let idx = txn.open_table(tables::APP_MESSAGES_BY_APP)?;
            let msgs = txn.open_table(tables::APP_MESSAGES)?;
            let lo = (k, 0u32, &[0u8; 32]);
            let hi = (k, u32::MAX, &[u8::MAX; 32]);
            scan(idx.range(lo..=hi)?, Order::Asc, usize::MAX, |key, _| {
                let (_, _, hash) = key.value();
                let v = msgs
                    .get(hash)?
                    .ok_or(StoreError::Inconsistent("app_messages_by_app"))?;
                codec::decode(v.value())
            })
        })
    }

    /// Every pending app message.
    pub fn pending_app_messages(&self) -> Result<Vec<PendingAppMessage>> {
        self.read(|txn| all_values::<&[u8; 32], _>(&txn.open_table(tables::PENDING_APP_MESSAGES)?))
    }

    // ---- mesh -------------------------------------------------------------------------------

    /// Every mesh edge as `(a, b, record)` with `a <= b`.
    pub fn mesh_edges(&self) -> Result<Vec<(NodeId, NodeId, MeshEdgeRecord)>> {
        self.read(|txn| {
            let t = txn.open_table(tables::MESH_EDGES)?;
            scan(
                t.range::<(u32, u32)>(..)?,
                Order::Asc,
                usize::MAX,
                |k, v| {
                    let (a, b) = k.value();
                    Ok((NodeId(a), NodeId(b), codec::decode(v.value())?))
                },
            )
        })
    }

    /// Mesh changes in `range`, up to `limit`, in `order`.
    pub fn mesh_changes(
        &self,
        range: impl RangeBounds<EventKey>,
        order: Order,
        limit: usize,
    ) -> Result<Vec<(EventKey, MeshChangeRecord)>> {
        let bounds = key_bounds(&range, (0, 0), (u64::MAX, u64::MAX), EventKey::tuple);
        self.read(|txn| {
            let t = txn.open_table(tables::MESH_EVENTS)?;
            scan(t.range(bounds)?, order, limit, |k, v| {
                Ok((EventKey::from_tuple(k.value()), codec::decode(v.value())?))
            })
        })
    }

    // ---- metrics ----------------------------------------------------------------------------

    /// Metrics rows whose bucket start lies in `[floor(from_ms), to_ms]`, ascending.
    pub fn metrics_range(
        &self,
        from_ms: u64,
        to_ms: u64,
        resolution: Resolution,
    ) -> Result<Vec<MetricsRow>> {
        let def = match resolution {
            Resolution::Minute => tables::METRICS_1M,
            Resolution::Hour => tables::METRICS_1H,
        };
        let from = resolution.floor(from_ms);
        if from > to_ms {
            return Ok(Vec::new());
        }
        self.read(|txn| {
            let t = txn.open_table(def)?;
            scan(t.range(from..=to_ms)?, Order::Asc, usize::MAX, |_, v| {
                codec::decode(v.value())
            })
        })
    }

    // ---- snapshots --------------------------------------------------------------------------

    /// The newest snapshot taken at or before `ts_ms`, with its timestamp.
    pub fn snapshot_at_or_before<T: DeserializeOwned>(
        &self,
        ts_ms: u64,
    ) -> Result<Option<(u64, T)>> {
        self.read(|txn| {
            let t = txn.open_table(tables::SNAPSHOTS)?;
            let Some(item) = t.range(..=ts_ms)?.next_back() else {
                return Ok(None);
            };
            let (k, v) = item?;
            Ok(Some((
                k.value(),
                codec::decode_blob(v.value(), SNAPSHOT_FORMAT_VERSION)?,
            )))
        })
    }

    /// The newest snapshot, with its timestamp.
    pub fn latest_snapshot<T: DeserializeOwned>(&self) -> Result<Option<(u64, T)>> {
        self.snapshot_at_or_before(u64::MAX)
    }

    /// Timestamps of every stored snapshot, ascending.
    pub fn snapshot_times(&self) -> Result<Vec<u64>> {
        self.read(|txn| {
            let t = txn.open_table(tables::SNAPSHOTS)?;
            scan(t.range::<u64>(..)?, Order::Asc, usize::MAX, |k, _| {
                Ok(k.value())
            })
        })
    }

    // ---- geo --------------------------------------------------------------------------------

    /// Cached geolocation of `ip` and when it was fetched.
    pub fn geo(&self, ip: IpAddr) -> Result<Option<(Geo, u64)>> {
        let key = ip_key(ip);
        self.read(|txn| {
            let t = txn.open_table(tables::GEO_CACHE)?;
            t.get(key.as_slice())?
                .map(|g| codec::decode(g.value()))
                .transpose()
        })
    }

    // ---- diagnostics ------------------------------------------------------------------------

    /// Row count of every table, for health and diagnostics.
    pub fn table_counts(&self) -> Result<Vec<(&'static str, u64)>> {
        macro_rules! counts {
            ($txn:expr, $($name:literal => $def:expr),* $(,)?) => {
                vec![$(($name, $txn.open_table($def)?.len()?)),*]
            };
        }
        self.read(|txn| {
            Ok(counts!(txn,
                "meta" => tables::META,
                "node_ids" => tables::NODE_IDS,
                "node_ids_rev" => tables::NODE_IDS_REV,
                "node_state" => tables::NODE_STATE,
                "node_events" => tables::NODE_EVENTS,
                "events" => tables::EVENTS,
                "snapshots" => tables::SNAPSHOTS,
                "metrics_1m" => tables::METRICS_1M,
                "metrics_1h" => tables::METRICS_1H,
                "blocks" => tables::BLOCKS,
                "block_hash" => tables::BLOCK_HASH,
                "block_payouts" => tables::BLOCK_PAYOUTS,
                "payments" => tables::PAYMENTS,
                "node_txs" => tables::NODE_TXS,
                "node_txs_by_node" => tables::NODE_TXS_BY_NODE,
                "apps" => tables::APPS,
                "app_events" => tables::APP_EVENTS,
                "app_messages" => tables::APP_MESSAGES,
                "app_messages_by_app" => tables::APP_MESSAGES_BY_APP,
                "pending_app_messages" => tables::PENDING_APP_MESSAGES,
                "mesh_edges" => tables::MESH_EDGES,
                "mesh_events" => tables::MESH_EVENTS,
                "geo_cache" => tables::GEO_CACHE,
            ))
        })
    }
}

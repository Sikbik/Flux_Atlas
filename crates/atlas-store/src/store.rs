//! [`Store`]: opening, migrations, durability policy and batch commits.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard};
use std::time::{Duration, Instant};

use redb::{
    Database, Durability, ReadTransaction, ReadableDatabase, ReadableTable, Table, WriteTransaction,
};

use atlas_core::chain::{BlockSummary, NodeTx};
use atlas_core::ids::NodeId;

use crate::batch::{Op, WriteBatch, ip_key};
use crate::codec;
use crate::error::{Result, StoreError};
use crate::records::{CommitStats, Resolution};
use crate::tables::{self, meta_keys};

/// Current database schema version (the version of the last migration).
pub const SCHEMA_VERSION: u64 = 1;

/// One schema migration. Migrations run in order, each in its own write transaction, for every
/// version above the one recorded in `meta.schema_version`.
struct Migration {
    version: u64,
    name: &'static str,
    apply: fn(&WriteTransaction) -> Result<()>,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "initial tables",
    apply: tables::create_all,
}];

/// Tunables for [`Store::open_with`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreOptions {
    /// Minimum time between fsynced (`Durability::Immediate`) commits. Commits in between use
    /// `Durability::None`: visible to readers at once, persisted by the next immediate commit.
    /// A crash therefore loses at most this much write-behind data. Zero makes every commit
    /// immediate.
    pub durable_interval: Duration,
    /// redb page cache size in bytes (`None` keeps the redb default).
    pub cache_size_bytes: Option<usize>,
}

impl Default for StoreOptions {
    fn default() -> Self {
        Self {
            durable_interval: Duration::from_secs(10),
            cache_size_bytes: None,
        }
    }
}

/// Handle to the Flux Atlas database. Cheap to clone and safe to share across threads.
///
/// All methods are synchronous and may block on disk I/O; call them from `spawn_blocking`
/// (or a dedicated writer thread) in async code. Reads use MVCC snapshots and never block
/// on the writer. Only [`Store::compact`] takes the database exclusively.
#[derive(Clone)]
pub struct Store {
    inner: Arc<Inner>,
}

struct Inner {
    /// Readers and committers take the read side; `compact` takes the write side because
    /// redb compaction needs `&mut Database` and no open transactions.
    db: RwLock<Database>,
    path: PathBuf,
    durable_interval: Duration,
    /// Time of the last immediate commit (`None` until the first one).
    last_durable: Mutex<Option<Instant>>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("path", &self.inner.path)
            .field("durable_interval", &self.inner.durable_interval)
            .finish_non_exhaustive()
    }
}

impl Store {
    /// Opens (or creates) the database at `path` with default options, creates all tables,
    /// and runs pending migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with(path, StoreOptions::default())
    }

    /// Like [`Store::open`], with explicit options.
    pub fn open_with(path: impl AsRef<Path>, options: StoreOptions) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let mut builder = Database::builder();
        if let Some(bytes) = options.cache_size_bytes {
            builder.set_cache_size(bytes);
        }
        let db = builder.create(&path)?;
        migrate(&db)?;
        tracing::info!(path = %path.display(), schema = SCHEMA_VERSION, "store opened");
        Ok(Self {
            inner: Arc::new(Inner {
                db: RwLock::new(db),
                path,
                durable_interval: options.durable_interval,
                last_durable: Mutex::new(None),
            }),
        })
    }

    /// Path of the database file.
    pub fn path(&self) -> &Path {
        &self.inner.path
    }

    /// Applies `batch` in one write transaction. Uses `Durability::Immediate` when the last
    /// immediate commit is older than the configured interval (or none happened yet), and
    /// `Durability::None` otherwise.
    pub fn commit(&self, batch: WriteBatch) -> Result<CommitStats> {
        let durable = {
            let last = self
                .inner
                .last_durable
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            last.is_none_or(|t| t.elapsed() >= self.inner.durable_interval)
        };
        self.commit_inner(batch, durable)
    }

    /// Applies `batch` with `Durability::Immediate`, regardless of the interval. Use on
    /// shutdown (an empty batch simply flushes earlier non-durable commits).
    pub fn commit_durable(&self, batch: WriteBatch) -> Result<CommitStats> {
        self.commit_inner(batch, true)
    }

    /// Makes every earlier commit durable (an empty immediate commit).
    pub fn flush(&self) -> Result<CommitStats> {
        self.commit_durable(WriteBatch::new())
    }

    fn commit_inner(&self, batch: WriteBatch, durable: bool) -> Result<CommitStats> {
        let started = Instant::now();
        let ops = batch.ops.len();
        let db = self.db();
        let mut txn = db.begin_write()?;
        txn.set_durability(if durable {
            Durability::Immediate
        } else {
            Durability::None
        })?;
        {
            let mut w = Writer::open(&txn)?;
            for op in batch.ops {
                w.apply(op)?;
            }
            w.finish()?;
        }
        txn.commit()?;
        drop(db);
        if durable {
            *self
                .inner
                .last_durable
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
        }
        let stats = CommitStats {
            ops,
            durable,
            elapsed: started.elapsed(),
        };
        tracing::trace!(
            ops,
            durable,
            elapsed_ms = stats.elapsed.as_millis(),
            "store commit"
        );
        Ok(stats)
    }

    /// Runs `f` in a fresh read transaction.
    pub(crate) fn read<R>(&self, f: impl FnOnce(&ReadTransaction) -> Result<R>) -> Result<R> {
        let db = self.db();
        let txn = db.begin_read()?;
        f(&txn)
    }

    /// Runs `f` in an immediate write transaction (maintenance jobs).
    pub(crate) fn write<R>(&self, f: impl FnOnce(&WriteTransaction) -> Result<R>) -> Result<R> {
        let db = self.db();
        let txn = db.begin_write()?;
        let out = f(&txn)?;
        txn.commit()?;
        drop(db);
        *self
            .inner
            .last_durable
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
        Ok(out)
    }

    fn db(&self) -> RwLockReadGuard<'_, Database> {
        self.inner.db.read().unwrap_or_else(PoisonError::into_inner)
    }

    /// Compacts the database file, reclaiming free pages. Blocks all other store access while
    /// it runs. Makes pending non-durable commits durable first. Returns `true` if the file
    /// was compacted.
    pub fn compact(&self) -> Result<bool> {
        self.flush()?;
        let mut db = self
            .inner
            .db
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        let started = Instant::now();
        let done = db.compact()?;
        tracing::info!(
            compacted = done,
            elapsed_ms = started.elapsed().as_millis(),
            "store compaction"
        );
        Ok(done)
    }
}

/// Creates tables, validates the schema version and runs pending migrations.
fn migrate(db: &Database) -> Result<()> {
    let current = {
        let txn = db.begin_write()?;
        let version = {
            let meta = txn.open_table(tables::META)?;
            read_meta_u64(&meta, meta_keys::SCHEMA_VERSION)?.unwrap_or(0)
        };
        txn.commit()?;
        version
    };
    if current > SCHEMA_VERSION {
        return Err(StoreError::SchemaTooNew {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let txn = db.begin_write()?;
        (m.apply)(&txn)?;
        {
            let mut meta = txn.open_table(tables::META)?;
            meta.insert(
                meta_keys::SCHEMA_VERSION,
                m.version.to_be_bytes().as_slice(),
            )?;
        }
        txn.commit()?;
        tracing::info!(
            version = m.version,
            name = m.name,
            "store migration applied"
        );
    }
    let txn = db.begin_write()?;
    tables::create_all(&txn)?;
    {
        let mut meta = txn.open_table(tables::META)?;
        if meta.get(meta_keys::CREATED_MS)?.is_none() {
            meta.insert(
                meta_keys::CREATED_MS,
                atlas_core::now_ms().to_be_bytes().as_slice(),
            )?;
        }
    }
    txn.commit()?;
    Ok(())
}

/// Reads a u64 `meta` value (8 bytes big-endian).
pub(crate) fn read_meta_u64(
    meta: &impl ReadableTable<&'static str, &'static [u8]>,
    key: &str,
) -> Result<Option<u64>> {
    let Some(guard) = meta.get(key)? else {
        return Ok(None);
    };
    let bytes: [u8; 8] = guard
        .value()
        .try_into()
        .map_err(|_| StoreError::Truncated { what: "meta u64" })?;
    Ok(Some(u64::from_be_bytes(bytes)))
}

type Bytes = &'static [u8];

/// Every table, opened once per commit.
struct Writer<'t> {
    meta: Table<'t, &'static str, Bytes>,
    node_ids: Table<'t, &'static [u8; 36], u32>,
    node_ids_rev: Table<'t, u32, &'static [u8; 36]>,
    node_state: Table<'t, u32, Bytes>,
    node_events: Table<'t, (u32, u64, u64), Bytes>,
    events: Table<'t, (u64, u64), Bytes>,
    snapshots: Table<'t, u64, Bytes>,
    metrics_1m: Table<'t, u64, Bytes>,
    metrics_1h: Table<'t, u64, Bytes>,
    blocks: Table<'t, u32, Bytes>,
    block_hash: Table<'t, &'static [u8; 32], u32>,
    block_payouts: Table<'t, (u32, u8), Bytes>,
    payments: Table<'t, (u32, u32), i64>,
    node_txs: Table<'t, (u32, u16), Bytes>,
    node_txs_by_node: Table<'t, (u32, u32, u16), ()>,
    apps: Table<'t, &'static str, Bytes>,
    app_events: Table<'t, (&'static str, u64, u64), Bytes>,
    app_messages: Table<'t, &'static [u8; 32], Bytes>,
    app_messages_by_app: Table<'t, (&'static str, u32, &'static [u8; 32]), ()>,
    pending: Table<'t, &'static [u8; 32], Bytes>,
    mesh_edges: Table<'t, (u32, u32), Bytes>,
    mesh_events: Table<'t, (u64, u64), Bytes>,
    geo_cache: Table<'t, Bytes, Bytes>,
    chain_points: Table<'t, u32, Bytes>,
    chain_daily: Table<'t, u64, f64>,
    /// Row sequence: loaded lazily, written back in `finish`.
    row_seq: Option<(u64, bool)>,
}

impl<'t> Writer<'t> {
    fn open(txn: &'t WriteTransaction) -> Result<Self> {
        Ok(Self {
            meta: txn.open_table(tables::META)?,
            node_ids: txn.open_table(tables::NODE_IDS)?,
            node_ids_rev: txn.open_table(tables::NODE_IDS_REV)?,
            node_state: txn.open_table(tables::NODE_STATE)?,
            node_events: txn.open_table(tables::NODE_EVENTS)?,
            events: txn.open_table(tables::EVENTS)?,
            snapshots: txn.open_table(tables::SNAPSHOTS)?,
            metrics_1m: txn.open_table(tables::METRICS_1M)?,
            metrics_1h: txn.open_table(tables::METRICS_1H)?,
            blocks: txn.open_table(tables::BLOCKS)?,
            block_hash: txn.open_table(tables::BLOCK_HASH)?,
            block_payouts: txn.open_table(tables::BLOCK_PAYOUTS)?,
            payments: txn.open_table(tables::PAYMENTS)?,
            node_txs: txn.open_table(tables::NODE_TXS)?,
            node_txs_by_node: txn.open_table(tables::NODE_TXS_BY_NODE)?,
            apps: txn.open_table(tables::APPS)?,
            app_events: txn.open_table(tables::APP_EVENTS)?,
            app_messages: txn.open_table(tables::APP_MESSAGES)?,
            app_messages_by_app: txn.open_table(tables::APP_MESSAGES_BY_APP)?,
            pending: txn.open_table(tables::PENDING_APP_MESSAGES)?,
            mesh_edges: txn.open_table(tables::MESH_EDGES)?,
            mesh_events: txn.open_table(tables::MESH_EVENTS)?,
            geo_cache: txn.open_table(tables::GEO_CACHE)?,
            chain_points: txn.open_table(tables::CHAIN_POINTS)?,
            chain_daily: txn.open_table(tables::CHAIN_DAILY)?,
            row_seq: None,
        })
    }

    fn next_seq(&mut self) -> Result<u64> {
        let (seq, _) = match self.row_seq {
            Some(s) => s,
            None => (
                read_meta_u64(&self.meta, meta_keys::ROW_SEQ)?.unwrap_or(0),
                false,
            ),
        };
        let next = seq + 1;
        self.row_seq = Some((next, true));
        Ok(next)
    }

    fn finish(&mut self) -> Result<()> {
        if let Some((seq, true)) = self.row_seq {
            self.meta
                .insert(meta_keys::ROW_SEQ, seq.to_be_bytes().as_slice())?;
        }
        Ok(())
    }

    fn apply(&mut self, op: Op) -> Result<()> {
        match op {
            Op::SetMeta(key, value) => {
                self.meta.insert(key.as_str(), value.as_slice())?;
            }
            Op::DeleteMeta(key) => {
                self.meta.remove(key.as_str())?;
            }
            Op::InternNode(outpoint, id) => {
                let key = outpoint.to_key();
                if let Some(existing) = self.node_ids.get(&key)?.map(|g| g.value())
                    && existing != id.0
                {
                    return Err(StoreError::InternConflict(format!(
                        "{outpoint} is node {existing}, not {id}"
                    )));
                }
                if let Some(existing) = self.node_ids_rev.get(id.0)?.map(|g| *g.value())
                    && existing != key
                {
                    return Err(StoreError::InternConflict(format!(
                        "node {id} is {}, not {outpoint}",
                        atlas_core::Outpoint::from_key(&existing)
                    )));
                }
                self.node_ids.insert(&key, id.0)?;
                self.node_ids_rev.insert(id.0, &key)?;
            }
            Op::PutNode(record) => {
                self.node_state
                    .insert(record.id.0, codec::encode(&*record)?.as_slice())?;
            }
            Op::DeleteNode(id) => {
                self.node_state.remove(id.0)?;
            }
            Op::PushEvent(env) => {
                let seq = self.next_seq()?;
                let ts = env.observed_ms;
                let bytes = codec::encode(&*env)?;
                self.events.insert((ts, seq), bytes.as_slice())?;
                if let Some(node) = env.event.node() {
                    self.node_events
                        .insert((node.0, ts, seq), bytes.as_slice())?;
                }
                if let Some(app) = env.event.app() {
                    let app = app.to_ascii_lowercase();
                    self.app_events
                        .insert((app.as_str(), ts, seq), bytes.as_slice())?;
                }
            }
            Op::PutBlock(block) => self.put_block(&block)?,
            Op::DeleteBlocksFrom(height) => self.delete_blocks_from(height)?,
            Op::PutNodeTx { height, index, tx } => {
                let old = self
                    .node_txs
                    .insert((height, index), codec::encode(&*tx)?.as_slice())?
                    .map(|g| codec::decode::<NodeTx>(g.value()))
                    .transpose()?;
                if let Some(node) = old.and_then(|o| o.node)
                    && Some(node) != tx.node
                {
                    self.node_txs_by_node.remove((node.0, height, index))?;
                }
                if let Some(node) = tx.node {
                    self.node_txs_by_node.insert((node.0, height, index), ())?;
                }
            }
            Op::PutApp(app) => {
                let key = app.name.to_ascii_lowercase();
                self.apps
                    .insert(key.as_str(), codec::encode(&*app)?.as_slice())?;
            }
            Op::DeleteApp(name) => {
                self.apps.remove(name.as_str())?;
            }
            Op::PutAppMessage(msg) => {
                let name = msg.spec.name.to_ascii_lowercase();
                let old = self
                    .app_messages
                    .insert(&msg.hash.0, codec::encode(&*msg)?.as_slice())?
                    .map(|g| codec::decode::<atlas_core::app::AppMessageRecord>(g.value()))
                    .transpose()?;
                if let Some(old) = old {
                    let old_name = old.spec.name.to_ascii_lowercase();
                    if old_name != name || old.height != msg.height {
                        self.app_messages_by_app.remove((
                            old_name.as_str(),
                            old.height,
                            &old.hash.0,
                        ))?;
                    }
                }
                self.app_messages_by_app
                    .insert((name.as_str(), msg.height, &msg.hash.0), ())?;
            }
            Op::PutPending(msg) => {
                self.pending
                    .insert(&msg.hash.0, codec::encode(&*msg)?.as_slice())?;
            }
            Op::DeletePending(hash) => {
                self.pending.remove(&hash.0)?;
            }
            Op::PutMeshEdge(a, b, edge) => {
                self.mesh_edges
                    .insert((a.0, b.0), codec::encode(&edge)?.as_slice())?;
            }
            Op::DeleteMeshEdge(a, b) => {
                self.mesh_edges.remove((a.0, b.0))?;
            }
            Op::PushMeshChange(change) => {
                let seq = self.next_seq()?;
                self.mesh_events.insert(
                    (change.ts_ms, seq),
                    codec::encode_mesh_change(&change)?.as_slice(),
                )?;
            }
            Op::PutMetrics(res, row) => {
                let key = res.floor(row.ts_ms);
                let bytes = codec::encode(&*row)?;
                match res {
                    Resolution::Minute => self.metrics_1m.insert(key, bytes.as_slice())?,
                    Resolution::Hour => self.metrics_1h.insert(key, bytes.as_slice())?,
                };
            }
            Op::PutSnapshot(ts, blob) => {
                self.snapshots.insert(ts, blob.as_slice())?;
            }
            Op::DeleteSnapshot(ts) => {
                self.snapshots.remove(ts)?;
            }
            Op::PutGeo(ip, geo, fetched_ms) => {
                let entry = (*geo, fetched_ms);
                self.geo_cache
                    .insert(ip_key(ip).as_slice(), codec::encode(&entry)?.as_slice())?;
            }
            Op::DeleteGeo(ip) => {
                self.geo_cache.remove(ip_key(ip).as_slice())?;
            }
            Op::PutChainPoint(height, point) => {
                self.chain_points
                    .insert(height, codec::encode(&point)?.as_slice())?;
            }
            Op::PutChainDaily(day_ms, difficulty) => {
                self.chain_daily.insert(day_ms, difficulty)?;
            }
        }
        Ok(())
    }

    fn put_block(&mut self, block: &BlockSummary) -> Result<()> {
        let height = block.height;
        let old = self
            .blocks
            .insert(height, codec::encode(block)?.as_slice())?
            .map(|g| codec::decode::<BlockSummary>(g.value()))
            .transpose()?;
        if let Some(old) = old {
            self.remove_block_rows(&old)?;
        }
        self.block_hash.insert(&block.hash.0, height)?;
        for payout in &block.payouts {
            self.block_payouts.insert(
                (height, payout.tier.as_u8()),
                codec::encode(payout)?.as_slice(),
            )?;
            if let Some(node) = payout.node {
                self.payments.insert((node.0, height), payout.amount.0)?;
            }
        }
        Ok(())
    }

    /// Removes the hash, payout and payment rows of `block` (not the block row itself).
    fn remove_block_rows(&mut self, block: &BlockSummary) -> Result<()> {
        let height = block.height;
        let hash_points_here = self
            .block_hash
            .get(&block.hash.0)?
            .is_some_and(|g| g.value() == height);
        if hash_points_here {
            self.block_hash.remove(&block.hash.0)?;
        }
        self.block_payouts
            .retain_in((height, 0u8)..=(height, u8::MAX), |_, _| false)?;
        for node in block.payouts.iter().filter_map(|p| p.node) {
            self.payments.remove((node.0, height))?;
        }
        Ok(())
    }

    fn delete_blocks_from(&mut self, height: u32) -> Result<()> {
        let mut doomed = Vec::new();
        for item in self.blocks.range(height..)? {
            let (_, v) = item?;
            doomed.push(codec::decode::<BlockSummary>(v.value())?);
        }
        for block in &doomed {
            self.remove_block_rows(block)?;
            self.blocks.remove(block.height)?;
        }
        let mut txs: Vec<((u32, u16), Option<NodeId>)> = Vec::new();
        for item in self.node_txs.range((height, 0u16)..)? {
            let (k, v) = item?;
            txs.push((k.value(), codec::decode::<NodeTx>(v.value())?.node));
        }
        for ((h, i), node) in &txs {
            self.node_txs.remove((*h, *i))?;
            if let Some(node) = node {
                self.node_txs_by_node.remove((node.0, *h, *i))?;
            }
        }
        let mut points = 0usize;
        self.chain_points.retain_in(height.., |_, _| {
            points += 1;
            false
        })?;
        tracing::debug!(
            from = height,
            blocks = doomed.len(),
            node_txs = txs.len(),
            chain_points = points,
            "blocks deleted (reorg)"
        );
        Ok(())
    }
}

// Compile-time check: the handle is shareable across threads.
const _: fn() = || {
    fn assert<T: Send + Sync + Clone>() {}
    assert::<Store>();
};

//! The reducer: one task that owns [`NetworkState`], applies observations, derives events,
//! persists one `WriteBatch` per tick through the store writer, emits live messages, and
//! schedules publishes (off-thread, coalesced to about 1/s, immediately after a block).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::{
    AppIndexEntry, BlockLite, NetworkSummary, SupplyInfo, TierCounts, TierStats, TipInfo, TxLite,
};
use atlas_core::chain::TxKind;
use atlas_core::emission::{next_reduction_height, pon_subsidy, tier_payout};
use atlas_core::event::{Event, EventEnvelope};
use atlas_core::live::{
    AppInstancesDelta, AppsDelta, DeltaCause, FeedKind, FeedRef, LiveBody, MeshDelta,
    NextPayeesMsg, ReorgMsg,
};
use atlas_core::{Amount, Hash32, NodeId, NodeRecord, NodeStatus, Tier, Txid, now_ms};
use atlas_flux::models::apps::APP_PAYMENT_ADDRESS;
use atlas_flux::models::nodes::ListedNode;
use atlas_store::{MeshChangeRecord, MeshEdgeRecord, MeshReporter, MetricsRow, WriteBatch};
use tokio::sync::{Notify, mpsc, oneshot, watch};

use crate::derive::apps as dapps;
use crate::derive::block::{Attribution, apply_block, payee_dto};
use crate::derive::reconcile::{
    apply_dos_list, apply_start_list, is_initial, list_height, reconcile,
};
use crate::derive::round::{apply_round, geo_material_change, watched_feed};
use crate::obs::{Obs, TopologyReport};
use crate::publish::{PublishJob, block_lite, build, build_with};
use crate::state::apps::index_entry;
use crate::state::mesh::Report;
use crate::state::{
    MempoolEntry, NetworkState, Tick, is_listed, mask, node_ref, nodes_body, tx_lite,
};
use crate::timemachine::{NetworkSnapshot, SnapNode};
use crate::{EngineHandle, WatchSet, meta};

/// Channels from the reducer to event-triggered jobs.
#[derive(Clone)]
pub struct JobCmds {
    pub payees: mpsc::Sender<u32>,
    pub chain_feed: mpsc::Sender<(Hash32, u32)>,
    pub geo: mpsc::Sender<(IpAddr, bool)>,
    pub reconcile: Arc<Notify>,
    pub catalog: Arc<Notify>,
}

/// Commands to the store writer thread.
pub enum WriterCmd {
    Commit(WriteBatch),
    Flush(oneshot::Sender<()>),
}

/// Spawns the store writer thread.
pub fn spawn_writer(
    store: atlas_store::Store,
    handle: EngineHandle,
) -> std::sync::mpsc::Sender<WriterCmd> {
    let (tx, rx) = std::sync::mpsc::channel::<WriterCmd>();
    let spawned = std::thread::Builder::new()
        .name("atlas-store-writer".to_owned())
        .spawn(move || {
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    WriterCmd::Commit(batch) => {
                        let ops = batch.len() as u64;
                        match store.commit(batch) {
                            Ok(c) => handle.inner.stats.with(|s| {
                                s.commits += 1;
                                s.commit_ops += ops;
                                s.commit_seconds
                                    .observe(crate::stats::LOCAL_BUCKETS, c.elapsed.as_secs_f64());
                            }),
                            Err(e) => {
                                tracing::error!(error = %e, "store commit failed");
                                handle.inner.stats.with(|s| s.commit_errors += 1);
                            }
                        }
                    }
                    WriterCmd::Flush(ack) => {
                        if let Err(e) = store.flush() {
                            tracing::error!(error = %e, "store flush failed");
                        }
                        let _ = ack.send(());
                    }
                }
            }
            if let Err(e) = store.flush() {
                tracing::warn!(error = %e, "final store flush failed");
            }
        });
    if let Err(e) = spawned {
        tracing::error!(error = %e, "could not spawn the store writer thread");
    }
    tx
}

/// Minimum time between coalesced publishes.
const PUBLISH_MIN_INTERVAL: Duration = Duration::from_secs(1);
/// Minimum time between `mesh.bin` rebuilds.
const MESH_BODY_INTERVAL: Duration = Duration::from_secs(10);
/// Mempool additions are coalesced for this long.
const MEMPOOL_COALESCE: Duration = Duration::from_millis(500);
/// A node list waiting for the block sync is reconciled anyway once no block arrived for this
/// long (the sync is stalled rather than catching up).
const LIST_DEFER_STALL: Duration = Duration::from_secs(90);
/// A block older than this when applied is a catch-up block (gap fill after downtime), not a
/// fresh tip: no `currentwinner` fetch and no tip-latency sample for it.
const CATCH_UP_AGE_MS: u64 = 120_000;

/// A node list that reflects blocks the model has not applied yet.
struct PendingList {
    list: Vec<ListedNode>,
    since: Instant,
}

pub struct Reducer {
    pub st: NetworkState,
    handle: EngineHandle,
    writer: std::sync::mpsc::Sender<WriterCmd>,
    publisher: Option<std::sync::mpsc::Sender<PublishJob>>,
    cmds: Option<JobCmds>,
    obs_tx: mpsc::Sender<Obs>,
    watch_rx: watch::Receiver<WatchSet>,
    last_nodes_seq: u64,
    last_apps_seq: u64,
    mempool_buf: Vec<TxLite>,
    publishing: bool,
    publish_pending: bool,
    publish_urgent: bool,
    last_publish: Instant,
    last_mesh_body: Option<Instant>,
    nodes_arc: Option<Arc<[NodeRecord]>>,
    nodes_bin_tip: u32,
    apps_arc: Option<Arc<[AppIndexEntry]>>,
    blocks_arc: Option<Arc<[BlockLite]>>,
    enterprise: Arc<HashSet<NodeId>>,
    summary: Option<NetworkSummary>,
    last_stats_summary: Option<NetworkSummary>,
    winner_retry_height: u32,
    fresh: bool,
    count_streak: u8,
    install_errors_primed: bool,
    first_ingest_ms: Option<u64>,
    snapshot_after_reconcile: bool,
    next_snapshot_ms: u64,
    live_floor_saved: Option<u32>,
    pending_list: Option<PendingList>,
    last_block_at: Instant,
    /// The last block applied was discontinuous: the next reconcile's differences are expected.
    after_gap: bool,
}

impl Reducer {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        st: NetworkState,
        handle: EngineHandle,
        writer: std::sync::mpsc::Sender<WriterCmd>,
        cmds: Option<JobCmds>,
        obs_tx: mpsc::Sender<Obs>,
        watch_rx: watch::Receiver<WatchSet>,
        first_ingest_ms: Option<u64>,
        last_snapshot_ms: Option<u64>,
    ) -> Self {
        let now = now_ms();
        let hour = 3_600_000;
        let live_floor_saved = st.live_floor;
        let mut st = st;
        st.client_ranks.reset(&st.queue);
        Self {
            st,
            publisher: spawn_publisher(handle.clone(), obs_tx.clone()),
            handle,
            writer,
            cmds,
            obs_tx,
            watch_rx,
            last_nodes_seq: 0,
            last_apps_seq: 0,
            mempool_buf: Vec::new(),
            publishing: false,
            publish_pending: true,
            publish_urgent: true,
            last_publish: Instant::now(),
            last_mesh_body: None,
            nodes_arc: None,
            nodes_bin_tip: 0,
            apps_arc: None,
            blocks_arc: None,
            enterprise: Arc::new(HashSet::new()),
            summary: None,
            last_stats_summary: None,
            winner_retry_height: 0,
            fresh: false,
            count_streak: 0,
            install_errors_primed: false,
            first_ingest_ms,
            snapshot_after_reconcile: last_snapshot_ms.is_none_or(|t| now.saturating_sub(t) > hour),
            next_snapshot_ms: (now / hour + 1) * hour,
            live_floor_saved,
            pending_list: None,
            last_block_at: Instant::now(),
            after_gap: false,
        }
    }

    /// Runs until the observation channel closes.
    pub async fn run(mut self, mut rx: mpsc::Receiver<Obs>) {
        let mut mempool_iv = tokio::time::interval(MEMPOOL_COALESCE);
        mempool_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut publish_iv = tokio::time::interval(Duration::from_millis(250));
        publish_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let first_minute = 60_000 - now_ms() % 60_000;
        let mut minute_iv = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_millis(first_minute),
            Duration::from_secs(60),
        );
        minute_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut housekeeping_iv = tokio::time::interval(Duration::from_secs(10));
        housekeeping_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        self.maybe_publish();
        loop {
            tokio::select! {
                obs = rx.recv() => {
                    let Some(obs) = obs else { break };
                    let mut tick = Tick::new(now_ms());
                    let mut flush = None;
                    match obs {
                        Obs::Flush(ack) => flush = Some(ack),
                        o => self.apply(o, &mut tick),
                    }
                    // Drain what is already queued into the same tick (one commit).
                    let mut n = 0;
                    while flush.is_none() && n < 64 {
                        match rx.try_recv() {
                            Ok(Obs::Flush(ack)) => flush = Some(ack),
                            Ok(o) => self.apply(o, &mut tick),
                            Err(_) => break,
                        }
                        n += 1;
                    }
                    if flush.is_some() {
                        // Store every record with its current rank: the restore orders
                        // nodes that share a queue key by the stored rank.
                        self.st.nodes.persist_all_listed();
                    }
                    self.finish(tick);
                    if let Some(ack) = flush {
                        // Only shutdown flushes: persist everything, then stop.
                        self.flush_mempool();
                        let _ = self.writer.send(WriterCmd::Flush(ack));
                        break;
                    }
                    self.maybe_publish();
                }
                _ = mempool_iv.tick() => self.flush_mempool(),
                _ = publish_iv.tick() => {
                    self.check_watch();
                    self.maybe_publish();
                }
                _ = minute_iv.tick() => self.metrics_minute(),
                _ = housekeeping_iv.tick() => self.housekeeping(),
            }
        }
    }

    fn check_watch(&mut self) {
        if self.watch_rx.has_changed().unwrap_or(false) {
            let w = self.watch_rx.borrow_and_update().clone();
            self.st.watched = w.nodes;
        }
    }

    fn stats(&self) -> &crate::stats::StatsCell {
        &self.handle.inner.stats
    }

    fn fresh(&self) -> &crate::freshness::Freshness {
        &self.handle.inner.freshness
    }

    /// Applies one observation to the state, collecting changes into `tick`.
    #[allow(clippy::too_many_lines)]
    pub fn apply(&mut self, obs: Obs, tick: &mut Tick) {
        let now = tick.now_ms;
        match obs {
            Obs::Tip { hash, received_ms } => {
                self.stats().event("new_tip");
                let _ = (hash, received_ms);
            }
            Obs::Block {
                block,
                received_ms,
                discontinuous,
            } => {
                if self
                    .st
                    .tip
                    .as_ref()
                    .is_some_and(|t| t.hash == block.summary.hash)
                {
                    return;
                }
                let rep = apply_block(&mut self.st, tick, &block, discontinuous);
                let (mut exact, mut fallback, mut none) = (0, 0, 0);
                for a in &rep.attributions {
                    match a {
                        Attribution::Winner | Attribution::QueueHead => exact += 1,
                        Attribution::Fallback => fallback += 1,
                        Attribution::None => none += 1,
                    }
                }
                self.stats().with(|s| {
                    s.payouts_exact += exact;
                    s.payouts_fallback += fallback;
                    s.payouts_unattributed += none;
                });
                let catching_up = now.saturating_sub(block.summary.time_ms) > CATCH_UP_AGE_MS;
                if !catching_up {
                    self.stats()
                        .tip_latency(received_ms as i64 - block.summary.time_ms as i64);
                }
                self.last_block_at = Instant::now();
                if discontinuous {
                    self.st.expiry_armed = false;
                    self.after_gap = true;
                    if let Some(c) = &self.cmds {
                        c.reconcile.notify_one();
                    }
                }
                if let Some(c) = &self.cmds {
                    // `currentwinner` names the payees after the real tip: useless for a
                    // catch-up block.
                    if !catching_up {
                        let _ = c.payees.try_send(block.summary.height);
                    }
                    for p in &block.app_payments {
                        if !self.st.apps.applied.contains(&p.message_hash) {
                            let _ = c
                                .chain_feed
                                .try_send((p.message_hash, block.summary.height));
                        }
                    }
                }
                if self.live_floor_saved != self.st.live_floor
                    && let Some(f) = self.st.live_floor
                {
                    tick.batch.set_meta_u64(meta::LIVE_FLOOR, u64::from(f));
                    self.live_floor_saved = Some(f);
                }
                tick.batch.set_meta_u64(
                    atlas_store::meta_keys::TIP_HEIGHT,
                    u64::from(block.summary.height),
                );
                self.fresh = true;
                self.fresh().ok("block_decoder");
                self.release_pending_list(tick);
            }
            Obs::Reorg {
                fork_height,
                old_tip,
                orphaned,
            } => self.reorg(tick, fork_height, old_tip, orphaned),
            Obs::MempoolTx { tx, received_ms } => {
                // Fluxnode txs pushed by the socket carry a txid that resolves nowhere
                // (measured: none of 66 such pushes was in the gateway mempool, in a block or
                // in Insight's own /api/tx). They are not mempool entries: the reconcile
                // finds the real ones and the fetch classifies them.
                if tx.is_node_tx() {
                    self.stats().event("mempool_node_push_ignored");
                    self.fresh().ok("mempool_stream");
                    return;
                }
                if tx.is_coinbase_like() || self.st.mempool.contains_key(&tx.txid) {
                    return;
                }
                let kind = if tx.outputs.iter().any(|(a, _)| a == APP_PAYMENT_ADDRESS) {
                    TxKind::AppMessage
                } else {
                    TxKind::Transfer
                };
                self.st.mempool.insert(
                    tx.txid,
                    MempoolEntry {
                        kind,
                        value: tx.value_out,
                        size: None,
                        first_seen_ms: received_ms,
                    },
                );
                self.mempool_buf
                    .push(tx_lite(tx.txid, tx.value_out, kind, None));
                self.stats().event("mempool_tx");
                tick.event(
                    Event::MempoolTx {
                        txid: tx.txid,
                        value: tx.value_out,
                        kind,
                        output_count: tx.outputs.len() as u16,
                    },
                    Some(received_ms),
                );
                self.st.summary_dirty = true;
                tick.publish = true;
                self.fresh().ok("mempool_stream");
            }
            Obs::MempoolSnapshot(sizes) => {
                let before = self.st.mempool.len();
                self.st.mempool.retain(|t, e| {
                    sizes.contains_key(t) || now.saturating_sub(e.first_seen_ms) < 90_000
                });
                // The reconcile knows every size the socket push did not carry.
                for (t, e) in &mut self.st.mempool {
                    if e.size.is_none()
                        && let Some(s) = sizes.get(t).filter(|s| **s > 0)
                    {
                        e.size = Some(*s);
                        tick.publish = true;
                    }
                }
                if self.st.mempool.len() != before {
                    self.st.summary_dirty = true;
                    tick.publish = true;
                }
                self.st.mempool_set = sizes.into_keys().collect();
            }
            Obs::MempoolClassified {
                txid,
                kind,
                value,
                size,
                output_count,
            } => self.mempool_classified(tick, txid, kind, value, size, output_count),
            Obs::SocketInfo(info) => {
                if let Some(total) = info.supply {
                    let prev = self.st.supply.clone();
                    self.st.supply = Some(SupplyInfo {
                        height: info.height.unwrap_or_else(|| self.st.tip_height()),
                        transparent: prev.as_ref().map_or(Amount::ZERO, |p| p.transparent),
                        shielded: prev.as_ref().map_or(Amount::ZERO, |p| p.shielded),
                        total,
                        circulating_explorer: prev.and_then(|p| p.circulating_explorer),
                        updated_ms: now,
                    });
                    self.st.summary_dirty = true;
                    tick.publish = true;
                }
            }
            Obs::Price(p) => {
                tick.event(
                    Event::Price {
                        usd: p.usd,
                        btc: p.btc,
                        change_24h_pct: p.change_24h_pct,
                        market_cap_usd: p.market_cap_usd,
                        volume_24h_usd: p.volume_24h_usd,
                    },
                    Some(p.updated_ms),
                );
                self.st.price = Some(p);
                self.st.summary_dirty = true;
                tick.publish = true;
                self.fresh().ok("price");
            }
            Obs::Winners { height, winners } => self.winners(tick, height, &winners),
            Obs::NodeList(list) => self.node_list(tick, list),
            Obs::NodeCount(c) => {
                let mut local = [0u32; 3];
                for e in self.st.nodes.listed() {
                    if e.rec.status == NodeStatus::Confirmed
                        && let Some(i) = e.rec.tier.index()
                    {
                        local[i] += 1;
                    }
                }
                let up = [c.cumulus, c.nimbus, c.stratus];
                self.st.upstream_counts = Some(up);
                let off = local.iter().zip(up.iter()).any(|(a, b)| a.abs_diff(*b) > 3);
                if off && self.st.expiry_armed {
                    self.count_streak += 1;
                    if self.count_streak >= 2 {
                        tracing::warn!(?local, ?up, "node counts disagree; reconciling now");
                        self.count_streak = 0;
                        if let Some(cmds) = &self.cmds {
                            cmds.reconcile.notify_one();
                        }
                    }
                } else {
                    self.count_streak = 0;
                }
                self.fresh().ok("node_count");
            }
            Obs::StartList(list) => {
                let d = apply_start_list(&mut self.st, tick, &list);
                if d > 0 {
                    tracing::warn!(diffs = d, "start list cross-check differences");
                    self.stats().with(|s| {
                        *s.reconcile_diff_fields
                            .entry("start_list".into())
                            .or_default() += u64::from(d);
                        s.reconcile_diffs += u64::from(d);
                    });
                }
            }
            Obs::DosList(list) => {
                let d = apply_dos_list(&mut self.st, tick, &list);
                if d > 0 {
                    tracing::warn!(diffs = d, "DOS list cross-check differences");
                    self.stats().with(|s| {
                        *s.reconcile_diff_fields
                            .entry("dos_list".into())
                            .or_default() += u64::from(d);
                        s.reconcile_diffs += u64::from(d);
                    });
                }
                self.fresh().ok("start_dos_lists");
            }
            Obs::Pending(msgs) => {
                dapps::apply_pending(&mut self.st, tick, msgs);
                self.fresh().ok("app_pending");
            }
            Obs::Installing(rows) => {
                dapps::apply_installing(&mut self.st, tick, rows);
                self.fresh().ok("app_installing");
            }
            Obs::Locations { rows, scope } => {
                let d = dapps::apply_placement(&mut self.st, tick, rows, scope.as_deref());
                let (s, r, u) = d.count();
                if s + r + u > 0 {
                    tracing::debug!(started = s, removed = r, updated = u, scope = ?scope, "placement diff");
                }
                if scope.is_none() {
                    self.fresh().ok("app_placement");
                }
            }
            Obs::Catalog(specs) => {
                let rep = dapps::apply_catalog(&mut self.st, tick, specs);
                if rep.added + rep.updated + rep.removed > 0 {
                    tracing::info!(?rep, "app catalog merged");
                }
                self.fresh().ok("app_catalog");
            }
            Obs::InstallErrors(rows) => {
                let prime = !self.install_errors_primed;
                self.install_errors_primed = true;
                dapps::apply_install_errors(&mut self.st, tick, rows, prime);
            }
            Obs::AppMessage(msg) => {
                if dapps::apply_app_message(&mut self.st, tick, &msg)
                    && let Some(c) = &self.cmds
                {
                    c.catalog.notify_one();
                }
                self.fresh().ok("app_chain_feed");
            }
            Obs::AppMessagesBackfill(msgs) => self.app_history(tick, msgs),
            Obs::Supply {
                height,
                transparent,
                shielded,
            } => {
                let circ = self.st.supply.as_ref().and_then(|s| s.circulating_explorer);
                self.st.supply = Some(SupplyInfo {
                    height,
                    transparent,
                    shielded,
                    total: transparent + shielded,
                    circulating_explorer: circ,
                    updated_ms: now,
                });
                self.st.summary_dirty = true;
                tick.publish = true;
                self.fresh().ok("supply");
            }
            Obs::Circulating(a) => {
                if let Some(s) = &mut self.st.supply {
                    s.circulating_explorer = Some(a);
                    self.st.summary_dirty = true;
                    tick.publish = true;
                }
            }
            Obs::StatsRound { round_ms, rows } => {
                let rep = apply_round(&mut self.st, tick, round_ms, &rows);
                tracing::info!(?rep, "stats round applied");
                self.fresh().ok("stats_round");
                self.request_geo_for_unlocated();
            }
            Obs::Geo {
                ip,
                geo,
                fetched_ms,
                cached,
            } => self.geo(tick, ip, &geo, fetched_ms, cached),
            Obs::Topology { queried, reports } => self.topology(tick, queried, reports),
            Obs::Probe { ip, ok } => self.probe(tick, ip, ok),
            Obs::BackfillBlocks(blocks) => self.backfill_blocks(tick, &blocks),
            Obs::HistoryStats(points) => self.history_stats(tick, &points),
            Obs::Meta { key, value } => {
                tick.batch.set_meta_u64(key, value);
            }
            Obs::PublishDone { elapsed_ms } => {
                self.publishing = false;
                self.stats().with(|s| {
                    s.publishes += 1;
                    s.publish_last_ms = elapsed_ms;
                    s.publish_max_ms = s.publish_max_ms.max(elapsed_ms);
                    s.publish_seconds
                        .observe(crate::stats::LOCAL_BUCKETS, elapsed_ms as f64 / 1000.0);
                });
            }
            Obs::GeoIp(g) => {
                tracing::info!(
                    version = ?g.version,
                    bytes = g.db.info().bytes,
                    "geoip: database loaded"
                );
                self.st.geoip = Some(g);
                let n = crate::geoip::enrich_all(&mut self.st, Some(tick));
                tracing::info!(nodes = n, "geoip: nodes enriched");
                tick.publish = true;
            }
            Obs::Flush(ack) => {
                let _ = self.writer.send(WriterCmd::Flush(ack));
            }
        }
    }

    /// A node list arrived. A list that reflects blocks the model has not applied yet (the block
    /// sync is still catching up, typically right after a restart) waits for them: adopting it
    /// first would roll the model forward, and the catch-up blocks would then pay and rotate the
    /// same nodes a second time. Every rank would differ from the model and from what clients
    /// hold, and clients would get a correction for nearly every node.
    fn node_list(&mut self, tick: &mut Tick, list: Vec<ListedNode>) {
        let height = list_height(&list);
        let tip = self.st.tip_height();
        if self.st.tip.is_some() && height > tip && !is_initial(&self.st, &list) {
            let since = self
                .pending_list
                .as_ref()
                .map_or_else(Instant::now, |p| p.since);
            if self.pending_list.is_none() {
                tracing::info!(
                    list_height = height,
                    tip,
                    "node list is ahead of the applied chain; reconciling once the blocks are applied"
                );
            }
            self.pending_list = Some(PendingList { list, since });
            return;
        }
        self.pending_list = None;
        self.reconcile_list(tick, &list);
    }

    /// Reconciles a deferred node list once the chain reached its height, or when the block
    /// sync has stalled (no block for [`LIST_DEFER_STALL`]): a stale model is then better
    /// corrected than kept.
    fn release_pending_list(&mut self, tick: &mut Tick) {
        let Some(p) = &self.pending_list else { return };
        let height = list_height(&p.list);
        let caught_up = self.st.tip_height() >= height;
        let stalled = p.since.elapsed() >= LIST_DEFER_STALL
            && self.last_block_at.elapsed() >= LIST_DEFER_STALL;
        if !caught_up && !stalled {
            return;
        }
        let Some(p) = self.pending_list.take() else {
            return;
        };
        if stalled && !caught_up {
            tracing::warn!(
                list_height = height,
                tip = self.st.tip_height(),
                "block sync stalled behind the node list; reconciling anyway"
            );
        }
        self.reconcile_list(tick, &p.list);
    }

    fn reconcile_list(&mut self, tick: &mut Tick, list: &[ListedNode]) {
        let rep = reconcile(&mut self.st, tick, list);
        // Differences right after a chain discontinuity (a jump over a gap too large to
        // replay) are expected: the skipped blocks were never applied.
        let after_gap = std::mem::take(&mut self.after_gap);
        let expected = rep.initial || after_gap;
        let total = rep.total_diffs();
        self.stats().with(|s| {
            s.reconciles += 1;
            if !expected {
                s.reconcile_diffs += u64::from(total);
                for (k, v) in &rep.diffs {
                    *s.reconcile_diff_fields.entry((*k).to_owned()).or_default() += u64::from(*v);
                }
                if rep.rank_diffs > 0 {
                    *s.reconcile_diff_fields
                        .entry("rank".to_owned())
                        .or_default() += u64::from(rep.rank_diffs);
                }
            }
        });
        if total > 0 && after_gap && !rep.initial {
            tracing::info!(
                list_height = rep.list_height,
                diffs = ?rep.diffs,
                rank_diffs = rep.rank_diffs,
                added = rep.added,
                removed = rep.removed,
                "reconcile after a chain gap adopted the list (expected differences)"
            );
        } else if total > 0 && !expected {
            tracing::warn!(
                list_height = rep.list_height,
                diffs = ?rep.diffs,
                rank_diffs = rep.rank_diffs,
                added = rep.added,
                removed = rep.removed,
                skipped_newer = rep.skipped_newer,
                reattributed = rep.reattributed,
                "reconcile found differences (bug signal)"
            );
        } else {
            tracing::info!(
                list_height = rep.list_height,
                listed = rep.listed,
                added = rep.added,
                removed = rep.removed,
                initial = rep.initial,
                after_gap,
                diffs = total,
                reattributed = rep.reattributed,
                "reconcile clean"
            );
        }
        self.request_geo_for_unlocated();
        self.fresh = true;
        self.fresh().ok("node_registry");
        if self.snapshot_after_reconcile {
            self.snapshot_after_reconcile = false;
            self.snapshot(tick);
        }
    }

    fn reorg(&mut self, tick: &mut Tick, fork_height: u32, old_tip: u32, orphaned: Vec<Hash32>) {
        let now = tick.now_ms;
        tick.batch.delete_blocks_from(fork_height + 1);
        self.st.recent.retain(|b| b.height <= fork_height);
        self.st.tip = self.st.recent.back().map(|b| TipInfo {
            height: b.height,
            hash: b.hash,
            time_ms: b.time_ms,
            producer: b.producer,
        });
        self.st.expected_payees.clear();
        self.st.blocks_dirty = true;
        tick.event(
            Event::Reorg {
                fork_height,
                old_tip,
                new_tip: fork_height,
                orphaned: orphaned.clone(),
            },
            None,
        );
        tick.primary.push((
            LiveBody::Reorg(ReorgMsg {
                fork_height,
                from_height: old_tip,
                to_height: fork_height,
                orphaned,
            }),
            None,
        ));
        tick.feed(
            FeedKind::Reorg,
            vec![FeedRef::Block {
                height: fork_height,
            }],
            &[("depth", old_tip.saturating_sub(fork_height).to_string())],
            now,
        );
        self.stats().with(|s| s.reorgs += 1);
        tracing::warn!(fork_height, old_tip, "chain reorganized");
        if let Some(c) = &self.cmds {
            c.reconcile.notify_one();
        }
        tick.publish_now = true;
    }

    fn winners(
        &mut self,
        tick: &mut Tick,
        height: u32,
        winners: &[(Tier, Option<atlas_core::Outpoint>, String)],
    ) {
        let resolved: Vec<(Tier, Option<NodeId>, String)> = winners
            .iter()
            .map(|(t, op, a)| (*t, op.and_then(|o| self.st.nodes.id_of(&o)), a.clone()))
            .collect();
        let tip = self.st.tip_height();
        if height != tip + 1 {
            return;
        }
        // An upstream that has not processed the tip yet names the winners of the tip block,
        // which the tip block already paid: stale, ask again once.
        let stale = resolved.iter().any(|(_, n, _)| {
            n.and_then(|n| self.st.nodes.rec(n))
                .is_some_and(|r| r.last_paid_height == Some(tip))
        });
        if stale {
            self.stats().with(|s| s.winner_stale += 1);
            if self.winner_retry_height != height {
                self.winner_retry_height = height;
                if let Some(c) = &self.cmds {
                    let _ = c.payees.try_send(tip);
                }
            }
            return;
        }
        // Before the registry is loaded the local queue only holds nodes seen in blocks (no
        // payment address yet); that is not a disagreement worth counting.
        let ready = self
            .st
            .next_payees
            .iter()
            .all(|p| p.node.is_some() && !p.address.is_empty());
        let mut mismatch = false;
        for (t, n, _) in resolved.iter().filter(|_| ready) {
            let local = self
                .st
                .next_payees
                .iter()
                .find(|p| p.tier == *t)
                .and_then(|p| p.node);
            if n.is_some() && local != *n {
                mismatch = true;
            }
        }
        if ready {
            self.stats().with(|s| {
                s.winner_checks += 1;
                if mismatch {
                    s.winner_mismatches += 1;
                }
            });
        }
        if mismatch || !ready {
            if mismatch {
                tracing::warn!(height, ?resolved, local = ?self.st.next_payees, "currentwinner disagrees with the local queue (bug signal)");
            }
            let payees: Vec<atlas_core::event::NextPayee> = resolved
                .iter()
                .map(|(t, n, a)| atlas_core::event::NextPayee {
                    tier: *t,
                    node: *n,
                    address: a.as_str().into(),
                })
                .collect();
            self.st.next_payees.clone_from(&payees);
            tick.after.push((
                LiveBody::NextPayees(NextPayeesMsg {
                    height,
                    payees: payees.iter().map(payee_dto).collect(),
                }),
                None,
            ));
        }
        self.st.expected_payees.insert(height, resolved);
        while self.st.expected_payees.len() > 8 {
            self.st.expected_payees.pop_first();
        }
        self.fresh().ok("next_payees");
    }

    fn request_geo_for_unlocated(&self) {
        let Some(c) = &self.cmds else { return };
        let mut seen = HashSet::new();
        for e in self.st.nodes.listed() {
            // An approximate (local GeoIP) location still asks for a precise one.
            if e.rec
                .geo
                .as_ref()
                .is_some_and(atlas_core::node::Geo::is_precise)
            {
                continue;
            }
            if let Some(ep) = e.rec.endpoint
                && seen.insert(ep.ip)
                && c.geo.try_send((ep.ip, false)).is_err()
            {
                break;
            }
        }
    }

    fn geo(
        &mut self,
        tick: &mut Tick,
        ip: IpAddr,
        geo: &atlas_core::node::Geo,
        fetched_ms: u64,
        cached: bool,
    ) {
        if !cached {
            tick.batch.put_geo(ip, geo.clone(), fetched_ms);
        }
        if !geo.has_coords() {
            return;
        }
        // Local GeoIP adds the city (and the region when missing).
        let geo = &crate::geoip::enriched(&self.st, Some(ip), geo.clone());
        for id in self.st.nodes.on_ip(ip) {
            let changed = self
                .st
                .nodes
                .rec(id)
                .is_some_and(|r| geo_material_change(r.geo.as_ref(), geo));
            if !changed {
                continue;
            }
            if let Some(e) = self.st.nodes.get_mut(id) {
                e.rec.geo = Some(geo.clone());
            }
            self.st.nodes.touch_persist(id);
            tick.event(
                Event::NodeLocated {
                    node: id,
                    geo: Box::new(geo.clone()),
                },
                None,
            );
            tick.node_changed(DeltaCause::Geo, id, mask::GEO | mask::FLAGS);
            self.st.summary_dirty = true;
        }
        self.fresh().ok("geo_resolve");
    }

    fn topology(
        &mut self,
        tick: &mut Tick,
        queried: atlas_core::NodeEndpoint,
        reports: Vec<TopologyReport>,
    ) {
        let now = tick.now_ms;
        let mut batch: Vec<(NodeId, Report)> = Vec::new();
        for r in reports {
            let Some(rid) = self.st.nodes.resolve_endpoint(&r.reporter) else {
                continue;
            };
            let resolve = |eps: &[atlas_core::NodeEndpoint]| {
                eps.iter()
                    .filter_map(|e| self.st.nodes.resolve_endpoint(e))
                    .filter(|n| *n != rid)
                    .collect()
            };
            let rep = Report {
                outbound: resolve(&r.outbound),
                inbound: resolve(&r.inbound),
                at_ms: now,
            };
            batch.push((rid, rep));
        }
        let continents: HashMap<NodeId, String> = batch
            .iter()
            .flat_map(|(r, rep)| {
                std::iter::once(*r)
                    .chain(rep.outbound.iter().copied())
                    .chain(rep.inbound.iter().copied())
            })
            .filter_map(|n| {
                self.st
                    .nodes
                    .rec(n)
                    .and_then(|r| r.geo.as_ref())
                    .map(|g| (n, g.continent_code.to_string()))
            })
            .collect();
        let cross = |a: NodeId, b: NodeId| match (continents.get(&a), continents.get(&b)) {
            (Some(x), Some(y)) => !x.is_empty() && !y.is_empty() && x != y,
            _ => false,
        };
        let diff = self.st.mesh.merge(batch, &cross);
        for r in &diff.reporters {
            if let Some((o, i)) = self.st.mesh.peer_counts(*r)
                && let Some(e) = self.st.nodes.get_mut(*r)
            {
                e.rec.peers_out = o;
                e.rec.peers_in = i;
            }
        }
        self.persist_mesh(tick, &diff, MeshReporter::Endpoint(queried));
        tick.event(
            Event::TopologySwept {
                reporter: queried,
                reporters: diff.reporters.len() as u32,
                edges_added: diff.added.len() as u32,
                edges_removed: diff.removed.len() as u32,
            },
            None,
        );
        self.fresh().ok("topology_sweep");
    }

    fn persist_mesh(
        &mut self,
        tick: &mut Tick,
        diff: &crate::state::mesh::MeshDiff,
        reporter: MeshReporter,
    ) {
        let now = tick.now_ms;
        for (a, b, f) in diff.added.iter().chain(diff.reflagged.iter()) {
            let first = *self.st.mesh.first_seen.entry((*a, *b)).or_insert(now);
            tick.batch.put_mesh_edge(
                *a,
                *b,
                MeshEdgeRecord {
                    flags: *f,
                    first_seen_ms: first,
                    last_seen_ms: now,
                },
            );
        }
        for (a, b) in &diff.removed {
            tick.batch.delete_mesh_edge(*a, *b);
        }
        if diff.added.is_empty() && diff.removed.is_empty() {
            if !diff.reporters.is_empty() {
                tick.after.push((
                    LiveBody::Mesh(MeshDelta {
                        added: Vec::new(),
                        removed: Vec::new(),
                        reporters: diff.reporters.clone(),
                    }),
                    None,
                ));
            }
            return;
        }
        tick.batch.push_mesh_change(MeshChangeRecord {
            ts_ms: now,
            reporter,
            added: diff.added.iter().map(|(a, b, _)| (*a, *b)).collect(),
            removed: diff.removed.clone(),
        });
        tick.after.push((
            LiveBody::Mesh(MeshDelta {
                added: diff.added.iter().map(|(a, b, _)| [*a, *b]).collect(),
                removed: diff.removed.iter().map(|(a, b)| [*a, *b]).collect(),
                reporters: diff.reporters.clone(),
            }),
            None,
        ));
        tick.publish = true;
    }

    fn probe(&mut self, tick: &mut Tick, ip: IpAddr, ok: bool) {
        let now = tick.now_ms;
        for id in self.st.nodes.on_ip(ip) {
            let mut ev = None;
            if let Some(e) = self.st.nodes.get_mut(id) {
                if ok {
                    e.probe_failures = 0;
                    if e.rec.reachable != Some(true) {
                        if e.rec.reachable == Some(false) {
                            ev = Some(Event::NodeRecovered { node: id });
                        }
                        e.rec.reachable = Some(true);
                    }
                } else {
                    e.probe_failures = e.probe_failures.saturating_add(1);
                    if e.probe_failures >= 2 && e.rec.reachable != Some(false) {
                        e.rec.reachable = Some(false);
                        ev = Some(Event::NodeUnreachable { node: id });
                    }
                }
            }
            if let Some(ev) = ev {
                watched_feed(tick, &ev, id, now);
                tick.event(ev, Some(now));
                tick.node_changed(DeltaCause::Sweep, id, mask::REACHABLE);
                self.st.nodes.touch_persist(id);
                self.st.summary_dirty = true;
            }
        }
        self.fresh().ok("watch_probe");
    }

    fn app_history(&mut self, tick: &mut Tick, msgs: Vec<atlas_core::app::AppMessageRecord>) {
        let mut first_register: HashMap<String, u32> = HashMap::new();
        for m in msgs {
            if m.kind == atlas_core::event::AppMessageKind::Register {
                let e = first_register.entry(m.spec.key()).or_insert(m.height);
                *e = (*e).min(m.height);
            }
            tick.batch.put_app_message(m);
        }
        for (name, h) in first_register {
            if let Some(r) = self.st.apps.records.get_mut(&name)
                && r.registered_height.is_none_or(|x| h < x)
            {
                r.registered_height = Some(h);
                tick.batch.put_app(r.clone());
            }
        }
    }

    fn backfill_blocks(&mut self, tick: &mut Tick, blocks: &[atlas_flux::decode::DecodedBlock]) {
        let now = tick.now_ms;
        let mut by_addr: HashMap<(Tier, &str), Vec<NodeId>> = HashMap::new();
        for e in self.st.nodes.listed() {
            by_addr
                .entry((e.rec.tier, e.rec.payment_address.as_str()))
                .or_default()
                .push(e.rec.id);
        }
        let mut resolved: Vec<(
            atlas_core::chain::BlockSummary,
            Vec<atlas_core::chain::NodeTx>,
        )> = Vec::new();
        for d in blocks {
            let mut s = d.summary.clone();
            for p in &mut s.payouts {
                if let Some(v) = by_addr.get(&(p.tier, p.address.as_str()))
                    && v.len() == 1
                {
                    p.node = Some(v[0]);
                }
            }
            s.producer = s.producer_collateral.as_ref().and_then(|c| {
                let mut found = None;
                for e in self.st.nodes.listed() {
                    if c.matches(&e.rec.outpoint) {
                        if found.is_some() {
                            return None;
                        }
                        found = Some(e.rec.id);
                    }
                }
                found
            });
            resolved.push((s, d.node_txs.clone()));
        }
        drop(by_addr);
        let n = resolved.len() as u64;
        for (s, txs) in resolved {
            let h = s.height;
            for (i, mut tx) in txs.into_iter().enumerate() {
                let (id, _) = self.st.nodes.intern(tx.collateral, now);
                tx.node = Some(id);
                tick.batch.put_node_tx(h, i as u16, tx);
            }
            tick.batch.put_block(s);
        }
        self.stats().with(|s| s.backfilled_blocks += n);
    }

    fn history_stats(&mut self, tick: &mut Tick, points: &[(u64, [u32; 3])]) {
        let cutoff = self.first_ingest_ms.unwrap_or(u64::MAX);
        let cutoff_hour = cutoff - cutoff % 3_600_000;
        let mut hours: BTreeMap<u64, MetricsRow> = BTreeMap::new();
        for (ts, c) in points {
            if *ts >= cutoff {
                continue;
            }
            // The history only carries tier counts: every other series stays unknown.
            let row = MetricsRow {
                ts_ms: *ts,
                tier_counts: Some(*c),
                node_count: Some(c.iter().sum()),
                samples: 1,
                ..MetricsRow::default()
            };
            let hour = ts - ts % 3_600_000;
            if hour < cutoff_hour {
                hours.insert(
                    hour,
                    MetricsRow {
                        ts_ms: hour,
                        ..row.clone()
                    },
                );
            }
            tick.batch.put_metrics_1m(row);
        }
        for (_, r) in hours {
            tick.batch.put_metrics_1h(r);
        }
    }

    /// Emits, persists and schedules everything a tick produced.
    fn finish(&mut self, mut tick: Tick) {
        let now = tick.now_ms;
        let tip = self.st.tip_height();
        // Nodes that left: drop their mesh edges.
        for id in tick.removed_nodes() {
            let d = self.st.mesh.remove_node(id);
            for (a, b) in &d.removed {
                tick.batch.delete_mesh_edge(*a, *b);
            }
        }
        // New or moved endpoints: GeoResolve right away (it answers from its cache when the
        // location is known, so a changed IP is re-located within seconds).
        // During a cold start (most nodes unlocated) the stats round locates everyone in one
        // call; per-IP lookups then only fill the gaps it leaves.
        let new_eps = tick.new_endpoints();
        let steady = !new_eps.is_empty() && {
            let (mut located, mut total) = (0usize, 0usize);
            for e in self.st.nodes.listed() {
                total += 1;
                if e.rec
                    .geo
                    .as_ref()
                    .is_some_and(atlas_core::node::Geo::is_precise)
                {
                    located += 1;
                }
            }
            total > 0 && located * 2 > total
        };
        if let Some(c) = self.cmds.as_ref().filter(|_| steady) {
            for id in new_eps {
                if let Some(ep) = self.st.nodes.rec(id).and_then(|r| r.endpoint) {
                    let _ = c.geo.try_send((ep.ip, true));
                }
            }
        }

        let mut first_seq: Option<u64> = None;
        let mut emit = |this: &mut Self, body: LiveBody, event_ms: Option<u64>| -> u64 {
            let t = live_kind(&body);
            if let (LiveBody::Block(b), Some(_)) = (&body, event_ms) {
                this.stats()
                    .block_latency(now_ms() as i64 - b.time_ms as i64);
            }
            let m = this.handle.emit(event_ms, body);
            this.stats().live(t);
            if first_seq.is_none() {
                first_seq = Some(m.seq);
            }
            m.seq
        };
        for (body, ms) in std::mem::take(&mut tick.primary) {
            emit(self, body, ms);
        }
        let deltas = tick.take_node_deltas();
        let fixes = if deltas.is_empty() {
            Vec::new()
        } else {
            self.rank_corrections(&deltas)
        };
        for (cause, b) in deltas {
            let body = nodes_body(&self.st.nodes, cause, &b, self.last_nodes_seq, tip, now);
            self.last_nodes_seq = emit(self, body, None);
        }
        // Rank contract: authoritative ranks wherever the clients' rotation diverged, after
        // every other delta of this tick.
        if !fixes.is_empty() {
            let mut b = crate::state::NodesDeltaBuilder::default();
            for id in &fixes {
                b.changed.insert(*id, mask::RANK);
            }
            let body = nodes_body(
                &self.st.nodes,
                DeltaCause::Reconcile,
                &b,
                self.last_nodes_seq,
                tip,
                now,
            );
            self.last_nodes_seq = emit(self, body, None);
            self.stats().with(|s| {
                s.rank_corrections += fixes.len() as u64;
                s.rank_correction_msgs += 1;
            });
        }
        for (cause, b) in tick.take_app_deltas() {
            let body = LiveBody::Apps(AppsDelta {
                prev_seq: self.last_apps_seq,
                upserted: b
                    .upserted
                    .iter()
                    .filter_map(|n| self.st.apps.records.get(n))
                    .map(index_entry)
                    .collect(),
                removed: b.removed.iter().cloned().collect(),
                instances: b
                    .instances
                    .iter()
                    .map(|(app, [s, r, u])| AppInstancesDelta {
                        app: app.clone(),
                        started: s.iter().copied().collect(),
                        removed: r.iter().copied().collect(),
                        updated: u.iter().copied().collect(),
                    })
                    .collect(),
                cause,
            });
            self.last_apps_seq = emit(self, body, None);
            self.st.apps.dirty = true;
        }
        for (body, ms) in std::mem::take(&mut tick.after) {
            emit(self, body, ms);
        }
        for item in std::mem::take(&mut tick.feed) {
            let ts = item.ts_ms;
            emit(self, LiveBody::Feed(item), Some(ts));
        }
        let seq = first_seq.unwrap_or_else(|| self.handle.seq());
        for (event, event_ms) in std::mem::take(&mut tick.events) {
            self.stats().event(event.kind());
            if !persisted(&event) {
                continue;
            }
            tick.batch.push_event(EventEnvelope {
                seq,
                observed_ms: now,
                event_ms,
                event,
            });
        }
        // Node persistence (interning first).
        for (op, id) in self.st.nodes.new_interns.drain(..) {
            tick.batch.intern_node(op, id);
        }
        let persist: Vec<NodeId> = self.st.nodes.persist.drain().collect();
        for id in persist {
            if let Some(r) = self.st.nodes.rec(id) {
                tick.batch.put_node(r.clone());
            }
        }
        if self.first_ingest_ms.is_none() && self.fresh {
            self.first_ingest_ms = Some(now);
            tick.batch
                .set_meta_u64(atlas_store::meta_keys::FIRST_INGEST_MS, now);
        }
        if !tick.batch.is_empty() {
            let _ = self
                .writer
                .send(WriterCmd::Commit(std::mem::take(&mut tick.batch)));
        }
        if tick.publish_now {
            self.publish_pending = true;
            self.publish_urgent = true;
        } else if tick.publish {
            self.publish_pending = true;
        }
    }

    fn rank_corrections(
        &mut self,
        deltas: &[(DeltaCause, crate::state::NodesDeltaBuilder)],
    ) -> Vec<NodeId> {
        crate::state::rank_corrections(&mut self.st, deltas)
    }

    /// A fetched mempool transaction: refines what the socket said (`node_tx` becomes
    /// `node_start` / `node_confirm`, the size becomes known), or adds a transaction the
    /// socket never pushed (only while it is still in the last reconciled set, so a late answer
    /// for a transaction mined meanwhile does not resurrect it).
    fn mempool_classified(
        &mut self,
        tick: &mut Tick,
        txid: Txid,
        kind: TxKind,
        value: Amount,
        size: Option<u32>,
        output_count: u16,
    ) {
        if kind == TxKind::Coinbase {
            return;
        }
        if let Some(e) = self.st.mempool.get_mut(&txid) {
            // The socket guessed node txs and app payments; the fetched tx decides.
            if matches!(
                e.kind,
                TxKind::NodeTx | TxKind::Unknown | TxKind::AppMessage
            ) {
                e.kind = kind;
            }
            if e.size.is_none() && size.is_some() {
                e.size = size;
            }
            if e.value.is_zero() && !value.is_zero() {
                e.value = value;
            }
            tick.publish = true;
            return;
        }
        if !self.st.mempool_set.contains(&txid) {
            return;
        }
        let now = tick.now_ms;
        self.st.mempool.insert(
            txid,
            MempoolEntry {
                kind,
                value,
                size,
                first_seen_ms: now,
            },
        );
        self.mempool_buf.push(tx_lite(txid, value, kind, size));
        self.stats().event("mempool_tx");
        if !matches!(
            kind,
            TxKind::NodeTx | TxKind::NodeStart | TxKind::NodeConfirm
        ) {
            tick.event(
                Event::MempoolTx {
                    txid,
                    value,
                    kind,
                    output_count,
                },
                Some(now),
            );
        }
        self.st.summary_dirty = true;
        tick.publish = true;
    }

    fn flush_mempool(&mut self) {
        if self.mempool_buf.is_empty() {
            return;
        }
        let txs = std::mem::take(&mut self.mempool_buf);
        let body = LiveBody::Mempool { txs };
        self.stats().live(live_kind(&body));
        self.handle.emit(None, body);
    }

    fn housekeeping(&mut self) {
        let mut tick = Tick::new(now_ms());
        if self.st.mesh.dirty {
            tick.publish = true;
        }
        dapps::expire_pending(&mut self.st, &mut tick);
        self.release_pending_list(&mut tick);
        let before = self.st.mempool.len();
        let cutoff = tick.now_ms.saturating_sub(3_600_000);
        self.st.mempool.retain(|_, e| e.first_seen_ms >= cutoff);
        if before != self.st.mempool.len() {
            self.st.summary_dirty = true;
            tick.publish = true;
        }
        // Mesh reports that were not refreshed.
        let continents: HashMap<NodeId, String> = self
            .st
            .nodes
            .listed()
            .filter_map(|e| {
                e.rec
                    .geo
                    .as_ref()
                    .map(|g| (e.rec.id, g.continent_code.to_string()))
            })
            .collect();
        let cross = |a: NodeId, b: NodeId| match (continents.get(&a), continents.get(&b)) {
            (Some(x), Some(y)) => !x.is_empty() && !y.is_empty() && x != y,
            _ => false,
        };
        let diff = self.st.mesh.expire(
            tick.now_ms
                .saturating_sub(crate::state::mesh::REPORT_TTL_MS),
            &cross,
        );
        if !diff.is_empty() {
            self.persist_mesh(&mut tick, &diff, MeshReporter::Node(NodeId(u32::MAX)));
        }
        if tick.now_ms >= self.next_snapshot_ms {
            self.next_snapshot_ms += 3_600_000;
            if self.st.expiry_armed {
                self.snapshot(&mut tick);
            }
        }
        self.finish(tick);
        self.maybe_publish();
    }

    fn snapshot(&mut self, tick: &mut Tick) {
        let snap = NetworkSnapshot {
            ts_ms: tick.now_ms,
            tip_height: self.st.tip_height(),
            nodes: self
                .st
                .nodes
                .listed()
                .map(|e| SnapNode::from_record(&e.rec))
                .collect(),
        };
        if let Err(e) = tick.batch.put_snapshot(tick.now_ms, &snap) {
            tracing::error!(error = %e, "snapshot encode failed");
            self.stats().with(|s| s.internal_errors += 1);
        }
    }

    fn metrics_minute(&mut self) {
        let now = now_ms();
        let s = self.summary();
        let mut at_risk = 0;
        let mut started = 0;
        let mut dos = 0;
        let (mut cores, mut ram, mut storage, mut ssd) = (0u32, 0f64, 0f64, 0f64);
        let (mut lc, mut lr, mut ls) = (0f64, 0f64, 0f64);
        // Unknown is never 0: a gauge is recorded only once its source reported for at least
        // one node (or its job ran at least once). Otherwise it stays `None`.
        let (mut any_node, mut any_hw, mut any_locked) = (false, false, false);
        let (mut any_geo, mut any_arcane, mut any_reach) = (false, false, false);
        for e in self.st.nodes.listed() {
            any_node = true;
            match e.rec.status {
                NodeStatus::Confirmed => {
                    if e.at_risk {
                        at_risk += 1;
                    }
                    if let Some(h) = &e.rec.hw {
                        any_hw = true;
                        cores += u32::from(h.cores);
                        ram += f64::from(h.ram_gb);
                        storage += f64::from(h.total_storage_gb);
                        ssd += f64::from(h.ssd_gb);
                    }
                    if let Some([c, r, st]) = e.locked {
                        any_locked = true;
                        lc += c;
                        lr += r;
                        ls += st;
                    }
                    any_geo |= e.rec.geo.is_some();
                    any_arcane |= e.rec.arcane.is_some();
                    any_reach |= e.rec.reachable.is_some();
                }
                NodeStatus::Started => started += 1,
                NodeStatus::Dos => dos += 1,
                _ => {}
            }
        }
        let fr = self.fresh();
        let mempool_known = fr.has_succeeded("mempool_stream");
        let pending_known = fr.has_succeeded("app_pending") || !self.st.apps.pending.is_empty();
        let mesh_known = fr.has_succeeded("topology_sweep") || self.st.mesh.edge_count() > 0;
        let tip_known = self.st.tip.is_some();
        let catalog = self.st.apps.catalog_loaded;
        let placement = self.st.apps.placement_loaded;
        let armed = self.st.expiry_armed;
        let iv = std::mem::take(&mut self.st.interval);
        let known = |k: bool, v: u32| k.then_some(v);
        let row = MetricsRow {
            ts_ms: now - now % 60_000,
            tip_height: self.st.tip.as_ref().map(|t| t.height),
            node_count: known(any_node, s.node_count),
            tier_counts: any_node.then_some([s.tiers.cumulus, s.tiers.nimbus, s.tiers.stratus]),
            host_count: known(any_node, s.host_count),
            country_count: known(any_geo, s.country_count),
            arcane_count: known(any_arcane, s.arcane_count),
            unreachable_count: known(any_reach, s.unreachable_count),
            app_count: known(catalog, s.app_count),
            instance_count: known(placement, s.instance_count),
            pending_app_count: known(pending_known, self.st.apps.pending.len() as u32),
            total_cores: known(any_hw, cores),
            total_ram_gb: any_hw.then_some(ram.round() as u64),
            total_storage_gb: any_hw.then_some(storage.round() as u64),
            supply: s.supply.as_ref().map(|x| x.total),
            price_usd: s.price.as_ref().map(|p| p.usd),
            mempool_size: known(mempool_known, s.mempool_size),
            mesh_edge_count: known(mesh_known, self.st.mesh.edge_count() as u32),
            // Interval counters only mean something while the chain is followed.
            block_count: known(tip_known, iv.blocks),
            tx_count: known(tip_known, iv.txs),
            node_tx_count: known(tip_known, iv.node_txs),
            fees: tip_known.then_some(iv.fees),
            payouts: tip_known.then_some(iv.payouts),
            avg_block_time_ms: (iv.block_intervals > 0)
                .then(|| (iv.block_interval_sum_ms / u64::from(iv.block_intervals)) as u32),
            samples: 1,
            provider_count: known(any_geo, s.provider_count),
            at_risk_count: known(armed, at_risk),
            started_count: known(any_node, started),
            dos_count: known(any_node, dos),
            total_ssd_gb: any_hw.then_some(ssd.round() as u64),
            locked_cores: any_locked.then_some(lc),
            locked_ram_gb: any_locked.then_some(lr),
            locked_storage_gb: any_locked.then_some(ls),
        };
        if self.fresh {
            let mut b = WriteBatch::new();
            b.put_metrics_1m(row);
            let _ = self.writer.send(WriterCmd::Commit(b));
        }
    }

    /// The network summary (cached until something relevant changes).
    fn summary(&mut self) -> NetworkSummary {
        if !self.st.summary_dirty
            && !self.st.nodes.dirty
            && let Some(s) = &self.summary
        {
            return s.clone();
        }
        let s = summarize(&self.st);
        self.summary = Some(s.clone());
        self.st.summary_dirty = false;
        s
    }

    fn maybe_publish(&mut self) {
        if self.publishing || !self.publish_pending {
            return;
        }
        if !self.publish_urgent && self.last_publish.elapsed() < PUBLISH_MIN_INTERVAL {
            return;
        }
        self.start_publish();
    }

    fn start_publish(&mut self) {
        self.publish_pending = false;
        self.publish_urgent = false;
        self.publishing = true;
        self.last_publish = Instant::now();
        let tip = self.st.tip_height();
        let nodes_dirty = self.st.nodes.dirty;
        let summary = self.summary();
        // Live stats, coalesced by the publish cadence (<= 1/s). The startup publish only seeds
        // the baseline: clients get that summary from bootstrap.
        if self.last_stats_summary.is_none() {
            self.last_stats_summary = Some(summary.clone());
        } else if self.last_stats_summary.as_ref() != Some(&summary) {
            self.last_stats_summary = Some(summary.clone());
            let body = LiveBody::Stats {
                summary: summary.clone(),
            };
            self.stats().live(live_kind(&body));
            self.handle.emit(None, body);
        }
        let mut nodes_changed = false;
        if nodes_dirty || self.nodes_arc.is_none() {
            let v: Vec<NodeRecord> = self.st.nodes.listed().map(|e| e.rec.clone()).collect();
            self.nodes_arc = Some(v.into());
            self.st.nodes.dirty = false;
            nodes_changed = true;
        }
        if tip != self.nodes_bin_tip {
            nodes_changed = true;
            self.nodes_bin_tip = tip;
        }
        let mut apps_changed = false;
        if self.st.apps.dirty || self.apps_arc.is_none() {
            self.apps_arc = Some(self.st.apps.index().into());
            self.st.apps.dirty = false;
            apps_changed = true;
            let eps = self.st.apps.enterprise_endpoints();
            self.enterprise = Arc::new(
                eps.iter()
                    .filter_map(|e| self.st.nodes.by_endpoint(e))
                    .collect(),
            );
        }
        if self.st.blocks_dirty || self.blocks_arc.is_none() {
            let v: Vec<BlockLite> = self.st.recent.iter().rev().map(block_lite).collect();
            self.blocks_arc = Some(v.into());
            self.st.blocks_dirty = false;
        }
        // mesh.bin is the largest body; live mesh deltas carry every change at once, so the
        // snapshot body is rebuilt at most every MESH_BODY_INTERVAL (housekeeping re-arms a
        // publish for a pending change).
        let mesh = if self.st.mesh.dirty
            && self
                .last_mesh_body
                .is_none_or(|t| t.elapsed() >= MESH_BODY_INTERVAL)
        {
            self.st.mesh.dirty = false;
            self.last_mesh_body = Some(Instant::now());
            Some(self.st.mesh.edge_list())
        } else {
            None
        };
        let tiers = tier_stats(&self.st, &summary);
        let job = PublishJob {
            seq: self.handle.seq(),
            generated_ms: now_ms(),
            stale: !self.fresh,
            server: self.handle.inner.server.clone(),
            network: summary,
            tiers,
            blocks: self
                .blocks_arc
                .clone()
                .unwrap_or_else(|| Arc::from(Vec::new())),
            nodes: self
                .nodes_arc
                .clone()
                .unwrap_or_else(|| Arc::from(Vec::new())),
            nodes_changed,
            enterprise: Arc::clone(&self.enterprise),
            tip,
            apps: self
                .apps_arc
                .clone()
                .unwrap_or_else(|| Arc::from(Vec::new())),
            apps_changed,
            mesh,
            mesh_edge_count: self.st.mesh.edge_count() as u32,
            freshness: self.handle.inner.freshness.snapshot(),
            next_payees: self.st.next_payees.iter().map(payee_dto).collect(),
            mempool: self.st.mempool_list(),
            attributions: self
                .st
                .geoip
                .iter()
                .map(crate::geoip::LoadedGeoIp::attribution)
                .collect(),
            prev: self.handle.published(),
        };
        let job = match &self.publisher {
            Some(p) => match p.send(job) {
                Ok(()) => return,
                Err(back) => back.0,
            },
            None => job,
        };
        let handle = self.handle.clone();
        let tx = self.obs_tx.clone();
        tokio::task::spawn_blocking(move || {
            let (p, t) = build(job);
            handle.install(p);
            let _ = tx.blocking_send(Obs::PublishDone {
                elapsed_ms: t.total_ms,
            });
        });
    }
}

/// Spawns the long-lived publisher thread (and its mesh body worker). Publishes are
/// single-flight, so one thread suffices, and keeping the large body allocations on stable
/// threads keeps allocator heaps (and RSS) flat.
fn spawn_publisher(
    handle: EngineHandle,
    obs_tx: mpsc::Sender<Obs>,
) -> Option<std::sync::mpsc::Sender<PublishJob>> {
    let (tx, rx) = std::sync::mpsc::channel::<PublishJob>();
    let spawned = std::thread::Builder::new()
        .name("atlas-publisher".to_owned())
        .spawn(move || {
            let mesh = match crate::publish::MeshWorker::spawn() {
                Ok(w) => Some(w),
                Err(e) => {
                    tracing::warn!(error = %e, "mesh body worker unavailable; building inline");
                    None
                }
            };
            while let Ok(job) = rx.recv() {
                let (p, t) = build_with(job, mesh.as_ref());
                handle.install(p);
                if obs_tx
                    .blocking_send(Obs::PublishDone {
                        elapsed_ms: t.total_ms,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
    match spawned {
        Ok(_) => Some(tx),
        Err(e) => {
            tracing::warn!(error = %e, "publisher thread unavailable; using the blocking pool");
            None
        }
    }
}

/// Events worth persisting (high-volume transient ones are only counted).
fn persisted(e: &Event) -> bool {
    !matches!(e, Event::NewTip { .. } | Event::RankShift { .. })
}

/// Live message type name.
pub fn live_kind(b: &LiveBody) -> &'static str {
    match b {
        LiveBody::Hello { .. } => "hello",
        LiveBody::Block(_) => "block",
        LiveBody::Reorg(_) => "reorg",
        LiveBody::Mempool { .. } => "mempool",
        LiveBody::Nodes(_) => "nodes",
        LiveBody::Apps(_) => "apps",
        LiveBody::Mesh(_) => "mesh",
        LiveBody::NextPayees(_) => "next_payees",
        LiveBody::AppPending(_) => "app_pending",
        LiveBody::AppPendingResolved(_) => "app_pending_resolved",
        LiveBody::AppInstalling(_) => "app_installing",
        LiveBody::Stats { .. } => "stats",
        LiveBody::Feed(_) => "feed",
        LiveBody::Resync { .. } => "resync",
        LiveBody::Ping { .. } => "ping",
    }
}

/// Computes the network summary from the state.
pub fn summarize(st: &NetworkState) -> NetworkSummary {
    let mut tiers = TierCounts::default();
    let mut hosts = HashSet::new();
    let mut countries = HashSet::new();
    let mut providers = HashSet::new();
    let mut arcane = 0;
    let mut unreachable = 0;
    for e in st.nodes.listed() {
        let r = &e.rec;
        if r.status != NodeStatus::Confirmed {
            continue;
        }
        tiers.add(r.tier);
        if let Some(ep) = r.endpoint {
            hosts.insert(ep.ip);
        }
        if let Some(g) = &r.geo {
            if !g.country_code.is_empty() {
                countries.insert(g.country_code.clone());
            }
            match g.asn {
                Some(a) => {
                    providers.insert(format!("AS{a}"));
                }
                None if !g.org.is_empty() => {
                    providers.insert(g.org.to_string());
                }
                None => {}
            }
        }
        if r.arcane == Some(true) {
            arcane += 1;
        }
        if r.reachable == Some(false) {
            unreachable += 1;
        }
    }
    let next = st.tip_height() + 1;
    NetworkSummary {
        node_count: tiers.total,
        host_count: hosts.len() as u32,
        tiers,
        country_count: countries.len() as u32,
        provider_count: providers.len() as u32,
        arcane_count: arcane,
        unreachable_count: unreachable,
        app_count: st.apps.records.len() as u32,
        instance_count: st.apps.instance_count() as u32,
        tip: st.tip.clone(),
        reward: pon_subsidy(next).unwrap_or(Amount::ZERO),
        next_reduction_height: next_reduction_height(next),
        supply: st.supply.clone(),
        price: st.price.clone(),
        mempool_size: st.mempool.len() as u32,
    }
}

/// Per-tier stats for bootstrap.
pub fn tier_stats(st: &NetworkState, s: &NetworkSummary) -> Vec<TierStats> {
    let next = st.tip_height() + 1;
    Tier::ALL
        .iter()
        .map(|t| TierStats {
            tier: *t,
            count: s.tiers.get(*t),
            collateral: t.collateral().unwrap_or(Amount::ZERO),
            payout: tier_payout(next, *t).unwrap_or(Amount::ZERO),
            cycle_blocks: st.queue.tier(*t).map_or(0, |q| q.len() as u32),
            next: st
                .queue
                .head(*t)
                .and_then(|n| st.nodes.rec(n))
                .map(node_ref),
        })
        .collect()
}

/// True when a node counts toward the live network (used by tests).
pub fn listed(r: &NodeRecord) -> bool {
    is_listed(r.status)
}

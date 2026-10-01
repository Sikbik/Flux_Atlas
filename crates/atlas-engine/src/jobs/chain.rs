//! T1 ChainStream + BlockDecoder + MempoolStream + NextPayees.
//!
//! Tip detection is push-first: two Insight sockets (main plus mirror, deduplicated). The
//! fallback pollers run only while no socket is healthy: Insight `getLastBlockHash` every 2 s,
//! and when Insight fails too, FluxOS `getblockhash/<tip+1>?nc=` once per second (errors are
//! never cached upstream). Blocks are fetched by hash (`getblock/<hash>` verbosity 2, cached by
//! hash upstream, so always fresh), checked against our tip (`previousblockhash`), gap-filled,
//! and walked back on a reorg within the 10-block finality window.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use atlas_core::api::PriceInfo;
use atlas_core::{BlockHash, Collateral, Hash32, Tier, Txid, now_ms};
use atlas_flux::GuardedEndpoint;
use atlas_flux::decode::{DecodedBlock, classify_insight_tx, classify_tx, decode_block};
use atlas_flux::insight_socket::{ChainPush, DualSocket, SocketMessage};
use atlas_flux::models::apps::APP_PAYMENT_ADDRESS;
use atlas_flux::models::daemon::{DaemonTx, DaemonVout};
use atlas_flux::models::insight::{InsightTx, InsightVout};
use tokio::sync::mpsc;

use super::JobCtx;
use crate::obs::Obs;
use crate::stats::Upstream;

/// Reorgs deeper than this are treated as a discontinuity.
pub const FINALITY: u32 = 10;
const RECENT_KEEP: usize = 128;

/// The chain as the block-sync task has sent it to the reducer.
#[derive(Debug, Default, Clone)]
pub struct Cursor {
    recent: BTreeMap<u32, BlockHash>,
}

impl Cursor {
    pub fn new(recent: &[(u32, BlockHash)]) -> Self {
        Self {
            recent: recent.iter().copied().collect(),
        }
    }

    pub fn tip(&self) -> Option<(u32, BlockHash)> {
        self.recent.last_key_value().map(|(h, x)| (*h, *x))
    }

    pub fn get(&self, h: u32) -> Option<BlockHash> {
        self.recent.get(&h).copied()
    }

    pub fn contains(&self, hash: &BlockHash) -> bool {
        self.recent.values().any(|x| x == hash)
    }

    pub fn push(&mut self, h: u32, hash: BlockHash) {
        self.truncate_above(h.saturating_sub(1));
        self.recent.insert(h, hash);
        while self.recent.len() > RECENT_KEEP {
            self.recent.pop_first();
        }
    }

    /// Lowest height the cursor holds (after a jump, only the jump block).
    pub fn first(&self) -> Option<u32> {
        self.recent.first_key_value().map(|(h, _)| *h)
    }

    pub fn truncate_above(&mut self, h: u32) -> Vec<BlockHash> {
        let Some(from) = h.checked_add(1) else {
            return Vec::new();
        };
        let doomed: Vec<u32> = self.recent.range(from..).map(|(k, _)| *k).collect();
        doomed
            .into_iter()
            .filter_map(|k| self.recent.remove(&k))
            .collect()
    }

    pub fn reset(&mut self, h: u32, hash: BlockHash) {
        self.recent.clear();
        self.recent.insert(h, hash);
    }
}

/// Mempool enrichment cadence: one fetch every 1.25 s, alternating the gateway
/// (`getrawtransaction`) and Insight (`/api/tx`), so each host sees at most 0.4 req/s (the
/// node-tx enrichment budget of ARCHITECTURE section 3.2) and together they keep up with the
/// ~0.5 tx/s the network broadcasts.
const ENRICH_EVERY: Duration = Duration::from_millis(1_250);
/// A queued txid older than this is dropped: blocks come every 30 s, so it is most likely mined
/// (and then classified by the block) or evicted.
const ENRICH_MAX_AGE: Duration = Duration::from_secs(120);
/// Queue bound; the oldest entries go first when it overflows.
const ENRICH_QUEUE_CAP: usize = 512;

/// Mempool transactions to fetch and classify with the block classifier: socket node txs
/// (start or confirm is not in the push), socket app payments (the push omits the OP_RETURN),
/// and reconciled txids the socket never pushed. Newest first, each txid at most once.
#[derive(Debug, Default)]
pub struct Enricher {
    queue: VecDeque<(Txid, Instant)>,
    /// Queued or already handled (classified, or complete from the socket).
    seen: HashSet<Txid>,
}

impl Enricher {
    /// Queues `txid` unless it was seen before.
    pub fn push(&mut self, txid: Txid) {
        if self.seen.insert(txid) {
            self.queue.push_back((txid, Instant::now()));
            while self.queue.len() > ENRICH_QUEUE_CAP {
                self.queue.pop_front();
            }
        }
    }

    /// Marks `txid` as fully classified already (a socket transfer).
    pub fn done(&mut self, txid: Txid) {
        self.seen.insert(txid);
    }

    /// Queues the reconciled txids nobody classified, and forgets txids that left the mempool.
    pub fn snapshot(&mut self, set: &HashSet<Txid>) {
        let queued: HashSet<Txid> = self.queue.iter().map(|(t, _)| *t).collect();
        self.seen.retain(|t| set.contains(t) || queued.contains(t));
        for t in set {
            self.push(*t);
        }
    }

    /// The newest queued txid that is not too old.
    pub fn next(&mut self) -> Option<Txid> {
        while let Some((t, at)) = self.queue.pop_back() {
            if at.elapsed() <= ENRICH_MAX_AGE {
                return Some(t);
            }
        }
        None
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

/// Classifies a fetched mempool transaction; `None` when it is already mined.
pub fn classify_mempool_tx(tx: &DaemonTx) -> Option<Obs> {
    if tx.height.is_some_and(|h| h > 0)
        || tx.blockhash.as_deref().is_some_and(|h| !h.is_empty())
        || tx.confirmations.is_some_and(|c| c > 0)
    {
        return None;
    }
    Some(Obs::MempoolClassified {
        txid: Hash32::from_hex(&tx.txid).ok()?,
        kind: classify_tx(tx, APP_PAYMENT_ADDRESS),
        value: tx.vout.iter().map(DaemonVout::amount).sum(),
        size: tx.serialized_size(),
        output_count: u16::try_from(tx.vout.len()).unwrap_or(u16::MAX),
    })
}

/// [`classify_mempool_tx`] for an Insight transaction (same classifier rules).
pub fn classify_mempool_insight_tx(tx: &InsightTx) -> Option<Obs> {
    if tx.blockheight.is_some_and(|h| h > 0) || tx.confirmations.is_some_and(|c| c > 0) {
        return None;
    }
    Some(Obs::MempoolClassified {
        txid: Hash32::from_hex(&tx.txid).ok()?,
        kind: classify_insight_tx(tx, APP_PAYMENT_ADDRESS),
        value: tx.vout.iter().map(InsightVout::amount).sum(),
        size: Some(tx.size).filter(|s| *s > 0),
        output_count: u16::try_from(tx.vout.len()).unwrap_or(u16::MAX),
    })
}

/// Runs the socket, the fallback pollers, the block sync and the mempool reconciliation.
pub async fn run(ctx: JobCtx, recent: Vec<(u32, BlockHash)>) {
    let (tips_tx, tips_rx) = mpsc::channel::<(BlockHash, u64)>(256);
    let tip_height = Arc::new(AtomicU32::new(recent.last().map_or(0, |r| r.0)));
    let sync = tokio::spawn(block_sync(
        ctx.clone(),
        Cursor::new(&recent),
        tips_rx,
        Arc::clone(&tip_height),
    ));
    let (socket, mut rx) = DualSocket::spawn(&ctx.cfg.socket);
    let health = socket.health();
    let started = Instant::now();
    let mut fallback = tokio::time::interval(Duration::from_secs(1));
    fallback.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut mempool_iv = tokio::time::interval(ctx.cfg.mempool_reconcile_interval);
    mempool_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut enrich = Enricher::default();
    let mut enrich_insight = false;
    let mut enrich_iv = tokio::time::interval(ENRICH_EVERY);
    enrich_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_poll: Option<Instant> = None;
    let mut insight_failures = 0u32;
    let mut last_fallback_hash: Option<BlockHash> = None;
    let mut shutdown = ctx.shutdown.clone();

    // Sync to the current tip right away instead of waiting for the next push.
    match ctx
        .call(
            Upstream::Insight,
            "status getLastBlockHash",
            ctx.clients.insight.last_block_hash(),
        )
        .await
    {
        Ok(h) => {
            if let Ok(hash) = Hash32::from_hex(h.lastblockhash.trim()) {
                let _ = tips_tx.send((hash, now_ms())).await;
            }
        }
        Err(e) => ctx.fail("chain_stream", &e),
    }

    loop {
        tokio::select! {
            msg = rx.recv() => {
                let Some(msg) = msg else { break };
                let SocketMessage::Event(ev) = msg else { continue };
                match ev.push {
                    ChainPush::Block { hash } => {
                        ctx.ok("chain_stream");
                        let _ = ctx.send(Obs::Tip { hash, received_ms: ev.received_ms }).await;
                        if tips_tx.send((hash, ev.received_ms)).await.is_err() {
                            break;
                        }
                    }
                    ChainPush::Tx(tx) => {
                        // Socket fluxnode txids do not resolve (see the reducer): only the
                        // reconcile's real txids are fetched for them.
                        let pays_apps = tx.outputs.iter().any(|(a, _)| a == APP_PAYMENT_ADDRESS);
                        if pays_apps && !tx.is_node_tx() {
                            enrich.push(tx.txid);
                        } else if !tx.is_node_tx() {
                            enrich.done(tx.txid);
                        }
                        if !ctx.send(Obs::MempoolTx { tx, received_ms: ev.received_ms }).await {
                            break;
                        }
                    }
                    ChainPush::Info(info) => {
                        let _ = ctx.send(Obs::SocketInfo(info)).await;
                    }
                    ChainPush::MarketsInfo(m) => {
                        if let Some(usd) = m.price_usd.filter(|p| *p > 0.0) {
                            let _ = ctx
                                .send(Obs::Price(PriceInfo {
                                    usd,
                                    btc: m.price_btc.unwrap_or(0.0),
                                    change_24h_pct: m.change_24h_pct.unwrap_or(0.0),
                                    market_cap_usd: m.market_cap_usd.unwrap_or(0.0),
                                    volume_24h_usd: m.volume_24h_usd.unwrap_or(0.0),
                                    updated_ms: ev.received_ms,
                                    source: "insight".to_owned(),
                                }))
                                .await;
                        }
                    }
                    ChainPush::Unknown { .. } => {}
                }
            }
            _ = fallback.tick() => {
                // Fallback pollers run only while no socket is healthy (after a start-up grace).
                let healthy = health.borrow().healthy;
                if started.elapsed() < Duration::from_secs(20) || healthy {
                    insight_failures = 0;
                    continue;
                }
                if insight_failures < 3 {
                    if last_poll.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
                        continue;
                    }
                    last_poll = Some(Instant::now());
                    match ctx
                        .call(Upstream::Insight, "status getLastBlockHash", ctx.clients.insight.last_block_hash())
                        .await
                    {
                        Ok(h) => {
                            insight_failures = 0;
                            if let Ok(hash) = Hash32::from_hex(h.lastblockhash.trim())
                                && last_fallback_hash != Some(hash)
                            {
                                last_fallback_hash = Some(hash);
                                let _ = tips_tx.send((hash, now_ms())).await;
                            }
                        }
                        Err(e) => {
                            insight_failures += 1;
                            ctx.fail("chain_stream", &e);
                        }
                    }
                } else {
                    // Insight is down too: probe the next height through FluxOS, cache-busted.
                    let next = tip_height.load(Ordering::Acquire) + 1;
                    match ctx
                        .call(Upstream::FluxOs, "getblockhash", ctx.clients.fluxos.get_block_hash(next, true))
                        .await
                    {
                        Ok(Some(hash)) => {
                            let _ = tips_tx.send((hash, now_ms())).await;
                            insight_failures = 0;
                        }
                        Ok(None) => {}
                        Err(e) => ctx.fail("chain_stream", &e),
                    }
                }
            }
            _ = mempool_iv.tick() => {
                // Cache-busted: the gateway's cached answer lists the previous block's txs.
                match ctx.call(Upstream::FluxOs, "getrawmempool", ctx.clients.fluxos.get_raw_mempool_fresh()).await {
                    Ok(m) => {
                        let sizes: HashMap<Hash32, u32> = m
                            .0
                            .iter()
                            .filter_map(|(k, e)| Some((Hash32::from_hex(k).ok()?, e.size)))
                            .collect();
                        let set: HashSet<Hash32> = sizes.keys().copied().collect();
                        enrich.snapshot(&set);
                        let _ = ctx.send(Obs::MempoolSnapshot(sizes)).await;
                        ctx.ok("mempool_stream");
                    }
                    Err(e) => ctx.fail("mempool_stream", &e),
                }
            }
            _ = enrich_iv.tick(), if !enrich.is_empty() => {
                let Some(txid) = enrich.next() else { continue };
                // Alternate the gateway and Insight: each stays within its 0.4 req/s budget.
                enrich_insight = !enrich_insight;
                let classified = if enrich_insight {
                    ctx.call(Upstream::Insight, "insight tx", ctx.clients.insight.tx(&txid))
                        .await
                        .map(|tx| classify_mempool_insight_tx(&tx))
                } else {
                    ctx.call(Upstream::FluxOs, "getrawtransaction", ctx.clients.fluxos.get_raw_transaction(&txid))
                        .await
                        .map(|tx| classify_mempool_tx(&tx))
                };
                match classified {
                    Ok(Some(o)) => {
                        let _ = ctx.send(o).await;
                    }
                    Ok(None) => {}
                    // Mined or evicted meanwhile, or unknown to the node that answered: the
                    // transaction keeps what the socket said (or stays unclassified).
                    Err(e) => tracing::debug!(%txid, error = %e, "mempool tx fetch failed"),
                }
            }
            () = super::stopped(&mut shutdown) => break,
        }
    }
    socket.shutdown().await;
    sync.abort();
}

/// A known chain point: height 2,998,000 was mined around 2026-10-01T00:00Z (30 s spacing).
const CHAIN_ANCHOR: (u32, u64) = (2_998_000, 1_790_812_800_000);

/// The highest block height an upstream answer may claim at `now_ms`: the applied tip plus
/// the blocks that can have been mined since its time (at 1.5x the 30 s target spacing) plus
/// slack, or, without a tip, the same estimate from a fixed chain anchor. A forged height (near
/// `u32::MAX`, say) would otherwise move the tip there and wedge the sync.
pub fn max_plausible_height(tip: Option<(u32, u64)>, now_ms: u64) -> u32 {
    const MIN_SPACING_MS: u64 = 20_000;
    let (h, at, slack) = tip.map_or((CHAIN_ANCHOR.0, CHAIN_ANCHOR.1, 2_000), |(h, t)| (h, t, 60));
    let mined = now_ms.saturating_sub(at) / MIN_SPACING_MS;
    h.saturating_add(u32::try_from(mined).unwrap_or(u32::MAX))
        .saturating_add(slack)
}

fn plausible_ceiling(ctx: &JobCtx) -> u32 {
    let tip = ctx
        .handle
        .published()
        .network
        .tip
        .as_ref()
        .map(|t| (t.height, t.time_ms));
    max_plausible_height(tip, now_ms())
}

async fn fetch(ctx: &JobCtx, hash: &BlockHash) -> Option<DecodedBlock> {
    // The answer is validated in the client (same hash, plausible height) from any upstream.
    let (raw, from_node) = match ctx
        .call(
            Upstream::FluxOs,
            "getblock",
            ctx.clients
                .fluxos
                .get_block_checked(hash, plausible_ceiling(ctx)),
        )
        .await
    {
        Ok((b, from)) => (std::sync::Arc::new(b), from),
        Err(e) => {
            ctx.fail("block_decoder", &e);
            return None;
        }
    };
    if let Some(node) = from_node
        && !corroborated(ctx, &raw, &node).await
    {
        return None;
    }
    ctx.handle.keep_raw_block(std::sync::Arc::clone(&raw));
    match decode_block(&raw) {
        Ok(d) => Some(d),
        Err(e) => {
            ctx.fail("block_decoder", &e);
            None
        }
    }
}

/// A block served by a community node (the gateway was down) is checked against Insight, an
/// independent backend: same hash at the same height. Insight answering "not found", or with
/// another height, rejects the block and drops the node from the pool. When Insight is down
/// too the block is accepted: the node passed the height check when it entered the pool.
async fn corroborated(
    ctx: &JobCtx,
    b: &atlas_flux::models::daemon::DaemonBlock,
    node: &str,
) -> bool {
    let Ok(hash) = Hash32::from_hex(b.hash.trim()) else {
        return false;
    };
    match ctx
        .call(
            Upstream::Insight,
            "insight block",
            ctx.clients.insight.block(&hash),
        )
        .await
    {
        Ok(ib) if ib.height == b.height => {
            ctx.handle.inner.stats.event("failover_block_corroborated");
            true
        }
        Ok(ib) => {
            reject_node(
                ctx,
                node,
                &format!("height {} but Insight has {}", b.height, ib.height),
            );
            false
        }
        Err(e) if e.is_not_found() => {
            reject_node(ctx, node, "a block Insight does not know");
            false
        }
        Err(_) => {
            ctx.handle
                .inner
                .stats
                .event("failover_block_uncorroborated");
            true
        }
    }
}

fn reject_node(ctx: &JobCtx, node: &str, reason: &str) {
    ctx.handle.inner.stats.event("failover_block_rejected");
    tracing::warn!(
        node,
        reason,
        "failover block rejected; node dropped from the pool"
    );
    let set = ctx.clients.fluxos.failover();
    if let Some(u) = set.nodes().into_iter().find(|u| u.label == node) {
        let _ = set.reject(&u, "getblock", reason);
    }
}

async fn hash_at(ctx: &JobCtx, h: u32) -> Option<BlockHash> {
    match ctx
        .call(
            Upstream::FluxOs,
            "getblockhash",
            ctx.clients.fluxos.get_block_hash(h, true),
        )
        .await
    {
        Ok(x) => x,
        Err(e) => {
            ctx.fail("block_decoder", &e);
            None
        }
    }
}

/// Applies blocks in order: prev-hash check, gap fill, reorg walk-back.
async fn block_sync(
    ctx: JobCtx,
    mut cursor: Cursor,
    mut tips: mpsc::Receiver<(BlockHash, u64)>,
    tip_height: Arc<AtomicU32>,
) {
    let mut caught_up = false;
    while let Some((hash, received_ms)) = tips.recv().await {
        let mut target = Some((hash, received_ms));
        // Collapse a burst to the newest announced tip (the gap fill covers the rest).
        while let Ok(next) = tips.try_recv() {
            target = Some(next);
        }
        let Some((hash, received_ms)) = target else {
            continue;
        };
        if ctx.stopping() {
            break;
        }
        // Until the chain first reaches an announced tip after a restart, gaps replay the
        // downtime (bounded by `max_catchup_gap`) instead of jumping.
        let catch_up = !caught_up && cursor.tip().is_some();
        sync_retrying(
            &ctx,
            &mut cursor,
            &tips,
            (hash, received_ms),
            catch_up,
            &TIP_RETRY_MS,
        )
        .await;
        if cursor.contains(&hash) {
            caught_up = true;
        }
        if let Some((h, _)) = cursor.tip() {
            tip_height.store(h, Ordering::Release);
        }
    }
}

/// Delays between attempts to reach a pushed tip the gateway cannot serve yet (about 12 s in
/// all, well inside the 30 s block spacing).
const TIP_RETRY_MS: [u64; 6] = [300, 700, 1_200, 2_000, 3_000, 4_500];

/// [`sync_to`], retried while the tip is still out of reach and no newer tip is queued. The
/// Insight push can beat the FluxOS gateway's daemon to the block (measured: `getblock`
/// answered "Can't read block from disk" right after a push), and giving up there left the
/// block for the next tip, 30 s later.
async fn sync_retrying(
    ctx: &JobCtx,
    cursor: &mut Cursor,
    tips: &mpsc::Receiver<(BlockHash, u64)>,
    (hash, received_ms): (BlockHash, u64),
    catch_up: bool,
    delays_ms: &[u64],
) {
    sync_to(ctx, cursor, hash, received_ms, catch_up).await;
    for d in delays_ms {
        if cursor.contains(&hash) || !tips.is_empty() || ctx.stopping() {
            return;
        }
        if !ctx.sleep(Duration::from_millis(*d)).await {
            return;
        }
        sync_to(ctx, cursor, hash, received_ms, catch_up).await;
    }
}

async fn apply(ctx: &JobCtx, cursor: &mut Cursor, d: DecodedBlock, received_ms: u64, jump: bool) {
    let (h, hash) = (d.summary.height, d.summary.hash);
    if jump {
        cursor.reset(h, hash);
    } else {
        cursor.push(h, hash);
    }
    let _ = ctx
        .send(Obs::Block {
            block: Box::new(d),
            received_ms,
            discontinuous: jump,
        })
        .await;
}

/// Brings the reducer's chain to `target`. Gaps up to `max_live_gap` blocks (or
/// `max_catchup_gap` when `catch_up`, the first sync after a restart) are filled block by block;
/// larger gaps jump to the target.
pub async fn sync_to(
    ctx: &JobCtx,
    cursor: &mut Cursor,
    target: BlockHash,
    received_ms: u64,
    catch_up: bool,
) {
    let max_gap = if catch_up {
        ctx.cfg.max_catchup_gap.max(ctx.cfg.max_live_gap)
    } else {
        ctx.cfg.max_live_gap
    };
    // The target block is fetched once and kept while the gap below it fills.
    let mut kept: Option<DecodedBlock> = None;
    let mut announced = false;
    let mut reorged = false;
    for _ in 0..(max_gap + 2 * FINALITY + 8) {
        if cursor.contains(&target) {
            return;
        }
        let d = match kept.take() {
            Some(d) => d,
            None => match fetch(ctx, &target).await {
                Some(d) => d,
                None => return,
            },
        };
        let h = d.summary.height;
        let Some((th, thash)) = cursor.tip() else {
            apply(ctx, cursor, d, received_ms, true).await;
            return;
        };
        let next = th.saturating_add(1);
        if h == next && d.summary.prev_hash == thash {
            apply(ctx, cursor, d, received_ms, false).await;
            return;
        }
        if h > next {
            if h.saturating_sub(th) > max_gap {
                tracing::warn!(
                    from = th,
                    to = h,
                    "chain gap too large to fill live; jumping"
                );
                apply(ctx, cursor, d, received_ms, true).await;
                return;
            }
            if catch_up && !announced {
                announced = true;
                tracing::info!(from = th, to = h, "replaying the blocks missed while down");
            }
            // Gap: fetch the next height and link it.
            let Some(nh) = hash_at(ctx, next).await else {
                return;
            };
            let Some(n) = fetch(ctx, &nh).await else {
                return;
            };
            if n.summary.height != next {
                tracing::warn!(
                    want = next,
                    got = n.summary.height,
                    "gap block at the wrong height"
                );
                return;
            }
            kept = Some(d);
            if n.summary.prev_hash == thash {
                apply(ctx, cursor, n, now_ms(), false).await;
                continue;
            }
        } else if cursor.get(h) == Some(d.summary.hash) {
            return;
        } else {
            kept = Some(d);
        }
        // Our tip is not an ancestor of the target: a reorg. One walk-back per sync, and never
        // past one finality window (L13): a second mismatch, or a fork deeper than the window,
        // jumps to the target instead of deleting more history.
        if reorged {
            if let Some(d) = kept.take() {
                tracing::warn!(
                    height = d.summary.height,
                    "chain still disagrees after a reorg; jumping"
                );
                apply(ctx, cursor, d, received_ms, true).await;
            }
            return;
        }
        reorged = true;
        match reorg(ctx, cursor).await {
            Reorg::Done => {}
            Reorg::Deep => {
                if let Some(d) = kept.take() {
                    apply(ctx, cursor, d, received_ms, true).await;
                }
                return;
            }
            Reorg::Unconfirmed => return,
        }
    }
}

/// What a reorg walk-back did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reorg {
    /// Orphaned blocks above the fork were dropped (or there was nothing to drop).
    Done,
    /// The fork is deeper than the comparable window: only that window was dropped, and the
    /// caller jumps to its target instead of walking back further.
    Deep,
    /// Nothing changed: the upstream could not answer, or Insight still holds our chain (the
    /// gateway backend is the odd one out).
    Unconfirmed,
}

/// Finds the fork point by walking back through the finality window and tells the reducer.
///
/// Deleting stored blocks is never decided on one backend's word (L13): the walk compares
/// only heights the cursor holds (after a jump it holds the jump block alone, so stored
/// backfilled blocks below it are never judged), and Insight, an independent backend, must
/// confirm that our block above the fork is no longer canonical. A fork deeper than the window
/// drops that window only, once.
async fn reorg(ctx: &JobCtx, cursor: &mut Cursor) -> Reorg {
    let Some((th, _)) = cursor.tip() else {
        return Reorg::Unconfirmed;
    };
    let window_floor = th.saturating_sub(FINALITY);
    let floor = cursor.first().map_or(window_floor, |f| f.max(window_floor));
    let mut fork = None;
    for h in (floor..=th).rev() {
        let Some(up) = hash_at(ctx, h).await else {
            // The upstream backend has not reached this height: not a reorg we can act on.
            if h == th {
                continue;
            }
            return Reorg::Unconfirmed;
        };
        if cursor.get(h) == Some(up) {
            fork = Some(h);
            break;
        }
    }
    let deep = fork.is_none();
    let fork = fork.unwrap_or_else(|| floor.saturating_sub(1));
    let first_orphan = fork.saturating_add(1);
    // Insight must agree that our block above the fork is gone.
    if let Some(ours) = cursor.get(first_orphan) {
        match ctx
            .call(
                Upstream::Insight,
                "insight block-index",
                ctx.clients.insight.block_hash(first_orphan),
            )
            .await
        {
            Ok(ins) if ins == ours => {
                ctx.handle.inner.stats.event("reorg_unconfirmed");
                tracing::warn!(
                    height = first_orphan,
                    "the gateway disagrees with Insight about a block we hold; not reorganizing"
                );
                return Reorg::Unconfirmed;
            }
            Ok(_) => {}
            Err(e) => {
                // Insight down: act within the window only (the replacement blocks re-fill it).
                tracing::debug!(error = %e, "reorg: Insight unavailable for confirmation");
            }
        }
    }
    if deep {
        tracing::error!(
            tip = th,
            floor,
            "reorg deeper than the comparable window; dropping that window only and jumping"
        );
    }
    let orphaned = cursor.truncate_above(fork);
    if orphaned.is_empty() {
        return if deep { Reorg::Deep } else { Reorg::Done };
    }
    tracing::warn!(fork, old_tip = th, depth = orphaned.len(), "reorg detected");
    let sent = ctx
        .send(Obs::Reorg {
            fork_height: fork,
            old_tip: th,
            orphaned,
        })
        .await;
    match (sent, deep) {
        (false, _) => Reorg::Unconfirmed,
        (true, true) => Reorg::Deep,
        (true, false) => Reorg::Done,
    }
}

/// NextPayees: `fluxnodecurrentwinner` (cache-busted) after each tip.
pub async fn payees(ctx: JobCtx, mut rx: mpsc::Receiver<u32>) {
    while let Some(mut tip) = rx.recv().await {
        while let Ok(t) = rx.try_recv() {
            tip = t;
        }
        // Give the load-balanced daemons a moment to process the tip block; a lagging one
        // answers with the tip block's own winners (the reducer re-asks once when it does).
        if !ctx.sleep(Duration::from_secs(2)).await {
            break;
        }
        while let Ok(t) = rx.try_recv() {
            tip = t;
        }
        for attempt in 0..2 {
            match ctx
                .call(
                    Upstream::FluxOs,
                    "fluxnodecurrentwinner",
                    ctx.clients.fluxos.fluxnode_current_winner(),
                )
                .await
            {
                Ok(w) => {
                    let winners: Vec<_> =
                        w.0.iter()
                            .map(|(k, e)| {
                                let mut tier = Tier::parse_lenient(&e.tier);
                                if tier == Tier::Unknown {
                                    tier = Tier::parse_lenient(k);
                                }
                                let op = Collateral::parse(&e.collateral)
                                    .ok()
                                    .and_then(|c| c.as_full().copied());
                                (tier, op, e.payment_address.clone(), e.last_paid_height)
                            })
                            .collect();
                    // Stale when a named winner was already paid in the tip block.
                    if winners.iter().any(|w| w.3 == Some(tip)) && attempt == 0 {
                        if !ctx.sleep(Duration::from_secs(3)).await {
                            return;
                        }
                        continue;
                    }
                    let _ = ctx
                        .send(Obs::Winners {
                            height: tip + 1,
                            winners: winners.into_iter().map(|(t, o, a, _)| (t, o, a)).collect(),
                        })
                        .await;
                    ctx.ok("next_payees");
                    break;
                }
                Err(e) => {
                    ctx.fail("next_payees", &e);
                    break;
                }
            }
        }
    }
}

/// Direct nodes kept in the FluxOS failover pool.
const POOL_SIZE: usize = 5;
/// Height probes per pool refresh (to find [`POOL_SIZE`] nodes at the tip).
const POOL_PROBES: usize = 15;
/// Pool refresh interval: a node that falls behind leaves within this.
const POOL_REFRESH: Duration = Duration::from_secs(300);
/// Our applied tip counts as the best known tip while its block is at most this old.
const TIP_FRESH_MS: u64 = 5 * 60_000;

/// Feeds direct nodes at the chain tip into the FluxOS failover pool (ARCHITECTURE 3.1): a node
/// is admitted only when its daemon height is within `MAX_HEIGHT_LAG` (2) of the best known tip,
/// re-checked every refresh. The best known tip is our applied tip while it is fresh, else
/// Insight's; with neither the pool is emptied, so chain reads stay on the gateway.
pub async fn failover_pool(ctx: JobCtx) {
    if !ctx.sleep(Duration::from_secs(120)).await {
        return;
    }
    loop {
        let admitted = if let Some(best) = best_known_tip(&ctx).await {
            admit_pool(&ctx, best).await
        } else {
            tracing::debug!("failover pool: no best known tip; keeping chain reads on the gateway");
            Vec::new()
        };
        ctx.clients.fluxos.set_failover_nodes(&admitted);
        if !ctx.sleep(POOL_REFRESH).await {
            return;
        }
    }
}

async fn best_known_tip(ctx: &JobCtx) -> Option<u32> {
    let p = ctx.handle.published();
    if let Some(t) = p.network.tip.as_ref()
        && now_ms().saturating_sub(t.time_ms) <= TIP_FRESH_MS
    {
        return Some(t.height);
    }
    ctx.call(
        Upstream::Insight,
        "insight status",
        ctx.clients.insight.status_info(),
    )
    .await
    .ok()
    .map(|s| s.info.blocks)
    .filter(|h| *h > 0)
}

/// Probes up to [`POOL_PROBES`] reachable confirmed nodes (random start) and keeps the first
/// [`POOL_SIZE`] whose height is acceptable.
async fn admit_pool(ctx: &JobCtx, best: u32) -> Vec<GuardedEndpoint> {
    let published = ctx.handle.published();
    let total = published.nodes.len();
    let offset = super::jitter_ms(total.max(1) as u64) as usize;
    let mut admitted = Vec::new();
    let mut probes = 0;
    for i in 0..total {
        if admitted.len() >= POOL_SIZE || probes >= POOL_PROBES {
            break;
        }
        let rec = &published.nodes[(i + offset) % total];
        if rec.status != atlas_core::NodeStatus::Confirmed || rec.reachable != Some(true) {
            continue;
        }
        let Some(node) = rec.endpoint.and_then(|ep| GuardedEndpoint::new(ep).ok()) else {
            continue;
        };
        probes += 1;
        match ctx
            .call(
                Upstream::Node,
                "getblockcount",
                ctx.clients.node_api.block_count(&node),
            )
            .await
        {
            Ok(height) if atlas_flux::upstream::height_acceptable(height, best) => {
                admitted.push(node);
            }
            Ok(height) => {
                ctx.handle
                    .inner
                    .stats
                    .event("failover_node_height_rejected");
                tracing::debug!(%node, height, best, "failover pool: node not at the tip");
            }
            Err(e) => tracing::debug!(%node, error = %e, "failover pool: height probe failed"),
        }
    }
    admitted
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use atlas_flux::{Clients, ClientsConfig};
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    use super::*;
    use crate::{Engine, EngineConfig, IngestConfig, WatchSet};

    /// A gateway that fails `getblock` `fail` times ("Can't read block from disk"), then serves
    /// the fixture block.
    async fn gateway(fail: usize) -> (String, Arc<AtomicUsize>) {
        let block = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../docs/research/fixtures/flux/daemon_getblock_2996916_verbosity2.json"
        ))
        .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let c = Arc::clone(&calls);
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = vec![0u8; 4096];
                let _ = s.read(&mut buf).await;
                let n = c.fetch_add(1, Ordering::SeqCst);
                let body: Vec<u8> = if n < fail {
                    br#"{"status":"error","data":{"code":-32603,"name":"Error","message":"Can't read block from disk"}}"#.to_vec()
                } else {
                    block.clone()
                };
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = s.write_all(head.as_bytes()).await;
                let _ = s.write_all(&body).await;
            }
        });
        (base, calls)
    }

    /// Senders the job context watches; dropping them would read as a shutdown.
    type Keep = (
        tokio::sync::watch::Sender<bool>,
        tokio::sync::watch::Sender<WatchSet>,
    );

    fn ctx(base: &str) -> (tempfile::TempDir, JobCtx, mpsc::Receiver<Obs>, Keep) {
        ctx_with(base, None)
    }

    fn ctx_with(
        base: &str,
        insight: Option<&str>,
    ) -> (tempfile::TempDir, JobCtx, mpsc::Receiver<Obs>, Keep) {
        let dir = tempfile::tempdir().unwrap();
        let store = atlas_store::Store::open(dir.path().join("atlas.redb")).unwrap();
        let mut cc = ClientsConfig {
            fluxos_gateway: base.to_owned(),
            ..ClientsConfig::default()
        };
        if let Some(i) = insight {
            cc.insight_bases = vec![i.to_owned()];
        }
        cc.http.attempts = 1;
        let clients = Clients::new(cc).unwrap();
        let cfg = EngineConfig {
            ingest: IngestConfig::disabled(),
            ..EngineConfig::default()
        };
        let handle = Engine::start(cfg.clone(), store, clients.clone());
        let (obs_tx, obs_rx) = mpsc::channel(64);
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        let (w_tx, w_rx) = tokio::sync::watch::channel(WatchSet::default());
        let ctx = JobCtx::new(clients, obs_tx, handle, Arc::new(cfg.ingest), stop_rx, w_rx);
        (dir, ctx, obs_rx, (stop_tx, w_tx))
    }

    fn fixture_hash() -> BlockHash {
        Hash32::from_hex("fedbc9240264f9cb2cb9b90508cbb4184ff1d4f23ffe639c957e9b91967065f8")
            .unwrap()
    }

    /// An upstream that answers by path suffix (query strings ignored); unknown paths get a
    /// FluxOS "not found" envelope and a 404.
    async fn fake(routes: HashMap<String, String>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let routes = Arc::new(routes);
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else {
                    break;
                };
                let routes = Arc::clone(&routes);
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/");
                    let path = path.split('?').next().unwrap_or(path);
                    let hit = routes.iter().find(|(k, _)| path.ends_with(k.as_str()));
                    let (status, body) = match hit {
                        Some((_, b)) => ("200 OK", b.clone()),
                        None => (
                            "404 Not Found",
                            r#"{"status":"error","data":{"code":-5,"name":"Error","message":"not found"}}"#
                                .to_owned(),
                        ),
                    };
                    let head = format!(
                        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = s.write_all(head.as_bytes()).await;
                    let _ = s.write_all(body.as_bytes()).await;
                });
            }
        });
        base
    }

    fn hash_of(fork: u8, h: u32) -> BlockHash {
        Hash32::from_hex(&format!("{fork:02x}{h:062x}")).unwrap()
    }

    /// A block envelope from the fixture with another hash, height and parent.
    fn block_json(hash: BlockHash, height: u32, prev: BlockHash) -> String {
        let raw = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../docs/research/fixtures/flux/daemon_getblock_2996916_verbosity2.json"
        ))
        .unwrap();
        let mut v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        v["data"]["hash"] = hash.to_hex().into();
        v["data"]["height"] = height.into();
        v["data"]["previousblockhash"] = prev.to_hex().into();
        v.to_string()
    }

    /// Gateway routes for a chain: `getblockhash/<h>` and `getblock/<hash>/2` per block.
    fn chain_routes(chain: &[(u32, BlockHash, BlockHash)]) -> HashMap<String, String> {
        let mut r = HashMap::new();
        for (h, hash, prev) in chain {
            r.insert(
                format!("/daemon/getblockhash/{h}"),
                format!(r#"{{"status":"success","data":"{}"}}"#, hash.to_hex()),
            );
            r.insert(
                format!("/daemon/getblock/{}/2", hash.to_hex()),
                block_json(*hash, *h, *prev),
            );
        }
        r
    }

    /// Insight `block-index/<h>` routes.
    fn insight_routes(chain: &[(u32, BlockHash)]) -> HashMap<String, String> {
        chain
            .iter()
            .map(|(h, hash)| {
                (
                    format!("/api/block-index/{h}"),
                    format!(r#"{{"blockHash":"{}"}}"#, hash.to_hex()),
                )
            })
            .collect()
    }

    fn drain(obs: &mut mpsc::Receiver<Obs>) -> Vec<Obs> {
        let mut v = Vec::new();
        while let Ok(o) = obs.try_recv() {
            v.push(o);
        }
        v
    }

    /// L13: a one-deep reorg right after a gap jump drops only the jump block. The cursor
    /// holds nothing below it, so the backfilled blocks under it are never judged (before the
    /// fix the walk-back found no common block and deleted the ten heights below the jump).
    #[tokio::test]
    async fn a_reorg_after_a_jump_never_deletes_below_the_cursor() {
        let h = 3_000_000;
        // Chain B replaced our jump block a(h) with b(h); both descend from a(h - 1).
        let mut chain: Vec<(u32, BlockHash, BlockHash)> = (h - 12..h)
            .map(|x| (x, hash_of(0xa, x), hash_of(0xa, x - 1)))
            .collect();
        chain.push((h, hash_of(0xb, h), hash_of(0xa, h - 1)));
        chain.push((h + 1, hash_of(0xb, h + 1), hash_of(0xb, h)));
        let gw = fake(chain_routes(&chain)).await;
        let ins = fake(insight_routes(&[(h, hash_of(0xb, h))])).await;
        let (_dir, ctx, mut obs, _keep) = ctx_with(&gw, Some(&ins));
        let mut cursor = Cursor::default();
        cursor.reset(h, hash_of(0xa, h));
        sync_to(&ctx, &mut cursor, hash_of(0xb, h + 1), 1, false).await;
        let got = drain(&mut obs);
        let forks: Vec<u32> = got
            .iter()
            .filter_map(|o| match o {
                Obs::Reorg { fork_height, .. } => Some(*fork_height),
                _ => None,
            })
            .collect();
        assert_eq!(forks, vec![h - 1], "only the jump block is orphaned");
        assert!(cursor.contains(&hash_of(0xb, h + 1)));
    }

    /// L13: when Insight still holds our chain, a gateway backend on another (stale or bogus)
    /// fork deletes nothing (before the fix the walk-back cascaded window after window).
    #[tokio::test]
    async fn a_gateway_fork_insight_disagrees_with_deletes_nothing() {
        let h = 3_000_000;
        let mut cursor = Cursor::default();
        for x in h - 20..=h {
            cursor.push(x, hash_of(0xa, x));
        }
        // The gateway's chain diverges 15 blocks deep.
        let chain: Vec<(u32, BlockHash, BlockHash)> = (h - 30..=h + 1)
            .map(|x| {
                let tag = |y: u32| if y >= h - 15 { 0xb } else { 0xa };
                (x, hash_of(tag(x), x), hash_of(tag(x - 1), x - 1))
            })
            .collect();
        let gw = fake(chain_routes(&chain)).await;
        let ours: Vec<(u32, BlockHash)> = (h - 30..=h).map(|x| (x, hash_of(0xa, x))).collect();
        let ins = fake(insight_routes(&ours)).await;
        let (_dir, ctx, mut obs, _keep) = ctx_with(&gw, Some(&ins));
        sync_to(&ctx, &mut cursor, hash_of(0xb, h + 1), 1, false).await;
        let got = drain(&mut obs);
        assert!(
            !got.iter().any(|o| matches!(o, Obs::Reorg { .. })),
            "no reorg without Insight's confirmation"
        );
        assert_eq!(cursor.tip(), Some((h, hash_of(0xa, h))));
    }

    /// L13: a real reorg deeper than the window (Insight agrees) drops one window, once, and
    /// jumps to the new tip instead of walking back window after window.
    #[tokio::test]
    async fn a_deep_reorg_drops_one_window_and_jumps() {
        let h = 3_000_000;
        let mut cursor = Cursor::default();
        for x in h - 40..=h {
            cursor.push(x, hash_of(0xa, x));
        }
        let tag = |y: u32| if y >= h - 25 { 0xb } else { 0xa };
        let chain: Vec<(u32, BlockHash, BlockHash)> = (h - 40..=h + 1)
            .map(|x| (x, hash_of(tag(x), x), hash_of(tag(x - 1), x - 1)))
            .collect();
        let gw = fake(chain_routes(&chain)).await;
        let theirs: Vec<(u32, BlockHash)> =
            (h - 40..=h + 1).map(|x| (x, hash_of(tag(x), x))).collect();
        let ins = fake(insight_routes(&theirs)).await;
        let (_dir, ctx, mut obs, _keep) = ctx_with(&gw, Some(&ins));
        sync_to(&ctx, &mut cursor, hash_of(0xb, h + 1), 1, false).await;
        let got = drain(&mut obs);
        let forks: Vec<u32> = got
            .iter()
            .filter_map(|o| match o {
                Obs::Reorg { fork_height, .. } => Some(*fork_height),
                _ => None,
            })
            .collect();
        assert_eq!(forks, vec![h - FINALITY - 1], "one window, once");
        let jumped = got.iter().any(|o| {
            matches!(o, Obs::Block { block, discontinuous: true, .. } if block.summary.height == h + 1)
        });
        assert!(jumped, "the new tip is applied as a jump");
    }

    /// M3: a block answer is accepted only when it is the requested block at a plausible
    /// height; a wrong one is rejected (and counted) and the sync applies nothing.
    #[tokio::test]
    async fn forged_block_answers_are_rejected() {
        let h = 3_000_000;
        let want = hash_of(0xa, h);
        // The upstream answers the request for `want` with another block.
        let mut routes = HashMap::new();
        routes.insert(
            format!("/daemon/getblock/{}/2", want.to_hex()),
            block_json(hash_of(0xc, h), h, hash_of(0xa, h - 1)),
        );
        // And a block claiming a height near u32::MAX.
        let huge = hash_of(0xd, 7);
        routes.insert(
            format!("/daemon/getblock/{}/2", huge.to_hex()),
            block_json(huge, u32::MAX - 1, hash_of(0xa, h - 1)),
        );
        let gw = fake(routes).await;
        let (_dir, ctx, mut obs, _keep) = ctx(&gw);
        let mut cursor = Cursor::default();
        cursor.reset(h - 1, hash_of(0xa, h - 1));
        sync_to(&ctx, &mut cursor, want, 1, false).await;
        sync_to(&ctx, &mut cursor, huge, 1, false).await;
        assert!(drain(&mut obs).is_empty(), "nothing applied");
        assert_eq!(cursor.tip(), Some((h - 1, hash_of(0xa, h - 1))));
        assert_eq!(ctx.clients.fluxos.failover().rejected(), 2);
    }

    #[test]
    fn plausible_heights() {
        let now = CHAIN_ANCHOR.1 + 3_600_000;
        // From a fresh tip: about one block per 20 s plus slack.
        assert_eq!(max_plausible_height(Some((100, now - 60_000)), now), 163);
        // Without a tip: the chain anchor.
        let b = max_plausible_height(None, now);
        assert!(
            b > CHAIN_ANCHOR.0 + 120 && b < CHAIN_ANCHOR.0 + 2_400,
            "{b}"
        );
        // Saturates instead of wrapping.
        assert_eq!(max_plausible_height(Some((u32::MAX - 1, 0)), now), u32::MAX);
    }

    #[tokio::test]
    async fn a_tip_the_gateway_cannot_serve_yet_is_retried() {
        let (base, calls) = gateway(2).await;
        let (_dir, ctx, mut obs, _keep) = ctx(&base);
        let (_tx, tips) = mpsc::channel(4);
        let mut cursor = Cursor::default();
        let hash = fixture_hash();
        sync_retrying(
            &ctx,
            &mut cursor,
            &tips,
            (hash, 7),
            false,
            &[10, 10, 10, 10],
        )
        .await;
        assert!(cursor.contains(&hash));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        let Some(Obs::Block {
            block, received_ms, ..
        }) = obs.recv().await
        else {
            panic!("expected the block");
        };
        assert_eq!(block.summary.hash, hash);
        // The push time is kept, so pipeline latency includes the wait.
        assert_eq!(received_ms, 7);
    }

    #[tokio::test]
    async fn a_newer_tip_supersedes_the_retries() {
        let (base, calls) = gateway(usize::MAX).await;
        let (_dir, ctx, _obs, _keep) = ctx(&base);
        let (tx, tips) = mpsc::channel(4);
        tx.send((Hash32([9; 32]), 1)).await.unwrap();
        let mut cursor = Cursor::default();
        sync_retrying(
            &ctx,
            &mut cursor,
            &tips,
            (fixture_hash(), 7),
            false,
            &[10, 10, 10],
        )
        .await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "no retry once a newer tip is queued"
        );
        // Without a newer tip, every delay gets one more attempt.
        let (_tx2, tips) = mpsc::channel(4);
        sync_retrying(
            &ctx,
            &mut cursor,
            &tips,
            (fixture_hash(), 7),
            false,
            &[10, 10, 10],
        )
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 5);
    }
}

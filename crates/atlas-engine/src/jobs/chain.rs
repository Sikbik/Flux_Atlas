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

    pub fn truncate_above(&mut self, h: u32) -> Vec<BlockHash> {
        let doomed: Vec<u32> = self.recent.range(h + 1..).map(|(k, _)| *k).collect();
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

async fn fetch(ctx: &JobCtx, hash: &BlockHash) -> Option<DecodedBlock> {
    let raw = match ctx
        .call(
            Upstream::FluxOs,
            "getblock",
            ctx.clients.fluxos.get_block(&hash.to_hex()),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => {
            ctx.fail("block_decoder", &e);
            return None;
        }
    };
    match decode_block(&raw) {
        Ok(d) => Some(d),
        Err(e) => {
            ctx.fail("block_decoder", &e);
            None
        }
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
        if h == th + 1 && d.summary.prev_hash == thash {
            apply(ctx, cursor, d, received_ms, false).await;
            return;
        }
        if h > th + 1 {
            if h - th > max_gap {
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
            let Some(nh) = hash_at(ctx, th + 1).await else {
                return;
            };
            let Some(n) = fetch(ctx, &nh).await else {
                return;
            };
            kept = Some(d);
            if n.summary.prev_hash == thash {
                apply(ctx, cursor, n, now_ms(), false).await;
                continue;
            }
            if !reorg(ctx, cursor).await {
                return;
            }
            continue;
        }
        if cursor.get(h) == Some(d.summary.hash) {
            return;
        }
        kept = Some(d);
        if !reorg(ctx, cursor).await {
            return;
        }
    }
}

/// Finds the fork point by walking back through the finality window and tells the reducer.
async fn reorg(ctx: &JobCtx, cursor: &mut Cursor) -> bool {
    let Some((th, _)) = cursor.tip() else {
        return false;
    };
    let floor = th.saturating_sub(FINALITY);
    let mut fork = None;
    for h in (floor..=th).rev() {
        let Some(up) = hash_at(ctx, h).await else {
            // The upstream backend has not reached this height: not a reorg we can act on.
            if h == th {
                continue;
            }
            return false;
        };
        if cursor.get(h) == Some(up) {
            fork = Some(h);
            break;
        }
    }
    let fork = fork.unwrap_or_else(|| {
        tracing::error!(tip = th, "reorg deeper than the finality window");
        floor.saturating_sub(1)
    });
    let orphaned = cursor.truncate_above(fork);
    if orphaned.is_empty() {
        return true;
    }
    tracing::warn!(fork, old_tip = th, depth = orphaned.len(), "reorg detected");
    ctx.send(Obs::Reorg {
        fork_height: fork,
        old_tip: th,
        orphaned,
    })
    .await
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

/// Feeds healthy direct nodes into the FluxOS failover pool every 10 minutes.
pub async fn failover_pool(ctx: JobCtx) {
    if !ctx.sleep(Duration::from_secs(120)).await {
        return;
    }
    loop {
        let p = ctx.handle.published();
        let mut picked: Vec<GuardedEndpoint> = Vec::new();
        let offset = super::jitter_ms(p.nodes.len().max(1) as u64) as usize;
        let n = p.nodes.len();
        for i in 0..n {
            let r = &p.nodes[(i + offset) % n];
            if r.status != atlas_core::NodeStatus::Confirmed || r.reachable != Some(true) {
                continue;
            }
            if let Some(ep) = r.endpoint
                && let Ok(g) = GuardedEndpoint::new(ep)
            {
                picked.push(g);
            }
            if picked.len() >= 5 {
                break;
            }
        }
        if !picked.is_empty() {
            ctx.clients.fluxos.set_failover_nodes(&picked);
        }
        if !ctx.sleep(Duration::from_secs(600)).await {
            return;
        }
    }
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
        let dir = tempfile::tempdir().unwrap();
        let store = atlas_store::Store::open(dir.path().join("atlas.redb")).unwrap();
        let mut cc = ClientsConfig {
            fluxos_gateway: base.to_owned(),
            ..ClientsConfig::default()
        };
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

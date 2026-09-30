//! Several redundant sockets merged into one deduplicated stream.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, PoisonError};

use atlas_core::Hash32;
use futures_util::future::select_all;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::client::{InsightSocket, SocketEvent, SocketMessage};
use super::config::{SocketConfig, endpoint_label};
use super::frame::ChainPush;
use super::health::SocketHealth;

/// Identity of a push for deduplication across sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DedupeKey {
    /// Block hash.
    Block(Hash32),
    /// Transaction id.
    Tx(Hash32),
    /// `info` event for a height.
    Info(u32),
    /// `markets_info` content fingerprint.
    Markets(u64),
}

impl ChainPush {
    /// The key identifying this push across sources, or `None` for pushes that are always
    /// forwarded (unknown events, `info` without a height).
    pub fn dedupe_key(&self) -> Option<DedupeKey> {
        match self {
            Self::Block { hash } => Some(DedupeKey::Block(*hash)),
            Self::Tx(tx) => Some(DedupeKey::Tx(tx.txid)),
            Self::Info(i) => i.height.map(DedupeKey::Info),
            Self::MarketsInfo(m) => Some(DedupeKey::Markets(m.fingerprint())),
            Self::Unknown { .. } => None,
        }
    }
}

/// Per-source delivery counters.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SourceStats {
    /// Endpoint label.
    pub source: Arc<str>,
    /// Keyed pushes this source delivered first (and that were emitted).
    pub first: u64,
    /// Blocks this source delivered first.
    pub first_blocks: u64,
    /// Keyed pushes this source delivered after another source (dropped).
    pub duplicates: u64,
    /// Blocks this source delivered after another source.
    pub duplicate_blocks: u64,
    /// Sum of how far behind the first source this one was, over its duplicates (ms).
    pub lag_ms_sum: u64,
    /// Largest lag behind the first source (ms).
    pub lag_ms_max: u64,
    /// Sum of the lag over duplicate blocks only (ms).
    pub block_lag_ms_sum: u64,
}

/// Merge counters for [`DualSocket`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DualStats {
    /// Pushes emitted downstream (keyed and unkeyed).
    pub emitted: u64,
    /// Keyed pushes dropped as duplicates.
    pub duplicates: u64,
    /// Per-source counters, in first-seen order.
    pub sources: Vec<SourceStats>,
}

impl DualStats {
    fn source_mut(&mut self, label: &Arc<str>) -> &mut SourceStats {
        let idx = if let Some(i) = self.sources.iter().position(|s| s.source == *label) {
            i
        } else {
            self.sources.push(SourceStats {
                source: label.clone(),
                ..SourceStats::default()
            });
            self.sources.len() - 1
        };
        &mut self.sources[idx]
    }
}

/// What [`Merger::offer`] decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// First delivery of a keyed push: forward it.
    First,
    /// Already delivered by `first_source`, `lag_ms` earlier: drop it.
    Duplicate {
        /// Source that delivered it first.
        first_source: Arc<str>,
        /// `received_ms` difference (this minus first), clamped at 0.
        lag_ms: u64,
    },
    /// The push has no dedupe key: forward it.
    Unkeyed,
}

impl Verdict {
    /// True if the push should be forwarded.
    pub fn forward(&self) -> bool {
        !matches!(self, Self::Duplicate { .. })
    }
}

/// Deduplicates pushes from several sources with a bounded memory of recent keys (FIFO
/// eviction), and keeps [`DualStats`]. Pure and synchronous; [`DualSocket`] drives it.
#[derive(Debug)]
pub struct Merger {
    capacity: usize,
    order: VecDeque<DedupeKey>,
    seen: HashMap<DedupeKey, (Arc<str>, u64)>,
    stats: DualStats,
}

impl Merger {
    /// A merger remembering the last `capacity` keys (at least 1).
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            capacity,
            order: VecDeque::with_capacity(capacity),
            seen: HashMap::with_capacity(capacity),
            stats: DualStats::default(),
        }
    }

    /// Registers a source so it shows up in the stats even before it delivers anything.
    pub fn add_source(&mut self, label: &Arc<str>) {
        self.stats.source_mut(label);
    }

    /// Classifies one event and updates the counters.
    pub fn offer(&mut self, ev: &SocketEvent) -> Verdict {
        let is_block = matches!(ev.push, ChainPush::Block { .. });
        let Some(key) = ev.push.dedupe_key() else {
            self.stats.emitted += 1;
            return Verdict::Unkeyed;
        };
        if let Some((first_source, first_ms)) = self.seen.get(&key) {
            let lag_ms = ev.received_ms.saturating_sub(*first_ms);
            let first_source = first_source.clone();
            self.stats.duplicates += 1;
            let s = self.stats.source_mut(&ev.source);
            s.duplicates += 1;
            s.lag_ms_sum += lag_ms;
            s.lag_ms_max = s.lag_ms_max.max(lag_ms);
            if is_block {
                s.duplicate_blocks += 1;
                s.block_lag_ms_sum += lag_ms;
            }
            return Verdict::Duplicate {
                first_source,
                lag_ms,
            };
        }
        if self.order.len() >= self.capacity
            && let Some(old) = self.order.pop_front()
        {
            self.seen.remove(&old);
        }
        self.order.push_back(key);
        self.seen.insert(key, (ev.source.clone(), ev.received_ms));
        self.stats.emitted += 1;
        let s = self.stats.source_mut(&ev.source);
        s.first += 1;
        if is_block {
            s.first_blocks += 1;
        }
        Verdict::First
    }

    /// Current counters.
    pub fn stats(&self) -> &DualStats {
        &self.stats
    }

    /// Number of keys currently remembered.
    pub fn len(&self) -> usize {
        self.order.len()
    }

    /// True if no key is remembered.
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
}

/// Forwards `input` to `output`, dropping duplicate pushes. State changes pass through.
/// Ends when every input sender is gone or the output receiver is dropped.
pub(super) async fn run_merge(
    mut input: mpsc::Receiver<SocketMessage>,
    output: mpsc::Sender<SocketMessage>,
    merger: Arc<Mutex<Merger>>,
) {
    while let Some(msg) = input.recv().await {
        if let SocketMessage::Event(ev) = &msg {
            let verdict = merger
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .offer(ev);
            if !verdict.forward() {
                continue;
            }
        }
        if output.send(msg).await.is_err() {
            break;
        }
    }
}

/// Recomputes the combined health whenever any input changes. Ends when any socket's health
/// sender is gone (the sockets only stop together).
async fn combine_health(
    mut inputs: Vec<watch::Receiver<SocketHealth>>,
    output: watch::Sender<SocketHealth>,
) {
    fn publish(inputs: &mut [watch::Receiver<SocketHealth>], output: &watch::Sender<SocketHealth>) {
        let snaps: Vec<SocketHealth> = inputs
            .iter_mut()
            .map(|r| r.borrow_and_update().clone())
            .collect();
        let combined = SocketHealth::combine(&snaps);
        output.send_if_modified(|h| {
            if *h == combined {
                false
            } else {
                *h = combined;
                true
            }
        });
    }
    loop {
        publish(&mut inputs, &output);
        if inputs.is_empty() {
            return;
        }
        let changed = {
            let futs = inputs.iter_mut().map(|r| Box::pin(r.changed()));
            select_all(futs).await.0
        };
        if changed.is_err() {
            // A socket stopped: publish the final (disconnected) state and end.
            publish(&mut inputs, &output);
            return;
        }
    }
}

/// N redundant Insight sockets (by default the main explorer and explorer2) merged into one
/// stream. Each block hash, txid, info height and markets update is emitted once, attributed
/// to the source that delivered it first. State changes of every socket are forwarded.
///
/// Combined health is healthy while any socket is healthy. Dropping the handle or calling
/// [`DualSocket::shutdown`] closes every socket.
#[derive(Debug)]
pub struct DualSocket {
    sockets: Vec<InsightSocket>,
    health: watch::Receiver<SocketHealth>,
    merger: Arc<Mutex<Merger>>,
    merge_task: JoinHandle<()>,
    health_task: JoinHandle<()>,
}

impl DualSocket {
    /// Spawns one socket per `config.urls` entry plus the merge task on the current runtime.
    pub fn spawn(config: &SocketConfig) -> (Self, mpsc::Receiver<SocketMessage>) {
        let cap = config.channel_capacity.max(1);
        let (in_tx, in_rx) = mpsc::channel(cap);
        let (out_tx, out_rx) = mpsc::channel(cap);
        let mut merger = Merger::new(config.dedupe_capacity);
        let mut labels = HashSet::new();
        let mut sockets = Vec::with_capacity(config.urls.len());
        for (i, url) in config.urls.iter().enumerate() {
            let mut label = endpoint_label(url);
            if !labels.insert(label.clone()) {
                label = format!("{label}#{}", i + 1);
                labels.insert(label.clone());
            }
            let label: Arc<str> = label.into();
            merger.add_source(&label);
            sockets.push(InsightSocket::spawn_with(url, label, config, in_tx.clone()));
        }
        drop(in_tx);
        let merger = Arc::new(Mutex::new(merger));
        let merge_task = tokio::spawn(run_merge(in_rx, out_tx, merger.clone()));
        let (health_tx, health) = watch::channel(SocketHealth::default());
        let health_task = tokio::spawn(combine_health(
            sockets.iter().map(InsightSocket::health).collect(),
            health_tx,
        ));
        (
            Self {
                sockets,
                health,
                merger,
                merge_task,
                health_task,
            },
            out_rx,
        )
    }

    /// Combined health (healthy if any socket is healthy).
    pub fn health(&self) -> watch::Receiver<SocketHealth> {
        self.health.clone()
    }

    /// Current health of each socket, labelled.
    pub fn source_health(&self) -> Vec<(Arc<str>, SocketHealth)> {
        self.sockets
            .iter()
            .map(|s| (s.source().clone(), s.health().borrow().clone()))
            .collect()
    }

    /// Labels of the sockets, in config order.
    pub fn sources(&self) -> Vec<Arc<str>> {
        self.sockets.iter().map(|s| s.source().clone()).collect()
    }

    /// Snapshot of the merge counters.
    pub fn stats(&self) -> DualStats {
        self.merger
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .stats()
            .clone()
    }

    /// Closes every socket and waits for all tasks to finish.
    pub async fn shutdown(self) {
        let Self {
            sockets,
            merge_task,
            health_task,
            ..
        } = self;
        for s in sockets {
            s.shutdown().await;
        }
        let _ = merge_task.await;
        let _ = health_task.await;
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::super::frame::{MarketsInfo, SocketInfo, SocketTx};
    use super::*;
    use atlas_core::Amount;

    fn h(n: u8) -> Hash32 {
        Hash32([n; 32])
    }

    fn ev(source: &Arc<str>, ms: u64, push: ChainPush) -> SocketEvent {
        SocketEvent {
            source: source.clone(),
            received_ms: ms,
            push,
        }
    }

    fn tx(n: u8) -> ChainPush {
        ChainPush::Tx(SocketTx {
            txid: h(n),
            value_out: Amount::ZERO,
            outputs: vec![],
            is_rbf: false,
        })
    }

    #[test]
    fn dedupe_and_attribution() {
        let a: Arc<str> = "a".into();
        let b: Arc<str> = "b".into();
        let mut m = Merger::new(16);
        m.add_source(&a);
        m.add_source(&b);
        assert_eq!(
            m.offer(&ev(&a, 1000, ChainPush::Block { hash: h(1) })),
            Verdict::First
        );
        assert_eq!(
            m.offer(&ev(&b, 1250, ChainPush::Block { hash: h(1) })),
            Verdict::Duplicate {
                first_source: a.clone(),
                lag_ms: 250
            }
        );
        assert_eq!(m.offer(&ev(&b, 2000, tx(2))), Verdict::First);
        assert_eq!(
            m.offer(&ev(&a, 1990, tx(2))),
            Verdict::Duplicate {
                first_source: b.clone(),
                lag_ms: 0
            }
        );
        // A block hash and a txid with the same bytes are different keys.
        assert_eq!(m.offer(&ev(&a, 3000, tx(1))), Verdict::First);
        // info dedupes by height, markets by content, unknown never.
        let info = |height| {
            ChainPush::Info(SocketInfo {
                height,
                ..SocketInfo::default()
            })
        };
        assert_eq!(m.offer(&ev(&a, 1, info(Some(5)))), Verdict::First);
        assert!(!m.offer(&ev(&b, 2, info(Some(5)))).forward());
        assert_eq!(m.offer(&ev(&b, 2, info(None))), Verdict::Unkeyed);
        assert_eq!(m.offer(&ev(&b, 3, info(None))), Verdict::Unkeyed);
        let mk = ChainPush::MarketsInfo(MarketsInfo {
            price_usd: Some(0.07),
            ..MarketsInfo::default()
        });
        assert_eq!(m.offer(&ev(&b, 4, mk.clone())), Verdict::First);
        assert!(!m.offer(&ev(&a, 5, mk)).forward());
        let unk = ChainPush::Unknown {
            event: "x".into(),
            payload: serde_json::Value::Null,
        };
        assert_eq!(m.offer(&ev(&a, 6, unk.clone())), Verdict::Unkeyed);
        assert_eq!(m.offer(&ev(&b, 6, unk)), Verdict::Unkeyed);

        let s = m.stats();
        assert_eq!(s.duplicates, 4);
        assert_eq!(s.emitted, 9);
        let sa = &s.sources[0];
        let sb = &s.sources[1];
        assert_eq!(
            (&*sa.source, sa.first, sa.first_blocks, sa.duplicates),
            ("a", 3, 1, 2)
        );
        assert_eq!(
            (&*sb.source, sb.first, sb.first_blocks, sb.duplicates),
            ("b", 2, 0, 2)
        );
        assert_eq!(
            (sb.duplicate_blocks, sb.block_lag_ms_sum, sb.lag_ms_max),
            (1, 250, 250)
        );
        assert_eq!(sa.duplicate_blocks, 0);
    }

    #[test]
    fn bounded_memory_evicts_oldest() {
        let a: Arc<str> = "a".into();
        let b: Arc<str> = "b".into();
        let mut m = Merger::new(3);
        for n in 0..5 {
            assert_eq!(m.offer(&ev(&a, 0, tx(n))), Verdict::First);
        }
        assert_eq!(m.len(), 3);
        // 0 and 1 were evicted, so they are "new" again; 4 is still remembered.
        assert!(!m.offer(&ev(&b, 0, tx(4))).forward());
        assert_eq!(m.offer(&ev(&b, 0, tx(0))), Verdict::First);
        assert_eq!(m.len(), 3);
        assert!(!m.is_empty());
    }

    #[tokio::test]
    async fn merge_task_over_two_synthetic_sources() {
        let a: Arc<str> = "a".into();
        let b: Arc<str> = "b".into();
        let (in_tx, in_rx) = mpsc::channel(64);
        let (out_tx, mut out_rx) = mpsc::channel(64);
        let merger = Arc::new(Mutex::new(Merger::new(64)));
        let task = tokio::spawn(run_merge(in_rx, out_tx, merger.clone()));

        let feed = |src: Arc<str>, offset: u64, tx_in: mpsc::Sender<SocketMessage>| async move {
            for n in 0..10u8 {
                let push = if n % 5 == 0 {
                    ChainPush::Block { hash: h(n) }
                } else {
                    tx(n)
                };
                tx_in
                    .send(SocketMessage::Event(ev(
                        &src,
                        u64::from(n) * 10 + offset,
                        push,
                    )))
                    .await
                    .unwrap();
                tokio::task::yield_now().await;
            }
        };
        let fa = tokio::spawn(feed(a.clone(), 0, in_tx.clone()));
        let fb = tokio::spawn(feed(b.clone(), 3, in_tx.clone()));
        in_tx
            .send(SocketMessage::State(super::super::client::StateChange {
                source: a.clone(),
                at_ms: 0,
                state: super::super::client::ConnState::Connecting { attempt: 1 },
            }))
            .await
            .unwrap();
        drop(in_tx);
        fa.await.unwrap();
        fb.await.unwrap();
        task.await.unwrap();

        let mut events = Vec::new();
        let mut states = 0;
        while let Ok(m) = out_rx.try_recv() {
            match m {
                SocketMessage::Event(e) => events.push(e),
                SocketMessage::State(_) => states += 1,
            }
        }
        assert_eq!(states, 1);
        assert_eq!(events.len(), 10, "each id exactly once");
        let keys: HashSet<_> = events.iter().map(|e| e.push.dedupe_key()).collect();
        assert_eq!(keys.len(), 10);
        let stats = merger.lock().unwrap().stats().clone();
        assert_eq!(stats.duplicates, 10);
        assert_eq!(stats.emitted, 10);
        let firsts: u64 = stats.sources.iter().map(|s| s.first).sum();
        assert_eq!(firsts, 10);
    }
}

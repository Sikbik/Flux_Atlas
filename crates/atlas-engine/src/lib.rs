//! Flux Atlas ingest engine.
//!
//! This crate is a skeleton: it fixes the interface the server consumes. `Engine::start` owns the
//! store and upstream clients, runs the ingest jobs (to be filled in: ARCHITECTURE section 3.2),
//! folds their events into projections, and publishes:
//!
//! - an immutable [`Published`] snapshot, swapped atomically (readers never block),
//! - a stream of [`LiveMsg`]s on a broadcast channel, each also kept in a bounded replay ring so
//!   reconnecting clients can resume from a sequence number.
//!
//! Every publish advances `seq`; bodies and live messages carry the seq they were built from.
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod body;
mod replay;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use arc_swap::ArcSwap;
use atlas_core::api::{AppIndexEntry, BlockLite, NetworkSummary, ServerInfo, TierCounts};
use atlas_core::live::{LiveBody, LiveMsg};
use atlas_core::{Amount, NodeRecord, now_ms};
use atlas_flux::Clients;
use atlas_store::Store;
use tokio::sync::{Mutex as AsyncMutex, broadcast};
use tokio::task::JoinHandle;

pub use body::{Encoding, PrebuiltBodies, PrebuiltBody};
pub use replay::Resync;

/// Engine settings.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Server name reported in `hello` and bootstrap.
    pub server_name: String,
    /// Build version reported in `hello` and bootstrap.
    pub version: String,
    /// Live messages kept for `since_seq` replay.
    pub replay_capacity: usize,
    /// Broadcast channel depth; a subscriber lagging further must resync.
    pub broadcast_capacity: usize,
    /// Keepalive `ping` interval.
    pub ping_interval: Duration,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            server_name: "flux-atlas".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            replay_capacity: 4096,
            broadcast_capacity: 1024,
            ping_interval: Duration::from_secs(20),
        }
    }
}

/// One immutable published state. Handlers read it through [`EngineHandle::published`].
#[derive(Debug, Clone)]
pub struct Published {
    pub seq: u64,
    pub generated_ms: u64,
    /// True while serving state restored from the store before fresh ingest completed.
    pub stale: bool,
    pub server: ServerInfo,
    pub network: NetworkSummary,
    /// Node view, sorted by node id.
    pub nodes: Arc<[NodeRecord]>,
    /// App index view.
    pub apps: Arc<[AppIndexEntry]>,
    /// Latest blocks, newest first.
    pub blocks: Arc<[BlockLite]>,
    pub bodies: PrebuiltBodies,
}

impl Published {
    fn empty(server: ServerInfo, nodes: Vec<NodeRecord>) -> Self {
        let mut tiers = TierCounts::default();
        for n in &nodes {
            tiers.add(n.tier);
        }
        let network = NetworkSummary {
            node_count: nodes.len() as u32,
            host_count: 0,
            tiers,
            country_count: 0,
            provider_count: 0,
            arcane_count: 0,
            unreachable_count: 0,
            app_count: 0,
            instance_count: 0,
            tip: None,
            reward: Amount::ZERO,
            next_reduction_height: None,
            supply: None,
            price: None,
            mempool_size: 0,
        };
        Self {
            seq: 0,
            generated_ms: now_ms(),
            stale: true,
            server,
            network,
            nodes: nodes.into(),
            apps: Arc::from(Vec::new()),
            blocks: Arc::from(Vec::new()),
            bodies: PrebuiltBodies::default(),
        }
    }
}

struct Inner {
    config: EngineConfig,
    server: ServerInfo,
    store: Store,
    clients: Clients,
    published: ArcSwap<Published>,
    seq: AtomicU64,
    tx: broadcast::Sender<Arc<LiveMsg>>,
    /// Publishing is serialized: seq assignment, ring push and broadcast happen under this lock so
    /// the ring and the channel see the same order.
    ring: std::sync::Mutex<replay::ReplayRing>,
    tasks: AsyncMutex<Vec<JoinHandle<()>>>,
}

/// The engine. Construct with [`Engine::start`].
pub struct Engine;

impl Engine {
    /// Starts the engine on the current tokio runtime and returns its handle.
    ///
    /// Restores the last known node view from the store (published as `stale`), then spawns the
    /// background tasks. Ingest jobs are not implemented in this skeleton; only the keepalive
    /// ticker runs.
    pub fn start(config: EngineConfig, store: Store, clients: Clients) -> EngineHandle {
        let server = ServerInfo {
            name: config.server_name.clone(),
            version: config.version.clone(),
            api_version: atlas_core::API_VERSION,
            started_ms: now_ms(),
        };
        let nodes = match store.nodes() {
            Ok(n) => n,
            Err(e) => {
                tracing::warn!(error = %e, "could not restore nodes from store; starting empty");
                Vec::new()
            }
        };
        let (tx, _) = broadcast::channel(config.broadcast_capacity.max(16));
        let inner = Arc::new(Inner {
            published: ArcSwap::from_pointee(Published::empty(server.clone(), nodes)),
            seq: AtomicU64::new(0),
            ring: std::sync::Mutex::new(replay::ReplayRing::new(config.replay_capacity)),
            tasks: AsyncMutex::new(Vec::new()),
            server,
            store,
            clients,
            config,
            tx,
        });
        let handle = EngineHandle { inner };
        let ticker = tokio::spawn(ping_loop(handle.clone()));
        if let Ok(mut t) = handle.inner.tasks.try_lock() {
            t.push(ticker);
        }
        handle
    }
}

async fn ping_loop(h: EngineHandle) {
    let mut iv = tokio::time::interval(h.inner.config.ping_interval);
    iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    iv.tick().await;
    loop {
        iv.tick().await;
        h.emit(None, LiveBody::Ping { now_ms: now_ms() });
    }
}

/// Cheap, cloneable handle to a running engine.
#[derive(Clone)]
pub struct EngineHandle {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for EngineHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineHandle")
            .field("seq", &self.seq())
            .finish_non_exhaustive()
    }
}

impl EngineHandle {
    /// Current published state. Lock-free; hold the `Arc` for as long as a request needs it.
    pub fn published(&self) -> Arc<Published> {
        self.inner.published.load_full()
    }

    /// Subscribes to live messages published from now on.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<LiveMsg>> {
        self.inner.tx.subscribe()
    }

    /// Live messages with `seq > since`, oldest first, or [`Resync`] if the ring no longer holds
    /// them. Callers resuming a connection should `subscribe` first, then replay, then drop
    /// duplicates from the subscription by seq.
    pub fn replay_since(&self, since: u64) -> Result<Vec<Arc<LiveMsg>>, Resync> {
        let ring = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ring.since(since, self.seq())
    }

    /// Latest assigned sequence number.
    pub fn seq(&self) -> u64 {
        self.inner.seq.load(Ordering::Acquire)
    }

    /// Server information (name, version, API version, start time).
    pub fn server_info(&self) -> &ServerInfo {
        &self.inner.server
    }

    /// The `hello` message for a new connection, stamped with the current seq.
    pub fn hello(&self) -> LiveMsg {
        let p = self.published();
        let now = now_ms();
        LiveMsg::new(
            self.seq(),
            now,
            None,
            LiveBody::Hello {
                server: self.inner.server.clone(),
                tip: p.network.tip.clone(),
                now_ms: now,
            },
        )
    }

    /// Store access for read paths the published views do not cover (history, lookups).
    pub fn store(&self) -> &Store {
        &self.inner.store
    }

    /// Upstream clients (for on-demand lookups such as tx or address detail).
    pub fn clients(&self) -> &Clients {
        &self.inner.clients
    }

    /// Assigns the next seq to a live message, records it for replay and broadcasts it.
    /// Used by ingest jobs; public so the server can be tested against a synthetic stream.
    pub fn emit(&self, event_ms: Option<u64>, body: LiveBody) -> Arc<LiveMsg> {
        let mut ring = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let seq = self.inner.seq.load(Ordering::Acquire) + 1;
        let msg = Arc::new(LiveMsg::new(seq, now_ms(), event_ms, body));
        ring.push(Arc::clone(&msg));
        self.inner.seq.store(seq, Ordering::Release);
        // No receivers is fine.
        let _ = self.inner.tx.send(Arc::clone(&msg));
        msg
    }

    /// Replaces the published state. The new state's `seq` is set to the current seq.
    pub fn publish(&self, mut next: Published) {
        let _guard = self
            .inner
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        next.seq = self.inner.seq.load(Ordering::Acquire);
        self.inner.published.store(Arc::new(next));
    }

    /// Stops background tasks. The handle stays readable.
    pub async fn shutdown(&self) {
        for t in self.inner.tasks.lock().await.drain(..) {
            t.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use atlas_flux::ClientsConfig;

    use super::*;

    fn engine() -> (tempfile::TempDir, EngineHandle) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("atlas.redb")).unwrap();
        let clients = Clients::new(ClientsConfig::default()).unwrap();
        let cfg = EngineConfig {
            replay_capacity: 4,
            ping_interval: Duration::from_secs(3600),
            ..EngineConfig::default()
        };
        (dir, Engine::start(cfg, store, clients))
    }

    #[tokio::test]
    async fn starts_stale_and_empty() {
        let (_d, h) = engine();
        let p = h.published();
        assert!(p.stale);
        assert_eq!(p.seq, 0);
        assert_eq!(p.network.node_count, 0);
        assert!(h.replay_since(0).unwrap().is_empty());
        let hello = h.hello().to_json();
        assert!(hello.contains(r#""t":"hello""#), "{hello}");
        h.shutdown().await;
    }

    #[tokio::test]
    async fn emit_broadcasts_and_replays() {
        let (_d, h) = engine();
        let mut rx = h.subscribe();
        for i in 0..6 {
            h.emit(Some(i), LiveBody::Ping { now_ms: i });
        }
        assert_eq!(h.seq(), 6);
        assert_eq!(rx.recv().await.unwrap().seq, 1);
        let r: Vec<u64> = h.replay_since(3).unwrap().iter().map(|m| m.seq).collect();
        assert_eq!(r, vec![4, 5, 6]);
        let e = h.replay_since(1).unwrap_err();
        assert_eq!((e.oldest, e.latest), (3, 6));

        let mut next = (*h.published()).clone();
        next.stale = false;
        h.publish(next);
        assert_eq!(h.published().seq, 6);
        assert!(!h.published().stale);
        h.shutdown().await;
    }
}

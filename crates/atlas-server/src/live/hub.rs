//! Live hub: one task subscribes to the engine's live stream, serializes every message exactly
//! once into a shared text frame, keeps a ring of recent frames for replay, and re-broadcasts
//! the frame to every WebSocket connection.
//!
//! Each connection holds a receiver of the hub's broadcast channel, which is its bounded queue:
//! a connection that falls more than `queue` frames behind observes `Lagged` and is dropped as
//! a slow consumer (it reconnects with `since_seq` and replays or resyncs).

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use atlas_core::api::TxLite;
use atlas_core::live::{LiveBody, LiveMsg, Topic};
use atlas_core::{Hash32, now_ms};
use atlas_engine::EngineHandle;
use axum::extract::ws::Utf8Bytes;
use tokio::sync::{broadcast, watch};

use crate::config::WsConfig;

/// One serialized live message, shared by every connection.
#[derive(Debug, Clone)]
pub struct Frame {
    pub seq: u64,
    /// Topic bit (`Topic::bit`), or 0 for control messages delivered to everyone.
    pub topic_bit: u8,
    /// Keepalive pings are not replayed.
    pub is_ping: bool,
    /// Delivered even if its seq is at or below the connection's dedupe mark (hub-level resync).
    pub bypass_dedupe: bool,
    pub text: Utf8Bytes,
}

impl Frame {
    pub fn from_msg(msg: &LiveMsg) -> Self {
        Self {
            seq: msg.seq,
            topic_bit: msg.body.topic().map_or(0, Topic::bit),
            is_ping: matches!(msg.body, LiveBody::Ping { .. }),
            bypass_dedupe: false,
            text: Utf8Bytes::from(msg.to_json()),
        }
    }

    /// Whether a connection subscribed to `mask` receives this frame.
    pub fn wanted(&self, mask: u8) -> bool {
        self.topic_bit == 0 || self.topic_bit & mask != 0
    }
}

/// Counters exported to Prometheus.
#[derive(Debug, Default)]
pub struct HubStats {
    pub connections_total: AtomicU64,
    pub rejected_total: AtomicU64,
    pub frames_published: AtomicU64,
    pub messages_sent: AtomicU64,
    pub bytes_sent: AtomicU64,
    /// Frames a lagging connection missed before it was dropped.
    pub messages_dropped: AtomicU64,
    pub slow_consumer_disconnects: AtomicU64,
    /// Connections closed because the peer sent nothing (not even a pong) for too long.
    pub idle_disconnects: AtomicU64,
    pub replayed: AtomicU64,
    pub resyncs: AtomicU64,
    pub hub_lagged: AtomicU64,
    /// Serialized bytes held by the frame ring.
    pub ring_bytes: AtomicU64,
    /// `sub` messages over the per-connection rate (deferred).
    pub subs_limited: AtomicU64,
    /// Deferred `sub` messages applied later.
    pub subs_deferred: AtomicU64,
    /// Handshakes refused by the per-client handshake rate.
    pub handshakes_limited: AtomicU64,
}

/// Why a new connection was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reject {
    ServerFull,
    TooManyFromIp,
    ShuttingDown,
}

/// Mempool transactions seen on the live stream (enriches `/mempool`).
#[derive(Debug, Default)]
struct MempoolMemo {
    by_txid: HashMap<Hash32, (TxLite, u64)>,
    order: VecDeque<Hash32>,
}

const MEMPOOL_MEMO_CAP: usize = 8192;

/// WebSocket handshakes a client may open at once, then one per second: a page load costs one,
/// a reconnect loop cannot turn every handshake into a replay.
pub const HANDSHAKE_BURST: u32 = 30;
pub const HANDSHAKES_PER_SECOND: u32 = 1;

impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hub")
            .field("connections", &self.connections())
            .field("ring_cap", &self.ring_cap)
            .finish_non_exhaustive()
    }
}

/// The fan-out hub.
pub struct Hub {
    handshakes: governor::DefaultKeyedRateLimiter<IpAddr>,
    tx: broadcast::Sender<Frame>,
    ring: Mutex<VecDeque<Frame>>,
    ring_cap: usize,
    conns: AtomicUsize,
    per_ip: Mutex<HashMap<IpAddr, u32>>,
    next_id: AtomicU64,
    shutdown: watch::Sender<bool>,
    mempool: Mutex<MempoolMemo>,
    cfg: WsConfig,
    pub stats: HubStats,
}

/// Registration of one connection; releases its slot on drop.
#[derive(Debug)]
pub struct ConnGuard {
    pub id: u64,
    pub ip: IpAddr,
    hub: Arc<Hub>,
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.hub.conns.fetch_sub(1, Ordering::AcqRel);
        let mut m = self
            .hub
            .per_ip
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(c) = m.get_mut(&self.ip) {
            *c = c.saturating_sub(1);
            if *c == 0 {
                m.remove(&self.ip);
            }
        }
    }
}

impl Hub {
    /// Creates the hub and spawns its pump task on the current runtime.
    pub fn start(engine: &EngineHandle, cfg: WsConfig, ring_cap: usize) -> Arc<Self> {
        let (tx, _) = broadcast::channel(cfg.queue.max(2));
        let (shutdown, _) = watch::channel(false);
        let quota = governor::Quota::per_second(
            std::num::NonZeroU32::new(HANDSHAKES_PER_SECOND).unwrap_or(std::num::NonZeroU32::MIN),
        )
        .allow_burst(
            std::num::NonZeroU32::new(HANDSHAKE_BURST).unwrap_or(std::num::NonZeroU32::MIN),
        );
        let hub = Arc::new(Self {
            handshakes: governor::RateLimiter::keyed(quota),
            tx,
            ring: Mutex::new(VecDeque::with_capacity(ring_cap.min(8192))),
            ring_cap: ring_cap.max(16),
            conns: AtomicUsize::new(0),
            per_ip: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            shutdown,
            mempool: Mutex::new(MempoolMemo::default()),
            cfg,
            stats: HubStats::default(),
        });
        // Subscribe before spawning so nothing emitted after `start` returns is missed.
        let rx = engine.subscribe();
        tokio::spawn(pump(Arc::downgrade(&hub), engine.clone(), rx));
        hub
    }

    pub fn config(&self) -> &WsConfig {
        &self.cfg
    }

    /// Charges a WebSocket handshake to the client `ip`; the seconds to wait when over.
    pub fn admit_handshake(&self, ip: IpAddr) -> Result<(), u64> {
        use governor::clock::{Clock as _, DefaultClock};
        self.handshakes
            .check_key(&crate::net::trust::client_key(ip))
            .map_err(|not_until| {
                self.stats
                    .handshakes_limited
                    .fetch_add(1, Ordering::Relaxed);
                not_until
                    .wait_time_from(DefaultClock::default().now())
                    .as_secs_f64()
                    .ceil()
                    .max(1.0) as u64
            })
    }

    /// Forgets idle handshake buckets (call periodically).
    pub fn prune(&self) {
        self.handshakes.retain_recent();
        self.handshakes.shrink_to_fit();
    }

    /// A receiver of future frames (the connection's bounded queue).
    pub fn subscribe(&self) -> broadcast::Receiver<Frame> {
        self.tx.subscribe()
    }

    /// Frames held by the replay ring, and its capacity.
    pub fn ring_len_cap(&self) -> (usize, usize) {
        let len = self
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len();
        (len, self.ring_cap)
    }

    pub fn connections(&self) -> usize {
        self.conns.load(Ordering::Acquire)
    }

    /// Connections currently subscribed to the live stream.
    pub fn subscribers(&self) -> usize {
        self.tx.receiver_count()
    }

    pub fn shutdown_rx(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }

    pub fn is_shutting_down(&self) -> bool {
        *self.shutdown.borrow()
    }

    /// Tells every connection to close (1001) and refuses new ones.
    pub fn begin_shutdown(&self) {
        self.shutdown.send_replace(true);
    }

    /// Reserves a connection slot for the client `ip` (keyed by
    /// [`crate::net::trust::client_key`]: IPv6 by /64).
    pub fn try_register(self: &Arc<Self>, ip: IpAddr) -> Result<ConnGuard, Reject> {
        let ip = crate::net::trust::client_key(ip);
        if self.is_shutting_down() {
            return Err(Reject::ShuttingDown);
        }
        let prev = self.conns.fetch_add(1, Ordering::AcqRel);
        if prev >= self.cfg.max_connections {
            self.conns.fetch_sub(1, Ordering::AcqRel);
            self.stats.rejected_total.fetch_add(1, Ordering::Relaxed);
            return Err(Reject::ServerFull);
        }
        {
            let mut m = self
                .per_ip
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let c = m.entry(ip).or_insert(0);
            if *c >= self.cfg.max_per_ip {
                drop(m);
                self.conns.fetch_sub(1, Ordering::AcqRel);
                self.stats.rejected_total.fetch_add(1, Ordering::Relaxed);
                return Err(Reject::TooManyFromIp);
            }
            *c += 1;
        }
        self.stats.connections_total.fetch_add(1, Ordering::Relaxed);
        Ok(ConnGuard {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            ip,
            hub: Arc::clone(self),
        })
    }

    /// The serialized frame of `msg`: from the ring when the pump already built it.
    pub fn frame_for(&self, msg: &LiveMsg) -> Frame {
        {
            let ring = self
                .ring
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let i = ring.partition_point(|f| f.seq < msg.seq);
            if let Some(f) = ring.get(i).filter(|f| f.seq == msg.seq) {
                return f.clone();
            }
        }
        Frame::from_msg(msg)
    }

    fn publish(&self, frame: Frame) {
        {
            let mut ring = self
                .ring
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // Keep the ring sorted even if a bypass frame repeats a seq.
            if ring.back().is_none_or(|b| b.seq < frame.seq) {
                ring.push_back(frame.clone());
                let mut bytes =
                    self.stats.ring_bytes.load(Ordering::Relaxed) as usize + frame.text.len();
                while ring.len() > 1
                    && (ring.len() > self.ring_cap
                        || bytes > atlas_engine::replay::REPLAY_MAX_BYTES)
                {
                    if let Some(old) = ring.pop_front() {
                        bytes -= old.text.len();
                    }
                }
                self.stats.ring_bytes.store(bytes as u64, Ordering::Relaxed);
            }
        }
        self.stats.frames_published.fetch_add(1, Ordering::Relaxed);
        // No receivers is fine.
        let _ = self.tx.send(frame);
    }

    fn remember_mempool(&self, txs: &[TxLite]) {
        let now = now_ms();
        let mut m = self
            .mempool
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for t in txs {
            if m.by_txid.insert(t.txid, (t.clone(), now)).is_none() {
                m.order.push_back(t.txid);
            }
        }
        while m.order.len() > MEMPOOL_MEMO_CAP {
            if let Some(old) = m.order.pop_front() {
                m.by_txid.remove(&old);
            }
        }
    }

    /// A mempool transaction seen on the live stream, with its first-seen time.
    pub fn mempool_tx(&self, txid: &Hash32) -> Option<(TxLite, u64)> {
        self.mempool
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .by_txid
            .get(txid)
            .cloned()
    }
}

async fn pump(
    hub: std::sync::Weak<Hub>,
    engine: EngineHandle,
    mut rx: broadcast::Receiver<Arc<LiveMsg>>,
) {
    loop {
        let res = rx.recv().await;
        let Some(hub) = hub.upgrade() else { break };
        match res {
            Ok(msg) => {
                if let LiveBody::Mempool { txs } = &msg.body {
                    hub.remember_mempool(txs);
                }
                hub.publish(Frame::from_msg(&msg));
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                // The hub itself fell behind the engine: every client has a gap.
                tracing::warn!(
                    missed = n,
                    "live hub lagged behind the engine; asking clients to resync"
                );
                hub.stats.hub_lagged.fetch_add(1, Ordering::Relaxed);
                let msg = LiveMsg::new(
                    engine.seq(),
                    now_ms(),
                    None,
                    LiveBody::Resync {
                        reason: "server_lagged".to_owned(),
                    },
                );
                let mut f = Frame::from_msg(&msg);
                f.bypass_dedupe = true;
                hub.publish(f);
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

//! WebSocket `/ws` (ARCHITECTURE section 8, schema in `atlas_core::live`).
//!
//! Per connection: `hello` on connect; `sub` sets the topic filter, then subscribes to the hub
//! *before* replaying from the engine ring (subscribe-then-replay) and drops live frames already
//! covered by the replay (dedupe by seq); `resync` when the ring cannot cover the gap (or the
//! client's seq is from before a restart). Protocol pings keep dead peers from lingering; a
//! client that falls a full queue behind, or whose socket stalls a write, is closed with 4008.
//!
//! `sub` is rate-limited per connection (a burst of [`SUB_BURST`], then one per
//! [`SUB_REFILL`]); a `sub` over the limit is deferred, not dropped: the latest one is applied
//! when the next token arrives. Only the first `sub` (or one that adds topics) replays from
//! `since_seq`: later ones keep the connection's receiver, so nothing is missed and nothing is
//! sent twice. A replay larger than [`REPLAY_MAX_BYTES`] is answered with a `resync` instead
//! (the snapshot bodies are cheaper than the ring), and handshakes are rate-limited per client
//! (X1 L1).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use atlas_core::NodeId;
use atlas_core::live::{ClientMsg, LiveBody, LiveMsg, Topic};
use atlas_core::now_ms;
use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::SinkExt as _;
use tokio::sync::broadcast;

use super::hub::{ConnGuard, Frame, Reject};
use crate::error::ApiError;
use crate::extract::ClientIp;
use crate::state::AppState;

/// Close codes.
pub mod close {
    /// Server shutting down.
    pub const GOING_AWAY: u16 = 1001;
    /// Malformed client traffic.
    pub const POLICY: u16 = 1008;
    /// Nothing received (not even a pong) within the idle timeout.
    pub const IDLE: u16 = 4000;
    /// The client could not keep up with the stream.
    pub const SLOW_CONSUMER: u16 = 4008;
}

/// Frames written per socket flush.
const WRITE_BATCH: usize = 64;
/// Malformed messages tolerated before closing.
const MAX_BAD_MESSAGES: u32 = 8;
/// `sub` messages a connection may send at once.
pub const SUB_BURST: u32 = 8;
/// One more `sub` token per this interval.
pub const SUB_REFILL: Duration = Duration::from_secs(2);
/// Largest replay a `sub` gets; beyond it the client is told to resync from the snapshots.
pub const REPLAY_MAX_BYTES: usize = 2 << 20;

/// `GET /ws`.
pub async fn ws_handler(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    upgrade: WebSocketUpgrade,
) -> Response {
    if let Err(wait) = state.hub.admit_handshake(ip) {
        return ApiError::rate_limited(wait)
            .with_message("too many live connections opened from this address")
            .into_response();
    }
    let guard = match state.hub.try_register(ip) {
        Ok(g) => g,
        Err(Reject::TooManyFromIp) => {
            return ApiError::rate_limited(5)
                .with_message("too many live connections from this address")
                .into_response();
        }
        Err(Reject::ServerFull) => {
            return ApiError::unavailable("live connection limit reached")
                .with_retry_after(10)
                .into_response();
        }
        Err(Reject::ShuttingDown) => {
            return ApiError::unavailable("server is shutting down")
                .with_retry_after(5)
                .into_response();
        }
    };
    let cfg = state.hub.config();
    let max = cfg.max_message_bytes;
    upgrade
        .read_buffer_size(cfg.read_buffer)
        .write_buffer_size(cfg.write_buffer)
        .max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| run(state, socket, guard))
}

impl ApiError {
    fn with_message(mut self, m: &str) -> Self {
        m.clone_into(&mut self.message);
        self
    }
}

enum Exit {
    /// Peer closed or the socket failed: nothing more to send.
    Gone,
    Close(u16, &'static str),
}

/// Token bucket of `sub` messages.
struct SubBucket {
    tokens: f64,
    at: Instant,
}

impl SubBucket {
    fn new() -> Self {
        Self {
            tokens: f64::from(SUB_BURST),
            at: Instant::now(),
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let gained = now.duration_since(self.at).as_secs_f64() / SUB_REFILL.as_secs_f64();
        self.tokens = (self.tokens + gained).min(f64::from(SUB_BURST));
        self.at = now;
    }

    /// Takes a token, or returns when the next one is due.
    fn take(&mut self) -> Result<(), Instant> {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            let wait = (1.0 - self.tokens) * SUB_REFILL.as_secs_f64();
            Err(self.at + Duration::from_secs_f64(wait))
        }
    }
}

struct Conn {
    id: u64,
    mask: u8,
    subs: SubBucket,
    /// A `sub` over the rate limit, applied when its token is due (the latest one wins).
    pending: Option<(Instant, ClientMsg)>,
    rx: Option<broadcast::Receiver<Frame>>,
    /// Live frames at or below this seq were already delivered by the replay.
    dedupe_upto: u64,
    watch_set: bool,
    last_rx: Instant,
    bad: u32,
    sent: u64,
    bytes: u64,
}

async fn pending_due(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at.into()).await,
        None => std::future::pending().await,
    }
}

async fn recv_frame(
    rx: &mut Option<broadcast::Receiver<Frame>>,
) -> Result<Frame, broadcast::error::RecvError> {
    match rx {
        Some(r) => r.recv().await,
        None => std::future::pending().await,
    }
}

fn resync_text(state: &AppState, reason: &str) -> Utf8Bytes {
    let msg = LiveMsg::new(
        state.engine.seq(),
        now_ms(),
        None,
        LiveBody::Resync {
            reason: reason.to_owned(),
        },
    );
    Utf8Bytes::from(msg.to_json())
}

/// Runs one connection until it ends.
pub async fn run(state: AppState, mut socket: WebSocket, guard: ConnGuard) {
    let cfg = state.hub.config().clone();
    let mut shutdown = state.hub.shutdown_rx();
    let mut conn = Conn {
        id: guard.id,
        mask: 0,
        subs: SubBucket::new(),
        pending: None,
        rx: None,
        dedupe_upto: 0,
        watch_set: false,
        last_rx: Instant::now(),
        bad: 0,
        sent: 0,
        bytes: 0,
    };
    let hello = Utf8Bytes::from(state.engine.hello().to_json());
    let exit = if *shutdown.borrow() {
        Exit::Close(close::GOING_AWAY, "server shutting down")
    } else if write(&mut socket, &cfg, &mut conn, vec![hello])
        .await
        .is_err()
    {
        Exit::Gone
    } else {
        let mut ping = tokio::time::interval(cfg.ping_interval);
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ping.tick().await;
        loop {
            tokio::select! {
                biased;
                _ = shutdown.changed() => break Exit::Close(close::GOING_AWAY, "server shutting down"),
                inbound = socket.recv() => {
                    let Some(Ok(msg)) = inbound else { break Exit::Gone };
                    conn.last_rx = Instant::now();
                    match msg {
                        Message::Text(t) => {
                            if let Err(e) = on_client_text(&state, &mut socket, &mut conn, t.as_str()).await {
                                break e;
                            }
                        }
                        Message::Binary(_) => {
                            conn.bad += 1;
                            if conn.bad > MAX_BAD_MESSAGES {
                                break Exit::Close(close::POLICY, "binary frames are not supported");
                            }
                        }
                        Message::Close(_) => break Exit::Gone,
                        Message::Ping(_) | Message::Pong(_) => {}
                    }
                }
                frame = recv_frame(&mut conn.rx) => match frame {
                    Ok(first) => {
                        if let Err(e) = forward(&state, &mut socket, &mut conn, first).await {
                            break e;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        state.hub.stats.messages_dropped.fetch_add(n, Ordering::Relaxed);
                        break slow(&state);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break Exit::Close(close::GOING_AWAY, "server shutting down");
                    }
                },
                () = pending_due(conn.pending.as_ref().map(|p| p.0)) => {
                    if let Some((_, msg)) = conn.pending.take() {
                        let _ = conn.subs.take();
                        state.hub.stats.subs_deferred.fetch_add(1, Ordering::Relaxed);
                        if let Err(e) = apply_sub(&state, &mut socket, &mut conn, msg).await {
                            break e;
                        }
                    }
                }
                _ = ping.tick() => {
                    if conn.last_rx.elapsed() > cfg.idle_timeout {
                        state.hub.stats.idle_disconnects.fetch_add(1, Ordering::Relaxed);
                        break Exit::Close(close::IDLE, "idle timeout");
                    }
                    let sent = tokio::time::timeout(cfg.write_timeout, socket.send(Message::Ping(Bytes::new()))).await;
                    if !matches!(sent, Ok(Ok(()))) {
                        break slow(&state);
                    }
                    flush_stats(&state, &mut conn);
                }
            }
        }
    };
    if let Exit::Close(code, reason) = exit {
        let frame = CloseFrame {
            code,
            reason: Utf8Bytes::from_static(reason),
        };
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            socket.send(Message::Close(Some(frame))),
        )
        .await;
    }
    if conn.watch_set {
        state.hooks.clear_watch(conn.id);
    }
    flush_stats(&state, &mut conn);
    drop(guard);
}

fn slow(state: &AppState) -> Exit {
    state
        .hub
        .stats
        .slow_consumer_disconnects
        .fetch_add(1, Ordering::Relaxed);
    Exit::Close(close::SLOW_CONSUMER, "slow consumer")
}

fn flush_stats(state: &AppState, conn: &mut Conn) {
    if conn.sent > 0 {
        state
            .hub
            .stats
            .messages_sent
            .fetch_add(conn.sent, Ordering::Relaxed);
        state
            .hub
            .stats
            .bytes_sent
            .fetch_add(conn.bytes, Ordering::Relaxed);
        conn.sent = 0;
        conn.bytes = 0;
    }
}

/// Writes a batch of text frames under one write deadline, flushing once.
async fn write(
    socket: &mut WebSocket,
    cfg: &crate::config::WsConfig,
    conn: &mut Conn,
    texts: Vec<Utf8Bytes>,
) -> Result<(), ()> {
    if texts.is_empty() {
        return Ok(());
    }
    let n = texts.len() as u64;
    let bytes: u64 = texts.iter().map(|t| t.len() as u64).sum();
    let fut = async {
        for t in texts {
            socket.feed(Message::Text(t)).await?;
        }
        socket.flush().await
    };
    match tokio::time::timeout(cfg.write_timeout, fut).await {
        Ok(Ok(())) => {
            conn.sent += n;
            conn.bytes += bytes;
            Ok(())
        }
        _ => Err(()),
    }
}

/// Forwards `first` plus whatever else is already queued (up to a batch), filtered by topic and
/// deduped against the replay.
async fn forward(
    state: &AppState,
    socket: &mut WebSocket,
    conn: &mut Conn,
    first: Frame,
) -> Result<(), Exit> {
    let (mask, dedupe_upto) = (conn.mask, conn.dedupe_upto);
    let keep = |f: &Frame| (f.bypass_dedupe || f.seq > dedupe_upto) && f.wanted(mask);
    let mut batch = Vec::with_capacity(8);
    if keep(&first) {
        batch.push(first.text);
    }
    if let Some(rx) = conn.rx.as_mut() {
        while batch.len() < WRITE_BATCH {
            match rx.try_recv() {
                Ok(f) => {
                    if keep(&f) {
                        batch.push(f.text);
                    }
                }
                Err(broadcast::error::TryRecvError::Lagged(n)) => {
                    state
                        .hub
                        .stats
                        .messages_dropped
                        .fetch_add(n, Ordering::Relaxed);
                    return Err(slow(state));
                }
                Err(_) => break,
            }
        }
    }
    let cfg = state.hub.config().clone();
    if write(socket, &cfg, conn, batch).await.is_err() {
        return Err(slow(state));
    }
    if conn.sent >= 256 {
        flush_stats(state, conn);
    }
    Ok(())
}

fn topics_mask(topics: &[Topic]) -> u8 {
    topics.iter().fold(0u8, |m, t| m | t.bit())
}

/// App name charset, without the dot segments `.` and `..` (X1 I2).
fn valid_app_name(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s != "."
        && s != ".."
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}

/// Keeps the first occurrence of each entry, in the client's order (its selection first: the
/// engine counts a connection's first entries as its votes).
fn dedup_ordered<T: PartialEq>(v: impl IntoIterator<Item = T>, max: usize) -> Vec<T> {
    let mut out: Vec<T> = Vec::new();
    for x in v {
        if out.len() >= max {
            break;
        }
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

/// The watched nodes that exist, deduplicated in order, at most `max`.
fn known_nodes(state: &AppState, watch: Vec<NodeId>, max: usize) -> Vec<NodeId> {
    if watch.is_empty() {
        return watch;
    }
    let views = state.views();
    dedup_ordered(
        watch
            .into_iter()
            .take(max * 4)
            .filter(|id| views.node(*id).is_some()),
        max,
    )
}

/// The watched apps that exist in the published app catalog (case-insensitive), as catalog
/// keys, deduplicated in order, at most `max`. Unknown names are ignored (X1 M6).
fn catalog_apps(state: &AppState, watch: &[String], max: usize) -> Vec<String> {
    if watch.is_empty() {
        return Vec::new();
    }
    let p = state.engine.published();
    dedup_ordered(
        watch
            .iter()
            .take(max * 4)
            .filter(|a| valid_app_name(a))
            .filter_map(|a| p.apps.iter().find(|e| e.name.eq_ignore_ascii_case(a)))
            .map(|e| e.name.clone()),
        max,
    )
}

async fn on_client_text(
    state: &AppState,
    socket: &mut WebSocket,
    conn: &mut Conn,
    text: &str,
) -> Result<(), Exit> {
    let Ok(msg) = serde_json::from_str::<ClientMsg>(text) else {
        conn.bad += 1;
        if conn.bad > MAX_BAD_MESSAGES {
            return Err(Exit::Close(close::POLICY, "malformed messages"));
        }
        return Ok(());
    };
    if !matches!(msg, ClientMsg::Sub { .. }) {
        // Pong: liveness already recorded.
        return Ok(());
    }
    match conn.subs.take() {
        Ok(()) => {
            conn.pending = None;
            apply_sub(state, socket, conn, msg).await
        }
        Err(due) => {
            // Over the limit: keep the latest and apply it when a token is due.
            state.hub.stats.subs_limited.fetch_add(1, Ordering::Relaxed);
            conn.pending = Some((due, msg));
            Ok(())
        }
    }
}

/// Applies a `sub`: topic filter, replay (first `sub`, or new topics), watch lists.
async fn apply_sub(
    state: &AppState,
    socket: &mut WebSocket,
    conn: &mut Conn,
    msg: ClientMsg,
) -> Result<(), Exit> {
    let ClientMsg::Sub {
        topics,
        since_seq,
        watch,
        watch_apps,
    } = msg
    else {
        return Ok(());
    };
    let cfg = state.hub.config().clone();
    let mask = topics_mask(&topics);
    // A later `sub` that keeps the topics keeps the receiver: every frame since the first one
    // is either delivered or queued, so there is nothing to replay.
    let replay = conn.rx.is_none() || mask & !conn.mask != 0;
    conn.mask = mask;
    let mut out: Vec<Utf8Bytes> = Vec::new();
    let current = state.engine.seq();
    if replay {
        // Subscribe first, then replay: anything emitted in between arrives on the new
        // receiver and is dropped by seq if the replay already covered it.
        conn.rx = Some(state.hub.subscribe());
        conn.dedupe_upto = 0;
    }
    match since_seq {
        None => {}
        Some(s) if s > current => {
            // The client's seq is from before a restart: its state cannot be patched.
            state.hub.stats.resyncs.fetch_add(1, Ordering::Relaxed);
            out.push(resync_text(state, "unknown_seq"));
        }
        // A later `sub` keeps its receiver: nothing to replay.
        Some(_) if !replay => {}
        Some(s) => {
            if let Ok(msgs) = state.engine.replay_since(s) {
                let mut bytes = 0usize;
                for m in &msgs {
                    let f = state.hub.frame_for(m);
                    if !f.is_ping && f.wanted(conn.mask) {
                        bytes += f.text.len();
                        if bytes > REPLAY_MAX_BYTES {
                            break;
                        }
                        out.push(f.text);
                    }
                }
                if bytes > REPLAY_MAX_BYTES {
                    // Cheaper to refetch the snapshots than to stream this much history.
                    out.clear();
                    state.hub.stats.resyncs.fetch_add(1, Ordering::Relaxed);
                    out.push(resync_text(state, "replay_too_large"));
                } else {
                    conn.dedupe_upto = msgs.last().map_or(s, |m| m.seq.max(s));
                    state
                        .hub
                        .stats
                        .replayed
                        .fetch_add(out.len() as u64, Ordering::Relaxed);
                }
            } else {
                state.hub.stats.resyncs.fetch_add(1, Ordering::Relaxed);
                out.push(resync_text(state, "replay_gap"));
            }
        }
    }
    let nodes = known_nodes(state, watch.unwrap_or_default(), cfg.max_watch_nodes);
    let apps = catalog_apps(
        state,
        watch_apps.as_deref().unwrap_or_default(),
        cfg.max_watch_apps,
    );
    if !nodes.is_empty() || !apps.is_empty() {
        state.hooks.set_watch(conn.id, nodes, apps);
        conn.watch_set = true;
    } else if conn.watch_set {
        state.hooks.clear_watch(conn.id);
        conn.watch_set = false;
    }
    for chunk in out.chunks(WRITE_BATCH) {
        if write(socket, &cfg, conn, chunk.to_vec()).await.is_err() {
            return Err(slow(state));
        }
    }
    Ok(())
}

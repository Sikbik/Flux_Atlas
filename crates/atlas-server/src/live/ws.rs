//! WebSocket `/ws` (ARCHITECTURE section 8, schema in `atlas_core::live`).
//!
//! Per connection: `hello` on connect; `sub` sets the topic filter, then subscribes to the hub
//! *before* replaying from the engine ring (subscribe-then-replay) and drops live frames already
//! covered by the replay (dedupe by seq); `resync` when the ring cannot cover the gap (or the
//! client's seq is from before a restart). Protocol pings keep dead peers from lingering; a
//! client that falls a full queue behind, or whose socket stalls a write, is closed with 4008.

use std::sync::atomic::Ordering;
use std::time::Instant;

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

/// `GET /ws`.
pub async fn ws_handler(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    upgrade: WebSocketUpgrade,
) -> Response {
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
    let max = state.hub.config().max_message_bytes;
    upgrade
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

struct Conn {
    id: u64,
    mask: u8,
    rx: Option<broadcast::Receiver<Frame>>,
    /// Live frames at or below this seq were already delivered by the replay.
    dedupe_upto: u64,
    watch_set: bool,
    last_rx: Instant,
    bad: u32,
    sent: u64,
    bytes: u64,
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

fn valid_app_name(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
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
    let ClientMsg::Sub {
        topics,
        since_seq,
        watch,
        watch_apps,
    } = msg
    else {
        // Pong: liveness already recorded.
        return Ok(());
    };
    let cfg = state.hub.config().clone();
    conn.mask = topics_mask(&topics);
    // Subscribe first, then replay: anything emitted in between arrives on the new receiver
    // and is dropped by seq if the replay already covered it.
    conn.rx = Some(state.hub.subscribe());
    conn.dedupe_upto = 0;
    let current = state.engine.seq();
    let mut out: Vec<Utf8Bytes> = Vec::new();
    match since_seq {
        None => {}
        Some(s) if s > current => {
            // The client's seq is from before a restart: its state cannot be patched.
            state.hub.stats.resyncs.fetch_add(1, Ordering::Relaxed);
            out.push(resync_text(state, "unknown_seq"));
        }
        Some(s) => {
            if let Ok(msgs) = state.engine.replay_since(s) {
                conn.dedupe_upto = msgs.last().map_or(s, |m| m.seq.max(s));
                for m in &msgs {
                    let f = state.hub.frame_for(m);
                    if !f.is_ping && f.wanted(conn.mask) {
                        out.push(f.text);
                    }
                }
                state
                    .hub
                    .stats
                    .replayed
                    .fetch_add(out.len() as u64, Ordering::Relaxed);
            } else {
                state.hub.stats.resyncs.fetch_add(1, Ordering::Relaxed);
                out.push(resync_text(state, "replay_gap"));
            }
        }
    }
    let mut nodes: Vec<NodeId> = watch.unwrap_or_default();
    nodes.sort_unstable();
    nodes.dedup();
    nodes.truncate(cfg.max_watch_nodes);
    let mut apps: Vec<String> = watch_apps
        .unwrap_or_default()
        .into_iter()
        .filter(|a| valid_app_name(a))
        .map(|a| a.to_ascii_lowercase())
        .collect();
    apps.sort_unstable();
    apps.dedup();
    apps.truncate(cfg.max_watch_apps);
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

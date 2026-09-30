//! One reconnecting Insight socket.io client.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior, sleep, sleep_until, timeout};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use super::config::{SocketConfig, endpoint_label};
use super::frame::{ChainPush, Frame, parse_frame};
use super::health::{Backoff, HealthTracker, SocketHealth, Unhealthy};

/// One push from one socket.
#[derive(Debug, Clone, PartialEq)]
pub struct SocketEvent {
    /// Endpoint label, e.g. `explorer.runonflux.io`.
    pub source: Arc<str>,
    /// Wall-clock ms when the frame was read.
    pub received_ms: u64,
    /// The decoded push.
    pub push: ChainPush,
}

/// Connection lifecycle of one socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnState {
    /// A connection attempt is starting (`attempt` counts from 1 since the last healthy
    /// session).
    Connecting {
        /// Attempt number.
        attempt: u32,
    },
    /// The socket.io session is open and the room subscription was sent.
    Connected {
        /// Engine.IO session id.
        sid: String,
    },
    /// The session ended (or never started); the next attempt is in `retry_in`.
    Disconnected {
        /// Human-readable cause.
        reason: String,
        /// Delay before the next attempt.
        retry_in: Duration,
    },
    /// The client stopped because it was shut down or dropped.
    Stopped,
}

/// A connection state change of one socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateChange {
    /// Endpoint label.
    pub source: Arc<str>,
    /// Wall-clock ms of the change.
    pub at_ms: u64,
    /// New state.
    pub state: ConnState,
}

/// Everything a socket (or [`super::DualSocket`]) emits, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum SocketMessage {
    /// A chain push.
    Event(SocketEvent),
    /// A connection state change.
    State(StateChange),
}

/// Handle to a background task that keeps one Insight socket connected forever, with
/// jittered exponential backoff between attempts.
///
/// The socket is closed (with a websocket close frame) when [`InsightSocket::shutdown`] is
/// called or the handle is dropped. It also stops when the output receiver is dropped.
#[derive(Debug)]
pub struct InsightSocket {
    source: Arc<str>,
    health: watch::Receiver<SocketHealth>,
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl InsightSocket {
    /// Spawns a client for `url` on the current tokio runtime. Only `url`-independent fields
    /// of `config` are used (`config.urls` is ignored).
    pub fn spawn(url: &str, config: &SocketConfig) -> (Self, mpsc::Receiver<SocketMessage>) {
        let (tx, rx) = mpsc::channel(config.channel_capacity.max(1));
        let source: Arc<str> = endpoint_label(url).into();
        (Self::spawn_with(url, source, config, tx), rx)
    }

    /// Spawns a client that writes into an existing channel under the given label.
    pub(super) fn spawn_with(
        url: &str,
        source: Arc<str>,
        config: &SocketConfig,
        tx: mpsc::Sender<SocketMessage>,
    ) -> Self {
        let (stop, stop_rx) = watch::channel(false);
        let (health_tx, health) = watch::channel(SocketHealth::default());
        let worker = Worker {
            url: url.to_owned(),
            source: source.clone(),
            cfg: config.clone(),
            tx,
            stop: stop_rx,
            health_tx,
            tracker: HealthTracker::default(),
            backoff: Backoff::new(config.backoff_min, config.backoff_max),
        };
        let task = tokio::spawn(worker.run());
        Self {
            source,
            health,
            stop,
            task,
        }
    }

    /// Endpoint label, e.g. `explorer.runonflux.io`.
    pub fn source(&self) -> &Arc<str> {
        &self.source
    }

    /// Health updates for this socket.
    pub fn health(&self) -> watch::Receiver<SocketHealth> {
        self.health.clone()
    }

    /// Stops the client, closes the websocket and waits for the task to finish.
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        let _ = self.task.await;
    }
}

/// Resolves once a stop is requested or the handle (the sender) is gone.
async fn stopped(stop: &mut watch::Receiver<bool>) {
    loop {
        if *stop.borrow_and_update() {
            return;
        }
        if stop.changed().await.is_err() {
            return;
        }
    }
}

/// Why a session ended.
enum SessionEnd {
    Stopped,
    ConsumerGone,
    Failed { reason: String, kind: Unhealthy },
}

impl SessionEnd {
    fn failed(reason: impl Into<String>) -> Self {
        Self::Failed {
            reason: reason.into(),
            kind: Unhealthy::NotConnected,
        }
    }
}

struct Worker {
    url: String,
    source: Arc<str>,
    cfg: SocketConfig,
    tx: mpsc::Sender<SocketMessage>,
    stop: watch::Receiver<bool>,
    health_tx: watch::Sender<SocketHealth>,
    tracker: HealthTracker,
    backoff: Backoff,
}

/// Sends `msg` unless a stop is requested first. `Err` means the task should end.
async fn emit(
    tx: &mpsc::Sender<SocketMessage>,
    stop: &mut watch::Receiver<bool>,
    msg: SocketMessage,
) -> Result<(), SessionEnd> {
    tokio::select! {
        biased;
        () = stopped(stop) => Err(SessionEnd::Stopped),
        r = tx.send(msg) => r.map_err(|_| SessionEnd::ConsumerGone),
    }
}

impl Worker {
    async fn run(mut self) {
        let mut attempt: u32 = 0;
        loop {
            attempt = attempt.saturating_add(1);
            if self.state(ConnState::Connecting { attempt }).await.is_err() {
                break;
            }
            let (end, connected_ms) = self.session().await;
            let (reason, kind) = match end {
                SessionEnd::Stopped | SessionEnd::ConsumerGone => break,
                SessionEnd::Failed { reason, kind } => (reason, kind),
            };
            self.tracker.on_disconnected(kind);
            self.publish_health();
            if connected_ms
                .is_some_and(|ms| u128::from(ms) >= self.cfg.backoff_reset_after.as_millis())
            {
                self.backoff.reset();
                attempt = 0;
            }
            let retry_in = self.backoff.next_delay();
            tracing::info!(source = %self.source, %reason, ?retry_in, "insight socket disconnected");
            if self
                .state(ConnState::Disconnected { reason, retry_in })
                .await
                .is_err()
            {
                break;
            }
            tokio::select! {
                biased;
                () = stopped(&mut self.stop) => break,
                () = sleep(retry_in) => {}
            }
        }
        self.tracker.on_disconnected(Unhealthy::NotConnected);
        self.publish_health();
        // Best effort; the consumer may be gone already.
        let _ = self.tx.try_send(SocketMessage::State(StateChange {
            source: self.source.clone(),
            at_ms: atlas_core::now_ms(),
            state: ConnState::Stopped,
        }));
        tracing::debug!(source = %self.source, "insight socket stopped");
    }

    async fn state(&mut self, state: ConnState) -> Result<(), SessionEnd> {
        let msg = SocketMessage::State(StateChange {
            source: self.source.clone(),
            at_ms: atlas_core::now_ms(),
            state,
        });
        emit(&self.tx, &mut self.stop, msg).await
    }

    fn publish_health(&self) {
        let snap = self
            .tracker
            .snapshot(atlas_core::now_ms(), self.cfg.block_stale_after);
        self.health_tx.send_if_modified(|h| {
            if *h == snap {
                false
            } else {
                *h = snap;
                true
            }
        });
    }

    /// Runs one connection until it ends. Returns how long it stayed connected (ms), if it
    /// got that far.
    async fn session(&mut self) -> (SessionEnd, Option<u64>) {
        let mut request = match self.url.as_str().into_client_request() {
            Ok(r) => r,
            Err(e) => return (SessionEnd::failed(format!("bad url: {e}")), None),
        };
        if let Ok(ua) = HeaderValue::from_str(&self.cfg.user_agent) {
            request.headers_mut().insert("User-Agent", ua);
        }
        let connect = timeout(
            self.cfg.connect_timeout,
            tokio_tungstenite::connect_async(request),
        );
        let ws = tokio::select! {
            biased;
            () = stopped(&mut self.stop) => return (SessionEnd::Stopped, None),
            r = connect => match r {
                Ok(Ok((ws, _resp))) => ws,
                Ok(Err(e)) => return (SessionEnd::failed(format!("connect failed: {e}")), None),
                Err(_) => return (SessionEnd::failed("connect timeout"), None),
            },
        };
        let (mut sink, mut stream) = ws.split();

        let mut ping_interval = self.cfg.fallback_ping_interval;
        let mut ping_timeout = self.cfg.fallback_ping_timeout;
        let mut sid = String::new();
        let handshake_deadline = Instant::now() + self.cfg.handshake_timeout;
        let mut next_ping: Option<Instant> = None;
        let mut pong_deadline: Option<Instant> = None;
        let mut connected_at: Option<u64> = None;
        let mut tick =
            tokio::time::interval(self.cfg.health_check_every.max(Duration::from_millis(10)));
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let far = Instant::now() + Duration::from_secs(86_400 * 365);

        let end = loop {
            tokio::select! {
                biased;
                () = stopped(&mut self.stop) => break SessionEnd::Stopped,
                () = sleep_until(pong_deadline.unwrap_or(far)), if pong_deadline.is_some() => {
                    break SessionEnd::Failed {
                        reason: format!("ping timeout ({} ms)", ping_timeout.as_millis()),
                        kind: Unhealthy::PingTimeout,
                    };
                }
                () = sleep_until(handshake_deadline), if connected_at.is_none() => {
                    break SessionEnd::failed("socket.io handshake timeout");
                }
                () = sleep_until(next_ping.unwrap_or(far)), if next_ping.is_some() => {
                    if let Err(e) = sink.send(Message::text("2")).await {
                        break SessionEnd::failed(format!("ping send failed: {e}"));
                    }
                    let now = Instant::now();
                    if pong_deadline.is_none() {
                        pong_deadline = Some(now + ping_timeout);
                    }
                    next_ping = Some(now + ping_interval);
                }
                _ = tick.tick() => {
                    let now_ms = atlas_core::now_ms();
                    if self.cfg.reconnect_on_stale
                        && self.tracker.stale_for_reconnect(now_ms, self.cfg.block_stale_after)
                    {
                        break SessionEnd::Failed {
                            reason: format!(
                                "no block for {} s",
                                self.cfg.block_stale_after.as_secs()
                            ),
                            kind: Unhealthy::BlockStale,
                        };
                    }
                    self.publish_health();
                }
                msg = stream.next() => {
                    let text = match msg {
                        None => break SessionEnd::failed("websocket stream ended"),
                        Some(Err(e)) => break SessionEnd::failed(format!("websocket error: {e}")),
                        Some(Ok(Message::Text(t))) => t,
                        Some(Ok(Message::Close(frame))) => {
                            break SessionEnd::failed(format!(
                                "server closed websocket{}",
                                frame.map(|f| format!(" ({} {})", f.code, f.reason)).unwrap_or_default()
                            ));
                        }
                        // Websocket-level ping/pong is answered by tungstenite; binary is unused.
                        Some(Ok(_)) => continue,
                    };
                    let received_ms = atlas_core::now_ms();
                    self.tracker.on_frame(received_ms);
                    let frame = match parse_frame(text.as_str()) {
                        Ok(f) => f,
                        Err(e) => {
                            tracing::warn!(source = %self.source, error = %e, "unparsed insight frame");
                            continue;
                        }
                    };
                    match frame {
                        Frame::Open(open) => {
                            ping_interval = Duration::from_millis(open.ping_interval_ms.max(100));
                            ping_timeout = Duration::from_millis(open.ping_timeout_ms.max(100));
                            sid = open.sid;
                            next_ping = Some(Instant::now() + ping_interval);
                        }
                        Frame::Connect => {
                            if connected_at.is_some() {
                                continue;
                            }
                            let sub = format!(
                                "42[\"subscribe\",{}]",
                                serde_json::Value::String(self.cfg.room.clone())
                            );
                            if let Err(e) = sink.send(Message::text(sub)).await {
                                break SessionEnd::failed(format!("subscribe send failed: {e}"));
                            }
                            connected_at = Some(received_ms);
                            self.tracker.on_connected(received_ms);
                            self.publish_health();
                            tracing::info!(source = %self.source, %sid, "insight socket connected");
                            if let Err(end) = self.state(ConnState::Connected { sid: sid.clone() }).await {
                                break end;
                            }
                        }
                        Frame::Ping => {
                            if let Err(e) = sink.send(Message::text("3")).await {
                                break SessionEnd::failed(format!("pong send failed: {e}"));
                            }
                        }
                        Frame::Pong => pong_deadline = None,
                        Frame::Close => break SessionEnd::failed("engine.io close packet"),
                        Frame::Disconnect => break SessionEnd::failed("socket.io disconnect packet"),
                        Frame::Error(e) => break SessionEnd::failed(format!("socket.io error {e}")),
                        Frame::Upgrade | Frame::Noop | Frame::Ignored(_) => {}
                        Frame::Event(push) => {
                            if matches!(push, ChainPush::Block { .. }) {
                                self.tracker.on_block(received_ms);
                                self.publish_health();
                            }
                            let msg = SocketMessage::Event(SocketEvent {
                                source: self.source.clone(),
                                received_ms,
                                push,
                            });
                            if let Err(end) = emit(&self.tx, &mut self.stop, msg).await {
                                break end;
                            }
                        }
                    }
                }
            }
        };

        // Close politely; never wait long for a dead peer.
        let _ = timeout(Duration::from_secs(1), async {
            let _ = sink.send(Message::Close(None)).await;
            let _ = sink.close().await;
        })
        .await;
        let connected_for = connected_at.map(|t| atlas_core::now_ms().saturating_sub(t));
        (end, connected_for)
    }
}

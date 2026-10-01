//! Client and DualSocket tests against a local fake Engine.IO 3 server (no internet).
#![allow(clippy::unwrap_used)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

use super::*;

const H1: &str = "d8fb2d7487bd778a30190c34a3ca315d93f396240f3406680aed87e74a87bf49";
const T1: &str = "7f3a830ca7142faf2beae2307ae64822ea2fdf1a9dc7362931b4f7ecec9b2be7";
const T2: &str = "1d406531c8053eb4be407e711fcd414565c63e12390d9cdaf026ae59018c9f6f";

#[derive(Debug, Clone, PartialEq, Eq)]
enum Log {
    Accepted(usize),
    Received(usize, String),
    Closed { conn: usize, close_frame: bool },
}

#[derive(Clone)]
struct Script {
    ping_interval_ms: u64,
    ping_timeout_ms: u64,
    answer_pings: bool,
    /// Frames sent right after the subscribe arrives.
    on_subscribe: Vec<String>,
}

impl Default for Script {
    fn default() -> Self {
        Self {
            ping_interval_ms: 25_000,
            ping_timeout_ms: 20_000,
            answer_pings: true,
            on_subscribe: vec![],
        }
    }
}

struct FakeServer {
    url: String,
    log: mpsc::UnboundedReceiver<Log>,
    push: broadcast::Sender<String>,
    accepted: Arc<AtomicUsize>,
}

impl FakeServer {
    async fn start(script: Script) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (log_tx, log) = mpsc::unbounded_channel();
        let (push, _) = broadcast::channel(64);
        let accepted = Arc::new(AtomicUsize::new(0));
        let push2 = push.clone();
        let acc2 = accepted.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let conn = acc2.fetch_add(1, Ordering::SeqCst) + 1;
                let log_tx = log_tx.clone();
                let script = script.clone();
                let mut push_rx = push2.subscribe();
                tokio::spawn(async move {
                    let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
                        return;
                    };
                    let _ = log_tx.send(Log::Accepted(conn));
                    let open = format!(
                        r#"0{{"sid":"sid{conn}","upgrades":[],"pingInterval":{},"pingTimeout":{}}}"#,
                        script.ping_interval_ms, script.ping_timeout_ms
                    );
                    ws.send(Message::text(open)).await.unwrap();
                    ws.send(Message::text("40")).await.unwrap();
                    loop {
                        tokio::select! {
                            msg = ws.next() => match msg {
                                Some(Ok(Message::Text(t))) => {
                                    let t = t.as_str().to_owned();
                                    let _ = log_tx.send(Log::Received(conn, t.clone()));
                                    if t == "2" && script.answer_pings {
                                        let _ = ws.send(Message::text("3")).await;
                                    }
                                    if t.starts_with(r#"42["subscribe""#) {
                                        for f in &script.on_subscribe {
                                            let _ = ws.send(Message::text(f.clone())).await;
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) => {
                                    let _ = log_tx.send(Log::Closed { conn, close_frame: true });
                                    return;
                                }
                                Some(Ok(_)) => {}
                                None | Some(Err(_)) => {
                                    let _ = log_tx.send(Log::Closed { conn, close_frame: false });
                                    return;
                                }
                            },
                            f = push_rx.recv() => match f {
                                Ok(f) => { let _ = ws.send(Message::text(f)).await; }
                                Err(_) => return,
                            },
                        }
                    }
                });
            }
        });
        Self {
            url: format!("ws://{addr}/socket.io/?EIO=3&transport=websocket"),
            log,
            push,
            accepted,
        }
    }

    async fn wait_for(&mut self, pred: impl Fn(&Log) -> bool) -> Log {
        timeout(Duration::from_secs(5), async {
            loop {
                let l = self.log.recv().await.unwrap();
                if pred(&l) {
                    return l;
                }
            }
        })
        .await
        .expect("server log entry")
    }
}

fn fast_config() -> SocketConfig {
    SocketConfig {
        backoff_min: Duration::from_millis(20),
        backoff_max: Duration::from_millis(100),
        health_check_every: Duration::from_millis(20),
        connect_timeout: Duration::from_secs(2),
        handshake_timeout: Duration::from_secs(2),
        ..SocketConfig::default()
    }
}

async fn next(rx: &mut mpsc::Receiver<SocketMessage>) -> SocketMessage {
    timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("message in time")
        .expect("channel open")
}

async fn next_event(rx: &mut mpsc::Receiver<SocketMessage>) -> SocketEvent {
    loop {
        if let SocketMessage::Event(e) = next(rx).await {
            return e;
        }
    }
}

async fn next_state(rx: &mut mpsc::Receiver<SocketMessage>) -> ConnState {
    loop {
        if let SocketMessage::State(s) = next(rx).await {
            return s.state;
        }
    }
}

async fn wait_health(
    rx: &mut tokio::sync::watch::Receiver<SocketHealth>,
    pred: impl Fn(&SocketHealth) -> bool,
) -> SocketHealth {
    timeout(Duration::from_secs(5), async {
        loop {
            {
                let h = rx.borrow_and_update();
                if pred(&h) {
                    return h.clone();
                }
            }
            rx.changed().await.unwrap();
        }
    })
    .await
    .expect("health condition in time")
}

fn block_frame(h: &str) -> String {
    format!(r#"42["block","{h}"]"#)
}

fn tx_frame(t: &str) -> String {
    format!(r#"42["tx",{{"txid":"{t}","valueOut":0,"vout":[],"isRBF":false}}]"#)
}

#[tokio::test]
async fn events_flow_and_drop_closes_socket() {
    let mut server = FakeServer::start(Script {
        on_subscribe: vec![
            "6".to_owned(),
            "42[\"weird\",{}]".to_owned(),
            "not a frame".to_owned(),
            block_frame(H1),
            tx_frame(T1),
        ],
        ..Script::default()
    })
    .await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    assert!(socket.source().starts_with("127.0.0.1:"));
    let mut health = socket.health();
    assert_eq!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 1 }
    );
    assert_eq!(
        next_state(&mut rx).await,
        ConnState::Connected {
            sid: "sid1".to_owned()
        }
    );
    let e = next_event(&mut rx).await;
    assert_eq!(e.push.kind(), "weird");
    let e = next_event(&mut rx).await;
    assert_eq!(
        e.push.dedupe_key(),
        Some(DedupeKey::Block(atlas_core::Hash32::from_hex(H1).unwrap()))
    );
    assert_eq!(e.source, *socket.source());
    assert!(e.received_ms > 0);
    let e = next_event(&mut rx).await;
    let ChainPush::Tx(tx) = e.push else { panic!() };
    assert!(tx.is_node_tx());
    let h = wait_health(&mut health, |h| h.last_block_ms.is_some()).await;
    assert!(h.connected && h.healthy);

    server
        .wait_for(|l| matches!(l, Log::Received(1, t) if t == r#"42["subscribe","inv"]"#))
        .await;
    drop(socket);
    let l = server.wait_for(|l| matches!(l, Log::Closed { .. })).await;
    assert_eq!(
        l,
        Log::Closed {
            conn: 1,
            close_frame: true
        }
    );
    // The task reports that it stopped, then the channel closes.
    let mut saw_stopped = false;
    while let Ok(Some(m)) = timeout(Duration::from_secs(2), rx.recv()).await {
        if matches!(
            m,
            SocketMessage::State(StateChange {
                state: ConnState::Stopped,
                ..
            })
        ) {
            saw_stopped = true;
        }
    }
    assert!(saw_stopped);
    assert!(!health.borrow().connected);
}

#[tokio::test]
async fn shutdown_sends_close_frame() {
    let mut server = FakeServer::start(Script::default()).await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { .. }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    socket.shutdown().await;
    let l = server.wait_for(|l| matches!(l, Log::Closed { .. })).await;
    assert_eq!(
        l,
        Log::Closed {
            conn: 1,
            close_frame: true
        }
    );
}

#[tokio::test]
async fn pings_follow_server_interval_and_keep_session() {
    let mut server = FakeServer::start(Script {
        ping_interval_ms: 100,
        ping_timeout_ms: 150,
        ..Script::default()
    })
    .await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    for _ in 0..4 {
        server
            .wait_for(|l| matches!(l, Log::Received(1, t) if t == "2"))
            .await;
    }
    // No disconnect happened: the next state message would be one.
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 1 }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    assert!(rx.try_recv().is_err());
    assert_eq!(server.accepted.load(Ordering::SeqCst), 1);
    socket.shutdown().await;
}

#[tokio::test]
async fn ping_timeout_reconnects() {
    let mut server = FakeServer::start(Script {
        ping_interval_ms: 100,
        ping_timeout_ms: 100,
        answer_pings: false,
        ..Script::default()
    })
    .await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    let mut health = socket.health();
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 1 }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    let ConnState::Disconnected { reason, retry_in } = next_state(&mut rx).await else {
        panic!("expected a disconnect")
    };
    assert!(reason.contains("ping timeout"), "{reason}");
    assert!(retry_in <= Duration::from_millis(20));
    let h = wait_health(&mut health, |h| !h.connected).await;
    assert!(!h.healthy);
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 2 }
    ));
    assert!(matches!(next_state(&mut rx).await, ConnState::Connected { sid } if sid == "sid2"));
    server.wait_for(|l| *l == Log::Accepted(2)).await;
    socket.shutdown().await;
}

#[tokio::test]
async fn stale_block_stream_turns_unhealthy_then_recovers() {
    let server = FakeServer::start(Script::default()).await;
    let cfg = SocketConfig {
        block_stale_after: Duration::from_millis(250),
        reconnect_on_stale: false,
        ..fast_config()
    };
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &cfg);
    let mut health = socket.health();
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { .. }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    let h = wait_health(&mut health, |h| h.connected).await;
    assert!(h.healthy, "fresh connection gets a grace period: {h:?}");
    let h = wait_health(&mut health, |h| !h.healthy).await;
    assert_eq!(h.reason, Some(Unhealthy::BlockStale));
    assert!(h.connected);
    server.push.send(block_frame(H1)).unwrap();
    let h = wait_health(&mut health, |h| h.healthy).await;
    assert!(h.last_block_ms.is_some());
    let h = wait_health(&mut health, |h| !h.healthy).await;
    assert_eq!(h.reason, Some(Unhealthy::BlockStale));
    // No reconnect was forced.
    assert!(
        rx.try_recv()
            .map_or(true, |m| matches!(m, SocketMessage::Event(_)))
    );
    socket.shutdown().await;
}

#[tokio::test]
async fn stale_block_stream_forces_reconnect() {
    let mut server = FakeServer::start(Script::default()).await;
    let cfg = SocketConfig {
        block_stale_after: Duration::from_millis(200),
        ..fast_config()
    };
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &cfg);
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { .. }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    let ConnState::Disconnected { reason, .. } = next_state(&mut rx).await else {
        panic!()
    };
    assert!(reason.contains("no block"), "{reason}");
    server.wait_for(|l| *l == Log::Accepted(2)).await;
    socket.shutdown().await;
}

#[tokio::test]
async fn server_disconnect_packet_reconnects() {
    let server = FakeServer::start(Script {
        on_subscribe: vec!["41".to_owned()],
        ..Script::default()
    })
    .await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 1 }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    let ConnState::Disconnected { reason, .. } = next_state(&mut rx).await else {
        panic!()
    };
    assert!(reason.contains("disconnect"), "{reason}");
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 2 }
    ));
    socket.shutdown().await;
}

#[tokio::test]
async fn connect_failures_back_off_and_count_attempts() {
    // Bind then drop to get a port nobody listens on.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let url = format!("ws://127.0.0.1:{port}/socket.io/?EIO=3&transport=websocket");
    let (socket, mut rx) = InsightSocket::spawn(&url, &fast_config());
    let mut delays = Vec::new();
    for attempt in 1..=4 {
        assert_eq!(next_state(&mut rx).await, ConnState::Connecting { attempt });
        let ConnState::Disconnected { reason, retry_in } = next_state(&mut rx).await else {
            panic!()
        };
        assert!(reason.contains("connect failed"), "{reason}");
        delays.push(retry_in);
    }
    assert!(delays[0] <= Duration::from_millis(20));
    assert!(delays[3] >= Duration::from_millis(50) && delays[3] <= Duration::from_millis(100));
    let h = socket.health().borrow().clone();
    assert_eq!(h.reason, Some(Unhealthy::NotConnected));
    socket.shutdown().await;
}

#[tokio::test]
async fn dual_socket_dedupes_across_two_servers() {
    let mut a = FakeServer::start(Script {
        on_subscribe: vec![block_frame(H1), tx_frame(T1)],
        ..Script::default()
    })
    .await;
    let mut b = FakeServer::start(Script {
        on_subscribe: vec![tx_frame(T2), block_frame(H1), tx_frame(T1)],
        ..Script::default()
    })
    .await;
    let cfg = SocketConfig {
        urls: vec![a.url.clone(), b.url.clone()],
        ..fast_config()
    };
    let (dual, mut rx) = DualSocket::spawn(&cfg);
    assert_eq!(dual.sources().len(), 2);
    let mut health = dual.health();
    let mut events = Vec::new();
    let mut connected = 0;
    while events.len() < 3 {
        match next(&mut rx).await {
            SocketMessage::Event(e) => events.push(e),
            SocketMessage::State(StateChange {
                state: ConnState::Connected { .. },
                ..
            }) => connected += 1,
            SocketMessage::State(_) => {}
        }
    }
    // Give the duplicates time to arrive and be dropped.
    tokio::time::sleep(Duration::from_millis(200)).await;
    while let Ok(m) = rx.try_recv() {
        match m {
            SocketMessage::Event(e) => events.push(e),
            SocketMessage::State(StateChange {
                state: ConnState::Connected { .. },
                ..
            }) => connected += 1,
            SocketMessage::State(_) => {}
        }
    }
    assert_eq!(connected, 2);
    assert_eq!(events.len(), 3, "{events:?}");
    let blocks = events.iter().filter(|e| e.push.kind() == "block").count();
    assert_eq!(blocks, 1);
    let stats = dual.stats();
    assert_eq!(stats.duplicates, 2);
    assert_eq!(stats.emitted, 3);
    let firsts: u64 = stats.sources.iter().map(|s| s.first).sum();
    assert_eq!(firsts, 3);
    let h = wait_health(&mut health, |h| h.healthy).await;
    assert!(h.connected && h.last_block_ms.is_some());
    assert!(dual.source_health().iter().all(|(_, h)| h.connected));

    dual.shutdown().await;
    for s in [&mut a, &mut b] {
        let l = s.wait_for(|l| matches!(l, Log::Closed { .. })).await;
        assert!(matches!(
            l,
            Log::Closed {
                close_frame: true,
                ..
            }
        ));
    }
}

#[tokio::test]
async fn dual_health_is_any_healthy() {
    let server = FakeServer::start(Script::default()).await;
    let dead = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let cfg = SocketConfig {
        urls: vec![
            format!("ws://127.0.0.1:{dead}/socket.io/?EIO=3&transport=websocket"),
            server.url.clone(),
        ],
        ..fast_config()
    };
    let (dual, _rx) = DualSocket::spawn(&cfg);
    let mut health = dual.health();
    let h = wait_health(&mut health, |h| h.healthy).await;
    assert!(h.connected);
    let per = dual.source_health();
    assert!(!per[0].1.healthy && per[1].1.healthy);
    drop(dual);
    let h = wait_health(&mut health, |h| !h.connected).await;
    assert!(!h.healthy);
}

#[tokio::test]
async fn oversized_message_ends_the_session() {
    // A frame over the cap (the library default would buffer up to 64 MiB) drops the session,
    // which then reconnects like any other failure.
    let huge = format!(
        r#"42["weird","{}"]"#,
        "x".repeat(super::client::MAX_MESSAGE_BYTES + 1)
    );
    let server = FakeServer::start(Script {
        on_subscribe: vec![huge, block_frame(H1)],
        ..Script::default()
    })
    .await;
    let (socket, mut rx) = InsightSocket::spawn(&server.url, &fast_config());
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connecting { attempt: 1 }
    ));
    assert!(matches!(
        next_state(&mut rx).await,
        ConnState::Connected { .. }
    ));
    let ConnState::Disconnected { reason, .. } = next_state(&mut rx).await else {
        panic!("expected a disconnect")
    };
    let r = reason.to_ascii_lowercase();
    assert!(r.contains("size") || r.contains("too"), "{reason}");
    socket.shutdown().await;
}

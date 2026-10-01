//! WebSocket `/ws`: hello, topic filtering, subscribe-then-replay with dedupe, resync, slow
//! consumer drop, watch hooks, pings, limits, shutdown, and serialize-once fan-out.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)]

mod common;

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::time::Duration;

use atlas_core::api::TxLite;
use atlas_core::chain::TxKind;
use atlas_core::live::{FeedItem, FeedKind, LiveBody, NextPayeesMsg};
use atlas_core::{Amount, Hash32, NodeId};
use atlas_engine::EngineConfig;
use atlas_server::ServerConfig;
use atlas_server::fixtures;
use atlas_server::watch::WatchCall;
use common::{Env, EnvBuilder, eventually, serve};
use futures_util::{SinkExt as _, StreamExt as _};
use tokio_tungstenite::tungstenite::Message;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(addr: std::net::SocketAddr) -> Ws {
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap();
    ws
}

/// Next text frame as JSON (pings are answered by the client library and skipped).
async fn next_json(ws: &mut Ws) -> serde_json::Value {
    loop {
        let m = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("timed out waiting for a message")
            .expect("stream ended")
            .expect("ws error");
        match m {
            Message::Text(t) => return serde_json::from_str(t.as_str()).unwrap(),
            Message::Close(c) => panic!("closed: {c:?}"),
            _ => {}
        }
    }
}

async fn send(ws: &mut Ws, v: serde_json::Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

fn feed(i: u64) -> LiveBody {
    LiveBody::Feed(FeedItem {
        kind: FeedKind::NodeJoined,
        ts_ms: i,
        text_key: "feed.node_joined".into(),
        refs: vec![],
        params: BTreeMap::new(),
    })
}

fn payees(h: u32) -> LiveBody {
    LiveBody::NextPayees(NextPayeesMsg {
        height: h,
        payees: vec![],
    })
}

async fn started(b: EnvBuilder) -> (Env, std::net::SocketAddr) {
    let e = b.build();
    let addr = serve(e.app.clone()).await;
    (e, addr)
}

/// Connects, reads hello, and subscribes from the hello seq (so nothing emitted afterwards is
/// missed, however fast the test emits).
async fn subscribed(addr: std::net::SocketAddr, topics: &[&str]) -> (Ws, u64) {
    let mut ws = connect(addr).await;
    let hello = next_json(&mut ws).await;
    assert_eq!(hello["t"], "hello");
    let seq = hello["seq"].as_u64().unwrap();
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": topics, "since_seq": seq}),
    )
    .await;
    (ws, seq)
}

#[tokio::test]
async fn hello_and_topic_filtering() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let mut ws = connect(addr).await;
    let hello = next_json(&mut ws).await;
    assert_eq!(hello["t"], "hello");
    assert_eq!(hello["seq"], e.engine.seq());
    assert_eq!(hello["tip"]["height"], fixtures::TIP);
    assert!(hello["server"]["api_version"].is_number());
    let seq = hello["seq"].as_u64().unwrap();
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["chain"], "since_seq": seq}),
    )
    .await;
    e.engine.emit(None, feed(1));
    e.engine.emit(Some(5), payees(10));
    e.engine.emit(None, feed(2));
    e.engine.emit(None, payees(11));
    let m = next_json(&mut ws).await;
    assert_eq!(m["t"], "next_payees");
    assert_eq!(m["height"], 10);
    assert_eq!(m["event_ms"], 5);
    assert!(m["observed_ms"].is_number());
    assert_eq!(
        next_json(&mut ws).await["height"],
        11,
        "feed messages filtered out"
    );
    // Re-subscribing replaces the topic set.
    let now = e.engine.seq();
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": now}),
    )
    .await;
    // A feed item can only arrive through the new subscription (live or replayed).
    e.engine.emit(None, feed(3));
    let m = next_json(&mut ws).await;
    assert_eq!(m["t"], "feed");
    assert_eq!(m["ts_ms"], 3);
    e.engine.emit(None, payees(12));
    e.engine.emit(None, feed(5));
    assert_eq!(
        next_json(&mut ws).await["ts_ms"],
        5,
        "chain is no longer subscribed"
    );
    // Pong is accepted silently; garbage is tolerated a few times.
    send(&mut ws, serde_json::json!({"t": "pong", "now_ms": 1})).await;
    ws.send(Message::Text("{not json".into())).await.unwrap();
    e.engine.emit(None, feed(4));
    assert_eq!(next_json(&mut ws).await["ts_ms"], 4);
}

#[tokio::test]
async fn replay_since_seq_then_live_without_duplicates() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let base = e.engine.seq();
    for i in 0..5 {
        e.engine.emit(None, feed(i));
    }
    let mut ws = connect(addr).await;
    let hello = next_json(&mut ws).await;
    assert_eq!(hello["seq"], base + 5);
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": base + 2}),
    )
    .await;
    for want in base + 3..=base + 5 {
        assert_eq!(next_json(&mut ws).await["seq"], want);
    }
    e.engine.emit(None, feed(9));
    assert_eq!(next_json(&mut ws).await["seq"], base + 6);
    assert!(e.state.hub.stats.replayed.load(Ordering::Relaxed) >= 3);
}

#[tokio::test]
async fn subscribe_during_a_burst_is_gap_free_and_deduped() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let start = e.engine.seq();
    let engine = e.engine.clone();
    let emitter = tokio::spawn(async move {
        for i in 0..400u64 {
            engine.emit(None, feed(i));
            if i % 8 == 0 {
                tokio::task::yield_now().await;
            }
        }
    });
    let mut ws = connect(addr).await;
    let _hello = next_json(&mut ws).await;
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": start}),
    )
    .await;
    emitter.await.unwrap();
    let last = start + 400;
    let mut seen = Vec::new();
    while seen.last().copied() != Some(last) {
        seen.push(next_json(&mut ws).await["seq"].as_u64().unwrap());
    }
    let want: Vec<u64> = (start + 1..=last).collect();
    assert_eq!(seen, want, "every message exactly once, in order");
}

#[tokio::test]
async fn resync_when_the_ring_cannot_cover_the_gap() {
    let (e, addr) = started(EnvBuilder {
        engine: EngineConfig {
            replay_capacity: 16,
            ..fixtures::test_engine_config()
        },
        ..EnvBuilder::default()
    })
    .await;
    for i in 0..40 {
        e.engine.emit(None, feed(i));
    }
    let mut ws = connect(addr).await;
    next_json(&mut ws).await;
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": 1}),
    )
    .await;
    let m = next_json(&mut ws).await;
    assert_eq!(m["t"], "resync");
    assert_eq!(m["reason"], "replay_gap");
    // A seq from before a restart (ahead of ours) also resyncs.
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": 1_000_000}),
    )
    .await;
    let m = next_json(&mut ws).await;
    assert_eq!(m["t"], "resync");
    assert_eq!(m["reason"], "unknown_seq");
    // Live messages still flow after a resync.
    e.engine.emit(None, feed(99));
    assert_eq!(next_json(&mut ws).await["ts_ms"], 99);
    assert_eq!(e.state.hub.stats.resyncs.load(Ordering::Relaxed), 2);
}

fn big_mempool(i: u64) -> LiveBody {
    LiveBody::Mempool {
        txs: (0..400u64)
            .map(|j| TxLite {
                txid: Hash32(*blake3::hash(&(i * 1000 + j).to_le_bytes()).as_bytes()),
                value: Amount::from_flux(1),
                kind: TxKind::Transfer,
                size: Some(250),
            })
            .collect(),
    }
}

#[tokio::test]
async fn slow_consumer_is_dropped() {
    let mut server = ServerConfig::default();
    server.ws.queue = 16;
    server.ws.write_timeout = Duration::from_millis(500);
    let (e, addr) = started(EnvBuilder {
        server,
        ..EnvBuilder::default()
    })
    .await;
    let (mut ws, _) = subscribed(addr, &["mempool"]).await;
    // Stop reading and flood about 40 MB.
    for i in 0..800 {
        e.engine.emit(None, big_mempool(i));
        if i % 50 == 0 {
            tokio::task::yield_now().await;
        }
    }
    eventually("slow consumer disconnect", || {
        e.state
            .hub
            .stats
            .slow_consumer_disconnects
            .load(Ordering::Relaxed)
            == 1
    })
    .await;
    eventually("connection released", || e.state.hub.connections() == 0).await;
    // Draining the socket ends with the 4008 close frame (or a reset once the server gave up).
    let mut close_code = None;
    while let Ok(Some(m)) = tokio::time::timeout(Duration::from_secs(5), ws.next()).await {
        match m {
            Ok(Message::Close(Some(c))) => {
                close_code = Some(u16::from(c.code));
                break;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    if let Some(c) = close_code {
        assert_eq!(c, 4008);
    }
    let dropped = e.state.hub.stats.messages_dropped.load(Ordering::Relaxed);
    let sent = e.state.hub.stats.messages_sent.load(Ordering::Relaxed);
    assert!(dropped > 0 || sent < 801, "dropped {dropped}, sent {sent}");
}

#[tokio::test]
async fn watch_hooks_follow_sub_and_disconnect() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let mut ws = connect(addr).await;
    next_json(&mut ws).await;
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["nodes"], "watch": [2, 1, 2], "watch_apps": ["KadenaNode", "bad name!"]}),
    )
    .await;
    eventually("set_watch", || !e.hooks.calls().is_empty()).await;
    let WatchCall::Set {
        conn_id,
        nodes,
        apps,
    } = e.hooks.calls()[0].clone()
    else {
        panic!("expected set")
    };
    assert_eq!(nodes, vec![NodeId(1), NodeId(2)]);
    assert_eq!(apps, vec!["kadenanode".to_owned()]);
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["nodes"]}),
    )
    .await;
    eventually("clear on unwatch", || e.hooks.calls().len() == 2).await;
    assert_eq!(e.hooks.calls()[1], WatchCall::Clear { conn_id });
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["nodes"], "watch": [3]}),
    )
    .await;
    eventually("set again", || e.hooks.calls().len() == 3).await;
    ws.close(None).await.unwrap();
    eventually("clear on disconnect", || e.hooks.calls().len() == 4).await;
    assert_eq!(e.hooks.calls()[3], WatchCall::Clear { conn_id });
    // A connection that never watched does not call the hooks.
    let mut ws2 = connect(addr).await;
    next_json(&mut ws2).await;
    drop(ws2);
    eventually("released", || e.state.hub.connections() == 0).await;
    assert_eq!(e.hooks.calls().len(), 4);
}

#[tokio::test]
async fn pings_keep_readers_alive_and_idle_peers_are_closed() {
    let mut server = ServerConfig::default();
    server.ws.ping_interval = Duration::from_millis(100);
    server.ws.idle_timeout = Duration::from_millis(400);
    let (e, addr) = started(EnvBuilder {
        server,
        ..EnvBuilder::default()
    })
    .await;
    // A reader sees pings (and its library answers them).
    let mut reader = connect(addr).await;
    let mut pings = 0;
    let until = tokio::time::Instant::now() + Duration::from_millis(900);
    while tokio::time::Instant::now() < until {
        if let Ok(Some(Ok(m))) =
            tokio::time::timeout(Duration::from_millis(200), reader.next()).await
        {
            match m {
                Message::Ping(_) => pings += 1,
                Message::Close(c) => panic!("reader closed: {c:?}"),
                _ => {}
            }
        }
    }
    assert!(pings >= 3, "pings seen: {pings}");
    assert_eq!(
        e.state.hub.stats.idle_disconnects.load(Ordering::Relaxed),
        0
    );
    reader.close(None).await.unwrap();
    eventually("reader released", || e.state.hub.connections() == 0).await;
    // A peer that answers nothing is closed with 4000.
    let mut idle = connect(addr).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert_eq!(
        e.state.hub.stats.idle_disconnects.load(Ordering::Relaxed),
        1
    );
    // The stream ends with the 4000 close frame, unless the client library trips over the
    // closed socket while answering queued pings first.
    loop {
        match tokio::time::timeout(Duration::from_secs(2), idle.next()).await {
            Ok(Some(Ok(Message::Close(Some(c))))) => {
                assert_eq!(u16::from(c.code), 4000);
                break;
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(_)) | None) => break,
            Err(elapsed) => panic!("idle connection was not closed: {elapsed}"),
        }
    }
}

#[tokio::test]
async fn connection_limits() {
    let mut server = ServerConfig::default();
    server.ws.max_per_ip = 2;
    let (e, addr) = started(EnvBuilder {
        server,
        ..EnvBuilder::default()
    })
    .await;
    let _a = connect(addr).await;
    let _b = connect(addr).await;
    let err = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(r) => assert_eq!(r.status().as_u16(), 429),
        other => panic!("unexpected {other:?}"),
    }
    assert_eq!(e.state.hub.stats.rejected_total.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn shutdown_closes_with_going_away() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let (mut ws, _) = subscribed(addr, &["chain"]).await;
    e.state.begin_shutdown();
    let mut code = None;
    while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(3), ws.next()).await {
        if let Message::Close(Some(c)) = m {
            code = Some(u16::from(c.code));
            break;
        }
    }
    assert_eq!(code, Some(1001));
    eventually("released", || e.state.hub.connections() == 0).await;
    let err = tokio_tungstenite::connect_async(format!("ws://{addr}/ws")).await;
    assert!(
        err.is_err(),
        "new connections are refused while shutting down"
    );
}

#[tokio::test]
async fn each_message_is_serialized_once_for_all_connections() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let mut clients = Vec::new();
    for _ in 0..4 {
        clients.push(subscribed(addr, &["feed"]).await.0);
    }
    let before = e.state.hub.stats.frames_published.load(Ordering::Relaxed);
    for i in 0..10 {
        e.engine.emit(None, feed(i));
    }
    let mut texts: Vec<Vec<String>> = Vec::new();
    for ws in &mut clients {
        let mut got = Vec::new();
        for _ in 0..10 {
            got.push(next_json(ws).await.to_string());
        }
        texts.push(got);
    }
    assert!(
        texts.windows(2).all(|w| w[0] == w[1]),
        "identical frames for every client"
    );
    assert_eq!(
        e.state.hub.stats.frames_published.load(Ordering::Relaxed) - before,
        10,
        "one serialization per message, not per connection"
    );
}

/// X1 L1: `sub` cannot be used as a replay amplifier. Only the first `sub` replays; later ones
/// keep the receiver (no duplicates, no gap); a burst over the limit is deferred, and the latest
/// watch list still lands.
#[tokio::test]
async fn sub_is_rate_limited_and_replays_once() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let base = e.engine.seq();
    for i in 0..50 {
        e.engine.emit(None, feed(i));
    }
    let mut ws = connect(addr).await;
    next_json(&mut ws).await;
    let n = u64::from(atlas_server::live::ws::SUB_BURST) + 12;
    for k in 0..n {
        send(
            &mut ws,
            serde_json::json!({"t": "sub", "topics": ["feed"], "since_seq": base, "watch": [k]}),
        )
        .await;
    }
    // The first sub replays the 50 messages; the rest replay nothing.
    for want in base + 1..=base + 50 {
        assert_eq!(next_json(&mut ws).await["seq"], want);
    }
    e.engine.emit(None, feed(99));
    assert_eq!(next_json(&mut ws).await["seq"], base + 51, "no duplicates");
    assert_eq!(e.state.hub.stats.replayed.load(Ordering::Relaxed), 50);
    let limited = e.state.hub.stats.subs_limited.load(Ordering::Relaxed);
    assert!(limited >= 10, "{limited}");
    // The deferred (latest) watch list is applied when its token is due.
    eventually("deferred sub applied", || {
        e.hooks.calls().iter().any(
            |c| matches!(c, WatchCall::Set { nodes, .. } if nodes == &vec![NodeId(n as u32 - 1)]),
        )
    })
    .await;
    assert_eq!(e.state.hub.stats.subs_deferred.load(Ordering::Relaxed), 1);
}

/// A replay larger than the cap is answered with a resync (the snapshots are cheaper).
#[tokio::test]
async fn huge_replays_become_a_resync() {
    let (e, addr) = started(EnvBuilder::default()).await;
    let base = e.engine.seq();
    // About 40 KB per message: well over the 2 MiB replay cap in 100 messages.
    for i in 0..100 {
        e.engine.emit(None, big_mempool(i));
    }
    let mut ws = connect(addr).await;
    next_json(&mut ws).await;
    send(
        &mut ws,
        serde_json::json!({"t": "sub", "topics": ["mempool"], "since_seq": base}),
    )
    .await;
    let m = next_json(&mut ws).await;
    assert_eq!(m["t"], "resync");
    assert_eq!(m["reason"], "replay_too_large");
}

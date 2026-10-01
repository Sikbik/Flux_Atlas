//! WebSocket fan-out benchmark: `N` local clients subscribe to every topic, the engine emits a
//! burst of `M` block messages, and every client must receive every message.
//!
//! Reports per-delivery latency (emit to client receive, same process clock) and the time until
//! the last client holds the last message.
//!
//! ```text
//! cargo run --release -p atlas-server --example ws_fanout -- 1000 100 /path/to/tmpdir
//! ```

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::{NodeRef, PayoutDto};
use atlas_core::live::{BlockMsg, LiveBody};
use atlas_core::{Amount, Hash32, NodeId, Outpoint, Tier};
use atlas_server::fixtures::{self, FixtureSpec};
use atlas_server::{AppState, ServerConfig, router};
use futures_util::{SinkExt as _, StreamExt as _};
use tokio_tungstenite::tungstenite::Message;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn block(h: u32) -> LiveBody {
    let node = |i: u32| NodeRef {
        id: NodeId(i),
        outpoint: Outpoint::new(Hash32([i as u8; 32]), 0),
        tier: Tier::Cumulus,
        endpoint: Some(format!("5.0.{}.{}:16127", i / 256, i % 256)),
        lat: Some(50.1),
        lon: Some(8.6),
        country_code: Some("DE".into()),
        city: Some("Frankfurt am Main".into()),
    };
    LiveBody::Block(BlockMsg {
        height: h,
        hash: Hash32([h as u8; 32]),
        prev_hash: Hash32([h.wrapping_sub(1) as u8; 32]),
        time_ms: 1_790_000_000_000,
        size: 4000,
        tx_count: 16,
        producer: Some(node(h % 6000)),
        payouts: Tier::ALL
            .iter()
            .map(|t| PayoutDto {
                tier: *t,
                node: Some(NodeId(h % 5000)),
                address: "t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv".into(),
                amount: Amount::from_flux(9),
            })
            .collect(),
        heartbeats: (0..14).map(|i| NodeId(h * 14 + i)).collect(),
        confirms: vec![],
        starts: vec![node(h + 1)],
        updates: vec![],
        transfers_over_threshold: vec![],
        reward: Amount::from_flux(14),
        fees: Amount::ZERO,
        dev_fund: Amount(50_000_000),
        app_payments: vec![],
        collateral_spent: vec![],
    })
}

fn pct(sorted: &[Duration], p: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[i]
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let clients: usize = args.next().as_deref().unwrap_or("1000").parse()?;
    let messages: u32 = args.next().as_deref().unwrap_or("100").parse()?;
    let dir = args.next().map_or_else(std::env::temp_dir, PathBuf::from);
    std::fs::create_dir_all(&dir)?;
    let db = dir.join(format!("atlas-fanout-{}.redb", std::process::id()));
    let (engine, _) = fixtures::fixture_engine(
        &db,
        fixtures::offline_clients(None),
        fixtures::test_engine_config(),
        FixtureSpec::SMALL,
    )?;
    let mut cfg = ServerConfig::default();
    cfg.ws.max_per_ip = u32::MAX;
    cfg.ws.max_connections = clients + 16;
    let state = AppState::new(engine.clone(), cfg);
    let app = router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });

    let base = engine.seq();
    let emitted: Arc<std::sync::OnceLock<Vec<Instant>>> = Arc::new(std::sync::OnceLock::new());
    let t_connect = Instant::now();
    let mut tasks = Vec::with_capacity(clients);
    for _ in 0..clients {
        let emitted = Arc::clone(&emitted);
        tasks.push(tokio::spawn(async move {
            let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws")).await?;
            // hello
            let _ = ws.next().await;
            ws.send(Message::Text(
                format!(r#"{{"t":"sub","topics":["chain"],"since_seq":{base}}}"#).into(),
            ))
            .await?;
            let mut recv = Vec::with_capacity(messages as usize);
            while recv.len() < messages as usize {
                match ws.next().await {
                    Some(Ok(Message::Text(t))) => {
                        let now = Instant::now();
                        // Cheap seq extraction: the envelope starts with {"seq":N,
                        let s = t.as_str();
                        let seq: u64 = s[7..s[7..].find(',').map_or(7, |i| i + 7)].parse()?;
                        recv.push((seq, now));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => anyhow::bail!("ws error: {e}"),
                    None => anyhow::bail!("stream ended"),
                }
            }
            let emitted = loop {
                if let Some(e) = emitted.get() {
                    break e;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            };
            let lat: Vec<Duration> = recv
                .iter()
                .map(|(seq, at)| at.saturating_duration_since(emitted[(seq - base - 1) as usize]))
                .collect();
            let last = recv.iter().map(|(_, at)| *at).max();
            anyhow::Ok((lat, last))
        }));
    }
    // Wait until every client is subscribed on the server.
    while state.hub.subscribers() < clients {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    println!(
        "{clients} clients connected and subscribed in {:?}",
        t_connect.elapsed()
    );
    let frames_before = state
        .hub
        .stats
        .frames_published
        .load(std::sync::atomic::Ordering::Relaxed);
    let t0 = Instant::now();
    let mut at = Vec::with_capacity(messages as usize);
    for i in 0..messages {
        engine.emit(None, block(3_000_000 + i));
        at.push(Instant::now());
    }
    let emit_time = t0.elapsed();
    let _ = emitted.set(at);
    let mut all = Vec::with_capacity(clients * messages as usize);
    let mut last = t0;
    for t in tasks {
        let (lat, l) = t.await??;
        all.extend(lat);
        if let Some(l) = l {
            last = last.max(l);
        }
    }
    all.sort_unstable();
    let total = last.duration_since(t0);
    let deliveries = all.len();
    let frames = state
        .hub
        .stats
        .frames_published
        .load(std::sync::atomic::Ordering::Relaxed)
        - frames_before;
    let sent = state
        .hub
        .stats
        .messages_sent
        .load(std::sync::atomic::Ordering::Relaxed);
    let dropped = state
        .hub
        .stats
        .slow_consumer_disconnects
        .load(std::sync::atomic::Ordering::Relaxed);
    println!("burst of {messages} messages emitted in {emit_time:?}; {frames} serializations");
    println!(
        "deliveries {deliveries} (expected {}), slow-consumer drops {dropped}, server-sent counter {sent}",
        clients * messages as usize
    );
    println!(
        "latency p50 {:?}  p90 {:?}  p99 {:?}  max {:?}",
        pct(&all, 0.50),
        pct(&all, 0.90),
        pct(&all, 0.99),
        pct(&all, 1.0)
    );
    println!(
        "all clients had all messages after {total:?} ({:.0} deliveries/s)",
        deliveries as f64 / total.as_secs_f64()
    );
    let _ = std::fs::remove_file(&db);
    Ok(())
}

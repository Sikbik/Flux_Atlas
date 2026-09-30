//! Live probe for the Insight socket client.
//!
//! ```text
//! cargo run --example live_probe -- [seconds=90] [--mirror | --single | --all]
//! ```
//!
//! Connects a `DualSocket` (default and `--mirror`: explorer + explorer2; `--single`: explorer
//! only; `--all`: also explorer.flux.zelcore.io), prints one line per normalized event, fetches
//! `https://explorer.runonflux.io/api/block/<hash>` once per new block to report height, tx
//! count, block time and socket latency, and prints a summary after N seconds. Set `RUST_LOG`
//! (for example `RUST_LOG=atlas_flux=debug`) for client logs.

use std::time::Duration;

use atlas_flux::insight_socket::{
    ChainPush, ConnState, DualSocket, MAIN_URL, MIRROR_URL, SocketConfig, SocketMessage,
    ZELCORE_URL,
};
use tokio::task::JoinSet;

const BLOCK_API: &str = "https://explorer.runonflux.io/api/block/";

struct BlockReport {
    hash: String,
    source: String,
    received_ms: u64,
    height: Option<u64>,
    tx_count: Option<usize>,
    time: Option<u64>,
    error: Option<String>,
}

impl BlockReport {
    fn latency_ms(&self) -> Option<i64> {
        self.time
            .map(|t| self.received_ms as i64 - (t as i64) * 1000)
    }
}

fn clock(ms: u64) -> String {
    let day_ms = ms % 86_400_000;
    format!(
        "{:02}:{:02}:{:02}.{:03}Z",
        day_ms / 3_600_000,
        day_ms / 60_000 % 60,
        day_ms / 1000 % 60,
        day_ms % 1000
    )
}

async fn fetch_block(
    client: reqwest::Client,
    hash: String,
    source: String,
    received_ms: u64,
) -> BlockReport {
    let mut report = BlockReport {
        hash: hash.clone(),
        source,
        received_ms,
        height: None,
        tx_count: None,
        time: None,
        error: None,
    };
    let result = async {
        let resp = client
            .get(format!("{BLOCK_API}{hash}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "HTTP {status}: {}",
                body.chars().take(80).collect::<String>()
            ));
        }
        serde_json::from_str::<serde_json::Value>(&body).map_err(|e| e.to_string())
    }
    .await;
    match result {
        Ok(v) => {
            report.height = v["height"].as_u64();
            report.tx_count = v["tx"].as_array().map(Vec::len);
            report.time = v["time"].as_u64();
        }
        Err(e) => report.error = Some(e),
    }
    report
}

fn median(sorted: &[i64]) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let n = sorted.len();
    Some(if n % 2 == 1 {
        sorted[n / 2] as f64
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let mut seconds: u64 = 90;
    let mut urls = vec![MAIN_URL.to_owned(), MIRROR_URL.to_owned()];
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--mirror" => urls = vec![MAIN_URL.to_owned(), MIRROR_URL.to_owned()],
            "--single" => urls = vec![MAIN_URL.to_owned()],
            "--all" => {
                urls = vec![
                    MAIN_URL.to_owned(),
                    MIRROR_URL.to_owned(),
                    ZELCORE_URL.to_owned(),
                ];
            }
            s => seconds = s.parse().map_err(|_| format!("bad argument {s:?}"))?,
        }
    }
    let config = SocketConfig {
        urls,
        ..SocketConfig::default()
    };
    let http = reqwest::Client::builder()
        .user_agent(config.user_agent.clone())
        .timeout(Duration::from_secs(10))
        .build()?;

    let (socket, mut rx) = DualSocket::spawn(&config);
    let sources = socket.sources();
    println!(
        "live_probe: {} s, sources: {}",
        seconds,
        sources
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    );

    let deadline = tokio::time::sleep(Duration::from_secs(seconds));
    tokio::pin!(deadline);
    let mut fetches = JoinSet::new();
    let mut reports: Vec<BlockReport> = Vec::new();
    let (mut txs, mut node_txs, mut infos, mut markets, mut unknown) =
        (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut reconnects = 0u64;

    let print_report = |r: &BlockReport| {
        if let Some(e) = &r.error {
            println!(
                "{} {:<24} block-api error for {}: {e}",
                clock(atlas_core::now_ms()),
                r.source,
                r.hash
            );
        } else {
            println!(
                "{} {:<24} block-api height={} txs={} time={} socket_latency_ms={}",
                clock(atlas_core::now_ms()),
                r.source,
                r.height.map_or_else(|| "-".into(), |v| v.to_string()),
                r.tx_count.map_or_else(|| "-".into(), |v| v.to_string()),
                r.time.map_or_else(|| "-".into(), |t| clock(t * 1000)),
                r.latency_ms().map_or_else(|| "-".into(), |v| v.to_string()),
            );
        }
    };

    loop {
        tokio::select! {
            () = &mut deadline => break,
            _ = tokio::signal::ctrl_c() => break,
            Some(done) = fetches.join_next(), if !fetches.is_empty() => {
                if let Ok(r) = done {
                    print_report(&r);
                    reports.push(r);
                }
            }
            msg = rx.recv() => {
                let Some(msg) = msg else { break };
                match msg {
                    SocketMessage::State(s) => {
                        if matches!(s.state, ConnState::Disconnected { .. }) {
                            reconnects += 1;
                        }
                        println!("{} {:<24} state {:?}", clock(s.at_ms), s.source, s.state);
                    }
                    SocketMessage::Event(ev) => {
                        let detail = match &ev.push {
                            ChainPush::Block { hash } => {
                                fetches.spawn(fetch_block(
                                    http.clone(),
                                    hash.to_hex(),
                                    ev.source.to_string(),
                                    ev.received_ms,
                                ));
                                format!("hash={hash}")
                            }
                            ChainPush::Tx(tx) => {
                                txs += 1;
                                if tx.is_node_tx() {
                                    node_txs += 1;
                                }
                                let kind = if tx.is_node_tx() {
                                    " node_tx"
                                } else if tx.is_coinbase_like() {
                                    " coinbase_like"
                                } else {
                                    ""
                                };
                                format!(
                                    "txid={} value_out={} outputs={}{kind}",
                                    tx.txid,
                                    tx.value_out,
                                    tx.outputs.len()
                                )
                            }
                            ChainPush::Info(i) => {
                                infos += 1;
                                format!(
                                    "height={} supply={} connections={} version={}",
                                    i.height.map_or_else(|| "-".into(), |v| v.to_string()),
                                    i.supply.map_or_else(|| "-".into(), |v| v.to_string()),
                                    i.connections.map_or_else(|| "-".into(), |v| v.to_string()),
                                    i.version.map_or_else(|| "-".into(), |v| v.to_string()),
                                )
                            }
                            ChainPush::MarketsInfo(m) => {
                                markets += 1;
                                format!(
                                    "price_usd={} change_24h_pct={}",
                                    m.price_usd.map_or_else(|| "-".into(), |v| v.to_string()),
                                    m.change_24h_pct.map_or_else(|| "-".into(), |v| v.to_string()),
                                )
                            }
                            ChainPush::Unknown { payload, .. } => {
                                unknown += 1;
                                payload.to_string().chars().take(120).collect()
                            }
                        };
                        println!(
                            "{} {:<24} {:<12} {detail}",
                            clock(ev.received_ms),
                            ev.source,
                            ev.push.kind()
                        );
                    }
                }
            }
        }
    }

    let stats = socket.stats();
    let per_source_health = socket.source_health();
    socket.shutdown().await;
    // Let in-flight block fetches finish (bounded).
    let _ = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(done) = fetches.join_next().await {
            if let Ok(r) = done {
                print_report(&r);
                reports.push(r);
            }
        }
    })
    .await;

    let mut lat: Vec<i64> = reports.iter().filter_map(BlockReport::latency_ms).collect();
    lat.sort_unstable();
    println!();
    println!("=== summary ({seconds} s) ===");
    println!("blocks seen: {}", reports.len());
    for r in &reports {
        println!(
            "  height={} first_source={} latency_ms={}",
            r.height.map_or_else(|| "-".into(), |v| v.to_string()),
            r.source,
            r.latency_ms().map_or_else(|| "-".into(), |v| v.to_string())
        );
    }
    println!(
        "txs seen: {txs} ({node_txs} node txs, {} with outputs)",
        txs - node_txs
    );
    println!("info: {infos}, markets_info: {markets}, unknown events: {unknown}");
    println!("disconnects: {reconnects}");
    println!(
        "block latency ms (received - header time): min={} median={} max={}",
        lat.first().map_or_else(|| "-".into(), ToString::to_string),
        median(&lat).map_or_else(|| "-".into(), |v| format!("{v:.0}")),
        lat.last().map_or_else(|| "-".into(), ToString::to_string),
    );
    println!(
        "emitted: {}, duplicates dropped: {}",
        stats.emitted, stats.duplicates
    );
    for s in &stats.sources {
        let avg_lag = if s.duplicates > 0 {
            format!("{:.0}", s.lag_ms_sum as f64 / s.duplicates as f64)
        } else {
            "-".into()
        };
        let avg_block_lag = if s.duplicate_blocks > 0 {
            format!(
                "{:.0}",
                s.block_lag_ms_sum as f64 / s.duplicate_blocks as f64
            )
        } else {
            "-".into()
        };
        println!(
            "  {:<24} first={} first_blocks={} duplicates={} duplicate_blocks={} avg_lag_ms={} max_lag_ms={} avg_block_lag_ms={}",
            s.source,
            s.first,
            s.first_blocks,
            s.duplicates,
            s.duplicate_blocks,
            avg_lag,
            s.lag_ms_max,
            avg_block_lag
        );
    }
    for (src, h) in per_source_health {
        println!(
            "  health {:<24} connected={} healthy={} reason={:?}",
            src, h.connected, h.healthy, h.reason
        );
    }
    Ok(())
}

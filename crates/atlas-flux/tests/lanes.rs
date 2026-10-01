//! Upstream lanes against a local fake upstream: user-driven (interactive) lookups have their
//! own gates and circuit breakers, so they can neither delay ingest requests nor trip the
//! ingest's breakers (X1 M2).
#![allow(clippy::unwrap_used)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atlas_flux::http::{HostPolicy, RequestOpts};
use atlas_flux::{Clients, ClientsConfig, FluxError, Lane};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;

/// Hits per request path.
#[derive(Default)]
struct Hits(Mutex<HashMap<String, u32>>);

impl Hits {
    fn get(&self, path: &str) -> u32 {
        self.0.lock().unwrap().get(path).copied().unwrap_or(0)
    }
}

/// A minimal HTTP/1.1 upstream: `/fail` answers 500, `/slow` answers after 300 ms, anything
/// else answers a FluxOS success envelope at once.
async fn fake_upstream() -> (String, Arc<Hits>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let hits = Arc::new(Hits::default());
    let h = Arc::clone(&hits);
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let h = Arc::clone(&h);
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                let head = String::from_utf8_lossy(&buf).into_owned();
                let path = head
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .split('?')
                    .next()
                    .unwrap_or("/")
                    .to_owned();
                *h.0.lock().unwrap().entry(path.clone()).or_default() += 1;
                let (status, body) = match path.as_str() {
                    "/fail" => ("500 Internal Server Error", "{}".to_owned()),
                    "/slow" => {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        ("200 OK", r#"{"status":"success","data":1}"#.to_owned())
                    }
                    _ => ("200 OK", r#"{"status":"success","data":1}"#.to_owned()),
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    (format!("http://{addr}"), hits)
}

/// Ingest: a generous budget. Interactive: one request a second, one at a time.
fn clients(base: &str) -> Clients {
    let mut cfg = ClientsConfig {
        fluxos_gateway: base.to_owned(),
        insight_bases: vec![base.to_owned()],
        stats_base: base.to_owned(),
        coingecko_base: base.to_owned(),
        ..ClientsConfig::default()
    };
    cfg.http.attempts = 1;
    cfg.http.timeout = Duration::from_secs(5);
    cfg.http.host_policies.clear();
    cfg.http.default_policy = HostPolicy::new(100, 100, 16);
    cfg.http.interactive_host_policies.clear();
    cfg.http.interactive_default_policy = HostPolicy::new(1, 1, 1);
    Clients::new(cfg).unwrap()
}

fn once() -> RequestOpts {
    RequestOpts::default().attempts(1)
}

#[tokio::test]
async fn interactive_lane_shares_nothing_but_the_pool() {
    let (base, _) = fake_upstream().await;
    let ingest = clients(&base);
    let user = ingest.interactive();
    assert_eq!(ingest.lane(), Lane::Ingest);
    assert_eq!(user.lane(), Lane::Interactive);
    // Own gates: the interactive policy applies, never looser than the ingest one.
    let p = user.http.config().policy_for("127.0.0.1");
    assert_eq!(p, HostPolicy::new(1, 1, 1));
    // Own breakers: the sets are distinct objects with fresh health.
    assert!(!std::ptr::eq(
        ingest.fluxos.failover(),
        user.fluxos.failover()
    ));
    assert!(user.fluxos.failover().is_strict());
    // No direct-node failover for user reads.
    let ep = atlas_flux::GuardedEndpoint::new("94.130.137.2:16127".parse().unwrap()).unwrap();
    user.fluxos.set_failover_nodes(&[ep]);
    assert!(user.fluxos.failover().nodes().is_empty());
}

/// (a) User faults do not open the ingest breaker; (c) the interactive lane's own breaker opens
/// on its own faults and then fails fast without reaching the upstream.
#[tokio::test]
async fn user_faults_open_only_the_interactive_breaker() {
    let (base, hits) = fake_upstream().await;
    let ingest = clients(&base);
    let user = ingest.interactive();
    for _ in 0..atlas_flux::upstream::BREAKER_THRESHOLD {
        let e = user.fluxos.get_raw("fail", &once()).await.unwrap_err();
        assert!(e.is_upstream_fault(), "{e}");
    }
    let now = atlas_core::now_ms();
    let user_gw = user.fluxos.failover().primaries()[0].health.snapshot(now);
    assert!(user_gw.circuit_open, "interactive breaker opened");
    let ingest_gw = ingest.fluxos.failover().primaries()[0].health.snapshot(now);
    assert!(!ingest_gw.circuit_open, "ingest breaker untouched");
    assert_eq!(ingest_gw.consecutive_failures, 0);
    assert_eq!(ingest_gw.err_total, 0);
    // The ingest lane keeps working.
    ingest.fluxos.get_raw("ok", &once()).await.unwrap();
    assert_eq!(hits.get("/ok"), 1);
    // The open interactive breaker fails fast: no request reaches the upstream.
    let e = user.fluxos.get_raw("ok", &once()).await.unwrap_err();
    assert!(matches!(e, FluxError::NoHealthyUpstream("fluxos")), "{e}");
    assert_eq!(hits.get("/ok"), 1, "fail-fast sent nothing upstream");
    assert_eq!(hits.get("/fail"), atlas_flux::upstream::BREAKER_THRESHOLD);
    // Breaker state per lane, for metrics.
    let open: Vec<_> = user
        .breakers()
        .into_iter()
        .filter(|b| b.0 == "fluxos")
        .collect();
    assert!(open.iter().all(|b| b.2));
    assert!(ingest.breakers().iter().all(|b| !b.2));
    // Per-lane request counters.
    let us = user.http.lane_stats();
    assert_eq!(us.len(), 1);
    assert_eq!(us[0].host, "127.0.0.1");
    assert_eq!(
        us[0].err,
        u64::from(atlas_flux::upstream::BREAKER_THRESHOLD)
    );
    assert_eq!(us[0].ok, 0);
    let is = ingest.http.lane_stats();
    assert_eq!((is[0].ok, is[0].err), (1, 0));
}

/// (b) A burst of queued user requests does not delay an ingest request beyond its own gate.
#[tokio::test]
async fn queued_user_requests_never_delay_ingest() {
    let (base, _) = fake_upstream().await;
    let ingest = clients(&base);
    let user = ingest.interactive();
    // Eight slow user lookups on a lane of one request a second, one at a time: about 8 s.
    let mut burst = Vec::new();
    for _ in 0..8 {
        let u = user.clone();
        burst.push(tokio::spawn(async move {
            let _ = u.fluxos.get_raw("slow", &once()).await;
        }));
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let queued = user.http.lane_stats()[0].waiting;
    assert!(queued >= 6, "user requests are queued ({queued})");
    // Control: another user request waits behind them.
    let blocked = tokio::time::timeout(
        Duration::from_millis(800),
        user.fluxos.get_raw("ok", &once()),
    )
    .await;
    assert!(blocked.is_err(), "the interactive lane is saturated");
    // An ingest request goes straight through its own gate.
    let t = Instant::now();
    ingest.fluxos.get_raw("ok", &once()).await.unwrap();
    let took = t.elapsed();
    assert!(took < Duration::from_millis(500), "ingest waited {took:?}");
    assert_eq!(ingest.http.lane_stats()[0].waiting, 0);
    for b in burst {
        b.abort();
    }
}

/// An oversize UTXO answer is definitive: no mirror failover, no breaker fault.
#[tokio::test]
async fn oversize_utxo_answer_is_not_a_fault() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let h = Arc::clone(&hits);
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            h.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            tokio::spawn(async move {
                let mut chunk = [0u8; 4096];
                let _ = sock.read(&mut chunk).await;
                let len = atlas_flux::clients::UTXO_BODY + 1;
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n"
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    let base = format!("http://{addr}");
    let mut c = clients(&base);
    // Two mirrors on the same fake host.
    c.insight =
        atlas_flux::InsightClient::new(c.http.clone(), &[&base, &format!("{base}/m2")]).unwrap();
    let user = c.interactive();
    let e = user.insight.utxos("t1abc").await.unwrap_err();
    assert!(
        matches!(e, FluxError::AnswerTooLarge { .. }),
        "definitive: {e}"
    );
    assert_eq!(
        hits.load(std::sync::atomic::Ordering::Relaxed),
        1,
        "no failover"
    );
    let s = user.insight.failover().primaries()[0]
        .health
        .snapshot(atlas_core::now_ms());
    assert_eq!(s.consecutive_failures, 0);
    // Dot segments are refused before any request.
    let e = user.insight.utxos("..").await.unwrap_err();
    assert!(matches!(e, FluxError::BadUrl(_)), "{e}");
    let e = user.fluxos.app_location("..").await.unwrap_err();
    assert!(matches!(e, FluxError::BadUrl(_)), "{e}");
    assert_eq!(hits.load(std::sync::atomic::Ordering::Relaxed), 1);
}

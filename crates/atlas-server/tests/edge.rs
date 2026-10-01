//! The edge on the real listener (X1 H1, M1, L10, L15): header and idle timeouts, connection
//! caps, the request timeout (and that a WebSocket outlives it), the bounded shutdown drain,
//! security headers, and the client address trust model.
#![allow(clippy::unwrap_used, clippy::missing_panics_doc)]

mod common;

use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use atlas_server::config::{DerivedLimits, HttpLimits, TrustedProxies};
use atlas_server::net::trust::Source;
use atlas_server::{ServerConfig, net};
use common::{Env, EnvBuilder};
use futures_util::StreamExt as _;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;

/// Short timeouts so the tests run quickly.
fn fast_limits() -> HttpLimits {
    HttpLimits {
        header_read_timeout: Duration::from_millis(400),
        write_stall_timeout: Duration::from_millis(400),
        request_timeout: Duration::from_millis(400),
        drain_timeout: Duration::from_millis(500),
        ..HttpLimits::default()
    }
}

struct Served {
    env: Env,
    addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    done: tokio::task::JoinHandle<()>,
}

/// Serves the env's router on the production listener.
async fn serve(server: ServerConfig) -> Served {
    let env = EnvBuilder {
        server,
        ..EnvBuilder::default()
    }
    .build();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let st = env.state.clone();
    let done = tokio::spawn(net::listener::serve(
        std::sync::Arc::clone(&env.state.listener),
        listener,
        env.app.clone(),
        async move {
            let _ = stopped.await;
        },
        move || st.begin_shutdown(),
    ));
    Served {
        env,
        addr,
        stop: Some(stop),
        done,
    }
}

fn server_with(f: impl FnOnce(&mut ServerConfig)) -> ServerConfig {
    let mut s = ServerConfig {
        http: fast_limits(),
        ..ServerConfig::default()
    };
    f(&mut s);
    s
}

/// True once the server closed `s` (EOF or reset) within `within`.
async fn closed_within(s: &mut TcpStream, within: Duration) -> bool {
    let mut buf = [0u8; 4096];
    let deadline = Instant::now() + within;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, s.read(&mut buf)).await {
            Ok(Ok(0) | Err(_)) => return true,
            Ok(Ok(_)) => {}
            Err(_) => return false,
        }
    }
}

/// One request over a raw socket: `(status, head)`.
async fn raw_get(addr: SocketAddr, path: &str, extra: &str) -> (u16, String) {
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: x\r\n{extra}Connection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    let mut buf = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), s.read_to_end(&mut buf))
        .await
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let head = text
        .split("\r\n\r\n")
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (status, head)
}

#[tokio::test]
async fn slow_headers_and_idle_connections_are_closed() {
    let s = serve(server_with(|_| {})).await;
    // A half-sent request head.
    let mut partial = TcpStream::connect(s.addr).await.unwrap();
    partial
        .write_all(b"GET /api/v1/bootstrap HTTP/1.1\r\nHost: x\r\nX-a: ")
        .await
        .unwrap();
    // A connection that never sends a byte.
    let mut idle = TcpStream::connect(s.addr).await.unwrap();
    // A keep-alive connection after one complete request.
    let mut kept = TcpStream::connect(s.addr).await.unwrap();
    kept.write_all(b"GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n")
        .await
        .unwrap();
    let mut first = [0u8; 12];
    kept.read_exact(&mut first).await.unwrap();
    assert_eq!(&first, b"HTTP/1.1 200");
    let t0 = Instant::now();
    assert!(closed_within(&mut partial, Duration::from_secs(3)).await);
    assert!(closed_within(&mut idle, Duration::from_secs(3)).await);
    assert!(closed_within(&mut kept, Duration::from_secs(3)).await);
    assert!(t0.elapsed() < Duration::from_secs(3));
    // The server still answers.
    assert_eq!(raw_get(s.addr, "/healthz", "").await.0, 200);
}

#[tokio::test]
async fn connection_caps_hold() {
    let s = serve(server_with(|c| {
        c.http.max_per_peer = 3;
        c.http.header_read_timeout = Duration::from_secs(10);
    }))
    .await;
    let mut held = Vec::new();
    for _ in 0..3 {
        held.push(TcpStream::connect(s.addr).await.unwrap());
    }
    common::eventually("three open", || s.env.state.listener.open() == 3).await;
    // The fourth from the same (untrusted) peer is closed at accept.
    let mut over = TcpStream::connect(s.addr).await.unwrap();
    assert!(closed_within(&mut over, Duration::from_secs(2)).await);
    assert_eq!(
        s.env
            .state
            .listener
            .stats
            .rejected_per_peer
            .load(Ordering::Relaxed),
        1
    );
    drop(held);
    common::eventually("released", || s.env.state.listener.open() == 0).await;
    assert_eq!(raw_get(s.addr, "/healthz", "").await.0, 200);

    // The global cap holds for every peer, trusted proxies included.
    let s = serve(server_with(|c| {
        c.http.max_connections = 2;
        c.http.header_read_timeout = Duration::from_secs(10);
        c.proxies = TrustedProxies::parse("127.0.0.0/8").unwrap();
    }))
    .await;
    let _a = TcpStream::connect(s.addr).await.unwrap();
    let _b = TcpStream::connect(s.addr).await.unwrap();
    common::eventually("two open", || s.env.state.listener.open() == 2).await;
    let mut over = TcpStream::connect(s.addr).await.unwrap();
    assert!(closed_within(&mut over, Duration::from_secs(2)).await);
    assert_eq!(
        s.env
            .state
            .listener
            .stats
            .rejected_global
            .load(Ordering::Relaxed),
        1
    );
}

#[tokio::test]
async fn websocket_outlives_the_request_timeout() {
    let s = serve(server_with(|c| {
        c.ws.ping_interval = Duration::from_millis(200);
    }))
    .await;
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", s.addr))
        .await
        .unwrap();
    let hello = ws.next().await.unwrap().unwrap();
    assert!(matches!(hello, Message::Text(_)));
    // Several request timeouts later, the socket still gets protocol pings.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let mut pings = 0;
    while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
        if matches!(m, Message::Ping(_)) {
            pings += 1;
        }
        if pings >= 2 {
            break;
        }
    }
    assert!(pings >= 1, "the WebSocket was cut by the request timeout");
}

#[tokio::test]
async fn shutdown_drains_within_its_deadline_despite_a_half_sent_request() {
    let mut s = serve(server_with(|c| {
        c.http.header_read_timeout = Duration::from_secs(60);
    }))
    .await;
    let mut partial = TcpStream::connect(s.addr).await.unwrap();
    partial
        .write_all(b"GET /api/v1/bootstrap HTTP/1.1\r\nHost: x\r\nX-a: ")
        .await
        .unwrap();
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", s.addr))
        .await
        .unwrap();
    let _hello = ws.next().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let t0 = Instant::now();
    s.stop.take().unwrap().send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), &mut s.done)
        .await
        .expect("serve returned within the drain deadline")
        .unwrap();
    assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
    assert!(closed_within(&mut partial, Duration::from_secs(1)).await);
    // The live connection got its going-away close.
    let mut code = None;
    while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
        if let Message::Close(Some(c)) = m {
            code = Some(u16::from(c.code));
            break;
        }
    }
    assert_eq!(code, Some(1001));
}

#[tokio::test]
async fn security_headers_on_every_response() {
    let s = serve(server_with(|_| {})).await;
    let (status, head) = raw_get(s.addr, "/", "").await;
    assert_eq!(status, 200);
    assert!(head.contains("content-type: text/html"));
    assert!(head.contains("content-security-policy: default-src 'self'; script-src 'self'"));
    assert!(head.contains("frame-ancestors 'none'"));
    assert!(head.contains("x-frame-options: deny"));
    assert!(head.contains("x-content-type-options: nosniff"));
    assert!(head.contains("referrer-policy: strict-origin-when-cross-origin"));
    for path in ["/api/v1/network/summary", "/api/v1/nope", "/healthz"] {
        let (_, head) = raw_get(s.addr, path, "").await;
        assert!(
            head.contains("content-security-policy: default-src 'none'; frame-ancestors 'none'"),
            "{path}: {head}"
        );
        assert!(head.contains("x-content-type-options: nosniff"), "{path}");
        assert!(head.contains("x-frame-options: deny"), "{path}");
    }
}

#[tokio::test]
async fn forwarding_headers_count_only_from_trusted_proxies() {
    // Default: the FDM balancers. A loopback caller is untrusted, so its header is ignored and
    // every request shares the caller's own budget.
    let derived = DerivedLimits {
        rps: 1,
        burst: 1,
        ..DerivedLimits::default()
    };
    let s = serve(server_with(|c| c.derived = derived)).await;
    let a = "X-Forwarded-For: 203.0.113.1\r\n";
    let b = "X-Forwarded-For: 203.0.113.2\r\n";
    assert_eq!(raw_get(s.addr, "/api/v1/nodes", a).await.0, 200);
    assert_eq!(
        raw_get(s.addr, "/api/v1/nodes", b).await.0,
        429,
        "forged header"
    );
    assert_eq!(
        s.env
            .state
            .forward
            .source_count(Source::DirectHeaderIgnored),
        2
    );
    assert_eq!(s.env.state.forward.untrusted_forwarders(), 1);

    // With loopback trusted (a proxy on the same host), each forwarded client has its own.
    let s = serve(server_with(|c| {
        c.derived = derived;
        c.proxies = TrustedProxies::parse("127.0.0.1").unwrap();
    }))
    .await;
    assert_eq!(raw_get(s.addr, "/api/v1/nodes", a).await.0, 200);
    assert_eq!(raw_get(s.addr, "/api/v1/nodes", b).await.0, 200);
    assert_eq!(raw_get(s.addr, "/api/v1/nodes", a).await.0, 429);
    // A forged entry to the left of what the proxy appended does not help.
    let forged = "X-Forwarded-For: 198.51.100.9, 203.0.113.1\r\n";
    assert_eq!(raw_get(s.addr, "/api/v1/nodes", forged).await.0, 429);
    assert_eq!(s.env.state.forward.source_count(Source::Forwarded), 4);
    // The metrics are served to loopback.
    let (status, _) = raw_get(s.addr, "/metrics/prometheus", "").await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn slow_handlers_and_store_reads_time_out() {
    use axum::http::StatusCode;
    use axum::routing::get;
    use tower::ServiceExt as _;
    let env = EnvBuilder {
        server: server_with(|_| {}),
        ..EnvBuilder::default()
    }
    .build();
    // A handler slower than the request timeout gets a 503 with Retry-After.
    let app = axum::Router::new()
        .route(
            "/slow",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                "late"
            }),
        )
        .layer(axum::middleware::from_fn_with_state(
            env.state.clone(),
            net::request_timeout,
        ))
        .with_state(env.state.clone());
    let t0 = Instant::now();
    let r = app
        .oneshot(
            axum::http::Request::get("/slow")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(r.headers().contains_key("retry-after"));
    assert!(t0.elapsed() < Duration::from_secs(2));
    assert_eq!(
        env.state.metrics.request_timeouts.load(Ordering::Relaxed),
        1
    );
    // A store read stuck behind a lock (a compaction) answers 503 at its deadline (X1 L2).
    let e = env
        .state
        .store_read_within(Duration::from_millis(100), |_| {
            std::thread::sleep(Duration::from_millis(600));
            Ok(())
        })
        .await
        .unwrap_err();
    assert_eq!(e.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(e.retry_after_s, Some(5));
    assert_eq!(env.state.metrics.store_timeouts.load(Ordering::Relaxed), 1);
    // Normal reads still work.
    env.state
        .store_read(|st| Ok(st.table_rows()?))
        .await
        .unwrap();
}

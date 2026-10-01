//! One process, one port: the real `serve` path (store, engine with ingest off, router) on one
//! ephemeral TCP port serves the web app, the API, the WebSocket and the health probe, and the
//! process opens no other listening socket (no metrics or debug port, no UDP).
//!
//! This file holds a single test so its process has no other servers running in parallel: the
//! listener audit below counts every socket the test process owns.
#![allow(clippy::unwrap_used)]

use std::net::SocketAddr;
use std::time::Duration;

use atlas_server::ServeConfig;
use atlas_server::config::EngineOverrides;
use atlas_server::fixtures;
use futures_util::StreamExt as _;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio_tungstenite::tungstenite::Message;

/// Plain HTTP/1.1 GET over a raw socket: `(status, head, body)`.
async fn get(addr: SocketAddr, path: &str) -> (u16, String, Vec<u8>) {
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    let mut buf = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), s.read_to_end(&mut buf))
        .await
        .unwrap()
        .unwrap();
    let split = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("no header terminator");
    let head = String::from_utf8_lossy(&buf[..split]).to_ascii_lowercase();
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap();
    (status, head, buf[split + 4..].to_vec())
}

/// Sockets the current process owns, by inode (from `/proc/self/fd`).
#[cfg(target_os = "linux")]
fn own_socket_inodes() -> std::collections::HashSet<u64> {
    let mut out = std::collections::HashSet::new();
    for e in std::fs::read_dir("/proc/self/fd").unwrap().flatten() {
        if let Ok(target) = std::fs::read_link(e.path()) {
            let t = target.to_string_lossy();
            if let Some(n) = t.strip_prefix("socket:[").and_then(|r| r.strip_suffix(']')) {
                out.insert(n.parse().unwrap());
            }
        }
    }
    out
}

/// `(table, local port, state)` of every inet socket this process owns.
#[cfg(target_os = "linux")]
fn own_inet_sockets() -> Vec<(&'static str, u16, String)> {
    let mine = own_socket_inodes();
    let mut out = Vec::new();
    for table in ["tcp", "tcp6", "udp", "udp6", "raw", "raw6"] {
        let Ok(text) = std::fs::read_to_string(format!("/proc/self/net/{table}")) else {
            continue;
        };
        for line in text.lines().skip(1) {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 10 {
                continue;
            }
            let inode: u64 = f[9].parse().unwrap_or(0);
            if !mine.contains(&inode) {
                continue;
            }
            let port = f[1]
                .rsplit(':')
                .next()
                .and_then(|p| u16::from_str_radix(p, 16).ok())
                .unwrap_or(0);
            out.push((table, port, f[3].to_owned()));
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_port_serves_everything() {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut cfg = ServeConfig::new(addr, dir.path().join("data"));
    cfg.clients = fixtures::offline_clients(None);
    cfg.engine_overrides = EngineOverrides {
        ingest: Some(false),
        ..EngineOverrides::default()
    };
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(atlas_server::serve_on(cfg, listener, async move {
        let _ = stop_rx.await;
    }));

    // Health probe (also what the container HEALTHCHECK runs).
    let mut healthy = false;
    for _ in 0..200 {
        if atlas_server::healthcheck(addr, Duration::from_secs(2))
            .await
            .is_ok()
        {
            healthy = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(healthy, "/healthz never answered 200");
    let (status, head, body) = get(addr, "/healthz").await;
    assert_eq!(status, 200);
    assert!(head.contains("application/json"), "{head}");
    assert!(String::from_utf8_lossy(&body).contains("\"status\""));

    // The web app: the index and an SPA deep link (fallback to index.html).
    for path in ["/", "/explorer/blocks"] {
        let (status, head, body) = get(addr, path).await;
        assert_eq!(status, 200, "{path}");
        assert!(head.contains("content-type: text/html"), "{path}: {head}");
        let text = String::from_utf8_lossy(&body).to_ascii_lowercase();
        assert!(text.starts_with("<!doctype html"), "{path}");
    }

    // An API route (the engine's startup publish backs it even with an empty store).
    let mut api = (0, String::new(), Vec::new());
    for _ in 0..200 {
        api = get(addr, "/api/v1/bootstrap").await;
        if api.0 == 200 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(api.0, 200, "bootstrap: {}", api.1);
    assert!(api.1.contains("application/json"), "{}", api.1);
    let boot: serde_json::Value = serde_json::from_slice(&api.2).unwrap();
    assert!(boot.get("seq").is_some());
    let (status, _, _) = get(addr, "/api/v1/no-such-endpoint").await;
    assert_eq!(status, 404);

    // Prometheus metrics live on the same port.
    let (status, _, body) = get(addr, "/metrics/prometheus").await;
    assert_eq!(status, 200);
    assert!(String::from_utf8_lossy(&body).contains("atlas_live_seq"));

    // The live WebSocket upgrade on the same port: the first message is `hello`.
    let (mut ws, resp) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 101);
    let first = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let Message::Text(t) = first else {
        panic!("expected a text frame, got {first:?}");
    };
    let hello: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
    assert_eq!(hello["t"], "hello");

    // Listener audit: exactly one listening socket (TCP, our port) and no UDP or raw sockets.
    #[cfg(target_os = "linux")]
    {
        let socks = own_inet_sockets();
        let listening: Vec<_> = socks
            .iter()
            .filter(|(t, _, st)| t.starts_with("tcp") && st == "0A")
            .collect();
        assert_eq!(listening.len(), 1, "listening sockets: {socks:?}");
        assert_eq!(listening[0].1, addr.port());
        assert!(
            socks.iter().all(|(t, _, _)| t.starts_with("tcp")),
            "non-TCP sockets: {socks:?}"
        );
    }

    drop(ws);
    stop_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(15), server)
        .await
        .expect("server did not stop")
        .unwrap()
        .unwrap();
}

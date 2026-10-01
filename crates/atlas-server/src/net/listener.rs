//! The HTTP listener: accept loop, connection caps, timeouts and a bounded drain on shutdown
//! (ARCHITECTURE section 11.2).
//!
//! - **Connection caps.** A global cap on open TCP connections (including upgraded WebSockets)
//!   and a per-peer cap for peers that are not trusted proxies. A connection over a cap is
//!   closed at accept, before any byte is read.
//! - **Header read timeout.** hyper's HTTP/1 header timer, which runs from the moment the
//!   connection waits for a request head: it bounds both a slowly sent header and the idle time
//!   of a keep-alive connection between requests.
//! - **Write stall timeout.** A connection whose socket accepts no byte for this long is closed
//!   (a client that stops reading its response). It also covers upgraded WebSockets, whose own
//!   write deadline is shorter.
//! - **Drain.** On shutdown, idle connections close at once, in-flight requests get
//!   `drain_timeout` to finish, and then every remaining connection is dropped.
//!
//! HTTP/1.1 only: browsers never speak cleartext HTTP/2, and FDM talks HTTP/1.1 to the app.

use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use axum::Router;
use axum::extract::ConnectInfo;
use hyper::body::Incoming;
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, watch};
use tower_service::Service as _;

use super::trust::{TrustedProxies, canonical, client_key};
use crate::config::HttpLimits;

/// Connection counters, exported to Prometheus.
#[derive(Debug, Default)]
pub struct ConnStats {
    pub accepted: AtomicU64,
    /// Closed at accept: the global cap was reached.
    pub rejected_global: AtomicU64,
    /// Closed at accept: the peer's cap was reached.
    pub rejected_per_peer: AtomicU64,
    /// Accepted from a trusted proxy.
    pub accepted_from_proxy: AtomicU64,
    /// Closed because the socket accepted no byte within the write stall timeout.
    pub write_stalls: AtomicU64,
    /// Ended with an error (includes header read timeouts and malformed requests).
    pub errors: AtomicU64,
    /// `accept` failures (for example out of file descriptors).
    pub accept_errors: AtomicU64,
    /// Connections dropped when the shutdown drain deadline passed.
    pub drain_dropped: AtomicU64,
    /// Open TCP connections, including upgraded WebSockets.
    pub open: AtomicUsize,
    /// Distinct untrusted peers currently holding connections.
    pub peers: AtomicUsize,
}

/// Shared state of the accept loop.
#[derive(Debug)]
pub struct Listener {
    limits: HttpLimits,
    proxies: TrustedProxies,
    permits: Arc<Semaphore>,
    per_peer: Mutex<HashMap<IpAddr, u32>>,
    pub stats: ConnStats,
}

/// A peer's connection slot; released on drop.
#[derive(Debug)]
struct PeerSlot {
    key: IpAddr,
    listener: Arc<Listener>,
}

impl Drop for PeerSlot {
    fn drop(&mut self) {
        let mut m = self
            .listener
            .per_peer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(c) = m.get_mut(&self.key) {
            *c = c.saturating_sub(1);
            if *c == 0 {
                m.remove(&self.key);
            }
        }
        self.listener.stats.peers.store(m.len(), Ordering::Relaxed);
    }
}

/// Everything a connection holds for its lifetime: dropped with the socket (after an upgrade,
/// with the WebSocket).
#[derive(Debug)]
struct Slots {
    _global: OwnedSemaphorePermit,
    _peer: Option<PeerSlot>,
    listener: Arc<Listener>,
}

impl Drop for Slots {
    fn drop(&mut self) {
        self.listener.stats.open.fetch_sub(1, Ordering::Relaxed);
    }
}

impl Listener {
    pub fn new(limits: HttpLimits, proxies: TrustedProxies) -> Arc<Self> {
        Arc::new(Self {
            permits: Arc::new(Semaphore::new(limits.max_connections.max(1))),
            limits,
            proxies,
            per_peer: Mutex::new(HashMap::new()),
            stats: ConnStats::default(),
        })
    }

    pub fn limits(&self) -> &HttpLimits {
        &self.limits
    }

    /// Reserves the slots of a new connection from `peer`, or `None` when a cap is reached.
    fn admit(self: &Arc<Self>, peer: IpAddr) -> Option<Slots> {
        let Ok(global) = Arc::clone(&self.permits).try_acquire_owned() else {
            self.stats.rejected_global.fetch_add(1, Ordering::Relaxed);
            return None;
        };
        let peer_slot = if self.proxies.is_trusted(peer) {
            self.stats
                .accepted_from_proxy
                .fetch_add(1, Ordering::Relaxed);
            None
        } else {
            let key = client_key(peer);
            let mut m = self
                .per_peer
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let c = m.entry(key).or_insert(0);
            if *c >= self.limits.max_per_peer {
                drop(m);
                self.stats.rejected_per_peer.fetch_add(1, Ordering::Relaxed);
                return None;
            }
            *c += 1;
            self.stats.peers.store(m.len(), Ordering::Relaxed);
            Some(PeerSlot {
                key,
                listener: Arc::clone(self),
            })
        };
        self.stats.accepted.fetch_add(1, Ordering::Relaxed);
        self.stats.open.fetch_add(1, Ordering::Relaxed);
        Some(Slots {
            _global: global,
            _peer: peer_slot,
            listener: Arc::clone(self),
        })
    }

    /// Connections currently open.
    pub fn open(&self) -> usize {
        self.stats.open.load(Ordering::Relaxed)
    }
}

/// A TCP stream that fails a write that makes no progress for `stall` and holds the
/// connection's slots.
struct GuardedIo {
    inner: TcpStream,
    stall: Duration,
    stalled: Option<Pin<Box<tokio::time::Sleep>>>,
    slots: Slots,
}

impl GuardedIo {
    fn progress(&mut self) {
        self.stalled = None;
    }

    fn poll_stall<T>(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<T>> {
        let stall = self.stall;
        let sleep = self
            .stalled
            .get_or_insert_with(|| Box::pin(tokio::time::sleep(stall)));
        if sleep.as_mut().poll(cx).is_ready() {
            self.slots
                .listener
                .stats
                .write_stalls
                .fetch_add(1, Ordering::Relaxed);
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "write stalled",
            )));
        }
        Poll::Pending
    }
}

impl AsyncRead for GuardedIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for GuardedIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match Pin::new(&mut self.inner).poll_write(cx, buf) {
            Poll::Ready(r) => {
                self.progress();
                Poll::Ready(r)
            }
            Poll::Pending => self.poll_stall(cx),
        }
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        match Pin::new(&mut self.inner).poll_write_vectored(cx, bufs) {
            Poll::Ready(r) => {
                self.progress();
                Poll::Ready(r)
            }
            Poll::Pending => self.poll_stall(cx),
        }
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match Pin::new(&mut self.inner).poll_flush(cx) {
            Poll::Ready(r) => {
                self.progress();
                Poll::Ready(r)
            }
            Poll::Pending => self.poll_stall(cx),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Shutdown phases seen by connection tasks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Running,
    /// Finish in-flight requests, close idle connections.
    Draining,
    /// Drop everything now.
    Stop,
}

fn is_transient_accept_error(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::ConnectionRefused
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::Interrupted
    )
}

/// Serves `app` on `listener` until `shutdown` resolves, then drains for at most
/// `limits.drain_timeout`. `on_shutdown` runs as soon as the shutdown begins (it closes live
/// WebSockets).
pub async fn serve(
    state: Arc<Listener>,
    listener: TcpListener,
    app: Router,
    shutdown: impl Future<Output = ()> + Send + 'static,
    on_shutdown: impl FnOnce() + Send + 'static,
) {
    let (phase_tx, phase_rx) = watch::channel(Phase::Running);
    let mut shutdown = std::pin::pin!(shutdown);
    let mut http1 = hyper::server::conn::http1::Builder::new();
    http1
        .timer(TokioTimer::new())
        .header_read_timeout(state.limits.header_read_timeout)
        .keep_alive(true)
        .max_buf_size(state.limits.max_buf_bytes.max(8192))
        .max_headers(state.limits.max_headers.max(16));
    let http1 = Arc::new(http1);
    // Connection tasks still running (HTTP; upgraded WebSockets are owned by the hub).
    let active = Arc::new(AtomicUsize::new(0));
    let accept_backoff = Duration::from_millis(50);
    loop {
        let accepted = tokio::select! {
            biased;
            () = &mut shutdown => break,
            r = listener.accept() => r,
        };
        let (stream, peer) = match accepted {
            Ok(x) => x,
            Err(e) if is_transient_accept_error(&e) => continue,
            Err(e) => {
                // Usually EMFILE / ENFILE: back off instead of spinning.
                state.stats.accept_errors.fetch_add(1, Ordering::Relaxed);
                tracing::warn!(error = %e, "accept failed");
                tokio::time::sleep(accept_backoff).await;
                continue;
            }
        };
        let peer = SocketAddr::new(canonical(peer.ip()), peer.port());
        let Some(slots) = state.admit(peer.ip()) else {
            drop(stream);
            continue;
        };
        let _ = stream.set_nodelay(true);
        let io = GuardedIo {
            inner: stream,
            stall: state.limits.write_stall_timeout,
            stalled: None,
            slots,
        };
        let app = app.clone();
        let http1 = Arc::clone(&http1);
        let mut phase = phase_rx.clone();
        let active = Arc::clone(&active);
        let st = Arc::clone(&state);
        active.fetch_add(1, Ordering::AcqRel);
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |mut req: hyper::Request<Incoming>| {
                req.extensions_mut().insert(ConnectInfo(peer));
                let mut app = app.clone();
                async move { app.call(req).await }
            });
            let conn = http1
                .serve_connection(TokioIo::new(io), svc)
                .with_upgrades();
            let mut conn = std::pin::pin!(conn);
            let mut draining = false;
            let res = loop {
                let current = *phase.borrow_and_update();
                if current == Phase::Stop {
                    st.stats.drain_dropped.fetch_add(1, Ordering::Relaxed);
                    break Ok(());
                }
                if current == Phase::Draining && !draining {
                    draining = true;
                    conn.as_mut().graceful_shutdown();
                }
                tokio::select! {
                    r = conn.as_mut() => break r,
                    changed = phase.changed() => {
                        if changed.is_err() {
                            // The accept loop is gone: treat as stop.
                            break Ok(());
                        }
                    }
                }
            };
            if let Err(e) = res {
                st.stats.errors.fetch_add(1, Ordering::Relaxed);
                tracing::debug!(error = %e, "connection ended with an error");
            }
            active.fetch_sub(1, Ordering::AcqRel);
        });
    }
    drop(listener);
    on_shutdown();
    let _ = phase_tx.send(Phase::Draining);
    let deadline = Instant::now() + state.limits.drain_timeout;
    while active.load(Ordering::Acquire) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let left = active.load(Ordering::Acquire);
    if left > 0 {
        tracing::info!(
            connections = left,
            "drain deadline passed; closing the remaining connections"
        );
    }
    let _ = phase_tx.send(Phase::Stop);
    // Give the tasks a moment to observe Stop and drop their sockets.
    let deadline = Instant::now() + Duration::from_millis(250);
    while active.load(Ordering::Acquire) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::AsyncWriteExt as _;

    use super::*;

    #[tokio::test]
    async fn a_reader_that_stops_reading_is_cut_off() {
        let limits = HttpLimits {
            write_stall_timeout: Duration::from_millis(300),
            ..HttpLimits::default()
        };
        let state = Listener::new(limits, TrustedProxies::none());
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        // The client connects and never reads.
        let client = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (server, peer) = l.accept().await.unwrap();
        let slots = state.admit(peer.ip()).unwrap();
        let mut io = GuardedIo {
            inner: server,
            stall: state.limits.write_stall_timeout,
            stalled: None,
            slots,
        };
        let chunk = vec![0u8; 1 << 20];
        let t0 = Instant::now();
        let err = loop {
            if let Err(e) = io.write_all(&chunk).await {
                break e;
            }
            assert!(t0.elapsed() < Duration::from_secs(20), "never stalled");
        };
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert_eq!(state.stats.write_stalls.load(Ordering::Relaxed), 1);
        assert_eq!(state.open(), 1);
        drop(io);
        assert_eq!(state.open(), 0, "slots are released with the socket");
        drop(client);
    }
}

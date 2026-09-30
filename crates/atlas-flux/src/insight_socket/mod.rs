//! Live client for the Insight explorer's socket.io feed (Engine.IO 3 / socket.io v2).
//!
//! The explorer at `wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket` (and
//! its mirrors) pushes, in the `inv` room:
//!
//! - `block`: the hash of each newly connected block, typically about 1 s after its header
//!   time. This is the fastest new-block signal available.
//! - `tx`: each mempool transaction (and the coinbase at block connect) with its outputs.
//! - `info`: node status plus supply, about once per block.
//! - `markets_info`: price data, occasionally.
//!
//! Layers, bottom up:
//!
//! - [`parse_frame`]: a pure parser from one text frame to a [`Frame`] / typed
//!   [`ChainPush`].
//! - [`InsightSocket`]: one socket that reconnects forever with jittered exponential backoff,
//!   pings at the server's interval, detects ping timeouts and stale block streams, and
//!   publishes [`SocketHealth`] on a watch channel.
//! - [`DualSocket`]: several sockets (main plus mirror by default) merged into one stream,
//!   deduplicated by block hash / txid with a bounded memory ([`Merger`]).
//!
//! TLS uses rustls through tokio-tungstenite, which relies on the process-wide default
//! crypto provider; the crate graph must enable exactly one rustls provider (reqwest's
//! `rustls` feature does).
//!
//! ```no_run
//! # async fn demo() {
//! use atlas_flux::insight_socket::{DualSocket, SocketConfig, SocketMessage};
//! let (socket, mut rx) = DualSocket::spawn(&SocketConfig::default());
//! while let Some(msg) = rx.recv().await {
//!     if let SocketMessage::Event(ev) = msg {
//!         println!("{} {} {}", ev.received_ms, ev.source, ev.push);
//!     }
//! }
//! socket.shutdown().await;
//! # }
//! ```

mod client;
mod config;
mod dual;
mod frame;
mod health;

#[cfg(test)]
mod tests;

pub use client::{ConnState, InsightSocket, SocketEvent, SocketMessage, StateChange};
pub use config::{MAIN_URL, MIRROR_URL, SocketConfig, ZELCORE_URL, endpoint_label};
pub use dual::{DedupeKey, DualSocket, DualStats, Merger, SourceStats, Verdict};
pub use frame::{
    ChainPush, Frame, FrameError, MarketsInfo, OpenInfo, SocketInfo, SocketTx, parse_frame,
};
pub use health::{SocketHealth, Unhealthy};

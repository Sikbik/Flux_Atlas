//! Flux Atlas upstream access: HTTP infrastructure (rate limits, retries, size caps, failover),
//! the SSRF guard for per-node requests, the FluxOS envelope, tolerant typed models and parsers
//! for FluxOS / Insight / stats.runonflux.io / CoinGecko, block decoding, and the Insight
//! socket.io live client.
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod clients;
pub mod decode;
pub mod envelope;
pub mod error;
pub mod http;
pub mod insight_socket;
pub mod lenient;
pub mod models;
pub mod ssrf;
pub mod timefmt;
pub mod txsize;
pub mod upstream;

pub use clients::{
    Clients, ClientsConfig, Conditional, FluxOsClient, FusionClient, InsightClient, MessageFilter,
    NodeApiClient, StatsClient,
};
pub use error::{FluxError, Result};
pub use http::Lane;
pub use ssrf::GuardedEndpoint;

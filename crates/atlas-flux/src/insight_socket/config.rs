//! Configuration for [`super::InsightSocket`] and [`super::DualSocket`].

use std::time::Duration;

/// Primary Insight socket endpoint (explorer.runonflux.io).
pub const MAIN_URL: &str = "wss://explorer.runonflux.io/socket.io/?EIO=3&transport=websocket";
/// Mirror with the same socket endpoint (explorer2.runonflux.io).
pub const MIRROR_URL: &str = "wss://explorer2.runonflux.io/socket.io/?EIO=3&transport=websocket";
/// Second mirror with the same socket endpoint (explorer.flux.zelcore.io).
pub const ZELCORE_URL: &str = "wss://explorer.flux.zelcore.io/socket.io/?EIO=3&transport=websocket";

/// Tunables for the socket clients. [`Default`] gives the values recommended by the research
/// (main plus explorer2, 90 s block staleness, 500 ms to 30 s backoff).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketConfig {
    /// Endpoints [`super::DualSocket`] connects to, in priority order. Each is a full
    /// `ws://` or `wss://` URL including the `/socket.io/?EIO=3&transport=websocket` path.
    pub urls: Vec<String>,
    /// socket.io room to join after connecting (`42["subscribe","<room>"]`).
    pub room: String,
    /// A connected socket that has not delivered a `block` for this long is unhealthy.
    pub block_stale_after: Duration,
    /// Also force a reconnect when the block stream goes stale (at most once per
    /// `block_stale_after`). Health stays unhealthy until a block actually arrives.
    pub reconnect_on_stale: bool,
    /// First reconnect delay (before jitter).
    pub backoff_min: Duration,
    /// Upper bound for the reconnect delay (before jitter).
    pub backoff_max: Duration,
    /// A session that stayed connected this long resets the backoff to `backoff_min`.
    pub backoff_reset_after: Duration,
    /// TCP + TLS + websocket upgrade timeout.
    pub connect_timeout: Duration,
    /// Time allowed from websocket open to the socket.io connect packet (`40`).
    pub handshake_timeout: Duration,
    /// Ping interval used until the server's open packet announces its own.
    pub fallback_ping_interval: Duration,
    /// Ping timeout used until the server's open packet announces its own.
    pub fallback_ping_timeout: Duration,
    /// How often health (block staleness) is re-evaluated while idle.
    pub health_check_every: Duration,
    /// Capacity of the output channel(s). Producers wait when it is full.
    pub channel_capacity: usize,
    /// How many recent ids [`super::DualSocket`] remembers for deduplication.
    pub dedupe_capacity: usize,
    /// `User-Agent` sent with the websocket upgrade request.
    pub user_agent: String,
}

impl Default for SocketConfig {
    fn default() -> Self {
        Self {
            urls: vec![MAIN_URL.to_owned(), MIRROR_URL.to_owned()],
            room: "inv".to_owned(),
            block_stale_after: Duration::from_secs(90),
            reconnect_on_stale: true,
            backoff_min: Duration::from_millis(500),
            backoff_max: Duration::from_secs(30),
            backoff_reset_after: Duration::from_secs(60),
            connect_timeout: Duration::from_secs(10),
            handshake_timeout: Duration::from_secs(10),
            fallback_ping_interval: Duration::from_secs(25),
            fallback_ping_timeout: Duration::from_secs(20),
            health_check_every: Duration::from_secs(1),
            channel_capacity: 1024,
            dedupe_capacity: 4096,
            user_agent: "flux-atlas/0.1 (+https://github.com/Sikbik/Flux_Atlas)".to_owned(),
        }
    }
}

impl SocketConfig {
    /// Default config with a single endpoint.
    pub fn single(url: impl Into<String>) -> Self {
        Self {
            urls: vec![url.into()],
            ..Self::default()
        }
    }
}

/// Short label for an endpoint URL: its authority (host, plus port when given), e.g.
/// `explorer.runonflux.io` or `127.0.0.1:9001`.
pub fn endpoint_label(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let authority = authority.rsplit_once('@').map_or(authority, |(_, a)| a);
    if authority.is_empty() {
        url.to_owned()
    } else {
        authority.to_owned()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(endpoint_label(MAIN_URL), "explorer.runonflux.io");
        assert_eq!(endpoint_label(MIRROR_URL), "explorer2.runonflux.io");
        assert_eq!(endpoint_label(ZELCORE_URL), "explorer.flux.zelcore.io");
        assert_eq!(
            endpoint_label("ws://127.0.0.1:9001/socket.io/"),
            "127.0.0.1:9001"
        );
        assert_eq!(endpoint_label("ws://u:p@host?x"), "host");
        assert_eq!(endpoint_label("weird"), "weird");
    }

    #[test]
    fn defaults() {
        let c = SocketConfig::default();
        assert_eq!(c.urls.len(), 2);
        assert_eq!(c.block_stale_after, Duration::from_secs(90));
        assert_eq!(c.backoff_min, Duration::from_millis(500));
        assert_eq!(c.backoff_max, Duration::from_secs(30));
        assert_eq!(c.dedupe_capacity, 4096);
        assert_eq!(
            SocketConfig::single("ws://x/").urls,
            vec!["ws://x/".to_owned()]
        );
    }
}

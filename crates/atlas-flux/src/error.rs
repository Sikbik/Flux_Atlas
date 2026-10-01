//! Error type shared by all upstream clients.

use std::time::Duration;

use crate::ssrf::SsrfError;

/// Result alias for upstream calls.
pub type Result<T, E = FluxError> = std::result::Result<T, E>;

/// Everything that can go wrong talking to an upstream.
#[derive(Debug, thiserror::Error)]
pub enum FluxError {
    /// Connection, TLS, or protocol failure.
    #[error("transport error for {url}: {message}")]
    Transport { url: String, message: String },
    #[error("timeout after {0:?}")]
    Timeout(Duration),
    /// Non-success HTTP status (other than 429).
    #[error("HTTP {status} from {url}")]
    Status {
        url: String,
        status: u16,
        body_snippet: String,
    },
    #[error("rate limited by upstream (retry after {retry_after:?})")]
    RateLimited { retry_after: Option<Duration> },
    #[error("response exceeds {limit} bytes")]
    TooLarge { limit: usize },
    /// A healthy upstream answered, but the answer is larger than this call accepts (for
    /// example the UTXO set of a very large address). A property of the request, not of the
    /// upstream: not retried, not failed over, and not counted against the circuit breaker.
    #[error("{what}: the answer exceeds {limit} bytes")]
    AnswerTooLarge { what: &'static str, limit: usize },
    /// FluxOS answered `{"status":"error"}` (usually with HTTP 200).
    #[error("upstream error {code:?} {name:?}: {message}")]
    Upstream {
        code: Option<i64>,
        name: Option<String>,
        message: String,
    },
    /// The body did not match the expected shape.
    #[error("parse error in {what}: {message}")]
    Parse { what: &'static str, message: String },
    /// Request refused by the SSRF guard.
    #[error("blocked target: {0}")]
    Blocked(#[from] SsrfError),
    #[error("invalid url: {0}")]
    BadUrl(String),
    /// Every upstream in the failover set is failing or circuit-open.
    #[error("no healthy upstream for {0}")]
    NoHealthyUpstream(&'static str),
}

impl FluxError {
    /// Whether retrying (possibly on another upstream) may help.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Transport { .. } | Self::Timeout(_) | Self::RateLimited { .. } => true,
            Self::Status { status, .. } => *status >= 500,
            // FluxOS daemon errors such as "Block height out of range" are answers, not faults.
            Self::Upstream { .. }
            | Self::TooLarge { .. }
            | Self::AnswerTooLarge { .. }
            | Self::Parse { .. }
            | Self::Blocked(_)
            | Self::BadUrl(_)
            | Self::NoHealthyUpstream(_) => false,
        }
    }

    /// Whether this failure should count against the upstream's health (circuit breaker).
    pub fn is_upstream_fault(&self) -> bool {
        match self {
            Self::Transport { .. }
            | Self::Timeout(_)
            | Self::TooLarge { .. }
            | Self::RateLimited { .. }
            | Self::Parse { .. } => true,
            Self::Status { status, .. } => *status >= 500 || *status == 429,
            Self::Upstream { .. }
            | Self::AnswerTooLarge { .. }
            | Self::Blocked(_)
            | Self::BadUrl(_)
            | Self::NoHealthyUpstream(_) => false,
        }
    }

    /// True for a FluxOS "not found" style daemon error (`code -5` / `-8`).
    pub fn is_not_found(&self) -> bool {
        match self {
            Self::Upstream { code, .. } => matches!(code, Some(-5 | -8)),
            Self::Status { status, .. } => *status == 404,
            _ => false,
        }
    }

    pub(crate) fn parse(what: &'static str, e: &serde_json::Error) -> Self {
        Self::Parse {
            what,
            message: e.to_string(),
        }
    }
}

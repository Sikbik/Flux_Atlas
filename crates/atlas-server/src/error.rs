//! API error type: every failure leaves the server as `{"error":{"code","message"}}` with the
//! matching HTTP status (ARCHITECTURE section 6).

use atlas_core::api::{ApiErrorCode, ApiErrorDto};
use atlas_flux::FluxError;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

/// Result alias for handlers.
pub type ApiResult<T> = Result<T, ApiError>;

/// A request failure with its HTTP status and machine-readable code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: ApiErrorCode,
    pub message: String,
    /// Seconds for a `Retry-After` header (429 / 503).
    pub retry_after_s: Option<u64>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after_s: None,
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, ApiErrorCode::NotFound, message)
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, ApiErrorCode::BadRequest, message)
    }

    /// The upstream answered with something unusable (502).
    pub fn upstream(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, ApiErrorCode::Upstream, message)
    }

    /// The upstream did not answer in time (504).
    pub fn upstream_timeout(message: impl Into<String>) -> Self {
        Self::new(StatusCode::GATEWAY_TIMEOUT, ApiErrorCode::Upstream, message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::Unavailable,
            message,
        )
    }

    pub fn rate_limited(retry_after_s: u64) -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            ApiErrorCode::RateLimited,
            "too many requests to upstream-backed endpoints; slow down",
        )
        .with_retry_after(retry_after_s)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiErrorCode::Internal,
            message,
        )
    }

    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::NOT_IMPLEMENTED,
            ApiErrorCode::NotImplemented,
            message,
        )
    }

    /// A third-party source (Fusion, CoinGecko) failed and nothing earlier is held: 503 when it
    /// could not be reached or asked (timeout, transport, rate limit, open breaker), 502 when it
    /// answered something unusable. Code `upstream_unavailable` either way.
    pub fn third_party(what: &str, e: &FluxError) -> Self {
        let unreachable = matches!(
            e,
            FluxError::Timeout(_)
                | FluxError::Transport { .. }
                | FluxError::RateLimited { .. }
                | FluxError::NoHealthyUpstream(_)
        ) || matches!(e, FluxError::Status { status, .. } if *status >= 500 || *status == 429);
        tracing::debug!(error = %e, what, "third-party source failed");
        if unreachable {
            Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                ApiErrorCode::UpstreamUnavailable,
                format!("{what} is unavailable right now; try again shortly"),
            )
            .with_retry_after(30)
        } else {
            Self::new(
                StatusCode::BAD_GATEWAY,
                ApiErrorCode::UpstreamUnavailable,
                format!("{what} answered something unusable"),
            )
        }
    }

    pub fn with_retry_after(mut self, seconds: u64) -> Self {
        self.retry_after_s = Some(seconds.max(1));
        self
    }

    /// Maps an upstream client error. Upstream "not found" answers become 404; everything else
    /// is reported as an upstream failure without leaking upstream URLs.
    pub fn from_flux(what: &str, e: &FluxError) -> Self {
        match e {
            _ if e.is_not_found() => Self::not_found(format!("{what} not found")),
            FluxError::Status { status: 400, .. } => Self::not_found(format!("{what} not found")),
            FluxError::Timeout(_) => Self::upstream_timeout(format!("upstream timed out ({what})")),
            FluxError::RateLimited { retry_after } => Self::unavailable(format!(
                "upstream is rate limiting us ({what}); try again shortly"
            ))
            .with_retry_after(retry_after.map_or(5, |d| d.as_secs())),
            FluxError::NoHealthyUpstream(_) => {
                Self::unavailable(format!("no healthy upstream for {what}")).with_retry_after(10)
            }
            FluxError::Upstream { message, .. } => {
                Self::upstream(format!("upstream error ({what}): {message}"))
            }
            _ => {
                tracing::debug!(error = %e, what, "upstream failure");
                Self::upstream(format!("upstream request failed ({what})"))
            }
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {:?}: {}", self.status, self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

impl From<atlas_store::StoreError> for ApiError {
    fn from(e: atlas_store::StoreError) -> Self {
        tracing::error!(error = %e, "store read failed");
        Self::internal("storage read failed")
    }
}

impl From<atlas_engine::timemachine::TimeMachineError> for ApiError {
    fn from(e: atlas_engine::timemachine::TimeMachineError) -> Self {
        use atlas_engine::timemachine::TimeMachineError as E;
        match e {
            E::Store(s) => s.into(),
            E::BeforeHistory { .. } | E::TooManyEvents { .. } => Self::new(
                StatusCode::NOT_FOUND,
                ApiErrorCode::NoHistory,
                e.to_string(),
            ),
        }
    }
}

impl From<tokio::task::JoinError> for ApiError {
    fn from(e: tokio::task::JoinError) -> Self {
        tracing::error!(error = %e, "blocking task failed");
        Self::internal("internal task failed")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = serde_json::to_vec(&ApiErrorDto::new(self.code, self.message))
            .unwrap_or_else(|_| br#"{"error":{"code":"internal","message":""}}"#.to_vec());
        let mut resp = (self.status, body).into_response();
        let h = resp.headers_mut();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        if let Some(s) = self.retry_after_s {
            h.insert(header::RETRY_AFTER, HeaderValue::from(s));
        }
        resp
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn flux_mapping() {
        let nf = FluxError::Upstream {
            code: Some(-5),
            name: None,
            message: "x".into(),
        };
        assert_eq!(ApiError::from_flux("tx", &nf).status, StatusCode::NOT_FOUND);
        let e = ApiError::from_flux("tx", &FluxError::Timeout(Duration::from_secs(1)));
        assert_eq!(e.status, StatusCode::GATEWAY_TIMEOUT);
        let e = ApiError::from_flux(
            "tx",
            &FluxError::Status {
                url: "u".into(),
                status: 400,
                body_snippet: String::new(),
            },
        );
        assert_eq!(e.code, ApiErrorCode::NotFound);
        let e = ApiError::from_flux(
            "tx",
            &FluxError::RateLimited {
                retry_after: Some(Duration::from_secs(7)),
            },
        );
        assert_eq!(e.retry_after_s, Some(7));
    }
}

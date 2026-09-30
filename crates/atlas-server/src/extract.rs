//! Extractors whose rejections use the API error shape, plus the client IP.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::extract::{ConnectInfo, FromRequestParts, Path, Query};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

use crate::error::ApiError;
use crate::state::AppState;

/// Longest accepted query string.
pub const MAX_QUERY_LEN: usize = 2048;
/// Longest accepted path parameter.
pub const MAX_PARAM_LEN: usize = 160;

/// Query string extractor; malformed input is a 400 with the API error body.
#[derive(Debug, Clone)]
pub struct Q<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for Q<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        if parts.uri.query().is_some_and(|q| q.len() > MAX_QUERY_LEN) {
            return Err(ApiError::bad_request("query string too long"));
        }
        Query::<T>::try_from_uri(&parts.uri)
            .map(|Query(v)| Self(v))
            .map_err(|e| ApiError::bad_request(format!("invalid query: {}", e.body_text())))
    }
}

/// Path parameter extractor with a length cap.
#[derive(Debug, Clone)]
pub struct P<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned + Send> FromRequestParts<S> for P<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if parts.uri.path().len() > 1024 {
            return Err(ApiError::bad_request("path too long"));
        }
        Path::<T>::from_request_parts(parts, state)
            .await
            .map(|Path(v)| Self(v))
            .map_err(|e| ApiError::bad_request(format!("invalid path: {}", e.body_text())))
    }
}

/// The client's IP: the socket peer, or the right-most `X-Forwarded-For` entry when the server
/// is configured to trust its reverse proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientIp(pub IpAddr);

impl ClientIp {
    pub fn from_parts(parts: &Parts, trust_proxy: bool) -> Self {
        if trust_proxy
            && let Some(ip) = parts
                .headers
                .get_all("x-forwarded-for")
                .iter()
                .filter_map(|v| v.to_str().ok())
                .flat_map(|v| v.split(','))
                .filter_map(|s| s.trim().parse::<IpAddr>().ok())
                .next_back()
        {
            return Self(ip);
        }
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map_or(IpAddr::V4(Ipv4Addr::LOCALHOST), |c| c.0.ip());
        Self(peer)
    }
}

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self::from_parts(parts, state.cfg.trust_proxy))
    }
}

/// Validates a free-form path parameter: non-empty, bounded, printable, no control characters.
pub fn check_param<'a>(name: &str, v: &'a str) -> Result<&'a str, ApiError> {
    let v = v.trim();
    if v.is_empty() {
        return Err(ApiError::bad_request(format!("{name} is empty")));
    }
    if v.len() > MAX_PARAM_LEN {
        return Err(ApiError::bad_request(format!("{name} is too long")));
    }
    if v.chars().any(char::is_control) {
        return Err(ApiError::bad_request(format!(
            "{name} contains control characters"
        )));
    }
    Ok(v)
}

/// Parses a decimal offset cursor (`None` = start).
pub fn offset_cursor(cursor: Option<&str>) -> Result<u32, ApiError> {
    match cursor.map(str::trim).filter(|c| !c.is_empty()) {
        None => Ok(0),
        Some(c) if c.len() <= 9 && c.bytes().all(|b| b.is_ascii_digit()) => c
            .parse()
            .map_err(|_| ApiError::bad_request("invalid cursor")),
        Some(_) => Err(ApiError::bad_request("invalid cursor")),
    }
}

/// Page size: `default` when absent, 400 when out of `1..=max`.
pub fn page_limit(limit: Option<u32>, default: u32, max: u32) -> Result<u32, ApiError> {
    match limit {
        None => Ok(default),
        Some(n) if (1..=max).contains(&n) => Ok(n),
        Some(_) => Err(ApiError::bad_request(format!("limit must be 1..={max}"))),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::Request;

    use super::*;

    #[test]
    fn forwarded_for() {
        let (parts, ()) = Request::builder()
            .header("x-forwarded-for", "10.0.0.1, 203.0.113.9")
            .body(())
            .unwrap()
            .into_parts();
        assert_eq!(
            ClientIp::from_parts(&parts, true).0,
            "203.0.113.9".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            ClientIp::from_parts(&parts, false).0,
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        );
    }

    #[test]
    fn cursors_and_limits() {
        assert_eq!(offset_cursor(None).unwrap(), 0);
        assert_eq!(offset_cursor(Some("40")).unwrap(), 40);
        assert!(offset_cursor(Some("-1")).is_err());
        assert!(offset_cursor(Some("9999999999")).is_err());
        assert_eq!(page_limit(None, 10, 50).unwrap(), 10);
        assert!(page_limit(Some(0), 10, 50).is_err());
        assert!(page_limit(Some(51), 10, 50).is_err());
        assert!(check_param("x", "  ").is_err());
        assert!(check_param("x", &"a".repeat(200)).is_err());
        assert!(check_param("x", "a\u{1}").is_err());
    }
}

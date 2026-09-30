//! Response bodies: content negotiation (br / zstd / gzip / identity), strong ETags with
//! `304 Not Modified`, `Vary: Accept-Encoding` and `Cache-Control`.
//!
//! - [`respond_prebuilt`] serves the engine's [`PrebuiltBody`] (already compressed once per
//!   publish): the hot path does no serialization and no compression.
//! - [`CachedBody`] is a body the server derives itself (analytics, fallbacks, static files):
//!   serialized once, compressed lazily once per encoding, then shared.
//! - [`json_response`] serializes a per-request value, hashes it for the ETag and compresses it
//!   with fast settings when it is large enough to matter.

use std::io::Write as _;
use std::sync::OnceLock;

use atlas_engine::{Encoding, PrebuiltBody};
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde::Serialize;

/// `Cache-Control` policies.
pub mod cache {
    /// Snapshot bodies that change on every publish: always revalidate (cheap with the ETag).
    pub const HOT: &str = "public, no-cache";
    /// Derived views of the published state.
    pub const DERIVED: &str = "public, max-age=5";
    /// Store-backed history (payments, events).
    pub const HISTORY: &str = "public, max-age=10";
    /// Explorer data near the tip (confirmations still change).
    pub const EXPLORER_RECENT: &str = "public, max-age=10";
    /// Explorer data beyond the finality window.
    pub const EXPLORER_DEEP: &str = "public, max-age=300";
    /// Slow-moving upstream aggregates (rich list, supply).
    pub const SLOW: &str = "public, max-age=60";
    /// Hashed static assets.
    pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
    /// Documents that must revalidate (index.html).
    pub const REVALIDATE: &str = "no-cache";
    pub const NO_STORE: &str = "no-store";
}

/// Bodies below this size are served uncompressed.
pub const MIN_COMPRESS_BYTES: usize = 1024;

const BROTLI_QUALITY: u32 = 5;
const BROTLI_WINDOW: u32 = 22;
const GZIP_LEVEL: u32 = 6;
const ZSTD_LEVEL: i32 = 3;

pub const JSON: &str = "application/json";

/// Compresses `raw` with `enc`; `None` for identity or on (practically impossible) failure.
pub fn compress(enc: Encoding, raw: &[u8]) -> Option<Bytes> {
    let out = match enc {
        Encoding::Identity => return None,
        Encoding::Brotli => {
            let mut out = Vec::with_capacity(raw.len() / 3 + 64);
            {
                let mut w = brotli::CompressorWriter::new(
                    &mut out,
                    32 * 1024,
                    BROTLI_QUALITY,
                    BROTLI_WINDOW,
                );
                w.write_all(raw).ok()?;
                w.flush().ok()?;
            }
            out
        }
        Encoding::Gzip => {
            let mut w = flate2::write::GzEncoder::new(
                Vec::with_capacity(raw.len() / 3 + 64),
                flate2::Compression::new(GZIP_LEVEL),
            );
            w.write_all(raw).ok()?;
            w.finish().ok()?
        }
        Encoding::Zstd => zstd::bulk::compress(raw, ZSTD_LEVEL).ok()?,
    };
    Some(Bytes::from(out))
}

/// Strong, content-derived ETag (quoted).
pub fn etag_for(raw: &[u8]) -> String {
    let h = blake3::hash(raw);
    format!("\"{}\"", &h.to_hex()[..32])
}

/// True when an `If-None-Match` header value matches `etag` (weak comparison, `*` matches).
pub fn etag_matches(if_none_match: &str, etag: &str) -> bool {
    if_none_match
        .split(',')
        .map(str::trim)
        .any(|t| t == "*" || t.strip_prefix("W/").unwrap_or(t) == etag)
}

fn if_none_match(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
}

fn accept_encoding(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
}

fn not_modified(etag: HeaderValue, cache_control: &'static str) -> Response {
    let mut r = StatusCode::NOT_MODIFIED.into_response();
    let h = r.headers_mut();
    h.insert(header::ETAG, etag);
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    h.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    r
}

fn full(
    bytes: Bytes,
    content_type: HeaderValue,
    encoding: Encoding,
    etag: HeaderValue,
    cache_control: &'static str,
) -> Response {
    let mut r = Response::new(Body::from(bytes));
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, content_type);
    h.insert(header::ETAG, etag);
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    h.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    if let Some(v) = encoding.header_value() {
        h.insert(header::CONTENT_ENCODING, HeaderValue::from_static(v));
    }
    r
}

fn header_value(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap_or_else(|_| HeaderValue::from_static("\"invalid\""))
}

/// Serves an engine-prebuilt body: negotiation, ETag, 304.
pub fn respond_prebuilt(
    headers: &HeaderMap,
    body: &PrebuiltBody,
    cache_control: &'static str,
) -> Response {
    let etag = header_value(&body.etag);
    if if_none_match(headers).is_some_and(|inm| body.matches_if_none_match(inm)) {
        return not_modified(etag, cache_control);
    }
    let (enc, mut bytes) = body.select(accept_encoding(headers));
    let mut enc = enc;
    // A publisher may leave an encoding empty; fall back to identity rather than send nothing.
    if bytes.is_empty() && !body.raw.is_empty() {
        enc = Encoding::Identity;
        bytes = &body.raw;
    }
    full(
        bytes.clone(),
        HeaderValue::from_static(body.content_type),
        enc,
        etag,
        cache_control,
    )
}

/// A server-derived body: serialized once, each encoding compressed at most once on demand.
#[derive(Debug)]
pub struct CachedBody {
    content_type: HeaderValue,
    raw: Bytes,
    etag: HeaderValue,
    etag_str: String,
    br: OnceLock<Option<Bytes>>,
    gzip: OnceLock<Option<Bytes>>,
    zstd: OnceLock<Option<Bytes>>,
}

impl CachedBody {
    pub fn new(content_type: &str, raw: impl Into<Bytes>) -> Self {
        let raw: Bytes = raw.into();
        let etag_str = etag_for(&raw);
        Self {
            content_type: header_value(content_type),
            etag: header_value(&etag_str),
            etag_str,
            raw,
            br: OnceLock::new(),
            gzip: OnceLock::new(),
            zstd: OnceLock::new(),
        }
    }

    /// JSON body of `value`.
    pub fn json<T: Serialize>(value: &T) -> Self {
        Self::new(JSON, to_json_vec(value))
    }

    pub fn raw(&self) -> &Bytes {
        &self.raw
    }

    pub fn etag(&self) -> &str {
        &self.etag_str
    }

    /// Bytes for `enc`, compressing on first use. Falls back to identity for small bodies.
    pub fn encoded(&self, enc: Encoding) -> (Encoding, Bytes) {
        if self.raw.len() < MIN_COMPRESS_BYTES {
            return (Encoding::Identity, self.raw.clone());
        }
        let slot = match enc {
            Encoding::Identity => return (Encoding::Identity, self.raw.clone()),
            Encoding::Brotli => &self.br,
            Encoding::Gzip => &self.gzip,
            Encoding::Zstd => &self.zstd,
        };
        match slot.get_or_init(|| compress(enc, &self.raw)) {
            Some(b) => (enc, b.clone()),
            None => (Encoding::Identity, self.raw.clone()),
        }
    }

    /// Full response with negotiation and ETag handling.
    pub fn respond(&self, headers: &HeaderMap, cache_control: &'static str) -> Response {
        if if_none_match(headers).is_some_and(|inm| etag_matches(inm, &self.etag_str)) {
            return not_modified(self.etag.clone(), cache_control);
        }
        let (enc, bytes) = self.encoded(Encoding::negotiate(accept_encoding(headers)));
        full(
            bytes,
            self.content_type.clone(),
            enc,
            self.etag.clone(),
            cache_control,
        )
    }
}

/// Serializes plain data; serialization of our DTOs cannot fail, but never panic on it.
pub fn to_json_vec<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap_or_else(|e| {
        tracing::error!(error = %e, "json serialization failed");
        b"null".to_vec()
    })
}

/// Per-request JSON response with ETag, 304 and fast compression.
pub fn json_response<T: Serialize>(
    headers: &HeaderMap,
    value: &T,
    cache_control: &'static str,
) -> Response {
    CachedBody::json(value).respond(headers, cache_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decompress(enc: Encoding, b: &[u8]) -> Vec<u8> {
        use std::io::Read as _;
        let mut out = Vec::new();
        match enc {
            Encoding::Identity => out.extend_from_slice(b),
            Encoding::Brotli => {
                brotli::Decompressor::new(b, 4096)
                    .read_to_end(&mut out)
                    .unwrap();
            }
            Encoding::Gzip => {
                flate2::read::GzDecoder::new(b)
                    .read_to_end(&mut out)
                    .unwrap();
            }
            Encoding::Zstd => out = zstd::stream::decode_all(b).unwrap(),
        }
        out
    }

    #[test]
    fn cached_body_encodings_round_trip() {
        let v: Vec<u32> = (0..5000).collect();
        let body = CachedBody::json(&v);
        for enc in [
            Encoding::Identity,
            Encoding::Brotli,
            Encoding::Gzip,
            Encoding::Zstd,
        ] {
            let (got, bytes) = body.encoded(enc);
            assert_eq!(got, enc);
            assert_eq!(decompress(enc, &bytes), body.raw().to_vec());
        }
        let small = CachedBody::json(&1u8);
        assert_eq!(small.encoded(Encoding::Zstd).0, Encoding::Identity);
    }

    #[test]
    fn etag_match_forms() {
        let e = etag_for(b"x");
        assert!(etag_matches(&e, &e));
        assert!(etag_matches(&format!("W/{e}"), &e));
        assert!(etag_matches("\"a\", *", &e));
        assert!(!etag_matches("\"a\"", &e));
    }
}

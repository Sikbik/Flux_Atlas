//! The embedded web app (`web/dist`): SPA fallback to `index.html` for non-API GETs, immutable
//! caching for hashed assets, correct MIME types, ETag/304 and compression. Without the
//! `embed-web` feature, or with an empty dist directory, a placeholder page is served.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};

use crate::body::{CachedBody, cache};
use crate::error::ApiError;

#[cfg(feature = "embed-web")]
#[derive(rust_embed::RustEmbed)]
#[folder = "../../web/dist"]
#[allow_missing = true]
struct Dist;

/// Raw bytes of an embedded asset.
fn asset(path: &str) -> Option<Vec<u8>> {
    #[cfg(feature = "embed-web")]
    {
        Dist::get(path).map(|f| f.data.into_owned())
    }
    #[cfg(not(feature = "embed-web"))]
    {
        let _ = path;
        None
    }
}

const PLACEHOLDER: &str = "<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>Flux Atlas</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070d;color:#d7e0ee;font:16px/1.5 system-ui,sans-serif}main{max-width:36rem;padding:2rem}a{color:#7cc4ff}code{color:#9fe7c4}</style>
</head><body><main>
<h1>Flux Atlas</h1>
<p>The API server is running, but this build does not include the web app.</p>
<p>Build it with <code>npm run build</code> in <code>web/</code> and rebuild the server, or use the API directly:
<a href=\"/api/v1/bootstrap\">/api/v1/bootstrap</a>, <a href=\"/api/v1/network/summary\">/api/v1/network/summary</a>, <a href=\"/healthz\">/healthz</a>.</p>
</main></body></html>
";

fn cached(
    path: &str,
    content_type: &str,
    load: impl FnOnce() -> Option<Vec<u8>>,
) -> Option<Arc<CachedBody>> {
    static BODIES: OnceLock<Mutex<HashMap<String, Arc<CachedBody>>>> = OnceLock::new();
    let map = BODIES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(b) = map
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
    {
        return Some(Arc::clone(b));
    }
    let body = Arc::new(CachedBody::new(content_type, load()?));
    map.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(path.to_owned(), Arc::clone(&body));
    Some(body)
}

/// Content type by extension (UTF-8 for text types).
pub fn content_type(path: &str) -> String {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let s = mime.essence_str().to_owned();
    if s.starts_with("text/")
        || s == "application/javascript"
        || s == "application/json"
        || s == "image/svg+xml"
    {
        format!("{s}; charset=utf-8")
    } else {
        s
    }
}

/// True for Vite's content-hashed build outputs (`assets/name-<hash>.ext`).
pub fn is_hashed_asset(path: &str) -> bool {
    let Some(file) = path.strip_prefix("assets/") else {
        return false;
    };
    let stem = file.rsplit_once('.').map_or(file, |(s, _)| s);
    stem.rsplit_once(['-', '.']).is_some_and(|(_, h)| {
        h.len() >= 8 && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    })
}

fn index(headers: &HeaderMap) -> Response {
    let body = cached("index.html", "text/html; charset=utf-8", || {
        asset("index.html")
    })
    .or_else(|| {
        cached("\0placeholder", "text/html; charset=utf-8", || {
            Some(PLACEHOLDER.as_bytes().to_vec())
        })
    });
    match body {
        Some(b) => b.respond(headers, cache::REVALIDATE),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Fallback handler for everything outside `/api`, `/ws` and the ops routes.
pub async fn serve(method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if method != Method::GET && method != Method::HEAD {
        let mut r = StatusCode::METHOD_NOT_ALLOWED.into_response();
        r.headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return r;
    }
    let path = uri.path().trim_start_matches('/');
    if path == "api" || path.starts_with("api/") {
        return ApiError::not_found("no such API endpoint").into_response();
    }
    if path.split('/').any(|seg| seg == ".." || seg.contains('\\')) || path.len() > 512 {
        return ApiError::bad_request("invalid path").into_response();
    }
    if path.is_empty() || path == "index.html" {
        return index(&headers);
    }
    let ct = content_type(path);
    if let Some(b) = cached(path, &ct, || asset(path)) {
        let policy = if is_hashed_asset(path) {
            cache::IMMUTABLE
        } else {
            "public, max-age=3600"
        };
        return b.respond(&headers, policy);
    }
    // Missing files 404; anything else is a client-side route.
    let last = path.rsplit('/').next().unwrap_or(path);
    if last.contains('.') {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    index(&headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashed_assets_and_types() {
        assert!(is_hashed_asset("assets/index-B9InpKTW.js"));
        assert!(is_hashed_asset("assets/vendor.3f9a1c2b.css"));
        assert!(!is_hashed_asset("assets/logo.svg"));
        assert!(!is_hashed_asset("favicon.ico"));
        assert_eq!(content_type("a.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("a.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("a.wasm"), "application/wasm");
        assert_eq!(content_type("a.woff2"), "font/woff2");
    }
}

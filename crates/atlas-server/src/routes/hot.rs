//! Hot snapshot bodies: served straight from the engine's prebuilt, pre-compressed bodies.
//! When the engine has not built a body yet, the server derives one from the published state
//! once per publish.

use std::sync::Arc;

use atlas_core::codec::mesh_bin::encode_mesh_bin_from;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;

use crate::body::{CachedBody, cache, respond_prebuilt};
use crate::state::AppState;
use crate::views::{apps_index_dto, bootstrap_dto, nodes_bin};

const OCTET: &str = "application/octet-stream";

/// `GET /bootstrap`.
pub async fn bootstrap(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let p = s.engine.published();
    if let Some(b) = &p.bodies.bootstrap {
        return respond_prebuilt(&headers, b, cache::HOT);
    }
    let v = s.views();
    let body = v
        .bootstrap
        .get_or_init(|| Arc::new(CachedBody::json(&bootstrap_dto(&v))));
    body.respond(&headers, cache::HOT)
}

/// `GET /nodes.bin`.
pub async fn nodes(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let p = s.engine.published();
    if let Some(b) = &p.bodies.nodes_bin {
        return respond_prebuilt(&headers, b, cache::HOT);
    }
    let v = s.views();
    let body = v
        .nodes_bin
        .get_or_init(|| Arc::new(CachedBody::new(OCTET, nodes_bin(&v.published))));
    body.respond(&headers, cache::HOT)
}

/// `GET /mesh.bin`. Without a prebuilt body, an empty mesh stamped with the current seq.
pub async fn mesh(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let p = s.engine.published();
    if let Some(b) = &p.bodies.mesh_bin {
        return respond_prebuilt(&headers, b, cache::HOT);
    }
    let body = CachedBody::new(
        OCTET,
        encode_mesh_bin_from(
            p.seq,
            p.generated_ms,
            [],
            Some(atlas_engine::origin_of(&p.server)),
        ),
    );
    body.respond(&headers, cache::HOT)
}

/// `GET /apps`.
pub async fn apps(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let p = s.engine.published();
    if let Some(b) = &p.bodies.apps_index {
        return respond_prebuilt(&headers, b, cache::HOT);
    }
    let v = s.views();
    let body = v
        .apps_index
        .get_or_init(|| Arc::new(CachedBody::json(&apps_index_dto(&v.published))));
    body.respond(&headers, cache::HOT)
}

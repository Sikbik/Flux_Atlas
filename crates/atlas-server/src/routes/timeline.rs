//! Time machine: snapshot index, and the node set at any `t` (nearest keyframe + event replay).

use std::sync::Arc;

use atlas_core::api::TimelineDto;
use atlas_core::now_ms;
use atlas_store::meta_keys;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{CachedBody, cache, json_response};
use crate::error::{ApiError, ApiResult};
use crate::extract::Q;
use crate::state::AppState;

/// `GET /timeline`: recorded history bounds and snapshot keyframes.
pub async fn index(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let dto = s
        .store_read(|st| {
            let keyframes_ms = st.snapshot_times()?;
            let first = st.meta_u64(meta_keys::FIRST_INGEST_MS)?;
            let last_event = st.latest_events(1)?.first().map(|(k, _)| k.ts_ms);
            let event_count = st
                .table_counts()?
                .into_iter()
                .find(|(name, _)| *name == "events")
                .map_or(0, |(_, n)| n);
            Ok(TimelineDto {
                first_ms: first.or_else(|| keyframes_ms.first().copied()),
                last_ms: last_event.max(keyframes_ms.last().copied()),
                keyframes_ms,
                event_count,
            })
        })
        .await?;
    Ok(json_response(&headers, &dto, cache::HISTORY))
}

#[derive(Debug, Deserialize)]
pub struct StateQuery {
    pub t: Option<u64>,
}

/// `GET /timeline/state?t=` (binary, `nodes.bin` format v1, section 7).
///
/// The node set at `t` reconstructed by `atlas_engine::timemachine::state_at`. The header's
/// `generated_ms` is `t` and its `seq` is 0 (a historical state has no live position), so the
/// ETag is stable for a given `t`. Columns the keyframes do not record (rank, hardware, apps,
/// versions) are zero.
pub async fn state(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<StateQuery>,
) -> ApiResult<Response> {
    let t =
        q.t.ok_or_else(|| ApiError::bad_request("t is required (unix ms)"))?;
    if t > now_ms() + 60_000 {
        return Err(ApiError::bad_request("t is in the future"));
    }
    let body = if let Some(b) = s.timeline_cache.get(&t).await {
        b
    } else {
        let b = s
            .store_read(move |st| {
                let state = atlas_engine::timemachine::state_at(st, t)?;
                tracing::debug!(
                    t,
                    snapshot_ms = state.snapshot_ms,
                    replayed = state.replayed,
                    nodes = state.nodes.len(),
                    "time machine reconstruction"
                );
                Ok(Arc::new(CachedBody::new(
                    "application/octet-stream",
                    state.to_nodes_bin(0),
                )))
            })
            .await?;
        s.timeline_cache.insert(t, Arc::clone(&b)).await;
        b
    };
    Ok(body.respond(&headers, cache::HISTORY))
}

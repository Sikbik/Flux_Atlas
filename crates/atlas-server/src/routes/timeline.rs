//! Time machine: snapshot index, and state at `t` (pending the engine's reconstruction).

use atlas_core::api::TimelineDto;
use atlas_core::now_ms;
use atlas_store::meta_keys;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{cache, json_response};
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

/// `GET /timeline/state?t=` (binary, `nodes.bin` format).
pub async fn state(Q(q): Q<StateQuery>) -> ApiResult<Response> {
    let t =
        q.t.ok_or_else(|| ApiError::bad_request("t is required (unix ms)"))?;
    if t > now_ms() + 60_000 {
        return Err(ApiError::bad_request("t is in the future"));
    }
    // INTEGRATION: reconstruct with the engine's `timemachine::state_at(store, t)`, encode the
    // result with `encode_nodes_bin`, and serve it through `CachedBody` (cache per keyframe).
    Err(ApiError::not_implemented(
        "time machine state reconstruction is not available yet",
    ))
}

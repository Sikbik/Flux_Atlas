//! Time machine: snapshot index, and the node set at any `t` (nearest keyframe + event replay).

use std::sync::Arc;

use atlas_core::api::TimelineDto;
use atlas_core::now_ms;
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
            let last_event = st.latest_events(1)?.first().map(|(k, _)| k.ts_ms);
            let event_count = st
                .table_counts()?
                .into_iter()
                .find(|(name, _)| *name == "events")
                .map_or(0, |(_, n)| n);
            // The earliest time with a whole network state is the first keyframe (L14);
            // before it `/timeline/state` answers `no_history`.
            Ok(TimelineDto {
                first_ms: keyframes_ms.first().copied(),
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

/// Resolution of `/timeline/state` within a day of now: requests are floored to it.
pub const STATE_QUANTUM_RECENT_MS: u64 = 10_000;
/// Resolution further back.
pub const STATE_QUANTUM_MS: u64 = 60_000;

/// The instant a request for `t` is answered for: floored to 10 s within a day of `now`, to a
/// minute before that. Distinct `t` values then share a reconstruction and a cache entry.
pub fn quantize(t: u64, now: u64) -> u64 {
    let q = if now.saturating_sub(t) <= 86_400_000 {
        STATE_QUANTUM_RECENT_MS
    } else {
        STATE_QUANTUM_MS
    };
    t - t % q
}

/// `GET /timeline/state?t=` (binary, `nodes.bin` format v1, section 7).
///
/// The node set at `t` reconstructed by `atlas_engine::timemachine::state_at`, with `t` floored
/// to [`STATE_QUANTUM_RECENT_MS`] within a day of now and to [`STATE_QUANTUM_MS`] before
/// ([`quantize`]). The header's `generated_ms` is that instant and its `seq` is 0 (a historical
/// state has no live position), so the ETag is stable for it. Concurrent requests for one
/// instant share a single reconstruction. Columns the keyframes do not record are left out. A
/// `t` before the first keyframe, or one more than 50,000 events after the nearest keyframe,
/// answers 404 `no_history` (L14). The file carries this server's ORIGIN.
pub async fn state(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<StateQuery>,
) -> ApiResult<Response> {
    let t =
        q.t.ok_or_else(|| ApiError::bad_request("t is required (unix ms)"))?;
    let now = now_ms();
    if t > now + 60_000 {
        return Err(ApiError::bad_request("t is in the future"));
    }
    let t = quantize(t, now);
    let st = s.clone();
    let origin = s.engine.origin();
    let body = s
        .timeline_cache
        .try_get_with(t, async move {
            st.store_read(move |store| {
                let state = atlas_engine::timemachine::state_at(store, t)?;
                tracing::debug!(
                    t,
                    snapshot_ms = state.snapshot_ms,
                    replayed = state.replayed,
                    nodes = state.nodes.len(),
                    "time machine reconstruction"
                );
                Ok(Arc::new(CachedBody::new(
                    "application/octet-stream",
                    state.to_nodes_bin_from(0, Some(origin)),
                )))
            })
            .await
        })
        .await
        .map_err(|e| (*e).clone())?;
    Ok(body.respond(&headers, cache::HISTORY))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantization() {
        let now = 1_000 * 86_400_000;
        assert_eq!(quantize(now - 12_345, now), now - 20_000);
        assert_eq!(quantize(now - 10_000, now), now - 10_000);
        let old = now - 3 * 86_400_000 - 59_999;
        assert_eq!(quantize(old, now), now - 3 * 86_400_000 - 60_000);
        assert_eq!(quantize(old + 1, now) % STATE_QUANTUM_MS, 0);
    }
}

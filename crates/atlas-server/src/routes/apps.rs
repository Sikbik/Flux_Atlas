//! App detail and spec history (the index is a hot body, see `hot.rs`).

use atlas_core::api::{
    AppChangeKind, AppDetailDto, AppHistoryDto, AppHistoryEntry, AppInstanceDto,
};
use atlas_core::event::AppMessageKind;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;

use crate::body::{cache, json_response};
use crate::error::{ApiError, ApiResult};
use crate::extract::P;
use crate::state::AppState;

/// Validates and lowercases an app name.
pub fn app_key(name: &str) -> Result<String, ApiError> {
    let n = name.trim();
    if n.is_empty() || n.len() > 64 {
        return Err(ApiError::bad_request("app name must be 1..=64 characters"));
    }
    if !n
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
    {
        return Err(ApiError::bad_request("app name has invalid characters"));
    }
    Ok(n.to_ascii_lowercase())
}

/// `GET /apps/{name}`.
pub async fn detail(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(name): P<String>,
) -> ApiResult<Response> {
    let key = app_key(&name)?;
    let rec = s
        .store_read(move |st| Ok(st.app(&key)?))
        .await?
        .ok_or_else(|| ApiError::not_found(format!("no app named {name}")))?;
    let v = s.views();
    let instances = rec
        .locations
        .iter()
        .map(|l| {
            let node = l
                .node
                .or_else(|| v.index.by_endpoint(&l.endpoint).map(|i| v.at(i).id));
            let r = node.and_then(|id| v.node_ref(id));
            AppInstanceDto {
                node,
                endpoint: l.endpoint.to_string(),
                spec_hash: l.spec_hash,
                running_since_ms: l.running_since_ms,
                broadcast_ms: l.broadcast_ms,
                lat: r.as_ref().and_then(|r| r.lat),
                lon: r.as_ref().and_then(|r| r.lon),
                country_code: r.and_then(|r| r.country_code),
            }
        })
        .collect();
    let dto = AppDetailDto {
        name: rec.name,
        display_name: rec.display_name,
        spec: rec.spec,
        spec_hash: rec.spec_hash,
        height: rec.height,
        registered_height: rec.registered_height,
        expire_height: rec.expire_height,
        totals: rec.totals,
        instances,
        first_seen_ms: rec.first_seen_ms,
        updated_ms: rec.updated_ms,
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

/// `GET /apps/{name}/history`: every permanent message with the fields it changed.
pub async fn history(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(name): P<String>,
) -> ApiResult<Response> {
    let key = app_key(&name)?;
    let k2 = key.clone();
    let (msgs, exists) = s
        .store_read(move |st| Ok((st.app_messages_for_app(&k2)?, st.app(&k2)?.is_some())))
        .await?;
    if msgs.is_empty() && !exists {
        return Err(ApiError::not_found(format!("no app named {name}")));
    }
    let mut entries = Vec::with_capacity(msgs.len());
    for (i, m) in msgs.iter().enumerate() {
        let prev = i.checked_sub(1).map(|j| &msgs[j].spec);
        let changed = prev.map(|p| p.diff(&m.spec)).unwrap_or_default();
        let kind = match (i, m.kind) {
            (0, _) | (_, AppMessageKind::Register) => AppChangeKind::Registered,
            _ if changed.is_empty() || changed.iter().all(|c| c.starts_with("expire")) => {
                AppChangeKind::Renewed
            }
            _ => AppChangeKind::Updated,
        };
        entries.push(AppHistoryEntry {
            height: m.height,
            time_ms: (m.timestamp_ms > 0).then_some(m.timestamp_ms),
            kind,
            spec_hash: Some(m.hash),
            spec_version: m.spec.spec_version,
            changed,
            paid: Some(m.paid),
        });
    }
    let dto = AppHistoryDto { name: key, entries };
    Ok(json_response(&headers, &dto, cache::HISTORY))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(app_key("FluxApp1").unwrap(), "fluxapp1");
        assert!(app_key("").is_err());
        assert!(app_key("a/b").is_err());
        assert!(app_key(&"a".repeat(65)).is_err());
    }
}

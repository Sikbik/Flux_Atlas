//! Network analytics (computed once per publish) and metrics time series (from the store).

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use atlas_core::api::MetricsSeriesDto;
use atlas_core::now_ms;
use atlas_store::{HOUR_MS, MINUTE_MS, MetricsRow, Resolution};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{CachedBody, cache};
use crate::error::{ApiError, ApiResult};
use crate::extract::Q;
use crate::state::AppState;
use crate::views::{Views, analytics};

fn derived(
    s: &AppState,
    headers: &HeaderMap,
    pick: fn(&Views) -> &OnceLock<Arc<CachedBody>>,
    build: fn(&Views) -> CachedBody,
) -> Response {
    let v = s.views();
    let body = pick(&v).get_or_init(|| Arc::new(build(&v)));
    body.respond(headers, cache::DERIVED)
}

/// `GET /network/summary`.
pub async fn summary(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.summary,
        |v| CachedBody::json(&v.published.network),
    )
}

/// `GET /network/geo`.
pub async fn geo(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.geo,
        |v| CachedBody::json(&analytics::geo(v.nodes())),
    )
}

/// `GET /network/providers` (grouped by ASN).
pub async fn providers(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.providers,
        |v| CachedBody::json(&analytics::providers(v.nodes())),
    )
}

/// `GET /network/versions`.
pub async fn versions(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.versions,
        |v| CachedBody::json(&analytics::versions(v.nodes())),
    )
}

/// `GET /network/capacity`.
pub async fn capacity(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.capacity,
        |v| CachedBody::json(&analytics::capacity(&v.published)),
    )
}

/// `GET /network/decentralization`.
pub async fn decentralization(State(s): State<AppState>, headers: HeaderMap) -> Response {
    derived(
        &s,
        &headers,
        |v| &v.decentralization,
        |v| CachedBody::json(&analytics::decentralization(v.nodes())),
    )
}

// ---------------------------------------------------------------------------------------------
// GET /metrics?series=a,b&from&to&step
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Agg {
    /// Gauge: last known sample in the bucket.
    Last,
    /// Counter: sum of the known samples in the bucket.
    Sum,
    /// Average: mean over the samples that carry a value.
    Mean,
}

/// Projects one series out of a row; `None` = not recorded (served as `null`, never 0).
type Getter = fn(&MetricsRow) -> Option<f64>;

/// Series names accepted by `/metrics`, with their aggregation (0 gauge, 1 counter, 2 mean).
pub const SERIES: &[(&str, u8)] = &[
    ("tip_height", 0),
    ("node_count", 0),
    ("cumulus", 0),
    ("nimbus", 0),
    ("stratus", 0),
    ("host_count", 0),
    ("country_count", 0),
    ("provider_count", 0),
    ("arcane_count", 0),
    ("unreachable_count", 0),
    ("at_risk_count", 0),
    ("started_count", 0),
    ("dos_count", 0),
    ("app_count", 0),
    ("instance_count", 0),
    ("pending_app_count", 0),
    ("total_cores", 0),
    ("total_ram_gb", 0),
    ("total_storage_gb", 0),
    ("total_ssd_gb", 0),
    ("locked_cores", 0),
    ("locked_ram_gb", 0),
    ("locked_storage_gb", 0),
    ("supply_flux_f64", 0),
    ("price_usd", 0),
    ("mempool_size", 0),
    ("mesh_edge_count", 0),
    ("block_count", 1),
    ("tx_count", 1),
    ("node_tx_count", 1),
    ("fees_flux_f64", 1),
    ("payouts_flux_f64", 1),
    ("avg_block_time_ms", 2),
];

fn u(v: Option<u32>) -> Option<f64> {
    v.map(f64::from)
}

fn getter(name: &str) -> Option<(Agg, Getter)> {
    let g: Getter = match name {
        "tip_height" => |r| u(r.tip_height),
        "node_count" => |r| u(r.node_count),
        "cumulus" => |r| r.tier_counts.map(|c| f64::from(c[0])),
        "nimbus" => |r| r.tier_counts.map(|c| f64::from(c[1])),
        "stratus" => |r| r.tier_counts.map(|c| f64::from(c[2])),
        "host_count" => |r| u(r.host_count),
        "country_count" => |r| u(r.country_count),
        "provider_count" => |r| u(r.provider_count),
        "arcane_count" => |r| u(r.arcane_count),
        "unreachable_count" => |r| u(r.unreachable_count),
        "at_risk_count" => |r| u(r.at_risk_count),
        "started_count" => |r| u(r.started_count),
        "dos_count" => |r| u(r.dos_count),
        "app_count" => |r| u(r.app_count),
        "instance_count" => |r| u(r.instance_count),
        "pending_app_count" => |r| u(r.pending_app_count),
        "total_cores" => |r| u(r.total_cores),
        "total_ram_gb" => |r| r.total_ram_gb.map(|v| v as f64),
        "total_storage_gb" => |r| r.total_storage_gb.map(|v| v as f64),
        "total_ssd_gb" => |r| r.total_ssd_gb.map(|v| v as f64),
        "locked_cores" => |r| r.locked_cores,
        "locked_ram_gb" => |r| r.locked_ram_gb,
        "locked_storage_gb" => |r| r.locked_storage_gb,
        "supply_flux_f64" => |r| r.supply.map(atlas_core::Amount::to_flux_f64),
        "price_usd" => |r| r.price_usd,
        "mempool_size" => |r| u(r.mempool_size),
        "mesh_edge_count" => |r| u(r.mesh_edge_count),
        "block_count" => |r| u(r.block_count),
        "tx_count" => |r| u(r.tx_count),
        "node_tx_count" => |r| u(r.node_tx_count),
        "fees_flux_f64" => |r| r.fees.map(atlas_core::Amount::to_flux_f64),
        "payouts_flux_f64" => |r| r.payouts.map(atlas_core::Amount::to_flux_f64),
        "avg_block_time_ms" => |r| u(r.avg_block_time_ms),
        _ => return None,
    };
    let agg = match SERIES.iter().find(|(n, _)| *n == name).map(|(_, a)| *a) {
        Some(1) => Agg::Sum,
        Some(2) => Agg::Mean,
        _ => Agg::Last,
    };
    Some((agg, g))
}

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    pub series: Option<String>,
    pub from: Option<u64>,
    pub to: Option<u64>,
    pub step: Option<String>,
}

const MAX_POINTS: u64 = 5000;
const MAX_SPAN_MS: u64 = 400 * 24 * HOUR_MS;
const MINUTE_RETENTION_MS: u64 = 30 * 24 * HOUR_MS;

/// Named steps accepted by `/metrics` (ARCHITECTURE section 6). `1d` and `24h` are the same.
pub const STEPS: &[(&str, u64)] = &[
    ("1m", MINUTE_MS),
    ("5m", 5 * MINUTE_MS),
    ("15m", 15 * MINUTE_MS),
    ("30m", 30 * MINUTE_MS),
    ("1h", HOUR_MS),
    ("3h", 3 * HOUR_MS),
    ("6h", 6 * HOUR_MS),
    ("12h", 12 * HOUR_MS),
    ("1d", 24 * HOUR_MS),
    ("24h", 24 * HOUR_MS),
    ("7d", 7 * 24 * HOUR_MS),
    ("1w", 7 * 24 * HOUR_MS),
];

/// Parses `step`: one of [`STEPS`] (case-insensitive), or a whole number of milliseconds that
/// is a positive multiple of one minute.
fn parse_step(s: &str) -> Result<u64, ApiError> {
    let s = s.trim();
    let unsupported = || {
        let names: Vec<&str> = STEPS.iter().map(|(n, _)| *n).collect();
        ApiError::bad_request(format!(
            "unsupported step {s:?}: use one of {}, or a whole number of milliseconds that is a \
             multiple of 60000",
            names.join(", ")
        ))
    };
    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
        let ms = s.parse::<u64>().map_err(|_| unsupported())?;
        if ms == 0 || ms % MINUTE_MS != 0 {
            return Err(unsupported());
        }
        return Ok(ms);
    }
    STEPS
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(s))
        .map(|(_, ms)| *ms)
        .ok_or_else(unsupported)
}

/// A validated metrics request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeriesRequest {
    pub names: Vec<String>,
    pub from: u64,
    pub to: u64,
    pub step: u64,
}

impl SeriesRequest {
    pub fn parse(q: &MetricsQuery, now: u64) -> Result<Self, ApiError> {
        let raw = q
            .series
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ApiError::bad_request("series is required (comma-separated names)"))?;
        let mut names: Vec<String> = Vec::new();
        for n in raw.split(',').map(str::trim).filter(|n| !n.is_empty()) {
            if getter(n).is_none() {
                return Err(ApiError::bad_request(format!("unknown series {n:?}")));
            }
            if !names.iter().any(|x| x == n) {
                names.push(n.to_owned());
            }
        }
        if names.is_empty() || names.len() > 16 {
            return Err(ApiError::bad_request("between 1 and 16 series"));
        }
        let to = q.to.unwrap_or(now).min(now + HOUR_MS);
        let from = q.from.unwrap_or_else(|| to.saturating_sub(24 * HOUR_MS));
        if from >= to {
            return Err(ApiError::bad_request("from must be before to"));
        }
        if to - from > MAX_SPAN_MS {
            return Err(ApiError::bad_request("window is longer than 400 days"));
        }
        let span = to - from;
        let step = match q.step.as_deref() {
            Some(s) => parse_step(s)?,
            None => (span / 500).max(MINUTE_MS).div_ceil(MINUTE_MS) * MINUTE_MS,
        };
        if span / step > MAX_POINTS {
            return Err(ApiError::bad_request(format!(
                "too many points; use a step of at least {} ms",
                span.div_ceil(MAX_POINTS).div_ceil(MINUTE_MS) * MINUTE_MS
            )));
        }
        let from = from - from % step;
        Ok(Self {
            names,
            from,
            to,
            step,
        })
    }

    pub fn resolution(&self, now: u64) -> Resolution {
        if self.step >= HOUR_MS || self.from < now.saturating_sub(MINUTE_RETENTION_MS) {
            Resolution::Hour
        } else {
            Resolution::Minute
        }
    }
}

/// Buckets rows into the columnar DTO.
pub fn bucket(req: &SeriesRequest, rows: &[MetricsRow]) -> MetricsSeriesDto {
    let n = (req.to - req.from).div_ceil(req.step) as usize;
    let t: Vec<u64> = (0..n as u64).map(|i| req.from + i * req.step).collect();
    let mut series = BTreeMap::new();
    for name in &req.names {
        let Some((agg, get)) = getter(name) else {
            continue;
        };
        let mut vals: Vec<Option<f64>> = vec![None; n];
        let mut counts = vec![0u32; n];
        for r in rows {
            if r.ts_ms < req.from || r.ts_ms >= req.to {
                continue;
            }
            let i = ((r.ts_ms - req.from) / req.step) as usize;
            if i >= n {
                continue;
            }
            // Unknown values are skipped: a bucket with no known sample stays null.
            let Some(x) = get(r) else { continue };
            counts[i] += 1;
            vals[i] = Some(match (agg, vals[i]) {
                (Agg::Last, _) | (_, None) => x,
                (Agg::Sum | Agg::Mean, Some(prev)) => prev + x,
            });
        }
        if agg == Agg::Mean {
            for (v, c) in vals.iter_mut().zip(&counts) {
                if let Some(x) = v {
                    *x /= f64::from((*c).max(1));
                }
            }
        }
        series.insert(name.clone(), vals);
    }
    MetricsSeriesDto {
        from_ms: req.from,
        to_ms: req.to,
        step_ms: req.step,
        t,
        series,
    }
}

/// `GET /metrics?series=a,b&from&to&step`.
pub async fn series(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<MetricsQuery>,
) -> ApiResult<Response> {
    let now = now_ms();
    let req = SeriesRequest::parse(&q, now)?;
    // Requests inside one step share a cache entry.
    let key = format!(
        "{}|{}|{}|{}",
        req.names.join(","),
        req.from,
        req.to - req.to % req.step,
        req.step
    );
    if let Some(b) = s.metrics_cache.get(&key).await {
        return Ok(b.respond(&headers, cache::HISTORY));
    }
    let res = req.resolution(now);
    let (from, to) = (req.from, req.to);
    let rows = s
        .store_read(move |st| Ok(st.metrics_range(from, to, res)?))
        .await?;
    let body = Arc::new(CachedBody::json(&bucket(&req, &rows)));
    s.metrics_cache.insert(key, Arc::clone(&body)).await;
    Ok(body.respond(&headers, cache::HISTORY))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(series: &str, from: Option<u64>, to: Option<u64>, step: Option<&str>) -> MetricsQuery {
        MetricsQuery {
            series: Some(series.into()),
            from,
            to,
            step: step.map(Into::into),
        }
    }

    #[test]
    fn every_series_has_a_getter() {
        for (n, _) in SERIES {
            assert!(getter(n).is_some(), "{n}");
        }
    }

    #[test]
    fn request_validation() {
        let now = 1_000 * HOUR_MS;
        assert!(SeriesRequest::parse(&q("nope", None, None, None), now).is_err());
        assert!(SeriesRequest::parse(&q("node_count", Some(10), Some(5), None), now).is_err());
        assert!(SeriesRequest::parse(&q("node_count", None, None, Some("1s")), now).is_err());
        assert!(
            SeriesRequest::parse(&q("node_count", Some(0), Some(now), Some("60000")), now).is_err(),
            "too many points"
        );
        let r = SeriesRequest::parse(&q("node_count,block_count", None, None, None), now).unwrap();
        assert_eq!(r.names.len(), 2);
        assert!((r.to - r.from) / r.step <= 500);
        assert_eq!(r.resolution(now), Resolution::Minute);
        let r = SeriesRequest::parse(&q("node_count", None, None, Some("1h")), now).unwrap();
        assert_eq!(r.resolution(now), Resolution::Hour);
    }

    #[test]
    fn bucketing() {
        let req = SeriesRequest {
            names: vec![
                "node_count".into(),
                "block_count".into(),
                "avg_block_time_ms".into(),
            ],
            from: 0,
            to: 4 * MINUTE_MS,
            step: 2 * MINUTE_MS,
        };
        let row = |m: u64, nodes: u32, blocks: u32, avg: Option<u32>| MetricsRow {
            ts_ms: m * MINUTE_MS,
            node_count: Some(nodes),
            block_count: Some(blocks),
            avg_block_time_ms: avg,
            ..MetricsRow::default()
        };
        let d = bucket(
            &req,
            &[
                row(0, 10, 2, Some(30_000)),
                row(1, 11, 2, Some(20_000)),
                row(3, 12, 1, None),
            ],
        );
        assert_eq!(d.t, vec![0, 2 * MINUTE_MS]);
        assert_eq!(d.series["node_count"], vec![Some(11.0), Some(12.0)]);
        assert_eq!(d.series["block_count"], vec![Some(4.0), Some(1.0)]);
        assert_eq!(d.series["avg_block_time_ms"], vec![Some(25_000.0), None]);
    }

    #[test]
    fn unknown_is_null_not_zero() {
        let req = SeriesRequest {
            names: vec!["node_count".into(), "price_usd".into(), "tip_height".into()],
            from: 0,
            to: 2 * MINUTE_MS,
            step: MINUTE_MS,
        };
        // A backfilled row knows only the node count; a live row knows everything.
        let backfilled = MetricsRow {
            ts_ms: 0,
            node_count: Some(6_700),
            ..MetricsRow::default()
        };
        let live = MetricsRow {
            ts_ms: MINUTE_MS,
            node_count: Some(6_701),
            price_usd: Some(0.0),
            tip_height: Some(3_000_000),
            ..MetricsRow::default()
        };
        let d = bucket(&req, &[backfilled, live]);
        assert_eq!(d.series["node_count"], vec![Some(6_700.0), Some(6_701.0)]);
        assert_eq!(d.series["tip_height"], vec![None, Some(3_000_000.0)]);
        assert_eq!(
            d.series["price_usd"],
            vec![None, Some(0.0)],
            "a known 0 stays 0"
        );
        let json = serde_json::to_string(&d).unwrap();
        assert!(json.contains("\"tip_height\":[null,3000000.0]"), "{json}");
    }

    #[test]
    fn steps() {
        let now = 1_000 * HOUR_MS;
        let step = |s: &str| {
            SeriesRequest::parse(
                &q(
                    "node_count",
                    Some(now - 30 * 24 * HOUR_MS),
                    Some(now),
                    Some(s),
                ),
                now,
            )
            .map(|r| r.step)
        };
        assert_eq!(step("1d").unwrap(), 24 * HOUR_MS);
        assert_eq!(step("24h").unwrap(), 24 * HOUR_MS);
        assert_eq!(step("1D").unwrap(), 24 * HOUR_MS);
        assert_eq!(step("6h").unwrap(), 6 * HOUR_MS);
        assert_eq!(step("1w").unwrap(), 7 * 24 * HOUR_MS);
        assert_eq!(step("3600000").unwrap(), HOUR_MS);
        for bad in ["2w", "90s", "1.5h", "0", "61000", "", "1y", "-1h"] {
            let e = step(bad).unwrap_err();
            assert_eq!(e.status, axum::http::StatusCode::BAD_REQUEST, "{bad}");
        }
    }
}

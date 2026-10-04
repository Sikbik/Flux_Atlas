//! `GET /chain/daily?days=30|90|365|all`: Insight's daily chain statistics (transactions and
//! blocks, fees, outputs, supply, difficulty, network hash) joined by UTC day.
//!
//! - **Fetching:** one call per series with `days=all` (six in all), one after another on the
//!   bulk lane with [`crate::sources::SERIES_PACE`] between them, refreshed every 12 hours. The
//!   copy is a [`KeepGood`]: expired copies are served while one background refresh runs, and a
//!   refresh that fails keeps the last good copy (a failed refresh is retried after 10
//!   minutes). A refresh in which only some series fail keeps those series from the previous
//!   copy; with no previous copy they are `null`.
//! - **Windows** are cut from that one copy when it is built (`30`, `90`, `365` and `all` days
//!   ending today), so a window adds no upstream call; each is a prebuilt body with an ETag.
//! - **Unknown is `null`:** a series that failed, or that has no row for a day, leaves `null`
//!   on that day, never 0.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::{ChainDailyDto, ChainDay};
use atlas_core::now_ms;
use atlas_flux::models::insight::StatPoint;
use atlas_flux::timefmt::parse_iso8601_ms;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{CachedBody, cache};
use crate::error::{ApiError, ApiResult};
use crate::extract::Q;
use crate::keep::KeepGood;
use crate::sources::MarketSources;
use crate::state::AppState;

const DAY_MS: u64 = 86_400_000;

/// Lifetime of the daily series copy.
pub const DAILY_TTL: Duration = Duration::from_secs(12 * 3600);
/// A failed refresh of the daily series is retried after this long.
pub const DAILY_RETRY: Duration = Duration::from_secs(600);
/// Longest a request waits for the first copy before a 503 with `Retry-After`. The first fill
/// takes about 40 s on mainnet (Insight needs 4 to 5 s per `days=all` series), so it is started
/// at startup ([`crate::AppState::start_background`]) and a request that arrives during it
/// gets a quick 503 instead of hanging.
pub const DAILY_WAIT: Duration = Duration::from_secs(10);

/// One of Insight's daily statistics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StatKind {
    Transactions,
    Fees,
    Outputs,
    Supply,
    Difficulty,
    NetworkHash,
}

impl StatKind {
    /// Every series, in fetch order.
    pub const ALL: [Self; 6] = [
        Self::Transactions,
        Self::Fees,
        Self::Outputs,
        Self::Supply,
        Self::Difficulty,
        Self::NetworkHash,
    ];

    /// Path segment under `statistics/`.
    pub const fn path(self) -> &'static str {
        match self {
            Self::Transactions => "transactions",
            Self::Fees => "fees",
            Self::Outputs => "outputs",
            Self::Supply => "supply",
            Self::Difficulty => "difficulty",
            Self::NetworkHash => "network-hash",
        }
    }

    const fn index(self) -> usize {
        self as usize
    }
}

/// `(UTC day start ms, value)` by day.
pub type DaySeries = BTreeMap<u64, f64>;

/// The parsed series of one fetch; `None` for a series that failed (and had no earlier copy).
#[derive(Debug, Clone, Default)]
pub struct DailySeries {
    /// Indexed by [`StatKind`] in [`StatKind::ALL`] order.
    pub series: [Option<Arc<DaySeries>>; 6],
    /// Blocks per day (from the transactions series).
    pub blocks: Option<Arc<DaySeries>>,
}

impl DailySeries {
    fn get(&self, kind: StatKind) -> Option<&DaySeries> {
        self.series[kind.index()].as_deref()
    }
}

/// Parses one series: the value Insight reports for `kind` per `YYYY-MM-DD`, plus the block
/// count for the transactions series. Rows with an unreadable date or a missing or non-finite
/// value are skipped (that day stays unknown).
pub fn parse(kind: StatKind, points: &[StatPoint]) -> (DaySeries, Option<DaySeries>) {
    let mut values = DaySeries::new();
    let mut blocks = (kind == StatKind::Transactions).then(DaySeries::new);
    for p in points {
        let Some(day) = parse_iso8601_ms(&format!("{}T00:00:00Z", p.date.trim())) else {
            continue;
        };
        let v = match kind {
            StatKind::Transactions => p.transaction_count.map(|n| n as f64),
            StatKind::Fees => p.fee,
            _ => p.sum,
        };
        if let Some(v) = v.filter(|v| v.is_finite()) {
            values.insert(day, v);
        }
        if let (Some(b), Some(n)) = (blocks.as_mut(), p.block_count) {
            b.insert(day, n as f64);
        }
    }
    (values, blocks)
}

/// Joins the series by UTC day, oldest first: every day any series has, with `None` where a
/// series has no value.
pub fn join(s: &DailySeries) -> Vec<ChainDay> {
    let days: BTreeSet<u64> = s
        .series
        .iter()
        .chain(std::iter::once(&s.blocks))
        .flatten()
        .flat_map(|m| m.keys().copied())
        .collect();
    let at = |kind: StatKind, day: u64| s.get(kind).and_then(|m| m.get(&day).copied());
    let count = |v: Option<f64>| v.map(|x| x.max(0.0).round() as u64);
    days.into_iter()
        .map(|day| {
            let blocks = count(s.blocks.as_deref().and_then(|m| m.get(&day).copied()));
            let fees = at(StatKind::Fees, day);
            ChainDay {
                day_ms: day,
                transactions: count(at(StatKind::Transactions, day)),
                blocks,
                fees,
                fees_total: fees
                    .zip(blocks)
                    .map(|(f, b)| (f * b as f64 * 1e8).round() / 1e8),
                outputs: at(StatKind::Outputs, day),
                supply: at(StatKind::Supply, day),
                difficulty: at(StatKind::Difficulty, day),
                network_hash: at(StatKind::NetworkHash, day),
            }
        })
        .collect()
}

/// A window of `/chain/daily`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DailyWindow {
    D30,
    D90,
    D365,
    All,
}

impl DailyWindow {
    pub const ALL: [Self; 4] = [Self::D30, Self::D90, Self::D365, Self::All];

    /// Parses `days` (`30`, `90`, `365` or `all`; default `365`).
    pub fn parse(days: Option<&str>) -> Result<Self, ApiError> {
        match days.map(str::trim) {
            None | Some("365") => Ok(Self::D365),
            Some("30") => Ok(Self::D30),
            Some("90") => Ok(Self::D90),
            Some("all") => Ok(Self::All),
            Some(_) => Err(ApiError::bad_request("days must be 30, 90, 365 or all")),
        }
    }

    /// Days the window spans, `None` for all of them.
    pub const fn days(self) -> Option<u64> {
        match self {
            Self::D30 => Some(30),
            Self::D90 => Some(90),
            Self::D365 => Some(365),
            Self::All => None,
        }
    }

    const fn index(self) -> usize {
        self as usize
    }
}

/// The days of `window` ending on the UTC day of `now_ms` (today counts as one).
pub fn slice(days: &[ChainDay], window: DailyWindow, now_ms: u64) -> &[ChainDay] {
    let Some(n) = window.days() else {
        return days;
    };
    let today = now_ms / DAY_MS * DAY_MS;
    let from = today.saturating_sub((n - 1) * DAY_MS);
    &days[days.partition_point(|d| d.day_ms < from)..]
}

/// The held copy: the parsed series (kept for the next refresh) and a body per window.
#[derive(Debug)]
pub struct ChainDaily {
    pub fetched_ms: u64,
    pub series: DailySeries,
    pub days: Vec<ChainDay>,
    bodies: [Arc<CachedBody>; 4],
}

impl ChainDaily {
    /// Joins `series` and prebuilds the window bodies, as of `fetched_ms`.
    pub fn build(series: DailySeries, fetched_ms: u64) -> Self {
        let days = join(&series);
        let first_day_ms = days.first().map(|d| d.day_ms);
        let bodies = DailyWindow::ALL.map(|w| {
            Arc::new(CachedBody::json(&ChainDailyDto {
                generated_ms: fetched_ms,
                first_day_ms,
                days: slice(&days, w, fetched_ms).to_vec(),
            }))
        });
        Self {
            fetched_ms,
            series,
            days,
            bodies,
        }
    }

    /// The prebuilt body of `window`.
    pub fn body(&self, window: DailyWindow) -> &Arc<CachedBody> {
        &self.bodies[window.index()]
    }
}

/// Fetches the six series one after another (`sources.pace()` apart). A series that fails keeps
/// its copy from `prev`; the fetch fails only when every series failed.
pub async fn fetch(
    sources: Arc<dyn MarketSources>,
    prev: Option<Arc<ChainDaily>>,
) -> Result<ChainDaily, ApiError> {
    let started = Instant::now();
    let mut series = DailySeries::default();
    let mut failed: Vec<&'static str> = Vec::new();
    let mut last_err = None;
    let mut rows = [0usize; 6];
    for (i, kind) in StatKind::ALL.into_iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(sources.pace()).await;
        }
        match sources.stat_series(kind).await {
            Ok(points) => {
                rows[i] = points.len();
                let (values, blocks) = parse(kind, &points);
                series.series[i] = Some(Arc::new(values));
                if let Some(b) = blocks {
                    series.blocks = Some(Arc::new(b));
                }
            }
            Err(e) => {
                tracing::warn!(series = kind.path(), error = %e, "daily chain series failed");
                failed.push(kind.path());
                if let Some(p) = prev.as_deref() {
                    series.series[i].clone_from(&p.series.series[i]);
                    if kind == StatKind::Transactions {
                        series.blocks.clone_from(&p.series.blocks);
                    }
                }
                last_err = Some(e);
            }
        }
    }
    if failed.len() == StatKind::ALL.len()
        && let Some(e) = last_err
    {
        return Err(ApiError::third_party("Insight", &e));
    }
    let copy = ChainDaily::build(series, now_ms());
    tracing::info!(
        days = copy.days.len(),
        first_day_ms = copy.days.first().map(|d| d.day_ms),
        rows_transactions = rows[0],
        rows_fees = rows[1],
        rows_outputs = rows[2],
        rows_supply = rows[3],
        rows_difficulty = rows[4],
        rows_network_hash = rows[5],
        failed = ?failed,
        bytes_30 = copy.body(DailyWindow::D30).raw().len(),
        bytes_365 = copy.body(DailyWindow::D365).raw().len(),
        bytes_all = copy.body(DailyWindow::All).raw().len(),
        ms = started.elapsed().as_millis() as u64,
        "daily chain series fetched"
    );
    Ok(copy)
}

/// A new keep for the daily series.
pub fn keep() -> Arc<KeepGood<ChainDaily>> {
    Arc::new(KeepGood::new(DAILY_TTL, DAILY_RETRY))
}

/// The daily series copy, waiting at most `wait` for a first fill.
pub async fn copy(s: &AppState, wait: Duration) -> Result<Arc<ChainDaily>, ApiError> {
    let sources = Arc::clone(&s.sources);
    let prev = s.chain_daily.held().await.map(|(_, v)| v);
    s.chain_daily
        .get_within(wait, move || fetch(sources, prev))
        .await
        .map(|(_, v)| v)
}

#[derive(Debug, Deserialize)]
pub struct DailyQuery {
    pub days: Option<String>,
}

/// `GET /chain/daily?days=30|90|365|all`.
pub async fn handler(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<DailyQuery>,
) -> ApiResult<Response> {
    let window = DailyWindow::parse(q.days.as_deref())?;
    let copy = copy(&s, DAILY_WAIT).await?;
    Ok(copy.body(window).respond(&headers, cache::CHAIN_LONG))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(date: &str, sum: Option<f64>) -> StatPoint {
        StatPoint {
            date: date.into(),
            sum,
            ..StatPoint::default()
        }
    }

    const D1: u64 = 1_790_985_600_000; // 2026-10-03
    const D2: u64 = D1 + DAY_MS;

    #[test]
    fn parse_reads_each_kind_and_skips_bad_rows() {
        let tx = StatPoint {
            date: "2026-10-03".into(),
            transaction_count: Some(42_537),
            block_count: Some(2_878),
            ..StatPoint::default()
        };
        let (v, b) = parse(StatKind::Transactions, &[tx]);
        assert_eq!(v.get(&D1), Some(&42_537.0));
        assert_eq!(b.unwrap().get(&D1), Some(&2_878.0));
        let fee = StatPoint {
            date: "2026-10-04".into(),
            fee: Some(0.000_011_26),
            ..StatPoint::default()
        };
        let (v, b) = parse(StatKind::Fees, &[fee]);
        assert_eq!(v.get(&D2), Some(&0.000_011_26));
        assert!(b.is_none());
        let (v, _) = parse(
            StatKind::Supply,
            &[
                pt("2026-10-03", Some(4.3e8)),
                pt("not a date", Some(1.0)),
                pt("2026-10-04", None),
                pt("2026-10-02", Some(f64::NAN)),
            ],
        );
        assert_eq!(v.len(), 1);
        assert_eq!(v.get(&D1), Some(&4.3e8));
    }

    #[test]
    fn join_by_day_leaves_unknown_null_never_zero() {
        let mut s = DailySeries::default();
        s.series[StatKind::Supply.index()] =
            Some(Arc::new([(D1, 4.3e8), (D2, 4.31e8)].into_iter().collect()));
        // Difficulty has only the first day; it was 0 that day (a real 0 stays 0).
        s.series[StatKind::Difficulty.index()] = Some(Arc::new([(D1, 0.0)].into_iter().collect()));
        s.series[StatKind::Transactions.index()] =
            Some(Arc::new([(D2, 41_000.0)].into_iter().collect()));
        s.blocks = Some(Arc::new([(D2, 2_880.0)].into_iter().collect()));
        // Fees, outputs and network hash failed.
        let days = join(&s);
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].day_ms, D1);
        assert_eq!(days[0].supply, Some(4.3e8));
        assert_eq!(days[0].difficulty, Some(0.0));
        assert_eq!(days[0].transactions, None);
        assert_eq!(days[0].blocks, None);
        assert_eq!(days[1].difficulty, None);
        assert_eq!(days[1].transactions, Some(41_000));
        assert_eq!(days[1].blocks, Some(2_880));
        for d in &days {
            assert_eq!((d.fees, d.outputs, d.network_hash), (None, None, None));
            assert_eq!(d.fees_total, None, "no total without the average");
        }
        // Insight's fees are an average per block: the total multiplies by the block count.
        s.series[StatKind::Fees.index()] = Some(Arc::new(
            [(D1, 0.000_042_31), (D2, 0.000_01)].into_iter().collect(),
        ));
        let days = join(&s);
        assert_eq!(days[0].fees_total, None, "no block count on day 1");
        assert_eq!(days[1].fees_total, Some(0.0288));
        assert!(join(&DailySeries::default()).is_empty());
    }

    fn day(day_ms: u64) -> ChainDay {
        ChainDay {
            day_ms,
            transactions: None,
            blocks: None,
            fees: None,
            fees_total: None,
            outputs: None,
            supply: Some(1.0),
            difficulty: None,
            network_hash: None,
        }
    }

    #[test]
    fn windows_end_today_and_count_it() {
        let today = D2;
        let days: Vec<ChainDay> = (0..400).rev().map(|i| day(today - i * DAY_MS)).collect();
        let now = today + 5 * 3_600_000;
        assert_eq!(slice(&days, DailyWindow::D30, now).len(), 30);
        assert_eq!(
            slice(&days, DailyWindow::D30, now)[0].day_ms,
            today - 29 * DAY_MS
        );
        assert_eq!(slice(&days, DailyWindow::D90, now).len(), 90);
        assert_eq!(slice(&days, DailyWindow::D365, now).len(), 365);
        assert_eq!(slice(&days, DailyWindow::All, now).len(), 400);
        // A copy without today's row: the window still ends today.
        assert_eq!(slice(&days[..399], DailyWindow::D30, now).len(), 29);
        // A short history is all there is.
        assert_eq!(slice(&days[390..], DailyWindow::D365, now).len(), 10);
        assert!(slice(&[], DailyWindow::D30, now).is_empty());
    }

    fn fixed() -> Arc<crate::sources::FixedSources> {
        Arc::new(crate::sources::FixedSources::default())
    }

    #[tokio::test]
    async fn fetch_joins_six_series_with_six_calls() {
        let src = fixed();
        let copy = fetch(src.clone(), None).await.unwrap();
        assert_eq!(src.count(4), 6, "one call per series");
        let today = now_ms() / DAY_MS * DAY_MS;
        let last = copy.days.last().unwrap();
        assert_eq!(last.day_ms, today);
        assert_eq!(
            copy.days.first().unwrap().day_ms,
            crate::sources::FIXED_SERIES_FROM_MS
        );
        // network-hash starts later: null before, set after; everything else always set.
        let first = &copy.days[0];
        assert!(first.network_hash.is_none());
        assert!(first.transactions.is_some() && first.supply.is_some() && first.fees.is_some());
        assert!(last.network_hash.is_some() && last.blocks.is_some());
        let dto: ChainDailyDto = serde_json::from_slice(copy.body(DailyWindow::D30).raw()).unwrap();
        assert_eq!(dto.days.len(), 30);
        assert_eq!(dto.first_day_ms, Some(crate::sources::FIXED_SERIES_FROM_MS));
        assert_eq!(dto.generated_ms, copy.fetched_ms);
    }

    #[tokio::test]
    async fn a_failed_series_is_null_or_kept_from_the_last_copy() {
        let src = fixed();
        src.fail_series
            .lock()
            .unwrap()
            .extend([StatKind::Fees, StatKind::Transactions]);
        let partial = Arc::new(fetch(src.clone(), None).await.unwrap());
        assert!(partial.days.iter().all(|d| d.fees.is_none()));
        assert!(
            partial
                .days
                .iter()
                .all(|d| d.transactions.is_none() && d.blocks.is_none())
        );
        assert!(partial.days.iter().all(|d| d.supply.is_some()));
        // With a good earlier copy, a series that fails keeps that copy's values.
        let good = Arc::new(fetch(fixed(), None).await.unwrap());
        let merged = fetch(src.clone(), Some(Arc::clone(&good))).await.unwrap();
        assert_eq!(merged.days.len(), good.days.len());
        assert_eq!(merged.days[100].fees, good.days[100].fees);
        assert_eq!(merged.days[100].blocks, good.days[100].blocks);
        // Every series failing is an error (the keep then holds on to its copy).
        src.fail.store(true, std::sync::atomic::Ordering::SeqCst);
        let e = fetch(src.clone(), Some(good)).await.unwrap_err();
        assert_eq!(e.code, atlas_core::api::ApiErrorCode::UpstreamUnavailable);
    }

    #[test]
    fn window_parameter() {
        assert_eq!(DailyWindow::parse(None).unwrap(), DailyWindow::D365);
        assert_eq!(DailyWindow::parse(Some("30")).unwrap(), DailyWindow::D30);
        assert_eq!(DailyWindow::parse(Some("90")).unwrap(), DailyWindow::D90);
        assert_eq!(DailyWindow::parse(Some("all")).unwrap(), DailyWindow::All);
        for bad in ["60", "", "ALL", "-1", "365d"] {
            let e = DailyWindow::parse(Some(bad)).unwrap_err();
            assert_eq!(e.status, axum::http::StatusCode::BAD_REQUEST, "{bad}");
        }
    }
}

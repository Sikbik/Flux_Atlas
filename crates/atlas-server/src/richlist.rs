//! The rich list: one shared copy of the explorer's top 1,000 addresses, a snapshot of it per
//! UTC day, and the movers between two snapshots (`GET /richlist/movers`).
//!
//! - **Shared copy:** one [`KeepGood`] fed by Insight's `statistics/richest-addresses-list` on
//!   the bulk lane, refreshed every 30 minutes (`ProxyTtls::richlist`). `/richlist`, the wallet
//!   view's rank and the daily snapshot all read it, so visitors never cause an upstream call of
//!   their own; concurrent first requests share one fill. While Insight fails the last good copy
//!   is served, marked `stale`.
//! - **Snapshots:** a background task stores the copy once per UTC day (at startup when today's
//!   is missing, then shortly after each UTC midnight) through the engine's single writer
//!   (`rich_snapshots`, about 30 KB compressed each, kept 400 days).
//! - **Movers** compare the newest snapshot with the stored one closest to the window before
//!   it; built once per window and newest snapshot, then reused for 10 minutes.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use atlas_core::api::{
    RichConcentration, RichEntered, RichLeft, RichMove, RichMoversDto, RichMoversWindow,
};
use atlas_core::{Amount, now_ms};
use atlas_flux::models::insight::RichListRow;
use atlas_store::{RichHolding, RichSnapshot};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{CachedBody, cache};
use crate::error::{ApiError, ApiResult};
use crate::extract::Q;
use crate::keep::KeepGood;
use crate::state::AppState;
use crate::views::Views;

const DAY_MS: u64 = 86_400_000;

/// A failed rich-list fill or refresh is retried after this long.
pub const RICH_RETRY: Duration = Duration::from_secs(60);
/// Longest `/richlist` waits for the first copy before a 503 with `Retry-After`.
pub const RICH_WAIT: Duration = Duration::from_secs(20);
/// Movers per direction.
pub const MOVERS_MAX: usize = 15;
/// Lifetime of a movers body (node counts move; the snapshots only change daily).
pub const MOVERS_TTL: Duration = Duration::from_secs(600);
/// The snapshot task's first run after a start (lets the supply arrive).
const SNAPSHOT_START_DELAY: Duration = Duration::from_secs(30);
/// Retry of a snapshot that could not be taken yet.
const SNAPSHOT_RETRY: Duration = Duration::from_secs(300);
/// After a start, a snapshot waits this long at most for the supply to be known.
const SUPPLY_GRACE: Duration = Duration::from_secs(900);
/// The snapshot is taken this long after UTC midnight (the copy expires within 30 minutes).
const SNAPSHOT_AFTER_MIDNIGHT: Duration = Duration::from_secs(120);

/// Rich-list rows with their fetch time.
#[derive(Debug, Clone)]
pub struct RichRows {
    pub rows: Vec<RichListRow>,
    pub fetched_ms: u64,
}

/// The shared copy and whether it is stale.
#[derive(Debug, Clone)]
pub struct RichCopy {
    pub rows: Arc<RichRows>,
    /// The last refresh failed, or the copy is older than twice its lifetime.
    pub stale: bool,
}

/// A new keep for the rich list (`ttl`: `ProxyTtls::richlist`; a failure is retried after
/// [`RICH_RETRY`], or after `ttl` when that is shorter).
pub fn keep(ttl: Duration) -> Arc<KeepGood<RichRows>> {
    Arc::new(KeepGood::new(ttl, RICH_RETRY.min(ttl)))
}

/// The shared rich list, waiting at most `wait` for a first fill.
pub async fn shared(s: &AppState, wait: Duration) -> Result<RichCopy, ApiError> {
    let sources = Arc::clone(&s.sources);
    let (at, rows) = s
        .rich
        .get_within(wait, move || async move {
            let rows = sources
                .richest()
                .await
                .map_err(|e| ApiError::from_flux("rich list", &e))?;
            if rows.is_empty() {
                return Err(ApiError::upstream(
                    "the explorer returned an empty rich list",
                ));
            }
            tracing::debug!(rows = rows.len(), "rich list fetched");
            Ok(RichRows {
                rows,
                fetched_ms: now_ms(),
            })
        })
        .await?;
    let stale = s.rich.failing().await || at.elapsed() >= 2 * s.rich.ttl();
    Ok(RichCopy { rows, stale })
}

/// The snapshot of `rows` for its UTC day, with the circulating supply then.
pub fn snapshot_of(rows: &RichRows, supply: Option<Amount>) -> RichSnapshot {
    RichSnapshot {
        day_ms: rows.fetched_ms / DAY_MS * DAY_MS,
        fetched_ms: rows.fetched_ms,
        supply,
        rows: rows
            .rows
            .iter()
            .map(|r| RichHolding {
                address: r.address.clone(),
                balance: Amount::from_flux_f64(r.balance).unwrap_or(Amount::ZERO),
            })
            .collect(),
    }
}

/// The circulating supply now: the explorer's figure, else the transparent supply.
pub fn circulating(v: &Views) -> Option<Amount> {
    let s = v.published.network.supply.as_ref()?;
    s.circulating_explorer
        .or(Some(s.transparent))
        .filter(|a| *a > Amount::ZERO)
}

/// What one run of the snapshot step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotStep {
    /// Today's snapshot was handed to the writer.
    Stored(u64),
    /// Today's snapshot is already stored.
    Present(u64),
    /// The shared copy is from an earlier day (its refresh is due within 30 minutes), or the
    /// supply is not known yet shortly after a start.
    Waiting,
}

/// Stores today's snapshot when it is missing, from the shared copy.
pub async fn snapshot_step(s: &AppState) -> Result<SnapshotStep, ApiError> {
    let today = now_ms() / DAY_MS * DAY_MS;
    let days = s.store_read(|st| Ok(st.rich_snapshot_days()?)).await?;
    if days.last() == Some(&today) {
        return Ok(SnapshotStep::Present(today));
    }
    // Right after a start the engine may not have the supply yet; wait for it a while (the
    // concentration of a snapshot without one falls back on the supply of the day it is read).
    let supply = circulating(&s.views());
    if supply.is_none() && s.started.elapsed() < SUPPLY_GRACE {
        return Ok(SnapshotStep::Waiting);
    }
    let copy = shared(s, Duration::from_secs(60)).await?;
    if copy.rows.fetched_ms < today {
        return Ok(SnapshotStep::Waiting);
    }
    let snap = snapshot_of(&copy.rows, supply);
    let rows = snap.rows.len();
    let supply = snap.supply.map(Amount::to_flux_f64);
    if !s.engine.store_rich_snapshot(snap).await {
        return Err(ApiError::unavailable("shutting down"));
    }
    tracing::info!(
        day_ms = today,
        rows,
        supply,
        stored = days.len() + 1,
        "rich list snapshot stored"
    );
    Ok(SnapshotStep::Stored(today))
}

/// Time until `after` past the next UTC midnight.
fn until_next_day(now_ms: u64, after: Duration) -> Duration {
    let next = (now_ms / DAY_MS + 1) * DAY_MS;
    Duration::from_millis(next - now_ms) + after
}

/// Runs the daily snapshot until the state is dropped.
pub fn spawn_snapshots(s: &AppState) {
    let weak = Arc::downgrade(s.inner());
    tokio::spawn(async move {
        tokio::time::sleep(SNAPSHOT_START_DELAY).await;
        loop {
            let Some(s) = AppState::upgrade(&weak) else {
                return;
            };
            let wait = match snapshot_step(&s).await {
                Ok(SnapshotStep::Stored(_) | SnapshotStep::Present(_)) => {
                    until_next_day(now_ms(), SNAPSHOT_AFTER_MIDNIGHT)
                }
                Ok(SnapshotStep::Waiting) => SNAPSHOT_RETRY,
                Err(e) => {
                    tracing::warn!(error = %e.message, "rich list snapshot not taken; retrying");
                    SNAPSHOT_RETRY
                }
            };
            drop(s);
            tokio::time::sleep(wait).await;
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------------------------

/// The stored day to compare `newest` with: the one closest to `window_days` before it (the
/// older one on a tie), `None` when nothing older is stored.
pub fn pick_base(days: &[u64], newest: u64, window_days: u64) -> Option<u64> {
    let target = newest.saturating_sub(window_days * DAY_MS);
    days.iter()
        .copied()
        .filter(|d| *d < newest)
        .min_by_key(|d| (d.abs_diff(target), *d))
}

/// Share of the supply the top 10, 100 and 1,000 of `snap` held. `fallback` is used when the
/// snapshot did not record a supply; `None` without either.
pub fn concentration_of(
    snap: &RichSnapshot,
    fallback: Option<Amount>,
) -> Option<RichConcentration> {
    let supply = snap.supply.or(fallback).filter(|a| *a > Amount::ZERO)?;
    let total = supply.sat() as f64;
    let pct = |n: usize| {
        let held: i64 = snap.rows.iter().take(n).map(|r| r.balance.sat()).sum();
        held as f64 * 100.0 / total
    };
    Some(RichConcentration {
        day_ms: snap.day_ms,
        top10_pct: pct(10),
        top100_pct: pct(100),
        top1000_pct: pct(1_000),
    })
}

/// The movers of `window` between `base` and `newest` (see [`RichMoversDto`]). `node_count`
/// counts the confirmed nodes paying out to an address now.
pub fn movers(
    window: RichMoversWindow,
    newest: Option<&RichSnapshot>,
    base: Option<&RichSnapshot>,
    snapshots: u32,
    concentration: Vec<RichConcentration>,
    node_count: &dyn Fn(&str) -> u32,
) -> RichMoversDto {
    let mut dto = RichMoversDto {
        window: window.as_str().to_owned(),
        to_ms: newest.map_or(0, |n| n.fetched_ms),
        from_ms: None,
        snapshots,
        gainers: Vec::new(),
        losers: Vec::new(),
        entered: Vec::new(),
        left: Vec::new(),
        concentration,
    };
    let (Some(new), Some(old)) = (newest, base) else {
        return dto;
    };
    dto.from_ms = Some(old.fetched_ms);
    fn rank_of(s: &RichSnapshot) -> HashMap<&str, (u32, Amount)> {
        s.rows
            .iter()
            .enumerate()
            .map(|(i, r)| (r.address.as_str(), (i as u32 + 1, r.balance)))
            .collect()
    }
    let before = rank_of(old);
    let now = rank_of(new);
    let mut moves: Vec<RichMove> = Vec::new();
    for (i, r) in new.rows.iter().enumerate() {
        let rank = i as u32 + 1;
        match before.get(r.address.as_str()) {
            Some(&(prev_rank, prev_balance)) => {
                let delta = r.balance - prev_balance;
                if delta != Amount::ZERO {
                    moves.push(RichMove {
                        address: r.address.clone(),
                        rank: Some(rank),
                        prev_rank: Some(prev_rank),
                        balance: r.balance,
                        prev_balance,
                        delta,
                        node_count: 0,
                    });
                }
            }
            None => dto.entered.push(RichEntered {
                address: r.address.clone(),
                rank,
                balance: r.balance,
                node_count: node_count(&r.address),
            }),
        }
    }
    for (i, r) in old.rows.iter().enumerate() {
        if !now.contains_key(r.address.as_str()) {
            dto.left.push(RichLeft {
                address: r.address.clone(),
                prev_rank: i as u32 + 1,
                prev_balance: r.balance,
            });
        }
    }
    let mut gainers: Vec<RichMove> = moves
        .iter()
        .filter(|m| m.delta > Amount::ZERO)
        .cloned()
        .collect();
    gainers.sort_by(|a, b| {
        b.delta
            .cmp(&a.delta)
            .then_with(|| a.address.cmp(&b.address))
    });
    gainers.truncate(MOVERS_MAX);
    let mut losers: Vec<RichMove> = moves
        .into_iter()
        .filter(|m| m.delta < Amount::ZERO)
        .collect();
    losers.sort_by(|a, b| {
        a.delta
            .cmp(&b.delta)
            .then_with(|| a.address.cmp(&b.address))
    });
    losers.truncate(MOVERS_MAX);
    for m in gainers.iter_mut().chain(losers.iter_mut()) {
        m.node_count = node_count(&m.address);
    }
    dto.gainers = gainers;
    dto.losers = losers;
    dto
}

/// Confirmed nodes paying out to `addr` (as `/richlist` counts them).
pub fn active_nodes(v: &Views, addr: &str) -> u32 {
    v.index
        .by_address(addr)
        .iter()
        .filter(|&&i| v.at(i as usize).status.is_active())
        .count() as u32
}

/// What the movers of one window need from the store.
struct MoverInputs {
    newest: Option<RichSnapshot>,
    base: Option<RichSnapshot>,
    snapshots: u32,
    concentration: Vec<RichConcentration>,
}

fn read_inputs(
    st: &atlas_store::Store,
    window: RichMoversWindow,
    fallback: Option<Amount>,
) -> Result<MoverInputs, ApiError> {
    let days = st.rich_snapshot_days()?;
    let newest_day = days.last().copied();
    let newest = newest_day
        .map(|d| st.rich_snapshot(d))
        .transpose()?
        .flatten();
    let base = newest_day
        .and_then(|n| pick_base(&days, n, window.days()))
        .map(|d| st.rich_snapshot(d))
        .transpose()?
        .flatten();
    let mut concentration = Vec::with_capacity(days.len());
    st.for_each_rich_snapshot(|snap| {
        concentration.extend(concentration_of(&snap, fallback));
        Ok(())
    })?;
    Ok(MoverInputs {
        newest,
        base,
        snapshots: days.len() as u32,
        concentration,
    })
}

#[derive(Debug, Deserialize)]
pub struct MoversQuery {
    pub window: Option<String>,
}

/// `GET /richlist/movers?window=1d|7d|30d` (default `7d`).
pub async fn movers_handler(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<MoversQuery>,
) -> ApiResult<Response> {
    let window = match q.window.as_deref().map(str::trim) {
        None => RichMoversWindow::Week,
        Some(w) => RichMoversWindow::parse(w)
            .ok_or_else(|| ApiError::bad_request("window must be 1d, 7d or 30d"))?,
    };
    let days = s.store_read(|st| Ok(st.rich_snapshot_days()?)).await?;
    let key = (window, days.last().copied().unwrap_or(0), days.len() as u32);
    let st = s.clone();
    let body = s
        .movers_cache
        .try_get_with(key, async move {
            let v = st.views();
            let fallback = circulating(&v);
            let inputs = st
                .store_read_within(Duration::from_secs(25), move |store| {
                    read_inputs(store, window, fallback)
                })
                .await?;
            let dto = movers(
                window,
                inputs.newest.as_ref(),
                inputs.base.as_ref(),
                inputs.snapshots,
                inputs.concentration,
                &|a| active_nodes(&v, a),
            );
            Ok::<_, ApiError>(Arc::new(CachedBody::json(&dto)))
        })
        .await
        .map_err(|e| (*e).clone())?;
    Ok(body.respond(&headers, cache::SLOW))
}

#[cfg(test)]
mod tests {
    use super::*;

    const D0: u64 = 1_790_985_600_000;

    fn snap(day: u64, rows: &[(&str, i64)], supply: Option<i64>) -> RichSnapshot {
        RichSnapshot {
            day_ms: D0 + day * DAY_MS,
            fetched_ms: D0 + day * DAY_MS + 600_000,
            supply: supply.map(Amount::from_flux),
            rows: rows
                .iter()
                .map(|(a, b)| RichHolding {
                    address: (*a).to_owned(),
                    balance: Amount::from_flux(*b),
                })
                .collect(),
        }
    }

    #[test]
    fn base_is_the_day_closest_to_the_window() {
        let days: Vec<u64> = [0u64, 1, 2, 5, 9, 10]
            .iter()
            .map(|d| D0 + d * DAY_MS)
            .collect();
        let newest = D0 + 10 * DAY_MS;
        assert_eq!(pick_base(&days, newest, 1), Some(D0 + 9 * DAY_MS));
        // 7 days before day 10 is day 3: days 2 and 5 are not exact; 2 is closer.
        assert_eq!(pick_base(&days, newest, 7), Some(D0 + 2 * DAY_MS));
        // 30 days: the oldest stored is the closest.
        assert_eq!(pick_base(&days, newest, 30), Some(D0));
        // A tie (days 4 and 6 around a target of 5) takes the older day.
        let tie: Vec<u64> = [4u64, 6, 10].iter().map(|d| D0 + d * DAY_MS).collect();
        assert_eq!(pick_base(&tie, newest, 5), Some(D0 + 4 * DAY_MS));
        assert_eq!(pick_base(&[newest], newest, 1), None);
        assert_eq!(pick_base(&[], newest, 1), None);
    }

    #[test]
    fn movers_gainers_losers_entered_left() {
        let old = snap(
            0,
            &[("a", 1_000), ("b", 900), ("c", 800), ("d", 700), ("e", 600)],
            Some(10_000),
        );
        let new = snap(
            7,
            &[("b", 1_500), ("a", 950), ("x", 820), ("c", 800), ("e", 650)],
            Some(10_000),
        );
        let nodes = |a: &str| u32::from(a == "b") * 3;
        let m = movers(
            RichMoversWindow::Week,
            Some(&new),
            Some(&old),
            2,
            Vec::new(),
            &nodes,
        );
        assert_eq!(m.window, "7d");
        assert_eq!(m.to_ms, new.fetched_ms);
        assert_eq!(m.from_ms, Some(old.fetched_ms));
        let g: Vec<(&str, i64)> = m
            .gainers
            .iter()
            .map(|x| (x.address.as_str(), x.delta.sat()))
            .collect();
        assert_eq!(g, vec![("b", 600 * 100_000_000), ("e", 50 * 100_000_000)]);
        assert_eq!(m.gainers[0].rank, Some(1));
        assert_eq!(m.gainers[0].prev_rank, Some(2));
        assert_eq!(m.gainers[0].prev_balance, Amount::from_flux(900));
        assert_eq!(m.gainers[0].node_count, 3);
        let l: Vec<(&str, i64)> = m
            .losers
            .iter()
            .map(|x| (x.address.as_str(), x.delta.sat()))
            .collect();
        assert_eq!(l, vec![("a", -50 * 100_000_000)]);
        // An unchanged balance ("c") is no mover.
        assert!(m.gainers.iter().chain(&m.losers).all(|x| x.address != "c"));
        assert_eq!(m.entered.len(), 1);
        assert_eq!((m.entered[0].address.as_str(), m.entered[0].rank), ("x", 3));
        assert_eq!(m.left.len(), 1);
        assert_eq!((m.left[0].address.as_str(), m.left[0].prev_rank), ("d", 4));
        assert_eq!(m.left[0].prev_balance, Amount::from_flux(700));
    }

    #[test]
    fn movers_are_capped_and_sorted_largest_first() {
        let old_rows: Vec<(String, i64)> = (0..40).map(|i| (format!("a{i:02}"), 1_000)).collect();
        let new_rows: Vec<(String, i64)> = (0..40)
            .map(|i| {
                (
                    format!("a{i:02}"),
                    if i % 2 == 0 { 1_000 + i } else { 1_000 - i },
                )
            })
            .collect();
        fn as_ref(v: &[(String, i64)]) -> Vec<(&str, i64)> {
            v.iter().map(|(a, b)| (a.as_str(), *b)).collect()
        }
        let old = snap(0, &as_ref(&old_rows), None);
        let new = snap(1, &as_ref(&new_rows), None);
        let m = movers(
            RichMoversWindow::Day,
            Some(&new),
            Some(&old),
            2,
            Vec::new(),
            &|_| 0,
        );
        assert_eq!(m.gainers.len(), MOVERS_MAX);
        assert_eq!(m.losers.len(), MOVERS_MAX);
        assert_eq!(m.gainers[0].address, "a38");
        assert!(m.gainers.windows(2).all(|w| w[0].delta >= w[1].delta));
        assert_eq!(m.losers[0].address, "a39");
        assert!(m.losers.windows(2).all(|w| w[0].delta <= w[1].delta));
    }

    #[test]
    fn fewer_than_two_snapshots_is_empty() {
        let only = snap(0, &[("a", 1)], Some(10));
        let m = movers(
            RichMoversWindow::Month,
            Some(&only),
            None,
            1,
            Vec::new(),
            &|_| 0,
        );
        assert_eq!(m.from_ms, None);
        assert_eq!(m.to_ms, only.fetched_ms);
        assert!(m.gainers.is_empty() && m.losers.is_empty());
        assert!(m.entered.is_empty() && m.left.is_empty());
        let none = movers(RichMoversWindow::Day, None, None, 0, Vec::new(), &|_| 0);
        assert_eq!((none.to_ms, none.from_ms, none.snapshots), (0, None, 0));
    }

    #[test]
    fn concentration_is_a_share_of_the_supply() {
        let rows: Vec<(String, i64)> = (0..1_200).map(|i| (format!("a{i}"), 10)).collect();
        let refs: Vec<(&str, i64)> = rows.iter().map(|(a, b)| (a.as_str(), *b)).collect();
        let s = snap(0, &refs, Some(100_000));
        let c = concentration_of(&s, None).unwrap();
        assert_eq!(c.day_ms, s.day_ms);
        assert!((c.top10_pct - 0.1).abs() < 1e-9);
        assert!((c.top100_pct - 1.0).abs() < 1e-9);
        assert!(
            (c.top1000_pct - 10.0).abs() < 1e-9,
            "only the top 1,000 count"
        );
        // Without a recorded supply the fallback decides; without either there is no row.
        let bare = snap(0, &refs, None);
        let c = concentration_of(&bare, Some(Amount::from_flux(200_000))).unwrap();
        assert!((c.top1000_pct - 5.0).abs() < 1e-9);
        assert!(concentration_of(&bare, None).is_none());
    }

    #[test]
    fn snapshot_keys_by_utc_day() {
        let rows = RichRows {
            rows: vec![RichListRow {
                address: "t1x".into(),
                blocks_mined: 0,
                balance: 12.5,
            }],
            fetched_ms: D0 + 5 * 3_600_000,
        };
        let s = snapshot_of(&rows, Some(Amount::from_flux(9)));
        assert_eq!(s.day_ms, D0);
        assert_eq!(s.fetched_ms, D0 + 5 * 3_600_000);
        assert_eq!(s.rows[0].balance, Amount::from_flux_f64(12.5).unwrap());
        assert_eq!(
            until_next_day(D0 + DAY_MS - 1_000, Duration::from_secs(120)),
            Duration::from_secs(121)
        );
    }
}

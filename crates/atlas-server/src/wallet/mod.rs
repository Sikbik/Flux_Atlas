//! Wallet intelligence (ARCHITECTURE section 6, Wallet): `GET /wallet/{addr}` (the whole
//! dashboard but parallel assets), `GET /wallet/{addr}/parallel-assets` (Flux Fusion) and
//! `GET /prices` (CoinGecko).
//!
//! - **`/wallet`** is computed from memory (the published nodes, the payout ledger, the hosted
//!   apps, the fleet ledger) plus the node events of the fleet, and two cached explorer lookups
//!   (balance, rich list) that are waited for at most [`UPSTREAM_WAIT`] (`null` after that; they
//!   keep filling the explorer cache behind the answer). One computation per address per 30 s,
//!   shared by concurrent requests; a miss is charged to the client's compute budget.
//! - **`/parallel-assets`** asks Fusion three things at once on the interactive lane and keeps
//!   the answer 10 minutes per address; the fee table and the active chains are kept 12 hours
//!   (last good copy on failure). A failing Fusion is a 503 / 502 `upstream_unavailable`.
//! - **`/prices`** asks CoinGecko on the bulk lane: spot prices every 5 minutes, the year of
//!   daily history every 12 hours, and serves the last good copy while CoinGecko fails.

pub mod activity;
pub mod compute;
pub mod fleet;
pub mod network;
pub mod parallel;

use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use atlas_core::api::PricesDto;
use atlas_core::emission::parallel_asset_accrual;
use atlas_core::{Amount, NodeId, NodeRecord, now_ms};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;

use crate::body::{CachedBody, cache, json_response};
use crate::error::{ApiError, ApiResult};
use crate::extract::{ClientIp, P, check_param};
use crate::proxy::{Fetch, Weigh, guarded};
use crate::routes::explorer::transparent_address;
use crate::sources::{FusionMeta, FusionWallet, Spot};
use crate::state::AppState;

/// Longest the wallet view waits for the explorer's balance and rich list.
pub const UPSTREAM_WAIT: Duration = Duration::from_secs(6);
/// Lifetime of one wallet view.
pub const WALLET_TTL: Duration = Duration::from_secs(30);
/// Lifetime of one address's Fusion answer.
pub const PARALLEL_TTL: Duration = Duration::from_secs(600);
/// Lifetime of Fusion's fee table and active chains.
pub const FUSION_META_TTL: Duration = Duration::from_secs(12 * 3600);
/// Lifetime of the spot prices.
pub const SPOT_TTL: Duration = Duration::from_secs(300);
/// Lifetime of the daily price history.
pub const HISTORY_TTL: Duration = Duration::from_secs(12 * 3600);
/// Lifetime of the fleet ledger. A new keyframe day appears once a day and a rebuild reads one
/// keyframe per stored day (seconds of CPU for a year), so it is rebuilt every 3 hours; the
/// view's last row (today) is always live.
pub const FLEET_TTL: Duration = Duration::from_secs(3 * 3600);

impl Weigh for FusionWallet {
    fn weigh(&self) -> usize {
        size_of::<Self>()
            + self.summary.chain_statistics.len() * 96
            + self
                .claimed
                .transactions
                .iter()
                .map(|t| 96 + t.txid.len() + t.claimed_address.len() + t.chain.len())
                .sum::<usize>()
    }
}

// ---------------------------------------------------------------------------------------------
// GET /wallet/{addr}
// ---------------------------------------------------------------------------------------------

/// `GET /wallet/{addr}` (t1 / t3 addresses).
pub async fn wallet(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(addr): P<String>,
) -> ApiResult<Response> {
    let (addr, _) = transparent_address(check_param("address", &addr)?)?;
    let st = s.clone();
    let body = s
        .wallet_cache
        .try_get_with(addr.clone(), async move {
            build(&st, ip, addr).await.map(Arc::new)
        })
        .await
        .map_err(|e| (*e).clone())?;
    Ok(body.respond(&headers, cache::DERIVED))
}

/// The explorer's balance and rich-list position of `addr`, each `None` when it fails or takes
/// longer than [`UPSTREAM_WAIT`] (the lookup still completes into the explorer cache).
async fn standing_upstream(s: &AppState, ip: IpAddr, addr: &str) -> (Option<Amount>, Option<u32>) {
    let (s1, a1) = (s.clone(), addr.to_owned());
    let balance = tokio::spawn(async move {
        s1.explorer
            .address(Some(ip), &a1)
            .await
            .ok()
            .map(|x| Amount::from_sat(x.balance_sat))
    });
    let (s2, a2) = (s.clone(), addr.to_owned());
    let rank = tokio::spawn(async move {
        let rows = s2.explorer.richlist(Some(ip)).await.ok()?;
        rows.rows
            .iter()
            .position(|r| r.address == a2)
            .map(|i| i as u32 + 1)
    });
    tokio::join!(within(balance), within(rank))
}

/// The task's answer if it completes within [`UPSTREAM_WAIT`]; it keeps running otherwise.
async fn within<T>(h: tokio::task::JoinHandle<Option<T>>) -> Option<T> {
    tokio::time::timeout(UPSTREAM_WAIT, h)
        .await
        .ok()
        .and_then(Result::ok)
        .flatten()
}

async fn build(s: &AppState, ip: IpAddr, addr: String) -> Result<CachedBody, ApiError> {
    // A miss computes: charge the client's compute budget first.
    s.derived.charge(ip)?;
    let v = s.views();
    let positions: Vec<u32> = v.index.by_address(&addr).to_vec();
    let fleet_nodes: Vec<(NodeId, String)> = positions
        .iter()
        .map(|&i| {
            let n = v.at(i as usize);
            (n.id, compute::node_key(n))
        })
        .collect();
    let (upstream, ledger, hosted, fleet, activity) = tokio::join!(
        standing_upstream(s, ip, &addr),
        s.payout_ledger(),
        s.hosted_apps(),
        s.fleet_ledger(),
        s.store_read(move |st| activity::read(st, &fleet_nodes)),
    );
    let (ledger, hosted, activity) = (ledger?, hosted?, activity?);
    let (balance, richlist_rank) = upstream;
    let _slot = s.derived.slot().await?;
    let net = v.wallet_network();
    tokio::task::spawn_blocking(move || {
        let nodes: Vec<&NodeRecord> = positions.iter().map(|&i| v.at(i as usize)).collect();
        let dto = compute::build(compute::WalletInputs {
            address: &addr,
            now_ms: now_ms(),
            views: &v,
            net: &net,
            nodes,
            ledger: &ledger,
            hosted: &hosted,
            balance,
            richlist_rank,
            activity,
            fleet: fleet.as_deref(),
        });
        CachedBody::json(&dto)
    })
    .await
    .map_err(ApiError::from)
}

// ---------------------------------------------------------------------------------------------
// GET /wallet/{addr}/parallel-assets
// ---------------------------------------------------------------------------------------------

/// `GET /wallet/{addr}/parallel-assets`.
pub async fn parallel_assets(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(addr): P<String>,
) -> ApiResult<Response> {
    let (addr, _) = transparent_address(check_param("address", &addr)?)?;
    let meta = fusion_meta(&s).await?;
    let sources = Arc::clone(&s.sources);
    let a = addr.clone();
    let wallet = guarded(
        &s.explorer.guard,
        &s.fusion_wallets,
        Some(ip),
        addr.clone(),
        async move {
            match sources.fusion_wallet(&a).await {
                Ok(w) => Ok(Fetch::Found(w, PARALLEL_TTL)),
                Err(e) => Err(ApiError::third_party("Flux Fusion", &e)),
            }
        },
    )
    .await?;
    let accrual = accrual_per_day(&s, &addr);
    let dto = parallel::dto(&addr, &wallet, &meta, accrual);
    Ok(json_response(&headers, &dto, cache::SLOW))
}

/// Fusion's fee table and active chains (kept 12 hours, the last good copy on failure).
async fn fusion_meta(s: &AppState) -> Result<Arc<FusionMeta>, ApiError> {
    let sources = Arc::clone(&s.sources);
    s.fusion_meta
        .get(move || async move {
            sources
                .fusion_meta()
                .await
                .map_err(|e| ApiError::third_party("Flux Fusion", &e))
        })
        .await
        .map(|(_, v)| v)
}

/// Parallel-asset accrual per day of `addr` at its current run rate, in FLUX; `None` without
/// confirmed nodes.
fn accrual_per_day(s: &AppState, addr: &str) -> Option<f64> {
    let v = s.views();
    let net = v.wallet_network();
    let mut counts = [0u32; 3];
    for &i in v.index.by_address(addr) {
        let n = v.at(i as usize);
        if let (true, Some(t)) = (n.status.is_active(), n.tier.index()) {
            counts[t] += 1;
        }
    }
    if counts.iter().all(|c| *c == 0) {
        return None;
    }
    let tip = v.tip_height().unwrap_or(0);
    let native = compute::run_rate(counts, &net, tip + 1);
    Some(parallel_asset_accrual(native).to_flux_f64())
}

// ---------------------------------------------------------------------------------------------
// GET /prices
// ---------------------------------------------------------------------------------------------

/// `GET /prices`.
pub async fn prices(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let src = Arc::clone(&s.sources);
    let spot = s
        .spot
        .get(move || async move {
            src.spot()
                .await
                .map_err(|e| ApiError::third_party("CoinGecko", &e))
        })
        .await;
    let src = Arc::clone(&s.sources);
    let history = s
        .price_history
        .get(move || async move {
            src.history()
                .await
                .map_err(|e| ApiError::third_party("CoinGecko", &e))
        })
        .await;
    let spot: Arc<Spot> = match spot {
        Ok((_, v)) => v,
        // Nothing from CoinGecko yet: the status bar's price (Insight) still gives USD and BTC.
        Err(e) => match s.views().published.network.price.as_ref() {
            Some(p) if p.usd > 0.0 => Arc::new(Spot {
                prices: [("usd".to_owned(), p.usd), ("btc".to_owned(), p.btc)]
                    .into_iter()
                    .filter(|(_, x)| *x > 0.0)
                    .collect(),
                change_24h_pct: Some(p.change_24h_pct).filter(|c| c.is_finite()),
            }),
            _ => return Err(e),
        },
    };
    let dto = PricesDto {
        generated_ms: now_ms(),
        spot: spot.prices.clone(),
        change_24h_pct: spot.change_24h_pct,
        history: history.map(|(_, h)| (*h).clone()).unwrap_or_default(),
    };
    Ok(json_response(&headers, &dto, cache::SLOW))
}

//! Network hubs (B13, ARCHITECTURE section 6): `GET /network/operators`,
//! `GET /network/nodes-overview` and `GET /network/apps-overview` (the computation lives in
//! [`crate::hubs`]). Each answer is built once per publish; the request that builds it is
//! charged to its client's compute budget and computes in a compute slot, and concurrent
//! requests for the same publish wait for that one computation.

use std::sync::Arc;

use atlas_core::api::{AppsOverviewDto, NodesOverviewDto, OperatorsBy, OperatorsDto};
use atlas_core::now_ms;
use axum::Router;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;

use crate::body::{CachedBody, cache};
use crate::error::{ApiError, ApiResult};
use crate::extract::{ClientIp, Q};
use crate::hubs::{self, CHURN_MAX_AGE, CHURN_MIN_AGE, OperatorTable};
use crate::state::AppState;
use crate::views::{Views, analytics};

/// The hub routes, merged into `/api/v1`.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/network/operators", get(operators))
        .route("/network/nodes-overview", get(nodes_overview))
        .route("/network/apps-overview", get(apps_overview))
}

fn tip_of(v: &Views) -> Result<(u32, u64), ApiError> {
    match (v.tip_height(), v.tip_time_ms()) {
        (Some(t), Some(ms)) => Ok((t, ms)),
        _ => Err(ApiError::unavailable("chain tip not known yet").with_retry_after(5)),
    }
}

#[derive(Debug, Deserialize)]
pub struct OperatorsQuery {
    pub limit: Option<u32>,
    pub by: Option<String>,
}

/// `GET /network/operators?limit&by` (`limit` 1 to 500, default 100; `by` `zelid` (default)
/// or `address`).
pub async fn operators(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    Q(q): Q<OperatorsQuery>,
) -> ApiResult<Response> {
    let limit = match q.limit {
        None => hubs::OPERATORS_DEFAULT,
        Some(n) if (1..=hubs::OPERATORS_MAX).contains(&n) => n,
        Some(_) => {
            return Err(ApiError::bad_request(format!(
                "limit must be 1..={}",
                hubs::OPERATORS_MAX
            )));
        }
    };
    let by = match q.by.as_deref() {
        None => OperatorsBy::Zelid,
        Some(b) => OperatorsBy::parse(b).ok_or_else(|| {
            ApiError::bad_request(format!("unsupported by {b:?}: use zelid or address"))
        })?,
    };
    let v = s.views();
    if let Some(b) = v.hubs.operator_body(by, limit) {
        return Ok(b.respond(&headers, cache::DERIVED));
    }
    let (tip, _) = tip_of(&v)?;
    let table: &Arc<OperatorTable> = v
        .hubs
        .table(by)
        .get_or_try_init(|| async {
            s.derived.charge(ip)?;
            let _slot = s.derived.slot().await?;
            let net = v.wallet_network();
            let v2 = Arc::clone(&v);
            tokio::task::spawn_blocking(move || {
                Arc::new(hubs::operator_table(v2.nodes(), by, tip, &net))
            })
            .await
            .map_err(ApiError::from)
        })
        .await?;
    let n = (limit as usize).min(table.rows.len());
    let body = Arc::new(CachedBody::json(&OperatorsDto {
        generated_ms: now_ms(),
        by,
        total_operators: table.total_operators,
        total_nodes: table.total_nodes,
        operators: table.rows[..n].to_vec(),
    }));
    v.hubs.keep_operator_body(by, limit, &body);
    Ok(body.respond(&headers, cache::DERIVED))
}

/// `GET /network/nodes-overview`.
pub async fn nodes_overview(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
) -> ApiResult<Response> {
    let v = s.views();
    let (tip, _) = tip_of(&v)?;
    let body = v
        .hubs
        .nodes_overview
        .get_or_try_init(|| async {
            s.derived.charge(ip)?;
            let st = s.clone();
            let active = hubs::recently_active(v.nodes(), now_ms());
            let churn = s
                .hubs
                .churn
                .get(
                    now_ms() / CHURN_MIN_AGE.as_millis() as u64,
                    CHURN_MIN_AGE,
                    CHURN_MAX_AGE,
                    move || async move {
                        st.store_read(move |store| hubs::read_churn(store, &active, now_ms()))
                            .await
                    },
                )
                .await?;
            let _slot = s.derived.slot().await?;
            let net = v.wallet_network();
            let v2 = Arc::clone(&v);
            tokio::task::spawn_blocking(move || {
                let now = now_ms();
                let nodes = v2.nodes();
                let (age, age_unknown) = hubs::age_buckets(nodes, now);
                Arc::new(CachedBody::json(&NodesOverviewDto {
                    generated_ms: now,
                    benchmarks: hubs::bench_spreads(&net),
                    age,
                    age_unknown,
                    newest: hubs::newest_nodes(nodes, hubs::NEWEST_NODES),
                    churn: churn.to_vec(),
                    status: hubs::status_counts(nodes, tip),
                }))
            })
            .await
            .map_err(ApiError::from)
        })
        .await?;
    Ok(body.respond(&headers, cache::DERIVED))
}

/// `GET /network/apps-overview`.
pub async fn apps_overview(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
) -> ApiResult<Response> {
    let v = s.views();
    let (tip, tip_ms) = tip_of(&v)?;
    let body = v
        .hubs
        .apps_overview
        .get_or_try_init(|| async {
            s.derived.charge(ip)?;
            let (hosted, ledger) = tokio::join!(s.hosted_apps(), s.app_ledger());
            let (hosted, ledger) = (hosted?, ledger?);
            let _slot = s.derived.slot().await?;
            let v2 = Arc::clone(&v);
            tokio::task::spawn_blocking(move || {
                let now = now_ms();
                let apps = &v2.published.apps;
                let (owners, total_owners) = hubs::owners(apps, hubs::TOP_OWNERS);
                let (countries, unlocated_instances) =
                    hubs::instance_countries(&hosted, |id| v2.node(atlas_core::NodeId(id)));
                Arc::new(CachedBody::json(&AppsOverviewDto {
                    generated_ms: now,
                    tip_height: tip,
                    owners,
                    total_owners,
                    countries,
                    unlocated_instances,
                    resources: hubs::resources(&analytics::capacity(&v2.published)),
                    deployments: hubs::deployments(&ledger, tip, tip_ms, hubs::DEPLOY_DAYS, now),
                    history_complete: ledger.complete,
                    newest: hubs::newest_apps(&ledger, apps, tip, tip_ms, hubs::NEWEST_APPS),
                    expiring: hubs::expiring_apps(apps, tip, hubs::EXPIRING_APPS, |b| v2.eta_ms(b)),
                    enterprise: hubs::enterprise(apps),
                }))
            })
            .await
            .map_err(ApiError::from)
        })
        .await?;
    Ok(body.respond(&headers, cache::DERIVED))
}

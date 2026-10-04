//! Route table (ARCHITECTURE section 6).

pub mod apps;
pub mod explorer;
pub mod hot;
pub mod network;
pub mod nodes;
pub mod ops;
pub mod timeline;

use axum::Router;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::response::IntoResponse;
use axum::routing::get;

use crate::error::ApiError;
use crate::live::ws::ws_handler;
use crate::metrics::{cors, track};
use crate::net;
use crate::state::AppState;

async fn api_not_found() -> impl IntoResponse {
    ApiError::not_found("no such API endpoint")
}

/// Routes that compute per request: behind the per-client and global compute limits.
fn derived(state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/nodes", get(nodes::list))
        .route("/nodes/{key}/history", get(nodes::history))
        .route("/nodes/{key}/payments", get(nodes::payments))
        .route("/operator/{address}", get(nodes::operator))
        .route("/metrics", get(network::series))
        .route("/search", get(crate::search::handler))
        .route("/timeline/state", get(timeline::state))
        .route_layer(from_fn_with_state(state.clone(), crate::derived::guard))
}

/// `/api/v1` routes.
fn api(state: &AppState) -> Router<AppState> {
    Router::new()
        // Hot snapshot bodies.
        .route("/bootstrap", get(hot::bootstrap))
        .route("/nodes.bin", get(hot::nodes))
        .route("/mesh.bin", get(hot::mesh))
        .route("/apps", get(hot::apps))
        // Nodes.
        .route("/nodes/{key}", get(nodes::detail))
        .route("/nodes/{key}/peers", get(nodes::peers))
        // Apps.
        .route("/apps/{name}", get(apps::detail))
        .route("/apps/{name}/history", get(apps::history))
        // Analytics.
        .route("/network/summary", get(network::summary))
        .route("/network/geo", get(network::geo))
        .route("/network/providers", get(network::providers))
        .route("/network/versions", get(network::versions))
        .route("/network/capacity", get(network::capacity))
        .route("/network/decentralization", get(network::decentralization))
        .route("/network/app-economy", get(network::app_economy))
        .route("/network/chain-history", get(network::chain_history))
        // Explorer.
        .route("/blocks", get(explorer::blocks))
        .route("/blocks/{id}", get(explorer::block))
        .route("/tx/{txid}", get(explorer::tx))
        .route("/address/{addr}", get(explorer::address))
        .route("/address/{addr}/txs", get(explorer::address_txs))
        .route("/address/{addr}/utxos", get(explorer::address_utxos))
        .route("/address/{addr}/nodes", get(explorer::address_nodes))
        .route("/mempool", get(explorer::mempool))
        .route("/supply", get(explorer::supply))
        .route("/richlist", get(explorer::richlist))
        .route("/richlist/movers", get(crate::richlist::movers_handler))
        .route("/chain/daily", get(crate::chain_daily::handler))
        // Wallet intelligence (computes on a miss and asks upstream; charged inside).
        .route("/wallet/{addr}", get(crate::wallet::wallet))
        .route(
            "/wallet/{addr}/parallel-assets",
            get(crate::wallet::parallel_assets),
        )
        .route("/prices", get(crate::wallet::prices))
        // Time machine.
        .route("/timeline", get(timeline::index))
        // Live and ops (also mounted at the root).
        .route("/ws", get(ws_handler))
        .route("/healthz", get(ops::healthz))
        .route("/readyz", get(ops::readyz))
        .merge(derived(state))
        .fallback(api_not_found)
        .layer(from_fn(cors))
}

/// The full application router. Every request passes, outermost first: client address
/// resolution, security headers, the request metrics, and the request timeout.
pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api/v1", api(&state))
        .route("/ws", get(ws_handler))
        .route("/healthz", get(ops::healthz))
        .route("/readyz", get(ops::readyz))
        .route("/metrics/prometheus", get(ops::prometheus))
        .fallback(crate::web::serve)
        .layer(from_fn_with_state(state.clone(), net::request_timeout))
        .layer(from_fn_with_state(state.clone(), track))
        .layer(from_fn(net::security_headers))
        .layer(from_fn_with_state(state.clone(), net::client_ip))
        .with_state(state)
}

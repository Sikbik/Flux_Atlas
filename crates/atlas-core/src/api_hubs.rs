//! DTOs of the network hubs (B13): the operator leaderboard (`GET /network/operators`), the
//! nodes overview (`GET /network/nodes-overview`) and the apps overview
//! (`GET /network/apps-overview`). Re-exported from [`crate::api`]; the same conventions apply
//! (times in unix ms, money as [`Amount`], optional values as `null`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::api::{BenchMetric, TierCounts};
use crate::node::Tier;

// ---------------------------------------------------------------------------------------------
// GET /network/operators
// ---------------------------------------------------------------------------------------------

/// What operators are grouped by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum OperatorsBy {
    /// The operator identity: the ZelID when the node reports one, else its payment address
    /// (the grouping of `/network/decentralization`).
    Zelid,
    /// The payment address.
    Address,
}

impl OperatorsBy {
    /// From the query value (`zelid` or `address`, case-insensitive).
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "zelid" => Some(Self::Zelid),
            "address" => Some(Self::Address),
            _ => None,
        }
    }
}

/// The country holding most of an operator's confirmed nodes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct OperatorTopCountry {
    /// ISO 3166-1 alpha-2.
    pub code: String,
    pub name: String,
    pub nodes: u32,
}

/// The provider (ASN) holding most of an operator's confirmed nodes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct OperatorTopProvider {
    /// Route key: `AS<n>`, or the lowercase org name when the ASN is unknown.
    pub key: String,
    /// The org name most of those nodes report.
    pub label: String,
    pub nodes: u32,
}

/// One operator of the leaderboard. Counts are over the operator's confirmed nodes, except
/// `collateral_locked` (every listed node), `dos` and `healthy_pct` (confirmed and DOS nodes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct OperatorRow {
    /// A ZelID or a payment address (see `key_kind`).
    pub key: String,
    /// `address` for a `by=zelid` row of nodes that report no ZelID (grouped by their payment
    /// address instead), else the grouping itself.
    pub key_kind: OperatorsBy,
    /// 1-based position: by confirmed nodes (descending), then key.
    pub rank: u32,
    /// Confirmed nodes.
    pub nodes: u32,
    /// Share of the network's confirmed nodes, 0..1.
    pub share: f64,
    pub tiers: TierCounts,
    /// Distinct countries.
    pub countries: u32,
    pub top_country: Option<OperatorTopCountry>,
    /// Distinct providers (ASN, else org name).
    pub providers: u32,
    pub top_provider: Option<OperatorTopProvider>,
    /// Distinct payment addresses.
    pub addresses: u32,
    /// The payment address of most of its nodes.
    pub top_address: Option<String>,
    /// Native FLUX a day at the current queue lengths (the wallet's run rate: per tier, nodes x
    /// tier payout x 2,880 / queue length).
    pub native_per_day: Amount,
    /// What that accrues a day across the parallel-asset chains, claimable through Flux Fusion
    /// (`emission::parallel_asset_accrual` of `native_per_day`, as the wallet's `pa_per_day`).
    pub pa_per_day: Amount,
    /// Collateral of every listed node (confirmed, started, DOS).
    pub collateral_locked: Amount,
    /// Confirmed nodes that are neither at risk nor unreachable, over confirmed and DOS nodes;
    /// 0..1.
    pub healthy_pct: f64,
    /// Confirmed nodes at risk of expiry (560 or more blocks since the last confirmation).
    pub at_risk: u32,
    /// Confirmed nodes whose API did not answer the last crawl.
    pub unreachable: u32,
    /// Nodes on the DOS list.
    pub dos: u32,
    /// Running app instances on its confirmed nodes.
    pub app_instances: u32,
    /// The earliest `active_since` of its confirmed nodes.
    pub first_active_ms: Option<u64>,
}

/// `GET /network/operators?limit&by`: the top operators by confirmed nodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct OperatorsDto {
    pub generated_ms: u64,
    pub by: OperatorsBy,
    /// Operators with at least one confirmed node.
    pub total_operators: u32,
    /// Confirmed nodes of the network.
    pub total_nodes: u32,
    /// The first `limit` operators, rank order.
    pub operators: Vec<OperatorRow>,
}

// ---------------------------------------------------------------------------------------------
// GET /network/nodes-overview
// ---------------------------------------------------------------------------------------------

/// The network's spread of one benchmark metric in one tier (confirmed nodes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeBenchSpread {
    pub tier: Tier,
    pub metric: BenchMetric,
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
    /// The tier minimum (`Tier::minimums`).
    pub minimum: Option<f64>,
    /// Nodes with the metric measured.
    pub nodes: u32,
}

/// Confirmed nodes whose `active_since` is `min_days` to `max_days` (exclusive) ago.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NodeAgeBucket {
    /// `<7d`, `7-30d`, `1-6mo`, `6-12mo`, `1-2y`, `2y+`.
    pub label: String,
    pub min_days: u32,
    /// `null` for the last, open bucket.
    pub max_days: Option<u32>,
    pub nodes: u32,
}

/// A recently confirmed node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NewestNode {
    /// Collateral outpoint (`txid:n`), the node's URL key.
    pub node_key: String,
    pub tier: Tier,
    pub country_code: Option<String>,
    pub country: Option<String>,
    /// Org name, else the provider key.
    pub provider: Option<String>,
    /// Route key of the provider (`AS<n>` or the lowercase org name).
    pub provider_key: Option<String>,
    pub active_since_ms: u64,
}

/// Window of a churn row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum ChurnSpan {
    #[serde(rename = "24h")]
    Day,
    #[serde(rename = "7d")]
    Week,
}

/// Nodes that joined and left the confirmed set within a window, from the stored node events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NodeChurn {
    pub window: ChurnSpan,
    /// Distinct nodes with an initial confirmation (`NodeConfirmed`).
    pub joined: u32,
    /// Distinct nodes removed from the list (expired, collateral spent or missing; moves to and
    /// from the DOS list are not counted).
    pub left: u32,
    /// The stored events cover the whole window (false on a server younger than it).
    pub complete: bool,
}

/// Node health right now. `healthy`, `at_risk`, `unreachable` and `expiring_soon` are over
/// confirmed nodes; `at_risk` and `unreachable` may overlap, and every at-risk node is also
/// expiring soon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NodeStatusCounts {
    /// Confirmed, not at risk and not unreachable.
    pub healthy: u32,
    /// 560 or more blocks since the last confirmation (the live `node_at_risk` rule).
    pub at_risk: u32,
    /// The API did not answer the last crawl.
    pub unreachable: u32,
    /// On the DOS list.
    pub dos: u32,
    /// Fewer than 120 blocks before the confirmation deadline (the wallet's rule).
    pub expiring_soon: u32,
    /// Confirmed nodes.
    pub confirmed: u32,
    /// Start mined, not confirmed yet.
    pub started: u32,
}

/// `GET /network/nodes-overview`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodesOverviewDto {
    pub generated_ms: u64,
    /// Per tier (Cumulus, Nimbus, Stratus) and metric (`BenchMetric` order) that any confirmed
    /// node measured.
    pub benchmarks: Vec<NodeBenchSpread>,
    /// Six buckets, youngest first.
    pub age: Vec<NodeAgeBucket>,
    /// Confirmed nodes without a known `active_since`.
    pub age_unknown: u32,
    /// The 10 most recently confirmed nodes, newest first.
    pub newest: Vec<NewestNode>,
    /// `24h`, then `7d`.
    pub churn: Vec<NodeChurn>,
    pub status: NodeStatusCounts,
}

// ---------------------------------------------------------------------------------------------
// GET /network/apps-overview
// ---------------------------------------------------------------------------------------------

/// One app owner: its apps in the index and their running instances.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppOwnerRow {
    /// The owner's ZelID.
    pub owner: String,
    pub apps: u32,
    /// Running instances.
    pub instances: u32,
    /// Resources locked by the running instances (per-instance spec x running instances).
    pub cores: f64,
    pub ram_gb: f64,
    pub ssd_gb: f64,
}

/// Running app instances in one country.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppCountryRow {
    pub code: String,
    pub name: String,
    pub instances: u32,
}

/// Cores, RAM and SSD.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct ResourceSum {
    pub cores: f64,
    pub ram_gb: f64,
    pub ssd_gb: f64,
}

/// What apps lock against what the network has.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct AppsResources {
    /// `/network/capacity` `apps_locked`: per-instance spec x running instances over every app
    /// of the index (RAM in GiB: MB / 1024; SSD is the spec's `hdd_gb`).
    pub used: ResourceSum,
    /// `/network/capacity` `total`: the benchmarked cores, RAM and SSD of confirmed nodes.
    pub network: ResourceSum,
}

/// App messages mined on one UTC day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppDeployDay {
    pub day_ms: u64,
    pub registered: u32,
    /// Updates, renewals included.
    pub updated: u32,
}

/// A recent app registration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NewestApp {
    /// Lowercase key.
    pub name: String,
    pub display_name: String,
    /// Height of the registration message.
    pub height: u32,
    /// Block time estimated from the height (see the app economy).
    pub time_ms: Option<u64>,
    /// Running instances now (0 when the app left the index).
    pub instances: u32,
}

/// An app close to its expiry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExpiringApp {
    pub name: String,
    pub display_name: String,
    pub expire_height: u32,
    pub blocks_left: u32,
    /// Estimated time of the expiry block.
    pub expire_ms: u64,
    pub instances: u32,
}

/// Enterprise (encrypted spec) apps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct EnterpriseTotals {
    pub apps: u32,
    pub instances: u32,
}

/// `GET /network/apps-overview`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppsOverviewDto {
    pub generated_ms: u64,
    pub tip_height: u32,
    /// The 25 owners with most running instances.
    pub owners: Vec<AppOwnerRow>,
    /// Distinct owners in the app index.
    pub total_owners: u32,
    /// Where the running instances are (the stored app locations), most first.
    pub countries: Vec<AppCountryRow>,
    /// Instances on nodes without a known country.
    pub unlocated_instances: u32,
    pub resources: AppsResources,
    /// The last 90 UTC days, oldest first, today last (partial).
    pub deployments: Vec<AppDeployDay>,
    /// The one-time permanent-message backfill has finished; until then `deployments` and
    /// `newest` cover only the messages this server has seen.
    pub history_complete: bool,
    /// The 10 most recent registrations (one per app), newest first.
    pub newest: Vec<NewestApp>,
    /// The 10 apps whose expiry is soonest (expired apps are not listed).
    pub expiring: Vec<ExpiringApp>,
    pub enterprise: EnterpriseTotals,
}

/// Exports the hub DTOs (called by [`crate::export_typescript`]).
pub(crate) fn export(cfg: &ts_rs::Config) -> Result<(), ts_rs::ExportError> {
    OperatorsDto::export_all(cfg)?;
    NodesOverviewDto::export_all(cfg)?;
    AppsOverviewDto::export_all(cfg)?;
    Ok(())
}

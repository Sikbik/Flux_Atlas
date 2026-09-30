//! HTTP API DTOs for `/api/v1` (ARCHITECTURE section 6). Every type here is exported to
//! TypeScript (`web/src/api/generated/`) and is the frontend contract.
//!
//! Conventions: times are unix milliseconds (`*_ms`), heights are `u32`, money is [`Amount`]
//! (a FLUX decimal string on the wire), float aggregates in FLUX end in `_flux_f64`. Optional
//! values serialize as `null`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::app::{AppSpec, Resources};
use crate::chain::{BlockKind, NodeTxKind, TxKind};
use crate::ids::{Hash32, NodeId, Outpoint};
use crate::live::FeedItem;
use crate::node::{Geo, Hardware, NodeStatus, Tier, Versions};

// ---------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------

/// Compact reference to a node, enough to place and label it without `nodes.bin`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeRef {
    pub id: NodeId,
    pub outpoint: Outpoint,
    pub tier: Tier,
    /// `ip:port`, when known.
    pub endpoint: Option<String>,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub country_code: Option<String>,
}

/// Node counts per tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct TierCounts {
    pub cumulus: u32,
    pub nimbus: u32,
    pub stratus: u32,
    pub total: u32,
}

impl TierCounts {
    pub fn add(&mut self, tier: Tier) {
        match tier {
            Tier::Cumulus => self.cumulus += 1,
            Tier::Nimbus => self.nimbus += 1,
            Tier::Stratus => self.stratus += 1,
            Tier::Unknown => {}
        }
        self.total += 1;
    }

    pub fn get(&self, tier: Tier) -> u32 {
        match tier {
            Tier::Cumulus => self.cumulus,
            Tier::Nimbus => self.nimbus,
            Tier::Stratus => self.stratus,
            Tier::Unknown => self.total - self.cumulus - self.nimbus - self.stratus,
        }
    }
}

/// Generic labelled count used by analytics breakdowns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CountBucket {
    /// Stable key (country code, ASN, version string, ...).
    pub key: String,
    /// Human label.
    pub label: String,
    pub count: u32,
    /// Fraction of the whole, 0..1.
    pub share: f64,
}

/// Build and runtime information about this server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    /// Wire protocol version of `/api/v1` and `/ws`.
    pub api_version: u32,
    pub started_ms: u64,
}

/// Freshness of one ingest job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct JobFreshness {
    /// Job name (`chain_stream`, `node_reconcile`, `host_sweep`, ...).
    pub job: String,
    pub last_ok_ms: Option<u64>,
    pub last_error: Option<String>,
    pub last_error_ms: Option<u64>,
    /// True when the job's data is older than its freshness tier allows.
    pub stale: bool,
    /// When the job runs next (unix ms); `None` for push-driven or event-triggered jobs.
    #[serde(default)]
    pub next_run_ms: Option<u64>,
}

/// The chain tip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TipInfo {
    pub height: u32,
    pub hash: Hash32,
    pub time_ms: u64,
    pub producer: Option<NodeId>,
}

/// Market price.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PriceInfo {
    pub usd: f64,
    pub btc: f64,
    pub change_24h_pct: f64,
    pub market_cap_usd: f64,
    pub volume_24h_usd: f64,
    pub updated_ms: u64,
    /// `insight` (Flux-provided) or `coingecko`.
    pub source: String,
}

/// Supply figures.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SupplyInfo {
    pub height: u32,
    /// Transparent supply (`gettxoutsetinfo.total_amount`).
    pub transparent: Amount,
    /// Shielded pools (sprout + sapling).
    pub shielded: Amount,
    /// transparent + shielded.
    pub total: Amount,
    /// Explorer's "circulating" figure (exclusion rule undocumented upstream).
    pub circulating_explorer: Option<Amount>,
    pub updated_ms: u64,
}

// ---------------------------------------------------------------------------------------------
// /bootstrap
// ---------------------------------------------------------------------------------------------

/// Network-wide summary (also pushed as the live `stats` message).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NetworkSummary {
    pub node_count: u32,
    pub host_count: u32,
    pub tiers: TierCounts,
    pub country_count: u32,
    pub provider_count: u32,
    pub arcane_count: u32,
    pub unreachable_count: u32,
    pub app_count: u32,
    pub instance_count: u32,
    pub tip: Option<TipInfo>,
    /// Current block subsidy.
    pub reward: Amount,
    pub next_reduction_height: Option<u32>,
    pub supply: Option<SupplyInfo>,
    pub price: Option<PriceInfo>,
    pub mempool_size: u32,
}

/// Per-tier economics and queue state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TierStats {
    pub tier: Tier,
    pub count: u32,
    pub collateral: Amount,
    /// Payout per block to this tier's queue head.
    pub payout: Amount,
    /// Approximate payment cycle in blocks (about the tier's node count).
    pub cycle_blocks: u32,
    /// Head of the payment queue ("next to be paid").
    pub next: Option<NodeRef>,
}

/// One node payout inside a block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PayoutDto {
    pub tier: Tier,
    pub node: Option<NodeId>,
    pub address: String,
    pub amount: Amount,
}

/// Block list row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BlockLite {
    pub height: u32,
    pub hash: Hash32,
    pub time_ms: u64,
    pub size: u32,
    pub tx_count: u32,
    pub kind: BlockKind,
    pub producer: Option<NodeId>,
    pub payouts: Vec<PayoutDto>,
    pub reward: Amount,
    pub fees: Amount,
    pub confirm_count: u16,
    pub start_count: u16,
    pub transfer_count: u16,
}

/// App index row (bootstrap, `/apps`, live `apps.upserted`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppIndexEntry {
    /// Lowercase key.
    pub name: String,
    pub display_name: String,
    pub owner: String,
    pub spec_version: u8,
    pub instances_target: u32,
    pub instances_running: u32,
    pub component_count: u32,
    pub enterprise: bool,
    pub per_instance: Resources,
    pub totals: Resources,
    pub height: u32,
    pub expire_height: u32,
}

/// `GET /bootstrap`: everything a client needs to boot, in one response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BootstrapDto {
    pub server: ServerInfo,
    /// Publish sequence the body was built from; subscribe with `since_seq` = this.
    pub seq: u64,
    pub generated_ms: u64,
    /// True while serving restored last-known state before fresh ingest.
    pub stale: bool,
    pub network: NetworkSummary,
    pub tiers: Vec<TierStats>,
    /// Latest blocks, newest first (30).
    pub blocks: Vec<BlockLite>,
    pub apps: Vec<AppIndexEntry>,
    pub freshness: Vec<JobFreshness>,
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

/// Sort keys for `GET /nodes`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NodeSort {
    #[default]
    Id,
    Rank,
    Tier,
    Country,
    Org,
    LastPaid,
    LastConfirmed,
    Added,
    AppCount,
}

/// Query of `GET /nodes`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct NodesQuery {
    pub tier: Option<Tier>,
    pub status: Option<NodeStatus>,
    /// Country code.
    pub country: Option<String>,
    pub org: Option<String>,
    /// Free text: IP, address, collateral prefix, org.
    pub q: Option<String>,
    pub sort: Option<NodeSort>,
    pub desc: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

/// Node table row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeRow {
    pub id: NodeId,
    pub outpoint: Outpoint,
    pub endpoint: Option<String>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub rank: Option<u32>,
    pub payment_address: String,
    pub country_code: Option<String>,
    pub country: Option<String>,
    pub org: Option<String>,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub app_count: u16,
    pub added_height: u32,
    pub last_paid_height: Option<u32>,
    pub last_confirmed_height: Option<u32>,
    pub flux_os: Option<String>,
    pub arcane: Option<bool>,
    pub reachable: Option<bool>,
}

/// `GET /nodes` page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodesPage {
    pub items: Vec<NodeRow>,
    pub total: u32,
    pub next_cursor: Option<String>,
}

/// Full node record for detail views.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeDto {
    pub id: NodeId,
    pub outpoint: Outpoint,
    pub endpoint: Option<String>,
    /// FluxOS UI URL (`http://ip:apiport-1`).
    pub ui_url: Option<String>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub payment_address: String,
    pub pubkey: String,
    pub rank: Option<u32>,
    pub added_height: u32,
    pub confirmed_height: Option<u32>,
    pub last_confirmed_height: Option<u32>,
    pub last_paid_height: Option<u32>,
    pub active_since_ms: Option<u64>,
    pub geo: Option<Geo>,
    pub hardware: Option<Hardware>,
    pub versions: Versions,
    pub arcane: Option<bool>,
    pub zelid: Option<String>,
    pub upnp: Option<bool>,
    pub static_ip: Option<bool>,
    pub reachable: Option<bool>,
    pub app_count: u16,
    pub peers_out: u16,
    pub peers_in: u16,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub last_swept_ms: Option<u64>,
    pub departed_ms: Option<u64>,
}

/// When a node will next be paid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PaymentEta {
    pub rank: u32,
    pub tier_size: u32,
    pub eta_blocks: u32,
    pub eta_ms: u64,
    pub amount: Amount,
}

/// Minimal app reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppRef {
    pub name: String,
    pub display_name: String,
}

/// `GET /nodes/{id|ip|outpoint}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeDetailDto {
    pub node: NodeDto,
    pub payment_eta: Option<PaymentEta>,
    /// Blocks until expiry if no confirm arrives.
    pub expires_in_blocks: Option<u32>,
    pub apps: Vec<AppRef>,
    /// Other nodes on the same host.
    pub co_hosted: Vec<NodeId>,
    pub recent_events: Vec<FeedItem>,
}

/// A span of constant status in a node's history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct StatusSegment {
    pub from_ms: u64,
    pub to_ms: u64,
    pub status: NodeStatus,
}

/// `GET /nodes/{id}/history`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeHistoryDto {
    pub id: NodeId,
    pub from_ms: u64,
    pub to_ms: u64,
    /// Share of the window the node was confirmed, 0..100.
    pub uptime_pct: f64,
    pub segments: Vec<StatusSegment>,
    pub events: Vec<FeedItem>,
}

/// One payment to a node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PaymentRow {
    pub height: u32,
    pub time_ms: u64,
    pub amount: Amount,
    pub address: String,
    pub tier: Tier,
}

/// `GET /nodes/{id}/payments`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NodePaymentsPage {
    pub id: NodeId,
    pub items: Vec<PaymentRow>,
    pub total_paid: Amount,
    pub next_cursor: Option<String>,
}

/// Direction of a peer link as reported by the crawled node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PeerDirection {
    Outbound,
    Inbound,
    Both,
}

/// One peer of a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PeerDto {
    /// Resolved node, when the peer maps to a known node.
    pub id: Option<NodeId>,
    pub endpoint: String,
    pub direction: PeerDirection,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub country_code: Option<String>,
    pub latency_ms: Option<u32>,
}

/// `GET /nodes/{id}/peers`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodePeersDto {
    pub id: NodeId,
    pub swept_ms: Option<u64>,
    pub peers: Vec<PeerDto>,
}

// ---------------------------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------------------------

/// `GET /apps`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppsIndexDto {
    pub seq: u64,
    pub generated_ms: u64,
    pub apps: Vec<AppIndexEntry>,
}

/// One running instance of an app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppInstanceDto {
    pub node: Option<NodeId>,
    pub endpoint: String,
    /// Spec hash this instance runs (differs from the app's during rolling updates).
    pub spec_hash: Option<Hash32>,
    pub running_since_ms: Option<u64>,
    pub broadcast_ms: u64,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub country_code: Option<String>,
}

/// What an app history entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AppChangeKind {
    Registered,
    Updated,
    Renewed,
    Expired,
}

/// One entry of an app's spec history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppHistoryEntry {
    pub height: u32,
    pub time_ms: Option<u64>,
    pub kind: AppChangeKind,
    pub spec_hash: Option<Hash32>,
    pub spec_version: u8,
    /// Field paths that changed relative to the previous entry.
    pub changed: Vec<String>,
    /// FLUX paid for the message.
    pub paid: Option<Amount>,
}

/// `GET /apps/{name}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppDetailDto {
    pub name: String,
    pub display_name: String,
    pub spec: AppSpec,
    pub spec_hash: Option<Hash32>,
    pub height: u32,
    pub registered_height: Option<u32>,
    pub expire_height: u32,
    pub totals: Resources,
    pub instances: Vec<AppInstanceDto>,
    pub first_seen_ms: u64,
    pub updated_ms: u64,
}

/// `GET /apps/{name}/history`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppHistoryDto {
    pub name: String,
    pub entries: Vec<AppHistoryEntry>,
}

// ---------------------------------------------------------------------------------------------
// Network analytics
// ---------------------------------------------------------------------------------------------

/// `GET /network/geo`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct GeoBreakdownDto {
    pub continents: Vec<CountBucket>,
    pub countries: Vec<CountBucket>,
    pub regions: Vec<CountBucket>,
    pub unlocated: u32,
}

/// One provider (grouped by ASN, falling back to org).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProviderBucket {
    pub asn: Option<u32>,
    pub org: String,
    pub nodes: u32,
    pub hosts: u32,
    pub countries: u32,
    pub share: f64,
}

/// `GET /network/providers`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProvidersDto {
    pub providers: Vec<ProviderBucket>,
    /// Share of located nodes in hosting / datacenter networks, 0..1.
    pub hosting_share: f64,
}

/// `GET /network/versions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct VersionsDto {
    pub flux_os: Vec<CountBucket>,
    pub daemon: Vec<CountBucket>,
    pub bench: Vec<CountBucket>,
    pub arcane: Vec<CountBucket>,
    pub os: Vec<CountBucket>,
}

/// Benchmarked capacity totals.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct CapacityTotals {
    pub nodes: u32,
    pub cores: u64,
    pub ram_gb: f64,
    pub ssd_gb: f64,
    pub down_mbps: f64,
    pub up_mbps: f64,
}

/// `GET /network/capacity`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CapacityDto {
    pub total: CapacityTotals,
    pub by_tier: Vec<TierCapacity>,
    /// Resources requested by public app specs (target instances).
    pub apps_requested: Resources,
    /// Resources locked by running apps as reported by nodes.
    pub apps_locked: Resources,
}

/// Capacity of one tier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TierCapacity {
    pub tier: Tier,
    pub totals: CapacityTotals,
}

/// `GET /network/decentralization`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DecentralizationDto {
    /// Smallest number of countries holding more than half of the nodes.
    pub nakamoto_country: u32,
    pub nakamoto_provider: u32,
    pub nakamoto_operator: u32,
    /// Herfindahl-Hirschman index, 0..1.
    pub hhi_country: f64,
    pub hhi_provider: f64,
    pub top_operators: Vec<CountBucket>,
    /// Hosts running more than one node.
    pub multi_node_hosts: u32,
}

/// `GET /metrics?series=a,b&from&to&step`. Columnar: `series[name][i]` belongs to `t[i]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct MetricsSeriesDto {
    pub from_ms: u64,
    pub to_ms: u64,
    pub step_ms: u64,
    pub t: Vec<u64>,
    pub series: BTreeMap<String, Vec<Option<f64>>>,
}

// ---------------------------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------------------------

/// `GET /blocks?before&limit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BlocksPage {
    pub items: Vec<BlockLite>,
    /// Pass as `before` to fetch the next (older) page.
    pub next_before: Option<u32>,
}

/// Mempool / block transaction row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TxLite {
    pub txid: Hash32,
    /// Sum of outputs.
    pub value: Amount,
    pub kind: TxKind,
    pub size: u32,
}

/// `GET /blocks/{height|hash}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BlockDetailDto {
    pub block: BlockLite,
    pub prev_hash: Hash32,
    pub next_hash: Option<Hash32>,
    pub confirmations: u32,
    pub version: u32,
    /// Producer collateral as given by the header (possibly a 10-hex prefix, `txid:n`).
    pub producer_collateral: Option<String>,
    pub producer_ref: Option<NodeRef>,
    pub dev_fund: Amount,
    pub value_out: Amount,
    pub txs: Vec<TxLite>,
    pub node_txs: Vec<NodeTxDto>,
}

/// A transaction input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TxInputDto {
    pub coinbase: bool,
    pub prev_txid: Option<Hash32>,
    pub prev_vout: Option<u32>,
    pub address: Option<String>,
    pub value: Option<Amount>,
}

/// A transaction output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TxOutputDto {
    pub n: u32,
    pub address: Option<String>,
    pub value: Amount,
    /// `pubkeyhash`, `scripthash`, `nulldata`, ...
    pub script_type: String,
    pub spent_txid: Option<Hash32>,
    pub spent_height: Option<u32>,
    /// Decoded OP_RETURN payload as text, when printable.
    pub op_return: Option<String>,
}

/// Fluxnode fields of a start/confirm transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NodeTxDto {
    pub txid: Hash32,
    pub kind: NodeTxKind,
    pub collateral: Outpoint,
    pub endpoint: Option<String>,
    pub benchmark_tier: Option<Tier>,
    pub sig_time_ms: u64,
    pub tx_version: u8,
    pub p2sh: bool,
    pub node: Option<NodeId>,
}

/// `GET /tx/{txid}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TxDetailDto {
    pub txid: Hash32,
    pub height: Option<u32>,
    pub block_hash: Option<Hash32>,
    pub time_ms: Option<u64>,
    pub confirmations: u32,
    pub size: u32,
    pub version: u32,
    pub kind: TxKind,
    pub inputs: Vec<TxInputDto>,
    pub outputs: Vec<TxOutputDto>,
    pub value_in: Option<Amount>,
    pub value_out: Amount,
    pub fee: Option<Amount>,
    pub node_tx: Option<NodeTxDto>,
}

/// Address kinds recognized locally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AddressKind {
    P2pkh,
    P2sh,
    Sapling,
    Sprout,
    Unknown,
}

/// `GET /address/{addr}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AddressDto {
    pub address: String,
    pub kind: AddressKind,
    pub balance: Amount,
    pub received: Amount,
    pub sent: Amount,
    pub unconfirmed_balance: Amount,
    pub tx_count: u32,
    /// Nodes paying out to this address.
    pub node_counts: TierCounts,
}

/// `GET /address/{addr}/txs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AddressTxsPage {
    pub address: String,
    pub items: Vec<TxDetailDto>,
    pub total: u32,
    pub next_cursor: Option<String>,
}

/// `GET /address/{addr}/nodes`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AddressNodesDto {
    pub address: String,
    pub nodes: Vec<NodeRow>,
}

/// `GET /mempool`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MempoolDto {
    pub txs: Vec<TxLite>,
    pub size: u32,
    pub bytes: u64,
    pub updated_ms: u64,
}

/// `GET /supply`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SupplyDto {
    pub supply: Option<SupplyInfo>,
    pub reward: Amount,
    pub emission_per_day: Amount,
    pub next_reduction_height: Option<u32>,
    pub blocks_to_reduction: Option<u32>,
    /// Announced cap (560M), shown as a reference line only; not enforced by consensus code.
    pub max_supply_reference: Amount,
}

/// One rich-list row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RichListEntry {
    pub rank: u32,
    pub address: String,
    pub balance: Amount,
    pub share_pct: f64,
    pub node_count: u32,
}

/// `GET /richlist`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RichListDto {
    pub updated_ms: u64,
    pub entries: Vec<RichListEntry>,
}

// ---------------------------------------------------------------------------------------------
// Search, time machine, operator, errors, ops
// ---------------------------------------------------------------------------------------------

/// What a search hit points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    Node,
    Block,
    Tx,
    Address,
    App,
    Host,
    Shielded,
}

/// A typed search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SearchHit {
    pub kind: SearchKind,
    /// Route key (node id, height, txid, address, app name, ip).
    pub key: String,
    pub label: String,
    pub sublabel: Option<String>,
}

/// `GET /search?q=`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SearchResultsDto {
    pub q: String,
    pub hits: Vec<SearchHit>,
}

/// `GET /timeline`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TimelineDto {
    pub first_ms: Option<u64>,
    pub last_ms: Option<u64>,
    /// Snapshot keyframe times available for fast reconstruction.
    pub keyframes_ms: Vec<u64>,
    pub event_count: u64,
}

/// A predicted payment for an operator's node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NextPayment {
    pub node: NodeId,
    pub eta_blocks: u32,
    pub eta_ms: u64,
    pub amount: Amount,
}

/// `GET /operator/{address}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct OperatorDto {
    pub address: String,
    pub nodes: Vec<NodeRow>,
    pub tiers: TierCounts,
    pub collateral_locked: Amount,
    pub earned_24h: Amount,
    pub earned_30d: Amount,
    pub next_payments: Vec<NextPayment>,
}

/// Machine-readable error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    NotFound,
    BadRequest,
    Upstream,
    Unavailable,
    RateLimited,
    Internal,
}

/// Error body inside [`ApiErrorDto`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ApiErrorBody {
    pub code: ApiErrorCode,
    pub message: String,
}

/// Error response: `{"error":{"code":"not_found","message":"..."}}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ApiErrorDto {
    pub error: ApiErrorBody,
}

impl ApiErrorDto {
    pub fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self {
            error: ApiErrorBody {
                code,
                message: message.into(),
            },
        }
    }
}

/// `GET /healthz` and `/readyz`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HealthDto {
    /// `ok`, `starting` or `degraded`.
    pub status: String,
    pub seq: u64,
    pub uptime_s: u64,
    pub tip_height: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_shape() {
        let e = ApiErrorDto::new(ApiErrorCode::NotFound, "no such node");
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"error":{"code":"not_found","message":"no such node"}}"#
        );
    }

    #[test]
    fn tier_counts() {
        let mut c = TierCounts::default();
        c.add(Tier::Cumulus);
        c.add(Tier::Stratus);
        c.add(Tier::Unknown);
        assert_eq!(c.total, 3);
        assert_eq!(c.get(Tier::Unknown), 1);
    }
}

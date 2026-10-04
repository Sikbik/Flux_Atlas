//! Insight explorer API models (`https://explorer.runonflux.io/api`): blocks, block lists,
//! transactions (including decoded fluxnode fields), addresses, UTXOs, statistics, rich list,
//! supply, markets and status. Plain JSON, no envelope. Plus the CoinGecko price fallback.

use std::collections::BTreeMap;

use atlas_core::chain::{NodeTx, NodeTxKind};
use atlas_core::{Amount, Hash32, NodeEndpoint, Outpoint, Tier};
use serde::Deserialize;

use crate::lenient;

/// `nodesCollateral` of a PoN block.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodesCollateral {
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub index: Option<u32>,
}

/// `GET /api/block/<hash>`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightBlock {
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub tx: Vec<String>,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub time: u64,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub confirmations: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub previousblockhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub nextblockhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub reward: Option<f64>,
    #[serde(rename = "isMainChain", deserialize_with = "lenient::opt_bool")]
    pub is_main_chain: Option<bool>,
    /// The Stratus payee on PoN blocks, NOT the producer.
    #[serde(rename = "minedBy", deserialize_with = "lenient::opt_string")]
    pub mined_by: Option<String>,
    #[serde(rename = "isPON", deserialize_with = "lenient::opt_bool")]
    pub is_pon: Option<bool>,
    #[serde(rename = "blockType", deserialize_with = "lenient::opt_string")]
    pub block_type: Option<String>,
    /// Producer collateral with the full txid.
    #[serde(rename = "nodesCollateral", deserialize_with = "lenient::opt_lenient")]
    pub nodes_collateral: Option<NodesCollateral>,
    #[serde(rename = "blockSignature", deserialize_with = "lenient::opt_string")]
    pub block_signature: Option<String>,
}

impl InsightBlock {
    /// Producer outpoint with the full txid (PoN blocks only).
    pub fn producer(&self) -> Option<Outpoint> {
        let c = self.nodes_collateral.as_ref()?;
        Some(Outpoint::new(Hash32::from_hex(&c.hash).ok()?, c.index?))
    }
}

/// Row of `GET /api/blocks`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightBlockRow {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub time: u64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub txlength: u32,
    #[serde(rename = "minedBy", deserialize_with = "lenient::opt_string")]
    pub mined_by: Option<String>,
}

/// Pagination of `GET /api/blocks`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BlocksPagination {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub next: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub prev: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub current: Option<String>,
    #[serde(rename = "currentTs", deserialize_with = "lenient::opt_u64")]
    pub current_ts: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub more: Option<bool>,
    #[serde(rename = "moreTs", deserialize_with = "lenient::opt_u64")]
    pub more_ts: Option<u64>,
}

/// `GET /api/blocks?limit=N[&blockDate=..]`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightBlocksPage {
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub blocks: Vec<InsightBlockRow>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub length: u32,
    pub pagination: BlocksPagination,
}

/// `GET /api/block-index/<height>`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BlockIndex {
    #[serde(rename = "blockHash", deserialize_with = "lenient::string")]
    pub block_hash: String,
}

/// Insight script.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightScript {
    #[serde(deserialize_with = "lenient::string")]
    pub hex: String,
    #[serde(deserialize_with = "lenient::string")]
    pub asm: String,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub addresses: Vec<String>,
    #[serde(rename = "type", deserialize_with = "lenient::string")]
    pub kind: String,
}

/// Insight input (with prevout value and address).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightVin {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub coinbase: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub txid: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub vout: Option<u32>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub n: u32,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub addr: Option<String>,
    #[serde(rename = "valueSat", deserialize_with = "lenient::opt_i64")]
    pub value_sat: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub value: Option<f64>,
}

/// Insight output. `value` is a FLUX decimal string.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightVout {
    #[serde(deserialize_with = "lenient::string")]
    pub value: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub n: u32,
    #[serde(rename = "scriptPubKey")]
    pub script_pub_key: InsightScript,
    #[serde(rename = "spentTxId", deserialize_with = "lenient::opt_string")]
    pub spent_tx_id: Option<String>,
    #[serde(rename = "spentIndex", deserialize_with = "lenient::opt_u32")]
    pub spent_index: Option<u32>,
    #[serde(rename = "spentHeight", deserialize_with = "lenient::opt_u32")]
    pub spent_height: Option<u32>,
}

impl InsightVout {
    pub fn amount(&self) -> Amount {
        self.value.parse().unwrap_or_default()
    }
}

/// `GET /api/tx/<txid>`: regular, coinbase or fluxnode transaction.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightTx {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub blockhash: Option<String>,
    /// -1 for mempool transactions.
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub blockheight: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub confirmations: Option<i64>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub time: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub blocktime: Option<u64>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub vin: Vec<InsightVin>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub vout: Vec<InsightVout>,
    #[serde(rename = "valueOut", deserialize_with = "lenient::opt_f64")]
    pub value_out: Option<f64>,
    #[serde(rename = "valueIn", deserialize_with = "lenient::opt_f64")]
    pub value_in: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub fees: Option<f64>,
    #[serde(rename = "isCoinBase", deserialize_with = "lenient::opt_bool")]
    pub is_coinbase: Option<bool>,
    // Fluxnode fields (Insight naming)
    #[serde(rename = "type", deserialize_with = "lenient::opt_string")]
    pub kind: Option<String>,
    /// 2 = start, 4 = confirm.
    #[serde(rename = "nType", deserialize_with = "lenient::opt_i64")]
    pub n_type: Option<i64>,
    #[serde(
        rename = "collateralOutputHash",
        deserialize_with = "lenient::opt_string"
    )]
    pub collateral_output_hash: Option<String>,
    #[serde(
        rename = "collateralOutputIndex",
        deserialize_with = "lenient::opt_u32"
    )]
    pub collateral_output_index: Option<u32>,
    #[serde(rename = "sigTime", deserialize_with = "lenient::opt_u64")]
    pub sig_time: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub ip: Option<String>,
    #[serde(rename = "updateType", deserialize_with = "lenient::opt_i64")]
    pub update_type: Option<i64>,
    #[serde(rename = "benchmarkTier", deserialize_with = "lenient::opt_string")]
    pub benchmark_tier: Option<String>,
    #[serde(rename = "nFluxNodeTxVersion", deserialize_with = "lenient::opt_u32")]
    pub n_flux_node_tx_version: Option<u32>,
    #[serde(rename = "redeemScript", deserialize_with = "lenient::opt_string")]
    pub redeem_script: Option<String>,
    #[serde(rename = "collateralPubKey", deserialize_with = "lenient::opt_string")]
    pub collateral_pub_key: Option<String>,
    #[serde(rename = "fluxnodePubKey", deserialize_with = "lenient::opt_string")]
    pub fluxnode_pub_key: Option<String>,
    /// Legacy name of the same key (both are sent).
    #[serde(rename = "zelnodePubKey", deserialize_with = "lenient::opt_string")]
    pub zelnode_pub_key: Option<String>,
}

impl InsightTx {
    pub fn is_fluxnode(&self) -> bool {
        self.n_type.is_some() || self.collateral_output_hash.is_some()
    }

    /// Height when mined.
    pub fn height(&self) -> Option<u32> {
        self.blockheight.and_then(|h| u32::try_from(h).ok())
    }

    /// Decodes the fluxnode fields into a [`NodeTx`].
    pub fn node_tx(&self) -> Option<NodeTx> {
        if !self.is_fluxnode() {
            return None;
        }
        let collateral = Outpoint::new(
            Hash32::from_hex(self.collateral_output_hash.as_deref()?).ok()?,
            self.collateral_output_index?,
        );
        let kind = match (self.n_type, self.kind.as_deref()) {
            (Some(2), _) => NodeTxKind::Start,
            (_, Some(k)) if k.starts_with("Start") => NodeTxKind::Start,
            _ => NodeTxKind::from_update_type(self.update_type.unwrap_or(-1)),
        };
        let upgraded = self
            .n_flux_node_tx_version
            .and_then(|v| u16::try_from(v).ok());
        Some(NodeTx {
            txid: Hash32::from_hex(&self.txid).ok()?,
            height: self.height(),
            kind,
            collateral,
            endpoint: self
                .ip
                .as_deref()
                .and_then(|ip| NodeEndpoint::parse_opt(ip).ok().flatten()),
            benchmark_tier: self
                .benchmark_tier
                .as_deref()
                .map(Tier::parse_lenient)
                .filter(|t| *t != Tier::Unknown),
            sig_time: self.sig_time.unwrap_or(0),
            tx_version: u8::try_from(self.version).unwrap_or(0),
            upgraded_version: upgraded,
            p2sh: self.redeem_script.is_some() || upgraded.is_some_and(|v| v & 0x02 != 0),
            node: None,
        })
    }
}

/// `GET /api/txs?block=<hash>&pageNum=N` / `?address=`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightTxsPage {
    #[serde(rename = "pagesTotal", deserialize_with = "lenient::u32_or_zero")]
    pub pages_total: u32,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub txs: Vec<InsightTx>,
}

/// `GET /api/addrs/<a>/txs?from&to`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightAddrTxs {
    #[serde(rename = "totalItems", deserialize_with = "lenient::u32_or_zero")]
    pub total_items: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub from: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub to: u32,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub items: Vec<InsightTx>,
}

/// `GET /api/addr/<a>[?noTxList=1]`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightAddrSummary {
    #[serde(rename = "addrStr", deserialize_with = "lenient::string")]
    pub addr_str: String,
    #[serde(rename = "balanceSat", deserialize_with = "lenient::i64_or_zero")]
    pub balance_sat: i64,
    #[serde(rename = "totalReceivedSat", deserialize_with = "lenient::i64_or_zero")]
    pub total_received_sat: i64,
    #[serde(rename = "totalSentSat", deserialize_with = "lenient::i64_or_zero")]
    pub total_sent_sat: i64,
    #[serde(
        rename = "unconfirmedBalanceSat",
        deserialize_with = "lenient::i64_or_zero"
    )]
    pub unconfirmed_balance_sat: i64,
    /// Upstream spelling.
    #[serde(rename = "txApperances", deserialize_with = "lenient::u32_or_zero")]
    pub tx_appearances: u32,
    #[serde(
        rename = "unconfirmedTxApperances",
        deserialize_with = "lenient::u32_or_zero"
    )]
    pub unconfirmed_tx_appearances: u32,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub transactions: Vec<String>,
}

/// `GET /api/addr/<a>/utxo` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightUtxo {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub vout: u32,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub satoshis: i64,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub confirmations: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub coinbase: Option<bool>,
}

/// `GET /api/statistics/richest-addresses-list` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RichListRow {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks_mined: u32,
    /// FLUX (float upstream).
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub balance: f64,
}

/// Daily statistics row (`/api/statistics/{supply,transactions,fees,outputs,...}?days=N`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StatPoint {
    #[serde(deserialize_with = "lenient::string")]
    pub date: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub sum: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub fee: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub transaction_count: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub block_count: Option<u64>,
}

/// `GET /api/statistics/circulating-supply?format=object` (and the buggy `total-supply`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CirculatingSupply {
    #[serde(rename = "circulatingSupply", deserialize_with = "lenient::string")]
    pub circulating_supply: String,
}

impl CirculatingSupply {
    pub fn amount(&self) -> Option<Amount> {
        let v: f64 = self.circulating_supply.trim().parse().ok()?;
        Amount::from_flux_f64(v)
    }
}

/// `GET /api/markets/info` (also pushed as socket `markets_info`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MarketsInfo {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub price: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub price_btc: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub market_cap_usd: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_volume_24h: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub delta_24h: f64,
}

/// Inner object of `GET /api/status?q=getInfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightInfo {
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub version: i64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub connections: u32,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
    #[serde(deserialize_with = "lenient::string")]
    pub network: String,
}

/// `GET /api/status?q=getInfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightStatusInfo {
    pub info: InsightInfo,
}

/// `GET /api/status?q=getLastBlockHash` (tip fallback poll).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct LastBlockHash {
    #[serde(rename = "syncTipHash", deserialize_with = "lenient::string")]
    pub sync_tip_hash: String,
    #[serde(deserialize_with = "lenient::string")]
    pub lastblockhash: String,
}

/// `GET /api/sync`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightSync {
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    #[serde(rename = "blockChainHeight", deserialize_with = "lenient::u32_or_zero")]
    pub blockchain_height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(rename = "syncPercentage", deserialize_with = "lenient::f64_or_zero")]
    pub sync_percentage: f64,
}

/// CoinGecko `simple/price?ids=zelcash&...` entry.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CoinGeckoPrice {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub usd: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub usd_market_cap: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub usd_24h_change: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub usd_24h_vol: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub btc: f64,
}

/// CoinGecko `simple/price` body keyed by coin id (`zelcash`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct CoinGeckoSimplePrice(pub BTreeMap<String, CoinGeckoPrice>);

/// CoinGecko `simple/price?ids=zelcash&vs_currencies=a,b,...&include_24hr_change=true`: per
/// coin id, the price per currency code and `<code>_24h_change` entries.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct CoinGeckoSpot(pub BTreeMap<String, BTreeMap<String, serde_json::Value>>);

impl CoinGeckoSpot {
    /// Positive prices of `coin` by currency code, and its USD 24 h change in percent.
    pub fn prices(&self, coin: &str) -> (BTreeMap<String, f64>, Option<f64>) {
        let Some(m) = self.0.get(coin) else {
            return (BTreeMap::new(), None);
        };
        let num = |v: &serde_json::Value| v.as_f64().filter(|x| x.is_finite());
        let prices = m
            .iter()
            .filter(|(k, _)| !k.contains('_'))
            .filter_map(|(k, v)| num(v).filter(|x| *x > 0.0).map(|x| (k.clone(), x)))
            .collect();
        (prices, m.get("usd_24h_change").and_then(num))
    }
}

/// CoinGecko `coins/<id>/market_chart?vs_currency=usd&days=365&interval=daily`: `[unix ms,
/// price]` pairs, oldest first (daily at 00:00 UTC, then the current price).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CoinGeckoMarketChart {
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub prices: Vec<(f64, f64)>,
}

/// One payee row in pool statistics (under PoN these are Stratus payees, not producers).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PoolRow {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks_found: u32,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub percent_total: Option<f64>,
}

/// `/api/statistics/pools-last-hour`, `/pools[?date=]` and `/total` (24 h rollup).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PoolStats {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub n_blocks_mined: u32,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub time_between_blocks: Option<f64>,
    /// Base units.
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub mined_currency_amount: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub transaction_fees: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub number_of_transactions: Option<u64>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub blocks_by_pool: Vec<PoolRow>,
}

/// `/api/statistics/richer-than` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RicherThan {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub amount_usd: f64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub count_addresses: u32,
}

/// `/api/statistics/balance-intervals` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BalanceInterval {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub min: f64,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub max: Option<f64>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub count: u32,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub sum: f64,
}

/// `/api/currency`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CurrencyData {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub rate: f64,
    #[serde(deserialize_with = "lenient::string")]
    pub short: String,
}

/// `/api/currency` wrapper.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Currency {
    pub data: CurrencyData,
}

/// `/api/rawtx/<txid>`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawTx {
    #[serde(deserialize_with = "lenient::string")]
    pub rawtx: String,
}

/// `/api/status?q=getMiningInfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightMiningInfo {
    #[serde(rename = "miningInfo")]
    pub mining_info: InsightMiningInner,
}

/// Inner object of [`InsightMiningInfo`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightMiningInner {
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub networkhashps: Option<f64>,
}

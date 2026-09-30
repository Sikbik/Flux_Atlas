//! FluxOS `/daemon/*` models: blocks (verbosity 1 and 2, including fluxnode v5/v6 txs), block
//! deltas, chain info, UTXO-set info, fluxnode counts, current winners, start/DOS lists,
//! transactions and mempool.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::lenient;

/// `scriptPubKey` of an output.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ScriptPubKey {
    #[serde(deserialize_with = "lenient::string")]
    pub asm: String,
    #[serde(deserialize_with = "lenient::string")]
    pub hex: String,
    #[serde(rename = "type", deserialize_with = "lenient::string")]
    pub kind: String,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub addresses: Vec<String>,
}

impl ScriptPubKey {
    /// OP_RETURN payload bytes, when this is a `nulldata` output.
    pub fn op_return_data(&self) -> Option<Vec<u8>> {
        let rest = self.asm.strip_prefix("OP_RETURN")?.trim();
        if rest.is_empty() {
            return Some(Vec::new());
        }
        hex::decode(rest.split_whitespace().next()?).ok()
    }

    /// OP_RETURN payload as text when it is printable ASCII.
    pub fn op_return_text(&self) -> Option<String> {
        let data = self.op_return_data()?;
        let s = String::from_utf8(data).ok()?;
        s.chars()
            .all(|c| c.is_ascii_graphic() || c == ' ')
            .then_some(s)
    }
}

/// Transaction output (daemon form).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonVout {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub value: f64,
    /// Exact value in base units (`valueSat`).
    #[serde(rename = "valueSat", deserialize_with = "lenient::opt_i64")]
    pub value_sat: Option<i64>,
    /// Same as `valueSat` (both are sent; either may be missing on other nodes).
    #[serde(rename = "valueZat", deserialize_with = "lenient::opt_i64")]
    pub value_zat: Option<i64>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub n: u32,
    #[serde(rename = "scriptPubKey")]
    pub script_pub_key: ScriptPubKey,
}

impl DaemonVout {
    pub fn amount(&self) -> atlas_core::Amount {
        self.value_sat
            .or(self.value_zat)
            .map(atlas_core::Amount::from_sat)
            .or_else(|| atlas_core::Amount::from_flux_f64(self.value))
            .unwrap_or_default()
    }

    pub fn first_address(&self) -> Option<&str> {
        self.script_pub_key.addresses.first().map(String::as_str)
    }
}

/// Transaction input (daemon form). Block verbosity 2 carries only the prevout reference; some
/// nodes (with address/spent indexes) add `value`/`address` in `getrawtransaction`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonVin {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub coinbase: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub txid: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub vout: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub value: Option<f64>,
    #[serde(rename = "valueSat", deserialize_with = "lenient::opt_i64")]
    pub value_sat: Option<i64>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub address: Option<String>,
}

/// A decoded transaction from `getblock` verbosity 2 or `getrawtransaction/<txid>/1`.
///
/// Fluxnode transactions (version 5/6) have no vin/vout and carry the fluxnode fields.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonTx {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub size: Option<u32>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub vin: Vec<DaemonVin>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub vout: Vec<DaemonVout>,
    /// `"Starting a fluxnode"` / `"Confirming a fluxnode"`.
    #[serde(rename = "type", deserialize_with = "lenient::opt_string")]
    pub kind: Option<String>,
    /// Full collateral `COutPoint(<64hex>, n)`.
    #[serde(deserialize_with = "lenient::opt_string")]
    pub collateral: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub txhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub outidx: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub sigtime: Option<u64>,
    /// Announced `ip[:port]` (empty on starts).
    #[serde(deserialize_with = "lenient::opt_string")]
    pub ip: Option<String>,
    /// 0 = initial confirm, 1 = periodic update confirm.
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub update_type: Option<i64>,
    /// `CUMULUS` / `NIMBUS` / `STRATUS` (or an int on the wire in other encoders).
    #[serde(deserialize_with = "lenient::opt_string")]
    pub benchmark_tier: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub benchmark_sigtime: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub collateral_pubkey: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub zelnode_pubkey: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub redeemscript: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub fluxnode_upgraded_tx_version: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub using_delegates: Option<bool>,
    // getrawtransaction extras
    #[serde(deserialize_with = "lenient::opt_string")]
    pub blockhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub confirmations: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub time: Option<u64>,
}

impl DaemonTx {
    pub fn is_coinbase(&self) -> bool {
        self.vin.first().is_some_and(|v| v.coinbase.is_some())
    }

    /// True for fluxnode start/confirm transactions.
    pub fn is_fluxnode(&self) -> bool {
        self.kind
            .as_deref()
            .is_some_and(|k| k.contains("fluxnode") || k.contains("zelnode"))
            || (self.version >= 5 && self.collateral.is_some())
    }

    pub fn is_start(&self) -> bool {
        self.kind.as_deref().is_some_and(|k| k.starts_with("Start"))
    }

    pub fn is_confirm(&self) -> bool {
        self.kind
            .as_deref()
            .is_some_and(|k| k.starts_with("Confirm"))
    }
}

/// Shielded pool entry of a block or of `getblockchaininfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ValuePool {
    #[serde(deserialize_with = "lenient::string")]
    pub id: String,
    #[serde(rename = "chainValueZat", deserialize_with = "lenient::opt_i64")]
    pub chain_value_zat: Option<i64>,
    #[serde(rename = "chainValue", deserialize_with = "lenient::opt_f64")]
    pub chain_value: Option<f64>,
    #[serde(rename = "valueDeltaZat", deserialize_with = "lenient::opt_i64")]
    pub value_delta_zat: Option<i64>,
}

/// Transactions of a block: txids (verbosity 1) or full txs (verbosity 2).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BlockTxs {
    Full(Vec<DaemonTx>),
    Ids(Vec<String>),
}

impl Default for BlockTxs {
    fn default() -> Self {
        Self::Ids(Vec::new())
    }
}

/// `getblock/<hash|height>[/verbosity]` and (with `tx` absent) `getblockheader`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonBlock {
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::opt_i64")]
    pub confirmations: Option<i64>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub merkleroot: String,
    pub tx: BlockTxs,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub time: u64,
    /// `PON` or `POW`.
    #[serde(rename = "type", deserialize_with = "lenient::opt_string")]
    pub kind: Option<String>,
    /// Producer collateral, usually the short form `COutPoint(<10hex>, n)`.
    #[serde(deserialize_with = "lenient::opt_string")]
    pub collateral: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub blocksig: Option<String>,
    #[serde(deserialize_with = "lenient::string")]
    pub bits: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
    #[serde(deserialize_with = "lenient::string")]
    pub chainwork: String,
    #[serde(rename = "valuePools", deserialize_with = "lenient::vec_skip_bad")]
    pub value_pools: Vec<ValuePool>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub previousblockhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub nextblockhash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub nonce: Option<String>,
}

impl DaemonBlock {
    pub fn full_txs(&self) -> &[DaemonTx] {
        match &self.tx {
            BlockTxs::Full(v) => v,
            BlockTxs::Ids(_) => &[],
        }
    }

    pub fn tx_count(&self) -> usize {
        match &self.tx {
            BlockTxs::Full(v) => v.len(),
            BlockTxs::Ids(v) => v.len(),
        }
    }
}

/// One address delta inside `getblockdeltas`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AddressDelta {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub satoshis: i64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub index: u32,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub prevtxid: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub prevout: Option<u32>,
}

/// Per-transaction deltas.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TxDeltas {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub index: u32,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub inputs: Vec<AddressDelta>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub outputs: Vec<AddressDelta>,
}

/// `getblockdeltas/<hash>`: input addresses and values for a whole block.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BlockDeltas {
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub time: u64,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub deltas: Vec<TxDeltas>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub previousblockhash: Option<String>,
}

/// Network upgrade entry of `getblockchaininfo.upgrades`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UpgradeInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub activationheight: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
}

/// `getblockchaininfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BlockchainInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub chain: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub headers: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub bestblockhash: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub verificationprogress: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub size_on_disk: Option<u64>,
    #[serde(rename = "valuePools", deserialize_with = "lenient::vec_skip_bad")]
    pub value_pools: Vec<ValuePool>,
    pub upgrades: BTreeMap<String, UpgradeInfo>,
}

impl BlockchainInfo {
    /// Sum of shielded pools in base units.
    pub fn shielded_zat(&self) -> i64 {
        self.value_pools
            .iter()
            .filter_map(|p| p.chain_value_zat)
            .sum()
    }
}

/// `gettxoutsetinfo` (slow upstream, cache it).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TxOutSetInfo {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub bestblock: String,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub transactions: u64,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub txouts: u64,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub bytes_serialized: u64,
    /// Transparent supply in FLUX (float upstream).
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_amount: f64,
}

/// Wire form of `getfluxnodecount`: both the tier names and the legacy `basic/super/bamf`
/// names are sent at once.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
struct RawFluxnodeCount {
    #[serde(deserialize_with = "lenient::opt_u32")]
    total: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    stable: Option<u32>,
    #[serde(rename = "cumulus-enabled", deserialize_with = "lenient::opt_u32")]
    cumulus: Option<u32>,
    #[serde(rename = "basic-enabled", deserialize_with = "lenient::opt_u32")]
    basic: Option<u32>,
    #[serde(rename = "nimbus-enabled", deserialize_with = "lenient::opt_u32")]
    nimbus: Option<u32>,
    #[serde(rename = "super-enabled", deserialize_with = "lenient::opt_u32")]
    super_: Option<u32>,
    #[serde(rename = "stratus-enabled", deserialize_with = "lenient::opt_u32")]
    stratus: Option<u32>,
    #[serde(rename = "bamf-enabled", deserialize_with = "lenient::opt_u32")]
    bamf: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    ipv4: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    ipv6: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    onion: Option<u32>,
}

impl From<RawFluxnodeCount> for FluxnodeCount {
    fn from(r: RawFluxnodeCount) -> Self {
        Self {
            total: r.total.unwrap_or(0),
            stable: r.stable.unwrap_or(0),
            cumulus: r.cumulus.or(r.basic).unwrap_or(0),
            nimbus: r.nimbus.or(r.super_).unwrap_or(0),
            stratus: r.stratus.or(r.bamf).unwrap_or(0),
            ipv4: r.ipv4.unwrap_or(0),
            ipv6: r.ipv6.unwrap_or(0),
            onion: r.onion.unwrap_or(0),
        }
    }
}

/// `getfluxnodecount` (tier names, falling back to the legacy `basic/super/bamf` keys).
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(from = "RawFluxnodeCount")]
pub struct FluxnodeCount {
    pub total: u32,
    pub stable: u32,
    pub cumulus: u32,
    pub nimbus: u32,
    pub stratus: u32,
    /// Counts only port-less entries (upstream quirk); not an IPv4 total.
    pub ipv4: u32,
    pub ipv6: u32,
    pub onion: u32,
}

/// One entry of `fluxnodecurrentwinner`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WinnerEntry {
    #[serde(deserialize_with = "lenient::string")]
    pub collateral: String,
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub added_height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub confirmed_height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub last_confirmed_height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub last_paid_height: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
    #[serde(deserialize_with = "lenient::string")]
    pub payment_address: String,
}

/// `fluxnodecurrentwinner`: payees of the next block, keyed `"<TIER> Winner"`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct CurrentWinners(pub BTreeMap<String, WinnerEntry>);

/// One entry of `getstartlist` / `getdoslist`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PendingNodeEntry {
    #[serde(deserialize_with = "lenient::string")]
    pub collateral: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub added_height: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub payment_address: String,
    /// Start list: blocks until the start expires.
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub expires_in: Option<u32>,
    /// DOS list: blocks until the node may start again.
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub eligible_in: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub amount: String,
}

/// `getinfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonInfo {
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub version: i64,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub protocolversion: i64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub connections: u32,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
}

/// `getmempoolinfo`.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct MempoolInfo {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub bytes: u64,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub usage: u64,
}

/// One entry of `getrawmempool/true`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MempoolEntry {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub size: u32,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub fee: f64,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub time: u64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub depends: Vec<String>,
}

/// `getrawmempool/true`: txid to entry.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct RawMempool(pub BTreeMap<String, MempoolEntry>);

/// `getblocksubsidy/<height>`: post-PoN only `{"miner": 14}`.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct BlockSubsidy {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub miner: f64,
}

/// `gettxout/<txid>/<n>`: `null` once spent (cheapest "collateral still unspent" check).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TxOut {
    #[serde(deserialize_with = "lenient::string")]
    pub bestblock: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub confirmations: u32,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub value: f64,
    #[serde(rename = "scriptPubKey")]
    pub script_pub_key: ScriptPubKey,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub coinbase: bool,
}

/// `getspentinfo/<txid>/<index>`: the spending transaction.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SpentInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub index: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
}

/// `getmininginfo` (`ponminter` says whether this node runs the PoN minter).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MiningInfo {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blocks: u32,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub difficulty: Option<f64>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub pooledtx: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub chain: String,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub ponminter: Option<bool>,
}

/// `getaddressbalance/<addr>` (base units; no `sent`: received minus balance).
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct AddressBalance {
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub balance: i64,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub received: i64,
}

/// `getaddressdeltas/<addr>/<start>/<end>` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AddressDeltaRow {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub blockindex: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub index: u32,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub satoshis: i64,
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
}

/// `getaddressutxos/<addr>` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AddressUtxo {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(rename = "outputIndex", deserialize_with = "lenient::u32_or_zero")]
    pub output_index: u32,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub satoshis: i64,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
}

/// FluxOS `/explorer/scannedheight`.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct ScannedHeight {
    #[serde(
        rename = "generalScannedHeight",
        deserialize_with = "lenient::u32_or_zero"
    )]
    pub general_scanned_height: u32,
}

/// FluxOS `/explorer/transactions/<addr>` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TxidRow {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
}

//! Flux Fusion (`fusion.runonflux.io`): parallel-asset coinbase statistics and claims. Every
//! answer is a FluxOS-style envelope (`{"status":"success","data":...}`). Amounts are FLUX as
//! floats. `/coinbase/records` (every coinbase output of an address, 37 MB for a large wallet)
//! and `/coinbase/stats` (times out) are deliberately not modelled.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::lenient;

/// `/coinbase/summary?address=` (about 0.6 to 3 s).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CoinbaseSummary {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    /// Coinbase FLUX the address received on the main chain.
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub amount: f64,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub number_of_txs: u64,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub is_miner: bool,
    /// 10% of `amount`: what accrues on each chain.
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub max_claimable_per_chain: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub max_claimable_total: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub claimed_total: f64,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub chain_statistics: Vec<ChainStatistic>,
}

/// One chain of [`CoinbaseSummary`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChainStatistic {
    #[serde(deserialize_with = "lenient::string")]
    pub chain: String,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub claimed_amount: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub received_amount: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub fees_paid: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub possible_to_claim: f64,
}

/// `/coinbase/multiavailable?address=`: the claim-all over the active chains.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MultiAvailable {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_claim: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_mining_fees: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_swap_fees: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_fee: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub total_reward: f64,
}

/// `/coinbase/claimed?address=`: every claim of the address.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Claimed {
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub number_of_txs: u64,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub transactions: Vec<ClaimRecord>,
}

/// One claim. Signatures and messages are ignored.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClaimRecord {
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub amount: f64,
    #[serde(deserialize_with = "lenient::string")]
    pub chain: String,
    /// Chain txid or request key; `flux:<txid>` when a claim-all paid out on the main chain.
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::string")]
    pub claimed_address: String,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub fee: f64,
    /// Unix ms (older records have none).
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub timestamp: Option<u64>,
}

/// `/fees`: flat FLUX fees per service and chain.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FusionFees {
    /// Coinbase claims: `percentage` plus a flat fee per chain id.
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub mining: Option<BTreeMap<String, f64>>,
}

impl FusionFees {
    /// Flat claim fee of `chain`.
    pub fn mining_fee(&self, chain: &str) -> Option<f64> {
        self.mining
            .as_ref()
            .and_then(|m| m.get(chain).copied())
            .filter(|v| v.is_finite())
    }
}

/// `/swap/activechains`: chain ids Fusion swaps on now (`main` included).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct ActiveChains(#[serde(deserialize_with = "lenient::string_vec")] pub Vec<String>);

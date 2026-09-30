//! Deterministic node list (`/daemon/viewdeterministicfluxnodelist[/<filter>]`, also Insight
//! `/api/status?q=getFluxNodes`) and its normalization into domain values.

use atlas_core::{Amount, NodeEndpoint, NodeStatus, Outpoint, Tier};
use compact_str::CompactString;
use serde::Deserialize;

use crate::lenient;

/// One raw node-list entry. Every entry is confirmed (there is no `status` field).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeListEntry {
    /// `COutPoint(<64hex>, <n>)`.
    #[serde(deserialize_with = "lenient::string")]
    pub collateral: String,
    #[serde(deserialize_with = "lenient::string")]
    pub txhash: String,
    /// A string upstream.
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub outidx: Option<u32>,
    /// `ip` or `ip:port`; the default port 16127 is omitted; may be empty.
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::string")]
    pub network: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub added_height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub confirmed_height: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub last_confirmed_height: u32,
    /// 0 = never paid.
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub last_paid_height: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
    #[serde(deserialize_with = "lenient::string")]
    pub payment_address: String,
    #[serde(deserialize_with = "lenient::string")]
    pub pubkey: String,
    /// Unix seconds, a string upstream.
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub activesince: Option<u64>,
    /// Unix seconds, a string upstream; `1516980000` sentinel when never paid.
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub lastpaid: Option<u64>,
    /// Collateral amount, `"1000.00"`.
    #[serde(deserialize_with = "lenient::string")]
    pub amount: String,
    /// 0-based position in the tier's payment queue.
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub rank: Option<u32>,
}

/// Sentinel `lastpaid` value for never-paid nodes.
pub const NEVER_PAID_SENTINEL: u64 = 1_516_980_000;

/// A node-list entry normalized into domain types.
#[derive(Debug, Clone, PartialEq)]
pub struct ListedNode {
    pub outpoint: Outpoint,
    pub endpoint: Option<NodeEndpoint>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub payment_address: CompactString,
    pub pubkey: CompactString,
    pub rank: Option<u32>,
    pub added_height: u32,
    pub confirmed_height: Option<u32>,
    pub last_confirmed_height: Option<u32>,
    pub last_paid_height: Option<u32>,
    pub active_since_ms: Option<u64>,
    pub last_paid_ms: Option<u64>,
    pub collateral_amount: Option<Amount>,
}

impl NodeListEntry {
    /// Collateral outpoint from `txhash` + `outidx`, falling back to the `collateral` string.
    pub fn outpoint(&self) -> Option<Outpoint> {
        if let (Ok(txid), Some(vout)) = (atlas_core::Hash32::from_hex(&self.txhash), self.outidx) {
            return Some(Outpoint::new(txid, vout));
        }
        self.collateral.parse().ok()
    }

    /// Normalizes the entry. Returns `None` only if the collateral cannot be parsed.
    pub fn normalize(&self) -> Option<ListedNode> {
        let outpoint = self.outpoint()?;
        let amount = self.amount.parse::<Amount>().ok();
        let mut tier = Tier::parse_lenient(&self.tier);
        if tier == Tier::Unknown {
            tier = amount.map_or(Tier::Unknown, Tier::from_collateral);
        }
        let nz = |h: u32| (h > 0).then_some(h);
        Some(ListedNode {
            outpoint,
            endpoint: NodeEndpoint::parse_opt(&self.ip).ok().flatten(),
            tier,
            status: NodeStatus::Confirmed,
            payment_address: self.payment_address.as_str().into(),
            pubkey: self.pubkey.as_str().into(),
            rank: self.rank,
            added_height: self.added_height,
            confirmed_height: nz(self.confirmed_height),
            last_confirmed_height: nz(self.last_confirmed_height),
            last_paid_height: nz(self.last_paid_height),
            active_since_ms: self.activesince.filter(|v| *v > 0).map(|s| s * 1000),
            last_paid_ms: self
                .lastpaid
                .filter(|v| *v > 0 && *v != NEVER_PAID_SENTINEL)
                .map(|s| s * 1000),
            collateral_amount: amount,
        })
    }
}

/// Insight `/api/status?q=getFluxNodes` wrapper.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InsightFluxNodes {
    #[serde(rename = "fluxNodes")]
    pub flux_nodes: Vec<NodeListEntry>,
}

/// Verifies the queue rule (flux-api.md 3.5): within each tier, ascending `rank` matches
/// ascending `max(last_paid_height, confirmed_height)`. Returns the number of inversions.
pub fn rank_inversions(nodes: &[ListedNode]) -> usize {
    let mut inversions = 0;
    for tier in Tier::ALL {
        let mut v: Vec<(u32, u32)> = nodes
            .iter()
            .filter(|n| n.tier == tier)
            .filter_map(|n| {
                let key = n
                    .last_paid_height
                    .unwrap_or(0)
                    .max(n.confirmed_height.unwrap_or(0));
                n.rank.map(|r| (r, key))
            })
            .collect();
        v.sort_unstable();
        inversions += v.windows(2).filter(|w| w[0].1 > w[1].1).count();
    }
    inversions
}

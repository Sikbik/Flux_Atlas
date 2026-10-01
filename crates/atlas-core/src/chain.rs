//! Chain domain model: blocks, payouts and fluxnode transactions.

use compact_str::CompactString;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use ts_rs::TS;

use crate::amount::Amount;
use crate::ids::{BlockHash, Collateral, NodeId, Outpoint, Txid};
use crate::net::NodeEndpoint;
use crate::node::Tier;

/// Consensus kind of a block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum BlockKind {
    #[default]
    Unknown = 0,
    /// Proof of Node (height >= 2,020,000, header version 100).
    Pon = 1,
    /// Legacy Proof of Work.
    Pow = 2,
}

impl BlockKind {
    /// From FluxOS `type` (`PON` / `POW`) or Insight `blockType`.
    pub fn parse_lenient(s: &str) -> Self {
        let l = s.trim().to_ascii_lowercase();
        if l == "pon" || l.contains("node") {
            Self::Pon
        } else if l == "pow" || l.contains("work") {
            Self::Pow
        } else {
            Self::Unknown
        }
    }
}

/// One node payout in a block's coinbase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payout {
    pub tier: Tier,
    pub address: CompactString,
    pub amount: Amount,
    /// The exact node, when attribution succeeded at ingest time.
    pub node: Option<NodeId>,
}

/// A block as indexed by us. Stored in redb (postcard): no self-describing serde features.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSummary {
    pub height: u32,
    pub hash: BlockHash,
    pub prev_hash: BlockHash,
    /// Block header time, unix ms.
    pub time_ms: u64,
    pub size: u32,
    pub tx_count: u32,
    pub kind: BlockKind,
    /// Header version (100 for PoN).
    pub version: u32,
    /// Producer collateral as given by the header (often a 10-hex prefix).
    pub producer_collateral: Option<Collateral>,
    /// Producer resolved against the node table.
    pub producer: Option<NodeId>,
    pub payouts: SmallVec<[Payout; 4]>,
    /// Dev-fund output (remainder plus fees).
    pub dev_fund: Amount,
    /// Total fees paid in the block (dev-fund output minus its minimum).
    pub fees: Amount,
    /// Block subsidy.
    pub reward: Amount,
    /// Sum of non-coinbase transparent outputs.
    pub value_out: Amount,
    pub confirm_count: u16,
    pub start_count: u16,
    pub transfer_count: u16,
}

/// What a fluxnode transaction does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum NodeTxKind {
    /// START (nType 2): announces a collateral as a node.
    Start = 1,
    /// CONFIRM with `update_type` 0: first confirmation after start.
    InitialConfirm = 2,
    /// CONFIRM with `update_type` 1: periodic heartbeat (every >= 500 blocks).
    UpdateConfirm = 3,
    /// CONFIRM with an unrecognized update type.
    OtherConfirm = 4,
}

impl NodeTxKind {
    /// From a CONFIRM's `update_type`.
    pub const fn from_update_type(t: i64) -> Self {
        match t {
            0 => Self::InitialConfirm,
            1 => Self::UpdateConfirm,
            _ => Self::OtherConfirm,
        }
    }

    pub const fn is_confirm(self) -> bool {
        !matches!(self, Self::Start)
    }
}

/// A decoded fluxnode start or confirm transaction (tx version 5 or 6). These carry no
/// inputs or outputs, so our own index is the only history source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeTx {
    pub txid: Txid,
    /// Block height; `None` while in the mempool.
    pub height: Option<u32>,
    pub kind: NodeTxKind,
    pub collateral: Outpoint,
    /// Endpoint announced by a confirm (starts usually carry none).
    pub endpoint: Option<NodeEndpoint>,
    /// Tier the node's benchmark attested (confirms).
    pub benchmark_tier: Option<Tier>,
    /// Signature time, unix seconds.
    pub sig_time: u64,
    /// Transaction version (5 normal, 6 upgradeable).
    pub tx_version: u8,
    /// `fluxnode_upgraded_tx_version` / `nFluxNodeTxVersion` on v6 starts.
    pub upgraded_version: Option<u16>,
    /// Collateral is P2SH/multisig (v6 with a redeem script).
    pub p2sh: bool,
    /// Node the collateral maps to, when known.
    pub node: Option<NodeId>,
}

/// Classification of a transaction (block or mempool). Block and mempool transactions use the
/// same classifier (`atlas_flux::decode::classify_tx`) over the decoded daemon transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TxKind {
    /// Ordinary value transfer.
    Transfer,
    /// Fluxnode transaction whose start/confirm type the source does not state. Mempool entries
    /// are fetched and classified as `node_start` / `node_confirm`; the explorer socket's own
    /// fluxnode pushes are not used (their txids do not resolve anywhere).
    NodeTx,
    NodeStart,
    NodeConfirm,
    Coinbase,
    /// App registration or update payment (OP_RETURN with a message hash, paid to the app
    /// address). Whether it registers or updates, and which app, is known once the message is
    /// matched (pending `temporarymessages`) or mined (`permanentmessages`).
    AppMessage,
    /// Not classified: the transaction could not be fetched (evicted, or unknown to the node
    /// that answered).
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Hash32;

    #[test]
    fn kinds() {
        assert_eq!(BlockKind::parse_lenient("PON"), BlockKind::Pon);
        assert_eq!(BlockKind::parse_lenient("Proof of Node"), BlockKind::Pon);
        assert_eq!(BlockKind::parse_lenient("POW"), BlockKind::Pow);
        assert_eq!(BlockKind::parse_lenient("Proof of Work"), BlockKind::Pow);
        assert_eq!(NodeTxKind::from_update_type(0), NodeTxKind::InitialConfirm);
        assert_eq!(NodeTxKind::from_update_type(1), NodeTxKind::UpdateConfirm);
        assert!(!NodeTxKind::Start.is_confirm());
    }

    #[test]
    fn block_summary_postcard() {
        let b = BlockSummary {
            height: 2_996_914,
            hash: Hash32([3; 32]),
            prev_hash: Hash32([2; 32]),
            time_ms: 1_790_796_964_000,
            size: 3000,
            tx_count: 16,
            kind: BlockKind::Pon,
            version: 100,
            producer_collateral: Some(Collateral::parse("COutPoint(6d12b8f9ac, 0)").unwrap()),
            producer: Some(NodeId(4)),
            payouts: SmallVec::from_vec(vec![Payout {
                tier: Tier::Cumulus,
                address: "t1abc".into(),
                amount: Amount::from_flux(1),
                node: None,
            }]),
            dev_fund: Amount(50_000_000),
            fees: Amount::ZERO,
            reward: Amount::from_flux(14),
            value_out: Amount::ZERO,
            confirm_count: 14,
            start_count: 0,
            transfer_count: 1,
        };
        let bytes = postcard::to_allocvec(&b).unwrap();
        assert_eq!(postcard::from_bytes::<BlockSummary>(&bytes).unwrap(), b);
    }
}

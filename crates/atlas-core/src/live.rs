//! Live protocol over WebSocket `/ws` (ARCHITECTURE section 8).
//!
//! Text frames carry JSON objects discriminated by `"t"`. Every server message carries `seq`,
//! `observed_ms` and (when known) `event_ms`, so clients can detect gaps and show true latency.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::api::{AppIndexEntry, NetworkSummary, NodeRef, PayoutDto, ServerInfo, TipInfo, TxLite};
use crate::event::AppMessageKind;
use crate::ids::{Hash32, NodeId, Outpoint};
use crate::node::{NodeStatus, Tier};

/// Subscription topics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Chain,
    Mempool,
    Nodes,
    Apps,
    Mesh,
    Stats,
    Feed,
}

impl Topic {
    pub const ALL: [Topic; 7] = [
        Topic::Chain,
        Topic::Mempool,
        Topic::Nodes,
        Topic::Apps,
        Topic::Mesh,
        Topic::Stats,
        Topic::Feed,
    ];

    /// Bit for topic sets.
    pub const fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// Client to server messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMsg {
    /// Subscribe (replaces any previous subscription).
    Sub {
        topics: Vec<Topic>,
        /// Replay everything after this sequence if it is still in the ring buffer;
        /// otherwise the server answers `resync`.
        #[serde(default)]
        since_seq: Option<u64>,
        /// Nodes the client is looking at: their hosts get sweep priority and their events are
        /// never coalesced.
        #[serde(default)]
        watch: Option<Vec<NodeId>>,
        /// Apps the client is looking at: enables hot-app instance polling.
        #[serde(default)]
        watch_apps: Option<Vec<String>>,
    },
    /// Reply to a server `ping`.
    Pong { now_ms: u64 },
}

/// Why a node delta was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum DeltaCause {
    Reconcile,
    Block,
    Sweep,
    Geo,
}

/// Node summary for `nodes.added`; mirrors one `nodes.bin` row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodeLite {
    pub id: NodeId,
    pub outpoint: Outpoint,
    pub endpoint: Option<String>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub country_code: Option<String>,
    pub org: Option<String>,
    pub rank: Option<u32>,
    pub last_paid_height: Option<u32>,
    pub app_count: u16,
    /// Same bit layout as the `nodes.bin` flags column.
    pub flags: u8,
}

/// Changed fields of one node; absent fields did not change.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct NodeChange {
    pub id: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<NodeStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tier: Option<Tier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lat: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lon: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub country_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub org: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rank: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_paid_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_confirmed_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub app_count: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub flags: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub flux_os: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reachable: Option<bool>,
}

impl NodeChange {
    pub fn new(id: NodeId) -> Self {
        Self {
            id,
            ..Self::default()
        }
    }

    /// True if no field besides `id` is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::new(self.id)
    }
}

/// `block`: one message per block with its child events, so the client can stage the
/// choreography (producer flare, payout beams, heartbeat ripple).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BlockMsg {
    pub height: u32,
    pub hash: Hash32,
    pub prev_hash: Hash32,
    pub time_ms: u64,
    pub size: u32,
    pub tx_count: u32,
    pub producer: Option<NodeRef>,
    pub payouts: Vec<PayoutDto>,
    /// Update confirms (periodic heartbeats).
    pub heartbeats: Vec<NodeId>,
    /// Initial confirms.
    pub confirms: Vec<NodeId>,
    pub starts: Vec<NodeRef>,
    /// Nodes whose endpoint or benchmark tier changed through a confirm in this block.
    pub updates: Vec<NodeId>,
    pub transfers_over_threshold: Vec<TxLite>,
    pub reward: Amount,
    pub fees: Amount,
    pub dev_fund: Amount,
    /// App register/update payments mined in this block (OP_RETURN with the message hash).
    #[serde(default)]
    pub app_payments: Vec<BlockAppPayment>,
    /// Nodes whose collateral this block spent (they leave the network now).
    #[serde(default)]
    pub collateral_spent: Vec<NodeId>,
}

/// An app-message payment inside a block. `app` and `kind` are known when the message was
/// already seen as pending; otherwise they follow in an `apps` delta once resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BlockAppPayment {
    pub txid: Hash32,
    /// Message hash carried in the OP_RETURN.
    pub hash: Hash32,
    /// FLUX paid to the app address.
    pub value: Amount,
    pub app: Option<String>,
    pub kind: Option<AppMessageKind>,
}

/// `reorg`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ReorgMsg {
    /// Last common height.
    pub fork_height: u32,
    pub from_height: u32,
    pub to_height: u32,
    pub orphaned: Vec<Hash32>,
}

/// `nodes`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NodesDelta {
    /// Sequence of the previous `nodes` message (gap detection).
    pub prev_seq: u64,
    pub added: Vec<NodeLite>,
    pub removed: Vec<NodeId>,
    pub changed: Vec<NodeChange>,
    pub cause: DeltaCause,
}

/// Instance moves of one app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppInstancesDelta {
    pub app: String,
    pub started: Vec<NodeId>,
    pub removed: Vec<NodeId>,
    /// Instances that switched spec hash (rolling update).
    pub updated: Vec<NodeId>,
}

/// `apps`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AppsDelta {
    pub prev_seq: u64,
    pub upserted: Vec<AppIndexEntry>,
    pub removed: Vec<String>,
    pub instances: Vec<AppInstancesDelta>,
    pub cause: DeltaCause,
}

/// `mesh`: peer-edge changes, streamed per TopologySweep call. Edges are `[a, b]` with `a < b`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MeshDelta {
    pub added: Vec<[NodeId; 2]>,
    pub removed: Vec<[NodeId; 2]>,
    /// Nodes whose peer lists this call refreshed.
    pub reporters: Vec<NodeId>,
}

/// Predicted payee of the next block for one tier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NextPayeeDto {
    pub tier: Tier,
    pub node: Option<NodeId>,
    pub address: String,
}

/// `next_payees`: queue heads after every tip (pre-aims the payout glow).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NextPayeesMsg {
    /// Height of the block these payees will be paid in.
    pub height: u32,
    pub payees: Vec<NextPayeeDto>,
}

/// `app_pending`: a signed app register/update broadcast whose payment is not mined yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppPendingMsg {
    pub hash: Hash32,
    pub app: String,
    pub kind: AppMessageKind,
    pub received_ms: u64,
    pub expires_ms: u64,
}

/// `app_pending_resolved`: the pending message was mined (`mined = true`) or expired unpaid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppPendingResolvedMsg {
    pub hash: Hash32,
    pub app: String,
    pub mined: bool,
}

/// `app_installing`: an install started on a node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AppInstallingMsg {
    pub app: String,
    pub node: Option<NodeId>,
    pub endpoint: String,
}

/// Kinds of human-readable feed items. The UI maps `text_key` to copy; it never parses text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FeedKind {
    NodeJoined,
    NodeLeft,
    NodeExpired,
    NodeAtRisk,
    NodeIpChanged,
    NodeRecovered,
    NodeUnreachable,
    AppDeployed,
    AppUpdated,
    AppRenewed,
    AppExpired,
    NodeDosed,
    CollateralSpent,
    AppPending,
    AppInstallFailed,
    VersionMilestone,
    LargeTransfer,
    Reorg,
    RewardReduction,
}

/// Entity referenced by a feed item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FeedRef {
    Node { id: NodeId },
    App { name: String },
    Block { height: u32 },
    Tx { txid: Hash32 },
    Address { address: String },
}

/// `feed`: an activity item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FeedItem {
    pub kind: FeedKind,
    pub ts_ms: u64,
    /// i18n key, for example `feed.node_joined`.
    pub text_key: String,
    pub refs: Vec<FeedRef>,
    /// Interpolation parameters for `text_key`.
    pub params: BTreeMap<String, String>,
}

/// Server to client message bodies, discriminated by `"t"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum LiveBody {
    /// First message on every connection.
    Hello {
        server: ServerInfo,
        tip: Option<TipInfo>,
        now_ms: u64,
    },
    Block(BlockMsg),
    Reorg(ReorgMsg),
    /// Mempool additions, coalesced per <= 500 ms.
    Mempool {
        txs: Vec<TxLite>,
    },
    Nodes(NodesDelta),
    Apps(AppsDelta),
    Mesh(MeshDelta),
    NextPayees(NextPayeesMsg),
    AppPending(AppPendingMsg),
    AppPendingResolved(AppPendingResolvedMsg),
    AppInstalling(AppInstallingMsg),
    /// Network summary, coalesced to <= 1/s.
    Stats {
        summary: NetworkSummary,
    },
    Feed(FeedItem),
    /// `since_seq` fell out of the ring buffer (or the server restarted): refetch
    /// `/bootstrap` and `/nodes.bin`, then resubscribe from the returned `seq`.
    Resync {
        reason: String,
    },
    /// Keepalive every 20 s.
    Ping {
        now_ms: u64,
    },
}

impl LiveBody {
    /// Topic the message belongs to; `None` for control messages sent to everyone.
    pub fn topic(&self) -> Option<Topic> {
        match self {
            Self::Block(_) | Self::Reorg(_) | Self::NextPayees(_) => Some(Topic::Chain),
            Self::Mempool { .. } => Some(Topic::Mempool),
            Self::Nodes(_) => Some(Topic::Nodes),
            Self::Apps(_)
            | Self::AppPending(_)
            | Self::AppPendingResolved(_)
            | Self::AppInstalling(_) => Some(Topic::Apps),
            Self::Mesh(_) => Some(Topic::Mesh),
            Self::Stats { .. } => Some(Topic::Stats),
            Self::Feed(_) => Some(Topic::Feed),
            Self::Hello { .. } | Self::Resync { .. } | Self::Ping { .. } => None,
        }
    }
}

/// A server message: sequencing envelope plus a body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct LiveMsg {
    pub seq: u64,
    pub observed_ms: u64,
    pub event_ms: Option<u64>,
    #[serde(flatten)]
    pub body: LiveBody,
}

impl LiveMsg {
    pub fn new(seq: u64, observed_ms: u64, event_ms: Option<u64>, body: LiveBody) -> Self {
        Self {
            seq,
            observed_ms,
            event_ms,
            body,
        }
    }

    /// Serialized JSON text frame.
    pub fn to_json(&self) -> String {
        // Serialization of these plain data types cannot fail.
        serde_json::to_string(self).unwrap_or_else(|_| String::from("{}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_is_flat_and_tagged() {
        let m = LiveMsg::new(7, 100, None, LiveBody::Ping { now_ms: 100 });
        let j = m.to_json();
        assert_eq!(
            j,
            r#"{"seq":7,"observed_ms":100,"event_ms":null,"t":"ping","now_ms":100}"#
        );
        let back: LiveMsg = serde_json::from_str(&j).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn newtype_variant_flattens() {
        let body = LiveBody::Reorg(ReorgMsg {
            fork_height: 1,
            from_height: 3,
            to_height: 3,
            orphaned: vec![Hash32([0xab; 32])],
        });
        let m = LiveMsg::new(1, 2, Some(3), body);
        let v: serde_json::Value = serde_json::from_str(&m.to_json()).unwrap();
        assert_eq!(v["t"], "reorg");
        assert_eq!(v["fork_height"], 1);
        assert_eq!(v["seq"], 1);
        let back: LiveMsg = serde_json::from_str(&m.to_json()).unwrap();
        assert_eq!(back, m);
        assert_eq!(back.body.topic(), Some(Topic::Chain));
    }

    #[test]
    fn client_sub() {
        let j = r#"{"t":"sub","topics":["chain","nodes"],"since_seq":42}"#;
        let m: ClientMsg = serde_json::from_str(j).unwrap();
        assert_eq!(
            m,
            ClientMsg::Sub {
                topics: vec![Topic::Chain, Topic::Nodes],
                since_seq: Some(42),
                watch: None,
                watch_apps: None,
            }
        );
    }

    #[test]
    fn node_change_omits_unchanged() {
        let mut c = NodeChange::new(NodeId(4));
        assert!(c.is_empty());
        c.rank = Some(9);
        assert_eq!(serde_json::to_string(&c).unwrap(), r#"{"id":4,"rank":9}"#);
    }

    #[test]
    fn feed_refs_tagged() {
        let f = FeedItem {
            kind: FeedKind::NodeJoined,
            ts_ms: 1,
            text_key: "feed.node_joined".into(),
            refs: vec![FeedRef::Node { id: NodeId(3) }],
            params: BTreeMap::new(),
        };
        let v: serde_json::Value = serde_json::to_value(&f).unwrap();
        assert_eq!(v["refs"][0]["kind"], "node");
        assert_eq!(v["refs"][0]["id"], 3);
    }
}

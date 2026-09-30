//! Internal domain events. Every ingest path turns what it learns into these, the moment it
//! learns it. They are persisted (redb `events`, `node_events`, `app_events`) and mapped to live
//! protocol messages (`crate::live`).
//!
//! Stored with postcard, so enums stay externally tagged and no field is skipped.

use compact_str::CompactString;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::chain::{BlockSummary, TxKind};
use crate::ids::{BlockHash, Hash32, NodeId, Outpoint, Txid};
use crate::net::NodeEndpoint;
use crate::node::{Geo, Hardware, NodeStatus, Tier, Versions};

/// Which ingest path produced an observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Cause {
    /// Node-list reconciliation (T2).
    Reconcile,
    /// Derived from a block (T1).
    Block,
    /// Per-host crawl (T3).
    Sweep,
    /// Geolocation resolver.
    Geo,
    /// Mempool / socket push.
    Mempool,
    /// Startup restore or backfill.
    Restore,
}

/// Why a node left the active set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RemovalReason {
    /// Missed the confirmation window.
    Expired,
    /// Collateral spent.
    CollateralSpent,
    /// Dropped from the list for an unknown reason.
    Missing,
    /// Moved to the DOS list.
    Dos,
}

/// A domain event with its sequencing metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
    /// Global publish sequence this event was emitted under.
    pub seq: u64,
    /// When we learned it (unix ms).
    pub observed_ms: u64,
    /// When it happened upstream (block time, first-seen time), if known.
    pub event_ms: Option<u64>,
    pub event: Event,
}

/// Every event from ARCHITECTURE section 3.2 (plus the section 4 lifecycle events).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Event {
    // T1 ChainStream / BlockDecoder
    /// A new tip hash was announced (socket `block`), before the block is fetched.
    NewTip {
        hash: BlockHash,
        height: Option<u32>,
    },
    /// A block was decoded and applied.
    BlockAdded(Box<BlockSummary>),
    /// The chain reorganized; blocks above `fork_height` were replaced.
    Reorg {
        fork_height: u32,
        old_tip: u32,
        new_tip: u32,
        orphaned: Vec<BlockHash>,
    },
    /// Periodic confirm (update_type 1) mined for a node.
    NodeHeartbeat {
        node: NodeId,
        height: u32,
        txid: Txid,
        endpoint: Option<NodeEndpoint>,
        benchmark_tier: Option<Tier>,
    },
    /// Initial confirm (update_type 0) mined.
    NodeConfirmed {
        node: NodeId,
        height: u32,
        txid: Txid,
    },
    /// Start transaction mined (v5, or v6 incl. P2SH/multisig).
    NodeStarted {
        node: NodeId,
        outpoint: Outpoint,
        height: u32,
        txid: Txid,
        tx_version: u8,
        p2sh: bool,
    },
    /// A coinbase paid a node (attributed at ingest time).
    NodePaid {
        node: Option<NodeId>,
        tier: Tier,
        address: CompactString,
        amount: Amount,
        height: u32,
    },
    /// A node's advertised endpoint changed (confirm tx or list reconcile).
    NodeIpChanged {
        node: NodeId,
        old: Option<NodeEndpoint>,
        new: Option<NodeEndpoint>,
        cause: Cause,
    },
    /// A regular transfer above the configured threshold.
    LargeTransfer {
        txid: Txid,
        value: Amount,
        height: Option<u32>,
    },
    // T1 MempoolStream
    /// A transaction entered the mempool (socket `tx`).
    MempoolTx {
        txid: Txid,
        value: Amount,
        kind: TxKind,
        output_count: u16,
    },
    // T1 Expiry watch
    /// No confirm for >= 560 blocks.
    NodeAtRisk {
        node: NodeId,
        blocks_since_confirm: u32,
    },
    /// Predicted (`predicted = true`) or reconciled expiry.
    NodeExpired {
        node: NodeId,
        predicted: bool,
    },
    // T2 NodeReconcile and lifecycle
    /// First sight of a node.
    NodeAdded {
        node: NodeId,
        outpoint: Outpoint,
        tier: Tier,
        endpoint: Option<NodeEndpoint>,
    },
    /// Node left the active set.
    NodeRemoved {
        node: NodeId,
        reason: RemovalReason,
    },
    NodeStatusChanged {
        node: NodeId,
        from: NodeStatus,
        to: NodeStatus,
    },
    /// Payment-queue positions moved (coalesced per tier).
    RankShift {
        tier: Tier,
        changed: u32,
    },
    /// Started but not confirmed within 240 blocks (derived), or seen on the DOS list.
    NodeDosed {
        node: NodeId,
        height: u32,
    },
    /// A block spent the node's collateral: immediate removal.
    NodeCollateralSpent {
        node: NodeId,
        txid: Txid,
        height: u32,
    },
    /// Queue heads per tier after a tip (validated against `fluxnodecurrentwinner`).
    NextPayees {
        height: u32,
        payees: Vec<NextPayee>,
    },
    // T1/T2 AppChainFeed, AppPending, AppInstalling, AppPlacement, AppCatalog
    AppRegistered {
        app: String,
        owner: String,
        spec_hash: Option<Hash32>,
        height: u32,
        paid: Option<Amount>,
    },
    /// A spec update; `changed` lists the field paths that differ.
    AppUpdated {
        app: String,
        spec_hash: Option<Hash32>,
        height: u32,
        changed: Vec<String>,
        paid: Option<Amount>,
    },
    /// Expiry extended without other spec changes.
    AppRenewed {
        app: String,
        height: u32,
        expire_height: u32,
    },
    AppExpired {
        app: String,
    },
    /// A signed register/update message was broadcast but its payment is not mined yet.
    AppPending {
        app: String,
        hash: Hash32,
        kind: AppMessageKind,
        received_ms: u64,
        expires_ms: u64,
    },
    /// A pending message left the pending set: mined (promoted) or expired unpaid.
    AppPendingResolved {
        app: String,
        hash: Hash32,
        mined: bool,
    },
    /// An install started on a node (`/apps/installinglocations`).
    AppInstalling {
        app: String,
        node: Option<NodeId>,
        endpoint: NodeEndpoint,
    },
    AppInstallFailed {
        app: String,
        node: Option<NodeId>,
        endpoint: NodeEndpoint,
        error: String,
    },
    AppInstanceStarted {
        app: String,
        node: Option<NodeId>,
        endpoint: NodeEndpoint,
    },
    AppInstanceRemoved {
        app: String,
        node: Option<NodeId>,
        endpoint: NodeEndpoint,
    },
    /// An instance now runs a different spec hash (rolling update).
    AppInstanceUpdated {
        app: String,
        node: Option<NodeId>,
        endpoint: NodeEndpoint,
        spec_hash: Option<Hash32>,
    },
    // T2 Chain / Supply / Price
    /// Network gauges changed.
    Stats(StatsSample),
    Price {
        usd: f64,
        btc: f64,
        change_24h_pct: f64,
        market_cap_usd: f64,
        volume_24h_usd: f64,
    },
    // T3 StatsRound / TopologySweep / GeoResolve / WatchProbe
    /// A stats round was ingested (freshness signal, coalescible).
    StatsRound {
        round_ms: u64,
        nodes: u32,
        unreachable: u32,
    },
    /// One `/flux/topology` call was merged.
    TopologySwept {
        reporter: NodeEndpoint,
        reporters: u32,
        edges_added: u32,
        edges_removed: u32,
    },
    PeerLinksChanged {
        node: NodeId,
        added: Vec<NodeId>,
        removed: Vec<NodeId>,
    },
    NodeUnreachable {
        node: NodeId,
    },
    NodeRecovered {
        node: NodeId,
    },
    NodeHardwareChanged {
        node: NodeId,
        hardware: Box<Hardware>,
    },
    NodeVersionChanged {
        node: NodeId,
        versions: Box<Versions>,
    },
    /// Running apps on a node changed (names, lowercase).
    NodeAppsChanged {
        node: NodeId,
        apps: Vec<String>,
    },
    NodeLocated {
        node: NodeId,
        geo: Box<Geo>,
    },
}

/// Kind of an app message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AppMessageKind {
    Register,
    Update,
}

impl AppMessageKind {
    /// From the message `type` (`fluxappregister`, `zelappupdate`, ...).
    pub fn parse_lenient(s: &str) -> Option<Self> {
        let l = s.to_ascii_lowercase();
        if l.ends_with("register") {
            Some(Self::Register)
        } else if l.ends_with("update") {
            Some(Self::Update)
        } else {
            None
        }
    }
}

/// Predicted payee of the next block for one tier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextPayee {
    pub tier: Tier,
    pub node: Option<NodeId>,
    pub address: CompactString,
}

impl Event {
    /// Node this event concerns, for the per-node history index.
    pub fn node(&self) -> Option<NodeId> {
        match self {
            Self::NodeHeartbeat { node, .. }
            | Self::NodeConfirmed { node, .. }
            | Self::NodeStarted { node, .. }
            | Self::NodeIpChanged { node, .. }
            | Self::NodeAtRisk { node, .. }
            | Self::NodeExpired { node, .. }
            | Self::NodeAdded { node, .. }
            | Self::NodeRemoved { node, .. }
            | Self::NodeStatusChanged { node, .. }
            | Self::PeerLinksChanged { node, .. }
            | Self::NodeUnreachable { node }
            | Self::NodeRecovered { node }
            | Self::NodeHardwareChanged { node, .. }
            | Self::NodeDosed { node, .. }
            | Self::NodeCollateralSpent { node, .. }
            | Self::NodeVersionChanged { node, .. }
            | Self::NodeAppsChanged { node, .. }
            | Self::NodeLocated { node, .. } => Some(*node),
            Self::NodePaid { node, .. } => *node,
            _ => None,
        }
    }

    /// App this event concerns, for the per-app history index.
    pub fn app(&self) -> Option<&str> {
        match self {
            Self::AppRegistered { app, .. }
            | Self::AppUpdated { app, .. }
            | Self::AppRenewed { app, .. }
            | Self::AppExpired { app }
            | Self::AppInstanceStarted { app, .. }
            | Self::AppInstanceRemoved { app, .. }
            | Self::AppInstanceUpdated { app, .. }
            | Self::AppPending { app, .. }
            | Self::AppPendingResolved { app, .. }
            | Self::AppInstalling { app, .. }
            | Self::AppInstallFailed { app, .. } => Some(app),
            _ => None,
        }
    }

    /// Stable short name, for metrics and logs.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NewTip { .. } => "new_tip",
            Self::BlockAdded(_) => "block_added",
            Self::Reorg { .. } => "reorg",
            Self::NodeHeartbeat { .. } => "node_heartbeat",
            Self::NodeConfirmed { .. } => "node_confirmed",
            Self::NodeStarted { .. } => "node_started",
            Self::NodePaid { .. } => "node_paid",
            Self::NodeIpChanged { .. } => "node_ip_changed",
            Self::LargeTransfer { .. } => "large_transfer",
            Self::MempoolTx { .. } => "mempool_tx",
            Self::NodeAtRisk { .. } => "node_at_risk",
            Self::NodeExpired { .. } => "node_expired",
            Self::NodeAdded { .. } => "node_added",
            Self::NodeRemoved { .. } => "node_removed",
            Self::NodeStatusChanged { .. } => "node_status_changed",
            Self::RankShift { .. } => "rank_shift",
            Self::AppRegistered { .. } => "app_registered",
            Self::AppUpdated { .. } => "app_updated",
            Self::AppRenewed { .. } => "app_renewed",
            Self::AppExpired { .. } => "app_expired",
            Self::AppInstanceStarted { .. } => "app_instance_started",
            Self::AppInstanceRemoved { .. } => "app_instance_removed",
            Self::AppInstanceUpdated { .. } => "app_instance_updated",
            Self::AppPending { .. } => "app_pending",
            Self::AppPendingResolved { .. } => "app_pending_resolved",
            Self::AppInstalling { .. } => "app_installing",
            Self::AppInstallFailed { .. } => "app_install_failed",
            Self::NodeDosed { .. } => "node_dosed",
            Self::NodeCollateralSpent { .. } => "node_collateral_spent",
            Self::NextPayees { .. } => "next_payees",
            Self::StatsRound { .. } => "stats_round",
            Self::TopologySwept { .. } => "topology_swept",
            Self::Stats(_) => "stats",
            Self::Price { .. } => "price",
            Self::PeerLinksChanged { .. } => "peer_links_changed",
            Self::NodeUnreachable { .. } => "node_unreachable",
            Self::NodeRecovered { .. } => "node_recovered",
            Self::NodeHardwareChanged { .. } => "node_hardware_changed",
            Self::NodeVersionChanged { .. } => "node_version_changed",
            Self::NodeAppsChanged { .. } => "node_apps_changed",
            Self::NodeLocated { .. } => "node_located",
        }
    }
}

/// A sample of network gauges (one `metrics_1m` row is derived from these).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct StatsSample {
    pub tip_height: u32,
    pub node_count: u32,
    pub tier_counts: [u32; 3],
    pub host_count: u32,
    pub app_count: u32,
    pub instance_count: u32,
    /// Transparent + shielded supply, if known.
    pub supply: Option<Amount>,
    pub mempool_size: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postcard_roundtrip_all_shapes() {
        let events = vec![
            Event::NewTip {
                hash: Hash32([1; 32]),
                height: None,
            },
            Event::NodePaid {
                node: Some(NodeId(3)),
                tier: Tier::Stratus,
                address: "t1x".into(),
                amount: Amount::from_flux(9),
                height: 10,
            },
            Event::TopologySwept {
                reporter: "1.2.3.4:16127".parse().unwrap(),
                reporters: 60,
                edges_added: 3,
                edges_removed: 1,
            },
            Event::AppPending {
                app: "demo".into(),
                hash: Hash32([4; 32]),
                kind: AppMessageKind::Update,
                received_ms: 1,
                expires_ms: 2,
            },
            Event::Stats(StatsSample {
                tip_height: 5,
                supply: Some(Amount(9)),
                ..Default::default()
            }),
            Event::AppUpdated {
                app: "demo".into(),
                spec_hash: None,
                height: 1,
                changed: vec!["instances".into()],
                paid: Some(Amount(5)),
            },
        ];
        for e in events {
            let env = EventEnvelope {
                seq: 9,
                observed_ms: 1,
                event_ms: Some(2),
                event: e,
            };
            let bytes = postcard::to_allocvec(&env).unwrap();
            assert_eq!(postcard::from_bytes::<EventEnvelope>(&bytes).unwrap(), env);
        }
    }

    #[test]
    fn indexes() {
        let e = Event::NodeRecovered { node: NodeId(5) };
        assert_eq!(e.node(), Some(NodeId(5)));
        assert_eq!(e.kind(), "node_recovered");
        let a = Event::AppExpired { app: "x".into() };
        assert_eq!(a.app(), Some("x"));
        assert_eq!(a.node(), None);
    }
}

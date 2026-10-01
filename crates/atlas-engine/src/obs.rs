//! Typed observations: what ingest jobs learned, sent to the reducer over one mpsc channel.

use std::collections::HashMap;
use std::net::IpAddr;

use atlas_core::api::PriceInfo;
use atlas_core::app::{AppInstance, AppMessageRecord, AppSpec, PendingAppMessage};
use atlas_core::node::Geo;
use atlas_core::{Amount, BlockHash, Hash32, NodeEndpoint, Outpoint, Tier, Txid};
use atlas_flux::decode::DecodedBlock;
use atlas_flux::insight_socket::{SocketInfo, SocketTx};
use atlas_flux::models::daemon::{FluxnodeCount, PendingNodeEntry};
use atlas_flux::models::nodes::ListedNode;
use tokio::sync::oneshot;

use crate::derive::round::RoundNode;

/// A reporter's peer lists from one `/flux/topology` call, still as endpoints.
#[derive(Debug, Clone)]
pub struct TopologyReport {
    pub reporter: NodeEndpoint,
    pub outbound: Vec<NodeEndpoint>,
    pub inbound: Vec<NodeEndpoint>,
}

/// One observation.
#[derive(Debug)]
pub enum Obs {
    /// An injected fault (tests of the supervision).
    #[cfg(any(test, feature = "fault-injection"))]
    Fault(crate::Fault),
    // ----- T1 chain -----
    /// A tip hash was announced (socket push or fallback poll).
    Tip {
        hash: BlockHash,
        received_ms: u64,
    },
    /// A block to apply on top of the current tip. `discontinuous` marks a jump (first block
    /// or a gap too large to fill live): expiry predictions pause until the next reconcile.
    Block {
        block: Box<DecodedBlock>,
        received_ms: u64,
        discontinuous: bool,
    },
    /// Blocks above `fork_height` were orphaned.
    Reorg {
        fork_height: u32,
        old_tip: u32,
        orphaned: Vec<BlockHash>,
    },
    MempoolTx {
        tx: SocketTx,
        received_ms: u64,
    },
    /// Current mempool txids with their sizes (periodic reconciliation).
    MempoolSnapshot(HashMap<Txid, u32>),
    /// A mempool transaction fetched (`getrawtransaction`) and classified with the block
    /// classifier: refines a socket `node_tx`, or adds a transaction the socket never pushed.
    MempoolClassified {
        txid: Txid,
        kind: atlas_core::chain::TxKind,
        value: Amount,
        size: Option<u32>,
        output_count: u16,
    },
    SocketInfo(SocketInfo),
    Price(PriceInfo),
    /// `fluxnodecurrentwinner` for `height`: `(tier, collateral, address)`.
    Winners {
        height: u32,
        winners: Vec<(Tier, Option<Outpoint>, String)>,
    },
    // ----- T2 registry -----
    NodeList(Vec<ListedNode>),
    NodeCount(FluxnodeCount),
    StartList(Vec<PendingNodeEntry>),
    DosList(Vec<PendingNodeEntry>),
    // ----- T2 apps -----
    Pending(Vec<PendingAppMessage>),
    Installing(Vec<(String, NodeEndpoint)>),
    Locations {
        rows: Vec<(String, AppInstance)>,
        /// `Some(app)` for hot-app polling of one app.
        scope: Option<String>,
    },
    Catalog(Vec<(AppSpec, Option<Hash32>, u32)>),
    InstallErrors(Vec<(String, NodeEndpoint, String)>),
    /// A mined app message resolved by the chain feed.
    AppMessage(Box<AppMessageRecord>),
    /// A chunk of the permanent-message history (bootstrap backfill).
    AppMessagesBackfill(Vec<AppMessageRecord>),
    // ----- T2 supply -----
    Supply {
        height: u32,
        transparent: Amount,
        shielded: Amount,
    },
    Circulating(Amount),
    // ----- T3 -----
    StatsRound {
        round_ms: u64,
        rows: Vec<RoundNode>,
    },
    Geo {
        ip: IpAddr,
        geo: Box<Geo>,
        fetched_ms: u64,
        /// From the store cache (do not re-write it).
        cached: bool,
    },
    Topology {
        queried: NodeEndpoint,
        reports: Vec<TopologyReport>,
    },
    /// A direct probe of a host (WatchProbe).
    Probe {
        ip: IpAddr,
        ok: bool,
    },
    // ----- backfills -----
    BackfillBlocks(Vec<DecodedBlock>),
    /// `(unix ms, [cumulus, nimbus, stratus])`.
    HistoryStats(Vec<(u64, [u32; 3])>),
    /// Sets a meta key (backfill cursors) through the single writer.
    Meta {
        key: &'static str,
        value: u64,
    },
    // ----- control -----
    /// A published state finished building.
    PublishDone {
        elapsed_ms: u64,
    },
    /// A (new) local GeoIP database is ready.
    GeoIp(crate::geoip::LoadedGeoIp),
    /// Flush the store and acknowledge (shutdown).
    Flush(oneshot::Sender<()>),
}

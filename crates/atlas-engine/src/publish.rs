//! Builds a [`Published`] state and its prebuilt bodies off the reducer thread.
//!
//! Unchanged parts are shared with the previous publish (`Arc` reuse): the node slice, the app
//! index and each prebuilt body are rebuilt only when their inputs changed. The bootstrap body
//! carries the sequence number and is rebuilt on every publish.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

use atlas_core::api::{
    AppIndexEntry, AppsIndexDto, BlockLite, BootstrapDto, JobFreshness, NetworkSummary, PayoutDto,
    ServerInfo, TierStats,
};
use atlas_core::chain::BlockSummary;
use atlas_core::codec::mesh_bin::encode_mesh_bin;
use atlas_core::codec::nodes_bin::{NodeBinInput, encode_nodes_bin};
use atlas_core::live::NextPayeeDto;
use atlas_core::{NodeId, NodeRecord};

use crate::Published;
use crate::body::{PrebuiltBodies, PrebuiltBody};

/// Everything a publish needs, captured by the reducer.
pub struct PublishJob {
    pub seq: u64,
    pub generated_ms: u64,
    pub stale: bool,
    pub server: ServerInfo,
    pub network: NetworkSummary,
    pub tiers: Vec<TierStats>,
    pub blocks: Arc<[BlockLite]>,
    pub nodes: Arc<[NodeRecord]>,
    /// Rebuild `nodes.bin` (nodes or tip changed).
    pub nodes_changed: bool,
    pub enterprise: Arc<HashSet<NodeId>>,
    pub tip: u32,
    pub apps: Arc<[AppIndexEntry]>,
    pub apps_changed: bool,
    /// New mesh edges when the mesh changed.
    pub mesh: Option<Vec<(NodeId, NodeId, u8)>>,
    pub mesh_edge_count: u32,
    pub freshness: Vec<JobFreshness>,
    pub next_payees: Vec<NextPayeeDto>,
    pub prev: Arc<Published>,
}

/// Timing of one build (ms per body).
#[derive(Debug, Clone, Copy, Default)]
pub struct BuildTiming {
    pub nodes_bin_ms: u64,
    pub mesh_bin_ms: u64,
    pub apps_ms: u64,
    pub bootstrap_ms: u64,
    pub total_ms: u64,
}

/// Block list row.
pub fn block_lite(b: &BlockSummary) -> BlockLite {
    BlockLite {
        height: b.height,
        hash: b.hash,
        time_ms: b.time_ms,
        size: b.size,
        tx_count: b.tx_count,
        kind: b.kind,
        producer: b.producer,
        payouts: b
            .payouts
            .iter()
            .map(|p| PayoutDto {
                tier: p.tier,
                node: p.node,
                address: p.address.to_string(),
                amount: p.amount,
            })
            .collect(),
        reward: b.reward,
        fees: b.fees,
        confirm_count: b.confirm_count,
        start_count: b.start_count,
        transfer_count: b.transfer_count,
    }
}

/// `nodes.bin` body for a node slice.
pub fn nodes_bin_body<S: std::hash::BuildHasher>(
    nodes: &[NodeRecord],
    enterprise: &HashSet<NodeId, S>,
    seq: u64,
    tip: u32,
    now_ms: u64,
) -> std::io::Result<PrebuiltBody> {
    let rows: Vec<NodeBinInput> = nodes
        .iter()
        .map(|r| NodeBinInput::from_record(r, tip, now_ms, enterprise.contains(&r.id)))
        .collect();
    PrebuiltBody::build(
        "application/octet-stream",
        encode_nodes_bin(seq, now_ms, &rows),
    )
}

/// Builds the next published state. Runs on a blocking thread.
pub fn build(job: PublishJob) -> (Published, BuildTiming) {
    let started = Instant::now();
    let mut t = BuildTiming::default();
    let prev = &job.prev.bodies;
    let mut bodies = PrebuiltBodies {
        bootstrap: None,
        nodes_bin: prev.nodes_bin.clone(),
        mesh_bin: prev.mesh_bin.clone(),
        apps_index: prev.apps_index.clone(),
    };

    if job.nodes_changed || bodies.nodes_bin.is_none() {
        let s = Instant::now();
        match nodes_bin_body(
            &job.nodes,
            &job.enterprise,
            job.seq,
            job.tip,
            job.generated_ms,
        ) {
            Ok(b) => bodies.nodes_bin = Some(b),
            Err(e) => tracing::error!(error = %e, "nodes.bin build failed"),
        }
        t.nodes_bin_ms = s.elapsed().as_millis() as u64;
    }
    if let Some(edges) = &job.mesh {
        let s = Instant::now();
        let raw = encode_mesh_bin(job.seq, job.generated_ms, edges.iter().copied());
        match PrebuiltBody::build("application/octet-stream", raw) {
            Ok(b) => bodies.mesh_bin = Some(b),
            Err(e) => tracing::error!(error = %e, "mesh.bin build failed"),
        }
        t.mesh_bin_ms = s.elapsed().as_millis() as u64;
    }
    if job.apps_changed || bodies.apps_index.is_none() {
        let s = Instant::now();
        let dto = AppsIndexDto {
            seq: job.seq,
            generated_ms: job.generated_ms,
            apps: job.apps.to_vec(),
        };
        match PrebuiltBody::json(&dto) {
            Ok(b) => bodies.apps_index = Some(b),
            Err(e) => tracing::error!(error = %e, "apps index build failed"),
        }
        t.apps_ms = s.elapsed().as_millis() as u64;
    }
    let s = Instant::now();
    let boot = BootstrapDto {
        server: job.server.clone(),
        seq: job.seq,
        generated_ms: job.generated_ms,
        stale: job.stale,
        network: job.network.clone(),
        tiers: job.tiers.clone(),
        blocks: job.blocks.iter().take(30).cloned().collect(),
        apps: job.apps.to_vec(),
        freshness: job.freshness.clone(),
    };
    match PrebuiltBody::json(&boot) {
        Ok(b) => bodies.bootstrap = Some(b),
        Err(e) => tracing::error!(error = %e, "bootstrap build failed"),
    }
    t.bootstrap_ms = s.elapsed().as_millis() as u64;
    t.total_ms = started.elapsed().as_millis() as u64;

    let published = Published {
        seq: job.seq,
        generated_ms: job.generated_ms,
        stale: job.stale,
        server: job.server,
        network: job.network,
        nodes: job.nodes,
        apps: job.apps,
        blocks: job.blocks,
        bodies,
        tiers: job.tiers.into(),
        freshness: job.freshness.into(),
        next_payees: job.next_payees.into(),
        mesh_edge_count: job.mesh_edge_count,
    };
    (published, t)
}

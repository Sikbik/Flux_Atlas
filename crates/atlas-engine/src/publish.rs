//! Builds a [`Published`] state and its prebuilt bodies off the reducer thread.
//!
//! Unchanged parts are shared with the previous publish (`Arc` reuse): the node slice, the app
//! index and each prebuilt body are rebuilt only when their inputs changed. The bootstrap body
//! carries the sequence number and is rebuilt on every publish.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

use atlas_core::api::{
    AppIndexEntry, AppsIndexDto, BlockLite, BootstrapDto, DataAttribution, JobFreshness,
    NetworkSummary, PayoutDto, ServerInfo, TierStats, TxLite,
};
use atlas_core::chain::BlockSummary;
use atlas_core::codec::Origin;
use atlas_core::codec::mesh_bin::encode_mesh_bin_from;
use atlas_core::codec::nodes_bin::{NodeBinInput, encode_nodes_bin_from};
use atlas_core::live::{NextPayeeDto, NextPayeesMsg};
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
    /// Seq of the latest live `mesh` message that added or removed edges (0 = none yet).
    pub mesh_seq: u64,
    pub freshness: Vec<JobFreshness>,
    pub next_payees: Vec<NextPayeeDto>,
    pub mempool: Vec<(TxLite, u64)>,
    /// Third-party data credits (bootstrap `attributions`).
    pub attributions: Vec<DataAttribution>,
    pub prev: Arc<Published>,
}

/// The bootstrap's `next_payees`: the predicted payees of the block after `tip`, or `None` before
/// a tip or any payee is known.
pub fn next_payees_msg(tip: u32, payees: &[NextPayeeDto]) -> Option<NextPayeesMsg> {
    (tip > 0 && payees.iter().any(|p| p.node.is_some())).then(|| NextPayeesMsg {
        height: tip + 1,
        payees: payees.to_vec(),
    })
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

/// `nodes.bin` body for a node slice, stamped with the server that built it.
pub fn nodes_bin_body<S: std::hash::BuildHasher>(
    nodes: &[NodeRecord],
    enterprise: &HashSet<NodeId, S>,
    seq: u64,
    tip: u32,
    now_ms: u64,
    origin: Option<Origin>,
) -> std::io::Result<PrebuiltBody> {
    let rows: Vec<NodeBinInput> = nodes
        .iter()
        .map(|r| NodeBinInput::from_record(r, tip, now_ms, enterprise.contains(&r.id)))
        .collect();
    PrebuiltBody::build(
        "application/octet-stream",
        encode_nodes_bin_from(seq, now_ms, &rows, &[], origin),
    )
}

type MeshReq = (u64, u64, Option<Origin>, Vec<(NodeId, NodeId, u8)>);
type MeshResp = (std::io::Result<PrebuiltBody>, u64);

fn mesh_body(
    seq: u64,
    generated_ms: u64,
    origin: Option<Origin>,
    edges: &[(NodeId, NodeId, u8)],
) -> MeshResp {
    let s = Instant::now();
    let raw = encode_mesh_bin_from(seq, generated_ms, edges.iter().copied(), origin);
    let b = PrebuiltBody::build("application/octet-stream", raw);
    (b, s.elapsed().as_millis() as u64)
}

/// A long-lived thread that builds `mesh.bin` (the largest body, at most every 10 s) in
/// parallel with the other bodies, so it never adds to the latency of a block publish.
/// Long-lived threads (rather than a fresh thread or a pool thread per publish) keep the large
/// body allocations in a stable allocator heap, which keeps RSS flat.
pub struct MeshWorker {
    tx: std::sync::mpsc::Sender<MeshReq>,
    rx: std::sync::mpsc::Receiver<MeshResp>,
}

impl MeshWorker {
    pub fn spawn() -> std::io::Result<Self> {
        let (tx, req_rx) = std::sync::mpsc::channel::<MeshReq>();
        let (resp_tx, rx) = std::sync::mpsc::channel::<MeshResp>();
        std::thread::Builder::new()
            .name("atlas-mesh-body".to_owned())
            .spawn(move || {
                while let Ok((seq, ms, origin, edges)) = req_rx.recv() {
                    let out = mesh_body(seq, ms, origin, &edges);
                    drop(edges);
                    if resp_tx.send(out).is_err() {
                        break;
                    }
                }
            })?;
        Ok(Self { tx, rx })
    }
}

/// Builds the next published state on the calling thread.
pub fn build(job: PublishJob) -> (Published, BuildTiming) {
    build_with(job, None)
}

/// Builds the next published state, handing `mesh.bin` to `mesh` when given.
pub fn build_with(mut job: PublishJob, mesh: Option<&MeshWorker>) -> (Published, BuildTiming) {
    let started = Instant::now();
    let mut t = BuildTiming::default();
    let prev = &job.prev.bodies;
    let mut bodies = PrebuiltBodies {
        bootstrap: None,
        nodes_bin: prev.nodes_bin.clone(),
        mesh_bin: prev.mesh_bin.clone(),
        apps_index: prev.apps_index.clone(),
    };

    let origin = Some(crate::origin_of(&job.server));
    let mut pending = false;
    let mut local = None;
    if let Some(edges) = job.mesh.take() {
        match mesh {
            Some(w) => match w.tx.send((job.seq, job.generated_ms, origin, edges)) {
                Ok(()) => pending = true,
                Err(back) => local = Some(back.0.3),
            },
            None => local = Some(edges),
        }
    }
    build_rest(&job, &mut bodies, &mut t);
    let resp = if pending {
        mesh.and_then(|w| w.rx.recv().ok())
    } else {
        local.map(|edges| mesh_body(job.seq, job.generated_ms, origin, &edges))
    };
    match resp {
        Some((Ok(b), ms)) => {
            bodies.mesh_bin = Some(b);
            t.mesh_bin_ms = ms;
        }
        Some((Err(e), _)) => tracing::error!(error = %e, "mesh.bin build failed"),
        None if pending => tracing::error!("mesh.bin worker stopped"),
        None => {}
    }
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
        mempool: job.mempool.into(),
        attributions: job.attributions.into(),
    };
    (published, t)
}

/// Builds every body except `mesh.bin`.
fn build_rest(job: &PublishJob, bodies: &mut PrebuiltBodies, t: &mut BuildTiming) {
    if job.nodes_changed || bodies.nodes_bin.is_none() {
        let s = Instant::now();
        match nodes_bin_body(
            &job.nodes,
            &job.enterprise,
            job.seq,
            job.tip,
            job.generated_ms,
            Some(crate::origin_of(&job.server)),
        ) {
            Ok(b) => bodies.nodes_bin = Some(b),
            Err(e) => tracing::error!(error = %e, "nodes.bin build failed"),
        }
        t.nodes_bin_ms = s.elapsed().as_millis() as u64;
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
        attributions: Some(job.attributions.clone()),
        next_payees: next_payees_msg(job.tip, &job.next_payees),
        mesh_seq: (job.mesh_seq > 0).then_some(job.mesh_seq),
    };
    match PrebuiltBody::json(&boot) {
        Ok(b) => bodies.bootstrap = Some(b),
        Err(e) => tracing::error!(error = %e, "bootstrap build failed"),
    }
    t.bootstrap_ms = s.elapsed().as_millis() as u64;
}

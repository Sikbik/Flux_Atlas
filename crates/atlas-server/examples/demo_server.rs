//! Dev backend for the web app: the mainnet-sized fixture engine (6,724 nodes, 1,900 apps) plus a
//! realistic synthetic live stream, so the frontend runs on the real protocol before the ingest
//! engine lands.
//!
//! ```text
//! cargo run -p atlas-server --example demo_server              # 127.0.0.1:3000, a block every 30 s
//! ATLAS_DEMO_BLOCK_MS=5000 cargo run -p atlas-server --example demo_server -- 127.0.0.1:3100
//! ```
//!
//! Every message goes through `EngineHandle::emit` with the exact `LiveBody` variants, so seq,
//! replay, resync and fan-out behave as in production:
//!
//! - a `block` every `ATLAS_DEMO_BLOCK_MS` (default 30,000, jittered) with the producer, the
//!   three tier payouts (queue heads, attributed), 13 to 16 heartbeats, occasional initial
//!   confirms, starts and large transfers; then a `nodes` delta (cause `block`), `next_payees`,
//!   `stats` and `feed` items, and a republish of the snapshot bodies
//! - `mempool` transactions at about 23 per minute (91% node transactions)
//! - app lifecycles: `app_pending` -> `app_pending_resolved` (85% mined) -> `apps` upsert ->
//!   `app_installing` -> `apps` instance spawns; occasional instance removals
//! - `mesh` deltas per simulated topology-sweep call, occasional node expiry (`nodes` status,
//!   then removal) and a full rank `reconcile` every 20 blocks
//!
//! It also serves `web/dist` (the SPA) when it exists. Env: `ATLAS_DEMO_BIND`,
//! `ATLAS_DEMO_BLOCK_MS`, `ATLAS_DEMO_SEED`, `ATLAS_LOG`.

use std::collections::{BTreeMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::{AppIndexEntry, PriceInfo, TxLite};
use atlas_core::app::AppInstance;
use atlas_core::chain::{BlockKind, BlockSummary, Payout, TxKind};
use atlas_core::codec::nodes_bin::NodeBinInput;
use atlas_core::emission;
use atlas_core::event::AppMessageKind;
use atlas_core::live::{
    AppInstallingMsg, AppInstancesDelta, AppPendingMsg, AppPendingResolvedMsg, AppsDelta, BlockMsg,
    DeltaCause, FeedItem, FeedKind, FeedRef, LiveBody, MeshDelta, NextPayeeDto, NextPayeesMsg,
    NodeChange, NodeLite, NodesDelta,
};
use atlas_core::net::NodeEndpoint;
use atlas_core::{
    Amount, Collateral, Hash32, NodeId, NodeRecord, NodeStatus, Outpoint, Tier, now_ms,
};
use atlas_engine::{EngineConfig, EngineHandle, IngestConfig};
use atlas_server::fixtures::{self, Fixture, FixtureSpec};
use atlas_server::views::node_ref;
use atlas_server::{AppState, ServerConfig, router};
use atlas_store::WriteBatch;
use tokio::sync::watch;
use tokio::time::sleep_until;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// Blocks between full rank reconciles.
const RECONCILE_EVERY: u32 = 20;
/// Mean mempool inter-arrival (about 23 transactions per minute).
const MEMPOOL_MEAN_MS: f64 = 60_000.0 / 23.0;

/// splitmix64: small, deterministic, good enough for synthetic data.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1).max(1)
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
    /// Exponential inter-arrival with the given mean.
    fn exp_ms(&mut self, mean: f64) -> u64 {
        (-(1.0 - self.unit()).ln() * mean).clamp(50.0, mean * 6.0) as u64
    }
}

fn hash(tag: &str, n: u64) -> Hash32 {
    Hash32(*blake3::hash(format!("demo-{tag}-{n}").as_bytes()).as_bytes())
}

enum Job {
    /// A pending app message is mined (or expires unpaid).
    Resolve {
        hash: Hash32,
        app: usize,
        mined: bool,
    },
    /// Installs start on nodes.
    Install { app: usize, nodes: Vec<usize> },
    /// Instances come up.
    Spawn { app: usize, nodes: Vec<usize> },
    /// An expired node leaves the list.
    Remove { id: NodeId },
}

struct Demo {
    engine: EngineHandle,
    f: Fixture,
    rng: Rng,
    block_ms: u64,
    /// Payment queues per tier (indices into `f.nodes`), head first.
    queues: [Vec<usize>; 3],
    nodes_prev_seq: u64,
    apps_prev_seq: u64,
    mesh: HashSet<(u32, u32)>,
    jobs: Vec<(Instant, Job)>,
    mempool_since_block: Vec<TxLite>,
    tx_counter: u64,
    price_usd: f64,
    blocks_emitted: u32,
    publishing: Option<tokio::task::JoinHandle<()>>,
    publish_dirty: bool,
}

impl Demo {
    fn new(engine: EngineHandle, f: Fixture, seed: u64, block_ms: u64) -> Self {
        let mut queues: [Vec<usize>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        let mut ranked: Vec<(usize, u32)> = f
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(i, n)| n.rank.map(|r| (i, r)))
            .collect();
        ranked.sort_by_key(|&(_, r)| r);
        for (i, _) in ranked {
            if let Some(t) = f.nodes[i].tier.index() {
                queues[t].push(i);
            }
        }
        let mesh = f.mesh.iter().map(|(a, b, _)| (a.0, b.0)).collect();
        Self {
            engine,
            f,
            rng: Rng(seed),
            block_ms,
            queues,
            nodes_prev_seq: 0,
            apps_prev_seq: 0,
            mesh,
            jobs: Vec::new(),
            mempool_since_block: Vec::new(),
            tx_counter: 0,
            price_usd: 0.31,
            blocks_emitted: 0,
            publishing: None,
            publish_dirty: false,
        }
    }

    /// Scales a real-world duration by the demo's block cadence (a faster chain, faster apps).
    fn scaled(&self, real_ms: u64) -> Duration {
        Duration::from_millis((real_ms * self.block_ms / 30_000).max(1_500))
    }

    fn emit(&self, event_ms: Option<u64>, body: LiveBody) -> u64 {
        self.engine.emit(event_ms, body).seq
    }

    fn feed(&self, kind: FeedKind, key: &str, refs: Vec<FeedRef>, params: &[(&str, String)]) {
        let params: BTreeMap<String, String> = params
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect();
        self.emit(
            None,
            LiveBody::Feed(FeedItem {
                kind,
                ts_ms: now_ms(),
                text_key: format!("feed.{key}"),
                refs,
                params,
            }),
        );
    }

    fn node_lite(&self, i: usize) -> NodeLite {
        let n = &self.f.nodes[i];
        let row = NodeBinInput::from_record(n, self.f.tip, now_ms(), false);
        let r = node_ref(n);
        NodeLite {
            id: n.id,
            outpoint: n.outpoint,
            endpoint: r.endpoint,
            tier: n.tier,
            status: n.status,
            lat: r.lat,
            lon: r.lon,
            country_code: r.country_code,
            org: n
                .geo
                .as_ref()
                .map(|g| g.org.to_string())
                .filter(|o| !o.is_empty()),
            rank: n.rank,
            last_paid_height: n.last_paid_height,
            app_count: n.app_count,
            flags: row.flags,
        }
    }

    fn index_of(&self, id: NodeId) -> Option<usize> {
        self.f.nodes.binary_search_by_key(&id, |n| n.id).ok()
    }

    fn random_confirmed(&mut self) -> usize {
        loop {
            let i = self.rng.below(self.f.nodes.len());
            if self.f.nodes[i].status == NodeStatus::Confirmed {
                return i;
            }
        }
    }

    fn emit_nodes(
        &mut self,
        added: Vec<NodeLite>,
        removed: Vec<NodeId>,
        changed: Vec<NodeChange>,
        cause: DeltaCause,
    ) {
        if added.is_empty() && removed.is_empty() && changed.is_empty() {
            return;
        }
        let seq = self.emit(
            None,
            LiveBody::Nodes(NodesDelta {
                prev_seq: self.nodes_prev_seq,
                added,
                removed,
                changed,
                cause,
            }),
        );
        self.nodes_prev_seq = seq;
    }

    fn emit_apps(
        &mut self,
        upserted: Vec<AppIndexEntry>,
        instances: Vec<AppInstancesDelta>,
        cause: DeltaCause,
    ) {
        let seq = self.emit(
            None,
            LiveBody::Apps(AppsDelta {
                prev_seq: self.apps_prev_seq,
                upserted,
                removed: Vec::new(),
                instances,
                cause,
            }),
        );
        self.apps_prev_seq = seq;
    }

    fn app_entry(&self, k: usize) -> AppIndexEntry {
        let a = &self.f.apps[k];
        AppIndexEntry {
            name: a.name.clone(),
            display_name: a.display_name.clone(),
            owner: a.spec.owner.clone(),
            spec_version: a.spec.spec_version,
            instances_target: a.spec.instances,
            instances_running: a.locations.len() as u32,
            component_count: a.spec.components.len() as u32,
            enterprise: a.spec.enterprise,
            per_instance: a.spec.per_instance(),
            totals: a.totals,
            height: a.height,
            expire_height: a.expire_height,
        }
    }

    // -----------------------------------------------------------------------------------------
    // Blocks
    // -----------------------------------------------------------------------------------------

    fn block(&mut self) {
        let height = self.f.tip + 1;
        let now = now_ms();
        // Detection latency: the explorer socket pushes about 0.3 to 1.5 s after the block time.
        let time_ms = now - self.rng.range(300, 1_500);
        let mut changed: Vec<NodeChange> = Vec::new();
        let mut added: Vec<NodeLite> = Vec::new();

        let producer_i = self.random_confirmed();
        let producer = node_ref(&self.f.nodes[producer_i]);

        // Payouts: the head of each tier queue is paid and moves to the back.
        let mut payouts = Vec::new();
        for (t, tier) in Tier::ALL.iter().enumerate() {
            if self.queues[t].is_empty() {
                continue;
            }
            let i = self.queues[t].remove(0);
            self.queues[t].push(i);
            let amount = emission::tier_payout(height, *tier).unwrap_or(Amount::ZERO);
            let n = &mut self.f.nodes[i];
            n.last_paid_height = Some(height);
            n.rank = Some(self.queues[t].len() as u32 - 1);
            payouts.push((*tier, n.id, n.payment_address.to_string(), amount));
            let mut c = NodeChange::new(n.id);
            c.last_paid_height = Some(height);
            c.rank = n.rank;
            changed.push(c);
        }
        // Everyone else in each queue moved up one slot.
        for q in &self.queues {
            for (rank, &i) in q.iter().enumerate() {
                self.f.nodes[i].rank = Some(rank as u32);
            }
        }

        // Heartbeats: 13 to 16 periodic confirms.
        let hb_count = self.rng.range(13, 16) as usize;
        let mut heartbeats: Vec<NodeId> = Vec::with_capacity(hb_count);
        while heartbeats.len() < hb_count {
            let i = self.random_confirmed();
            let id = self.f.nodes[i].id;
            if heartbeats.contains(&id) {
                continue;
            }
            heartbeats.push(id);
            self.f.nodes[i].last_confirmed_height = Some(height);
            let mut c = NodeChange::new(id);
            c.last_confirmed_height = Some(height);
            changed.push(c);
        }

        // Initial confirms: started nodes join the network and the back of their queue.
        let mut confirms = Vec::new();
        let joining = if self.rng.chance(0.3) {
            self.f
                .nodes
                .iter()
                .position(|n| n.status == NodeStatus::Started)
        } else {
            None
        };
        if let Some(i) = joining {
            let t = self.f.nodes[i].tier.index().unwrap_or(0);
            self.queues[t].push(i);
            let n = &mut self.f.nodes[i];
            n.status = NodeStatus::Confirmed;
            n.confirmed_height = Some(height);
            n.last_confirmed_height = Some(height);
            n.rank = Some(self.queues[t].len() as u32 - 1);
            confirms.push(n.id);
            let mut c = NodeChange::new(n.id);
            c.status = Some(NodeStatus::Confirmed);
            c.rank = n.rank;
            c.last_confirmed_height = Some(height);
            changed.push(c);
            let (id, tier) = (n.id, format!("{:?}", n.tier).to_lowercase());
            self.feed(
                FeedKind::NodeJoined,
                "node_joined",
                vec![FeedRef::Node { id }],
                &[("tier", tier)],
            );
        }

        // Starts: a new collateral announces a node.
        let mut starts = Vec::new();
        if self.rng.chance(0.25) {
            let i = self.new_node(height);
            starts.push(node_ref(&self.f.nodes[i]));
            added.push(self.node_lite(i));
            let id = self.f.nodes[i].id;
            self.feed(
                FeedKind::NodeStarted,
                "node_started",
                vec![FeedRef::Node { id }],
                &[],
            );
        }

        // Large transfers.
        let mut transfers = Vec::new();
        if self.rng.chance(0.15) {
            self.tx_counter += 1;
            let tx = TxLite {
                txid: hash("transfer", self.tx_counter),
                value: Amount::from_flux(self.rng.range(10_000, 250_000) as i64),
                kind: TxKind::Transfer,
                size: 400,
            };
            self.feed(
                FeedKind::LargeTransfer,
                "large_transfer",
                vec![FeedRef::Tx { txid: tx.txid }, FeedRef::Block { height }],
                &[("value", tx.value.to_string())],
            );
            transfers.push(tx);
        }

        let fees = Amount::from_sat(self.rng.range(1_000, 40_000) as i64);
        let reward = emission::pon_subsidy(height).unwrap_or(Amount::ZERO);
        let paid: Amount = payouts.iter().fold(Amount::ZERO, |a, p| a + p.3);
        let dev_fund = reward.checked_sub(paid).unwrap_or(Amount::ZERO) + fees;
        let mempool_txs = std::mem::take(&mut self.mempool_since_block);
        let tx_count = 1
            + heartbeats.len()
            + confirms.len()
            + starts.len()
            + transfers.len()
            + mempool_txs.len();
        let prev_hash = self
            .f
            .blocks
            .last()
            .map_or(hash("block", u64::from(height - 1)), |b| b.hash);
        let block_hash = hash("block", u64::from(height));

        let msg = BlockMsg {
            height,
            hash: block_hash,
            prev_hash,
            time_ms,
            size: 1_000 + 250 * tx_count as u32,
            tx_count: tx_count as u32,
            producer: Some(producer.clone()),
            payouts: payouts
                .iter()
                .map(|(tier, id, address, amount)| atlas_core::api::PayoutDto {
                    tier: *tier,
                    node: Some(*id),
                    address: address.clone(),
                    amount: *amount,
                })
                .collect(),
            heartbeats: heartbeats.clone(),
            confirms: confirms.clone(),
            starts: starts.clone(),
            updates: Vec::new(),
            transfers_over_threshold: transfers.clone(),
            reward,
            fees,
            dev_fund,
            app_payments: Vec::new(),
            collateral_spent: Vec::new(),
        };

        // Fixture state first (so the next republish matches what the stream said).
        let summary = BlockSummary {
            height,
            hash: block_hash,
            prev_hash,
            time_ms,
            size: msg.size,
            tx_count: msg.tx_count,
            kind: BlockKind::Pon,
            version: 100,
            producer_collateral: Some(Collateral::Full(producer.outpoint)),
            producer: Some(producer.id),
            payouts: payouts
                .iter()
                .map(|(tier, id, address, amount)| Payout {
                    tier: *tier,
                    address: address.as_str().into(),
                    amount: *amount,
                    node: Some(*id),
                })
                .collect(),
            dev_fund,
            fees,
            reward,
            value_out: transfers.iter().fold(Amount::ZERO, |a, t| a + t.value),
            confirm_count: (heartbeats.len() + confirms.len()) as u16,
            start_count: starts.len() as u16,
            transfer_count: transfers.len() as u16,
        };
        self.f.tip = height;
        self.f.tip_time_ms = time_ms;
        self.f.now_ms = now;
        self.f.blocks.push(summary.clone());
        if self.f.blocks.len() > 120 {
            self.f.blocks.remove(0);
        }
        let mut batch = WriteBatch::new();
        batch.put_block(summary);
        if let Err(e) = self.engine.store().commit(batch) {
            tracing::warn!(error = %e, "could not store demo block");
        }

        self.emit(Some(time_ms), LiveBody::Block(msg));
        self.emit_nodes(added, Vec::new(), changed, DeltaCause::Block);

        // Occasionally a node misses its check-in window and expires.
        if self.rng.chance(0.12) {
            let i = self.random_confirmed();
            let id = self.f.nodes[i].id;
            if let Some(t) = self.f.nodes[i].tier.index() {
                self.queues[t].retain(|&x| x != i);
            }
            self.f.nodes[i].status = NodeStatus::Expired;
            self.f.nodes[i].rank = None;
            let mut c = NodeChange::new(id);
            c.status = Some(NodeStatus::Expired);
            self.emit_nodes(Vec::new(), Vec::new(), vec![c], DeltaCause::Block);
            self.feed(
                FeedKind::NodeExpired,
                "node_expired",
                vec![FeedRef::Node { id }],
                &[],
            );
            let at = Instant::now() + self.scaled(60_000);
            self.jobs.push((at, Job::Remove { id }));
        }

        // Full rank reconcile every few blocks (the real engine coalesces RankShift).
        self.blocks_emitted += 1;
        if self.blocks_emitted.is_multiple_of(RECONCILE_EVERY) {
            let ranks: Vec<NodeChange> = self
                .f
                .nodes
                .iter()
                .filter(|n| n.rank.is_some())
                .map(|n| {
                    let mut c = NodeChange::new(n.id);
                    c.rank = n.rank;
                    c
                })
                .collect();
            self.emit_nodes(Vec::new(), Vec::new(), ranks, DeltaCause::Reconcile);
        }

        // The payees of the next block are known one block ahead.
        let payees = Tier::ALL
            .iter()
            .enumerate()
            .filter_map(|(t, tier)| {
                let &i = self.queues[t].first()?;
                let n = &self.f.nodes[i];
                Some(NextPayeeDto {
                    tier: *tier,
                    node: Some(n.id),
                    address: n.payment_address.to_string(),
                })
            })
            .collect();
        self.emit(
            None,
            LiveBody::NextPayees(NextPayeesMsg {
                height: height + 1,
                payees,
            }),
        );

        if heartbeats.len() + confirms.len() > 0 {
            self.feed(
                FeedKind::NodeHeartbeat,
                "node_heartbeats",
                vec![FeedRef::Block { height }],
                &[("count", (heartbeats.len() + confirms.len()).to_string())],
            );
        }
        self.stats();
        self.publish();
    }

    /// Adds a started node (a copy of a random located node on a new IP).
    fn new_node(&mut self, height: u32) -> usize {
        let template = self.random_confirmed();
        let id = NodeId(self.f.nodes.last().map_or(0, |n| n.id.0 + 1));
        let mut n: NodeRecord = self.f.nodes[template].clone();
        n.id = id;
        n.outpoint = Outpoint::new(hash("collateral", u64::from(id.0)), 0);
        let v = id.0 + 1_000_000;
        n.endpoint = Some(NodeEndpoint::new(
            IpAddr::V4(Ipv4Addr::new(45, (v >> 16) as u8, (v >> 8) as u8, v as u8)),
            16127,
        ));
        n.tier = Tier::ALL[self.rng.below(3)];
        n.status = NodeStatus::Started;
        n.rank = None;
        n.added_height = height;
        n.confirmed_height = None;
        n.last_confirmed_height = None;
        n.last_paid_height = None;
        n.app_count = 0;
        n.first_seen_ms = now_ms();
        if let Some(g) = n.geo.as_mut() {
            g.lat += (self.rng.unit() as f32 - 0.5) * 0.3;
            g.lon += (self.rng.unit() as f32 - 0.5) * 0.3;
        }
        self.f.nodes.push(n);
        self.f.nodes.len() - 1
    }

    fn stats(&mut self) {
        self.price_usd = (self.price_usd * (1.0 + (self.rng.unit() - 0.5) * 0.004)).max(0.01);
        let mut summary = self.f.summary();
        summary.mempool_size = self.mempool_since_block.len() as u32;
        summary.price = Some(PriceInfo {
            usd: self.price_usd,
            btc: self.price_usd / 64_000.0,
            change_24h_pct: 1.8,
            market_cap_usd: self.price_usd * 420_590_294.0,
            volume_24h_usd: 6_200_000.0,
            updated_ms: now_ms(),
            source: "demo".to_owned(),
        });
        self.emit(None, LiveBody::Stats { summary });
    }

    /// Rebuilds the snapshot bodies (bootstrap, nodes.bin, mesh.bin, apps) off the async runtime.
    fn publish(&mut self) {
        if self.publishing.as_ref().is_some_and(|h| !h.is_finished()) {
            self.publish_dirty = true;
            return;
        }
        self.publish_dirty = false;
        let engine = self.engine.clone();
        let f = self.f.clone();
        self.publishing = Some(tokio::task::spawn_blocking(move || {
            let t0 = Instant::now();
            match fixtures::publish(&engine, &f, false) {
                Ok(seq) => {
                    tracing::debug!(seq, ms = t0.elapsed().as_millis() as u64, "republished");
                }
                Err(e) => tracing::warn!(error = %e, "republish failed"),
            }
        }));
    }

    // -----------------------------------------------------------------------------------------
    // Mempool, apps, mesh
    // -----------------------------------------------------------------------------------------

    fn mempool_tx(&mut self) {
        self.tx_counter += 1;
        let r = self.rng.unit();
        let (kind, value, size) = if r < 0.91 {
            let kind = if self.rng.chance(0.9) {
                TxKind::NodeConfirm
            } else {
                TxKind::NodeStart
            };
            (kind, Amount::ZERO, self.rng.range(180, 260) as u32)
        } else {
            (
                TxKind::Transfer,
                Amount::from_sat(self.rng.range(10_000_000, 500_000_000_000) as i64),
                self.rng.range(220, 700) as u32,
            )
        };
        let tx = TxLite {
            txid: hash("mempool", self.tx_counter),
            value,
            kind,
            size,
        };
        self.mempool_since_block.push(tx.clone());
        self.emit(Some(now_ms()), LiveBody::Mempool { txs: vec![tx] });
    }

    fn app_event(&mut self) {
        let k = self.rng.below(self.f.apps.len());
        if self.rng.chance(0.2) && !self.f.apps[k].locations.is_empty() {
            // An instance goes away (expiry or rolling move).
            let inst = self.f.apps[k].locations.remove(0);
            if let Some(node) = inst.node {
                let name = self.f.apps[k].name.clone();
                self.emit_apps(
                    vec![self.app_entry(k)],
                    vec![AppInstancesDelta {
                        app: name,
                        started: Vec::new(),
                        removed: vec![node],
                        updated: Vec::new(),
                    }],
                    DeltaCause::Sweep,
                );
            }
            return;
        }
        let kind = if self.rng.chance(0.3) {
            AppMessageKind::Register
        } else {
            AppMessageKind::Update
        };
        self.tx_counter += 1;
        let h = hash("app-pending", self.tx_counter);
        let now = now_ms();
        let app = self.f.apps[k].name.clone();
        self.emit(
            Some(now),
            LiveBody::AppPending(AppPendingMsg {
                hash: h,
                app: app.clone(),
                kind,
                received_ms: now,
                expires_ms: now + 3_600_000,
            }),
        );
        self.feed(
            FeedKind::AppPending,
            "app_pending",
            vec![FeedRef::App { name: app }],
            &[],
        );
        // Median about 168 s until mined; about 15% never are.
        let mined = self.rng.chance(0.85);
        let wait = if mined {
            self.rng.range(90_000, 240_000)
        } else {
            300_000
        };
        let at = Instant::now() + self.scaled(wait);
        self.jobs.push((
            at,
            Job::Resolve {
                hash: h,
                app: k,
                mined,
            },
        ));
    }

    fn run_job(&mut self, job: Job) {
        match job {
            Job::Resolve {
                hash: h,
                app: k,
                mined,
            } => {
                let name = self.f.apps[k].name.clone();
                self.emit(
                    None,
                    LiveBody::AppPendingResolved(AppPendingResolvedMsg {
                        hash: h,
                        app: name.clone(),
                        mined,
                    }),
                );
                if !mined {
                    return;
                }
                let a = &mut self.f.apps[k];
                a.height = self.f.tip;
                a.updated_ms = now_ms();
                self.emit_apps(vec![self.app_entry(k)], Vec::new(), DeltaCause::Block);
                self.feed(
                    FeedKind::AppUpdated,
                    "app_updated",
                    vec![FeedRef::App { name }],
                    &[],
                );
                let count = self.rng.range(1, 3) as usize;
                let nodes: Vec<usize> = (0..count).map(|_| self.random_confirmed()).collect();
                let at = Instant::now() + self.scaled(12_000);
                self.jobs.push((at, Job::Install { app: k, nodes }));
            }
            Job::Install { app: k, nodes } => {
                let name = self.f.apps[k].name.clone();
                for &i in &nodes {
                    let n = &self.f.nodes[i];
                    self.emit(
                        None,
                        LiveBody::AppInstalling(AppInstallingMsg {
                            app: name.clone(),
                            node: Some(n.id),
                            endpoint: n.endpoint.map(|e| e.to_string()).unwrap_or_default(),
                        }),
                    );
                }
                let at = Instant::now() + self.scaled(20_000);
                self.jobs.push((at, Job::Spawn { app: k, nodes }));
            }
            Job::Spawn { app: k, nodes } => {
                let now = now_ms();
                let mut started = Vec::new();
                for &i in &nodes {
                    let n = &self.f.nodes[i];
                    let Some(endpoint) = n.endpoint else { continue };
                    started.push(n.id);
                    let spec_hash = self.f.apps[k].spec_hash;
                    self.f.apps[k].locations.push(AppInstance {
                        node: Some(n.id),
                        endpoint,
                        spec_hash,
                        broadcast_ms: now,
                        expire_ms: now + 7_200_000,
                        running_since_ms: Some(now),
                        os_uptime_s: 86_400,
                        static_ip: false,
                    });
                }
                let name = self.f.apps[k].name.clone();
                self.emit_apps(
                    vec![self.app_entry(k)],
                    vec![AppInstancesDelta {
                        app: name,
                        started,
                        removed: Vec::new(),
                        updated: Vec::new(),
                    }],
                    DeltaCause::Sweep,
                );
            }
            Job::Remove { id } => {
                if let Some(i) = self.index_of(id) {
                    for q in &mut self.queues {
                        q.retain(|&x| x != i);
                        for x in q.iter_mut() {
                            if *x > i {
                                *x -= 1;
                            }
                        }
                    }
                    self.f.nodes.remove(i);
                    self.emit_nodes(Vec::new(), vec![id], Vec::new(), DeltaCause::Reconcile);
                    self.feed(
                        FeedKind::NodeLeft,
                        "node_left",
                        vec![FeedRef::Node { id }],
                        &[],
                    );
                }
            }
        }
    }

    fn mesh_sweep(&mut self) {
        let n = self.f.nodes.len();
        let reporter = self.random_confirmed();
        let a = self.f.nodes[reporter].id.0;
        let mut added = Vec::new();
        for _ in 0..self.rng.range(3, 8) {
            let b = self.f.nodes[self.rng.below(n)].id.0;
            let e = (a.min(b), a.max(b));
            if a != b && self.mesh.insert(e) {
                added.push([NodeId(e.0), NodeId(e.1)]);
            }
        }
        let mut removed = Vec::new();
        let drop = self.rng.range(1, 4) as usize;
        let existing: Vec<(u32, u32)> = self.mesh.iter().copied().take(64).collect();
        for _ in 0..drop.min(existing.len()) {
            let e = existing[self.rng.below(existing.len())];
            if self.mesh.remove(&e) {
                removed.push([NodeId(e.0), NodeId(e.1)]);
            }
        }
        self.f.mesh = {
            let mut v: Vec<(NodeId, NodeId, u8)> = self
                .mesh
                .iter()
                .map(|&(a, b)| (NodeId(a), NodeId(b), 1))
                .collect();
            v.sort_unstable_by_key(|e| (e.0, e.1));
            v
        };
        self.emit(
            None,
            LiveBody::Mesh(MeshDelta {
                added,
                removed,
                reporters: vec![NodeId(a)],
            }),
        );
    }

    async fn run(mut self, mut shutdown: watch::Receiver<bool>) {
        let start = Instant::now();
        let mut next_block = start + Duration::from_millis(self.block_ms.min(10_000));
        let mut next_tx = start + Duration::from_millis(self.rng.exp_ms(MEMPOOL_MEAN_MS));
        let first_app = self.rng.range(10_000, 40_000);
        let mut next_app = start + self.scaled(first_app);
        let mut next_mesh = start + self.scaled(12_000);
        let mut next_stats = start + Duration::from_secs(5);
        // Aim right away so the first block has reticles to land on.
        let payees = Tier::ALL
            .iter()
            .enumerate()
            .filter_map(|(t, tier)| {
                let &i = self.queues[t].first()?;
                Some(NextPayeeDto {
                    tier: *tier,
                    node: Some(self.f.nodes[i].id),
                    address: self.f.nodes[i].payment_address.to_string(),
                })
            })
            .collect();
        self.emit(
            None,
            LiveBody::NextPayees(NextPayeesMsg {
                height: self.f.tip + 1,
                payees,
            }),
        );
        loop {
            let next_job = self.jobs.iter().map(|(t, _)| *t).min();
            let mut due = next_block
                .min(next_tx)
                .min(next_app)
                .min(next_mesh)
                .min(next_stats);
            if let Some(j) = next_job {
                due = due.min(j);
            }
            tokio::select! {
                () = sleep_until(due.into()) => {}
                _ = shutdown.changed() => break,
            }
            let now = Instant::now();
            if now >= next_block {
                self.block();
                // Flux intervals vary: jitter by up to 15% around the cadence.
                let jitter = (self.rng.unit() - 0.5) * 0.3 * self.block_ms as f64;
                next_block = now
                    + Duration::from_millis((self.block_ms as f64 + jitter).max(1_000.0) as u64);
                next_stats = now + Duration::from_secs(10);
            }
            if now >= next_tx {
                self.mempool_tx();
                next_tx = now + Duration::from_millis(self.rng.exp_ms(MEMPOOL_MEAN_MS));
            }
            if now >= next_app {
                self.app_event();
                let gap = self.rng.range(20_000, 60_000);
                next_app = now + self.scaled(gap);
            }
            if now >= next_mesh {
                self.mesh_sweep();
                next_mesh = now + self.scaled(12_000);
            }
            if now >= next_stats {
                self.stats();
                next_stats = now + Duration::from_secs(10);
            }
            let (ready, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.jobs)
                .into_iter()
                .partition(|(t, _)| *t <= now);
            self.jobs = later;
            for (_, job) in ready {
                self.run_job(job);
            }
            if self.publish_dirty {
                self.publish();
            }
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = tracing_subscriber::EnvFilter::try_from_env("ATLAS_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    let addr: SocketAddr = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("ATLAS_DEMO_BIND").ok())
        .unwrap_or_else(|| "127.0.0.1:3000".to_owned())
        .parse()?;
    let block_ms: u64 = std::env::var("ATLAS_DEMO_BLOCK_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30_000)
        .max(1_000);
    let seed: u64 = std::env::var("ATLAS_DEMO_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(now_ms);

    let dir = std::env::temp_dir().join(format!("atlas-demo-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let db = dir.join("atlas-demo.redb");
    let t0 = Instant::now();
    let (engine, f) = fixtures::fixture_engine(
        &db,
        fixtures::offline_clients(None),
        // Synthetic stream only: never ingest from the real network.
        EngineConfig {
            ingest: IngestConfig::disabled(),
            ..EngineConfig::default()
        },
        FixtureSpec::MAINNET,
    )?;
    tracing::info!(
        nodes = f.nodes.len(),
        apps = f.apps.len(),
        ms = t0.elapsed().as_millis() as u64,
        "fixture network ready"
    );

    let mut cfg = ServerConfig::default();
    cfg.ws.max_per_ip = 1_000;
    let state = AppState::new(engine.clone(), cfg);
    let hub = Arc::clone(&state.hub);
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, block_ms, seed, "demo server listening (http://{addr}, ws://{addr}/ws)");

    let (stop_tx, stop_rx) = watch::channel(false);
    let demo = tokio::spawn(Demo::new(engine.clone(), f, seed, block_ms).run(stop_rx));

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
        // Live clients get close code 1001 and reconnect elsewhere or later.
        hub.begin_shutdown();
        let _ = stop_tx.send(true);
    })
    .await?;
    let _ = demo.await;
    engine.shutdown().await;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

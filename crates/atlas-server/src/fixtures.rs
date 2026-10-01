//! Synthetic, deterministic network fixtures for tests, the load-test server and demos.
//!
//! [`Fixture::build`] generates nodes (co-hosted UPnP pairs, operators with several nodes, one
//! ASN under two org spellings, unlocated nodes), apps with instances and spec history, recent
//! blocks with attributed payouts, node transactions, node events, metrics rows, snapshots and
//! mesh edges. [`seed_store`] writes them the way the engine would, and [`publish`] swaps in a
//! `Published` with prebuilt bodies. Nothing here touches the network.

use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use atlas_core::api::{AppIndexEntry, NetworkSummary, SupplyInfo, TierCounts, TipInfo};
use atlas_core::app::{AppComponent, AppInstance, AppMessageRecord, AppRecord, AppSpec};
use atlas_core::chain::{BlockKind, BlockSummary, NodeTx, NodeTxKind, Payout};
use atlas_core::codec::mesh_bin::{encode_mesh_bin, flags as mesh_flags};
use atlas_core::emission::{self, DEV_FUND_ADDRESS};
use atlas_core::event::{AppMessageKind, Event, EventEnvelope};
use atlas_core::ids::{Collateral, Hash32, NodeId, Outpoint};
use atlas_core::net::NodeEndpoint;
use atlas_core::node::{Arch, BenchStatus, Geo, GeoSource, Hardware, NodeStatus, Versions};
use atlas_core::{Amount, NodeRecord, Tier, now_ms};
use atlas_engine::timemachine::{NetworkSnapshot, SnapNode};
use atlas_engine::{Engine, EngineConfig, EngineHandle, IngestConfig, PrebuiltBody};
use atlas_flux::ClientsConfig;
use atlas_flux::http::HostPolicy;
use atlas_store::{HOUR_MS, MINUTE_MS, MetricsRow, Store, WriteBatch, meta_keys};

use crate::body::to_json_vec;
use crate::search::{base58check_encode, t1_address};
use crate::views::{Views, apps_index_dto, block_lite, bootstrap_dto, nodes_bin};

/// Tip height of the fixture chain.
pub const TIP: u32 = 2_996_914;
/// Nodes per operator (payment address).
pub const NODES_PER_OPERATOR: usize = 8;

/// Sizes of a fixture network.
#[derive(Debug, Clone, Copy)]
pub struct FixtureSpec {
    pub nodes: usize,
    pub apps: usize,
    pub blocks: u32,
}

impl FixtureSpec {
    /// A small network for handler tests.
    pub const SMALL: Self = Self {
        nodes: 120,
        apps: 12,
        blocks: 40,
    };
    /// Mainnet-sized (September 2026): 6,724 nodes, 1,900 apps.
    pub const MAINNET: Self = Self {
        nodes: 6_724,
        apps: 1_900,
        blocks: 60,
    };
}

/// A generated network.
#[derive(Debug, Clone)]
pub struct Fixture {
    pub nodes: Vec<NodeRecord>,
    pub apps: Vec<AppRecord>,
    pub app_messages: Vec<AppMessageRecord>,
    pub blocks: Vec<BlockSummary>,
    pub node_txs: Vec<(u32, u16, NodeTx)>,
    pub events: Vec<EventEnvelope>,
    pub mesh: Vec<(NodeId, NodeId, u8)>,
    pub tip: u32,
    pub tip_time_ms: u64,
    pub now_ms: u64,
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
}

fn h32(tag: &str, i: u64) -> Hash32 {
    Hash32(*blake3::hash(format!("{tag}-{i}").as_bytes()).as_bytes())
}

fn h20(tag: &str, i: u64) -> [u8; 20] {
    let mut out = [0u8; 20];
    out.copy_from_slice(&blake3::hash(format!("{tag}-{i}").as_bytes()).as_bytes()[..20]);
    out
}

/// Payment address of operator `k`.
pub fn operator_address(k: usize) -> String {
    t1_address(h20("operator", k as u64))
}

/// ZelID (Bitcoin-style P2PKH) of operator `k`.
pub fn operator_zelid(k: usize) -> String {
    let mut p = vec![0u8];
    p.extend_from_slice(&h20("zelid", k as u64));
    base58check_encode(&p)
}

/// Collateral txid of node `i` (node 6 shares node 5's txid with vout 1).
pub fn collateral(i: usize) -> Outpoint {
    if i == 6 {
        Outpoint::new(h32("collateral", 5), 1)
    } else {
        Outpoint::new(h32("collateral", i as u64), 0)
    }
}

/// Host index of node `i`: the first 20 nodes run in pairs on one host (UPnP ports).
fn host_of(i: usize) -> (usize, u16) {
    if i < 20 {
        (i / 2, (i % 2) as u16)
    } else {
        (i - 10, 0)
    }
}

/// IP of host `h`.
pub fn host_ip(h: usize) -> Ipv4Addr {
    let v = h as u32 + 1;
    Ipv4Addr::new(5, (v >> 16) as u8, (v >> 8) as u8, v as u8)
}

/// Endpoint of node `i`.
pub fn endpoint(i: usize) -> NodeEndpoint {
    let (h, slot) = host_of(i);
    NodeEndpoint::new(IpAddr::V4(host_ip(h)), 16127 + 10 * slot)
}

struct Place {
    cc: &'static str,
    country: &'static str,
    continent: &'static str,
    region: &'static str,
    city: &'static str,
    lat: f32,
    lon: f32,
    org: &'static str,
    asn: Option<u32>,
    hosting: bool,
}

const PLACES: [Place; 10] = [
    Place {
        cc: "DE",
        country: "Germany",
        continent: "EU",
        region: "Saxony",
        city: "Falkenstein",
        lat: 50.47,
        lon: 12.37,
        org: "Hetzner Online GmbH",
        asn: Some(24940),
        hosting: true,
    },
    Place {
        cc: "FI",
        country: "Finland",
        continent: "EU",
        region: "Uusimaa",
        city: "Helsinki",
        lat: 60.17,
        lon: 24.94,
        org: "Hetzner Online",
        asn: Some(24940),
        hosting: true,
    },
    Place {
        cc: "US",
        country: "United States",
        continent: "NA",
        region: "Virginia",
        city: "Ashburn",
        lat: 39.04,
        lon: -77.49,
        org: "Amazon.com, Inc.",
        asn: Some(14618),
        hosting: true,
    },
    Place {
        cc: "FR",
        country: "France",
        continent: "EU",
        region: "Hauts-de-France",
        city: "Roubaix",
        lat: 50.69,
        lon: 3.17,
        org: "OVH SAS",
        asn: Some(16276),
        hosting: true,
    },
    Place {
        cc: "GB",
        country: "United Kingdom",
        continent: "EU",
        region: "England",
        city: "London",
        lat: 51.51,
        lon: -0.13,
        org: "Contabo GmbH",
        asn: Some(51167),
        hosting: true,
    },
    Place {
        cc: "CA",
        country: "Canada",
        continent: "NA",
        region: "Quebec",
        city: "Montreal",
        lat: 45.50,
        lon: -73.57,
        org: "OVH Hosting, Inc.",
        asn: Some(16276),
        hosting: true,
    },
    Place {
        cc: "JP",
        country: "Japan",
        continent: "AS",
        region: "Tokyo",
        city: "Tokyo",
        lat: 35.68,
        lon: 139.69,
        org: "Sakura Internet",
        asn: Some(9370),
        hosting: true,
    },
    Place {
        cc: "BR",
        country: "Brazil",
        continent: "SA",
        region: "Sao Paulo",
        city: "Sao Paulo",
        lat: -23.55,
        lon: -46.63,
        org: "Vivo",
        asn: Some(26599),
        hosting: false,
    },
    Place {
        cc: "AU",
        country: "Australia",
        continent: "OC",
        region: "New South Wales",
        city: "Sydney",
        lat: -33.87,
        lon: 151.21,
        org: "Telstra",
        asn: Some(1221),
        hosting: false,
    },
    Place {
        cc: "NL",
        country: "Netherlands",
        continent: "EU",
        region: "North Holland",
        city: "Amsterdam",
        lat: 52.37,
        lon: 4.90,
        org: "Home ISP B.V.",
        asn: None,
        hosting: false,
    },
];

fn tier_of(i: usize) -> Tier {
    match i % 10 {
        0..=4 => Tier::Cumulus,
        5..=6 => Tier::Nimbus,
        _ => Tier::Stratus,
    }
}

fn status_of(i: usize) -> NodeStatus {
    if i % 211 == 7 {
        NodeStatus::Departed
    } else if i % 97 == 3 {
        NodeStatus::Started
    } else {
        NodeStatus::Confirmed
    }
}

impl Fixture {
    #[allow(clippy::too_many_lines)]
    pub fn build(spec: FixtureSpec) -> Self {
        let now = now_ms();
        let tip = TIP;
        let tip_time_ms = now - 10_000;
        let mut rng = Rng(42);
        let mut ranks = [0u32; 3];
        let mut nodes = Vec::with_capacity(spec.nodes);
        for i in 0..spec.nodes {
            let tier = tier_of(i);
            let status = status_of(i);
            let rank = if status == NodeStatus::Confirmed {
                let t = tier.index().unwrap_or(0);
                ranks[t] += 1;
                Some(ranks[t] - 1)
            } else {
                None
            };
            let (h, _) = host_of(i);
            let place = &PLACES[h % PLACES.len()];
            let geo = (i % 50 != 49).then(|| Geo {
                lat: place.lat + (rng.unit() - 0.5) * 0.4,
                lon: place.lon + (rng.unit() - 0.5) * 0.4,
                continent_code: place.continent.into(),
                country_code: place.cc.into(),
                country: place.country.into(),
                region: place.region.into(),
                city: place.city.into(),
                org: place.org.into(),
                asn: place.asn,
                hosting: Some(place.hosting),
                source: GeoSource::NodeReported,
            });
            let (cores, ram) = match tier {
                Tier::Cumulus => (4, 8.0),
                Tier::Nimbus => (8, 32.0),
                _ => (16, 64.0),
            };
            let op = i / NODES_PER_OPERATOR;
            let last_confirmed = tip - (i as u32 * 37) % 600;
            nodes.push(NodeRecord {
                id: NodeId(i as u32),
                outpoint: collateral(i),
                endpoint: Some(endpoint(i)),
                tier,
                status,
                payment_address: operator_address(op).into(),
                pubkey: hex::encode(h32("pubkey", i as u64).0).into(),
                rank,
                added_height: tip - 100_000 - i as u32,
                confirmed_height: Some(tip - 99_990 - i as u32),
                last_confirmed_height: Some(last_confirmed),
                last_paid_height: Some(tip - (i as u32 * 13) % 3000),
                active_since_ms: Some(now - 60 * 86_400_000),
                geo,
                hw: Some(Hardware {
                    cores,
                    ram_gb: ram,
                    ssd_gb: 220.0 * f32::from(cores) / 4.0,
                    total_storage_gb: 240.0 * f32::from(cores) / 4.0,
                    eps: 240.0 * f32::from(cores),
                    down_mbps: 500.0,
                    up_mbps: 300.0,
                    arch: Arch::Amd64,
                    bench_status: BenchStatus::Passed,
                    bench_tier: tier,
                    ..Hardware::default()
                }),
                versions: Versions {
                    flux_os: Some(if i % 10 == 9 { "8.19.1" } else { "8.20.0" }.into()),
                    daemon: Some("9.1.0".into()),
                    bench: Some("5.1.0".into()),
                    arcane: (i % 4 == 0).then(|| "jolly wombat".into()),
                    os: Some("Ubuntu 24.04.4 LTS".into()),
                },
                arcane: Some(i % 4 == 0),
                zelid: (i % NODES_PER_OPERATOR < 6).then(|| operator_zelid(op).into()),
                upnp: Some(i < 20),
                static_ip: Some(true),
                reachable: Some(i % 53 != 0),
                app_count: (i % 5) as u16,
                peers_out: 8,
                peers_in: 12,
                first_seen_ms: now - 30 * 86_400_000,
                last_seen_ms: now,
                last_swept_ms: Some(now - 60_000),
                departed_ms: (status == NodeStatus::Departed).then_some(now - 3_600_000),
            });
        }

        // Apps with instances on nodes and a spec history for the first app.
        let mut apps = Vec::with_capacity(spec.apps);
        let mut app_messages = Vec::new();
        for k in 0..spec.apps {
            let name = match k {
                0 => "kadenanode".to_owned(),
                1 => "wordpressblog".to_owned(),
                _ => format!("fluxapp{k}"),
            };
            let spec_v = AppSpec {
                spec_version: 8,
                name: if k == 0 {
                    "KadenaNode".to_owned()
                } else {
                    name.clone()
                },
                description: format!("fixture app {k}"),
                owner: operator_zelid(k % 7),
                instances: 3,
                components: vec![AppComponent {
                    name: "main".into(),
                    repotag: format!("runonflux/{name}:latest"),
                    ports: vec![31_000 + k as u16],
                    container_ports: vec![80],
                    cpu: 0.5,
                    ram_mb: 1000,
                    hdd_gb: 10,
                    ..AppComponent::default()
                }],
                ..AppSpec::default()
            };
            let height = tip - 50_000 + k as u32;
            let hash = h32("app-message", k as u64);
            let mut rec =
                AppRecord::from_spec(spec_v.clone(), Some(hash), height, now - 86_400_000);
            if !nodes.is_empty() {
                for j in 0..3 {
                    let n = (k * 3 + j) % nodes.len();
                    rec.locations.push(AppInstance {
                        node: Some(NodeId(n as u32)),
                        endpoint: endpoint(n),
                        spec_hash: Some(hash),
                        broadcast_ms: now - 600_000,
                        expire_ms: now + 7_200_000,
                        running_since_ms: Some(now - 86_400_000),
                        os_uptime_s: 86_400,
                        static_ip: false,
                    });
                }
            }
            if k == 0 {
                let mut v2 = spec_v.clone();
                v2.instances = 5;
                let mut v3 = v2.clone();
                v3.expire_blocks = Some(88_000);
                for (j, (s, kind)) in [
                    (spec_v.clone(), AppMessageKind::Register),
                    (v2, AppMessageKind::Update),
                    (v3, AppMessageKind::Update),
                ]
                .into_iter()
                .enumerate()
                {
                    app_messages.push(AppMessageRecord {
                        hash: h32("app-history", j as u64),
                        txid: Some(h32("app-history-tx", j as u64)),
                        height: tip - 60_000 + j as u32 * 1_000,
                        timestamp_ms: now - (3 - j as u64) * 86_400_000,
                        kind,
                        paid: Amount::from_flux(5 + j as i64),
                        spec: s,
                    });
                }
            }
            apps.push(rec);
        }

        // Recent blocks with payouts attributed to the head of each tier's queue.
        let mut blocks = Vec::new();
        let mut node_txs = Vec::new();
        let by_tier: Vec<Vec<usize>> = Tier::ALL
            .iter()
            .map(|t| {
                (0..nodes.len())
                    .filter(|&i| nodes[i].tier == *t && nodes[i].status == NodeStatus::Confirmed)
                    .collect()
            })
            .collect();
        let first = tip + 1 - spec.blocks.min(tip);
        for h in first..=tip {
            let payouts: Vec<Payout> = Tier::ALL
                .iter()
                .enumerate()
                .filter_map(|(t, tier)| {
                    let list = &by_tier[t];
                    let i = *list.get(h as usize % list.len().max(1))?;
                    Some(Payout {
                        tier: *tier,
                        address: nodes[i].payment_address.clone(),
                        amount: emission::tier_payout(h, *tier).unwrap_or(Amount::ZERO),
                        node: Some(NodeId(i as u32)),
                    })
                })
                .collect();
            let producer = (!nodes.is_empty()).then(|| (h as usize * 7) % nodes.len());
            let confirm_for = (!nodes.is_empty()).then(|| h as usize % nodes.len());
            if let Some(n) = confirm_for {
                node_txs.push((
                    h,
                    1u16,
                    NodeTx {
                        txid: h32("node-tx", u64::from(h)),
                        height: Some(h),
                        kind: NodeTxKind::UpdateConfirm,
                        collateral: nodes[n].outpoint,
                        endpoint: nodes[n].endpoint,
                        benchmark_tier: Some(nodes[n].tier),
                        sig_time: (tip_time_ms / 1000) - u64::from(tip - h) * 30,
                        tx_version: 5,
                        upgraded_version: None,
                        p2sh: false,
                        node: Some(NodeId(n as u32)),
                    },
                ));
            }
            blocks.push(BlockSummary {
                height: h,
                hash: h32("block", u64::from(h)),
                prev_hash: h32("block", u64::from(h - 1)),
                time_ms: tip_time_ms - u64::from(tip - h) * 30_000,
                size: 4000,
                tx_count: 3,
                kind: BlockKind::Pon,
                version: 100,
                producer_collateral: producer.map(|p| Collateral::Full(nodes[p].outpoint)),
                producer: producer.map(|p| NodeId(p as u32)),
                payouts: payouts.into_iter().collect(),
                dev_fund: Amount(50_000_000),
                fees: Amount::ZERO,
                reward: emission::pon_subsidy(h).unwrap_or(Amount::ZERO),
                value_out: Amount::from_flux(12),
                confirm_count: u16::from(confirm_for.is_some()),
                start_count: 0,
                transfer_count: 1,
            });
        }

        // Node 0's history: started, joined, heartbeats, an outage, payments.
        let mut events = Vec::new();
        if !nodes.is_empty() {
            let id = NodeId(0);
            let day = 86_400_000;
            let ev = |seq: u64, ts: u64, event: Event| EventEnvelope {
                seq,
                observed_ms: ts,
                event_ms: Some(ts),
                event,
            };
            events.push(ev(
                1,
                now - 20 * day,
                Event::NodeStarted {
                    node: id,
                    outpoint: nodes[0].outpoint,
                    height: tip - 28_000,
                    txid: h32("start", 0),
                    tx_version: 5,
                    p2sh: false,
                },
            ));
            events.push(ev(
                2,
                now - 20 * day + 60_000,
                Event::NodeConfirmed {
                    node: id,
                    height: tip - 27_990,
                    txid: h32("confirm", 0),
                },
            ));
            events.push(ev(
                3,
                now - 3 * day,
                Event::NodeHeartbeat {
                    node: id,
                    height: tip - 8000,
                    txid: h32("hb", 0),
                    endpoint: nodes[0].endpoint,
                    benchmark_tier: Some(nodes[0].tier),
                },
            ));
            events.push(ev(4, now - 2 * day, Event::NodeUnreachable { node: id }));
            events.push(ev(
                5,
                now - 2 * day + 6 * 3_600_000,
                Event::NodeRecovered { node: id },
            ));
            events.push(ev(
                6,
                now - day,
                Event::NodePaid {
                    node: Some(id),
                    tier: nodes[0].tier,
                    address: nodes[0].payment_address.clone(),
                    amount: Amount::from_flux(1),
                    height: tip - 2000,
                },
            ));
        }

        // A ring of mesh edges over the first 200 nodes.
        let span = nodes.len().min(200);
        let mesh = (0..span.saturating_sub(1))
            .map(|i| {
                let f = if i % 2 == 0 {
                    mesh_flags::BIDIRECTIONAL
                } else {
                    0
                };
                (NodeId(i as u32), NodeId(i as u32 + 1), f)
            })
            .collect();

        Self {
            nodes,
            apps,
            app_messages,
            blocks,
            node_txs,
            events,
            mesh,
            tip,
            tip_time_ms,
            now_ms: now,
        }
    }

    /// Index entries of the fixture apps.
    pub fn app_index(&self) -> Vec<AppIndexEntry> {
        self.apps
            .iter()
            .map(|a| AppIndexEntry {
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
            })
            .collect()
    }

    /// The network summary an engine would publish for this fixture.
    pub fn summary(&self) -> NetworkSummary {
        let mut tiers = TierCounts::default();
        let mut hosts = std::collections::HashSet::new();
        let mut countries = std::collections::HashSet::new();
        for n in self.nodes.iter().filter(|n| n.status.is_active()) {
            tiers.add(n.tier);
            if let Some(e) = n.endpoint {
                hosts.insert(e.ip);
            }
            if let Some(g) = &n.geo {
                countries.insert(g.country_code.clone());
            }
        }
        let last = self.blocks.last();
        let transparent = Amount::from_flux(430_557_127);
        let shielded = Amount::from_flux(250_000);
        NetworkSummary {
            node_count: tiers.total,
            host_count: hosts.len() as u32,
            tiers,
            country_count: countries.len() as u32,
            provider_count: 9,
            arcane_count: self.nodes.iter().filter(|n| n.arcane == Some(true)).count() as u32,
            unreachable_count: self
                .nodes
                .iter()
                .filter(|n| n.reachable == Some(false))
                .count() as u32,
            app_count: self.apps.len() as u32,
            instance_count: self.apps.iter().map(|a| a.locations.len() as u32).sum(),
            tip: last.map(|b| TipInfo {
                height: b.height,
                hash: b.hash,
                time_ms: b.time_ms,
                producer: b.producer,
            }),
            reward: emission::pon_subsidy(self.tip).unwrap_or(Amount::ZERO),
            next_reduction_height: emission::next_reduction_height(self.tip),
            supply: Some(SupplyInfo {
                height: self.tip,
                transparent,
                shielded,
                total: transparent + shielded,
                circulating_explorer: Some(Amount::from_flux(420_590_294)),
                updated_ms: self.now_ms,
            }),
            price: None,
            mempool_size: 12,
        }
    }
}

/// Writes the fixture into `store` the way the engine would.
pub fn seed_store(store: &Store, f: &Fixture) -> anyhow::Result<()> {
    let mut b = WriteBatch::with_capacity(f.nodes.len() * 2 + 1000);
    b.set_meta_u64(meta_keys::FIRST_INGEST_MS, f.now_ms - 30 * 86_400_000);
    for n in &f.nodes {
        b.intern_node(n.outpoint, n.id);
        b.put_node(n.clone());
    }
    for blk in &f.blocks {
        b.put_block(blk.clone());
    }
    for (h, i, t) in &f.node_txs {
        b.put_node_tx(*h, *i, t.clone());
    }
    for a in &f.apps {
        b.put_app(a.clone());
    }
    for m in &f.app_messages {
        b.put_app_message(m.clone());
    }
    for e in &f.events {
        b.push_event(e.clone());
    }
    for (a, c, flags) in &f.mesh {
        b.put_mesh_edge(
            *a,
            *c,
            atlas_store::MeshEdgeRecord {
                flags: *flags,
                first_seen_ms: f.now_ms - 3_600_000,
                last_seen_ms: f.now_ms,
            },
        );
    }
    let s = f.summary();
    let minute0 = f.now_ms - f.now_ms % MINUTE_MS;
    for m in 0..180u64 {
        b.put_metrics_1m(MetricsRow {
            ts_ms: minute0 - m * MINUTE_MS,
            tip_height: Some(f.tip - m as u32 * 2),
            node_count: Some(s.node_count - (m % 3) as u32),
            tier_counts: Some([s.tiers.cumulus, s.tiers.nimbus, s.tiers.stratus]),
            block_count: Some(2),
            avg_block_time_ms: Some(30_000),
            samples: 1,
            ..MetricsRow::default()
        });
    }
    let hour0 = f.now_ms - f.now_ms % HOUR_MS;
    for hr in 0..72u64 {
        b.put_metrics_1h(MetricsRow {
            ts_ms: hour0 - hr * HOUR_MS,
            tip_height: Some(f.tip - hr as u32 * 120),
            node_count: Some(s.node_count),
            block_count: Some(120),
            avg_block_time_ms: Some(30_000),
            samples: 60,
            ..MetricsRow::default()
        });
    }
    // Time-machine keyframes: the older one predates the join of the last node.
    let snap = |nodes: &[NodeRecord], ts_ms: u64| NetworkSnapshot {
        ts_ms,
        tip_height: f.tip,
        nodes: nodes.iter().map(SnapNode::from_record).collect(),
    };
    let older = &f.nodes[..f.nodes.len().saturating_sub(1)];
    b.put_snapshot(f.now_ms - 2 * HOUR_MS, &snap(older, f.now_ms - 2 * HOUR_MS))?;
    b.put_snapshot(f.now_ms - HOUR_MS, &snap(&f.nodes, f.now_ms - HOUR_MS))?;
    store.commit_durable(b).context("seeding fixture store")?;
    Ok(())
}

/// Publishes the fixture (with prebuilt bodies, as the engine does) and returns the seq used.
pub fn publish(engine: &EngineHandle, f: &Fixture, stale: bool) -> anyhow::Result<u64> {
    let seq = engine.seq();
    let mut p = (*engine.published()).clone();
    p.seq = seq;
    p.stale = stale;
    p.generated_ms = now_ms();
    p.network = f.summary();
    p.nodes = f.nodes.clone().into();
    p.apps = f.app_index().into();
    p.blocks = f
        .blocks
        .iter()
        .rev()
        .take(30)
        .map(block_lite)
        .collect::<Vec<_>>()
        .into();
    let views = Views::build(Arc::new(p.clone()));
    p.bodies.bootstrap = Some(PrebuiltBody::build(
        "application/json",
        to_json_vec(&bootstrap_dto(&views)),
    )?);
    p.bodies.nodes_bin = Some(PrebuiltBody::build(
        "application/octet-stream",
        nodes_bin(&p),
    )?);
    p.bodies.mesh_bin = Some(PrebuiltBody::build(
        "application/octet-stream",
        encode_mesh_bin(seq, p.generated_ms, f.mesh.iter().copied()),
    )?);
    p.bodies.apps_index = Some(PrebuiltBody::build(
        "application/json",
        to_json_vec(&apps_index_dto(&p)),
    )?);
    engine.publish(p);
    Ok(seq)
}

/// Clients that point every upstream at `base` (default: a closed local port), fail fast, and
/// never reach the internet.
pub fn offline_clients(base: Option<&str>) -> ClientsConfig {
    let base = base.unwrap_or("http://127.0.0.1:9").to_owned();
    let mut c = ClientsConfig {
        fluxos_gateway: base.clone(),
        insight_bases: vec![base.clone()],
        stats_base: base.clone(),
        coingecko_base: base,
        ..ClientsConfig::default()
    };
    c.http.attempts = 1;
    c.http.timeout = Duration::from_secs(5);
    c.http.connect_timeout = Duration::from_secs(1);
    c.http.default_policy = HostPolicy::new(10_000, 10_000, 256);
    c.http.host_policies.clear();
    c
}

/// Engine settings for tests and fixture servers: ingest disabled (never touches the network)
/// and no keepalive noise.
pub fn test_engine_config() -> EngineConfig {
    EngineConfig {
        ping_interval: Duration::from_secs(3600),
        ingest: IngestConfig::disabled(),
        ..EngineConfig::default()
    }
}

/// An engine over an empty store with offline clients.
pub fn offline_engine(db: &Path) -> anyhow::Result<EngineHandle> {
    let store = Store::open(db)?;
    let clients = atlas_flux::Clients::new(offline_clients(None))?;
    Ok(Engine::start(test_engine_config(), store, clients))
}

/// Seeds a store with `spec`, starts an engine on it, and publishes fresh state.
pub fn fixture_engine(
    db: &Path,
    clients: ClientsConfig,
    config: EngineConfig,
    spec: FixtureSpec,
) -> anyhow::Result<(EngineHandle, Fixture)> {
    let f = Fixture::build(spec);
    let store = Store::open(db)?;
    seed_store(&store, &f)?;
    let engine = Engine::start(config, store, atlas_flux::Clients::new(clients)?);
    wait_for_startup_publish(&engine, Duration::from_secs(10));
    publish(&engine, &f, false)?;
    Ok((engine, f))
}

/// Blocks until the engine's reducer installed its startup publish (built on its own threads
/// from the restored store), so a fixture published afterwards is not overwritten by it. With
/// ingest disabled nothing else republishes unless the state changes.
pub fn wait_for_startup_publish(engine: &EngineHandle, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while engine.published().bodies.bootstrap.is_none() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// The dev fund address (re-exported for tests).
pub const DEV_FUND: &str = DEV_FUND_ADDRESS;

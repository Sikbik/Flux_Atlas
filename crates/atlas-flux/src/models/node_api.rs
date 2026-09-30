//! Per-node FluxOS API models (`/flux/*`, `/benchmark/*`, node-local `/apps/*`), including the
//! full `/flux/info` object that stats.runonflux.io aggregates for every node.

use std::collections::BTreeMap;

use atlas_core::node::{
    Arch, BenchStatus, Geo, GeoSource, Hardware, Versions, format_daemon_version,
};
use atlas_core::{NodeEndpoint, Tier};
use serde::Deserialize;

use crate::lenient;
use crate::models::apps::RawAppSpec;
use crate::models::daemon::DaemonInfo;

/// `benchmark.bench` / `/benchmark/getbenchmarks`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Bench {
    #[serde(deserialize_with = "lenient::string")]
    pub ipaddress: String,
    #[serde(deserialize_with = "lenient::string")]
    pub architecture: String,
    #[serde(deserialize_with = "lenient::string")]
    pub armboard: String,
    /// Tier name when passing, `running`, `failed`, or `"0"` (stats placeholder).
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    /// Unix seconds.
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub time: Option<u64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub cores: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub real_cores: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub ram: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub ssd: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub hdd: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub ddwrite: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub totalstorage: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub eps: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub ping: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub download_speed: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub upload_speed: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub bench_version: Option<String>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub systemsecure: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub error: Option<String>,
}

fn f32z(v: Option<f64>) -> f32 {
    v.filter(|x| x.is_finite() && *x > 0.0)
        .map_or(0.0, |x| x as f32)
}

impl Bench {
    /// True for the zeroed stats placeholder of an unreachable node.
    pub fn is_placeholder(&self) -> bool {
        self.status.trim() == "0"
            || (self.cores.unwrap_or(0.0) == 0.0 && self.architecture.is_empty())
    }

    /// Converts to [`Hardware`]; `None` for placeholders.
    pub fn to_hardware(&self) -> Option<Hardware> {
        if self.is_placeholder() {
            return None;
        }
        let (bench_status, bench_tier) = BenchStatus::parse_lenient(&self.status);
        Some(Hardware {
            cores: self
                .cores
                .filter(|c| *c > 0.0)
                .map_or(0, |c| c.round().min(65_535.0) as u16),
            ram_gb: f32z(self.ram),
            ssd_gb: f32z(self.ssd),
            hdd_gb: f32z(self.hdd),
            total_storage_gb: f32z(self.totalstorage),
            eps: f32z(self.eps),
            disk_write_mbs: f32z(self.ddwrite),
            down_mbps: f32z(self.download_speed),
            up_mbps: f32z(self.upload_speed),
            ping_ms: f32z(self.ping),
            arch: Arch::parse_lenient(&self.architecture),
            arm_board: self.armboard.trim().into(),
            bench_status,
            bench_tier,
            bench_time_ms: self.time.map_or(0, |t| t * 1000),
            bench_error: self.error.as_deref().map(Into::into),
            system_secure: self.systemsecure,
        })
    }
}

/// `benchmark.info` / `/benchmark/getinfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BenchInfo {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub version: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub rpcport: Option<u32>,
}

/// `benchmark.status` / `/benchmark/getstatus`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BenchStatusInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    #[serde(deserialize_with = "lenient::string")]
    pub benchmarking: String,
    #[serde(deserialize_with = "lenient::string")]
    pub flux: String,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub systemsecure: Option<bool>,
}

/// `benchmark` section of `/flux/info`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BenchmarkSection {
    pub info: BenchInfo,
    pub status: BenchStatusInfo,
    pub bench: Bench,
}

/// `{dosState, dosMessage}`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DosState {
    #[serde(rename = "dosState", deserialize_with = "lenient::opt_f64")]
    pub dos_state: Option<f64>,
    #[serde(rename = "dosMessage", deserialize_with = "lenient::opt_string")]
    pub dos_message: Option<String>,
}

/// `flux` section of `/flux/info`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FluxSection {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub version: Option<String>,
    #[serde(rename = "dockerVersion", deserialize_with = "lenient::opt_string")]
    pub docker_version: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub os: Option<String>,
    #[serde(rename = "osVersion", deserialize_with = "lenient::opt_string")]
    pub os_version: Option<String>,
    #[serde(rename = "osPrettyName", deserialize_with = "lenient::opt_string")]
    pub os_pretty_name: Option<String>,
    /// `host:port`.
    #[serde(deserialize_with = "lenient::opt_string")]
    pub ip: Option<String>,
    #[serde(rename = "staticIp", deserialize_with = "lenient::opt_bool")]
    pub static_ip: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub upnp: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub zelid: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub timezone: Option<String>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub dos: Option<DosState>,
    /// Present only on ArcaneOS.
    #[serde(rename = "arcaneVersion", deserialize_with = "lenient::opt_string")]
    pub arcane_version: Option<String>,
    #[serde(
        rename = "arcaneHumanVersion",
        deserialize_with = "lenient::opt_string"
    )]
    pub arcane_human_version: Option<String>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub development: Option<bool>,
    #[serde(
        rename = "numberOfConnectionsOut",
        deserialize_with = "lenient::opt_u32"
    )]
    pub connections_out: Option<u32>,
    #[serde(
        rename = "numberOfConnectionsIn",
        deserialize_with = "lenient::opt_u32"
    )]
    pub connections_in: Option<u32>,
}

/// `daemon` section of `/flux/info`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DaemonSection {
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub info: Option<DaemonInfo>,
    #[serde(rename = "zmqEnabled", deserialize_with = "lenient::opt_bool")]
    pub zmq_enabled: Option<bool>,
}

/// `apps.fluxusage` (the stats placeholder sends the string `"0"`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FluxUsage {
    #[serde(rename = "totalApps", deserialize_with = "lenient::opt_u32")]
    pub total_apps: Option<u32>,
    #[serde(rename = "runningApps", deserialize_with = "lenient::opt_u32")]
    pub running_apps: Option<u32>,
    /// Can be negative upstream.
    #[serde(rename = "stoppedApps", deserialize_with = "lenient::opt_i64")]
    pub stopped_apps: Option<i64>,
}

/// One running container (`apps.runningapps[]`, `/apps/listrunningapps`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RunningContainer {
    #[serde(rename = "Names", deserialize_with = "lenient::string_vec")]
    pub names: Vec<String>,
    #[serde(rename = "State", deserialize_with = "lenient::string")]
    pub state: String,
    #[serde(rename = "Status", deserialize_with = "lenient::string")]
    pub status: String,
}

impl RunningContainer {
    /// App name from a container name `/flux<component>_<app>` (or `/zel...`).
    pub fn app_name(&self) -> Option<String> {
        let n = self.names.first()?.trim_start_matches('/');
        let n = n
            .strip_prefix("flux")
            .or_else(|| n.strip_prefix("zel"))
            .unwrap_or(n);
        let app = n.rsplit_once('_').map_or(n, |(_, a)| a);
        (!app.is_empty()).then(|| app.to_ascii_lowercase())
    }
}

/// `apps.resources`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppsResources {
    #[serde(rename = "appsCpusLocked", deserialize_with = "lenient::opt_f64")]
    pub cpus_locked: Option<f64>,
    #[serde(rename = "appsRamLocked", deserialize_with = "lenient::opt_f64")]
    pub ram_locked_mb: Option<f64>,
    #[serde(rename = "appsHddLocked", deserialize_with = "lenient::opt_f64")]
    pub hdd_locked_gb: Option<f64>,
}

/// `apps` section of `/flux/info`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppsSection {
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub fluxusage: Option<FluxUsage>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub runningapps: Vec<RunningContainer>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub resources: Option<AppsResources>,
}

/// ip-api style geolocation (`/flux/geolocation`, `/flux/info.geolocation`, stats
/// `/fluxlocation/<ip>`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Geolocation {
    #[serde(deserialize_with = "lenient::opt_string")]
    pub ip: Option<String>,
    #[serde(deserialize_with = "lenient::string")]
    pub continent: String,
    #[serde(rename = "continentCode", deserialize_with = "lenient::string")]
    pub continent_code: String,
    #[serde(deserialize_with = "lenient::string")]
    pub country: String,
    #[serde(rename = "countryCode", deserialize_with = "lenient::string")]
    pub country_code: String,
    #[serde(deserialize_with = "lenient::string")]
    pub region: String,
    #[serde(rename = "regionName", deserialize_with = "lenient::string")]
    pub region_name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub city: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub lat: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub lon: Option<f64>,
    #[serde(deserialize_with = "lenient::string")]
    pub org: String,
    #[serde(deserialize_with = "lenient::string")]
    pub isp: String,
    /// `AS24940 Hetzner Online GmbH`.
    #[serde(deserialize_with = "lenient::string")]
    pub asn: String,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub hosting: Option<bool>,
    #[serde(rename = "dataCenter", deserialize_with = "lenient::opt_bool")]
    pub data_center: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub proxy: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub mobile: Option<bool>,
}

/// Parses the ASN number from `AS24940 Hetzner Online GmbH`.
pub fn parse_asn(s: &str) -> Option<u32> {
    let t = s.trim();
    let digits: String = t
        .strip_prefix("AS")
        .unwrap_or(t)
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok().filter(|v| *v > 0)
}

impl Geolocation {
    /// Zeroed placeholders (lat/lon 0 with no country) mean unknown.
    pub fn is_placeholder(&self) -> bool {
        let zero = |v: Option<f64>| v.is_none_or(|x| x == 0.0);
        zero(self.lat) && zero(self.lon) && self.country_code.is_empty()
    }

    /// Converts to [`Geo`]; `None` for placeholders.
    pub fn to_geo(&self, source: GeoSource) -> Option<Geo> {
        if self.is_placeholder() {
            return None;
        }
        let hosting = match (self.hosting, self.data_center) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(false) || b.unwrap_or(false)),
        };
        Some(Geo {
            lat: self.lat.unwrap_or(0.0) as f32,
            lon: self.lon.unwrap_or(0.0) as f32,
            continent_code: self.continent_code.as_str().into(),
            country_code: self.country_code.as_str().into(),
            country: self.country.as_str().into(),
            region: if self.region_name.is_empty() {
                self.region.as_str()
            } else {
                self.region_name.as_str()
            }
            .into(),
            city: self.city.as_str().into(),
            org: if self.org.is_empty() {
                self.isp.as_str()
            } else {
                self.org.as_str()
            }
            .into(),
            asn: parse_asn(&self.asn),
            hosting,
            source,
        })
    }
}

/// `node.status` section (same shape as `getfluxnodestatus`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeStatusInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    #[serde(deserialize_with = "lenient::string")]
    pub collateral: String,
    #[serde(deserialize_with = "lenient::string")]
    pub txhash: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub outidx: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
    #[serde(deserialize_with = "lenient::string")]
    pub payment_address: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub last_confirmed_height: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub last_paid_height: Option<u32>,
}

/// `node` section of `/flux/info`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeSection {
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub status: Option<NodeStatusInfo>,
}

/// `/flux/info`: everything about one node in one call.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FluxInfo {
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub daemon: Option<DaemonSection>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub node: Option<NodeSection>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub benchmark: Option<BenchmarkSection>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub flux: Option<FluxSection>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub apps: Option<AppsSection>,
    #[serde(deserialize_with = "lenient::opt_lenient")]
    pub geolocation: Option<Geolocation>,
    #[serde(rename = "appsHashesTotal", deserialize_with = "lenient::opt_u32")]
    pub apps_hashes_total: Option<u32>,
    #[serde(rename = "hashesPresent", deserialize_with = "lenient::opt_u32")]
    pub hashes_present: Option<u32>,
}

impl FluxInfo {
    pub fn hardware(&self) -> Option<Hardware> {
        let b = self.benchmark.as_ref()?;
        let mut hw = b.bench.to_hardware()?;
        if hw.system_secure.is_none() {
            hw.system_secure = b.status.systemsecure;
        }
        Some(hw)
    }

    pub fn versions(&self) -> Versions {
        let flux = self.flux.as_ref();
        let os = flux.and_then(|f| {
            f.os_pretty_name
                .clone()
                .or_else(|| match (&f.os, &f.os_version) {
                    (Some(o), Some(v)) => Some(format!("{o} {v}")),
                    (Some(o), None) => Some(o.clone()),
                    _ => None,
                })
        });
        Versions {
            flux_os: flux.and_then(|f| f.version.as_deref()).map(Into::into),
            daemon: self
                .daemon
                .as_ref()
                .and_then(|d| d.info.as_ref())
                .and_then(|i| format_daemon_version(i.version))
                .map(Into::into),
            bench: self
                .benchmark
                .as_ref()
                .and_then(|b| b.info.version.as_deref())
                .map(Into::into),
            arcane: flux
                .and_then(|f| {
                    f.arcane_human_version
                        .clone()
                        .or_else(|| f.arcane_version.clone())
                })
                .map(Into::into),
            os: os.map(Into::into),
        }
    }

    /// `Some(true)` when `flux.arcaneVersion` is present (verified to match `/flux/isarcaneos`).
    pub fn is_arcane(&self) -> Option<bool> {
        self.flux.as_ref().map(|f| f.arcane_version.is_some())
    }

    pub fn geo(&self, source: GeoSource) -> Option<Geo> {
        self.geolocation.as_ref().and_then(|g| g.to_geo(source))
    }

    /// Lowercase app names from running containers.
    pub fn running_apps(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .apps
            .as_ref()
            .map(|a| {
                a.runningapps
                    .iter()
                    .filter_map(RunningContainer::app_name)
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v.dedup();
        v
    }

    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        self.flux
            .as_ref()
            .and_then(|f| f.ip.as_deref())
            .and_then(|ip| NodeEndpoint::parse_opt(ip).ok().flatten())
    }
}

/// One entry of `/flux/connectedpeersinfo`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ConnectedPeerInfo {
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub port: Option<u32>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub latency: Option<f64>,
}

/// One entry of `/flux/peers` (rich per-link stats, FluxOS 8.x).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PeerLink {
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub port: Option<u32>,
    /// `inbound` / `outbound`.
    #[serde(deserialize_with = "lenient::string")]
    pub direction: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub latency: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_u64")]
    pub uptime: Option<u64>,
    #[serde(rename = "remoteVersion", deserialize_with = "lenient::opt_string")]
    pub remote_version: Option<String>,
    #[serde(rename = "isAlive", deserialize_with = "lenient::opt_bool")]
    pub is_alive: Option<bool>,
}

impl PeerLink {
    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        let ip: std::net::IpAddr = self.ip.parse().ok()?;
        let port = self
            .port
            .and_then(|p| u16::try_from(p).ok())
            .unwrap_or(atlas_core::DEFAULT_API_PORT);
        Some(NodeEndpoint::new(ip, port))
    }
}

/// Peer sets of one reporter in `/flux/topology`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TopologyEntry {
    #[serde(deserialize_with = "lenient::string_vec")]
    pub outbound: Vec<String>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub inbound: Vec<String>,
}

/// `/flux/topology`: peer lists that about 60 neighbours reported to this node.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Topology {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub reporters: u32,
    #[serde(rename = "knownPeers", deserialize_with = "lenient::u32_or_zero")]
    pub known_peers: u32,
    pub topology: BTreeMap<String, TopologyEntry>,
}

impl Topology {
    /// Directed edges `(from, to)` with parsed endpoints; unparsable entries are skipped.
    pub fn edges(&self) -> Vec<(NodeEndpoint, NodeEndpoint)> {
        let mut out = Vec::new();
        for (reporter, e) in &self.topology {
            let Ok(Some(r)) = NodeEndpoint::parse_opt(reporter) else {
                continue;
            };
            for p in &e.outbound {
                if let Ok(Some(to)) = NodeEndpoint::parse_opt(p) {
                    out.push((r, to));
                }
            }
            for p in &e.inbound {
                if let Ok(Some(from)) = NodeEndpoint::parse_opt(p) {
                    out.push((from, r));
                }
            }
        }
        out
    }
}

/// `/flux/health` (FluxOS 8.19+): component name to `ok` / `degraded` / `unmeasured`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct HealthReport(pub BTreeMap<String, String>);

/// Parses the doubly encoded `/daemon/getbenchmarks` payload (`data` is a JSON string).
pub fn parse_daemon_benchmarks(data: &str) -> Option<Bench> {
    serde_json::from_str(data).ok()
}

/// Installed apps on a node (`/apps/installedapps`), as normalized names.
pub fn installed_app_names(specs: &[RawAppSpec]) -> Vec<String> {
    let mut v: Vec<String> = specs
        .iter()
        .map(|s| s.name.to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    v.sort();
    v.dedup();
    v
}

/// Tier reported by `/flux/nodetier` (`stratus_new` and similar).
pub fn parse_node_tier(s: &str) -> Tier {
    Tier::parse_lenient(s)
}

/// `/flux/networkhealth`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NetworkHealth {
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    #[serde(rename = "inSteadyState", deserialize_with = "lenient::opt_bool")]
    pub in_steady_state: Option<bool>,
}

/// `/flux/unstablenodes` row: a flapping peer as seen by this node.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UnstableNode {
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub port: Option<u32>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub disconnects: u32,
    #[serde(rename = "firstDisconnect", deserialize_with = "lenient::opt_u64")]
    pub first_disconnect_ms: Option<u64>,
}

/// `/benchmark/getstoredbenchmark`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StoredBenchmark {
    pub benchmark: Bench,
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
}

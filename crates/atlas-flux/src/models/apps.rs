//! FluxOS `/apps/*` models: app specs of every version (1 to 8), locations, permanent and
//! temporary messages, installing locations and install errors, deployment information.

use atlas_core::app::{AppComponent, AppMessageRecord, AppSpec, GeoRule, PendingAppMessage};
use atlas_core::event::AppMessageKind;
use atlas_core::{Amount, Hash32, NodeEndpoint};
use serde::Deserialize;

use crate::lenient;
use crate::timefmt::parse_iso8601_ms;

/// One compose component (spec v4+).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawComponent {
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub description: String,
    #[serde(deserialize_with = "lenient::string")]
    pub repotag: String,
    #[serde(deserialize_with = "lenient::f64_vec")]
    pub ports: Vec<f64>,
    #[serde(rename = "containerPorts", deserialize_with = "lenient::f64_vec")]
    pub container_ports: Vec<f64>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub domains: Vec<String>,
    #[serde(
        rename = "environmentParameters",
        alias = "enviromentParameters",
        deserialize_with = "lenient::string_vec"
    )]
    pub environment_parameters: Vec<String>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub commands: Vec<String>,
    #[serde(rename = "containerData", deserialize_with = "lenient::string")]
    pub container_data: String,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub cpu: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub ram: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub hdd: f64,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub tiered: bool,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub repoauth: Option<String>,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub secrets: Option<String>,
}

/// An app spec as sent by any FluxOS version (union of all spec versions' fields).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawAppSpec {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub description: String,
    #[serde(deserialize_with = "lenient::string")]
    pub owner: String,
    // v1 to v3 single-container fields
    #[serde(deserialize_with = "lenient::string")]
    pub repotag: String,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub port: Option<f64>,
    #[serde(rename = "containerPort", deserialize_with = "lenient::opt_f64")]
    pub container_port: Option<f64>,
    #[serde(deserialize_with = "lenient::f64_vec")]
    pub ports: Vec<f64>,
    #[serde(rename = "containerPorts", deserialize_with = "lenient::f64_vec")]
    pub container_ports: Vec<f64>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub domains: Vec<String>,
    #[serde(
        rename = "enviromentParameters",
        alias = "environmentParameters",
        deserialize_with = "lenient::string_vec"
    )]
    pub environment_parameters: Vec<String>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub commands: Vec<String>,
    #[serde(rename = "containerData", deserialize_with = "lenient::string")]
    pub container_data: String,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub cpu: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub ram: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub hdd: f64,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub tiered: bool,
    // v3+
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub instances: Option<u32>,
    // v4+
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub compose: Vec<RawComponent>,
    // v5+
    #[serde(deserialize_with = "lenient::string_vec")]
    pub contacts: Vec<String>,
    #[serde(deserialize_with = "lenient::string_vec")]
    pub geolocation: Vec<String>,
    // v6+
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub expire: Option<u32>,
    // v7+
    #[serde(deserialize_with = "lenient::string_vec")]
    pub nodes: Vec<String>,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub staticip: bool,
    // v8: base64 ciphertext for enterprise apps, "" otherwise (a bool in some messages).
    #[serde(deserialize_with = "lenient::opt_string")]
    pub enterprise: Option<String>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub datacenter: Option<bool>,
    // Present on global specs: latest message hash and height.
    #[serde(deserialize_with = "lenient::opt_string")]
    pub hash: Option<String>,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub height: Option<u32>,
}

fn ports(v: &[f64]) -> Vec<u16> {
    v.iter()
        .filter(|p| p.is_finite() && **p >= 0.0 && **p <= 65_535.0)
        .map(|p| *p as u16)
        .collect()
}

fn mb(v: f64) -> u32 {
    if v.is_finite() && v > 0.0 {
        v.round().min(f64::from(u32::MAX)) as u32
    } else {
        0
    }
}

impl RawComponent {
    fn normalize(&self) -> AppComponent {
        AppComponent {
            name: self.name.clone(),
            description: self.description.clone(),
            repotag: self.repotag.clone(),
            ports: ports(&self.ports),
            container_ports: ports(&self.container_ports),
            domains: self.domains.clone(),
            environment: self.environment_parameters.clone(),
            commands: self.commands.clone(),
            container_data: self.container_data.clone(),
            cpu: self.cpu as f32,
            ram_mb: mb(self.ram),
            hdd_gb: mb(self.hdd),
            tiered: self.tiered,
            has_repoauth: self.repoauth.is_some(),
            has_secrets: self.secrets.is_some(),
        }
    }
}

impl RawAppSpec {
    /// Normalizes any spec version into [`AppSpec`]. Specs v1 to v3 become one component named
    /// after the app; v1's singular `port`/`containerPort` become one-element lists.
    pub fn normalize(&self) -> AppSpec {
        let components = if self.version >= 4 || !self.compose.is_empty() {
            self.compose.iter().map(RawComponent::normalize).collect()
        } else {
            let mut p = ports(&self.ports);
            if p.is_empty() {
                p = self.port.map(|v| ports(&[v])).unwrap_or_default();
            }
            let mut cp = ports(&self.container_ports);
            if cp.is_empty() {
                cp = self.container_port.map(|v| ports(&[v])).unwrap_or_default();
            }
            vec![AppComponent {
                name: self.name.clone(),
                description: self.description.clone(),
                repotag: self.repotag.clone(),
                ports: p,
                container_ports: cp,
                domains: self.domains.clone(),
                environment: self.environment_parameters.clone(),
                commands: self.commands.clone(),
                container_data: self.container_data.clone(),
                cpu: self.cpu as f32,
                ram_mb: mb(self.ram),
                hdd_gb: mb(self.hdd),
                tiered: self.tiered,
                has_repoauth: false,
                has_secrets: false,
            }]
        };
        let enterprise = self
            .enterprise
            .as_deref()
            .is_some_and(|e| !e.is_empty() && e != "false");
        AppSpec {
            spec_version: u8::try_from(self.version).unwrap_or(u8::MAX),
            name: self.name.clone(),
            description: self.description.clone(),
            owner: self.owner.clone(),
            instances: self.instances.unwrap_or(atlas_core::app::DEFAULT_INSTANCES),
            contacts: self.contacts.clone(),
            geolocation: self
                .geolocation
                .iter()
                .filter_map(|g| GeoRule::parse(g))
                .collect(),
            expire_blocks: self.expire,
            nodes: self.nodes.clone(),
            static_ip: self.staticip,
            enterprise,
            datacenter: self.datacenter,
            components,
        }
    }

    /// Latest message hash (global specs only).
    pub fn spec_hash(&self) -> Option<Hash32> {
        self.hash.as_deref().and_then(|h| Hash32::from_hex(h).ok())
    }
}

/// One row of `/apps/locations` or `/apps/location/<name>`: a running instance.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppLocation {
    /// Always `host:port` here.
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub hash: Option<String>,
    #[serde(rename = "broadcastedAt", deserialize_with = "lenient::opt_string")]
    pub broadcasted_at: Option<String>,
    #[serde(rename = "expireAt", deserialize_with = "lenient::opt_string")]
    pub expire_at: Option<String>,
    #[serde(rename = "osUptime", deserialize_with = "lenient::opt_f64")]
    pub os_uptime: Option<f64>,
    #[serde(rename = "staticIp", deserialize_with = "lenient::opt_bool")]
    pub static_ip: Option<bool>,
    #[serde(rename = "runningSince", deserialize_with = "lenient::opt_string")]
    pub running_since: Option<String>,
}

impl AppLocation {
    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        NodeEndpoint::parse_opt(&self.ip).ok().flatten()
    }

    pub fn spec_hash(&self) -> Option<Hash32> {
        self.hash.as_deref().and_then(|h| Hash32::from_hex(h).ok())
    }

    pub fn broadcast_ms(&self) -> Option<u64> {
        self.broadcasted_at.as_deref().and_then(parse_iso8601_ms)
    }

    pub fn expire_ms(&self) -> Option<u64> {
        self.expire_at.as_deref().and_then(parse_iso8601_ms)
    }

    pub fn running_since_ms(&self) -> Option<u64> {
        self.running_since.as_deref().and_then(parse_iso8601_ms)
    }

    /// Converts into the domain instance (node id resolved later by the engine).
    pub fn to_instance(&self) -> Option<atlas_core::app::AppInstance> {
        Some(atlas_core::app::AppInstance {
            node: None,
            endpoint: self.endpoint()?,
            spec_hash: self.spec_hash(),
            broadcast_ms: self.broadcast_ms().unwrap_or(0),
            expire_ms: self.expire_ms().unwrap_or(0),
            running_since_ms: self.running_since_ms(),
            os_uptime_s: self.os_uptime.map_or(0, |v| v.max(0.0) as u64),
            static_ip: self.static_ip.unwrap_or(false),
        })
    }
}

/// A permanent (mined) app message.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PermanentMessage {
    /// `fluxappregister`, `fluxappupdate`, legacy `zelappregister`, `zelappupdate`.
    #[serde(rename = "type", deserialize_with = "lenient::string")]
    pub kind: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(rename = "appSpecifications")]
    pub app_specifications: RawAppSpec,
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    /// Owner-signed unix ms.
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub timestamp: u64,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub txid: Option<String>,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(rename = "valueSat", deserialize_with = "lenient::i64_or_zero")]
    pub value_sat: i64,
}

impl PermanentMessage {
    /// Domain record; `None` when the hash or type is unusable.
    pub fn to_record(&self) -> Option<AppMessageRecord> {
        Some(AppMessageRecord {
            hash: Hash32::from_hex(&self.hash).ok()?,
            txid: self.txid.as_deref().and_then(|t| Hash32::from_hex(t).ok()),
            height: self.height,
            timestamp_ms: self.timestamp,
            kind: AppMessageKind::parse_lenient(&self.kind)?,
            paid: Amount::from_sat(self.value_sat),
            spec: self.app_specifications.normalize(),
        })
    }
}

/// A temporary (broadcast, not yet mined) app message.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TemporaryMessage {
    #[serde(rename = "appSpecifications")]
    pub app_specifications: RawAppSpec,
    #[serde(rename = "type", deserialize_with = "lenient::string")]
    pub kind: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::u64_or_zero")]
    pub timestamp: u64,
    #[serde(rename = "receivedAt", deserialize_with = "lenient::opt_string")]
    pub received_at: Option<String>,
    #[serde(rename = "expireAt", deserialize_with = "lenient::opt_string")]
    pub expire_at: Option<String>,
    #[serde(rename = "arcaneSender", deserialize_with = "lenient::opt_bool")]
    pub arcane_sender: Option<bool>,
}

impl TemporaryMessage {
    pub fn to_pending(&self) -> Option<PendingAppMessage> {
        let received_ms = self
            .received_at
            .as_deref()
            .and_then(parse_iso8601_ms)
            .unwrap_or(self.timestamp);
        Some(PendingAppMessage {
            hash: Hash32::from_hex(&self.hash).ok()?,
            kind: AppMessageKind::parse_lenient(&self.kind)?,
            timestamp_ms: self.timestamp,
            received_ms,
            expires_ms: self
                .expire_at
                .as_deref()
                .and_then(parse_iso8601_ms)
                .unwrap_or(received_ms + 3_600_000),
            arcane_sender: self.arcane_sender,
            spec: self.app_specifications.normalize(),
        })
    }
}

/// `/apps/installinglocations` row (install in progress, TTL 900 s).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InstallingLocation {
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::opt_string")]
    pub hash: Option<String>,
    #[serde(rename = "broadcastedAt", deserialize_with = "lenient::opt_string")]
    pub broadcasted_at: Option<String>,
    #[serde(rename = "expireAt", deserialize_with = "lenient::opt_string")]
    pub expire_at: Option<String>,
}

impl InstallingLocation {
    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        NodeEndpoint::parse_opt(&self.ip).ok().flatten()
    }
}

/// `/apps/installingerrorslocations` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct InstallingError {
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(rename = "broadcastedAt", deserialize_with = "lenient::opt_string")]
    pub broadcasted_at: Option<String>,
    /// A JSON-encoded FluxOS error envelope (string).
    #[serde(deserialize_with = "lenient::string")]
    pub error: String,
}

impl InstallingError {
    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        NodeEndpoint::parse_opt(&self.ip).ok().flatten()
    }

    /// The error message extracted from the embedded envelope, or the raw text.
    pub fn message(&self) -> String {
        #[derive(Deserialize)]
        struct Inner {
            #[serde(default)]
            data: Option<InnerData>,
        }
        #[derive(Deserialize)]
        struct InnerData {
            #[serde(default)]
            message: Option<String>,
        }
        serde_json::from_str::<Inner>(&self.error)
            .ok()
            .and_then(|i| i.data)
            .and_then(|d| d.message)
            .unwrap_or_else(|| self.error.clone())
    }
}

/// `/apps/deploymentinformation` (subset).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DeploymentInformation {
    /// App payment address (register/update payments go here with an OP_RETURN).
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(rename = "minimumInstances", deserialize_with = "lenient::opt_u32")]
    pub minimum_instances: Option<u32>,
    #[serde(rename = "maximumInstances", deserialize_with = "lenient::opt_u32")]
    pub maximum_instances: Option<u32>,
    #[serde(rename = "blocksLasting", deserialize_with = "lenient::opt_u32")]
    pub blocks_lasting: Option<u32>,
}

/// `/apps/hashes` row.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppHashEntry {
    #[serde(deserialize_with = "lenient::string")]
    pub txid: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::string")]
    pub hash: String,
    #[serde(deserialize_with = "lenient::i64_or_zero")]
    pub value: i64,
    #[serde(deserialize_with = "lenient::bool_or_false")]
    pub message: bool,
    #[serde(
        rename = "messageNotFound",
        deserialize_with = "lenient::bool_or_false"
    )]
    pub message_not_found: bool,
}

/// Current app payment address (from `/apps/deploymentinformation`, verified 2026-09-30).
pub const APP_PAYMENT_ADDRESS: &str = "t3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX";

/// Tier counts keyed `CUMULUS` / `NIMBUS` / `STRATUS`.
pub type TierCountMap = std::collections::BTreeMap<String, u32>;

/// Nodes and fault domains in one region of `/apps/placementlocations`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlacementBucket {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub nodes: u32,
    /// Distinct organisations (fault domains).
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub domains: u32,
    pub tiers: TierCountMap,
}

/// A continent in `/apps/placementlocations`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlacementContinent {
    #[serde(flatten)]
    pub bucket: PlacementBucket,
    pub countries: std::collections::BTreeMap<String, PlacementBucket>,
}

/// `/apps/placementlocations`: nodes, fault domains and tier counts per continent/country.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlacementLocations {
    #[serde(rename = "tableAvailable", deserialize_with = "lenient::bool_or_false")]
    pub table_available: bool,
    #[serde(rename = "tableGenerated", deserialize_with = "lenient::opt_string")]
    pub table_generated: Option<String>,
    pub total: PlacementBucket,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub unresolved: u32,
    pub continents: std::collections::BTreeMap<String, PlacementContinent>,
}

/// `/apps/enterprisenodes` row (default-port nodes only).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct EnterpriseNode {
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
    #[serde(deserialize_with = "lenient::string")]
    pub payment_address: String,
    #[serde(deserialize_with = "lenient::string")]
    pub txhash: String,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub outidx: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(rename = "enterpriseApps", deserialize_with = "lenient::u32_or_zero")]
    pub enterprise_apps: u32,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub score: f64,
}

/// `/apps/getappspecsusdprice` (also on stats).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppSpecsUsdPrice {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub height: u32,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub cpu: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub ram: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub hdd: f64,
    #[serde(rename = "minPrice", deserialize_with = "lenient::f64_or_zero")]
    pub min_price: f64,
    #[serde(rename = "minUSDPrice", deserialize_with = "lenient::f64_or_zero")]
    pub min_usd_price: f64,
    #[serde(deserialize_with = "lenient::f64_or_zero")]
    pub fluxmultiplier: f64,
}

/// `/apps/registrationinformation` (subset: addresses, enforcement heights, port rules).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RegistrationInformation {
    #[serde(
        rename = "latestSupportedSpecVersion",
        deserialize_with = "lenient::opt_u32"
    )]
    pub latest_supported_spec_version: Option<u32>,
    #[serde(deserialize_with = "lenient::string")]
    pub address: String,
    #[serde(rename = "appSpecsEnforcementHeights")]
    pub app_specs_enforcement_heights: std::collections::BTreeMap<String, u32>,
    #[serde(rename = "fluxUSDRate", deserialize_with = "lenient::opt_f64")]
    pub flux_usd_rate: Option<f64>,
    #[serde(rename = "portMin", deserialize_with = "lenient::opt_u32")]
    pub port_min: Option<u32>,
    #[serde(rename = "portMax", deserialize_with = "lenient::opt_u32")]
    pub port_max: Option<u32>,
    #[serde(rename = "bannedPorts", deserialize_with = "lenient::string_vec")]
    pub banned_ports: Vec<String>,
}

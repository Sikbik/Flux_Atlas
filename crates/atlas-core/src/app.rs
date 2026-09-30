//! Flux app domain model: a normalized multi-version app spec plus runtime placement.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::emission::PON_ACTIVATION_HEIGHT;
use crate::event::AppMessageKind;
use crate::ids::{Hash32, NodeId};
use crate::net::NodeEndpoint;

/// Default app lifetime in pre-PoN (2-minute) blocks, `blocksLasting`.
pub const DEFAULT_EXPIRE_BLOCKS_PRE_PON: u32 = 22_000;
/// Block-based allowances are multiplied by this factor after the PoN fork (30 s blocks).
pub const PON_BLOCK_FACTOR: u32 = 4;
/// Default instance count for specs that predate the `instances` field (v1, v2).
pub const DEFAULT_INSTANCES: u32 = 3;

/// A geolocation placement rule from `geolocation[]`: `acEU`, `acEU_DE`,
/// `acNA_US_North Carolina` (allow) or `a!cEU...` (forbid).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct GeoRule {
    pub allow: bool,
    pub continent: String,
    pub country: Option<String>,
    pub region: Option<String>,
}

impl GeoRule {
    /// Parses a raw rule. Returns `None` for strings that do not follow the `ac`/`a!c` syntax.
    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim();
        let (allow, rest) = match raw.strip_prefix("a!c") {
            Some(r) => (false, r),
            None => (true, raw.strip_prefix("ac")?),
        };
        let mut parts = rest.splitn(3, '_');
        let continent = parts.next().filter(|s| !s.is_empty())?.to_owned();
        let country = parts.next().filter(|s| !s.is_empty()).map(str::to_owned);
        let region = parts.next().filter(|s| !s.is_empty()).map(str::to_owned);
        Some(Self {
            allow,
            continent,
            country,
            region,
        })
    }

    /// Canonical text form (inverse of [`GeoRule::parse`]).
    pub fn to_raw(&self) -> String {
        let mut s = String::from(if self.allow { "ac" } else { "a!c" });
        s.push_str(&self.continent);
        if let Some(c) = &self.country {
            s.push('_');
            s.push_str(c);
            if let Some(r) = &self.region {
                s.push('_');
                s.push_str(r);
            }
        }
        s
    }
}

/// Resources requested by one instance (sum over components), or totals across instances.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct Resources {
    pub cpu: f32,
    pub ram_mb: u64,
    pub hdd_gb: u64,
}

impl Resources {
    pub fn scaled(self, instances: u32) -> Self {
        Self {
            cpu: self.cpu * instances as f32,
            ram_mb: self.ram_mb * u64::from(instances),
            hdd_gb: self.hdd_gb * u64::from(instances),
        }
    }
}

/// One container of an app. Specs v1 to v3 have a single implicit component.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct AppComponent {
    pub name: String,
    pub description: String,
    pub repotag: String,
    pub ports: Vec<u16>,
    pub container_ports: Vec<u16>,
    pub domains: Vec<String>,
    pub environment: Vec<String>,
    pub commands: Vec<String>,
    /// Raw `containerData`, including `g:`/`r:` sync prefixes and `|m:` extra mounts.
    pub container_data: String,
    pub cpu: f32,
    pub ram_mb: u32,
    pub hdd_gb: u32,
    pub tiered: bool,
    pub has_repoauth: bool,
    pub has_secrets: bool,
}

/// An app specification normalized across spec versions 1 to 8.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct AppSpec {
    /// Upstream spec version (1..=8 today).
    pub spec_version: u8,
    /// Display name as registered (case preserved).
    pub name: String,
    pub description: String,
    /// Owner ZelID.
    pub owner: String,
    pub instances: u32,
    pub contacts: Vec<String>,
    pub geolocation: Vec<GeoRule>,
    /// `expire` in blocks as given in the spec (v6+); `None` means the default.
    pub expire_blocks: Option<u32>,
    /// Pinned node IPs (v7+).
    pub nodes: Vec<String>,
    pub static_ip: bool,
    /// v8 enterprise (encrypted) app. Components are not public in that case.
    pub enterprise: bool,
    /// v8 `datacenter` flag, when present.
    pub datacenter: Option<bool>,
    pub components: Vec<AppComponent>,
}

impl AppSpec {
    /// Lowercase key used for storage and lookups.
    pub fn key(&self) -> String {
        self.name.to_ascii_lowercase()
    }

    /// Resources of one instance (sum over public components).
    pub fn per_instance(&self) -> Resources {
        let mut r = Resources::default();
        for c in &self.components {
            r.cpu += c.cpu;
            r.ram_mb += u64::from(c.ram_mb);
            r.hdd_gb += u64::from(c.hdd_gb);
        }
        r
    }

    pub fn totals(&self) -> Resources {
        self.per_instance().scaled(self.instances)
    }

    /// Field paths that differ between two versions of a spec, for `AppUpdated` diffs.
    /// Floats are compared exactly on purpose: any change to the spec is a change.
    #[allow(clippy::float_cmp)]
    pub fn diff(&self, newer: &AppSpec) -> Vec<String> {
        let mut out = Vec::new();
        macro_rules! cmp {
            ($field:ident) => {
                if self.$field != newer.$field {
                    out.push(stringify!($field).to_owned());
                }
            };
        }
        cmp!(spec_version);
        cmp!(description);
        cmp!(owner);
        cmp!(instances);
        cmp!(contacts);
        cmp!(geolocation);
        cmp!(expire_blocks);
        cmp!(nodes);
        cmp!(static_ip);
        cmp!(enterprise);
        cmp!(datacenter);
        let n = self.components.len().max(newer.components.len());
        for i in 0..n {
            match (self.components.get(i), newer.components.get(i)) {
                (Some(a), Some(b)) => {
                    let name = &b.name;
                    macro_rules! ccmp {
                        ($field:ident) => {
                            if a.$field != b.$field {
                                out.push(format!("components.{name}.{}", stringify!($field)));
                            }
                        };
                    }
                    ccmp!(name);
                    ccmp!(repotag);
                    ccmp!(ports);
                    ccmp!(container_ports);
                    ccmp!(domains);
                    ccmp!(environment);
                    ccmp!(commands);
                    ccmp!(container_data);
                    ccmp!(cpu);
                    ccmp!(ram_mb);
                    ccmp!(hdd_gb);
                    ccmp!(description);
                    ccmp!(tiered);
                    ccmp!(has_repoauth);
                    ccmp!(has_secrets);
                }
                (None, Some(b)) => out.push(format!("components.{}+", b.name)),
                (Some(a), None) => out.push(format!("components.{}-", a.name)),
                (None, None) => {}
            }
        }
        out
    }
}

/// Expiry height of an app registered or updated at `height` with spec `expire` blocks.
///
/// Post-PoN specs count 30 s blocks and default to 22,000 x 4. Specs from before the fork
/// counted 2-minute blocks; the part of their lifetime that extends past the fork is
/// multiplied by 4, as FluxOS does.
pub fn app_expire_height(height: u32, expire_blocks: Option<u32>) -> u32 {
    if height >= PON_ACTIVATION_HEIGHT {
        let expire = expire_blocks.unwrap_or(DEFAULT_EXPIRE_BLOCKS_PRE_PON * PON_BLOCK_FACTOR);
        return height.saturating_add(expire);
    }
    let old_end = height.saturating_add(expire_blocks.unwrap_or(DEFAULT_EXPIRE_BLOCKS_PRE_PON));
    if old_end <= PON_ACTIVATION_HEIGHT {
        old_end
    } else {
        PON_ACTIVATION_HEIGHT
            .saturating_add((old_end - PON_ACTIVATION_HEIGHT).saturating_mul(PON_BLOCK_FACTOR))
    }
}

/// One running instance of an app, from `/apps/locations`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppInstance {
    /// Resolved node, when the endpoint maps to a known node.
    pub node: Option<NodeId>,
    pub endpoint: NodeEndpoint,
    /// Hash of the spec version this instance runs.
    pub spec_hash: Option<Hash32>,
    pub broadcast_ms: u64,
    pub expire_ms: u64,
    pub running_since_ms: Option<u64>,
    pub os_uptime_s: u64,
    pub static_ip: bool,
}

/// Latest known state of one app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppRecord {
    /// Lowercase key.
    pub name: String,
    /// Name as registered.
    pub display_name: String,
    pub spec: AppSpec,
    /// Hash of the latest register/update message.
    pub spec_hash: Option<Hash32>,
    /// Height of the latest register/update.
    pub height: u32,
    /// Height of the first registration, when known from history.
    pub registered_height: Option<u32>,
    pub expire_height: u32,
    pub totals: Resources,
    pub locations: Vec<AppInstance>,
    pub first_seen_ms: u64,
    pub updated_ms: u64,
}

impl AppRecord {
    pub fn from_spec(spec: AppSpec, spec_hash: Option<Hash32>, height: u32, now_ms: u64) -> Self {
        let expire_height = app_expire_height(height, spec.expire_blocks);
        let totals = spec.totals();
        Self {
            name: spec.key(),
            display_name: spec.name.clone(),
            spec,
            spec_hash,
            height,
            registered_height: None,
            expire_height,
            totals,
            locations: Vec::new(),
            first_seen_ms: now_ms,
            updated_ms: now_ms,
        }
    }
}

/// A confirmed app register/update message (`/apps/permanentmessages`), the unit of app
/// spec history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppMessageRecord {
    /// Message hash (also carried in the payment's OP_RETURN).
    pub hash: Hash32,
    /// Payment transaction.
    pub txid: Option<Hash32>,
    pub height: u32,
    /// Owner-signed timestamp, unix ms.
    pub timestamp_ms: u64,
    pub kind: AppMessageKind,
    /// FLUX paid for the message.
    pub paid: Amount,
    pub spec: AppSpec,
}

/// A signed app message broadcast but not yet mined (`/apps/temporarymessages`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PendingAppMessage {
    pub hash: Hash32,
    pub kind: AppMessageKind,
    pub timestamp_ms: u64,
    pub received_ms: u64,
    pub expires_ms: u64,
    pub arcane_sender: Option<bool>,
    pub spec: AppSpec,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geo_rules() {
        let r = GeoRule::parse("acNA_US_North Carolina").unwrap();
        assert!(r.allow);
        assert_eq!(r.continent, "NA");
        assert_eq!(r.country.as_deref(), Some("US"));
        assert_eq!(r.region.as_deref(), Some("North Carolina"));
        assert_eq!(r.to_raw(), "acNA_US_North Carolina");
        let f = GeoRule::parse("a!cEU_DE").unwrap();
        assert!(!f.allow);
        assert_eq!(f.to_raw(), "a!cEU_DE");
        assert_eq!(GeoRule::parse("acEU").unwrap().country, None);
        assert!(GeoRule::parse("EU").is_none());
        assert!(GeoRule::parse("ac").is_none());
    }

    #[test]
    fn expiry() {
        assert_eq!(app_expire_height(2_996_000, Some(88_000)), 3_084_000);
        assert_eq!(app_expire_height(2_996_000, None), 2_996_000 + 88_000);
        // Registered well before the fork and expired before it.
        assert_eq!(app_expire_height(1_000_000, None), 1_022_000);
        // Straddles the fork: 10,000 old blocks left at the fork become 40,000.
        assert_eq!(
            app_expire_height(2_010_000, Some(20_000)),
            2_020_000 + 40_000
        );
    }

    #[test]
    fn diff_and_totals() {
        let comp = AppComponent {
            name: "web".into(),
            cpu: 0.5,
            ram_mb: 500,
            hdd_gb: 5,
            ..AppComponent::default()
        };
        let a = AppSpec {
            name: "Demo".into(),
            instances: 3,
            components: vec![comp.clone()],
            ..AppSpec::default()
        };
        let mut b = a.clone();
        b.instances = 5;
        b.components[0].repotag = "x/y:2".into();
        assert_eq!(
            a.diff(&b),
            vec!["instances".to_owned(), "components.web.repotag".to_owned()]
        );
        assert_eq!(a.totals().ram_mb, 1500);
        assert_eq!(a.key(), "demo");
        let rec = AppRecord::from_spec(a, None, 2_996_000, 5);
        assert_eq!(rec.name, "demo");
        assert_eq!(rec.expire_height, 3_084_000);
    }
}

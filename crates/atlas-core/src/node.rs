//! FluxNode domain model: tiers, statuses, geo, hardware, versions and the node record.

use std::fmt;
use std::str::FromStr;

use compact_str::CompactString;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::Amount;
use crate::ids::{NodeId, Outpoint};
use crate::net::NodeEndpoint;

/// Node tier. The discriminants are the wire values used in `nodes.bin`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Tier {
    #[default]
    Unknown = 0,
    Cumulus = 1,
    Nimbus = 2,
    Stratus = 3,
}

impl Tier {
    /// The three real tiers, in ascending size.
    pub const ALL: [Tier; 3] = [Tier::Cumulus, Tier::Nimbus, Tier::Stratus];

    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    pub const fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Cumulus,
            2 => Self::Nimbus,
            3 => Self::Stratus,
            _ => Self::Unknown,
        }
    }

    /// Lenient parse of every spelling seen upstream: `CUMULUS`, `cumulus`, `stratus_new`,
    /// legacy `BASIC`/`SUPER`/`BAMF`, and numeric `1`/`2`/`3`. Unknown input gives `Unknown`.
    pub fn parse_lenient(s: &str) -> Self {
        let t = s.trim();
        let head = t.split(['_', ' ', '-']).next().unwrap_or(t);
        match head.to_ascii_lowercase().as_str() {
            "cumulus" | "basic" | "1" => Self::Cumulus,
            "nimbus" | "super" | "2" => Self::Nimbus,
            "stratus" | "bamf" | "3" => Self::Stratus,
            _ => Self::Unknown,
        }
    }

    /// Tier from a collateral amount (current V2 amounts and the legacy V1 amounts).
    pub fn from_collateral(amount: Amount) -> Self {
        match amount.sat() / crate::amount::COIN {
            1_000 | 10_000 => Self::Cumulus,
            12_500 | 25_000 => Self::Nimbus,
            40_000 | 100_000 => Self::Stratus,
            _ => Self::Unknown,
        }
    }

    /// Current (V2) collateral requirement.
    pub const fn collateral(self) -> Option<Amount> {
        match self {
            Self::Cumulus => Some(Amount::from_flux(1_000)),
            Self::Nimbus => Some(Amount::from_flux(12_500)),
            Self::Stratus => Some(Amount::from_flux(40_000)),
            Self::Unknown => None,
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Cumulus => "cumulus",
            Self::Nimbus => "nimbus",
            Self::Stratus => "stratus",
        }
    }

    /// Minimum benchmark a node needs to run as this tier; `None` for `Unknown`.
    pub const fn minimums(self) -> Option<TierMinimums> {
        match self {
            Self::Cumulus => Some(TierMinimums {
                cores: 4.0,
                ram_gb: 7.0,
                ssd_gb: 220.0,
                eps: 240.0,
                disk_write_mbs: 180.0,
                down_mbps: 25.0,
                up_mbps: 25.0,
            }),
            Self::Nimbus => Some(TierMinimums {
                cores: 8.0,
                ram_gb: 30.0,
                ssd_gb: 440.0,
                eps: 640.0,
                disk_write_mbs: 180.0,
                down_mbps: 50.0,
                up_mbps: 50.0,
            }),
            Self::Stratus => Some(TierMinimums {
                cores: 16.0,
                ram_gb: 61.0,
                ssd_gb: 880.0,
                eps: 1520.0,
                disk_write_mbs: 400.0,
                down_mbps: 100.0,
                up_mbps: 100.0,
            }),
            Self::Unknown => None,
        }
    }

    /// Index 0..3 for per-tier arrays; `None` for `Unknown`.
    pub const fn index(self) -> Option<usize> {
        match self {
            Self::Cumulus => Some(0),
            Self::Nimbus => Some(1),
            Self::Stratus => Some(2),
            Self::Unknown => None,
        }
    }
}

impl fmt::Display for Tier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Tier {
    type Err = std::convert::Infallible;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self::parse_lenient(s))
    }
}

/// The minimum benchmark of a tier ([`Tier::minimums`]).
///
/// Sources: cores, RAM and SSD are FluxOS's `fluxSpecifics` (`ZelBack/config/default.js`:
/// `cpu` 40 / 80 / 160 in tenths of a core, `ram` 7000 / 30000 / 61000 MB, `hdd` 220 / 440 /
/// 880 GB), the resources FluxOS accounts a node of each tier with. EPS, disk write speed and
/// bandwidth are not in the FluxOS source: fluxbench checks them, against the published Flux
/// node requirements (Cumulus 240 EPS, 180 MB/s, 25 Mb/s; Nimbus 640 EPS, 180 MB/s, 50 Mb/s;
/// Stratus 1520 EPS, 400 MB/s, 100 Mb/s; bandwidth both ways).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TierMinimums {
    /// Logical cores.
    pub cores: f64,
    pub ram_gb: f64,
    pub ssd_gb: f64,
    /// CPU events per second.
    pub eps: f64,
    pub disk_write_mbs: f64,
    pub down_mbps: f64,
    pub up_mbps: f64,
}

/// Node lifecycle status. Every entry of the deterministic node list is `Confirmed`; the other
/// values come from the start list, the DOS list, `getfluxnodestatus`, and our own derivations.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum NodeStatus {
    #[default]
    Unknown = 0,
    Confirmed = 1,
    /// Start tx mined, awaiting initial confirm (start list).
    Started = 2,
    /// Failed to confirm; banned for a while (DOS list).
    Dos = 3,
    Offline = 4,
    /// Missed the confirmation window (640 blocks).
    Expired = 5,
    /// No longer in the node list (collateral spent or node gone). Kept for history.
    Departed = 6,
}

impl NodeStatus {
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    pub const fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Confirmed,
            2 => Self::Started,
            3 => Self::Dos,
            4 => Self::Offline,
            5 => Self::Expired,
            6 => Self::Departed,
            _ => Self::Unknown,
        }
    }

    /// Parses daemon status strings (`CONFIRMED`, `STARTED`, `DOS`, `OFFLINE`, `expired`).
    pub fn parse_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "confirmed" => Self::Confirmed,
            "started" => Self::Started,
            "dos" => Self::Dos,
            "offline" => Self::Offline,
            "expired" => Self::Expired,
            "departed" => Self::Departed,
            _ => Self::Unknown,
        }
    }

    /// True for statuses that count as a live network member.
    pub const fn is_active(self) -> bool {
        matches!(self, Self::Confirmed)
    }
}

/// CPU architecture reported by the benchmark.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Arch {
    #[default]
    Unknown = 0,
    Amd64 = 1,
    Arm64 = 2,
}

impl Arch {
    pub fn parse_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "amd64" | "x86_64" | "x64" => Self::Amd64,
            "arm64" | "aarch64" => Self::Arm64,
            _ => Self::Unknown,
        }
    }
}

/// Outcome of the node's last benchmark run.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum BenchStatus {
    #[default]
    Unknown = 0,
    /// Passed; the tier it qualified for is in `Hardware::bench_tier`.
    Passed = 1,
    Running = 2,
    Failed = 3,
}

impl BenchStatus {
    /// Parses `benchmark.bench.status`: a tier name when passing, `running`, `failed`,
    /// or the `"0"` placeholder for unreachable nodes. Returns the status and passing tier.
    pub fn parse_lenient(s: &str) -> (Self, Tier) {
        let tier = Tier::parse_lenient(s);
        if tier != Tier::Unknown && !s.trim().chars().all(|c| c.is_ascii_digit()) {
            return (Self::Passed, tier);
        }
        match s.trim().to_ascii_lowercase().as_str() {
            "running" | "benchmarking" => (Self::Running, Tier::Unknown),
            "failed" | "error" => (Self::Failed, Tier::Unknown),
            _ => (Self::Unknown, Tier::Unknown),
        }
    }
}

/// Where a geolocation came from.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum GeoSource {
    #[default]
    Unknown = 0,
    /// The node's own ip-api lookup (`/flux/geolocation`, stats `fluxinfo`).
    NodeReported = 1,
    /// stats.runonflux.io `/fluxlocation/<ip>`.
    StatsLookup = 2,
    /// Local GeoIP database (approximate).
    LocalDb = 3,
}

/// Geolocation of a node host.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct Geo {
    pub lat: f32,
    pub lon: f32,
    /// Two-letter continent code (`EU`, `NA`, ...).
    #[ts(as = "String")]
    pub continent_code: CompactString,
    /// ISO-3166 alpha-2 country code.
    #[ts(as = "String")]
    pub country_code: CompactString,
    #[ts(as = "String")]
    pub country: CompactString,
    /// Region name (for example `Saxony`).
    #[ts(as = "String")]
    pub region: CompactString,
    /// City, when the source provides one (ip-api via FluxOS does not).
    #[ts(as = "String")]
    pub city: CompactString,
    /// Organisation (provider) as reported; spellings vary, group by `asn` instead.
    #[ts(as = "String")]
    pub org: CompactString,
    /// Autonomous system number, parsed from `AS24940 Hetzner Online GmbH`.
    pub asn: Option<u32>,
    /// ip-api `hosting` / `dataCenter` flag when known.
    pub hosting: Option<bool>,
    pub source: GeoSource,
}

impl Geo {
    /// True when the coordinates are usable (upstream sends `0,0` placeholders for unknown).
    pub fn has_coords(&self) -> bool {
        self.lat.is_finite()
            && self.lon.is_finite()
            && !(self.lat == 0.0 && self.lon == 0.0)
            && (-90.0..=90.0).contains(&self.lat)
            && (-180.0..=180.0).contains(&self.lon)
    }

    /// True when the coordinates are usable and come from a source that locates this host,
    /// not the approximate local GeoIP fallback (`GeoSource::LocalDb`, city-level).
    pub fn is_precise(&self) -> bool {
        self.has_coords() && self.source != GeoSource::LocalDb
    }
}

/// Benchmarked hardware of a node.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct Hardware {
    /// Logical cores.
    pub cores: u16,
    pub ram_gb: f32,
    pub ssd_gb: f32,
    pub hdd_gb: f32,
    pub total_storage_gb: f32,
    /// CPU events per second (the tier requirement metric).
    pub eps: f32,
    pub disk_write_mbs: f32,
    pub down_mbps: f32,
    pub up_mbps: f32,
    pub ping_ms: f32,
    pub arch: Arch,
    #[ts(as = "String")]
    pub arm_board: CompactString,
    pub bench_status: BenchStatus,
    /// Tier the benchmark qualified for (when `bench_status` is `Passed`).
    pub bench_tier: Tier,
    /// Unix ms of the benchmark run, 0 if unknown.
    pub bench_time_ms: u64,
    #[ts(as = "Option<String>")]
    pub bench_error: Option<CompactString>,
    pub system_secure: Option<bool>,
}

/// Software versions running on a node.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct Versions {
    /// FluxOS version (`8.20.0`).
    #[ts(as = "Option<String>")]
    pub flux_os: Option<CompactString>,
    /// fluxd version formatted from the integer (`9010050` becomes `9.1.0`).
    #[ts(as = "Option<String>")]
    pub daemon: Option<CompactString>,
    /// fluxbench version.
    #[ts(as = "Option<String>")]
    pub bench: Option<CompactString>,
    /// ArcaneOS human version name (`jolly wombat`); `None` when not ArcaneOS or unknown.
    #[ts(as = "Option<String>")]
    pub arcane: Option<CompactString>,
    /// OS pretty name (`Ubuntu 24.04.4 LTS`).
    #[ts(as = "Option<String>")]
    pub os: Option<CompactString>,
}

/// Formats fluxd's integer version: `9010050` becomes `9.1.0` (the last two digits are the
/// build number and are dropped). Returns `None` for 0 or negative values.
pub fn format_daemon_version(v: i64) -> Option<String> {
    if v <= 0 {
        return None;
    }
    let major = v / 1_000_000;
    let minor = (v / 10_000) % 100;
    let patch = (v / 100) % 100;
    Some(format!("{major}.{minor}.{patch}"))
}

/// The latest known state of one FluxNode. Includes departed nodes (flagged via `status`).
///
/// Stored in redb with postcard, so this type must not use `skip_serializing_if` or other
/// self-describing-only serde features.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct NodeRecord {
    pub id: NodeId,
    pub outpoint: Outpoint,
    /// Advertised API endpoint; `None` for list entries with an empty IP.
    pub endpoint: Option<NodeEndpoint>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub payment_address: CompactString,
    /// Node operator pubkey (hex).
    pub pubkey: CompactString,
    /// Queue position within the tier (0 = paid next); `None` when not in the list.
    pub rank: Option<u32>,
    pub added_height: u32,
    pub confirmed_height: Option<u32>,
    pub last_confirmed_height: Option<u32>,
    pub last_paid_height: Option<u32>,
    /// Confirmation time (unix ms), from `activesince`.
    pub active_since_ms: Option<u64>,
    pub geo: Option<Geo>,
    pub hw: Option<Hardware>,
    pub versions: Versions,
    /// `Some(true)` when the host runs ArcaneOS.
    pub arcane: Option<bool>,
    /// Operator Flux ID (ZelID), from `/flux/info`.
    pub zelid: Option<CompactString>,
    pub upnp: Option<bool>,
    pub static_ip: Option<bool>,
    /// Result of the last crawl of the host API: `Some(false)` when unreachable.
    pub reachable: Option<bool>,
    pub app_count: u16,
    pub peers_out: u16,
    pub peers_in: u16,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    /// Unix ms of the last successful per-host crawl.
    pub last_swept_ms: Option<u64>,
    /// Unix ms when the node left the list.
    pub departed_ms: Option<u64>,
}

impl NodeRecord {
    /// A payment address starting with `t3` is P2SH (multisig or delegate setups).
    pub fn is_p2sh_payee(&self) -> bool {
        self.payment_address.starts_with("t3")
    }

    /// Blocks since the last confirmation at `tip`, if known.
    pub fn blocks_since_confirm(&self, tip: u32) -> Option<u32> {
        self.last_confirmed_height.map(|h| tip.saturating_sub(h))
    }
}

/// Fluxnode consensus windows (post-PoN, from fluxd `fluxnode.h`), and the exact heights at
/// which fluxd applies them (`fluxnode.cpp`, called from `ConnectBlock` in `main.cpp` with the
/// height of the block being connected).
pub mod windows {
    /// `FLUXNODE_CONFIRM_UPDATE_EXPIRATION_HEIGHT_V4`. A confirmed node is dropped by the first
    /// block `H` with `last_confirmed < H - 640` (`GetUndoDataForExpiredConfirmFluxnodes`), so it
    /// is still listed at `last_confirmed + 640` and gone at `last_confirmed + 641`
    /// ([`expiry_height`]).
    pub const EXPIRATION_BLOCKS: u32 = 640;
    /// A periodic (update) confirm is allowed this many blocks after the previous one.
    pub const MIN_CONFIRM_INTERVAL_BLOCKS: u32 = 500;
    /// We flag a node as at risk once this many blocks passed without a confirm.
    pub const AT_RISK_BLOCKS: u32 = 560;
    /// `FLUXNODE_START_TX_EXPIRATION_HEIGHT_V2`. A start not confirmed by then moves to the DOS
    /// list at exactly `added + 240` (`CheckForExpiredStartTx`), unless that same block confirms
    /// it ([`dos_height`]).
    pub const START_EXPIRATION_BLOCKS: u32 = 240;
    /// `FLUXNODE_DOS_REMOVE_AMOUNT_V2`. A DOS entry is forgotten by the first block `H` with
    /// `added <= H - 720` (`GetUndoDataForExpiredFluxnodeDosScores`), so at `added + 720`
    /// ([`dos_end_height`]); the collateral may then start again.
    pub const DOS_BLOCKS: u32 = 720;

    /// Height of the block that drops a node last confirmed at `last_confirmed`.
    pub const fn expiry_height(last_confirmed: u32) -> u32 {
        last_confirmed.saturating_add(EXPIRATION_BLOCKS + 1)
    }

    /// True when the block at `height` (or an earlier one) has dropped the node.
    pub const fn is_expired_at(last_confirmed: u32, height: u32) -> bool {
        height >= expiry_height(last_confirmed)
    }

    /// Height of the block that moves an unconfirmed start (mined at `added`) to the DOS list.
    pub const fn dos_height(added: u32) -> u32 {
        added.saturating_add(START_EXPIRATION_BLOCKS)
    }

    /// Height of the block that removes a DOS entry (start mined at `added`).
    pub const fn dos_end_height(added: u32) -> u32 {
        added.saturating_add(DOS_BLOCKS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_parsing() {
        assert_eq!(Tier::parse_lenient("CUMULUS"), Tier::Cumulus);
        assert_eq!(Tier::parse_lenient("stratus_new"), Tier::Stratus);
        assert_eq!(Tier::parse_lenient("BAMF"), Tier::Stratus);
        assert_eq!(Tier::parse_lenient("super"), Tier::Nimbus);
        assert_eq!(Tier::parse_lenient("2"), Tier::Nimbus);
        assert_eq!(Tier::parse_lenient("titan"), Tier::Unknown);
        assert_eq!(
            Tier::from_collateral("12500.00".parse().unwrap()),
            Tier::Nimbus
        );
        assert_eq!(
            Tier::from_collateral(Amount::from_flux(40_000)),
            Tier::Stratus
        );
        assert_eq!(Tier::from_collateral(Amount::from_flux(3)), Tier::Unknown);
        for t in Tier::ALL {
            assert_eq!(Tier::from_u8(t.as_u8()), t);
            assert_eq!(Tier::from_collateral(t.collateral().unwrap()), t);
        }
        assert_eq!(serde_json::to_string(&Tier::Nimbus).unwrap(), "\"nimbus\"");
    }

    #[test]
    fn status_and_bench() {
        assert_eq!(
            NodeStatus::parse_lenient("CONFIRMED"),
            NodeStatus::Confirmed
        );
        assert_eq!(NodeStatus::parse_lenient("expired"), NodeStatus::Expired);
        assert_eq!(NodeStatus::from_u8(6), NodeStatus::Departed);
        assert_eq!(
            BenchStatus::parse_lenient("STRATUS"),
            (BenchStatus::Passed, Tier::Stratus)
        );
        assert_eq!(
            BenchStatus::parse_lenient("running").0,
            BenchStatus::Running
        );
        assert_eq!(BenchStatus::parse_lenient("failed").0, BenchStatus::Failed);
        assert_eq!(BenchStatus::parse_lenient("0").0, BenchStatus::Unknown);
        assert_eq!(Arch::parse_lenient("arm64"), Arch::Arm64);
    }

    #[test]
    fn daemon_version() {
        assert_eq!(format_daemon_version(9_010_050).as_deref(), Some("9.1.0"));
        assert_eq!(format_daemon_version(9_000_650).as_deref(), Some("9.0.6"));
        assert_eq!(format_daemon_version(0), None);
    }

    #[test]
    fn geo_coords() {
        let mut g = Geo {
            lat: 0.0,
            lon: 0.0,
            ..Geo::default()
        };
        assert!(!g.has_coords());
        g.lat = 51.3;
        g.lon = 12.4;
        assert!(g.has_coords());
    }

    #[test]
    fn node_record_postcard_roundtrip() {
        let rec = NodeRecord {
            id: NodeId(7),
            endpoint: Some("1.2.3.4:16137".parse().unwrap()),
            tier: Tier::Nimbus,
            status: NodeStatus::Confirmed,
            payment_address: "t3abc".into(),
            rank: Some(4),
            geo: Some(Geo {
                lat: 1.5,
                lon: 2.5,
                asn: Some(24940),
                ..Geo::default()
            }),
            ..NodeRecord::default()
        };
        let bytes = postcard::to_allocvec(&rec).unwrap();
        let back: NodeRecord = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(back, rec);
        assert!(rec.is_p2sh_payee());
    }
}

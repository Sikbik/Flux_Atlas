//! stats.runonflux.io models: `/fluxinfo` rows (full or projected), `/fluxlocation/<ip>`,
//! `/fluxhistorystats`, `/marketplace/listapps`.

use std::collections::BTreeMap;

use atlas_core::node::{GeoSource, Hardware, Versions};
use atlas_core::{Hash32, NodeEndpoint, Outpoint, Tier};
use serde::Deserialize;

use crate::lenient;
use crate::models::apps::RawComponent;
use crate::models::node_api::{FluxInfo, Geolocation};

/// One `/fluxinfo` row: the node's full `/flux/info` plus stats wrapper fields.
///
/// About 150 rows per round are unreachable nodes: they carry `error: {}` and zeroed
/// placeholders everywhere. [`StatsNodeRow::reachable`] is false for those, and every accessor
/// returns `None` for placeholder data (never `(0, 0)` coordinates).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StatsNodeRow {
    #[serde(flatten)]
    pub info: FluxInfo,
    /// `host` or `host:port` (non-16127).
    #[serde(deserialize_with = "lenient::string")]
    pub ip: String,
    #[serde(deserialize_with = "lenient::string")]
    pub tier: String,
    #[serde(rename = "paymentAddress", deserialize_with = "lenient::string")]
    pub payment_address: String,
    #[serde(rename = "collateralHash", deserialize_with = "lenient::string")]
    pub collateral_hash: String,
    #[serde(rename = "collateralIndex", deserialize_with = "lenient::opt_u32")]
    pub collateral_index: Option<u32>,
    #[serde(rename = "addedHeight", deserialize_with = "lenient::opt_u32")]
    pub added_height: Option<u32>,
    #[serde(rename = "confirmedHeight", deserialize_with = "lenient::opt_u32")]
    pub confirmed_height: Option<u32>,
    #[serde(rename = "lastConfirmedHeight", deserialize_with = "lenient::opt_u32")]
    pub last_confirmed_height: Option<u32>,
    #[serde(rename = "lastPaidHeight", deserialize_with = "lenient::opt_u32")]
    pub last_paid_height: Option<u32>,
    #[serde(rename = "activeSince", deserialize_with = "lenient::opt_u64")]
    pub active_since: Option<u64>,
    #[serde(rename = "scannedHeight", deserialize_with = "lenient::opt_u32")]
    pub scanned_height: Option<u32>,
    /// Collection round id (ms); changes once per round.
    #[serde(rename = "roundTime", deserialize_with = "lenient::opt_u64")]
    pub round_time: Option<u64>,
    /// When this node was collected (ms).
    #[serde(rename = "dataCollectedAt", deserialize_with = "lenient::opt_u64")]
    pub data_collected_at: Option<u64>,
    /// Present (usually `{}`) when the node was unreachable.
    pub error: Option<serde_json::Value>,
}

impl StatsNodeRow {
    /// Join key with the node list: `(collateralHash, collateralIndex)`.
    pub fn outpoint(&self) -> Option<Outpoint> {
        Some(Outpoint::new(
            Hash32::from_hex(&self.collateral_hash).ok()?,
            self.collateral_index?,
        ))
    }

    /// False for unreachable-node placeholder rows.
    pub fn reachable(&self) -> bool {
        self.error.is_none()
    }

    pub fn endpoint(&self) -> Option<NodeEndpoint> {
        NodeEndpoint::parse_opt(&self.ip).ok().flatten()
    }

    pub fn tier(&self) -> Tier {
        Tier::parse_lenient(&self.tier)
    }

    pub fn hardware(&self) -> Option<Hardware> {
        if !self.reachable() {
            return None;
        }
        self.info.hardware()
    }

    /// Versions; empty for unreachable rows.
    pub fn versions(&self) -> Versions {
        if !self.reachable() {
            return Versions::default();
        }
        self.info.versions()
    }

    pub fn geo(&self) -> Option<atlas_core::node::Geo> {
        if !self.reachable() {
            return None;
        }
        self.info.geo(GeoSource::NodeReported)
    }

    pub fn is_arcane(&self) -> Option<bool> {
        if !self.reachable() {
            return None;
        }
        self.info.is_arcane()
    }

    /// Lowercase names of apps with running containers.
    pub fn running_apps(&self) -> Vec<String> {
        if !self.reachable() {
            return Vec::new();
        }
        self.info.running_apps()
    }
}

/// `/fluxlocation/<ip>` (ip-api subset). Works for unreachable nodes too.
pub type FluxLocation = Geolocation;

/// `/fluxhistorystats`: `{"<unix ms>": {cumulus, nimbus, stratus}}` about every 14.5 min for
/// 30 days.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(transparent)]
pub struct HistoryStats(pub BTreeMap<String, TierCountPoint>);

/// One point of [`HistoryStats`].
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct TierCountPoint {
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub cumulus: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub nimbus: u32,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub stratus: u32,
}

impl HistoryStats {
    /// Points sorted by time: `(unix ms, counts)`.
    pub fn points(&self) -> Vec<(u64, TierCountPoint)> {
        let mut v: Vec<(u64, TierCountPoint)> = self
            .0
            .iter()
            .filter_map(|(k, p)| k.parse::<u64>().ok().map(|t| (t, *p)))
            .collect();
        v.sort_by_key(|(t, _)| *t);
        v
    }
}

/// `/marketplace/listapps` template.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct MarketplaceApp {
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub description: String,
    #[serde(deserialize_with = "lenient::string")]
    pub category: String,
    #[serde(deserialize_with = "lenient::u32_or_zero")]
    pub version: u32,
    #[serde(deserialize_with = "lenient::opt_u32")]
    pub instances: Option<u32>,
    #[serde(rename = "priceUSD", deserialize_with = "lenient::opt_f64")]
    pub price_usd: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_f64")]
    pub price: Option<f64>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub visible: Option<bool>,
    #[serde(deserialize_with = "lenient::opt_bool")]
    pub enabled: Option<bool>,
    #[serde(deserialize_with = "lenient::vec_skip_bad")]
    pub compose: Vec<RawComponent>,
}

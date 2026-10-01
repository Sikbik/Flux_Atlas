//! City-level enrichment from the local GeoIP database (DB-IP City Lite, `atlas-geoip`).
//!
//! Rules (ARCHITECTURE section 3.2, *Local GeoIP*):
//! - a located node gets the city, and the region when its source has none;
//! - country, org and ASN are never overridden (an empty country is filled);
//! - when the database disagrees with the source on the country, nothing is taken;
//! - a node without usable coordinates gets the database's city-level coordinates, marked
//!   `GeoSource::LocalDb` (the `geo_approx` flag); a precise location replaces them later.

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use atlas_core::api::DataAttribution;
use atlas_core::live::DeltaCause;
use atlas_core::node::{Geo, GeoSource};
use atlas_geoip::GeoIpDb;
use compact_str::CompactString;

use crate::state::{NetworkState, Tick, mask};

/// Local GeoIP settings.
#[derive(Debug, Clone)]
pub struct GeoIpConfig {
    /// Database to read: the downloaded one (`<data>/geoip/dbip-city-lite.mmdb`) or the
    /// operator's (`ATLAS_GEOIP_DB`). `None`: no local GeoIP.
    pub db_path: Option<PathBuf>,
    /// Directory the auto-download installs into (`None`: no download).
    pub auto_dir: Option<PathBuf>,
    /// First check after start (the download never delays startup or ingest).
    pub first_check: Duration,
    /// Check interval (download, or modification time of an operator file).
    pub check_interval: Duration,
}

impl Default for GeoIpConfig {
    fn default() -> Self {
        Self {
            db_path: None,
            auto_dir: None,
            first_check: Duration::from_secs(30),
            check_interval: Duration::from_secs(86_400),
        }
    }
}

impl GeoIpConfig {
    /// The managed layout under a data directory, with or without auto-download.
    pub fn managed(data_dir: &std::path::Path, auto: bool) -> Self {
        let dir = data_dir.join("geoip");
        Self {
            db_path: Some(dir.join(atlas_geoip::DB_FILE)),
            auto_dir: auto.then_some(dir),
            ..Self::default()
        }
    }

    /// An operator-managed database file (no download).
    pub fn file(path: PathBuf) -> Self {
        Self {
            db_path: Some(path),
            auto_dir: None,
            ..Self::default()
        }
    }
}

/// The loaded database and what it is.
#[derive(Debug, Clone)]
pub struct LoadedGeoIp {
    pub db: Arc<GeoIpDb>,
    /// `YYYY-MM` of a downloaded database, when recorded.
    pub version: Option<String>,
}

impl LoadedGeoIp {
    /// Opens `path` (and reads the month from the install record next to it).
    pub fn open(path: &std::path::Path) -> atlas_geoip::Result<Self> {
        let db = GeoIpDb::open(path)?;
        let version = path
            .parent()
            .and_then(atlas_geoip::install::read_state)
            .filter(|_| {
                path.file_name()
                    .is_some_and(|n| n == std::ffi::OsStr::new(atlas_geoip::DB_FILE))
            })
            .map(|s| s.month);
        Ok(Self {
            db: Arc::new(db),
            version,
        })
    }

    /// The licence credit to show while this database is in use.
    pub fn attribution(&self) -> DataAttribution {
        DataAttribution {
            name: "DB-IP".to_owned(),
            text: atlas_geoip::ATTRIBUTION_TEXT.to_owned(),
            url: atlas_geoip::ATTRIBUTION_URL.to_owned(),
            license: atlas_geoip::LICENSE.to_owned(),
            license_url: atlas_geoip::LICENSE_URL.to_owned(),
            scope: "City names and approximate node locations".to_owned(),
            version: self.version.clone(),
        }
    }
}

fn fill(dst: &mut CompactString, src: &str) {
    if dst.trim().is_empty() && !src.is_empty() {
        *dst = src.into();
    }
}

/// The enriched location of a node on `ip` whose current location is `geo`, or `None` when the
/// database adds nothing.
pub fn enrich(db: &GeoIpDb, ip: IpAddr, geo: Option<&Geo>) -> Option<Geo> {
    let hit = db.lookup(ip)?;
    let cur = geo.cloned().unwrap_or_default();
    if !cur.country_code.is_empty()
        && !hit.country_code.is_empty()
        && !cur.country_code.eq_ignore_ascii_case(&hit.country_code)
    {
        // The sources disagree on the country: a city from the database would contradict it.
        return None;
    }
    let mut out = cur.clone();
    if cur.is_precise() {
        fill(&mut out.city, &hit.city);
        fill(&mut out.region, &hit.region);
    } else {
        let (Some(lat), Some(lon)) = (hit.lat, hit.lon) else {
            return None;
        };
        out.lat = lat;
        out.lon = lon;
        if cur.source == GeoSource::LocalDb {
            // Everything location-like came from the database: follow it.
            out.city = hit.city.as_str().into();
            out.region = hit.region.as_str().into();
        } else {
            fill(&mut out.city, &hit.city);
            fill(&mut out.region, &hit.region);
        }
        out.source = GeoSource::LocalDb;
    }
    if out.country_code.is_empty() {
        out.country_code = hit.country_code.as_str().into();
        out.country = hit.country.as_str().into();
    }
    fill(&mut out.country, &hit.country);
    fill(&mut out.continent_code, &hit.continent_code);
    (out != cur).then_some(out)
}

/// `geo` enriched when a database is loaded (else unchanged).
pub fn enriched(st: &NetworkState, ip: Option<IpAddr>, geo: Geo) -> Geo {
    match (&st.geoip, ip) {
        (Some(g), Some(ip)) => enrich(&g.db, ip, Some(&geo)).unwrap_or(geo),
        _ => geo,
    }
}

/// Enriches every listed node. Changed nodes are persisted and, with a `tick`, streamed as one
/// `nodes` delta (`cause: geo`). Returns how many changed.
pub fn enrich_all(st: &mut NetworkState, mut tick: Option<&mut Tick>) -> usize {
    let Some(g) = st.geoip.clone() else { return 0 };
    let changes: Vec<(atlas_core::NodeId, Geo)> = st
        .nodes
        .listed()
        .filter_map(|e| {
            let ip = e.rec.endpoint?.ip;
            enrich(&g.db, ip, e.rec.geo.as_ref()).map(|geo| (e.rec.id, geo))
        })
        .collect();
    let n = changes.len();
    for (id, geo) in changes {
        if let Some(e) = st.nodes.get_mut(id) {
            e.rec.geo = Some(geo);
        }
        st.nodes.touch_persist(id);
        if let Some(t) = tick.as_deref_mut() {
            t.node_changed(DeltaCause::Geo, id, mask::GEO | mask::FLAGS);
        }
    }
    if n > 0 {
        st.summary_dirty = true;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> GeoIpDb {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../atlas-geoip/tests/fixtures/GeoIP2-City-Test.mmdb");
        GeoIpDb::open(&p).unwrap()
    }

    fn reported(cc: &str) -> Geo {
        Geo {
            lat: 51.5,
            lon: -0.1,
            continent_code: "EU".into(),
            country_code: cc.into(),
            country: "United Kingdom".into(),
            region: "".into(),
            city: "".into(),
            org: "Andrews & Arnold".into(),
            asn: Some(20_712),
            hosting: Some(true),
            source: GeoSource::NodeReported,
        }
    }

    #[test]
    fn adds_city_and_region_but_never_overrides_the_source() {
        let db = db();
        let london: IpAddr = "81.2.69.142".parse().unwrap();
        let g = enrich(&db, london, Some(&reported("GB"))).unwrap();
        assert_eq!(g.city, "London");
        assert_eq!(g.region, "England");
        assert_eq!((g.lat, g.lon), (51.5, -0.1), "coordinates kept");
        assert_eq!(g.org, "Andrews & Arnold");
        assert_eq!(g.asn, Some(20_712));
        assert_eq!(g.source, GeoSource::NodeReported, "still precise");
        // Already enriched: nothing to add.
        assert!(enrich(&db, london, Some(&g)).is_none());
        // A region from the source is kept.
        let mut r = reported("GB");
        r.region = "Greater London".into();
        assert_eq!(
            enrich(&db, london, Some(&r)).unwrap().region,
            "Greater London"
        );
        // Disagreeing country: nothing taken.
        assert!(enrich(&db, london, Some(&reported("DE"))).is_none());
        // No record.
        assert!(enrich(&db, "10.1.2.3".parse().unwrap(), Some(&reported("GB"))).is_none());
    }

    #[test]
    fn approximates_unlocated_nodes_and_flags_them() {
        let db = db();
        let ip: IpAddr = "89.160.20.128".parse().unwrap();
        let g = enrich(&db, ip, None).unwrap();
        assert_eq!(g.source, GeoSource::LocalDb);
        assert!(g.has_coords() && !g.is_precise());
        assert_eq!(g.city, "Linköping");
        assert_eq!(g.country_code, "SE");
        assert_eq!(g.continent_code, "EU");
        // Zero placeholders count as unlocated; org and ASN survive.
        let mut zero = reported("SE");
        zero.lat = 0.0;
        zero.lon = 0.0;
        let g = enrich(&db, ip, Some(&zero)).unwrap();
        assert_eq!(g.source, GeoSource::LocalDb);
        assert_eq!(g.org, "Andrews & Arnold");
        assert!((g.lat - 58.4167).abs() < 1e-3);
        let flags = atlas_core::codec::nodes_bin::NodeBinInput::from_record(
            &atlas_core::NodeRecord {
                geo: Some(g),
                ..atlas_core::NodeRecord::default()
            },
            0,
            0,
            false,
        )
        .flags;
        assert_ne!(flags & atlas_core::codec::nodes_bin::flags::GEO_APPROX, 0);
    }
}

//! Local GeoIP for Flux Atlas: DB-IP "IP to City Lite" (CC BY 4.0).
//!
//! - [`GeoIpDb`] memory-maps an `.mmdb` file (it is never copied onto the heap) and answers
//!   city-level lookups.
//! - [`install`] turns a downloaded `.mmdb.gz` into the live database: gzip integrity (CRC and
//!   length trailer), MaxMind DB metadata, a plausible size and probe lookups are checked before
//!   an atomic rename swaps it in; the previous file is kept next to it.
//! - [`fetch`] downloads the monthly file (`dbip-city-lite-YYYY-MM.mmdb.gz`, falling back to the
//!   previous month while the current one is not published yet).
//!
//! The data is licensed CC BY 4.0 and must be credited "IP Geolocation by DB-IP" with a link
//! to <https://db-ip.com> wherever it is shown ([`ATTRIBUTION_TEXT`], [`ATTRIBUTION_URL`]).

#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod fetch;
pub mod install;
mod month;

use std::net::IpAddr;
use std::path::{Path, PathBuf};

use maxminddb::Reader;
use memmap2::Mmap;
use serde::Deserialize;

pub use month::{month_of, previous_month};

/// Attribution required by the DB-IP Lite licence.
pub const ATTRIBUTION_TEXT: &str = "IP Geolocation by DB-IP";
/// Link that must accompany [`ATTRIBUTION_TEXT`].
pub const ATTRIBUTION_URL: &str = "https://db-ip.com";
/// Licence of the DB-IP Lite databases.
pub const LICENSE: &str = "CC BY 4.0";
pub const LICENSE_URL: &str = "https://creativecommons.org/licenses/by/4.0/";

/// File name of the live database inside the managed directory.
pub const DB_FILE: &str = "dbip-city-lite.mmdb";
/// File name of the previous database (kept after every install).
pub const PREVIOUS_FILE: &str = "dbip-city-lite.prev.mmdb";
/// Install record (month, size, time) next to the database.
pub const STATE_FILE: &str = "dbip-city-lite.json";

#[derive(Debug, thiserror::Error)]
pub enum GeoIpError {
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("database: {0}")]
    Db(#[from] maxminddb::MaxMindDbError),
    #[error("rejected: {0}")]
    Rejected(String),
    #[error("http: {0}")]
    Http(String),
}

pub type Result<T> = std::result::Result<T, GeoIpError>;

/// What one lookup knows about an address. Empty strings and `None` mean unknown.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GeoIpHit {
    pub city: String,
    /// First-level subdivision (state, province, region).
    pub region: String,
    /// ISO-3166 alpha-2, upper case.
    pub country_code: String,
    pub country: String,
    pub continent_code: String,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
}

/// Facts about an opened database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbInfo {
    pub path: PathBuf,
    pub database_type: String,
    pub build_epoch: u64,
    pub bytes: u64,
    pub node_count: u32,
    pub ip_version: u16,
}

/// A memory-mapped City database.
pub struct GeoIpDb {
    reader: Reader<Mmap>,
    info: DbInfo,
}

impl std::fmt::Debug for GeoIpDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeoIpDb")
            .field("info", &self.info)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct Names<'a> {
    #[serde(borrow, default)]
    en: Option<&'a str>,
}

#[derive(Deserialize)]
struct Named<'a> {
    #[serde(borrow, default)]
    names: Option<Names<'a>>,
}

#[derive(Deserialize)]
struct Country<'a> {
    #[serde(borrow, default)]
    iso_code: Option<&'a str>,
    #[serde(borrow, default)]
    names: Option<Names<'a>>,
}

#[derive(Deserialize)]
struct Continent<'a> {
    #[serde(borrow, default)]
    code: Option<&'a str>,
}

#[derive(Deserialize)]
struct Location {
    #[serde(default)]
    latitude: Option<f64>,
    #[serde(default)]
    longitude: Option<f64>,
}

/// The fields of a City record we use (DB-IP City Lite and GeoIP2 City share the layout).
#[derive(Deserialize)]
struct CityRecord<'a> {
    #[serde(borrow, default)]
    city: Option<Named<'a>>,
    #[serde(borrow, default)]
    subdivisions: Option<Vec<Named<'a>>>,
    #[serde(borrow, default)]
    country: Option<Country<'a>>,
    #[serde(borrow, default)]
    continent: Option<Continent<'a>>,
    #[serde(default)]
    location: Option<Location>,
}

fn name(n: Option<&Names<'_>>) -> String {
    n.and_then(|n| n.en).unwrap_or_default().trim().to_owned()
}

impl GeoIpDb {
    /// Memory-maps `path` and reads its metadata. Nothing of the data section is copied.
    pub fn open(path: &Path) -> Result<Self> {
        let bytes = std::fs::metadata(path)?.len();
        // SAFETY: the mapping is only sound while the file is not modified or truncated. Atlas
        // never writes to an installed database: a new one is written under another name,
        // checked, and renamed over the old path, so a reader keeps mapping the old inode
        // (still linked as the previous file, or unlinked but alive until the map is dropped).
        // An operator-managed file (`ATLAS_GEOIP_DB`) must likewise be replaced by rename,
        // never rewritten in place; the README says so.
        let file = std::fs::File::open(path)?;
        #[allow(unsafe_code)]
        let map = unsafe { Mmap::map(&file) }?;
        // Lookups touch a few pages of a 127 MB file at random. Without this hint each fault
        // reads ahead up to 128 KB, which only inflates the resident (page cache) set.
        #[cfg(unix)]
        let _ = map.advise(memmap2::Advice::Random);
        let reader = Reader::from_source(map)?;
        let m = reader.metadata();
        let info = DbInfo {
            path: path.to_path_buf(),
            database_type: m.database_type.clone(),
            build_epoch: m.build_epoch,
            bytes,
            node_count: m.node_count,
            ip_version: m.ip_version,
        };
        Ok(Self { reader, info })
    }

    pub fn info(&self) -> &DbInfo {
        &self.info
    }

    /// City-level location of `ip`, or `None` when the database has no record for it.
    pub fn lookup(&self, ip: IpAddr) -> Option<GeoIpHit> {
        let r = self.reader.lookup(ip).ok()?;
        let rec: CityRecord<'_> = r.decode().ok()??;
        let (lat, lon) = match rec.location {
            Some(Location {
                latitude: Some(a),
                longitude: Some(b),
            }) if a.is_finite()
                && b.is_finite()
                && (-90.0..=90.0).contains(&a)
                && (-180.0..=180.0).contains(&b)
                && !(a == 0.0 && b == 0.0) =>
            {
                (Some(a as f32), Some(b as f32))
            }
            _ => (None, None),
        };
        let hit = GeoIpHit {
            city: name(rec.city.as_ref().and_then(|c| c.names.as_ref())),
            region: name(
                rec.subdivisions
                    .as_ref()
                    .and_then(|s| s.first())
                    .and_then(|s| s.names.as_ref()),
            ),
            country_code: rec
                .country
                .as_ref()
                .and_then(|c| c.iso_code)
                .unwrap_or_default()
                .trim()
                .to_ascii_uppercase(),
            country: name(rec.country.as_ref().and_then(|c| c.names.as_ref())),
            continent_code: rec
                .continent
                .as_ref()
                .and_then(|c| c.code)
                .unwrap_or_default()
                .trim()
                .to_ascii_uppercase(),
            lat,
            lon,
        };
        (hit != GeoIpHit::default()).then_some(hit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn looks_up_city_region_country_and_coordinates() {
        let db = GeoIpDb::open(&fixture("GeoIP2-City-Test.mmdb")).unwrap();
        assert!(db.info().database_type.contains("City"));
        let h = db.lookup("81.2.69.142".parse().unwrap()).unwrap();
        assert_eq!(h.city, "London");
        assert_eq!(h.region, "England");
        assert_eq!(h.country_code, "GB");
        assert_eq!(h.country, "United Kingdom");
        assert_eq!(h.continent_code, "EU");
        assert!((h.lat.unwrap() - 51.5142).abs() < 1e-3);
        assert!((h.lon.unwrap() + 0.0931).abs() < 1e-3);
        let h = db.lookup("89.160.20.128".parse().unwrap()).unwrap();
        assert_eq!(h.city, "Linköping");
        assert_eq!(h.country_code, "SE");
        // IPv6 records work too.
        let h = db.lookup("2001:480:10::1".parse().unwrap()).unwrap();
        assert_eq!(h.city, "San Diego");
        // No record.
        assert!(db.lookup("10.0.0.1".parse().unwrap()).is_none());
        assert!(db.lookup("1.1.1.1".parse().unwrap()).is_none());
    }
}

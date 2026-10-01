//! Verified, atomic installation of a downloaded database.
//!
//! The managed directory holds:
//! - `dbip-city-lite.mmdb`: the live database (what readers map);
//! - `dbip-city-lite.prev.mmdb`: the one it replaced;
//! - `dbip-city-lite.json`: the install record ([`InstallState`]);
//! - transient `.download-*` / `.staging-*` files while an update is in flight (removed at the
//!   next start if a crash left them behind).

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{DB_FILE, GeoIpDb, GeoIpError, PREVIOUS_FILE, Result, STATE_FILE};

/// What makes a database plausible enough to install.
#[derive(Debug, Clone)]
pub struct Policy {
    /// Smallest accepted uncompressed size.
    pub min_bytes: u64,
    /// Largest accepted uncompressed size (also bounds the gzip expansion).
    pub max_bytes: u64,
    /// Addresses whose country is stable, with that country.
    pub probes: Vec<(IpAddr, &'static str)>,
    /// How many probes must answer with the expected country.
    pub min_probe_hits: usize,
}

impl Policy {
    /// DB-IP City Lite: about 127 MB uncompressed (2026-09), so anything under 40 MB or over
    /// 1 GiB is not a complete file.
    pub fn dbip_city_lite() -> Self {
        let ip = |s: &str| s.parse::<IpAddr>().ok();
        let probes = [
            ("8.8.8.8", "US"),       // Google public DNS
            ("193.0.6.139", "NL"),   // RIPE NCC, Amsterdam
            ("200.160.2.3", "BR"),   // NIC.br, Sao Paulo
            ("202.12.29.205", "AU"), // APNIC, Brisbane
        ]
        .into_iter()
        .filter_map(|(a, c)| Some((ip(a)?, c)))
        .collect();
        Self {
            min_bytes: 40_000_000,
            max_bytes: 1 << 30,
            probes,
            min_probe_hits: 3,
        }
    }
}

/// The install record kept next to the database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallState {
    /// Month of the DB-IP file (`YYYY-MM`).
    pub month: String,
    pub installed_ms: u64,
    pub bytes: u64,
    pub build_epoch: u64,
    pub source: String,
}

/// Reads the install record, if any.
pub fn read_state(dir: &Path) -> Option<InstallState> {
    let raw = fs::read(dir.join(STATE_FILE)).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Removes download and staging leftovers of an interrupted update.
pub fn cleanup(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(".download-") || name.starts_with(".staging-") {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// Decompresses `src` (gzip) into `dst`. Reading to the end checks the gzip trailer (CRC-32 and
/// length), so a truncated or corrupted download fails here. Output beyond `max_bytes` is
/// rejected (a gzip bomb or the wrong file).
pub fn gunzip(src: &Path, dst: &Path, max_bytes: u64) -> Result<u64> {
    let input = BufReader::with_capacity(1 << 16, File::open(src)?);
    let mut dec = flate2::bufread::GzDecoder::new(input).take(max_bytes + 1);
    let mut out = BufWriter::with_capacity(1 << 16, File::create(dst)?);
    let n = std::io::copy(&mut dec, &mut out)?;
    if n > max_bytes {
        return Err(GeoIpError::Rejected(format!(
            "decompressed size exceeds {max_bytes} bytes"
        )));
    }
    out.flush()?;
    out.into_inner()
        .map_err(|e| GeoIpError::Io(e.into_error()))?
        .sync_all()?;
    Ok(n)
}

/// Checks an opened database against `policy`.
pub fn check(db: &GeoIpDb, policy: &Policy) -> Result<()> {
    let info = db.info();
    if info.bytes < policy.min_bytes || info.bytes > policy.max_bytes {
        return Err(GeoIpError::Rejected(format!(
            "implausible size {} bytes (expected {}..={})",
            info.bytes, policy.min_bytes, policy.max_bytes
        )));
    }
    if !info.database_type.to_ascii_lowercase().contains("city") {
        return Err(GeoIpError::Rejected(format!(
            "not a city database: {:?}",
            info.database_type
        )));
    }
    if info.node_count == 0 || !matches!(info.ip_version, 4 | 6) {
        return Err(GeoIpError::Rejected(format!(
            "bad metadata: node_count {}, ip_version {}",
            info.node_count, info.ip_version
        )));
    }
    let hits = policy
        .probes
        .iter()
        .filter(|(ip, cc)| {
            db.lookup(*ip)
                .is_some_and(|h| h.country_code == *cc && h.lat.is_some())
        })
        .count();
    if hits < policy.min_probe_hits {
        return Err(GeoIpError::Rejected(format!(
            "probe lookups failed ({hits} of {} matched, {} needed)",
            policy.probes.len(),
            policy.min_probe_hits
        )));
    }
    Ok(())
}

/// Outcome of an install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    pub path: PathBuf,
    pub state: InstallState,
}

/// Installs the gzip-compressed database `gz` (for `month`) into `dir`: decompress to a staging
/// file, verify it, keep the current database as the previous one, and rename the staging
/// file over the live path (atomic: the live path never disappears, and readers that mapped the
/// old file keep their mapping). Blocking: run it off the async runtime.
pub fn install_gz(
    dir: &Path,
    gz: &Path,
    month: &str,
    source: &str,
    policy: &Policy,
    now_ms: u64,
) -> Result<Installed> {
    fs::create_dir_all(dir)?;
    let staging = dir.join(format!(".staging-{month}.mmdb"));
    let result = (|| {
        let bytes = gunzip(gz, &staging, policy.max_bytes)?;
        let build_epoch = {
            let db = GeoIpDb::open(&staging)?;
            check(&db, policy)?;
            db.info().build_epoch
        };
        swap_in(dir, &staging)?;
        let state = InstallState {
            month: month.to_owned(),
            installed_ms: now_ms,
            bytes,
            build_epoch,
            source: source.to_owned(),
        };
        write_state(dir, &state)?;
        Ok(Installed {
            path: dir.join(DB_FILE),
            state,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}

/// Keeps the live database as the previous one and renames `staging` over the live path.
fn swap_in(dir: &Path, staging: &Path) -> Result<()> {
    let live = dir.join(DB_FILE);
    let prev = dir.join(PREVIOUS_FILE);
    if live.exists() {
        match fs::remove_file(&prev) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        // A hard link keeps the live path in place until the rename below replaces it.
        if fs::hard_link(&live, &prev).is_err() {
            fs::copy(&live, &prev)?;
        }
    }
    fs::rename(staging, &live)?;
    sync_dir(dir);
    Ok(())
}

fn write_state(dir: &Path, state: &InstallState) -> Result<()> {
    let tmp = dir.join(format!(".staging-{STATE_FILE}"));
    let body = serde_json::to_vec_pretty(state).map_err(|e| GeoIpError::Io(e.into()))?;
    fs::write(&tmp, body)?;
    fs::rename(&tmp, dir.join(STATE_FILE))?;
    sync_dir(dir);
    Ok(())
}

/// Makes the renames durable (best effort; not every platform can open a directory).
fn sync_dir(dir: &Path) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::*;
    use crate::tests::fixture;

    fn test_policy() -> Policy {
        Policy {
            min_bytes: 1_000,
            max_bytes: 10_000_000,
            probes: vec![
                ("81.2.69.142".parse().unwrap(), "GB"),
                ("89.160.20.128".parse().unwrap(), "SE"),
                ("216.160.83.56".parse().unwrap(), "US"),
            ],
            min_probe_hits: 3,
        }
    }

    fn gz_of(src: &Path, dst: &Path) {
        let raw = fs::read(src).unwrap();
        let mut enc = flate2::write::GzEncoder::new(
            File::create(dst).unwrap(),
            flate2::Compression::default(),
        );
        enc.write_all(&raw).unwrap();
        enc.finish().unwrap();
    }

    #[test]
    fn installs_verified_and_keeps_the_previous_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("geoip");
        let gz = tmp.path().join("a.mmdb.gz");
        gz_of(&fixture("GeoIP2-City-Test.mmdb"), &gz);

        let a = install_gz(&dir, &gz, "2026-08", "test", &test_policy(), 1).unwrap();
        assert_eq!(a.path, dir.join(DB_FILE));
        assert_eq!(a.state.month, "2026-08");
        assert_eq!(
            a.state.bytes,
            fs::metadata(fixture("GeoIP2-City-Test.mmdb"))
                .unwrap()
                .len()
        );
        assert_eq!(read_state(&dir).unwrap(), a.state);
        assert!(!dir.join(PREVIOUS_FILE).exists());

        // A reader of the first install keeps working across the next install.
        let live = GeoIpDb::open(&a.path).unwrap();
        let b = install_gz(&dir, &gz, "2026-09", "test", &test_policy(), 2).unwrap();
        assert_eq!(b.state.month, "2026-09");
        assert!(dir.join(PREVIOUS_FILE).exists());
        assert_eq!(
            live.lookup("81.2.69.142".parse().unwrap()).unwrap().city,
            "London"
        );
        // No staging leftovers.
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.starts_with('.')), "{names:?}");
    }

    #[test]
    fn rejects_corrupt_truncated_invalid_and_implausible_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("geoip");
        let good = tmp.path().join("good.mmdb.gz");
        gz_of(&fixture("GeoIP2-City-Test.mmdb"), &good);
        let raw = fs::read(&good).unwrap();

        // Truncated download.
        let cut = tmp.path().join("cut.gz");
        fs::write(&cut, &raw[..raw.len() / 2]).unwrap();
        assert!(install_gz(&dir, &cut, "2026-09", "t", &test_policy(), 1).is_err());

        // Corrupted byte in the trailer CRC.
        let mut bad = raw.clone();
        let n = bad.len();
        bad[n - 6] ^= 0xff;
        let crc = tmp.path().join("crc.gz");
        fs::write(&crc, &bad).unwrap();
        assert!(install_gz(&dir, &crc, "2026-09", "t", &test_policy(), 1).is_err());

        // Not gzip at all.
        let plain = tmp.path().join("plain.gz");
        fs::write(&plain, b"<html>not found</html>").unwrap();
        assert!(install_gz(&dir, &plain, "2026-09", "t", &test_policy(), 1).is_err());

        // A database with broken metadata.
        let broken = tmp.path().join("broken.gz");
        gz_of(
            &fixture("GeoIP2-City-Test-Invalid-Node-Count.mmdb"),
            &broken,
        );
        assert!(install_gz(&dir, &broken, "2026-09", "t", &test_policy(), 1).is_err());

        // A valid database that is far too small for DB-IP City Lite.
        let e = install_gz(&dir, &good, "2026-09", "t", &Policy::dbip_city_lite(), 1).unwrap_err();
        assert!(e.to_string().contains("implausible size"), "{e}");

        // Nothing was installed, and nothing is left behind.
        assert!(!dir.join(DB_FILE).exists());
        assert!(read_state(&dir).is_none());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    #[test]
    fn gunzip_bounds_the_output() {
        let tmp = tempfile::tempdir().unwrap();
        let gz = tmp.path().join("a.gz");
        gz_of(&fixture("GeoIP2-City-Test.mmdb"), &gz);
        let out = tmp.path().join("a.mmdb");
        assert!(gunzip(&gz, &out, 1_000).is_err());
        assert_eq!(gunzip(&gz, &out, 1_000_000).unwrap(), 22_569);
    }

    #[test]
    fn cleanup_removes_leftovers_only() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        for n in [
            ".download-2026-09.mmdb.gz",
            ".staging-2026-09.mmdb",
            DB_FILE,
        ] {
            fs::write(d.join(n), b"x").unwrap();
        }
        cleanup(d);
        let left: Vec<String> = fs::read_dir(d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec![DB_FILE.to_owned()]);
    }
}

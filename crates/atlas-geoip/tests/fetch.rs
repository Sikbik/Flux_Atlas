//! Download + install against a local HTTP server (no network): month fallback, up-to-date
//! detection, rejection of a bad download.
#![allow(clippy::unwrap_used)]

use std::collections::HashMap;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use atlas_geoip::fetch::{FetchConfig, Outcome, client, refresh};
use atlas_geoip::install::{Policy, read_state};
use atlas_geoip::{DB_FILE, GeoIpDb, PREVIOUS_FILE};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn gz(name: &str) -> Vec<u8> {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(&std::fs::read(fixture(name)).unwrap())
        .unwrap();
    enc.finish().unwrap()
}

/// Serves `files` (path -> body); anything else is a 404. Records the requested paths.
async fn serve(files: HashMap<String, Vec<u8>>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    let files = Arc::new(files);
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let files = Arc::clone(&files);
            let log = Arc::clone(&log);
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_owned();
                log.lock().unwrap().push(path.clone());
                let (status, body) = match files.get(&path) {
                    Some(b) => ("200 OK", b.clone()),
                    None => ("404 Not Found", b"not found".to_vec()),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\ncontent-length: {}\r\ncontent-type: application/octet-stream\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(&body).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    (format!("http://{addr}/free"), seen)
}

fn policy() -> Policy {
    Policy {
        min_bytes: 1_000,
        max_bytes: 10_000_000,
        probes: vec![
            ("81.2.69.142".parse().unwrap(), "GB"),
            ("216.160.83.56".parse().unwrap(), "US"),
        ],
        min_probe_hits: 2,
    }
}

/// 2026-10-15T00:00:00Z.
const OCT_15: u64 = 1_792_022_400_000;

#[tokio::test]
async fn falls_back_to_the_previous_month_then_stays_up_to_date() {
    let tmp = tempfile::tempdir().unwrap();
    let mut files = HashMap::new();
    files.insert(
        "/free/dbip-city-lite-2026-09.mmdb.gz".to_owned(),
        gz("GeoIP2-City-Test.mmdb"),
    );
    let (base, seen) = serve(files).await;
    let cfg = FetchConfig {
        dir: tmp.path().join("geoip"),
        base_url: base,
        policy: policy(),
    };
    let c = client("atlas-test").unwrap();

    // October is not published yet: September is installed.
    let out = refresh(&c, &cfg, OCT_15).await.unwrap();
    let Outcome::Installed(inst) = out else {
        panic!("expected an install, got {out:?}");
    };
    assert_eq!(inst.state.month, "2026-09");
    assert_eq!(read_state(&cfg.dir).unwrap().month, "2026-09");
    let db = GeoIpDb::open(&cfg.dir.join(DB_FILE)).unwrap();
    assert_eq!(
        db.lookup("81.2.69.142".parse().unwrap()).unwrap().city,
        "London"
    );
    assert_eq!(
        *seen.lock().unwrap(),
        vec![
            "/free/dbip-city-lite-2026-10.mmdb.gz".to_owned(),
            "/free/dbip-city-lite-2026-09.mmdb.gz".to_owned()
        ]
    );

    // The next day: October still missing, September already installed.
    let out = refresh(&c, &cfg, OCT_15 + 86_400_000).await.unwrap();
    assert_eq!(
        out,
        Outcome::UpToDate {
            month: "2026-09".to_owned()
        }
    );
    assert!(!cfg.dir.join(PREVIOUS_FILE).exists());
}

#[tokio::test]
async fn a_bad_download_leaves_the_live_database_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let mut files = HashMap::new();
    files.insert(
        "/free/dbip-city-lite-2026-09.mmdb.gz".to_owned(),
        gz("GeoIP2-City-Test.mmdb"),
    );
    // October's file is corrupt (a database with broken metadata).
    files.insert(
        "/free/dbip-city-lite-2026-10.mmdb.gz".to_owned(),
        gz("GeoIP2-City-Test-Invalid-Node-Count.mmdb"),
    );
    let (base, _) = serve(files).await;
    let mut cfg = FetchConfig {
        dir: tmp.path().join("geoip"),
        base_url: base,
        policy: policy(),
    };
    let c = client("atlas-test").unwrap();
    // September first (as if installed last month).
    let sept = OCT_15 - 20 * 86_400_000;
    assert!(matches!(
        refresh(&c, &cfg, sept).await.unwrap(),
        Outcome::Installed(_)
    ));
    // October fails verification: an error, and September stays live.
    assert!(refresh(&c, &cfg, OCT_15).await.is_err());
    assert_eq!(read_state(&cfg.dir).unwrap().month, "2026-09");
    assert!(GeoIpDb::open(&cfg.dir.join(DB_FILE)).is_ok());
    let names: Vec<String> = std::fs::read_dir(&cfg.dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|n| !n.starts_with('.')), "{names:?}");

    // Nothing published at all.
    cfg.base_url.push_str("/missing");
    let empty = tempfile::tempdir().unwrap();
    cfg.dir = empty.path().join("geoip");
    assert_eq!(
        refresh(&c, &cfg, OCT_15).await.unwrap(),
        Outcome::NotPublished
    );
}

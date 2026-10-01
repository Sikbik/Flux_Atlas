//! Download of the monthly DB-IP City Lite file (outbound HTTPS only).

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::install::{self, Installed, Policy};
use crate::{DB_FILE, GeoIpError, Result, month_of, previous_month};

/// Where DB-IP publishes the free databases.
pub const DEFAULT_BASE_URL: &str = "https://download.db-ip.com/free";

/// Download settings.
#[derive(Debug, Clone)]
pub struct FetchConfig {
    /// Managed directory (`<ATLAS_DATA_DIR>/geoip`).
    pub dir: PathBuf,
    /// Base URL; the file is `<base>/dbip-city-lite-YYYY-MM.mmdb.gz`.
    pub base_url: String,
    pub policy: Policy,
}

impl FetchConfig {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            base_url: DEFAULT_BASE_URL.to_owned(),
            policy: Policy::dbip_city_lite(),
        }
    }

    /// URL of the file for `month` (`YYYY-MM`).
    pub fn url(&self, month: &str) -> String {
        format!(
            "{}/dbip-city-lite-{month}.mmdb.gz",
            self.base_url.trim_end_matches('/')
        )
    }
}

/// Result of a refresh.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The installed database is the newest published one.
    UpToDate { month: String },
    /// A newer database was downloaded, verified and installed.
    Installed(Installed),
    /// Neither the current nor the previous month is published.
    NotPublished,
}

/// An HTTP client for the download: a long overall timeout (about 60 MB), a short connect one.
pub fn client(user_agent: &str) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(user_agent)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(20 * 60))
        .build()
        .map_err(|e| GeoIpError::Http(e.to_string()))
}

/// Installs the newest published month (the current one, else the previous one) unless it is
/// already installed. Never touches the live database unless a new one verified.
pub async fn refresh(client: &reqwest::Client, cfg: &FetchConfig, now_ms: u64) -> Result<Outcome> {
    tokio::fs::create_dir_all(&cfg.dir).await?;
    let installed = install::read_state(&cfg.dir)
        .filter(|_| cfg.dir.join(DB_FILE).exists())
        .map(|s| s.month);
    let current = month_of(now_ms);
    let previous = previous_month(&current).unwrap_or_default();
    for month in [current, previous] {
        if installed.as_deref() == Some(month.as_str()) {
            return Ok(Outcome::UpToDate { month });
        }
        let url = cfg.url(&month);
        let part = cfg.dir.join(format!(".download-{month}.mmdb.gz"));
        let got = download(client, &url, &part, cfg.policy.max_bytes).await;
        match got {
            Ok(true) => {}
            Ok(false) => {
                tracing::debug!(%url, "geoip: not published");
                continue;
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(e);
            }
        }
        let (dir, policy, m, src, gz) = (
            cfg.dir.clone(),
            cfg.policy.clone(),
            month.clone(),
            url.clone(),
            part.clone(),
        );
        let res = tokio::task::spawn_blocking(move || {
            install::install_gz(&dir, &gz, &m, &src, &policy, now_ms)
        })
        .await
        .map_err(|e| GeoIpError::Io(std::io::Error::other(e)))?;
        let _ = tokio::fs::remove_file(&part).await;
        return res.map(Outcome::Installed);
    }
    Ok(Outcome::NotPublished)
}

/// Streams `url` into `dst`. `Ok(false)` when the file does not exist (404).
async fn download(client: &reqwest::Client, url: &str, dst: &Path, max_bytes: u64) -> Result<bool> {
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| GeoIpError::Http(e.to_string()))?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(false);
    }
    if !status.is_success() {
        return Err(GeoIpError::Http(format!("{url}: HTTP {status}")));
    }
    let expected = resp.content_length();
    if expected.is_some_and(|n| n > max_bytes) {
        return Err(GeoIpError::Rejected(format!(
            "{url}: {} bytes announced, more than {max_bytes}",
            expected.unwrap_or_default()
        )));
    }
    let mut file = tokio::fs::File::create(dst).await?;
    let mut written: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| GeoIpError::Http(e.to_string()))?
    {
        written += chunk.len() as u64;
        if written > max_bytes {
            return Err(GeoIpError::Rejected(format!(
                "{url}: more than {max_bytes} bytes"
            )));
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    file.sync_all().await?;
    if let Some(n) = expected
        && n != written
    {
        return Err(GeoIpError::Rejected(format!(
            "{url}: {written} of {n} bytes received"
        )));
    }
    Ok(true)
}

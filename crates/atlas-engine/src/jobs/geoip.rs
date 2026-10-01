//! Local GeoIP upkeep: downloads and installs the monthly DB-IP City Lite database (or watches
//! an operator-managed file), and hands each new database to the reducer. Runs in the
//! background only: startup and ingest never wait for it.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use atlas_core::now_ms;
use atlas_geoip::fetch::{FetchConfig, Outcome, client, refresh};

use super::JobCtx;
use crate::geoip::{GeoIpConfig, LoadedGeoIp};
use crate::obs::Obs;

const JOB: &str = "geoip_db";

fn modified(p: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Opens `path` off the runtime and sends it to the reducer.
async fn load(ctx: &JobCtx, path: PathBuf) -> bool {
    match tokio::task::spawn_blocking(move || LoadedGeoIp::open(&path)).await {
        Ok(Ok(g)) => ctx.send(Obs::GeoIp(g)).await,
        Ok(Err(e)) => {
            ctx.fail(JOB, &e);
            true
        }
        Err(e) => {
            ctx.fail(JOB, &e);
            true
        }
    }
}

pub async fn run(ctx: JobCtx, cfg: GeoIpConfig) {
    let Some(db_path) = cfg.db_path.clone() else {
        return;
    };
    if let Some(dir) = &cfg.auto_dir {
        let d = dir.clone();
        let _ = tokio::task::spawn_blocking(move || atlas_geoip::install::cleanup(&d)).await;
    }
    if !ctx.sleep(cfg.first_check).await {
        return;
    }
    let http = match cfg.auto_dir.as_ref().map(|_| {
        client(&format!(
            "flux-atlas/{} (+https://github.com/Sikbik/Flux_Atlas)",
            env!("CARGO_PKG_VERSION")
        ))
    }) {
        Some(Ok(c)) => Some(c),
        Some(Err(e)) => {
            ctx.fail(JOB, &e);
            None
        }
        None => None,
    };
    let mut seen_mtime = modified(&db_path);
    loop {
        if let (Some(dir), Some(http)) = (&cfg.auto_dir, &http) {
            let fc = FetchConfig::new(dir.clone());
            match refresh(http, &fc, now_ms()).await {
                Ok(Outcome::Installed(i)) => {
                    tracing::info!(
                        month = %i.state.month,
                        bytes = i.state.bytes,
                        path = %i.path.display(),
                        "geoip: DB-IP City Lite installed"
                    );
                    seen_mtime = modified(&db_path);
                    if !load(&ctx, db_path.clone()).await {
                        return;
                    }
                    ctx.ok(JOB);
                }
                Ok(Outcome::UpToDate { month }) => {
                    tracing::debug!(%month, "geoip: database up to date");
                    ctx.ok(JOB);
                }
                Ok(Outcome::NotPublished) => {
                    ctx.fail(
                        JOB,
                        &"no DB-IP City Lite file published for this or last month",
                    );
                }
                Err(e) => {
                    tracing::warn!(error = %e, "geoip: update failed; keeping the current database");
                    ctx.fail(JOB, &e);
                }
            }
        } else {
            // Operator-managed file: reload when it is replaced.
            let m = modified(&db_path);
            if m.is_some() && m != seen_mtime {
                seen_mtime = m;
                tracing::info!(path = %db_path.display(), "geoip: database file changed; reloading");
                if !load(&ctx, db_path.clone()).await {
                    return;
                }
            }
            if m.is_some() {
                ctx.ok(JOB);
            }
        }
        ctx.next(JOB, cfg.check_interval);
        if !ctx
            .sleep(cfg.check_interval + Duration::from_millis(super::jitter_ms(60_000)))
            .await
        {
            return;
        }
    }
}

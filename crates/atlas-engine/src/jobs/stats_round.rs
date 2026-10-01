//! T3 StatsRound (stats.runonflux.io `fluxinfo`, fetched when `roundTime` changes) and
//! GeoResolve (`fluxlocation/<ip>` right away for new or changed IPs, 7-day cache).

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::time::Duration;

use atlas_core::node::GeoSource;
use atlas_core::now_ms;
use tokio::sync::mpsc;

use super::JobCtx;
use crate::derive::round::RoundNode;
use crate::obs::Obs;
use crate::stats::Upstream;

/// Fields the engine reads from a round (Mongo-style projection; about a third of the full
/// payload).
pub const ROUND_PROJECTION: &[&str] = &[
    "ip",
    "tier",
    "collateralHash",
    "collateralIndex",
    "roundTime",
    "dataCollectedAt",
    "error",
    "geolocation",
    "benchmark.bench",
    "benchmark.status",
    "benchmark.info.version",
    "flux.version",
    "flux.arcaneVersion",
    "flux.arcaneHumanVersion",
    "flux.upnp",
    "flux.staticIp",
    "flux.os",
    "flux.osVersion",
    "flux.osPrettyName",
    "flux.zelid",
    "flux.numberOfConnectionsOut",
    "flux.numberOfConnectionsIn",
    "daemon.info.version",
    "apps.resources",
];

pub async fn run(ctx: JobCtx) {
    let iv = ctx.cfg.round_check_interval;
    let mut last_round: Option<u64> = None;
    if !ctx.sleep(Duration::from_secs(8)).await {
        return;
    }
    loop {
        match ctx
            .call(
                Upstream::Stats,
                "fluxinfo?projection=roundTime",
                ctx.clients.stats.fluxinfo_round(),
            )
            .await
        {
            Ok(Some(round)) if last_round != Some(round) => {
                match ctx
                    .call(
                        Upstream::Stats,
                        "fluxinfo?projection=round",
                        ctx.clients.stats.fluxinfo(Some(ROUND_PROJECTION)),
                    )
                    .await
                {
                    Ok(rows) => {
                        let nodes: Vec<RoundNode> =
                            rows.iter().filter_map(RoundNode::from_row).collect();
                        drop(rows);
                        last_round = Some(round);
                        if !ctx
                            .send(Obs::StatsRound {
                                round_ms: round,
                                rows: nodes,
                            })
                            .await
                        {
                            return;
                        }
                        ctx.ok("stats_round");
                    }
                    Err(e) => ctx.fail("stats_round", &e),
                }
            }
            Ok(_) => {}
            Err(e) => ctx.fail("stats_round", &e),
        }
        ctx.next("stats_round", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

const GEO_TTL_MS: u64 = 7 * 86_400_000;
const GEO_NEGATIVE_TTL_MS: u64 = 6 * 3_600_000;

/// GeoResolve: priority lookups for new/changed IPs, background fill for unlocated ones.
pub async fn geo(ctx: JobCtx, mut rx: mpsc::Receiver<(IpAddr, bool)>) {
    let mut priority: VecDeque<IpAddr> = VecDeque::new();
    let mut background: VecDeque<IpAddr> = VecDeque::new();
    let mut queued: HashSet<IpAddr> = HashSet::new();
    let mut negative: HashMap<IpAddr, u64> = HashMap::new();
    let bg_iv = ctx.cfg.geo_background_interval;
    let mut last_bg = tokio::time::Instant::now();
    loop {
        // Take everything queued.
        loop {
            match rx.try_recv() {
                Ok((ip, prio)) => {
                    if prio {
                        if !priority.contains(&ip) {
                            priority.push_back(ip);
                        }
                    } else if queued.insert(ip) {
                        background.push_back(ip);
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => return,
            }
        }
        let next = if let Some(ip) = priority.pop_front() {
            Some((ip, true))
        } else if last_bg.elapsed() >= bg_iv
            && let Some(ip) = background.pop_front()
        {
            queued.remove(&ip);
            last_bg = tokio::time::Instant::now();
            Some((ip, false))
        } else {
            None
        };
        let Some((ip, prio)) = next else {
            let mut shutdown = ctx.shutdown.clone();
            tokio::select! {
                m = rx.recv() => {
                    let Some((ip, prio)) = m else { return };
                    if prio {
                        priority.push_back(ip);
                    } else if queued.insert(ip) {
                        background.push_back(ip);
                    }
                }
                () = tokio::time::sleep(Duration::from_millis(250)) => {}
                () = super::stopped(&mut shutdown) => return,
            }
            continue;
        };
        let now = now_ms();
        // Background entries that got located meanwhile (stats round) are skipped.
        if !prio {
            let p = ctx.handle.published();
            let located = p
                .nodes
                .iter()
                .filter(|r| r.endpoint.is_some_and(|e| e.ip == ip))
                .all(|r| {
                    r.geo
                        .as_ref()
                        .is_some_and(atlas_core::node::Geo::has_coords)
                });
            if located {
                continue;
            }
        }
        if let Some(Some((g, fetched))) = ctx.store_read(move |s| s.geo(ip)).await
            && now.saturating_sub(fetched) < GEO_TTL_MS
            && g.has_coords()
        {
            if !ctx
                .send(Obs::Geo {
                    ip,
                    geo: Box::new(g),
                    fetched_ms: fetched,
                    cached: true,
                })
                .await
            {
                return;
            }
            continue;
        }
        if negative
            .get(&ip)
            .is_some_and(|t| now.saturating_sub(*t) < GEO_NEGATIVE_TTL_MS)
        {
            continue;
        }
        match ctx
            .call(
                Upstream::Stats,
                "fluxlocation",
                ctx.clients.stats.fluxlocation(ip),
            )
            .await
        {
            Ok(loc) => match loc.to_geo(GeoSource::StatsLookup) {
                Some(g) if g.has_coords() => {
                    if !ctx
                        .send(Obs::Geo {
                            ip,
                            geo: Box::new(g),
                            fetched_ms: now,
                            cached: false,
                        })
                        .await
                    {
                        return;
                    }
                    ctx.ok("geo_resolve");
                }
                _ => {
                    negative.insert(ip, now);
                }
            },
            Err(e) => {
                negative.insert(ip, now);
                ctx.fail("geo_resolve", &e);
            }
        }
        if negative.len() > 20_000 {
            negative.retain(|_, t| now.saturating_sub(*t) < GEO_NEGATIVE_TTL_MS);
        }
    }
}

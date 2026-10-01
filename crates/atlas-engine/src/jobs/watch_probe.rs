//! T3 WatchProbe: direct `/flux/version` probes of watched hosts (union of every client's
//! watchlist) every 60 s, through the SSRF guard. Gives near-real-time offline detection for
//! the nodes people are looking at.

use std::collections::BTreeMap;
use std::net::IpAddr;
use std::time::Duration;

use atlas_flux::GuardedEndpoint;

use super::JobCtx;
use crate::obs::Obs;
use crate::stats::Upstream;

pub async fn run(ctx: JobCtx) {
    let iv = ctx.cfg.watch_probe_interval;
    let mut watch = ctx.watch.clone();
    loop {
        let hosts: BTreeMap<IpAddr, GuardedEndpoint> = {
            let w = watch.borrow_and_update().clone();
            let p = ctx.handle.published();
            let mut m = BTreeMap::new();
            for r in p.nodes.iter().filter(|r| w.nodes.contains(&r.id)) {
                if let Some(ep) = r.endpoint
                    && !m.contains_key(&ep.ip)
                    && let Ok(g) = GuardedEndpoint::new(ep)
                {
                    m.insert(ep.ip, g);
                }
            }
            m
        };
        for (ip, g) in hosts.into_iter().take(256) {
            let ok = ctx
                .call(
                    Upstream::Node,
                    "flux/version",
                    ctx.clients.node_api.version(&g),
                )
                .await
                .is_ok();
            if !ctx.send(Obs::Probe { ip, ok }).await {
                return;
            }
        }
        ctx.next("watch_probe", iv);
        // Re-probe on the interval, or right away when the watch set changes.
        let mut shutdown = ctx.shutdown.clone();
        tokio::select! {
            () = tokio::time::sleep(iv) => {}
            r = watch.changed() => {
                if r.is_err() {
                    return;
                }
                if !ctx.sleep(Duration::from_millis(500)).await {
                    return;
                }
            }
            () = super::stopped(&mut shutdown) => return,
        }
    }
}

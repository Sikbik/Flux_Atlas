//! T3 TopologySweep: one `/flux/topology` call about every 12 s on a rotating reachable node
//! (through the SSRF guard). Each call returns the peer lists about 60 reporters sent to that
//! node and streams out as one mesh delta, so the whole overlay refreshes about every 30 min
//! without a batch.

use std::collections::HashMap;
use std::time::Duration;

use atlas_core::{NodeEndpoint, NodeStatus, now_ms};
use atlas_flux::GuardedEndpoint;

use super::JobCtx;
use crate::obs::{Obs, TopologyReport};
use crate::stats::Upstream;

/// A reporter covered by a call within this window is not queried directly.
const COVERED_MS: u64 = 25 * 60_000;
/// A queried node is not queried again within this window.
const RETRY_MS: u64 = 30 * 60_000;
/// A failing node is skipped this long.
const FAILED_MS: u64 = 2 * 3_600_000;

pub async fn run(ctx: JobCtx) {
    let iv = ctx.cfg.topology_interval;
    let mut covered: HashMap<NodeEndpoint, u64> = HashMap::new();
    let mut tried: HashMap<NodeEndpoint, u64> = HashMap::new();
    let mut failed: HashMap<NodeEndpoint, u64> = HashMap::new();
    let mut cursor = super::jitter_ms(10_000) as usize;
    if !ctx.sleep(Duration::from_secs(30)).await {
        return;
    }
    loop {
        let now = now_ms();
        let pick = {
            let p = ctx.handle.published();
            let n = p.nodes.len();
            let mut pick = None;
            for i in 0..n {
                let r = &p.nodes[(cursor + i) % n];
                if r.status != NodeStatus::Confirmed || r.reachable == Some(false) {
                    continue;
                }
                let Some(ep) = r.endpoint else { continue };
                let recent = |m: &HashMap<NodeEndpoint, u64>, w: u64| {
                    m.get(&ep).is_some_and(|t| now.saturating_sub(*t) < w)
                };
                if recent(&covered, COVERED_MS)
                    || recent(&tried, RETRY_MS)
                    || recent(&failed, FAILED_MS)
                {
                    continue;
                }
                let Ok(g) = GuardedEndpoint::new(ep) else {
                    failed.insert(ep, now + 30 * 86_400_000);
                    continue;
                };
                cursor = (cursor + i + 1) % n.max(1);
                pick = Some(g);
                break;
            }
            pick
        };
        if let Some(g) = pick {
            let ep = g.endpoint();
            tried.insert(ep, now);
            match ctx
                .call(
                    Upstream::Node,
                    "flux/topology",
                    ctx.clients.node_api.topology(&g),
                )
                .await
            {
                Ok(t) => {
                    let mut reports = Vec::with_capacity(t.topology.len());
                    for (rep, e) in &t.topology {
                        let Ok(Some(r)) = NodeEndpoint::parse_opt(rep) else {
                            continue;
                        };
                        covered.insert(r, now);
                        let parse = |v: &[String]| {
                            v.iter()
                                .filter_map(|s| NodeEndpoint::parse_opt(s).ok().flatten())
                                .collect::<Vec<_>>()
                        };
                        reports.push(TopologyReport {
                            reporter: r,
                            outbound: parse(&e.outbound),
                            inbound: parse(&e.inbound),
                        });
                    }
                    if !ctx
                        .send(Obs::Topology {
                            queried: ep,
                            reports,
                        })
                        .await
                    {
                        return;
                    }
                    ctx.ok("topology_sweep");
                }
                Err(e) => {
                    failed.insert(ep, now);
                    ctx.fail("topology_sweep", &e);
                }
            }
        }
        // Bound the bookkeeping.
        if covered.len() + tried.len() + failed.len() > 60_000 {
            covered.retain(|_, t| now.saturating_sub(*t) < COVERED_MS);
            tried.retain(|_, t| now.saturating_sub(*t) < RETRY_MS);
            failed.retain(|_, t| *t > now || now.saturating_sub(*t) < FAILED_MS);
        }
        ctx.next("topology_sweep", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

//! T3 TopologySweep: one `/flux/topology` call about every 12 s on a rotating reachable node
//! (through the SSRF guard). Each call returns the peer lists about 60 reporters sent to that
//! node and streams out as one mesh delta, so the whole overlay refreshes about every 30 min
//! without a batch. A reply over the caps of [`plausible_reports`] is dropped whole and its
//! host skipped like a failing one; a host whose last call the mesh outlier rule discarded is
//! skipped for [`crate::OUTLIER_HOST_SKIP_MS`] (every port of it), so its calls go to other
//! hosts.

use std::collections::HashMap;
use std::time::Duration;

use atlas_core::{NodeEndpoint, NodeStatus, now_ms};
use atlas_flux::GuardedEndpoint;
use atlas_flux::models::node_api::Topology;

use super::JobCtx;
use crate::obs::{Obs, TopologyReport};
use crate::stats::Upstream;

/// A reporter covered by a call within this window is not queried directly.
const COVERED_MS: u64 = 25 * 60_000;
/// A queried node is not queried again within this window.
const RETRY_MS: u64 = 30 * 60_000;
/// A failing node is skipped this long.
const FAILED_MS: u64 = 2 * 3_600_000;
/// Most reporters one reply may name (FluxOS caps its own list; the most seen is 95).
pub const MAX_REPORTERS: usize = 128;
/// Most peers (outbound plus inbound) one reporter may list (the most seen is 62).
pub const MAX_PEERS: usize = 200;

/// Why a reply was not trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Implausible {
    TooManyReporters(usize),
    TooManyPeers { reporter: String, peers: usize },
}

/// The reports of one `/flux/topology` reply, if it is plausible. A reply naming more than
/// [`MAX_REPORTERS`] reporters, or with any reporter listing more than [`MAX_PEERS`] peers, is
/// dropped whole: a queried node could otherwise forge about 190,000 links in one reply, or claim
/// every node as covered. Reporters that list no peer are left out (they would only count as
/// omissions of real links). So one reply carries at most 25,600 links and covers at most
/// 128 reporters.
pub fn plausible_reports(t: &Topology) -> Result<Vec<TopologyReport>, Implausible> {
    if t.topology.len() > MAX_REPORTERS {
        return Err(Implausible::TooManyReporters(t.topology.len()));
    }
    if let Some((r, e)) = t
        .topology
        .iter()
        .find(|(_, e)| e.outbound.len() + e.inbound.len() > MAX_PEERS)
    {
        return Err(Implausible::TooManyPeers {
            reporter: r.chars().take(64).collect(),
            peers: e.outbound.len() + e.inbound.len(),
        });
    }
    let parse = |v: &[String]| {
        v.iter()
            .filter_map(|s| NodeEndpoint::parse_opt(s).ok().flatten())
            .collect::<Vec<_>>()
    };
    Ok(t.topology
        .iter()
        .filter_map(|(rep, e)| {
            let reporter = NodeEndpoint::parse_opt(rep).ok().flatten()?;
            let (outbound, inbound) = (parse(&e.outbound), parse(&e.inbound));
            (!outbound.is_empty() || !inbound.is_empty()).then_some(TopologyReport {
                reporter,
                outbound,
                inbound,
            })
        })
        .collect())
}

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
                    || ctx.handle.topology_host_skipped(&ep.ip, now)
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
                Ok(t) => match plausible_reports(&t) {
                    Err(why) => {
                        tracing::warn!(host = %ep, ?why, "topology reply dropped as implausible");
                        failed.insert(ep, now);
                        ctx.handle.note_topology_host(ep.ip, true, now);
                    }
                    Ok(reports) => {
                        for r in &reports {
                            covered.insert(r.reporter, now);
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
                },
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(i: usize) -> String {
        format!("8.{}.{}.{}:16127", (i >> 16) & 255, (i >> 8) & 255, i & 255)
    }

    fn reply(reporters: usize, peers: usize) -> Topology {
        let mut topology = serde_json::Map::new();
        for r in 0..reporters {
            let list: Vec<String> = (0..peers).map(|p| ip(100_000 + r * 1_000 + p)).collect();
            topology.insert(
                ip(r),
                serde_json::json!({ "outbound": list, "inbound": [] }),
            );
        }
        serde_json::from_value(serde_json::json!({
            "reporters": reporters,
            "knownPeers": reporters * peers,
            "topology": topology,
        }))
        .unwrap()
    }

    #[test]
    fn forged_topology_replies_are_dropped_whole() {
        // A normal reply: 60 reporters with 45 peers each.
        let ok = plausible_reports(&reply(60, 45)).unwrap();
        assert_eq!(ok.len(), 60);
        assert_eq!(ok[0].outbound.len(), 45);
        // One reporter listing 190,000 forged peers (the X1 review's forged reply).
        assert!(matches!(
            plausible_reports(&reply(1, 190_000)),
            Err(Implausible::TooManyPeers { peers: 190_000, .. })
        ));
        // Every node named as a reporter, to mark the whole network covered.
        assert_eq!(
            plausible_reports(&reply(6_700, 1)).unwrap_err(),
            Implausible::TooManyReporters(6_700)
        );
        // At the caps the reply passes here, bounded to 25,600 links; the mesh screen then
        // discards any call adding more than 10,000.
        let max = plausible_reports(&reply(MAX_REPORTERS, MAX_PEERS)).unwrap();
        let links: usize = max.iter().map(|r| r.outbound.len() + r.inbound.len()).sum();
        assert_eq!(links, MAX_REPORTERS * MAX_PEERS);
        // Reporters with empty lists are left out: they could only count as omissions.
        let mut t = reply(3, 2);
        if let Some(e) = t.topology.values_mut().next() {
            e.outbound.clear();
        }
        assert_eq!(plausible_reports(&t).unwrap().len(), 2);
    }
}

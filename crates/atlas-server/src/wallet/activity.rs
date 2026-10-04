//! The wallet's activity feed: the newest node events of its fleet that a person would read
//! (starts, confirms, payments, expiries, DOS, reachability, benchmark and version changes),
//! from the per-node event index. Periodic confirms, peer links and geo updates are left out.

use atlas_core::NodeId;
use atlas_core::api::WalletActivity;
use atlas_core::event::{Event, EventEnvelope, RemovalReason};
use atlas_store::{Order, Store};

use crate::error::ApiError;

/// Rows of the feed.
pub const MAX_ACTIVITY: usize = 200;
/// Events read per node: enough that the newest [`MAX_ACTIVITY`] of the whole fleet are among
/// them (a node logs about 8 events a day, most of them periodic confirms), bounded so a
/// fleet of thousands stays a few tens of milliseconds.
fn per_node_limit(nodes: usize) -> usize {
    (4_000 / nodes.max(1)).clamp(16, 400)
}

fn reason_text(r: RemovalReason) -> &'static str {
    match r {
        RemovalReason::Expired => "missed its confirmation window",
        RemovalReason::CollateralSpent => "its collateral was spent",
        RemovalReason::Missing => "it dropped out of the node list",
        RemovalReason::Dos => "it went to the DOS list",
    }
}

/// The feed row of one event, when it is one a person would read.
pub fn activity_row(key: &str, env: &EventEnvelope) -> Option<WalletActivity> {
    let t_ms = env.event_ms.unwrap_or(env.observed_ms);
    let row = |kind: &str, height: Option<u32>, detail: String| WalletActivity {
        t_ms,
        kind: kind.to_owned(),
        node_key: Some(key.to_owned()),
        height,
        detail,
    };
    Some(match &env.event {
        Event::NodeStarted {
            height, tx_version, ..
        } => row(
            "started",
            Some(*height),
            format!("Start transaction mined (version {tx_version})"),
        ),
        Event::NodeConfirmed { height, .. } => row(
            "confirmed",
            Some(*height),
            "Confirmed: joined the payment queue".to_owned(),
        ),
        Event::NodePaid {
            tier,
            amount,
            height,
            ..
        } => row(
            "paid",
            Some(*height),
            format!("Paid {amount} FLUX ({tier})"),
        ),
        Event::NodeIpChanged { old, new, .. } => row(
            "ip_changed",
            None,
            format!(
                "Endpoint changed from {} to {}",
                old.map_or_else(|| "none".to_owned(), |e| e.to_string()),
                new.map_or_else(|| "none".to_owned(), |e| e.to_string())
            ),
        ),
        Event::NodeAtRisk {
            blocks_since_confirm,
            ..
        } => row(
            "at_risk",
            None,
            format!("{blocks_since_confirm} blocks without a confirmation"),
        ),
        Event::NodeExpired { predicted, .. } => row(
            "expired",
            None,
            if *predicted {
                "Expired: no confirmation within 640 blocks".to_owned()
            } else {
                "Expired".to_owned()
            },
        ),
        Event::NodeRemoved { reason, .. } => row(
            "left",
            None,
            format!("Left the node list: {}", reason_text(*reason)),
        ),
        Event::NodeDosed { height, .. } => row(
            "dos",
            Some(*height),
            "Moved to the DOS list: not confirmed in time".to_owned(),
        ),
        Event::NodeCollateralSpent { height, .. } => row(
            "collateral_spent",
            Some(*height),
            "Collateral spent".to_owned(),
        ),
        Event::NodeUnreachable { .. } => row(
            "unreachable",
            None,
            "The node's API stopped answering".to_owned(),
        ),
        Event::NodeRecovered { .. } => {
            row("recovered", None, "The node's API answers again".to_owned())
        }
        Event::NodeStatusChanged { from, to, .. } => row(
            "status",
            None,
            format!("Status {} to {}", status_text(*from), status_text(*to)),
        ),
        Event::NodeHardwareChanged { hardware, .. } => row(
            "benchmark",
            None,
            format!(
                "Benchmark {}: {} EPS, {} MB/s disk write, {}/{} Mb/s",
                match hardware.bench_status {
                    atlas_core::node::BenchStatus::Passed =>
                        format!("passed ({})", hardware.bench_tier),
                    atlas_core::node::BenchStatus::Failed => "failed".to_owned(),
                    atlas_core::node::BenchStatus::Running => "running".to_owned(),
                    atlas_core::node::BenchStatus::Unknown => "updated".to_owned(),
                },
                hardware.eps.round(),
                hardware.disk_write_mbs.round(),
                hardware.down_mbps.round(),
                hardware.up_mbps.round()
            ),
        ),
        Event::NodeVersionChanged { versions, .. } => row(
            "version",
            None,
            format!(
                "Now running FluxOS {}, fluxbench {}",
                versions.flux_os.as_deref().unwrap_or("unknown"),
                versions.bench.as_deref().unwrap_or("unknown")
            ),
        ),
        Event::NodeAppsChanged { apps, .. } => row(
            "apps",
            None,
            match apps.len() {
                0 => "No apps running".to_owned(),
                1 => "1 app running".to_owned(),
                n => format!("{n} apps running"),
            },
        ),
        _ => return None,
    })
}

fn status_text(s: atlas_core::NodeStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

/// The newest [`MAX_ACTIVITY`] feed rows of `nodes` (`(id, node key)`), newest first.
pub fn read(st: &Store, nodes: &[(NodeId, String)]) -> Result<Vec<WalletActivity>, ApiError> {
    let limit = per_node_limit(nodes.len());
    let mut out: Vec<WalletActivity> = Vec::new();
    for (id, key) in nodes {
        for (_, env) in st.node_events(*id, .., Order::Desc, limit)? {
            if let Some(r) = activity_row(key, &env) {
                out.push(r);
            }
        }
    }
    out.sort_by(|a, b| {
        b.t_ms
            .cmp(&a.t_ms)
            .then_with(|| a.node_key.cmp(&b.node_key))
            .then_with(|| a.kind.cmp(&b.kind))
    });
    out.truncate(MAX_ACTIVITY);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use atlas_core::{Amount, Hash32, Tier};

    use super::*;

    fn env(ms: u64, event: Event) -> EventEnvelope {
        EventEnvelope {
            seq: 1,
            observed_ms: ms,
            event_ms: None,
            event,
        }
    }

    #[test]
    fn rows_keep_what_people_read() {
        let paid = env(
            5,
            Event::NodePaid {
                node: Some(NodeId(1)),
                tier: Tier::Stratus,
                address: "t3x".into(),
                amount: Amount::from_flux(9),
                height: 100,
            },
        );
        let r = activity_row("k:0", &paid).unwrap();
        assert_eq!(r.kind, "paid");
        assert_eq!(r.height, Some(100));
        assert_eq!(r.detail, "Paid 9.00000000 FLUX (stratus)");
        assert_eq!(r.node_key.as_deref(), Some("k:0"));
        assert_eq!(r.t_ms, 5);
        let hb = env(
            6,
            Event::NodeHeartbeat {
                node: NodeId(1),
                height: 1,
                txid: Hash32::default(),
                endpoint: None,
                benchmark_tier: None,
            },
        );
        assert!(
            activity_row("k:0", &hb).is_none(),
            "periodic confirms are noise"
        );
        let st = env(
            7,
            Event::NodeStatusChanged {
                node: NodeId(1),
                from: atlas_core::NodeStatus::Confirmed,
                to: atlas_core::NodeStatus::Expired,
            },
        );
        assert_eq!(
            activity_row("k:0", &st).unwrap().detail,
            "Status confirmed to expired"
        );
        assert_eq!(per_node_limit(1), 400);
        assert_eq!(per_node_limit(208), 19);
        assert_eq!(per_node_limit(5_000), 16);
    }
}

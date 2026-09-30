//! Maps stored domain events onto feed items (node detail and history) and onto node status
//! transitions (history segments).

use std::collections::BTreeMap;

use atlas_core::event::{Event, EventEnvelope, RemovalReason};
use atlas_core::live::{FeedItem, FeedKind, FeedRef};
use atlas_core::node::NodeStatus;

fn text_key(kind: FeedKind) -> String {
    let v = serde_json::to_value(kind).unwrap_or_default();
    format!("feed.{}", v.as_str().unwrap_or("unknown"))
}

fn item(kind: FeedKind, ts_ms: u64, refs: Vec<FeedRef>, params: &[(&str, String)]) -> FeedItem {
    FeedItem {
        kind,
        ts_ms,
        text_key: text_key(kind),
        refs,
        params: params
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect::<BTreeMap<_, _>>(),
    }
}

fn reason_str(r: RemovalReason) -> &'static str {
    match r {
        RemovalReason::Expired => "expired",
        RemovalReason::CollateralSpent => "collateral_spent",
        RemovalReason::Missing => "missing",
        RemovalReason::Dos => "dos",
    }
}

/// Feed item for a node-scoped event, when it is something a person would want to read.
pub fn node_feed_item(env: &EventEnvelope) -> Option<FeedItem> {
    let ts = env.event_ms.unwrap_or(env.observed_ms);
    let node = |id| FeedRef::Node { id };
    Some(match &env.event {
        Event::NodeConfirmed {
            node: id,
            height,
            txid,
        } => item(
            FeedKind::NodeJoined,
            ts,
            vec![
                node(*id),
                FeedRef::Block { height: *height },
                FeedRef::Tx { txid: *txid },
            ],
            &[("height", height.to_string())],
        ),
        Event::NodeStarted {
            node: id,
            height,
            txid,
            tx_version,
            ..
        } => item(
            FeedKind::NodeStarted,
            ts,
            vec![
                node(*id),
                FeedRef::Block { height: *height },
                FeedRef::Tx { txid: *txid },
            ],
            &[
                ("height", height.to_string()),
                ("tx_version", tx_version.to_string()),
            ],
        ),
        Event::NodeHeartbeat {
            node: id,
            height,
            txid,
            ..
        } => item(
            FeedKind::NodeHeartbeat,
            ts,
            vec![
                node(*id),
                FeedRef::Block { height: *height },
                FeedRef::Tx { txid: *txid },
            ],
            &[("height", height.to_string())],
        ),
        Event::NodePaid {
            node: Some(id),
            tier,
            amount,
            height,
            address,
        } => item(
            FeedKind::NodePaid,
            ts,
            vec![
                node(*id),
                FeedRef::Block { height: *height },
                FeedRef::Address {
                    address: address.to_string(),
                },
            ],
            &[
                ("amount", amount.to_string()),
                ("tier", tier.to_string()),
                ("height", height.to_string()),
            ],
        ),
        Event::NodeIpChanged {
            node: id, old, new, ..
        } => item(
            FeedKind::NodeIpChanged,
            ts,
            vec![node(*id)],
            &[
                ("old", old.map(|e| e.to_string()).unwrap_or_default()),
                ("new", new.map(|e| e.to_string()).unwrap_or_default()),
            ],
        ),
        Event::NodeAtRisk {
            node: id,
            blocks_since_confirm,
        } => item(
            FeedKind::NodeAtRisk,
            ts,
            vec![node(*id)],
            &[("blocks", blocks_since_confirm.to_string())],
        ),
        Event::NodeExpired {
            node: id,
            predicted,
        } => item(
            FeedKind::NodeExpired,
            ts,
            vec![node(*id)],
            &[("predicted", predicted.to_string())],
        ),
        Event::NodeRemoved { node: id, reason } => item(
            FeedKind::NodeLeft,
            ts,
            vec![node(*id)],
            &[("reason", reason_str(*reason).to_owned())],
        ),
        Event::NodeDosed { node: id, height } => item(
            FeedKind::NodeDosed,
            ts,
            vec![node(*id), FeedRef::Block { height: *height }],
            &[("height", height.to_string())],
        ),
        Event::NodeCollateralSpent {
            node: id,
            txid,
            height,
        } => item(
            FeedKind::CollateralSpent,
            ts,
            vec![
                node(*id),
                FeedRef::Tx { txid: *txid },
                FeedRef::Block { height: *height },
            ],
            &[("height", height.to_string())],
        ),
        Event::NodeUnreachable { node: id } => {
            item(FeedKind::NodeUnreachable, ts, vec![node(*id)], &[])
        }
        Event::NodeRecovered { node: id } => {
            item(FeedKind::NodeRecovered, ts, vec![node(*id)], &[])
        }
        _ => return None,
    })
}

/// The node status an event implies, for history segments. Reachability events map to
/// `Offline` / `Confirmed`.
pub fn status_after(event: &Event) -> Option<NodeStatus> {
    Some(match event {
        Event::NodeStatusChanged { to, .. } => *to,
        Event::NodeConfirmed { .. } | Event::NodeHeartbeat { .. } | Event::NodeRecovered { .. } => {
            NodeStatus::Confirmed
        }
        Event::NodeStarted { .. } => NodeStatus::Started,
        Event::NodeDosed { .. } => NodeStatus::Dos,
        Event::NodeExpired { .. } => NodeStatus::Expired,
        Event::NodeRemoved { reason, .. } => match reason {
            RemovalReason::Expired => NodeStatus::Expired,
            RemovalReason::Dos => NodeStatus::Dos,
            RemovalReason::CollateralSpent | RemovalReason::Missing => NodeStatus::Departed,
        },
        Event::NodeCollateralSpent { .. } => NodeStatus::Departed,
        Event::NodeUnreachable { .. } => NodeStatus::Offline,
        _ => return None,
    })
}

/// The status a node had before `event`, when the event says so.
pub fn status_before(event: &Event) -> Option<NodeStatus> {
    match event {
        Event::NodeStatusChanged { from, .. } => Some(*from),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use atlas_core::ids::{Hash32, NodeId};

    use super::*;

    #[test]
    fn heartbeat_item() {
        let env = EventEnvelope {
            seq: 1,
            observed_ms: 10,
            event_ms: Some(5),
            event: Event::NodeHeartbeat {
                node: NodeId(3),
                height: 7,
                txid: Hash32([1; 32]),
                endpoint: None,
                benchmark_tier: None,
            },
        };
        let f = node_feed_item(&env).unwrap();
        assert_eq!(f.kind, FeedKind::NodeHeartbeat);
        assert_eq!(f.text_key, "feed.node_heartbeat");
        assert_eq!(f.ts_ms, 5);
        assert_eq!(status_after(&env.event), Some(NodeStatus::Confirmed));
    }
}

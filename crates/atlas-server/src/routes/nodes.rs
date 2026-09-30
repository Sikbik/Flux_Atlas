//! Node views: table, detail, history, payments, peers, and the operator dashboard.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use atlas_core::api::{
    AppRef, NextPayment, NodeDetailDto, NodeHistoryDto, NodePaymentsPage, NodePeersDto, NodeSort,
    NodesPage, NodesQuery, OperatorDto, PaymentRow, PeerDirection, PeerDto, StatusSegment,
    TierCounts,
};
use atlas_core::codec::mesh_bin::{decode_mesh_bin, flags as mesh_flags};
use atlas_core::node::NodeStatus;
use atlas_core::{Amount, NodeId, NodeRecord, now_ms};
use atlas_store::{EventKey, Order};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{cache, json_response};
use crate::error::{ApiError, ApiResult};
use crate::extract::{P, Q, check_param, offset_cursor, page_limit};
use crate::state::AppState;
use crate::views::feed::{node_feed_item, status_after, status_before};
use crate::views::{Adjacency, BLOCK_MS, Views, node_dto, node_row};

const DAY_MS: u64 = 86_400_000;
const BLOCKS_PER_DAY: u32 = 2880;

// ---------------------------------------------------------------------------------------------
// GET /nodes
// ---------------------------------------------------------------------------------------------

enum OrgFilter {
    Asn(u32),
    Name(String),
}

fn parse_org(s: &str) -> OrgFilter {
    let t = s.trim();
    let digits = t
        .strip_prefix("AS")
        .or_else(|| t.strip_prefix("as"))
        .unwrap_or(t);
    match digits.parse::<u32>() {
        Ok(n) if !digits.is_empty() => OrgFilter::Asn(n),
        _ => OrgFilter::Name(t.to_ascii_lowercase()),
    }
}

fn matches_org(n: &NodeRecord, f: &OrgFilter) -> bool {
    let Some(g) = n.geo.as_ref() else {
        return false;
    };
    match f {
        OrgFilter::Asn(a) => g.asn == Some(*a),
        OrgFilter::Name(name) => g.org.trim().eq_ignore_ascii_case(name),
    }
}

fn matches_text(n: &NodeRecord, needle: &str) -> bool {
    if let Some(ep) = n.endpoint
        && ep.to_string().contains(needle)
    {
        return true;
    }
    if n.payment_address.to_ascii_lowercase().starts_with(needle) {
        return true;
    }
    if n.outpoint.txid.has_hex_prefix(needle) {
        return true;
    }
    if n.zelid
        .as_ref()
        .is_some_and(|z| z.to_ascii_lowercase().starts_with(needle))
    {
        return true;
    }
    n.geo.as_ref().is_some_and(|g| {
        g.org.to_ascii_lowercase().contains(needle) || g.city.to_ascii_lowercase() == needle
    })
}

/// None sorts after every value, in either direction.
fn cmp_opt<T: Ord>(a: Option<T>, b: Option<T>, desc: bool) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => {
            if desc {
                y.cmp(&x)
            } else {
                x.cmp(&y)
            }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn geo_str(n: &NodeRecord, f: fn(&atlas_core::node::Geo) -> &str) -> Option<String> {
    n.geo
        .as_ref()
        .map(|g| f(g).to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}

fn compare(a: &NodeRecord, b: &NodeRecord, sort: NodeSort, desc: bool) -> Ordering {
    let primary = match sort {
        NodeSort::Id => cmp_opt(Some(a.id), Some(b.id), desc),
        NodeSort::Rank => cmp_opt(a.rank, b.rank, desc),
        NodeSort::Tier => cmp_opt(Some(a.tier), Some(b.tier), desc),
        NodeSort::Country => cmp_opt(
            geo_str(a, |g| &g.country_code),
            geo_str(b, |g| &g.country_code),
            desc,
        ),
        NodeSort::Org => cmp_opt(geo_str(a, |g| &g.org), geo_str(b, |g| &g.org), desc),
        NodeSort::LastPaid => cmp_opt(a.last_paid_height, b.last_paid_height, desc),
        NodeSort::LastConfirmed => cmp_opt(a.last_confirmed_height, b.last_confirmed_height, desc),
        NodeSort::Added => cmp_opt(Some(a.added_height), Some(b.added_height), desc),
        NodeSort::AppCount => cmp_opt(Some(a.app_count), Some(b.app_count), desc),
    };
    primary.then_with(|| a.id.cmp(&b.id))
}

/// `GET /nodes?tier&status&country&org&q&sort&desc&cursor&limit`.
pub async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<NodesQuery>,
) -> ApiResult<Response> {
    let limit = page_limit(q.limit, 100, 1000)?;
    let offset = offset_cursor(q.cursor.as_deref())? as usize;
    let country = match q.country.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(c) if c.len() == 2 && c.bytes().all(|b| b.is_ascii_alphabetic()) => {
            Some(c.to_ascii_uppercase())
        }
        Some(_) => return Err(ApiError::bad_request("country must be a 2-letter code")),
    };
    let org = match q.org.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(o) if o.len() <= 128 => Some(parse_org(o)),
        Some(_) => return Err(ApiError::bad_request("org is too long")),
    };
    let needle = match q.q.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(t) if t.len() <= 128 => Some(t.to_ascii_lowercase()),
        Some(_) => return Err(ApiError::bad_request("q is too long")),
    };
    let sort = q.sort.unwrap_or_default();
    let desc = q.desc.unwrap_or(false);
    let v = s.views();
    let mut rows: Vec<&NodeRecord> = v
        .nodes()
        .iter()
        .filter(|n| q.tier.is_none_or(|t| n.tier == t))
        .filter(|n| q.status.is_none_or(|st| n.status == st))
        .filter(|n| {
            country.as_deref().is_none_or(|c| {
                n.geo
                    .as_ref()
                    .is_some_and(|g| g.country_code.eq_ignore_ascii_case(c))
            })
        })
        .filter(|n| org.as_ref().is_none_or(|f| matches_org(n, f)))
        .filter(|n| needle.as_deref().is_none_or(|t| matches_text(n, t)))
        .collect();
    rows.sort_by(|a, b| compare(a, b, sort, desc));
    let total = rows.len();
    let items: Vec<_> = rows
        .iter()
        .skip(offset)
        .take(limit as usize)
        .map(|n| node_row(n))
        .collect();
    let end = offset + items.len();
    let page = NodesPage {
        items,
        total: total as u32,
        next_cursor: (end < total).then(|| end.to_string()),
    };
    Ok(json_response(&headers, &page, cache::DERIVED))
}

// ---------------------------------------------------------------------------------------------
// GET /nodes/{key}
// ---------------------------------------------------------------------------------------------

/// `GET /nodes/{id|ip|outpoint}`.
pub async fn detail(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(key): P<String>,
) -> ApiResult<Response> {
    let key = check_param("node", &key)?;
    let v = s.views();
    let n = v.resolve(key)?.clone();
    let id = n.id;
    let hosted = s.hosted_apps().await?;
    let recent = s
        .store_read(move |st| Ok(st.node_events(id, .., Order::Desc, 40)?))
        .await?;
    let co_hosted = n
        .endpoint
        .map(|ep| {
            v.index
                .by_ip(&ep.ip)
                .iter()
                .map(|&i| v.at(i as usize).id)
                .filter(|o| *o != id)
                .collect()
        })
        .unwrap_or_default();
    let dto = NodeDetailDto {
        payment_eta: v.payment_eta(&n),
        expires_in_blocks: if n.status.is_active() {
            v.expires_in(&n)
        } else {
            None
        },
        apps: hosted.get(&id.0).cloned().unwrap_or_default(),
        co_hosted,
        recent_events: recent
            .iter()
            .filter_map(|(_, e)| node_feed_item(e))
            .take(20)
            .collect(),
        node: node_dto(&n),
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

// ---------------------------------------------------------------------------------------------
// GET /nodes/{key}/history
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub from: Option<u64>,
    pub to: Option<u64>,
}

/// Longest history window.
const MAX_HISTORY_MS: u64 = 366 * DAY_MS;

/// Builds status segments over `[start, to]` from status-bearing events (ascending).
pub fn segments(
    start: u64,
    to: u64,
    prior: Option<NodeStatus>,
    events: &[(u64, &atlas_core::event::Event)],
    current: NodeStatus,
) -> Vec<StatusSegment> {
    let status_events: Vec<(u64, NodeStatus, Option<NodeStatus>)> = events
        .iter()
        .filter_map(|(ts, e)| status_after(e).map(|st| (*ts, st, status_before(e))))
        .collect();
    let mut cur = match (prior, status_events.first()) {
        (Some(p), _) => p,
        (None, Some((_, _, Some(before)))) => *before,
        (None, Some(_)) => NodeStatus::Unknown,
        (None, None) => current,
    };
    let mut out: Vec<StatusSegment> = Vec::new();
    let mut t = start;
    let mut push = |from_ms: u64, to_ms: u64, status: NodeStatus| {
        if to_ms <= from_ms {
            return;
        }
        match out.last_mut() {
            Some(last) if last.status == status && last.to_ms == from_ms => last.to_ms = to_ms,
            _ => out.push(StatusSegment {
                from_ms,
                to_ms,
                status,
            }),
        }
    };
    for (ts, st, _) in status_events {
        let ts = ts.clamp(t, to);
        push(t, ts, cur);
        cur = st;
        t = ts;
    }
    push(t, to, cur);
    out
}

/// Share of known time spent confirmed, 0..100.
pub fn uptime_pct(segments: &[StatusSegment]) -> f64 {
    let (mut up, mut known) = (0u64, 0u64);
    for s in segments.iter().filter(|s| s.status != NodeStatus::Unknown) {
        let d = s.to_ms - s.from_ms;
        known += d;
        if s.status == NodeStatus::Confirmed {
            up += d;
        }
    }
    if known == 0 {
        0.0
    } else {
        up as f64 * 100.0 / known as f64
    }
}

/// `GET /nodes/{key}/history?from&to`.
pub async fn history(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(key): P<String>,
    Q(q): Q<HistoryQuery>,
) -> ApiResult<Response> {
    let key = check_param("node", &key)?;
    let now = now_ms();
    let to = q.to.unwrap_or(now).min(now);
    let from = q.from.unwrap_or_else(|| to.saturating_sub(7 * DAY_MS));
    if from >= to {
        return Err(ApiError::bad_request("from must be before to"));
    }
    if to - from > MAX_HISTORY_MS {
        return Err(ApiError::bad_request("window is longer than 366 days"));
    }
    let v = s.views();
    let n = v.resolve(key)?.clone();
    let id = n.id;
    let (window, prior) = s
        .store_read(move |st| {
            let window = st.node_events(
                id,
                EventKey::first_at(from)..=EventKey::last_at(to),
                Order::Asc,
                5000,
            )?;
            let before = st.node_events(id, ..EventKey::first_at(from), Order::Desc, 500)?;
            let prior = before.iter().find_map(|(_, e)| status_after(&e.event));
            Ok((window, prior))
        })
        .await?;
    let start = if n.first_seen_ms > from && prior.is_none() {
        n.first_seen_ms.min(to)
    } else {
        from
    };
    let evs: Vec<(u64, &atlas_core::event::Event)> =
        window.iter().map(|(k, e)| (k.ts_ms, &e.event)).collect();
    let segs = segments(start, to, prior, &evs, n.status);
    let dto = NodeHistoryDto {
        id,
        from_ms: from,
        to_ms: to,
        uptime_pct: uptime_pct(&segs),
        segments: segs,
        events: window
            .iter()
            .rev()
            .filter_map(|(_, e)| node_feed_item(e))
            .take(500)
            .collect(),
    };
    Ok(json_response(&headers, &dto, cache::HISTORY))
}

// ---------------------------------------------------------------------------------------------
// GET /nodes/{key}/payments
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

fn height_cursor(c: Option<&str>) -> Result<Option<u32>, ApiError> {
    match c.map(str::trim).filter(|c| !c.is_empty()) {
        None => Ok(None),
        Some(c) if c.len() <= 9 && c.bytes().all(|b| b.is_ascii_digit()) => c
            .parse()
            .map(Some)
            .map_err(|_| ApiError::bad_request("invalid cursor")),
        Some(_) => Err(ApiError::bad_request("invalid cursor")),
    }
}

/// `GET /nodes/{key}/payments?cursor&limit` (cursor = height; older payments are below it).
pub async fn payments(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(key): P<String>,
    Q(q): Q<PageQuery>,
) -> ApiResult<Response> {
    let key = check_param("node", &key)?;
    let limit = page_limit(q.limit, 50, 200)? as usize;
    let before = height_cursor(q.cursor.as_deref())?;
    let v = s.views();
    let n = v.resolve(key)?.clone();
    let (tip_h, tip_ms) = (v.tip_height(), v.tip_time_ms());
    let id = n.id;
    let page = s
        .store_read(move |st| {
            let mut rows = st.payments_for_node(id, before, limit + 1)?;
            let more = rows.len() > limit;
            rows.truncate(limit);
            let total_paid: Amount = st
                .payments_for_node(id, None, usize::MAX)?
                .iter()
                .map(|(_, a)| *a)
                .sum();
            let mut items = Vec::with_capacity(rows.len());
            for (h, amount) in &rows {
                let block = st.block(*h)?;
                let payout = block
                    .as_ref()
                    .and_then(|b| b.payouts.iter().find(|p| p.node == Some(id)));
                let time_ms = block.as_ref().map_or_else(
                    || match (tip_h, tip_ms) {
                        (Some(th), Some(tm)) => {
                            tm.saturating_sub(u64::from(th.saturating_sub(*h)) * BLOCK_MS)
                        }
                        _ => 0,
                    },
                    |b| b.time_ms,
                );
                items.push(PaymentRow {
                    height: *h,
                    time_ms,
                    amount: *amount,
                    address: payout
                        .map_or_else(|| n.payment_address.to_string(), |p| p.address.to_string()),
                    tier: payout.map_or(n.tier, |p| p.tier),
                });
            }
            Ok(NodePaymentsPage {
                id,
                next_cursor: if more {
                    rows.last().map(|(h, _)| h.to_string())
                } else {
                    None
                },
                items,
                total_paid,
            })
        })
        .await?;
    Ok(json_response(&headers, &page, cache::HISTORY))
}

// ---------------------------------------------------------------------------------------------
// GET /nodes/{key}/peers
// ---------------------------------------------------------------------------------------------

fn adjacency_from_mesh(v: &Views) -> Adjacency {
    let mut adj = Adjacency::default();
    let Some(body) = v.published.bodies.mesh_bin.as_ref() else {
        return adj;
    };
    match decode_mesh_bin(&body.raw) {
        Ok(m) => {
            for i in 0..m.edge_count() {
                let f = m.flags.get(i).copied().unwrap_or(0);
                adj.peers.entry(m.a[i]).or_default().push((m.b[i], f));
                adj.peers.entry(m.b[i]).or_default().push((m.a[i], f));
            }
        }
        Err(e) => tracing::warn!(error = %e, "published mesh.bin does not decode"),
    }
    adj
}

fn peer_dto(v: &Views, peer: u32, flags: u8) -> PeerDto {
    let rec = v.node(NodeId(peer));
    let r = rec.map(crate::views::node_ref);
    PeerDto {
        id: Some(NodeId(peer)),
        endpoint: rec
            .and_then(|n| n.endpoint)
            .map(|e| e.to_string())
            .unwrap_or_default(),
        direction: if flags & mesh_flags::BIDIRECTIONAL != 0 {
            PeerDirection::Both
        } else {
            PeerDirection::Unknown
        },
        lat: r.as_ref().and_then(|r| r.lat),
        lon: r.as_ref().and_then(|r| r.lon),
        country_code: r.and_then(|r| r.country_code),
        latency_ms: None,
    }
}

/// `GET /nodes/{key}/peers`.
pub async fn peers(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(key): P<String>,
) -> ApiResult<Response> {
    let key = check_param("node", &key)?;
    let v = s.views();
    let n = v.resolve(key)?.clone();
    let id = n.id;
    let list: Vec<(u32, u8)> = if v.published.bodies.mesh_bin.is_some() {
        let adj = v
            .mesh
            .get_or_init(|| std::sync::Arc::new(adjacency_from_mesh(&v)));
        adj.peers.get(&id.0).cloned().unwrap_or_default()
    } else {
        s.store_read(move |st| {
            Ok(st
                .mesh_edges()?
                .into_iter()
                .filter_map(|(a, b, r)| {
                    if a == id {
                        Some((b.0, r.flags))
                    } else if b == id {
                        Some((a.0, r.flags))
                    } else {
                        None
                    }
                })
                .collect())
        })
        .await?
    };
    let dto = NodePeersDto {
        id,
        swept_ms: n.last_swept_ms,
        peers: list.iter().map(|&(p, f)| peer_dto(&v, p, f)).collect(),
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

// ---------------------------------------------------------------------------------------------
// GET /operator/{address}
// ---------------------------------------------------------------------------------------------

/// Plausible base58 address or ZelID.
pub fn plausible_address(s: &str) -> bool {
    (25..=36).contains(&s.len()) && s.bytes().all(crate::search::is_base58)
}

/// `GET /operator/{payment address | ZelID}`.
pub async fn operator(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(address): P<String>,
) -> ApiResult<Response> {
    let address = check_param("address", &address)?.to_owned();
    if !plausible_address(&address) {
        return Err(ApiError::bad_request("expected a payment address or ZelID"));
    }
    let v = s.views();
    let positions: BTreeSet<u32> = v
        .index
        .by_address(&address)
        .iter()
        .chain(v.index.by_zelid(&address))
        .copied()
        .collect();
    if positions.is_empty() {
        return Err(ApiError::not_found("no nodes are operated by this address"));
    }
    let nodes: Vec<&NodeRecord> = positions.iter().map(|&i| v.at(i as usize)).collect();
    let mut tiers = TierCounts::default();
    let mut collateral = Amount::ZERO;
    let mut next: Vec<NextPayment> = Vec::new();
    for n in nodes.iter().filter(|n| n.status.is_active()) {
        tiers.add(n.tier);
        collateral += n.tier.collateral().unwrap_or(Amount::ZERO);
        if let Some(eta) = v.payment_eta(n) {
            next.push(NextPayment {
                node: n.id,
                eta_blocks: eta.eta_blocks,
                eta_ms: eta.eta_ms,
                amount: eta.amount,
            });
        }
    }
    next.sort_by_key(|p| (p.eta_blocks, p.node));
    let ids: Vec<NodeId> = nodes.iter().map(|n| n.id).collect();
    let tip = v.tip_height();
    let (earned_24h, earned_30d) = s
        .store_read(move |st| {
            let tip = match tip {
                Some(t) => t,
                None => st.tip_block()?.map_or(0, |b| b.height),
            };
            let (d1, d30) = (
                tip.saturating_sub(BLOCKS_PER_DAY),
                tip.saturating_sub(30 * BLOCKS_PER_DAY),
            );
            let (mut e1, mut e30) = (Amount::ZERO, Amount::ZERO);
            for id in ids {
                for (h, a) in st.payments_for_node(id, None, 400)? {
                    if h <= d30 {
                        break;
                    }
                    e30 += a;
                    if h > d1 {
                        e1 += a;
                    }
                }
            }
            Ok((e1, e30))
        })
        .await?;
    let dto = OperatorDto {
        address,
        nodes: nodes.iter().map(|n| node_row(n)).collect(),
        tiers,
        collateral_locked: collateral,
        earned_24h,
        earned_30d,
        next_payments: next,
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

/// Map from node id to the apps with an instance on it.
pub fn hosted_map(
    apps: &[atlas_core::app::AppRecord],
) -> std::collections::HashMap<u32, Vec<AppRef>> {
    let mut m: std::collections::HashMap<u32, Vec<AppRef>> = std::collections::HashMap::new();
    for a in apps {
        for loc in &a.locations {
            if let Some(n) = loc.node {
                let list = m.entry(n.0).or_default();
                if !list.iter().any(|r| r.name == a.name) {
                    list.push(AppRef {
                        name: a.name.clone(),
                        display_name: a.display_name.clone(),
                    });
                }
            }
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use atlas_core::event::Event;

    use super::*;

    #[test]
    fn segments_and_uptime() {
        let unreach = Event::NodeUnreachable { node: NodeId(1) };
        let back = Event::NodeRecovered { node: NodeId(1) };
        let evs = vec![(100u64, &unreach), (150u64, &back)];
        let s = segments(
            0,
            200,
            Some(NodeStatus::Confirmed),
            &evs,
            NodeStatus::Confirmed,
        );
        assert_eq!(s.len(), 3);
        assert_eq!(s[1].status, NodeStatus::Offline);
        assert!((uptime_pct(&s) - 75.0).abs() < 1e-9);
        // No history at all: the current status for the whole window.
        let s = segments(0, 10, None, &[], NodeStatus::Confirmed);
        assert_eq!(s.len(), 1);
        assert!((uptime_pct(&s) - 100.0).abs() < 1e-9);
        // Unknown prefix is excluded from uptime.
        let s = segments(0, 100, None, &[(50, &back)], NodeStatus::Confirmed);
        assert_eq!(s[0].status, NodeStatus::Unknown);
        assert!((uptime_pct(&s) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn org_filter() {
        assert!(matches!(parse_org("AS24940"), OrgFilter::Asn(24940)));
        assert!(matches!(parse_org("24940"), OrgFilter::Asn(24940)));
        assert!(matches!(parse_org("Hetzner"), OrgFilter::Name(_)));
    }
}

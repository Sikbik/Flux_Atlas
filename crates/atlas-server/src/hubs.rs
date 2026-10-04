//! The network hubs (B13): the operator leaderboard, the nodes overview and the apps overview
//! behind the dock's Nodes and Apps buttons (`routes::hubs` serves them).
//!
//! Everything is computed from memory (the published nodes and apps, the wallet's network
//! figures, the hosted-apps map, the app-message ledger) plus one store scan of the last 7 days
//! of events for the churn, which is kept in a [`Slot`] (rebuilt in the background at most every
//! minute). Each answer is built once per publish ([`HubViews`] on the views) and shared by every
//! request that reads that publish; the arithmetic is kept free of I/O so each rule is tested on
//! its own.

use std::collections::{HashMap, HashSet};
use std::ops::Bound;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use atlas_core::api::BenchMetric;
use atlas_core::api::{
    AppCountryRow, AppDeployDay, AppIndexEntry, AppOwnerRow, AppRef, AppsResources, CapacityDto,
    ChurnSpan, EnterpriseTotals, ExpiringApp, NewestApp, NewestNode, NodeAgeBucket,
    NodeBenchSpread, NodeChurn, NodeStatusCounts, OperatorRow, OperatorTopCountry,
    OperatorTopProvider, OperatorsBy, ResourceSum, TierCounts,
};
use atlas_core::event::{Event, RemovalReason};
use atlas_core::node::windows::{AT_RISK_BLOCKS, expiry_height};
use atlas_core::{Amount, NodeRecord, NodeStatus, Tier};
use atlas_store::{EventKey, Order, Resolution, Store};
use tokio::sync::OnceCell;

use crate::body::CachedBody;
use crate::error::ApiError;
use crate::ledger::{AppLedger, Slot, est_time};
use crate::views::analytics::{ProviderKey, operator_key};
use crate::wallet::compute::{EXPIRY_SOON_BLOCKS, node_key, run_rate};
use crate::wallet::network::WalletNetwork;

pub const DAY_MS: u64 = 86_400_000;
/// Default and largest `limit` of `GET /network/operators`.
pub const OPERATORS_DEFAULT: u32 = 100;
pub const OPERATORS_MAX: u32 = 500;
/// Rows of the short lists.
pub const NEWEST_NODES: usize = 10;
pub const TOP_OWNERS: usize = 25;
pub const NEWEST_APPS: usize = 10;
pub const EXPIRING_APPS: usize = 10;
/// UTC days of the deployments chart.
pub const DEPLOY_DAYS: u32 = 90;
/// Age buckets by `active_since`: label, from days (inclusive), to days (exclusive).
pub const AGE_BUCKETS: [(&str, u32, Option<u32>); 6] = [
    ("<7d", 0, Some(7)),
    ("7-30d", 7, Some(30)),
    ("1-6mo", 30, Some(182)),
    ("6-12mo", 182, Some(365)),
    ("1-2y", 365, Some(730)),
    ("2y+", 730, None),
];
/// Events read per store transaction by the churn scan.
const CHURN_PAGE: usize = 20_000;

// ---------------------------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------------------------

/// The ranked operators of one grouping (every operator, rank order).
#[derive(Debug, Default)]
pub struct OperatorTable {
    pub total_operators: u32,
    pub total_nodes: u32,
    pub rows: Vec<OperatorRow>,
}

/// Hub answers of one publish (a field of [`crate::views::Views`]).
#[derive(Debug, Default)]
pub struct HubViews {
    /// By [`OperatorsBy`] (zelid, address).
    pub(crate) operators: [OnceCell<Arc<OperatorTable>>; 2],
    /// Operator bodies by grouping and `limit` (a few distinct values).
    pub(crate) operator_bodies: Mutex<HashMap<(OperatorsBy, u32), Arc<CachedBody>>>,
    pub(crate) nodes_overview: OnceCell<Arc<CachedBody>>,
    pub(crate) apps_overview: OnceCell<Arc<CachedBody>>,
}

impl HubViews {
    pub(crate) fn table(&self, by: OperatorsBy) -> &OnceCell<Arc<OperatorTable>> {
        match by {
            OperatorsBy::Zelid => &self.operators[0],
            OperatorsBy::Address => &self.operators[1],
        }
    }

    pub(crate) fn operator_body(&self, by: OperatorsBy, limit: u32) -> Option<Arc<CachedBody>> {
        self.operator_bodies
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&(by, limit))
            .cloned()
    }

    pub(crate) fn keep_operator_body(&self, by: OperatorsBy, limit: u32, body: &Arc<CachedBody>) {
        let mut m = self
            .operator_bodies
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if m.len() >= 16 && !m.contains_key(&(by, limit)) {
            m.clear();
        }
        m.insert((by, limit), Arc::clone(body));
    }
}

/// Hub state that outlives a publish (a field of the app state).
#[derive(Default)]
pub struct HubState {
    /// Joins and leaves of the last 24 hours and 7 days.
    pub churn: Arc<Slot<Vec<NodeChurn>>>,
}

impl std::fmt::Debug for HubState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HubState").finish_non_exhaustive()
    }
}

/// How often the churn is recounted, and the oldest count ever served.
pub const CHURN_MIN_AGE: Duration = Duration::from_secs(60);
pub const CHURN_MAX_AGE: Duration = Duration::from_secs(300);

// ---------------------------------------------------------------------------------------------
// Node health (shared by the leaderboard and the nodes overview)
// ---------------------------------------------------------------------------------------------

/// Health of one listed node at `tip`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct NodeHealth {
    pub confirmed: bool,
    /// Confirmed and 560 or more blocks since the last confirmation (the engine's
    /// `node_at_risk` boundary, `windows::AT_RISK_BLOCKS`).
    pub at_risk: bool,
    /// Confirmed and the API did not answer the last crawl.
    pub unreachable: bool,
    pub dos: bool,
    /// Confirmed and fewer than [`EXPIRY_SOON_BLOCKS`] before the confirmation deadline (the
    /// wallet's `expiring_soon`).
    pub expiring_soon: bool,
}

impl NodeHealth {
    pub fn of(n: &NodeRecord, tip: u32) -> Self {
        let confirmed = n.status.is_active();
        let last = n.last_confirmed_height.or(n.confirmed_height);
        let since = last.map(|h| tip.saturating_sub(h));
        let left = last.map(|h| expiry_height(h).saturating_sub(tip));
        Self {
            confirmed,
            at_risk: confirmed && since.is_some_and(|s| s >= AT_RISK_BLOCKS),
            unreachable: confirmed && n.reachable == Some(false),
            dos: n.status == NodeStatus::Dos,
            expiring_soon: confirmed && left.is_some_and(|b| b < EXPIRY_SOON_BLOCKS),
        }
    }

    /// Confirmed, not at risk and not unreachable.
    pub fn healthy(self) -> bool {
        self.confirmed && !self.at_risk && !self.unreachable
    }
}

fn text(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

fn share(part: u32, total: u32) -> f64 {
    if total == 0 {
        0.0
    } else {
        f64::from(part) / f64::from(total)
    }
}

/// The entry with the largest count; ties go to the smallest key.
fn top<K: Ord + Clone, V>(m: &HashMap<K, V>, count: impl Fn(&V) -> u32) -> Option<(K, &V)> {
    m.iter()
        .max_by(|a, b| count(a.1).cmp(&count(b.1)).then_with(|| b.0.cmp(a.0)))
        .map(|(k, v)| (k.clone(), v))
}

// ---------------------------------------------------------------------------------------------
// GET /network/operators
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct OperatorAcc<'a> {
    /// The key is a ZelID.
    zelid: bool,
    tiers: TierCounts,
    /// Country code to (nodes, name).
    countries: HashMap<&'a str, (u32, &'a str)>,
    /// Provider to (nodes, org spellings).
    providers: HashMap<ProviderKey, (u32, HashMap<&'a str, u32>)>,
    addresses: HashMap<&'a str, u32>,
    collateral: Amount,
    healthy: u32,
    at_risk: u32,
    unreachable: u32,
    dos: u32,
    app_instances: u32,
    first_active: Option<u64>,
}

/// The grouping key of a node, and whether it is a ZelID; `None` for an empty key.
fn group_key(n: &NodeRecord, by: OperatorsBy) -> Option<(&str, bool)> {
    let key = match by {
        OperatorsBy::Zelid => operator_key(n),
        OperatorsBy::Address => n.payment_address.as_str(),
    };
    let zelid = by == OperatorsBy::Zelid && n.zelid.as_deref().is_some_and(|z| z == key);
    (!key.is_empty()).then_some((key, zelid))
}

/// Every operator with a confirmed node, ranked by confirmed nodes, then key. `tip` prices the
/// run rate (the payout of the next block) and dates the health rules.
pub fn operator_table(
    nodes: &[NodeRecord],
    by: OperatorsBy,
    tip: u32,
    net: &WalletNetwork,
) -> OperatorTable {
    let mut acc: HashMap<&str, OperatorAcc<'_>> = HashMap::new();
    let mut total_nodes = 0u32;
    for n in nodes {
        let confirmed = n.status.is_active();
        total_nodes += u32::from(confirmed);
        let Some((key, zelid)) = group_key(n, by) else {
            continue;
        };
        let a = acc.entry(key).or_default();
        a.zelid |= zelid;
        a.collateral += n.tier.collateral().unwrap_or(Amount::ZERO);
        let h = NodeHealth::of(n, tip);
        a.dos += u32::from(h.dos);
        if !confirmed {
            continue;
        }
        a.tiers.add(n.tier);
        a.healthy += u32::from(h.healthy());
        a.at_risk += u32::from(h.at_risk);
        a.unreachable += u32::from(h.unreachable);
        a.app_instances += u32::from(n.app_count);
        if let Some(t) = n.active_since_ms {
            a.first_active = Some(a.first_active.map_or(t, |f| f.min(t)));
        }
        if let Some(g) = n.geo.as_ref()
            && let Some(cc) = text(&g.country_code)
        {
            let name = text(&g.country).unwrap_or(cc);
            a.countries.entry(cc).or_insert((0, name)).0 += 1;
        }
        if let Some(k) = ProviderKey::of(n) {
            let e = a.providers.entry(k).or_default();
            e.0 += 1;
            if let Some(org) = n.geo.as_ref().and_then(|g| text(&g.org)) {
                *e.1.entry(org).or_default() += 1;
            }
        }
        if !n.payment_address.is_empty() {
            *a.addresses.entry(n.payment_address.as_str()).or_default() += 1;
        }
    }
    let mut rows: Vec<OperatorRow> = acc
        .into_iter()
        .filter(|(_, a)| a.tiers.total > 0)
        .map(|(key, a)| {
            let counts = [a.tiers.cumulus, a.tiers.nimbus, a.tiers.stratus];
            let top_country = top(&a.countries, |v| v.0).map(|(code, v)| OperatorTopCountry {
                code: code.to_owned(),
                name: v.1.to_owned(),
                nodes: v.0,
            });
            let top_provider = top(&a.providers, |v| v.0).map(|(k, v)| OperatorTopProvider {
                key: k.key(),
                label: top(&v.1, |c| *c).map_or_else(|| k.key(), |(s, _)| s.to_owned()),
                nodes: v.0,
            });
            OperatorRow {
                key: key.to_owned(),
                key_kind: if a.zelid {
                    OperatorsBy::Zelid
                } else {
                    OperatorsBy::Address
                },
                rank: 0,
                nodes: a.tiers.total,
                share: share(a.tiers.total, total_nodes),
                tiers: a.tiers,
                countries: a.countries.len() as u32,
                top_country,
                providers: a.providers.len() as u32,
                top_provider,
                addresses: a.addresses.len() as u32,
                top_address: top(&a.addresses, |c| *c).map(|(s, _)| s.to_owned()),
                native_per_day: run_rate(counts, net, tip.saturating_add(1)),
                collateral_locked: a.collateral,
                healthy_pct: share(a.healthy, a.tiers.total + a.dos),
                at_risk: a.at_risk,
                unreachable: a.unreachable,
                dos: a.dos,
                app_instances: a.app_instances,
                first_active_ms: a.first_active,
            }
        })
        .collect();
    rows.sort_by(|a, b| b.nodes.cmp(&a.nodes).then_with(|| a.key.cmp(&b.key)));
    for (i, r) in rows.iter_mut().enumerate() {
        r.rank = i as u32 + 1;
    }
    OperatorTable {
        total_operators: rows.len() as u32,
        total_nodes,
        rows,
    }
}

// ---------------------------------------------------------------------------------------------
// GET /network/nodes-overview
// ---------------------------------------------------------------------------------------------

/// The network's benchmark spread per tier and metric (from the wallet's network figures).
pub fn bench_spreads(net: &WalletNetwork) -> Vec<NodeBenchSpread> {
    let mut out = Vec::new();
    for (t, tier) in Tier::ALL.iter().enumerate() {
        for (m, metric) in BenchMetric::ALL.iter().enumerate() {
            let Some(p) = net.bench[t][m] else { continue };
            out.push(NodeBenchSpread {
                tier: *tier,
                metric: *metric,
                p10: p.p10,
                p50: p.p50,
                p90: p.p90,
                minimum: metric.minimum(*tier),
                nodes: net.bench_nodes[t][m],
            });
        }
    }
    out
}

/// Confirmed nodes by days since `active_since` ([`AGE_BUCKETS`]), and those without one.
pub fn age_buckets(nodes: &[NodeRecord], now: u64) -> (Vec<NodeAgeBucket>, u32) {
    let mut counts = [0u32; AGE_BUCKETS.len()];
    let mut unknown = 0u32;
    for n in nodes.iter().filter(|n| n.status.is_active()) {
        let Some(since) = n.active_since_ms else {
            unknown += 1;
            continue;
        };
        let days = now.saturating_sub(since) / DAY_MS;
        let i = AGE_BUCKETS
            .iter()
            .position(|(_, _, to)| to.is_none_or(|to| days < u64::from(to)))
            .unwrap_or(AGE_BUCKETS.len() - 1);
        counts[i] += 1;
    }
    let buckets = AGE_BUCKETS
        .iter()
        .zip(counts)
        .map(|((label, min, max), nodes)| NodeAgeBucket {
            label: (*label).to_owned(),
            min_days: *min,
            max_days: *max,
            nodes,
        })
        .collect();
    (buckets, unknown)
}

/// The `n` most recently confirmed nodes, newest first (ties by node key).
pub fn newest_nodes(nodes: &[NodeRecord], n: usize) -> Vec<NewestNode> {
    let mut list: Vec<(&NodeRecord, u64, String)> = nodes
        .iter()
        .filter(|r| r.status.is_active())
        .filter_map(|r| Some((r, r.active_since_ms?, node_key(r))))
        .collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    list.into_iter()
        .take(n)
        .map(|(r, since, key)| {
            let g = r.geo.as_ref();
            let pk = ProviderKey::of(r);
            NewestNode {
                node_key: key,
                tier: r.tier,
                country_code: g.and_then(|g| text(&g.country_code)).map(str::to_owned),
                country: g.and_then(|g| text(&g.country)).map(str::to_owned),
                provider: g
                    .and_then(|g| text(&g.org))
                    .map(str::to_owned)
                    .or_else(|| pk.as_ref().map(ProviderKey::key)),
                provider_key: pk.as_ref().map(ProviderKey::key),
                active_since_ms: since,
            }
        })
        .collect()
}

/// Health of the listed nodes at `tip`.
pub fn status_counts(nodes: &[NodeRecord], tip: u32) -> NodeStatusCounts {
    let mut s = NodeStatusCounts {
        healthy: 0,
        at_risk: 0,
        unreachable: 0,
        dos: 0,
        expiring_soon: 0,
        confirmed: 0,
        started: 0,
    };
    for n in nodes {
        let h = NodeHealth::of(n, tip);
        s.healthy += u32::from(h.healthy());
        s.at_risk += u32::from(h.at_risk);
        s.unreachable += u32::from(h.unreachable);
        s.dos += u32::from(h.dos);
        s.expiring_soon += u32::from(h.expiring_soon);
        s.confirmed += u32::from(h.confirmed);
        s.started += u32::from(n.status == NodeStatus::Started);
    }
    s
}

/// Longest gap between two minute metrics rows that still counts as continuous running.
pub const COVERAGE_GAP_MS: u64 = 10 * 60_000;

/// Start of the continuous stretch of minute rows (ascending `ts`) that reaches `now`: walking
/// back from the newest row (itself at most [`COVERAGE_GAP_MS`] old), the first row after a gap
/// longer than that. `None` when the newest row is older.
pub fn covered_since(ts: &[u64], now: u64) -> Option<u64> {
    let mut start = *ts
        .last()
        .filter(|t| now.saturating_sub(**t) <= COVERAGE_GAP_MS)?;
    for t in ts.iter().rev().skip(1) {
        if start - t > COVERAGE_GAP_MS {
            break;
        }
        start = *t;
    }
    Some(start)
}

/// Joins and leaves of distinct nodes in the last 24 hours and 7 days before `now`.
///
/// - **Joined:** an initial confirmation (`NodeConfirmed`) in the window, or a confirmed node
///   whose `active_since` (fluxd's confirmation time, `active`: `(node id, active_since_ms)`) is
///   in it. The node records keep the joins a server missed while it was down (the reconcile
///   after a chain gap adopts those nodes without a confirmation event).
/// - **Left:** a removal from the list in the window (expired, collateral spent or missing;
///   DOS moves aside). `events` yield the event time (`event_ms`, else `observed_ms`, so a
///   removal learned after a gap counts when it was learned).
/// - **Complete:** the server ran through the whole window (`covered_from`, see
///   [`covered_since`], at or before its start).
pub fn churn<'a>(
    events: impl IntoIterator<Item = (u64, &'a Event)>,
    active: &[(u32, u64)],
    now: u64,
    covered_from: Option<u64>,
) -> Vec<NodeChurn> {
    let windows = [(ChurnSpan::Day, DAY_MS), (ChurnSpan::Week, 7 * DAY_MS)];
    let mut sets: [(HashSet<u32>, HashSet<u32>); 2] = Default::default();
    let mut add = |t: u64, node: u32, joined: bool| {
        for (i, (_, len)) in windows.iter().enumerate() {
            if t >= now.saturating_sub(*len) {
                let set = if joined {
                    &mut sets[i].0
                } else {
                    &mut sets[i].1
                };
                set.insert(node);
            }
        }
    };
    for (t, e) in events {
        match e {
            Event::NodeConfirmed { node, .. } => add(t, node.0, true),
            Event::NodeRemoved { node, reason } if *reason != RemovalReason::Dos => {
                add(t, node.0, false);
            }
            _ => {}
        }
    }
    for (node, since) in active {
        add(*since, *node, true);
    }
    windows
        .iter()
        .zip(sets)
        .map(|((span, len), (joined, left))| NodeChurn {
            window: *span,
            joined: joined.len() as u32,
            left: left.len() as u32,
            complete: covered_from.is_some_and(|c| c <= now.saturating_sub(*len)),
        })
        .collect()
}

/// Confirmed nodes that became active in the last 7 days: `(node id, active_since_ms)`.
pub fn recently_active(nodes: &[NodeRecord], now: u64) -> Vec<(u32, u64)> {
    let from = now.saturating_sub(7 * DAY_MS);
    nodes
        .iter()
        .filter(|n| n.status.is_active())
        .filter_map(|n| Some((n.id.0, n.active_since_ms.filter(|t| *t >= from)?)))
        .collect()
}

/// Reads the last 7 days of events (in pages) and minute metrics rows from the store and counts
/// the churn (`active` from [`recently_active`]).
pub fn read_churn(st: &Store, active: &[(u32, u64)], now: u64) -> Result<Vec<NodeChurn>, ApiError> {
    let from = now.saturating_sub(7 * DAY_MS);
    let ts: Vec<u64> = st
        .metrics_range(
            from.saturating_sub(COVERAGE_GAP_MS),
            now + 1,
            Resolution::Minute,
        )?
        .iter()
        .map(|r| r.ts_ms)
        .collect();
    // An event's time is at most its observation time, so every event that happened in the
    // window was observed in it.
    let mut lo = Bound::Included(EventKey::first_at(from));
    let mut kept: Vec<(u64, Event)> = Vec::new();
    loop {
        let page = st.events((lo, Bound::Unbounded), Order::Asc, CHURN_PAGE)?;
        let full = page.len() == CHURN_PAGE;
        let Some(last) = page.last().map(|(k, _)| *k) else {
            break;
        };
        kept.extend(page.into_iter().filter_map(|(_, e)| {
            matches!(
                e.event,
                Event::NodeConfirmed { .. } | Event::NodeRemoved { .. }
            )
            .then(|| (e.event_ms.unwrap_or(e.observed_ms), e.event))
        }));
        if !full {
            break;
        }
        lo = Bound::Excluded(last);
    }
    Ok(churn(
        kept.iter().map(|(t, e)| (*t, e)),
        active,
        now,
        covered_since(&ts, now),
    ))
}

// ---------------------------------------------------------------------------------------------
// GET /network/apps-overview
// ---------------------------------------------------------------------------------------------

const MB_PER_GB: f64 = 1024.0;

/// The [`TOP_OWNERS`] owners with most running instances (then apps, then owner), and the
/// number of distinct owners.
pub fn owners(apps: &[AppIndexEntry], n: usize) -> (Vec<AppOwnerRow>, u32) {
    let mut m: HashMap<&str, AppOwnerRow> = HashMap::new();
    for a in apps {
        let Some(owner) = text(&a.owner) else {
            continue;
        };
        let used = a.per_instance.scaled(a.instances_running);
        let r = m.entry(owner).or_insert_with(|| AppOwnerRow {
            owner: owner.to_owned(),
            apps: 0,
            instances: 0,
            cores: 0.0,
            ram_gb: 0.0,
            ssd_gb: 0.0,
        });
        r.apps += 1;
        r.instances += a.instances_running;
        r.cores += f64::from(used.cpu);
        r.ram_gb += used.ram_mb as f64 / MB_PER_GB;
        r.ssd_gb += used.hdd_gb as f64;
    }
    let total = m.len() as u32;
    let mut rows: Vec<AppOwnerRow> = m.into_values().collect();
    rows.sort_by(|a, b| {
        b.instances
            .cmp(&a.instances)
            .then_with(|| b.apps.cmp(&a.apps))
            .then_with(|| a.owner.cmp(&b.owner))
    });
    rows.truncate(n);
    (rows, total)
}

/// Running instances (the hosted-apps map) by the country of their node, most first, and the
/// instances on nodes without a known country.
pub fn instance_countries<'a, S: std::hash::BuildHasher>(
    hosted: &HashMap<u32, Vec<AppRef>, S>,
    node: impl Fn(u32) -> Option<&'a NodeRecord>,
) -> (Vec<AppCountryRow>, u32) {
    let mut m: HashMap<&str, (u32, &str)> = HashMap::new();
    let mut unlocated = 0u32;
    for (id, list) in hosted {
        let count = list.len() as u32;
        let geo = node(*id).and_then(|n| n.geo.as_ref());
        match geo.and_then(|g| Some((text(&g.country_code)?, g))) {
            Some((cc, g)) => m.entry(cc).or_insert((0, text(&g.country).unwrap_or(cc))).0 += count,
            None => unlocated += count,
        }
    }
    let mut rows: Vec<AppCountryRow> = m
        .into_iter()
        .map(|(code, (instances, name))| AppCountryRow {
            code: code.to_owned(),
            name: name.to_owned(),
            instances,
        })
        .collect();
    rows.sort_by(|a, b| {
        b.instances
            .cmp(&a.instances)
            .then_with(|| a.code.cmp(&b.code))
    });
    (rows, unlocated)
}

/// `used` and `network` exactly as `/network/capacity` counts them.
pub fn resources(cap: &CapacityDto) -> AppsResources {
    AppsResources {
        used: ResourceSum {
            cores: f64::from(cap.apps_locked.cpu),
            ram_gb: cap.apps_locked.ram_mb as f64 / MB_PER_GB,
            ssd_gb: cap.apps_locked.hdd_gb as f64,
        },
        network: ResourceSum {
            cores: cap.total.cores as f64,
            ram_gb: cap.total.ram_gb,
            ssd_gb: cap.total.ssd_gb,
        },
    }
}

/// Registrations and updates per UTC day over the last `days` days (the app economy's rows).
pub fn deployments(
    ledger: &AppLedger,
    tip: u32,
    tip_ms: u64,
    days: u32,
    now: u64,
) -> Vec<AppDeployDay> {
    ledger
        .economy(tip, tip_ms, days, 0, now)
        .days
        .into_iter()
        .map(|d| AppDeployDay {
            day_ms: d.day_ms,
            registered: d.registrations,
            updated: d.updates,
        })
        .collect()
}

/// The `n` most recent registrations, one per app, with the app's running instances.
pub fn newest_apps(
    ledger: &AppLedger,
    apps: &[AppIndexEntry],
    tip: u32,
    tip_ms: u64,
    n: usize,
) -> Vec<NewestApp> {
    let running: HashMap<&str, &AppIndexEntry> =
        apps.iter().map(|a| (a.name.as_str(), a)).collect();
    ledger
        .recent_registrations(tip, n)
        .into_iter()
        .map(|(key, display, height)| {
            let entry = running.get(key);
            NewestApp {
                name: key.to_owned(),
                display_name: entry
                    .map_or(display, |a| a.display_name.as_str())
                    .to_owned(),
                height,
                time_ms: Some(est_time(height, tip, tip_ms)),
                instances: entry.map_or(0, |a| a.instances_running),
            }
        })
        .collect()
}

/// The `n` apps whose expiry height is soonest above `tip` (ties by name); `eta` estimates the
/// time of the block that many blocks ahead.
pub fn expiring_apps(
    apps: &[AppIndexEntry],
    tip: u32,
    n: usize,
    eta: impl Fn(u32) -> u64,
) -> Vec<ExpiringApp> {
    let mut list: Vec<&AppIndexEntry> = apps.iter().filter(|a| a.expire_height > tip).collect();
    list.sort_by(|a, b| {
        a.expire_height
            .cmp(&b.expire_height)
            .then_with(|| a.name.cmp(&b.name))
    });
    list.into_iter()
        .take(n)
        .map(|a| {
            let left = a.expire_height - tip;
            ExpiringApp {
                name: a.name.clone(),
                display_name: a.display_name.clone(),
                expire_height: a.expire_height,
                blocks_left: left,
                expire_ms: eta(left),
                instances: a.instances_running,
            }
        })
        .collect()
}

/// Enterprise apps of the index and their running instances.
pub fn enterprise(apps: &[AppIndexEntry]) -> EnterpriseTotals {
    let mut t = EnterpriseTotals::default();
    for a in apps.iter().filter(|a| a.enterprise) {
        t.apps += 1;
        t.instances += a.instances_running;
    }
    t
}

#[cfg(test)]
mod tests {
    use atlas_core::api::Percentiles;
    use atlas_core::app::Resources;
    use atlas_core::ids::{Hash32, NodeId, Outpoint};
    use atlas_core::node::Geo;

    use super::*;

    const TIP: u32 = 3_000_000;
    const NOW: u64 = 1_790_000_000_000;

    #[allow(clippy::too_many_arguments)]
    fn node(
        id: u32,
        tier: Tier,
        address: &str,
        zelid: Option<&str>,
        cc: &str,
        asn: Option<u32>,
        org: &str,
    ) -> NodeRecord {
        NodeRecord {
            id: NodeId(id),
            outpoint: Outpoint::new(Hash32([id as u8; 32]), id),
            tier,
            status: NodeStatus::Confirmed,
            payment_address: address.into(),
            zelid: zelid.map(Into::into),
            last_confirmed_height: Some(TIP - 10),
            active_since_ms: Some(NOW - u64::from(id) * DAY_MS),
            reachable: Some(true),
            geo: (!cc.is_empty()).then(|| Geo {
                country_code: cc.into(),
                country: format!("Country {cc}").into(),
                org: org.into(),
                asn,
                ..Geo::default()
            }),
            ..NodeRecord::default()
        }
    }

    fn net(queues: [u32; 3]) -> WalletNetwork {
        WalletNetwork {
            tier_active: queues,
            queue_len: queues,
            ..WalletNetwork::default()
        }
    }

    fn fleet() -> Vec<NodeRecord> {
        let mut v = vec![
            // ZelID A: three nodes on two addresses, two countries, one provider.
            node(
                1,
                Tier::Cumulus,
                "t1a",
                Some("zA"),
                "DE",
                Some(24940),
                "Hetzner",
            ),
            node(
                2,
                Tier::Cumulus,
                "t1a",
                Some("zA"),
                "DE",
                Some(24940),
                "Hetzner Online",
            ),
            node(
                3,
                Tier::Stratus,
                "t1b",
                Some("zA"),
                "FI",
                Some(24940),
                "Hetzner",
            ),
            // ZelID B: two nodes on address t1b (shared with A).
            node(4, Tier::Nimbus, "t1b", Some("zB"), "US", None, "Some ISP"),
            node(5, Tier::Nimbus, "t1b", Some("zB"), "US", None, "Some ISP"),
            // No ZelID: grouped by its address in zelid mode.
            node(6, Tier::Cumulus, "t1c", None, "", None, ""),
        ];
        // A started node of zA counts only towards its collateral.
        let mut s = node(
            7,
            Tier::Stratus,
            "t1a",
            Some("zA"),
            "DE",
            Some(24940),
            "Hetzner",
        );
        s.status = NodeStatus::Started;
        v.push(s);
        // A DOS node of zB.
        let mut d = node(8, Tier::Cumulus, "t1b", Some("zB"), "US", None, "Some ISP");
        d.status = NodeStatus::Dos;
        v.push(d);
        v
    }

    #[test]
    #[allow(clippy::many_single_char_names)]
    fn operators_group_by_zelid() {
        let t = operator_table(&fleet(), OperatorsBy::Zelid, TIP, &net([100, 50, 20]));
        assert_eq!(t.total_nodes, 6);
        assert_eq!(t.total_operators, 3);
        let keys: Vec<&str> = t.rows.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, ["zA", "zB", "t1c"]);
        let a = &t.rows[0];
        assert_eq!((a.rank, a.nodes, a.key_kind), (1, 3, OperatorsBy::Zelid));
        assert!((a.share - 0.5).abs() < 1e-9);
        assert_eq!((a.tiers.cumulus, a.tiers.stratus, a.tiers.total), (2, 1, 3));
        assert_eq!(a.countries, 2);
        assert_eq!(
            a.top_country,
            Some(OperatorTopCountry {
                code: "DE".into(),
                name: "Country DE".into(),
                nodes: 2
            })
        );
        assert_eq!(a.providers, 1);
        let p = a.top_provider.as_ref().unwrap();
        assert_eq!(
            (p.key.as_str(), p.label.as_str(), p.nodes),
            ("AS24940", "Hetzner", 3)
        );
        assert_eq!(a.addresses, 2);
        assert_eq!(a.top_address.as_deref(), Some("t1a"));
        // Collateral: two Cumulus, one Stratus, plus the started Stratus.
        assert_eq!(
            a.collateral_locked,
            Amount::from_flux(2 * 1_000 + 2 * 40_000)
        );
        assert_eq!(a.first_active_ms, Some(NOW - 3 * DAY_MS));
        // zB: two confirmed and one DOS node.
        let b = &t.rows[1];
        assert_eq!((b.nodes, b.dos), (2, 1));
        assert!((b.healthy_pct - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(b.top_provider.as_ref().unwrap().key, "some isp");
        // The node without a ZelID is its own operator, keyed by address.
        let c = &t.rows[2];
        assert_eq!(
            (c.key_kind, c.top_country.clone(), c.providers),
            (OperatorsBy::Address, None, 0)
        );
    }

    #[test]
    fn operators_group_by_address() {
        let t = operator_table(&fleet(), OperatorsBy::Address, TIP, &net([100, 50, 20]));
        let rows: Vec<(&str, u32, u32)> = t
            .rows
            .iter()
            .map(|r| (r.key.as_str(), r.nodes, r.rank))
            .collect();
        // t1b holds zA's Stratus and zB's two Nimbus; t1a two; t1c one.
        assert_eq!(rows, [("t1b", 3, 1), ("t1a", 2, 2), ("t1c", 1, 3)]);
        assert!(t.rows.iter().all(|r| r.key_kind == OperatorsBy::Address));
        assert_eq!(t.rows[0].addresses, 1);
        assert_eq!(t.rows[0].top_address.as_deref(), Some("t1b"));
        // Ties rank by key.
        let tie = vec![
            node(1, Tier::Cumulus, "t1z", None, "DE", None, "x"),
            node(2, Tier::Cumulus, "t1y", None, "DE", None, "x"),
        ];
        let t = operator_table(&tie, OperatorsBy::Address, TIP, &net([2, 1, 1]));
        assert_eq!(t.rows[0].key, "t1y");
        assert_eq!(t.rows[1].rank, 2);
    }

    #[test]
    fn operator_run_rate_is_the_wallets() {
        let n = net([100, 50, 20]);
        let t = operator_table(&fleet(), OperatorsBy::Zelid, TIP, &n);
        assert_eq!(t.rows[0].native_per_day, run_rate([2, 0, 1], &n, TIP + 1));
        // One Cumulus node in a queue of 100: payout x 2,880 / 100 a day.
        let pay = atlas_core::emission::tier_payout(TIP + 1, Tier::Cumulus).unwrap();
        assert_eq!(
            t.rows[2].native_per_day,
            Amount::from_sat(pay.sat() * 2_880 / 100)
        );
        assert!(t.rows[0].native_per_day > t.rows[2].native_per_day);
    }

    #[test]
    fn health_rules() {
        let mut n = node(1, Tier::Cumulus, "t1a", None, "DE", None, "x");
        assert!(NodeHealth::of(&n, TIP).healthy());
        // 520 blocks since the last confirmation: 121 left, not yet expiring soon.
        n.last_confirmed_height = Some(TIP - 520);
        let h = NodeHealth::of(&n, TIP);
        assert!(!h.expiring_soon && !h.at_risk);
        // 522 blocks: 119 left, expiring soon (the wallet's rule) but not at risk.
        n.last_confirmed_height = Some(TIP - 522);
        let h = NodeHealth::of(&n, TIP);
        assert!(h.expiring_soon && !h.at_risk && h.healthy());
        // 560 blocks: at risk (the engine's rule), and so not healthy.
        n.last_confirmed_height = Some(TIP - 560);
        let h = NodeHealth::of(&n, TIP);
        assert!(h.at_risk && h.expiring_soon && !h.healthy());
        n.last_confirmed_height = Some(TIP - 10);
        n.reachable = Some(false);
        assert!(NodeHealth::of(&n, TIP).unreachable);
        assert!(!NodeHealth::of(&n, TIP).healthy());
        // Unknown reachability is not unreachable.
        n.reachable = None;
        assert!(NodeHealth::of(&n, TIP).healthy());
        n.status = NodeStatus::Dos;
        let h = NodeHealth::of(&n, TIP);
        assert!(h.dos && !h.healthy() && !h.expiring_soon);

        let mut nodes = fleet();
        nodes[0].last_confirmed_height = Some(TIP - 600);
        nodes[1].reachable = Some(false);
        let s = status_counts(&nodes, TIP);
        assert_eq!(
            (
                s.confirmed,
                s.healthy,
                s.at_risk,
                s.unreachable,
                s.dos,
                s.started
            ),
            (6, 4, 1, 1, 1, 1)
        );
        assert_eq!(s.expiring_soon, 1);
    }

    #[test]
    fn top_country_and_provider_break_ties_by_key() {
        let nodes = vec![
            node(1, Tier::Cumulus, "t1a", None, "US", Some(2), "Two"),
            node(2, Tier::Cumulus, "t1a", None, "DE", Some(1), "One"),
            node(3, Tier::Cumulus, "t1a", None, "FR", Some(1), "One GmbH"),
            node(4, Tier::Cumulus, "t1a", None, "US", Some(2), "Two"),
        ];
        let t = operator_table(&nodes, OperatorsBy::Address, TIP, &net([4, 1, 1]));
        let r = &t.rows[0];
        assert_eq!(r.top_country.as_ref().unwrap().code, "US");
        assert_eq!((r.countries, r.providers), (3, 2));
        // AS1 and AS2 both hold two nodes: the smaller key wins; its label is the more common
        // spelling, ties to the smaller.
        let p = r.top_provider.as_ref().unwrap();
        assert_eq!(
            (p.key.as_str(), p.label.as_str(), p.nodes),
            ("AS1", "One", 2)
        );
    }

    #[test]
    fn age_buckets_by_active_since() {
        let mut nodes: Vec<NodeRecord> = [0u64, 6, 7, 29, 30, 181, 182, 364, 365, 729, 730, 2_000]
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let mut n = node(i as u32, Tier::Cumulus, "t1a", None, "", None, "");
                n.active_since_ms = Some(NOW - d * DAY_MS - 1_000);
                n
            })
            .collect();
        let mut unknown = node(99, Tier::Cumulus, "t1a", None, "", None, "");
        unknown.active_since_ms = None;
        nodes.push(unknown);
        let mut gone = node(98, Tier::Cumulus, "t1a", None, "", None, "");
        gone.status = NodeStatus::Started;
        nodes.push(gone);
        let (b, u) = age_buckets(&nodes, NOW);
        let got: Vec<(&str, u32)> = b.iter().map(|b| (b.label.as_str(), b.nodes)).collect();
        assert_eq!(
            got,
            [
                ("<7d", 2),
                ("7-30d", 2),
                ("1-6mo", 2),
                ("6-12mo", 2),
                ("1-2y", 2),
                ("2y+", 2)
            ]
        );
        assert_eq!(u, 1);
        assert_eq!((b[2].min_days, b[2].max_days), (30, Some(182)));
        assert_eq!(b[5].max_days, None);
    }

    #[test]
    fn newest_nodes_first() {
        let nodes = fleet();
        let list = newest_nodes(&nodes, 3);
        let ids: Vec<String> = list.iter().map(|n| n.node_key.clone()).collect();
        assert_eq!(ids, [1, 2, 3].map(|i| node_key(&nodes[i - 1])));
        assert_eq!(list[0].provider.as_deref(), Some("Hetzner"));
        assert_eq!(list[0].provider_key.as_deref(), Some("AS24940"));
        assert_eq!(list[0].country_code.as_deref(), Some("DE"));
        assert_eq!(list[0].active_since_ms, NOW - DAY_MS);
    }

    #[test]
    fn churn_counts_distinct_nodes_per_window() {
        let confirmed = |n: u32| Event::NodeConfirmed {
            node: NodeId(n),
            height: 1,
            txid: Hash32::default(),
        };
        let removed = |n: u32, reason| Event::NodeRemoved {
            node: NodeId(n),
            reason,
        };
        let hour = 3_600_000;
        let events = [
            (NOW - hour, confirmed(1)),
            (NOW - 2 * hour, confirmed(1)),
            (NOW - 3 * DAY_MS, confirmed(2)),
            (NOW - 8 * DAY_MS, confirmed(3)),
            (NOW - hour, removed(4, RemovalReason::Expired)),
            (NOW - 2 * DAY_MS, removed(5, RemovalReason::CollateralSpent)),
            (NOW - 2 * DAY_MS, removed(6, RemovalReason::Missing)),
            (NOW - hour, removed(7, RemovalReason::Dos)),
            (
                NOW - hour,
                Event::NodeHeartbeat {
                    node: NodeId(8),
                    height: 1,
                    txid: Hash32::default(),
                    endpoint: None,
                    benchmark_tier: None,
                },
            ),
        ];
        // Node 1 again (counted once), node 9 joined while no event was recorded, node 10
        // long ago.
        let active = [
            (1, NOW - hour / 2),
            (9, NOW - 2 * DAY_MS),
            (10, NOW - 9 * DAY_MS),
        ];
        let c = churn(
            events.iter().map(|(t, e)| (*t, e)),
            &active,
            NOW,
            Some(NOW - 3 * DAY_MS),
        );
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].window, ChurnSpan::Day);
        assert_eq!((c[0].joined, c[0].left, c[0].complete), (1, 1, true));
        assert_eq!(c[1].window, ChurnSpan::Week);
        assert_eq!((c[1].joined, c[1].left, c[1].complete), (3, 3, false));
        assert!(churn([], &[], NOW, None).iter().all(|c| !c.complete));
        let json = serde_json::to_string(&c[1]).unwrap();
        assert!(json.contains("\"window\":\"7d\""), "{json}");
    }

    #[test]
    fn churn_reads_the_store_in_pages() {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::open(dir.path().join("t.redb")).unwrap();
        let mut b = atlas_store::WriteBatch::default();
        let ev = |t: u64, event: Event| atlas_core::event::EventEnvelope {
            seq: 0,
            observed_ms: t,
            event_ms: Some(t),
            event,
        };
        // The server ran (a metrics row a minute) through the last two days only.
        let minute = 60_000;
        for m in 0..=(2 * DAY_MS / minute) {
            b.put_metrics_1m(atlas_store::MetricsRow {
                ts_ms: NOW - NOW % minute - m * minute,
                ..atlas_store::MetricsRow::default()
            });
        }
        for i in 0..(CHURN_PAGE as u32 + 5) {
            b.push_event(ev(
                NOW - 2 * DAY_MS + u64::from(i),
                Event::NodeConfirmed {
                    node: NodeId(i),
                    height: 1,
                    txid: Hash32::default(),
                },
            ));
        }
        b.push_event(ev(
            NOW - 1_000,
            Event::NodeRemoved {
                node: NodeId(1),
                reason: RemovalReason::Expired,
            },
        ));
        st.commit(b).unwrap();
        let active = recently_active(&fleet(), NOW);
        assert_eq!(
            active.len(),
            6,
            "every confirmed fixture node joined within 7 days"
        );
        let c = read_churn(&st, &[], NOW).unwrap();
        assert_eq!((c[0].joined, c[0].left, c[0].complete), (0, 1, true));
        assert_eq!(
            (c[1].joined, c[1].left, c[1].complete),
            (CHURN_PAGE as u32 + 5, 1, false)
        );
    }

    #[test]
    fn coverage_follows_the_minute_rows() {
        let m = 60_000;
        let now = 1_000 * m;
        assert_eq!(covered_since(&[], now), None);
        // The newest row is too old: not running now.
        assert_eq!(covered_since(&[now - 20 * m], now), None);
        // A 30-minute hole: coverage starts after it; short holes do not break it.
        let ts = [100 * m, 101 * m, 140 * m, 141 * m, 149 * m, 999 * m];
        assert_eq!(covered_since(&ts[..5], 150 * m), Some(140 * m));
        assert_eq!(covered_since(&ts, now), Some(999 * m));
        assert_eq!(covered_since(&ts[..2], 105 * m), Some(100 * m));
    }

    #[test]
    fn bench_spreads_carry_counts_and_minimums() {
        let mut n = WalletNetwork::default();
        n.bench[2][0] = Some(Percentiles {
            p10: 1_600.0,
            p50: 2_000.0,
            p90: 2_400.0,
        });
        n.bench_nodes[2][0] = 1_700;
        let s = bench_spreads(&n);
        assert_eq!(s.len(), 1);
        assert_eq!(
            (s[0].tier, s[0].metric, s[0].nodes),
            (Tier::Stratus, BenchMetric::Eps, 1_700)
        );
        assert_eq!(s[0].minimum, BenchMetric::Eps.minimum(Tier::Stratus));
    }

    fn app(name: &str, owner: &str, running: u32, expire: u32, enterprise: bool) -> AppIndexEntry {
        AppIndexEntry {
            name: name.to_ascii_lowercase(),
            display_name: name.to_owned(),
            owner: owner.to_owned(),
            spec_version: 8,
            instances_target: running,
            instances_running: running,
            component_count: 1,
            enterprise,
            per_instance: Resources {
                cpu: 0.5,
                ram_mb: 2_048,
                hdd_gb: 10,
            },
            totals: Resources::default(),
            height: TIP - 100,
            expire_height: expire,
        }
    }

    #[test]
    fn apps_owners_countries_expiring_enterprise() {
        let apps = vec![
            app("One", "z1", 3, TIP + 500, false),
            app("Two", "z1", 5, TIP + 100, true),
            app("Three", "z2", 8, TIP + 100, false),
            app("Gone", "z3", 0, TIP - 1, false),
        ];
        let (rows, total) = owners(&apps, 2);
        assert_eq!(total, 3);
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].owner.as_str(), rows[0].apps, rows[0].instances),
            ("z1", 2, 8)
        );
        assert!((rows[0].cores - 4.0).abs() < 1e-9);
        assert!((rows[0].ram_gb - 16.0).abs() < 1e-9);
        assert!((rows[0].ssd_gb - 80.0).abs() < 1e-9);
        assert_eq!(
            rows[1].owner, "z2",
            "8 instances, one app: after z1 by apps"
        );

        let ex = expiring_apps(&apps, TIP, 10, |b| u64::from(b) * 30_000);
        let names: Vec<&str> = ex.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["three", "two", "one"], "expired apps are left out");
        assert_eq!((ex[0].blocks_left, ex[0].expire_ms), (100, 3_000_000));

        assert_eq!(
            enterprise(&apps),
            EnterpriseTotals {
                apps: 1,
                instances: 5
            }
        );

        let nodes = fleet();
        let hosted: HashMap<u32, Vec<AppRef>> = [
            (
                1,
                vec![
                    AppRef {
                        name: "one".into(),
                        display_name: "One".into()
                    };
                    2
                ],
            ),
            (
                4,
                vec![AppRef {
                    name: "two".into(),
                    display_name: "Two".into(),
                }],
            ),
            (
                5,
                vec![AppRef {
                    name: "two".into(),
                    display_name: "Two".into(),
                }],
            ),
            (
                6,
                vec![AppRef {
                    name: "two".into(),
                    display_name: "Two".into(),
                }],
            ),
            (
                42,
                vec![AppRef {
                    name: "two".into(),
                    display_name: "Two".into(),
                }],
            ),
        ]
        .into_iter()
        .collect();
        let (c, unlocated) = instance_countries(&hosted, |id| nodes.iter().find(|n| n.id.0 == id));
        let got: Vec<(&str, u32)> = c.iter().map(|r| (r.code.as_str(), r.instances)).collect();
        assert_eq!(got, [("DE", 2), ("US", 2)]);
        assert_eq!(c[0].name, "Country DE");
        assert_eq!(unlocated, 2, "node 6 has no geo and node 42 is unknown");
    }

    #[test]
    fn resources_match_capacity() {
        let cap = CapacityDto {
            total: atlas_core::api::CapacityTotals {
                nodes: 2,
                cores: 12,
                ram_gb: 40.0,
                ssd_gb: 660.0,
                down_mbps: 0.0,
                up_mbps: 0.0,
            },
            by_tier: Vec::new(),
            apps_requested: Resources::default(),
            apps_locked: Resources {
                cpu: 2.5,
                ram_mb: 3_072,
                hdd_gb: 50,
            },
        };
        let r = resources(&cap);
        assert_eq!(
            (r.used.cores, r.used.ram_gb, r.used.ssd_gb),
            (2.5, 3.0, 50.0)
        );
        assert_eq!(
            (r.network.cores, r.network.ram_gb, r.network.ssd_gb),
            (12.0, 40.0, 660.0)
        );
    }

    #[test]
    fn deployments_per_day_and_newest_registrations() {
        use atlas_core::app::{AppMessageRecord, AppSpec};
        use atlas_core::event::AppMessageKind;
        let dir = tempfile::tempdir().unwrap();
        let st = Store::open(dir.path().join("t.redb")).unwrap();
        let day = crate::ledger::BLOCKS_PER_DAY;
        let msg = |name: &str, height: u32, kind, n: u8| {
            let mut hash = [n; 32];
            hash[..4].copy_from_slice(&height.to_le_bytes());
            AppMessageRecord {
                hash: Hash32(hash),
                txid: None,
                height,
                timestamp_ms: 0,
                kind,
                paid: Amount::from_flux(1),
                spec: AppSpec {
                    spec_version: 8,
                    name: name.to_owned(),
                    expire_blocks: Some(30 * day),
                    ..AppSpec::default()
                },
            }
        };
        let mut b = atlas_store::WriteBatch::default();
        b.put_app_message(msg("Old", TIP - 100 * day, AppMessageKind::Register, 1));
        b.put_app_message(msg(
            "Alpha",
            TIP - 2 * day - 10,
            AppMessageKind::Register,
            2,
        ));
        b.put_app_message(msg("alpha", TIP - day - 10, AppMessageKind::Update, 3));
        b.put_app_message(msg("Beta", TIP - day - 20, AppMessageKind::Register, 4));
        b.put_app_message(msg("Alpha", TIP - 5, AppMessageKind::Register, 5));
        b.put_app_message(msg("Gamma", TIP - 3, AppMessageKind::Update, 6));
        st.commit(b).unwrap();
        let ledger = AppLedger::build(&st, true).unwrap();
        let tip_ms = NOW;
        let d = deployments(&ledger, TIP, tip_ms, DEPLOY_DAYS, NOW);
        assert_eq!(d.len(), DEPLOY_DAYS as usize);
        assert!(d.windows(2).all(|w| w[1].day_ms == w[0].day_ms + DAY_MS));
        assert_eq!(d.last().unwrap().day_ms, NOW / DAY_MS * DAY_MS);
        assert_eq!(
            d.iter().map(|x| x.registered).sum::<u32>(),
            3,
            "Old is out of range"
        );
        assert_eq!(d.iter().map(|x| x.updated).sum::<u32>(), 2);
        // Today holds Alpha's re-registration and Gamma's update.
        let today = d.last().unwrap();
        assert_eq!((today.registered, today.updated), (1, 1));

        let apps = vec![app("Alpha", "z1", 4, TIP + 10, false)];
        let newest = newest_apps(&ledger, &apps, TIP, tip_ms, 10);
        let got: Vec<(&str, u32, u32)> = newest
            .iter()
            .map(|a| (a.name.as_str(), a.height, a.instances))
            .collect();
        // One row per app (Alpha's latest registration), newest first.
        assert_eq!(
            got,
            [
                ("alpha", TIP - 5, 4),
                ("beta", TIP - day - 20, 0),
                ("old", TIP - 100 * day, 0)
            ]
        );
        assert_eq!(newest[0].time_ms, Some(NOW - 5 * 30_000));
        assert_eq!(newest[1].display_name, "Beta");
        assert_eq!(newest_apps(&ledger, &apps, TIP, tip_ms, 1).len(), 1);
    }
}

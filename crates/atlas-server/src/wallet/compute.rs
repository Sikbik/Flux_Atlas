//! The wallet view's arithmetic, kept free of I/O so each rule is tested on its own: realized
//! earnings per day, expected against received payments, the run rate and its projection,
//! health reasons, benchmarks against the network, and concentration.

use std::collections::{BTreeMap, HashMap};

use atlas_core::api::{
    AppRef, BenchMetric, ConcentrationBucket, ConcentrationBy, EarningsDay, HealthKind,
    HealthReason, MissedPayments, NodeAttention, ProjectionDay, SubsidyReduction, TierCounts,
    TierShares, WalletActivity, WalletApp, WalletApps, WalletBenchmark, WalletConcentration,
    WalletDto, WalletEarnings, WalletHealth, WalletPayout, WalletStanding,
};
use atlas_core::emission::{
    next_reduction_height, parallel_asset_accrual, pon_subsidy, tier_payout, tier_payout_total,
};
use atlas_core::node::{BenchStatus, NodeStatus};
use atlas_core::{Amount, NodeRecord, Tier};

use super::fleet::FleetLedger;
use super::network::{WalletNetwork, compare_versions, quantile};
use crate::ledger::{BLOCKS_PER_DAY, PayoutEntry, PayoutLedger, est_time};
use crate::views::analytics::{ProviderKey, hhi};
use crate::views::{BLOCK_MS, Views, node_row};

pub const DAY_MS: u64 = 86_400_000;
/// `expiring_soon`: fewer blocks than this (about an hour) before the confirmation deadline,
/// i.e. more than 520 blocks since the last confirmation. A healthy node may confirm again only
/// 500 blocks after its last confirmation (`windows::MIN_CONFIRM_INTERVAL_BLOCKS`) and does so
/// right then (99% of the network within 500 blocks, measured October 2026), so it always sits
/// between 641 and about 140 blocks before the deadline: a 4-hour threshold (480 blocks) would
/// flag 70% of healthy nodes. Past 520 blocks a node is late (0.25% of the network).
pub const EXPIRY_SOON_BLOCKS: u32 = 120;
/// `low_headroom`: a benchmark within this fraction above the tier minimum.
pub const HEADROOM: f64 = 0.10;
/// Days of the earnings projection.
pub const PROJECTION_DAYS: u64 = 365;

/// The URL key of a node: its collateral outpoint.
pub fn node_key(n: &NodeRecord) -> String {
    n.outpoint.to_string()
}

/// Everything one wallet view is computed from.
pub struct WalletInputs<'a> {
    pub address: &'a str,
    pub now_ms: u64,
    pub views: &'a Views,
    pub net: &'a WalletNetwork,
    /// Listed nodes paying the address.
    pub nodes: Vec<&'a NodeRecord>,
    pub ledger: &'a PayoutLedger,
    pub hosted: &'a HashMap<u32, Vec<AppRef>>,
    pub balance: Option<Amount>,
    pub richlist_rank: Option<u32>,
    pub activity: Vec<WalletActivity>,
    pub fleet: Option<&'a FleetLedger>,
}

/// Builds the wallet view.
pub fn build(inp: WalletInputs<'_>) -> WalletDto {
    let v = inp.views;
    let net = inp.net;
    let tip = v.tip_height().unwrap_or(0);
    let tip_ms = v.tip_time_ms().unwrap_or(inp.now_ms);
    let active: Vec<&NodeRecord> = inp
        .nodes
        .iter()
        .copied()
        .filter(|n| n.status.is_active())
        .collect();
    let mut tiers = TierCounts::default();
    for n in &active {
        tiers.add(n.tier);
    }
    let counts = [tiers.cumulus, tiers.nimbus, tiers.stratus];

    let collateral: Amount = inp.nodes.iter().filter_map(|n| n.tier.collateral()).sum();
    let share = |t: usize| {
        let total = net.tier_active[t];
        if total == 0 {
            0.0
        } else {
            f64::from(counts[t]) / f64::from(total)
        }
    };
    let standing = WalletStanding {
        balance: inp.balance,
        collateral_locked: collateral,
        liquid: inp.balance.map(|b| {
            if b > collateral {
                b - collateral
            } else {
                Amount::ZERO
            }
        }),
        richlist_rank: inp.richlist_rank,
        operator_rank: net.operator_rank(tiers.total),
        operator_count: net.operator_counts.len() as u32,
        share_of_tier: TierShares {
            cumulus: share(0),
            nimbus: share(1),
            stratus: share(2),
        },
        first_active_ms: inp.nodes.iter().filter_map(|n| n.active_since_ms).min(),
    };

    let mut payouts: Vec<WalletPayout> = active
        .iter()
        .filter_map(|n| {
            let eta = v.payment_eta(n)?;
            Some(WalletPayout {
                node_key: node_key(n),
                tier: n.tier,
                height: tip + eta.eta_blocks,
                eta_ms: eta.eta_ms,
                amount: eta.amount,
            })
        })
        .collect();
    payouts.sort_by(|a, b| {
        a.height
            .cmp(&b.height)
            .then_with(|| a.node_key.cmp(&b.node_key))
    });

    let today_ms = inp.now_ms.max(tip_ms) / DAY_MS * DAY_MS;
    let entries = inp.ledger.payouts(inp.address);
    let window = inp.ledger.from.zip(inp.ledger.tip);
    let (expected, received, missed) = payment_audit(window, tip, entries, &active, net);
    let native_per_day = run_rate(counts, net, tip + 1);
    let earnings = WalletEarnings {
        days: earnings_days(inp.ledger, entries, tip, tip_ms, today_ms),
        covered_from_ms: inp.ledger.from_ms,
        expected_payments: expected,
        received_payments: received,
        missed,
        native_per_day,
        pa_per_day: parallel_asset_accrual(native_per_day),
        projection: projection(counts, net, tip, tip_ms, today_ms),
        reduction: next_reduction_height(tip).map(|height| SubsidyReduction {
            height,
            eta_ms: v.eta_ms(height.saturating_sub(tip)),
            subsidy_before: pon_subsidy(height.saturating_sub(1)).unwrap_or(Amount::ZERO),
            subsidy_after: pon_subsidy(height).unwrap_or(Amount::ZERO),
        }),
    };

    let mut attention: Vec<NodeAttention> = Vec::new();
    for n in &inp.nodes {
        let expires = if n.status.is_active() {
            v.expires_in(n)
        } else {
            None
        };
        let reasons = health_reasons(n, net, expires);
        if !reasons.is_empty() {
            attention.push(NodeAttention {
                node_key: node_key(n),
                reasons,
            });
        }
    }
    attention.sort_by(|a, b| {
        b.reasons
            .len()
            .cmp(&a.reasons.len())
            .then_with(|| a.node_key.cmp(&b.node_key))
    });
    let health = WalletHealth {
        healthy: (inp.nodes.len() - attention.len()) as u32,
        attention,
    };

    let mut fleet_history = inp
        .fleet
        .map(|f| f.history(inp.address))
        .unwrap_or_default();
    fleet_history.retain(|d| d.day_ms < today_ms);
    fleet_history.push(atlas_core::api::FleetDay {
        day_ms: today_ms,
        cumulus: tiers.cumulus,
        nimbus: tiers.nimbus,
        stratus: tiers.stratus,
    });

    WalletDto {
        address: inp.address.to_owned(),
        generated_ms: inp.now_ms,
        tip_height: tip,
        standing,
        tiers,
        nodes: inp.nodes.iter().map(|n| node_row(n)).collect(),
        earnings,
        payouts,
        health,
        benchmarks: benchmarks(&active, net),
        concentration: concentration(&active),
        apps: apps(&inp.nodes, inp.hosted),
        activity: inp.activity,
        fleet_history,
    }
}

// ---------------------------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------------------------

/// Realized payouts per UTC day from the covered window's first day to today. Block times are
/// estimated from the height (30 s a block back from the tip).
pub fn earnings_days(
    ledger: &PayoutLedger,
    entries: &[PayoutEntry],
    tip: u32,
    tip_ms: u64,
    today_ms: u64,
) -> Vec<EarningsDay> {
    let Some(from_ms) = ledger.from_ms else {
        return Vec::new();
    };
    let first = (from_ms / DAY_MS * DAY_MS).min(today_ms);
    let n = ((today_ms - first) / DAY_MS + 1) as usize;
    let mut days: Vec<EarningsDay> = (0..n)
        .map(|i| EarningsDay {
            day_ms: first + i as u64 * DAY_MS,
            native: Amount::ZERO,
            pa: Amount::ZERO,
            payments: 0,
            cumulus: Amount::ZERO,
            nimbus: Amount::ZERO,
            stratus: Amount::ZERO,
        })
        .collect();
    for e in entries {
        let t = est_time(e.height, tip.max(e.height), tip_ms);
        if t < first {
            continue;
        }
        let Some(d) = days.get_mut(((t - first) / DAY_MS) as usize) else {
            continue;
        };
        d.native += e.amount;
        d.payments += 1;
        match e.tier {
            Tier::Cumulus => d.cumulus += e.amount,
            Tier::Nimbus => d.nimbus += e.amount,
            Tier::Stratus => d.stratus += e.amount,
            Tier::Unknown => {}
        }
    }
    for d in &mut days {
        d.pa = parallel_asset_accrual(d.native);
    }
    days
}

/// Payments missed between consecutive anchors `start`, the payment heights and `end`, for a
/// node paid once every `cycle` blocks: a gap of about `k` cycles holds `k - 1` missed
/// payments (rounded, so the queue's drift of a fraction of a cycle never counts). `start` is
/// when the node could first be paid in the window (no payment there) and `end` the predicted
/// next payment or the window's end.
pub fn missed_payments(cycle: u32, start: u32, paid: &[u32], end: u32) -> u32 {
    let c = f64::from(cycle.max(1));
    let mut anchors = Vec::with_capacity(paid.len() + 2);
    anchors.push(start);
    anchors.extend(paid.iter().copied().filter(|h| *h >= start));
    anchors.push(end.max(start));
    anchors
        .windows(2)
        .map(|w| {
            let gap = f64::from(w[1].saturating_sub(w[0]));
            ((gap / c + 0.5).floor() as u32).saturating_sub(1)
        })
        .sum()
}

/// Payment slots of a node paid every `cycle` blocks with its next payment due at `next_due`:
/// the heights `next_due - k * cycle` (k >= 1) that fall in `[start, end]`.
pub fn queue_slots(cycle: u32, start: u32, end: u32, next_due: u32) -> u32 {
    let c = u64::from(cycle.max(1));
    let (start, end, due) = (u64::from(start), u64::from(end), u64::from(next_due));
    if end < start || due <= start {
        return 0;
    }
    // k from the first slot at or below `end` to the last at or above `start`.
    let k_min = due.saturating_sub(end).div_ceil(c).max(1);
    let k_max = (due - start) / c;
    k_max.saturating_sub(k_min - 1) as u32
}

/// Expected and received payments over the ledger's window `[from, to]` (`None` when no block
/// is stored), and the nodes that missed some.
///
/// Received counts every payout to the address. A payout belongs to a node when the block
/// recorded it (every live block does), or when the wallet runs a single node of that tier.
/// Per tier:
/// - every payout attributed: each confirmed node's payments are checked against the queue
///   ([`missed_payments`]) and expected = received + missed;
/// - some payouts not attributable (blocks backfilled before this server saw them, where a
///   large wallet's payouts to one address cannot be told apart): expected is the queue slots
///   of the tier's nodes over the window ([`queue_slots`]), at least the payouts received, and
///   no node can be named.
pub fn payment_audit(
    window: Option<(u32, u32)>,
    tip: u32,
    entries: &[PayoutEntry],
    active: &[&NodeRecord],
    net: &WalletNetwork,
) -> (u32, u32, Vec<MissedPayments>) {
    let Some((from, to)) = window else {
        return (0, 0, Vec::new());
    };
    let received = entries.len() as u32;
    let mut expected = 0u32;
    let mut missed: Vec<MissedPayments> = Vec::new();
    for tier in [Tier::Cumulus, Tier::Nimbus, Tier::Stratus, Tier::Unknown] {
        let nodes: Vec<&NodeRecord> = active.iter().copied().filter(|n| n.tier == tier).collect();
        let paid_t: Vec<&PayoutEntry> = entries.iter().filter(|e| e.tier == tier).collect();
        let mut by_node: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut pooled = 0u32;
        for e in &paid_t {
            match e.node {
                Some(id) => by_node.entry(id.0).or_default().push(e.height),
                None if nodes.len() == 1 => {
                    by_node.entry(nodes[0].id.0).or_default().push(e.height);
                }
                None => pooled += 1,
            }
        }
        let got_t = paid_t.len() as u32;
        if nodes.is_empty() || tier == Tier::Unknown {
            expected += got_t;
            continue;
        }
        let cycle = net.cycle(tier);
        let span = |n: &NodeRecord| {
            let joined = n.confirmed_height.unwrap_or(n.added_height);
            let start = from.max(joined);
            let due = n.rank.map_or(to, |r| tip + r + 1);
            (start, due)
        };
        if pooled > 0 {
            let slots: u32 = nodes
                .iter()
                .map(|n| {
                    let (start, due) = span(n);
                    queue_slots(cycle, start, to, due)
                })
                .sum();
            expected += slots.max(got_t);
            continue;
        }
        let mut missed_t = 0u32;
        for n in &nodes {
            let (start, due) = span(n);
            if start >= to {
                continue;
            }
            let mut paid = by_node.remove(&n.id.0).unwrap_or_default();
            paid.sort_unstable();
            let m = missed_payments(cycle, start, &paid, due);
            if m > 0 {
                missed_t += m;
                let got = paid.len() as u32;
                missed.push(MissedPayments {
                    node_key: node_key(n),
                    expected: got + m,
                    received: got,
                });
            }
        }
        expected += got_t + missed_t;
    }
    missed.sort_by(|a, b| {
        (b.expected - b.received)
            .cmp(&(a.expected - a.received))
            .then_with(|| a.node_key.cmp(&b.node_key))
    });
    (expected, received, missed)
}

/// Native FLUX a day at `height`: per tier, nodes x payout x blocks a day / queue length.
pub fn run_rate(counts: [u32; 3], net: &WalletNetwork, height: u32) -> Amount {
    let mut sat: i128 = 0;
    for (t, tier) in Tier::ALL.iter().enumerate() {
        let pay = tier_payout(height, *tier).map_or(0, Amount::sat);
        sat += i128::from(counts[t]) * i128::from(pay) * i128::from(BLOCKS_PER_DAY)
            / i128::from(net.cycle(*tier));
    }
    Amount::from_sat(sat as i64)
}

/// The next [`PROJECTION_DAYS`] UTC days from today at the current fleet and queue sizes: each
/// day's 2,880 blocks paid at that day's subsidy (a reduction day is split at its height).
pub fn projection(
    counts: [u32; 3],
    net: &WalletNetwork,
    tip: u32,
    tip_ms: u64,
    today_ms: u64,
) -> Vec<ProjectionDay> {
    (0..PROJECTION_DAYS)
        .map(|i| {
            let day_ms = today_ms + i * DAY_MS;
            // The height at the day's start, estimated at 30 s a block from the tip.
            let offset = (i128::from(day_ms) - i128::from(tip_ms)) / i128::from(BLOCK_MS);
            let h0 = (i128::from(tip) + offset).clamp(0, i128::from(u32::MAX)) as u32;
            let h1 = h0.saturating_add(BLOCKS_PER_DAY);
            let mut sat: i128 = 0;
            for (t, tier) in Tier::ALL.iter().enumerate() {
                let total = tier_payout_total(h0, h1, *tier).sat();
                sat += i128::from(counts[t]) * i128::from(total) / i128::from(net.cycle(*tier));
            }
            let native = Amount::from_sat(sat as i64);
            ProjectionDay {
                day_ms,
                native,
                pa: parallel_asset_accrual(native),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

fn reason(
    kind: HealthKind,
    detail: String,
    metric: Option<&str>,
    value: Option<f64>,
    threshold: Option<f64>,
) -> HealthReason {
    HealthReason {
        kind,
        detail,
        metric: metric.map(str::to_owned),
        value,
        threshold,
    }
}

fn metric_label(m: BenchMetric) -> &'static str {
    match m {
        BenchMetric::Eps => "EPS",
        BenchMetric::DiskWriteMbs => "Disk write (MB/s)",
        BenchMetric::DownMbps => "Download (Mb/s)",
        BenchMetric::UpMbps => "Upload (Mb/s)",
        BenchMetric::RamGb => "RAM (GB)",
        BenchMetric::Cores => "Cores",
        BenchMetric::SsdGb => "SSD (GB)",
    }
}

/// Why a node needs attention (empty when it does not). `expires_in` is the blocks left before
/// the confirmation deadline of a confirmed node.
pub fn health_reasons(
    n: &NodeRecord,
    net: &WalletNetwork,
    expires_in: Option<u32>,
) -> Vec<HealthReason> {
    let mut out = Vec::new();
    let outdated = |mine: Option<&str>, network: Option<&String>| match (mine, network) {
        (Some(m), Some(d)) if !m.is_empty() => compare_versions(m, d)
            .is_lt()
            .then(|| (m.to_owned(), d.clone())),
        _ => None,
    };
    if let Some((m, d)) = outdated(n.versions.flux_os.as_deref(), net.dominant_flux_os.as_ref()) {
        out.push(reason(
            HealthKind::VersionOutdated,
            format!("FluxOS {m}; most of the network runs {d}"),
            Some("flux_os"),
            None,
            None,
        ));
    }
    if let Some((m, d)) = outdated(n.versions.bench.as_deref(), net.dominant_bench.as_ref()) {
        out.push(reason(
            HealthKind::VersionOutdated,
            format!("fluxbench {m}; most of the network runs {d}"),
            Some("bench"),
            None,
            None,
        ));
    }
    if let Some(hw) = n.hw.as_ref() {
        if hw.bench_status == BenchStatus::Failed {
            out.push(reason(
                HealthKind::BenchFailed,
                "The last benchmark failed".to_owned(),
                None,
                None,
                None,
            ));
        }
        if let Some(e) = hw
            .bench_error
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            out.push(reason(
                HealthKind::BenchError,
                format!("Benchmark error: {e}"),
                None,
                None,
                None,
            ));
        }
        for m in BenchMetric::ALL {
            let (Some(x), Some(min)) = (m.of(hw), m.minimum(n.tier)) else {
                continue;
            };
            // Provisioned sizes (cores, RAM, SSD) sit at the minimum by design and never
            // drift: only one below the minimum is a problem. Measured figures (CPU, disk,
            // bandwidth) vary from run to run, so being close to the minimum is too.
            let limit = if m.fluctuates() {
                min * (1.0 + HEADROOM)
            } else {
                min
            };
            if x < limit {
                let detail = if x < min {
                    format!(
                        "{} {} is below the {} minimum of {}",
                        metric_label(m),
                        fmt_num(x),
                        n.tier,
                        fmt_num(min)
                    )
                } else {
                    format!(
                        "{} {} is within 10% of the {} minimum of {}",
                        metric_label(m),
                        fmt_num(x),
                        n.tier,
                        fmt_num(min)
                    )
                };
                out.push(reason(
                    HealthKind::LowHeadroom,
                    detail,
                    Some(m.as_str()),
                    Some(x),
                    Some(min),
                ));
            }
        }
    }
    if let Some(left) = expires_in.filter(|b| *b < EXPIRY_SOON_BLOCKS) {
        out.push(reason(
            HealthKind::ExpiringSoon,
            format!(
                "{left} blocks (about {} min) left to confirm before the node expires",
                u64::from(left) * BLOCK_MS / 60_000
            ),
            Some("blocks_left"),
            Some(f64::from(left)),
            Some(f64::from(EXPIRY_SOON_BLOCKS)),
        ));
    }
    if n.status == NodeStatus::Dos {
        out.push(reason(
            HealthKind::Dos,
            "On the DOS list: it failed to confirm and is banned for a while".to_owned(),
            None,
            None,
            None,
        ));
    }
    if n.reachable == Some(false) {
        out.push(reason(
            HealthKind::Unreachable,
            "The node's API did not answer the last crawl".to_owned(),
            None,
            None,
            None,
        ));
    }
    out
}

fn fmt_num(x: f64) -> String {
    if (x - x.round()).abs() < 1e-9 {
        format!("{x:.0}")
    } else {
        format!("{x:.1}")
    }
}

// ---------------------------------------------------------------------------------------------
// Benchmarks, concentration, apps
// ---------------------------------------------------------------------------------------------

/// Per tier the fleet runs and per metric any of its nodes measured: the fleet's median and
/// minimum against the network's percentiles and the tier minimum.
pub fn benchmarks(active: &[&NodeRecord], net: &WalletNetwork) -> Vec<WalletBenchmark> {
    let mut out = Vec::new();
    for (t, tier) in Tier::ALL.iter().enumerate() {
        let fleet: Vec<&NodeRecord> = active.iter().copied().filter(|n| n.tier == *tier).collect();
        if fleet.is_empty() {
            continue;
        }
        for (m, metric) in BenchMetric::ALL.iter().enumerate() {
            let mut vals: Vec<f64> = fleet
                .iter()
                .filter_map(|n| n.hw.as_ref().and_then(|h| metric.of(h)))
                .collect();
            if vals.is_empty() {
                continue;
            }
            vals.sort_by(f64::total_cmp);
            out.push(WalletBenchmark {
                tier: *tier,
                metric: *metric,
                network: net.bench[t][m].unwrap_or_default(),
                fleet_median: quantile(&vals, 0.5).unwrap_or_default(),
                fleet_min: vals[0],
                minimum: metric.minimum(*tier),
                fleet_nodes: vals.len() as u32,
            });
        }
    }
    out
}

/// Groups `items` (key, label) into buckets, largest first; `None` keys land in `unknown`.
/// The index and top share are over the known keys.
pub fn group(
    by: ConcentrationBy,
    items: impl Iterator<Item = Option<(String, String)>>,
) -> WalletConcentration {
    let mut known: BTreeMap<String, (HashMap<String, u32>, u32)> = BTreeMap::new();
    let mut unknown = 0u32;
    for it in items {
        match it {
            Some((k, label)) => {
                let e = known.entry(k).or_default();
                *e.0.entry(label).or_default() += 1;
                e.1 += 1;
            }
            None => unknown += 1,
        }
    }
    let counts: Vec<u32> = known.values().map(|e| e.1).collect();
    let total: u32 = counts.iter().sum();
    let top = counts.iter().copied().max().unwrap_or(0);
    let mut buckets: Vec<ConcentrationBucket> = known
        .into_iter()
        .map(|(key, (labels, nodes))| {
            let label = labels
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map_or_else(|| key.clone(), |(l, _)| l);
            ConcentrationBucket { key, label, nodes }
        })
        .collect();
    buckets.sort_by(|a, b| b.nodes.cmp(&a.nodes).then_with(|| a.key.cmp(&b.key)));
    if unknown > 0 {
        buckets.push(ConcentrationBucket {
            key: "unknown".to_owned(),
            label: "Unknown".to_owned(),
            nodes: unknown,
        });
    }
    WalletConcentration {
        by,
        buckets,
        hhi: hhi(&counts, total),
        top_share: if total == 0 {
            0.0
        } else {
            f64::from(top) / f64::from(total)
        },
    }
}

fn text(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// The confirmed fleet by country, city and provider.
pub fn concentration(active: &[&NodeRecord]) -> Vec<WalletConcentration> {
    let country = active.iter().map(|n| {
        let g = n.geo.as_ref()?;
        let cc = text(&g.country_code)?;
        Some((cc.to_owned(), text(&g.country).unwrap_or(cc).to_owned()))
    });
    let city = active.iter().map(|n| {
        let g = n.geo.as_ref()?;
        let city = text(&g.city)?;
        let cc = text(&g.country_code).unwrap_or("");
        Some((format!("{cc}/{}", city.to_lowercase()), city.to_owned()))
    });
    let provider = active.iter().map(|n| {
        let k = ProviderKey::of(n)?;
        let label = n
            .geo
            .as_ref()
            .and_then(|g| text(&g.org))
            .map_or_else(|| k.key(), str::to_owned);
        Some((k.key(), label))
    });
    vec![
        group(ConcentrationBy::Country, country),
        group(ConcentrationBy::City, city),
        group(ConcentrationBy::Provider, provider),
    ]
}

/// Apps with an instance on the fleet, most instances first.
pub fn apps<S: std::hash::BuildHasher>(
    nodes: &[&NodeRecord],
    hosted: &HashMap<u32, Vec<AppRef>, S>,
) -> WalletApps {
    let mut by_app: BTreeMap<&str, (&str, Vec<String>)> = BTreeMap::new();
    let mut instances = 0u32;
    for n in nodes {
        for a in hosted.get(&n.id.0).map_or(&[][..], Vec::as_slice) {
            instances += 1;
            by_app
                .entry(a.name.as_str())
                .or_insert_with(|| (a.display_name.as_str(), Vec::new()))
                .1
                .push(node_key(n));
        }
    }
    let mut apps: Vec<WalletApp> = by_app
        .into_iter()
        .map(|(name, (display, keys))| WalletApp {
            name: name.to_owned(),
            display_name: display.to_owned(),
            instances: keys.len() as u32,
            node_keys: keys,
        })
        .collect();
    apps.sort_by(|a, b| {
        b.instances
            .cmp(&a.instances)
            .then_with(|| a.name.cmp(&b.name))
    });
    WalletApps { instances, apps }
}

#[cfg(test)]
mod tests {
    use atlas_core::emission::{PON_ACTIVATION_HEIGHT, REDUCTION_INTERVAL};
    use atlas_core::ids::{Hash32, NodeId, Outpoint};
    use atlas_core::node::{Geo, Hardware, Versions};

    use super::*;

    fn net(queues: [u32; 3]) -> WalletNetwork {
        WalletNetwork {
            tier_active: queues,
            queue_len: queues,
            ..WalletNetwork::default()
        }
    }

    fn node(id: u32, tier: Tier) -> NodeRecord {
        NodeRecord {
            id: NodeId(id),
            outpoint: Outpoint::new(Hash32([id as u8; 32]), id),
            tier,
            status: NodeStatus::Confirmed,
            ..NodeRecord::default()
        }
    }

    #[test]
    fn run_rate_matches_queue_math() {
        // 210 Stratus nodes in a 1,760-node queue: each paid 9 FLUX every 1,760 blocks.
        let n = net([3_389, 1_586, 1_760]);
        let r = run_rate([0, 0, 210], &n, 3_000_000);
        let want = 210.0 * 9.0 * 2_880.0 / 1_760.0;
        assert!((r.to_flux_f64() - want).abs() < 1e-6, "{r}");
        // Mixed tiers add up.
        let r = run_rate([2, 1, 0], &n, 3_000_000);
        let want = 2.0 * 2_880.0 / 3_389.0 + 3.5 * 2_880.0 / 1_586.0;
        assert!((r.to_flux_f64() - want).abs() < 1e-6, "{r}");
        assert_eq!(run_rate([0, 0, 0], &n, 3_000_000), Amount::ZERO);
    }

    #[test]
    fn projection_steps_down_at_each_reduction() {
        let n = net([1_000, 1_000, 1_000]);
        let r1 = PON_ACTIVATION_HEIGHT + REDUCTION_INTERVAL;
        // Ten days before the first reduction, at midnight.
        let tip = r1 - 10 * BLOCKS_PER_DAY;
        let tip_ms = 1_790_000_000_000 / DAY_MS * DAY_MS;
        let p = projection([0, 0, 100], &n, tip, tip_ms, tip_ms);
        assert_eq!(p.len(), 365);
        let full = 100.0 * 9.0 * 2_880.0 / 1_000.0;
        assert!((p[0].native.to_flux_f64() - full).abs() < 1e-6);
        assert!((p[9].native.to_flux_f64() - full).abs() < 1e-6);
        // Day 10 starts at the reduction: 8.1 FLUX a payment from there on.
        assert!((p[10].native.to_flux_f64() - full * 0.9).abs() < 1e-6);
        assert!((p[364].native.to_flux_f64() - full * 0.9).abs() < 1e-6);
        assert_eq!(
            p[10].pa, p[10].native,
            "parallel assets accrue at the native rate"
        );
        assert_eq!(p[1].day_ms - p[0].day_ms, DAY_MS);
        // A day the reduction falls into is split at its height.
        let p = projection([0, 0, 100], &n, tip + 1_440, tip_ms, tip_ms);
        let split = 100.0 * (1_440.0 * 9.0 + 1_440.0 * 8.1) / 1_000.0;
        assert!(
            (p[9].native.to_flux_f64() - split).abs() < 1e-6,
            "{}",
            p[9].native
        );
    }

    #[test]
    fn missed_payments_follow_the_queue() {
        // Paid every 100 blocks from 1,000: nothing missed.
        assert_eq!(
            missed_payments(100, 1_000, &[1_050, 1_150, 1_250], 1_350),
            0
        );
        // One payment skipped between 1,150 and 1,350.
        assert_eq!(
            missed_payments(100, 1_000, &[1_050, 1_150, 1_350], 1_450),
            1
        );
        // Never paid over 5 cycles.
        assert_eq!(missed_payments(100, 1_000, &[], 1_500), 4);
        // Drift of a fraction of a cycle is not a miss.
        assert_eq!(
            missed_payments(100, 1_000, &[1_090, 1_230, 1_360], 1_480),
            0
        );
        // A node that joined recently waits one cycle for its first payment.
        assert_eq!(missed_payments(100, 1_400, &[], 1_490), 0);
        // Payments before `start` are ignored.
        assert_eq!(missed_payments(100, 1_000, &[900, 1_050], 1_150), 0);
    }

    #[test]
    fn queue_slots_count_due_payments() {
        // Due at 1,000 every 100 blocks: 900, 800, ... are slots.
        assert_eq!(queue_slots(100, 500, 950, 1_000), 5); // 900 800 700 600 500
        assert_eq!(queue_slots(100, 501, 950, 1_000), 4);
        assert_eq!(queue_slots(100, 500, 850, 1_000), 4); // 800 down to 500
        assert_eq!(queue_slots(100, 950, 990, 1_000), 0);
        assert_eq!(queue_slots(100, 1_000, 1_100, 1_000), 0);
    }

    #[test]
    fn audit_attributes_names_and_pools() {
        let nw = net([100, 100, 100]);
        let e = |h: u32, tier: Tier, node: Option<u32>| PayoutEntry {
            height: h,
            amount: Amount::from_flux(1),
            tier,
            node: node.map(NodeId),
        };
        let mut a = node(1, Tier::Cumulus);
        a.rank = Some(49); // next due at tip + 50 = 1,550
        a.confirmed_height = Some(1);
        // Paid at 1,050 and 1,450; 1,150, 1,250 and 1,350 skipped.
        let entries = vec![
            e(1_050, Tier::Cumulus, None),
            e(1_450, Tier::Cumulus, Some(1)),
        ];
        let (exp, rec, missed) = payment_audit(Some((1_000, 1_500)), 1_500, &entries, &[&a], &nw);
        assert_eq!(
            (exp, rec),
            (5, 2),
            "the lone Cumulus node owns the unattributed payout"
        );
        assert_eq!(missed.len(), 1);
        assert_eq!((missed[0].expected, missed[0].received), (5, 2));
        // Two Cumulus nodes and an unattributed payout: counted, not named.
        let mut b = node(2, Tier::Cumulus);
        b.rank = Some(99);
        b.confirmed_height = Some(1);
        let entries = vec![
            e(1_050, Tier::Cumulus, None),
            e(1_100, Tier::Cumulus, Some(2)),
            e(1_450, Tier::Cumulus, Some(1)),
        ];
        let (exp, rec, missed) =
            payment_audit(Some((1_000, 1_500)), 1_500, &entries, &[&a, &b], &nw);
        assert!(missed.is_empty());
        assert_eq!(rec, 3);
        // Slots: a at 1,450 1,350 1,250 1,150 1,050; b at 1,500 1,400 ... 1,000.
        assert_eq!(exp, 11);
        // No stored blocks: nothing known.
        assert_eq!(
            payment_audit(None, 1_500, &entries, &[&a], &nw),
            (0, 0, Vec::new())
        );
    }

    #[test]
    fn earnings_days_and_audit() {
        let tip = 3_000_000u32;
        let tip_ms = 1_790_000_000_000u64 / DAY_MS * DAY_MS + 12 * 3_600_000;
        let ledger = PayoutLedger::for_tests(tip, tip - 2 * BLOCKS_PER_DAY, tip_ms);
        let e = |h: u32, tier: Tier, flux: i64, node: Option<u32>| PayoutEntry {
            height: h,
            amount: Amount::from_flux(flux),
            tier,
            node: node.map(NodeId),
        };
        let entries = vec![
            e(tip - 2 * BLOCKS_PER_DAY + 10, Tier::Stratus, 9, Some(1)),
            e(tip - 100, Tier::Stratus, 9, Some(1)),
            e(tip - 50, Tier::Cumulus, 1, None),
        ];
        let today = tip_ms / DAY_MS * DAY_MS;
        let days = earnings_days(&ledger, &entries, tip, tip_ms, today);
        assert_eq!(days.len(), 3, "{days:?}");
        assert_eq!(days.last().unwrap().day_ms, today);
        assert_eq!(days.iter().map(|d| d.payments).sum::<u32>(), 3);
        let last = days.last().unwrap();
        assert_eq!(last.native, Amount::from_flux(10));
        assert_eq!(
            (last.stratus, last.cumulus),
            (Amount::from_flux(9), Amount::from_flux(1))
        );
        assert_eq!(days[0].native, Amount::from_flux(9));
        // Each day's parallel assets are the rule applied to what the main chain paid that day.
        for d in &days {
            assert_eq!(d.pa, parallel_asset_accrual(d.native));
        }
        assert_eq!(last.pa, Amount::from_flux(10));
        assert_eq!(days[1].pa, Amount::ZERO);
    }

    /// A confirmed Cumulus node with nothing measured.
    fn d_ok() -> NodeRecord {
        node(3, Tier::Cumulus)
    }

    #[test]
    fn health_reasons_cover_each_rule() {
        let mut nw = net([10, 10, 10]);
        nw.dominant_flux_os = Some("8.20.0".into());
        nw.dominant_bench = Some("6.3.1".into());
        let mut n = node(1, Tier::Cumulus);
        n.versions = Versions {
            flux_os: Some("8.20.0".into()),
            bench: Some("6.3.1".into()),
            ..Versions::default()
        };
        n.hw = Some(Hardware {
            cores: 4,
            ram_gb: 7.5,
            ssd_gb: 240.0,
            eps: 500.0,
            disk_write_mbs: 400.0,
            down_mbps: 300.0,
            up_mbps: 300.0,
            bench_status: BenchStatus::Passed,
            ..Hardware::default()
        });
        n.reachable = Some(true);
        assert!(
            health_reasons(&n, &nw, Some(600)).is_empty(),
            "healthy at the minimum sizes"
        );

        n.versions.flux_os = Some("8.9.0".into());
        n.versions.bench = Some("6.10.0".into()); // newer than the network: fine
        let hw = n.hw.as_mut().unwrap();
        hw.eps = 250.0; // within 10% of 240
        hw.ram_gb = 6.0; // below 7
        hw.up_mbps = 20.0; // below 25
        hw.bench_status = BenchStatus::Failed;
        hw.bench_error = Some("disk too slow".into());
        n.reachable = Some(false);
        let r = health_reasons(&n, &nw, Some(100));
        assert!(
            health_reasons(&d_ok(), &nw, Some(140)).is_empty(),
            "on schedule"
        );
        let kinds: Vec<HealthKind> = r.iter().map(|x| x.kind).collect();
        assert_eq!(
            kinds
                .iter()
                .filter(|k| **k == HealthKind::VersionOutdated)
                .count(),
            1,
            "{r:?}"
        );
        assert!(kinds.contains(&HealthKind::BenchFailed));
        assert!(kinds.contains(&HealthKind::BenchError));
        assert!(kinds.contains(&HealthKind::ExpiringSoon));
        assert!(kinds.contains(&HealthKind::Unreachable));
        let low: Vec<&str> = r
            .iter()
            .filter(|x| x.kind == HealthKind::LowHeadroom)
            .filter_map(|x| x.metric.as_deref())
            .collect();
        assert_eq!(low, ["eps", "up_mbps", "ram_gb"], "{r:?}");
        let eps = r
            .iter()
            .find(|x| x.metric.as_deref() == Some("eps"))
            .unwrap();
        assert_eq!((eps.value, eps.threshold), (Some(250.0), Some(240.0)));
        let exp = r
            .iter()
            .find(|x| x.kind == HealthKind::ExpiringSoon)
            .unwrap();
        assert_eq!(exp.value, Some(100.0));

        let mut d = node(2, Tier::Nimbus);
        d.status = NodeStatus::Dos;
        let r = health_reasons(&d, &nw, None);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].kind, HealthKind::Dos);
    }

    #[test]
    fn concentration_and_hhi() {
        let geo = |cc: &str, city: &str, asn: u32, org: &str| Geo {
            country_code: cc.into(),
            country: cc.into(),
            city: city.into(),
            asn: Some(asn),
            org: org.into(),
            ..Geo::default()
        };
        let mut nodes: Vec<NodeRecord> = (0..4).map(|i| node(i, Tier::Stratus)).collect();
        nodes[0].geo = Some(geo("DE", "Nuremberg", 24940, "Hetzner Online GmbH"));
        nodes[1].geo = Some(geo("DE", "Falkenstein", 24940, "Hetzner Online GmbH"));
        nodes[2].geo = Some(geo("FI", "Helsinki", 24940, "Hetzner Online"));
        let refs: Vec<&NodeRecord> = nodes.iter().collect();
        let c = concentration(&refs);
        let country = &c[0];
        assert_eq!(country.by, ConcentrationBy::Country);
        assert_eq!(country.buckets[0].key, "DE");
        assert_eq!(country.buckets[0].nodes, 2);
        assert_eq!(country.buckets.last().unwrap().key, "unknown");
        // Known: DE 2, FI 1 of 3.
        assert!((country.hhi - (4.0 / 9.0 + 1.0 / 9.0)).abs() < 1e-9);
        assert!((country.top_share - 2.0 / 3.0).abs() < 1e-9);
        let provider = &c[2];
        assert_eq!(provider.buckets[0].key, "AS24940");
        assert_eq!(provider.buckets[0].label, "Hetzner Online GmbH");
        assert!((provider.hhi - 1.0).abs() < 1e-9, "one provider: 1");
        assert!((provider.top_share - 1.0).abs() < 1e-9);
        let city = &c[1];
        assert_eq!(city.buckets.len(), 4);
        // Nothing known.
        let none = group(ConcentrationBy::City, std::iter::once(None));
        assert_eq!((none.hhi, none.top_share), (0.0, 0.0));
    }

    #[test]
    fn apps_group_instances() {
        let nodes: Vec<NodeRecord> = (0..3).map(|i| node(i, Tier::Cumulus)).collect();
        let refs: Vec<&NodeRecord> = nodes.iter().collect();
        let r = |n: &str| AppRef {
            name: n.into(),
            display_name: n.to_uppercase(),
        };
        let mut hosted = HashMap::new();
        hosted.insert(0, vec![r("web"), r("db")]);
        hosted.insert(2, vec![r("web")]);
        hosted.insert(9, vec![r("other")]);
        let a = apps(&refs, &hosted);
        assert_eq!(a.instances, 3);
        assert_eq!(a.apps[0].name, "web");
        assert_eq!(a.apps[0].instances, 2);
        assert_eq!(a.apps[0].display_name, "WEB");
        assert_eq!(a.apps[0].node_keys.len(), 2);
        assert_eq!(a.apps[1].name, "db");
    }
}

//! What every wallet is measured against, computed once per publish ([`WalletNetwork`]): tier
//! sizes and queue lengths, the operator ranking, the dominant versions and the benchmark
//! percentiles per tier.

use std::collections::HashMap;

use atlas_core::api::{BenchMetric, Percentiles};
use atlas_core::{NodeRecord, Tier};

use crate::views::Views;

/// Network-wide figures of one publish (see the module docs). Confirmed nodes only.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct WalletNetwork {
    /// Confirmed nodes per tier (Cumulus, Nimbus, Stratus).
    pub tier_active: [u32; 3],
    /// Payment queue length per tier: blocks between two payments of one node.
    pub queue_len: [u32; 3],
    /// Confirmed node count of every payment address, largest first.
    pub operator_counts: Vec<u32>,
    /// The FluxOS and fluxbench versions most confirmed nodes run.
    pub dominant_flux_os: Option<String>,
    pub dominant_bench: Option<String>,
    /// Benchmark percentiles per tier and metric (`BenchMetric::ALL` order); `None` when no
    /// node of the tier measured the metric.
    pub bench: [[Option<Percentiles>; 7]; 3],
}

impl WalletNetwork {
    pub fn build(v: &Views) -> Self {
        let nodes = v.nodes();
        let mut tier_active = [0u32; 3];
        let mut by_address: HashMap<&str, u32> = HashMap::new();
        let mut flux_os: HashMap<&str, u32> = HashMap::new();
        let mut bench_v: HashMap<&str, u32> = HashMap::new();
        let mut values: [[Vec<f64>; 7]; 3] = Default::default();
        for n in nodes.iter().filter(|n| n.status.is_active()) {
            if let Some(t) = n.tier.index() {
                tier_active[t] += 1;
                if let Some(hw) = n.hw.as_ref() {
                    for (m, metric) in BenchMetric::ALL.iter().enumerate() {
                        if let Some(x) = metric.of(hw) {
                            values[t][m].push(x);
                        }
                    }
                }
            }
            if !n.payment_address.is_empty() {
                *by_address.entry(n.payment_address.as_str()).or_default() += 1;
            }
            if let Some(s) = n.versions.flux_os.as_deref().filter(|s| !s.is_empty()) {
                *flux_os.entry(s).or_default() += 1;
            }
            if let Some(s) = n.versions.bench.as_deref().filter(|s| !s.is_empty()) {
                *bench_v.entry(s).or_default() += 1;
            }
        }
        let mut operator_counts: Vec<u32> = by_address.into_values().collect();
        operator_counts.sort_unstable_by(|a, b| b.cmp(a));
        let mut bench: [[Option<Percentiles>; 7]; 3] = Default::default();
        for (t, per_tier) in values.iter_mut().enumerate() {
            for (m, vals) in per_tier.iter_mut().enumerate() {
                vals.sort_by(f64::total_cmp);
                bench[t][m] = percentiles(vals);
            }
        }
        Self {
            tier_active,
            queue_len: Tier::ALL.map(|t| v.index.queue(t).len() as u32),
            operator_counts,
            dominant_flux_os: dominant(flux_os),
            dominant_bench: dominant(bench_v),
            bench,
        }
    }

    /// 1-based rank of an address with `count` confirmed nodes (ties share the best rank);
    /// `None` for 0.
    pub fn operator_rank(&self, count: u32) -> Option<u32> {
        if count == 0 {
            return None;
        }
        // `operator_counts` is descending: the addresses with strictly more nodes come first.
        let above = self.operator_counts.partition_point(|&c| c > count);
        Some(above as u32 + 1)
    }

    /// Queue length of `tier`, at least 1.
    pub fn cycle(&self, tier: Tier) -> u32 {
        tier.index().map_or(1, |t| self.queue_len[t].max(1))
    }
}

/// The most common value (ties: the highest version string, so a release wave in progress
/// settles on the newer one).
fn dominant(counts: HashMap<&str, u32>) -> Option<String> {
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| compare_versions(a.0, b.0)))
        .map(|(v, _)| v.to_owned())
}

/// Numeric dotted-version order (`8.9.0 < 8.20.0`); non-numeric parts compare as text.
pub fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let mut lhs = left.trim().split(['.', '-', '+']);
    let mut rhs = right.trim().split(['.', '-', '+']);
    loop {
        match (lhs.next(), rhs.next()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(l), Some(r)) => {
                let order = match (l.parse::<u64>(), r.parse::<u64>()) {
                    (Ok(m), Ok(n)) => m.cmp(&n),
                    _ => l.cmp(r),
                };
                if order.is_ne() {
                    return order;
                }
            }
        }
    }
}

/// Linear-interpolated quantile `q` (0..1) of ascending `sorted` values.
pub fn quantile(sorted: &[f64], q: f64) -> Option<f64> {
    let n = sorted.len();
    if n == 0 {
        return None;
    }
    let pos = q.clamp(0.0, 1.0) * (n - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    let frac = pos - lo as f64;
    Some(sorted[lo] + (sorted[hi] - sorted[lo]) * frac)
}

/// 10th, 50th and 90th percentiles of ascending `sorted` values.
pub fn percentiles(sorted: &[f64]) -> Option<Percentiles> {
    Some(Percentiles {
        p10: quantile(sorted, 0.1)?,
        p50: quantile(sorted, 0.5)?,
        p90: quantile(sorted, 0.9)?,
    })
}

/// Confirmed nodes of `nodes`.
pub fn confirmed<'a>(nodes: &'a [&'a NodeRecord]) -> impl Iterator<Item = &'a NodeRecord> + 'a {
    nodes.iter().copied().filter(|n| n.status.is_active())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantiles_interpolate() {
        let v: Vec<f64> = (1..=11).map(f64::from).collect();
        let p = percentiles(&v).unwrap();
        assert!((p.p10 - 2.0).abs() < 1e-9);
        assert!((p.p50 - 6.0).abs() < 1e-9);
        assert!((p.p90 - 10.0).abs() < 1e-9);
        assert_eq!(quantile(&[], 0.5), None);
        assert_eq!(quantile(&[4.0], 0.9), Some(4.0));
        // Between two values.
        assert!((quantile(&[0.0, 10.0], 0.25).unwrap() - 2.5).abs() < 1e-9);
    }

    #[test]
    fn version_order_is_numeric() {
        use std::cmp::Ordering::*;
        assert_eq!(compare_versions("8.9.0", "8.20.0"), Less);
        assert_eq!(compare_versions("8.20.0", "8.20.0"), Equal);
        assert_eq!(compare_versions("8.20.1", "8.20"), Greater);
        assert_eq!(compare_versions("6.3.1", "6.10.0"), Less);
        let mut m = HashMap::new();
        m.insert("8.19.0", 10);
        m.insert("8.20.0", 10);
        m.insert("8.18.0", 3);
        assert_eq!(
            dominant(m).as_deref(),
            Some("8.20.0"),
            "ties go to the newer"
        );
    }

    #[test]
    fn operator_ranks_share_ties() {
        let n = WalletNetwork {
            operator_counts: vec![300, 210, 210, 5, 1, 1],
            ..WalletNetwork::default()
        };
        assert_eq!(n.operator_rank(300), Some(1));
        assert_eq!(n.operator_rank(210), Some(2));
        assert_eq!(n.operator_rank(5), Some(4));
        assert_eq!(n.operator_rank(1), Some(5));
        assert_eq!(n.operator_rank(0), None);
        // A count no address has ranks below every larger one.
        assert_eq!(n.operator_rank(400), Some(1));
    }
}

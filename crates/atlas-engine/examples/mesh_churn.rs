//! Mesh churn from a stopped server's store (or a copy of it): per topology call, the links
//! added and removed (median, p95, max, by queried host), and how many removed links come back
//! within 10 and 30 minutes.
//!
//! ```text
//! cargo run --release -p atlas-engine --example mesh_churn -- <atlas.redb> [skip_min=15] [span_min=all] [from_ms]
//! ```
//!
//! `skip_min` and `span_min` count from the first call at or after `from_ms` (for example the
//! server's start, so a copied store's older history is left out). Calls are the `topology_swept` events (one per `/flux/topology` call; a call the outlier rule
//! discarded counts with 0 added and 0 removed). Removals are every mesh change in the span
//! (topology calls and report expiry); a removal counts as returned when the same link is added
//! again within the window, and only removals at least one window before the end are judged.
#![allow(
    clippy::unwrap_used,
    clippy::too_many_lines,
    clippy::cast_precision_loss
)]

use std::collections::{BTreeMap, HashMap};

use atlas_core::event::Event;
use atlas_store::{EventKey, Order, Store};

fn pct(v: &[u32], p: f64) -> u32 {
    if v.is_empty() {
        return 0;
    }
    let i = ((v.len() - 1) as f64 * p).round() as usize;
    v[i]
}

fn summary(name: &str, v: &mut [u32]) {
    v.sort_unstable();
    let sum: u64 = v.iter().map(|x| u64::from(*x)).sum();
    println!(
        "{name}: calls {} median {} p95 {} max {} mean {:.0} total {}",
        v.len(),
        pct(v, 0.5),
        pct(v, 0.95),
        v.last().copied().unwrap_or(0),
        sum as f64 / v.len().max(1) as f64,
        sum
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args
        .get(1)
        .expect("usage: mesh_churn <atlas.redb> [skip_min] [span_min]");
    let skip_min: u64 = args.get(2).map_or(15, |s| s.parse().unwrap());
    let span_min: Option<u64> = args
        .get(3)
        .filter(|s| *s != "all")
        .map(|s| s.parse().unwrap());
    let from_ms: u64 = args.get(4).map_or(0, |s| s.parse().unwrap());
    let st = Store::open(path).unwrap();

    let calls = st.events(.., Order::Asc, usize::MAX).unwrap();
    let swept: Vec<(u64, String, u32, u32, u32)> = calls
        .iter()
        .filter_map(|(k, e)| match &e.event {
            Event::TopologySwept {
                reporter,
                reporters,
                edges_added,
                edges_removed,
            } => Some((
                k.ts_ms,
                reporter.to_string(),
                *reporters,
                *edges_added,
                *edges_removed,
            )),
            _ => None,
        })
        .collect();
    let Some(first) = swept.iter().map(|s| s.0).find(|t| *t >= from_ms) else {
        println!("no topology calls");
        return;
    };
    let start = first + skip_min * 60_000;
    let end = span_min.map_or(u64::MAX, |m| start + m * 60_000);
    let in_span: Vec<_> = swept
        .iter()
        .filter(|s| s.0 >= start && s.0 <= end)
        .collect();
    let last = in_span.last().map_or(start, |s| s.0);
    println!(
        "span {:.0} min from {} ({} calls)",
        (last - start) as f64 / 60_000.0,
        start,
        in_span.len()
    );
    let mut added: Vec<u32> = in_span.iter().map(|s| s.3).collect();
    let mut removed: Vec<u32> = in_span.iter().map(|s| s.4).collect();
    summary("added per call", &mut added);
    summary("removed per call", &mut removed);
    let discarded = in_span
        .iter()
        .filter(|s| s.3 == 0 && s.4 == 0 && s.2 > 0)
        .count();
    println!("calls with no change (incl. discarded outliers): {discarded}");
    let mut by_host: BTreeMap<String, (u32, u64, u32)> = BTreeMap::new();
    for s in &in_span {
        let host = s.1.rsplit_once(':').map_or(s.1.as_str(), |(h, _)| h);
        let e = by_host.entry(host.to_owned()).or_default();
        e.0 += 1;
        e.1 += u64::from(s.3);
        e.2 = e.2.max(s.3);
    }
    let mut hosts: Vec<_> = by_host.into_iter().collect();
    hosts.sort_by_key(|h| std::cmp::Reverse(h.1.1));
    println!("top hosts by links added (calls, added, max per call):");
    for (h, (c, a, m)) in hosts.iter().take(8) {
        println!("  {h:<18} {c:>3} {a:>7} {m:>6}");
    }

    // Removals and returns, from the mesh change log.
    let changes = st
        .mesh_changes(
            EventKey::first_at(start)..=EventKey::last_at(end),
            Order::Asc,
            usize::MAX,
        )
        .unwrap();
    let mut adds: HashMap<(u32, u32), Vec<u64>> = HashMap::new();
    let mut removals: Vec<((u32, u32), u64)> = Vec::new();
    let mut readds = [0u64; 2];
    let mut last_removed: HashMap<(u32, u32), u64> = HashMap::new();
    let mut total_adds = 0u64;
    let mut change_end = start;
    for (k, c) in &changes {
        change_end = change_end.max(k.ts_ms);
        for (a, b) in &c.added {
            let key = (a.0, b.0);
            total_adds += 1;
            if let Some(t) = last_removed.get(&key) {
                for (i, w) in [10u64, 30].iter().enumerate() {
                    if k.ts_ms - t <= w * 60_000 {
                        readds[i] += 1;
                    }
                }
            }
            adds.entry(key).or_default().push(k.ts_ms);
        }
        for (a, b) in &c.removed {
            let key = (a.0, b.0);
            removals.push((key, k.ts_ms));
            last_removed.insert(key, k.ts_ms);
        }
    }
    println!(
        "mesh changes: {} rows, {} links added, {} removed",
        changes.len(),
        total_adds,
        removals.len()
    );
    for (i, w) in [10u64, 30].iter().enumerate() {
        let win = w * 60_000;
        let (mut eligible, mut back) = (0u64, 0u64);
        for (key, t) in &removals {
            if t + win > change_end {
                continue;
            }
            eligible += 1;
            if adds
                .get(key)
                .is_some_and(|v| v.iter().any(|a| *a > *t && *a <= t + win))
            {
                back += 1;
            }
        }
        println!(
            "removed links back within {w} min: {back}/{eligible} ({:.1}%); adds re-adding a link removed in the previous {w} min: {} ({:.1}%)",
            100.0 * back as f64 / eligible.max(1) as f64,
            readds[i],
            100.0 * readds[i] as f64 / total_adds.max(1) as f64
        );
    }
}

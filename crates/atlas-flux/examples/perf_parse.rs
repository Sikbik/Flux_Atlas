//! Parse-time baseline over the full raw upstream dumps.
//!
//! `cargo run --release -p atlas-flux --example perf_parse -- [raw_dir]`
//!
//! The default raw dir is the research scratchpad. Each file is parsed several times and the
//! minimum and median are printed.
#![allow(clippy::unwrap_used, clippy::print_stdout)]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use atlas_flux::envelope::parse_envelope;
use atlas_flux::models::apps::{AppLocation, PermanentMessage, RawAppSpec};
use atlas_flux::models::nodes::{NodeListEntry, rank_inversions};
use atlas_flux::models::stats::StatsNodeRow;
use serde::de::DeserializeOwned;

const DEFAULT_RAW: &str = "/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/team/raw/flux";

fn time<T, F: FnMut() -> T>(runs: usize, mut f: F) -> (Duration, Duration, T) {
    let mut times = Vec::with_capacity(runs);
    let mut last = None;
    for _ in 0..runs {
        let t = Instant::now();
        last = Some(f());
        times.push(t.elapsed());
    }
    times.sort();
    (times[0], times[times.len() / 2], last.unwrap())
}

fn bench<T: DeserializeOwned>(
    dir: &Path,
    file: &str,
    runs: usize,
    describe: impl Fn(&T) -> String,
) {
    let Ok(bytes) = std::fs::read(dir.join(file)) else {
        println!("{file:<45} missing, skipped");
        return;
    };
    let (min, med, v) = time(runs, || parse_envelope::<T>("perf", &bytes).unwrap());
    println!(
        "{file:<45} {:>7.2} MB  min {:>8.2} ms  median {:>8.2} ms  ({runs} runs)  {}",
        bytes.len() as f64 / 1e6,
        min.as_secs_f64() * 1e3,
        med.as_secs_f64() * 1e3,
        describe(&v)
    );
}

fn main() {
    let dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| DEFAULT_RAW.to_owned()),
    );
    println!("raw dir: {}", dir.display());
    bench::<Vec<NodeListEntry>>(&dir, "daemon_viewdeterministicfluxnodelist.json", 30, |v| {
        format!("{} nodes", v.len())
    });
    if let Ok(bytes) = std::fs::read(dir.join("daemon_viewdeterministicfluxnodelist.json")) {
        let (min, med, (n, inv)) = time(30, || {
            let v: Vec<NodeListEntry> = parse_envelope("perf", &bytes).unwrap();
            let nodes: Vec<_> = v.iter().filter_map(NodeListEntry::normalize).collect();
            (nodes.len(), rank_inversions(&nodes))
        });
        println!(
            "{:<45} {:>10}  min {:>8.2} ms  median {:>8.2} ms  (30 runs)  {n} normalized, {inv} rank inversions",
            "  node list parse + normalize + rank check",
            "",
            min.as_secs_f64() * 1e3,
            med.as_secs_f64() * 1e3
        );
    }
    bench::<Vec<RawAppSpec>>(&dir, "apps_globalappsspecifications.json", 10, |v| {
        let n: usize = v.iter().map(|s| s.normalize().components.len()).sum();
        format!("{} apps, {n} components", v.len())
    });
    bench::<Vec<AppLocation>>(&dir, "apps_locations.json", 10, |v| {
        format!("{} instances", v.len())
    });
    bench::<Vec<StatsNodeRow>>(&dir, "stats_fluxinfo_projection_geo.json", 5, |v| {
        format!(
            "{} rows, {} located",
            v.len(),
            v.iter().filter(|r| r.geo().is_some()).count()
        )
    });
    bench::<Vec<StatsNodeRow>>(&dir, "stats_fluxinfo_projection_bench.json", 5, |v| {
        format!(
            "{} rows, {} with hardware",
            v.len(),
            v.iter().filter(|r| r.hardware().is_some()).count()
        )
    });
    bench::<Vec<StatsNodeRow>>(&dir, "stats_fluxinfo.json", 3, |v| {
        let unreachable = v.iter().filter(|r| !r.reachable()).count();
        format!("{} rows, {unreachable} unreachable placeholders", v.len())
    });
    bench::<Vec<PermanentMessage>>(&dir, "apps_permanentmessages.json", 1, |v| {
        let ok = v.iter().filter(|m| m.to_record().is_some()).count();
        format!("{} messages, {ok} normalized", v.len())
    });
}

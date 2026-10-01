//! Opens a City `.mmdb`, runs the install check, and looks up addresses.
//!
//! `cargo run --release -p atlas-geoip --example lookup -- <file.mmdb> [ip ...]`
//! Without addresses it reads one per line from stdin and prints coverage counts.

use std::io::BufRead;
use std::net::IpAddr;
use std::time::Instant;

use atlas_geoip::GeoIpDb;
use atlas_geoip::install::{Policy, check};

fn rss_kb() -> String {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .filter(|l| l.starts_with("VmRSS") || l.starts_with("RssAnon") || l.starts_with("RssFile"))
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join(", ")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("usage: lookup <file.mmdb> [ip ...]")?;
    println!("before open: {}", rss_kb());
    let t = Instant::now();
    let db = GeoIpDb::open(std::path::Path::new(&path))?;
    println!("open {:?}: {:?}", t.elapsed(), db.info());
    println!("after open: {}", rss_kb());
    let t = Instant::now();
    let checked = check(&db, &Policy::dbip_city_lite());
    println!("check {:?}: {checked:?}", t.elapsed());
    let ips: Vec<String> = args.collect();
    if ips.is_empty() {
        let (mut n, mut hit, mut city, mut coords) = (0, 0, 0, 0);
        let t = Instant::now();
        for line in std::io::stdin().lock().lines() {
            let Ok(ip) = line?.trim().parse::<IpAddr>() else {
                continue;
            };
            n += 1;
            if let Some(h) = db.lookup(ip) {
                hit += 1;
                city += usize::from(!h.city.is_empty());
                coords += usize::from(h.lat.is_some());
            }
        }
        println!(
            "{n} addresses in {:?}: {hit} records, {city} with a city, {coords} with coordinates",
            t.elapsed()
        );
    } else {
        for ip in ips {
            println!("{ip}: {:?}", db.lookup(ip.parse()?));
        }
    }
    println!("after lookups: {}", rss_kb());
    Ok(())
}

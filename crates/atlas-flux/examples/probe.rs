//! Fetches each primary upstream endpoint once, live, and prints parsed summaries.
//!
//! `cargo run -p atlas-flux --example probe`
//!
//! Polite by construction: every host is limited to 2 requests/s with no bursts, and about 45
//! requests are made in total (6 of them to one directly probed node, through the SSRF guard).
#![allow(clippy::unwrap_used, clippy::print_stdout, clippy::too_many_lines)]

use std::fmt::Display;
use std::future::Future;
use std::time::Instant;

use atlas_core::{Hash32, NodeEndpoint};
use atlas_flux::clients::{Clients, ClientsConfig, Conditional, MessageFilter};
use atlas_flux::decode::decode_block;
use atlas_flux::http::{HostPolicy, HttpConfig};
use atlas_flux::models::nodes::{NodeListEntry, rank_inversions};
use atlas_flux::ssrf::GuardedEndpoint;

struct Tally {
    ok: u32,
    err: u32,
}

async fn step<T, F, Fut, S>(t: &mut Tally, name: &str, f: F, summary: S) -> Option<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = atlas_flux::Result<T>>,
    S: FnOnce(&T) -> String,
{
    let started = Instant::now();
    match f().await {
        Ok(v) => {
            t.ok += 1;
            println!(
                "[ok ] {name:<34} {:>6} ms  {}",
                started.elapsed().as_millis(),
                summary(&v)
            );
            Some(v)
        }
        Err(e) => {
            t.err += 1;
            println!(
                "[err] {name:<34} {:>6} ms  {}",
                started.elapsed().as_millis(),
                short(&e)
            );
            None
        }
    }
}

fn short(e: &impl Display) -> String {
    let s = e.to_string();
    if s.len() > 140 {
        format!("{}...", &s[..140])
    } else {
        s
    }
}

#[tokio::main]
async fn main() {
    let mut http = HttpConfig::default();
    let polite = HostPolicy::new(2, 1, 1);
    for p in http.host_policies.values_mut() {
        *p = polite;
    }
    http.default_policy = polite;
    http.node_policy = polite;
    http.attempts = 1;
    let clients = Clients::new(ClientsConfig {
        http,
        ..ClientsConfig::default()
    })
    .unwrap();
    let (fx, ins, st) = (&clients.fluxos, &clients.insight, &clients.stats);
    let mut t = Tally { ok: 0, err: 0 };

    println!("== FluxOS gateway (api.runonflux.io)");
    let count = step(
        &mut t,
        "daemon/getblockcount",
        || fx.get_block_count(),
        |h| format!("height {h}"),
    )
    .await;
    let best = step(
        &mut t,
        "daemon/getbestblockhash",
        || fx.get_best_block_hash(),
        |h| format!("{h}"),
    )
    .await;
    if let Some(h) = count {
        step(
            &mut t,
            "daemon/getblockhash/<tip+1>?nc",
            || fx.get_block_hash(h + 1, true),
            |r| match r {
                Some(hash) => format!("next block already visible: {hash}"),
                None => "None (height out of range, uncached error as expected)".to_owned(),
            },
        )
        .await;
    }
    let mut decoded = None;
    if let Some(hash) = best {
        let hex = hash.to_string();
        if let Some(b) = step(
            &mut t,
            "daemon/getblock/<best>/2",
            || fx.get_block(&hex),
            |b| {
                format!(
                    "height {} txs {} type {:?} collateral {:?}",
                    b.height,
                    b.tx_count(),
                    b.kind,
                    b.collateral
                )
            },
        )
        .await
        {
            let d = decode_block(&b).unwrap();
            let s = &d.summary;
            println!(
                "      decoded: reward {} dev_fund {} fees {} confirms {} starts {} transfers {} app payments {} spent {}",
                s.reward,
                s.dev_fund,
                s.fees,
                s.confirm_count,
                s.start_count,
                s.transfer_count,
                d.app_payments.len(),
                d.spent.len()
            );
            for p in &s.payouts {
                println!(
                    "      payout {:<8} {} {}",
                    p.tier.to_string(),
                    p.amount,
                    p.address
                );
            }
            decoded = Some(d);
        }
        step(
            &mut t,
            "daemon/getblockdeltas/<best>",
            || fx.get_block_deltas(&hex),
            |d| format!("{} tx deltas", d.deltas.len()),
        )
        .await;
    }
    step(
        &mut t,
        "daemon/getblockchaininfo",
        || fx.get_blockchain_info(),
        |i| {
            format!(
                "blocks {} shielded {} FLUX",
                i.blocks,
                atlas_core::Amount(i.shielded_zat())
            )
        },
    )
    .await;
    step(
        &mut t,
        "daemon/gettxoutsetinfo",
        || fx.get_txout_set_info(),
        |s| format!("height {} transparent {:.2} FLUX", s.height, s.total_amount),
    )
    .await;
    step(
        &mut t,
        "daemon/fluxnodecurrentwinner?nc",
        || fx.fluxnode_current_winner(),
        |w| {
            w.0.iter()
                .map(|(k, v)| format!("{k}: {}", v.payment_address))
                .collect::<Vec<_>>()
                .join(", ")
        },
    )
    .await;
    step(
        &mut t,
        "daemon/getfluxnodecount",
        || fx.get_fluxnode_count(),
        |c| {
            format!(
                "total {} (c {} / n {} / s {})",
                c.total, c.cumulus, c.nimbus, c.stratus
            )
        },
    )
    .await;
    let list = step(
        &mut t,
        "daemon/viewdeterministicfluxnodelist",
        || fx.node_list(None),
        |v| {
            let nodes: Vec<_> = v.iter().filter_map(NodeListEntry::normalize).collect();
            let hosts: std::collections::HashSet<_> = nodes
                .iter()
                .filter_map(|n| n.endpoint.map(|e| e.ip))
                .collect();
            format!(
                "{} nodes, {} hosts, rank inversions {}",
                nodes.len(),
                hosts.len(),
                rank_inversions(&nodes)
            )
        },
    )
    .await;
    let sample_ip = list
        .as_ref()
        .and_then(|l| l.iter().find_map(|e| e.normalize()?.endpoint))
        .map(|e| e.ip.to_string());
    if let Some(ip) = &sample_ip {
        step(
            &mut t,
            "daemon/viewdeterministicfluxnodelist/<ip>",
            || fx.node_list(Some(ip)),
            |v| format!("{} nodes on {ip}", v.len()),
        )
        .await;
    }
    step(
        &mut t,
        "daemon/getstartlist",
        || fx.start_list(),
        |v| format!("{} starting", v.len()),
    )
    .await;
    step(
        &mut t,
        "daemon/getdoslist",
        || fx.dos_list(),
        |v| format!("{} dos", v.len()),
    )
    .await;
    let specs = step(
        &mut t,
        "apps/globalappsspecifications",
        || fx.global_app_specs(None),
        |c| match c {
            Conditional::Modified { value, etag } => {
                format!(
                    "{} apps, etag {}",
                    value.len(),
                    etag.as_deref().unwrap_or("-")
                )
            }
            Conditional::NotModified => "not modified".to_owned(),
        },
    )
    .await;
    if let Some(Conditional::Modified {
        etag: Some(tag), ..
    }) = &specs
    {
        step(
            &mut t,
            "apps/globalappsspecifications (etag)",
            || fx.global_app_specs(Some(tag)),
            |c| match c {
                Conditional::Modified { value, .. } => {
                    format!("modified again ({} apps)", value.len())
                }
                Conditional::NotModified => "304 not modified".to_owned(),
            },
        )
        .await;
    }
    let locations = step(
        &mut t,
        "apps/locations",
        || fx.app_locations(),
        |v| format!("{} instances", v.len()),
    )
    .await;
    if let Some(name) = locations
        .as_ref()
        .and_then(|l| l.first())
        .map(|l| l.name.clone())
    {
        step(
            &mut t,
            "apps/location/<name>",
            || fx.app_location(&name),
            |v| format!("{} instances of {name}", v.len()),
        )
        .await;
        step(
            &mut t,
            "apps/permanentmessages?appname=",
            || fx.permanent_messages(MessageFilter::AppName(&name)),
            |v| format!("{} messages for {name}", v.len()),
        )
        .await;
    }
    if let Some(p) = decoded.as_ref().and_then(|d| d.app_payments.first()) {
        let h = p.message_hash;
        step(
            &mut t,
            "apps/permanentmessages?hash=",
            || fx.permanent_messages(MessageFilter::Hash(&h)),
            |v| format!("{} message(s)", v.len()),
        )
        .await;
    }
    step(
        &mut t,
        "apps/temporarymessages",
        || fx.temporary_messages(),
        |v| format!("{} pending", v.len()),
    )
    .await;
    step(
        &mut t,
        "apps/installinglocations",
        || fx.installing_locations(),
        |v| format!("{} installing", v.len()),
    )
    .await;
    step(
        &mut t,
        "apps/installingerrorslocations",
        || fx.installing_error_locations(),
        |v| format!("{} install errors", v.len()),
    )
    .await;
    step(
        &mut t,
        "apps/deploymentinformation",
        || fx.deployment_information(),
        |d| format!("app address {}", d.address),
    )
    .await;

    println!("== Insight explorer (main, failover to mirrors)");
    if let Some(hash) = best {
        step(
            &mut t,
            "api/block/<best>",
            || ins.block(&hash),
            |b| {
                format!(
                    "height {} producer {:?} minedBy(stratus payee) {:?}",
                    b.height,
                    b.producer().map(|o| o.to_string()),
                    b.mined_by
                )
            },
        )
        .await;
        step(
            &mut t,
            "api/txs?block=<best>",
            || ins.block_txs(&hash, 0),
            |p| format!("{} txs on page 0 of {}", p.txs.len(), p.pages_total),
        )
        .await;
    }
    step(
        &mut t,
        "api/blocks?limit=5",
        || ins.blocks(5, None),
        |p| {
            p.blocks
                .iter()
                .map(|b| b.height.to_string())
                .collect::<Vec<_>>()
                .join(",")
        },
    )
    .await;
    if let Some(tx) = decoded
        .as_ref()
        .and_then(|d| d.node_txs.first())
        .map(|n| n.txid)
    {
        step(
            &mut t,
            "api/tx/<node tx>",
            || ins.tx(&tx),
            |x| {
                format!(
                    "{:?} {:?}",
                    x.kind,
                    x.node_tx().map(|n| (n.kind, n.collateral.to_string()))
                )
            },
        )
        .await;
    }
    if let Some(addr) = decoded
        .as_ref()
        .and_then(|d| d.summary.payouts.first())
        .map(|p| p.address.to_string())
    {
        step(
            &mut t,
            "api/addr/<payee>?noTxList=1",
            || ins.address(&addr),
            |a| {
                format!(
                    "balance {} txs {}",
                    atlas_core::Amount(a.balance_sat),
                    a.tx_appearances
                )
            },
        )
        .await;
        step(
            &mut t,
            "api/addrs/<payee>/txs?from=0&to=3",
            || ins.address_txs(&addr, 0, 3),
            |a| format!("{} of {}", a.items.len(), a.total_items),
        )
        .await;
    }
    step(
        &mut t,
        "api/statistics/richest-addresses-list",
        || ins.richest(),
        |v| format!("{} rows", v.len()),
    )
    .await;
    step(
        &mut t,
        "api/statistics/circulating-supply",
        || ins.circulating_supply(),
        |c| format!("{:?}", c.amount()),
    )
    .await;
    step(
        &mut t,
        "api/statistics/supply?days=30",
        || ins.stats_series("supply", "30"),
        |v| {
            format!(
                "{} days, latest {:?}",
                v.len(),
                v.first().and_then(|p| p.sum)
            )
        },
    )
    .await;
    step(
        &mut t,
        "api/markets/info",
        || ins.markets_info(),
        |m| format!("${:.4} ({:+.2}% 24h)", m.price, m.delta_24h),
    )
    .await;
    step(
        &mut t,
        "api/status?q=getInfo",
        || ins.status_info(),
        |s| format!("blocks {} daemon {}", s.info.blocks, s.info.version),
    )
    .await;
    step(
        &mut t,
        "api/status?q=getLastBlockHash",
        || ins.last_block_hash(),
        |l| l.lastblockhash.clone(),
    )
    .await;
    step(
        &mut t,
        "api/sync",
        || ins.sync(),
        |s| format!("{} {}", s.status, s.height),
    )
    .await;

    println!("== stats.runonflux.io");
    step(
        &mut t,
        "fluxinfo?projection=roundTime",
        || st.fluxinfo_round(),
        |r| format!("round {r:?}"),
    )
    .await;
    let geo_rows = step(
        &mut t,
        "fluxinfo?projection=ip,...,geolocation",
        || {
            st.fluxinfo(Some(&[
                "ip",
                "tier",
                "collateralHash",
                "collateralIndex",
                "geolocation",
            ]))
        },
        |v| {
            let located = v.iter().filter(|r| r.geo().is_some()).count();
            format!("{} rows, {located} located", v.len())
        },
    )
    .await;
    if let Some(ip) = &sample_ip {
        let ip: std::net::IpAddr = ip.parse().unwrap();
        step(
            &mut t,
            "fluxlocation/<ip>",
            || st.fluxlocation(ip),
            |g| format!("{} {} {:?}", g.country_code, g.org, (g.lat, g.lon)),
        )
        .await;
    }
    step(
        &mut t,
        "fluxhistorystats",
        || st.history_stats(),
        |h| format!("{} points", h.points().len()),
    )
    .await;
    step(
        &mut t,
        "marketplace/listapps",
        || st.marketplace_apps(),
        |v| format!("{} templates", v.len()),
    )
    .await;

    println!("== Direct node API (SSRF-guarded)");
    let node = geo_rows.as_ref().and_then(|rows| {
        rows.iter()
            .filter(|r| r.geo().is_some())
            .find_map(|r| r.endpoint().and_then(|e| GuardedEndpoint::new(e).ok()))
    });
    match node {
        Some(ep) => {
            let na = &clients.node_api;
            println!("      node {ep}");
            step(&mut t, "flux/version", || na.version(&ep), Clone::clone).await;
            step(
                &mut t,
                "flux/isarcaneos",
                || na.is_arcane_os(&ep),
                ToString::to_string,
            )
            .await;
            step(
                &mut t,
                "benchmark/getbenchmarks",
                || na.benchmarks(&ep),
                |b| {
                    let h = b.to_hardware();
                    format!(
                        "{:?}",
                        h.map(|h| (h.cores, h.ram_gb, h.ssd_gb, h.bench_tier))
                    )
                },
            )
            .await;
            step(
                &mut t,
                "flux/connectedpeers",
                || na.connected_peers(&ep),
                |v| format!("{} outgoing", v.len()),
            )
            .await;
            step(
                &mut t,
                "flux/topology",
                || na.topology(&ep),
                |tp| format!("{} reporters, {} edges", tp.reporters, tp.edges().len()),
            )
            .await;
            step(
                &mut t,
                "apps/installedapps",
                || na.installed_apps(&ep),
                |v| format!("{} apps", v.len()),
            )
            .await;
        }
        None => println!("      no reachable node found to probe"),
    }
    let blocked: NodeEndpoint = "10.0.0.1:16127".parse().unwrap();
    println!(
        "      SSRF guard on {blocked}: {:?}",
        GuardedEndpoint::new(blocked).map(|_| ())
    );

    println!("== CoinGecko fallback");
    step(
        &mut t,
        "simple/price?ids=zelcash",
        || clients.coingecko.simple_price(),
        |p| {
            format!(
                "{:?}",
                p.0.get("zelcash").map(|z| (z.usd, z.usd_24h_change))
            )
        },
    )
    .await;

    println!("== done: {} ok, {} errors", t.ok, t.err);
    let _ = Hash32::ZERO;
}

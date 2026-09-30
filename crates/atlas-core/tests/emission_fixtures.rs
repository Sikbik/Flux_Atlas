//! Emission math checked against real coinbase transactions from the research fixtures.
#![allow(clippy::unwrap_used)]

use std::path::PathBuf;

use atlas_core::emission::{
    DEV_FUND_ADDRESS, PayoutRole, PayoutSchedule, classify_output, pon_subsidy, split_coinbase,
};
use atlas_core::{Amount, Tier};
use serde_json::Value;

fn fixture(rel: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/research/fixtures")
        .join(rel);
    serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap()
}

/// `(n, first address, amount)` of a daemon-format coinbase (`valueSat` exact).
fn daemon_outputs(tx: &Value) -> Vec<(u32, Option<String>, Amount)> {
    tx["vout"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| {
            (
                o["n"].as_u64().unwrap() as u32,
                o["scriptPubKey"]["addresses"][0]
                    .as_str()
                    .map(str::to_owned),
                Amount(o["valueSat"].as_i64().unwrap()),
            )
        })
        .collect()
}

fn check_pon_coinbase(height: u32, outs: &[(u32, Option<String>, Amount)]) {
    let split = split_coinbase(height, outs.iter().map(|(n, a, v)| (*n, a.as_deref(), *v)));
    let sched = PayoutSchedule::at(height).unwrap();
    let tiers: Vec<Tier> = split.node_payouts.iter().map(|p| p.1).collect();
    assert_eq!(
        tiers,
        vec![Tier::Cumulus, Tier::Nimbus, Tier::Stratus],
        "height {height}"
    );
    for (_, tier, _, amount) in &split.node_payouts {
        assert_eq!(Some(*amount), sched.for_tier(*tier));
    }
    assert!(split.other.is_empty(), "height {height}: {:?}", split.other);
    assert!(split.dev_fund >= sched.dev_fund_min);
    assert_eq!(split.dev_fund - split.fees, sched.dev_fund_min);
    assert_eq!(
        split.total,
        sched.subsidy + split.fees,
        "coinbase = subsidy + fees"
    );
}

#[test]
fn daemon_coinbases_split_exactly() {
    let blocks = [
        (
            "explorer/fluxos_daemon_getblock_2996914_verbose.json",
            2_996_914,
        ),
        (
            "explorer/fluxos_daemon_getblock_2996879_with_start_v6.json",
            2_996_879,
        ),
        (
            "explorer/fluxos_daemon_getblock_2996812_with_start_v5.json",
            2_996_812,
        ),
        (
            "explorer/fluxos_daemon_getblock_first_pon_2020000.json",
            2_020_000,
        ),
        ("flux/daemon_getblock_2996900_verbosity2.json", 2_996_900),
        ("flux/daemon_getblock_2996916_verbosity2.json", 2_996_916),
        (
            "flux/daemon_getblock_2996861_verbosity2_fluxnode_start.json",
            2_996_861,
        ),
        (
            "flux/daemon_getblock_2996886_verbosity2_fluxnode_initial_confirm.json",
            2_996_886,
        ),
    ];
    for (file, height) in blocks {
        let b = fixture(file);
        let data = &b["data"];
        assert_eq!(data["height"].as_u64().unwrap() as u32, height);
        let coinbase = &data["tx"][0];
        assert!(coinbase["vin"][0]["coinbase"].is_string());
        check_pon_coinbase(height, &daemon_outputs(coinbase));
    }
}

#[test]
fn insight_and_raw_coinbases() {
    // Insight: vout values are FLUX decimal strings.
    let tx = fixture("explorer/insight_tx_coinbase_pon.json");
    let height = tx["blockheight"].as_u64().unwrap() as u32;
    let outs: Vec<(u32, Option<String>, Amount)> = tx["vout"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| {
            (
                o["n"].as_u64().unwrap() as u32,
                o["scriptPubKey"]["addresses"][0]
                    .as_str()
                    .map(str::to_owned),
                o["value"].as_str().unwrap().parse().unwrap(),
            )
        })
        .collect();
    check_pon_coinbase(height, &outs);
    let raw = fixture("explorer/fluxos_daemon_getrawtransaction_coinbase.json");
    let data = &raw["data"];
    check_pon_coinbase(
        data["height"].as_u64().unwrap() as u32,
        &daemon_outputs(data),
    );
}

#[test]
fn socket_coinbase_push_classifies() {
    // The socket pushes the coinbase as {address: satoshis} pairs when a block connects.
    let cap = fixture("explorer/insight_socketio_inv_capture.json");
    let frame = cap["frames"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["frame"].as_str().unwrap())
        .find(|f| f.contains("\"valueOut\":14"))
        .unwrap();
    let v: Value = serde_json::from_str(&frame[2..]).unwrap();
    let outs: Vec<(u32, Option<String>, Amount)> = v[1]["vout"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, o)| {
            let (addr, sat) = o.as_object().unwrap().iter().next().unwrap();
            (i as u32, Some(addr.clone()), Amount(sat.as_i64().unwrap()))
        })
        .collect();
    check_pon_coinbase(2_996_929, &outs);
}

#[test]
fn pow_block_is_not_pon() {
    let b = fixture("explorer/fluxos_daemon_getblock_pow_2019999.json");
    let outs = daemon_outputs(&b["data"]["tx"][0]);
    assert_eq!(pon_subsidy(2_019_999), None);
    for (_, addr, amount) in &outs {
        assert_eq!(
            classify_output(2_019_999, addr.as_deref(), *amount),
            PayoutRole::Other
        );
    }
    // The PoW-era split (miner 18.75, then 2.8125 / 4.6875 / 11.25 to the tiers) sums to 37.5.
    let total: Amount = outs.iter().map(|o| o.2).sum();
    assert!(total >= "37.5".parse().unwrap());
}

#[test]
fn dev_fund_address_first_output() {
    let b = fixture("explorer/fluxos_daemon_getblock_2996914_verbose.json");
    let outs = daemon_outputs(&b["data"]["tx"][0]);
    assert_eq!(outs[0].1.as_deref(), Some(DEV_FUND_ADDRESS));
    assert_eq!(
        classify_output(2_996_914, Some(DEV_FUND_ADDRESS), outs[0].2),
        PayoutRole::DevFund
    );
}

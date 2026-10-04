//! Every parser against every relevant fixture in `docs/research/fixtures/**`.
//!
//! `every_fixture_is_claimed_and_parses` walks both fixture directories and requires each file to
//! be parsed by the parser that owns it (or to be explicitly excluded, for Blockbook captures,
//! which v2 does not use). The remaining tests assert real content.
#![allow(
    clippy::unwrap_used,
    clippy::too_many_lines,
    clippy::float_cmp,
    clippy::unit_arg
)] // `ok(...)` marks a fixture as claimed

use std::path::PathBuf;

use atlas_core::chain::NodeTxKind;
use atlas_core::emission::DEV_FUND_ADDRESS;
use atlas_core::event::AppMessageKind;
use atlas_core::{Amount, Collateral, Hash32, Tier};
use atlas_flux::decode::{decode_block, detect_app_payment};
use atlas_flux::envelope::{parse_envelope, parse_plain};
use atlas_flux::models::apps::*;
use atlas_flux::models::daemon::*;
use atlas_flux::models::insight::*;
use atlas_flux::models::node_api::*;
use atlas_flux::models::nodes::{NodeListEntry, rank_inversions};
use atlas_flux::models::stats::*;
use serde::de::DeserializeOwned;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/research/fixtures")
}

fn read(rel: &str) -> Vec<u8> {
    std::fs::read(root().join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn env<T: DeserializeOwned>(rel: &str) -> T {
    parse_envelope("fixture", &read(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn plain<T: DeserializeOwned>(rel: &str) -> T {
    parse_plain("fixture", &read(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn env_err(rel: &str) {
    let e = parse_envelope::<serde_json::Value>("fixture", &read(rel)).unwrap_err();
    assert!(
        matches!(e, atlas_flux::FluxError::Upstream { .. }),
        "{rel}: {e}"
    );
}

enum Claim {
    Parsed,
    Excluded,
}

/// Parses `dir/name` with its owning parser. `Err` means a parse failure or an unclaimed file.
fn parse_one(dir: &str, name: &str) -> Result<Claim, String> {
    let rel = format!("{dir}/{name}");
    let r = rel.as_str();
    let ok = |()| Ok(Claim::Parsed);
    let res = std::panic::catch_unwind(|| -> Result<Claim, String> {
        match (dir, name) {
            // Blockbook is not used (operator restricts it to Trezor Suite).
            ("explorer", n)
                if n.starts_with("blockbook_") || n.starts_with("realtime_blockbook") =>
            {
                Ok(Claim::Excluded)
            }
            ("explorer", "tx_size_vectors.json") => ok(tx_size_vectors(r)),
            ("explorer", "coingecko_simple_price.json") => ok({
                let p: CoinGeckoSimplePrice = plain(r);
                assert!(p.0["zelcash"].usd > 0.0);
            }),
            ("explorer", "coingecko_simple_price_multi.json") => ok({
                let p: CoinGeckoSpot = plain(r);
                let (prices, change) = p.prices("zelcash");
                assert_eq!(prices.len(), 16, "{prices:?}");
                assert!(prices["usd"] > 0.0 && prices["btc"] > 0.0 && prices["idr"] > 1.0);
                assert!(!prices.contains_key("usd_24h_change"));
                assert!(change.is_some());
                assert!(p.prices("bitcoin").0.is_empty());
            }),
            ("explorer", "coingecko_market_chart_trimmed8.json") => ok({
                let c: CoinGeckoMarketChart = plain(r);
                assert_eq!(c.prices.len(), 8);
                assert!(c.prices.windows(2).all(|w| w[0].0 < w[1].0));
                assert!(c.prices.iter().all(|p| p.1 > 0.0));
            }),
            ("fusion", n) => ok(fusion_fixture(n, r)),
            ("explorer", "insight_socketio_inv_capture.json") => ok({
                let v: serde_json::Value = plain(r);
                for f in v["frames"].as_array().unwrap() {
                    atlas_flux::insight_socket::parse_frame(f["frame"].as_str().unwrap()).unwrap();
                }
            }),
            (_, n) if n.contains("error") && !n.contains("installingerrors") => ok(env_err(r)),
            (
                _,
                "flux_eventstream_404.json"
                | "flux_peerhistory_unauthorized.json"
                | "daemon_getblockhash_out_of_range.json",
            ) => ok(env_err(r)),
            (_, n) if n.contains("getblock_") || n.contains("getblockheader") => ok({
                let b: DaemonBlock = env(r);
                assert!(b.height > 0 && b.hash.len() == 64, "{r}");
                if !b.full_txs().is_empty() {
                    decode_block(&b).unwrap();
                }
            }),
            (_, n) if n.contains("viewdeterministicfluxnodelist") => ok({
                let v: Vec<NodeListEntry> = env(r);
                assert!(!v.is_empty());
                assert!(v.iter().all(|e| e.normalize().is_some()), "{r}");
            }),
            ("explorer", "insight_status_getfluxnodes_trimmed40.json") => ok({
                let v: atlas_flux::models::nodes::InsightFluxNodes = plain(r);
                assert_eq!(v.flux_nodes.len(), 40);
                assert!(v.flux_nodes.iter().all(|e| e.normalize().is_some()));
            }),
            (_, n) if n.contains("fluxnodecurrentwinner") => ok({
                let w: CurrentWinners = env(r);
                assert_eq!(w.0.len(), 3);
            }),
            (_, n) if n.contains("getfluxnodecount") || n.contains("getzelnodecount") => ok({
                let c: FluxnodeCount = env(r);
                assert_eq!(c.total, c.cumulus + c.nimbus + c.stratus);
            }),
            (_, n) if n.contains("getblockchaininfo") => ok({
                let i: BlockchainInfo = env(r);
                assert!(i.blocks > 2_990_000 && i.shielded_zat() > 0);
            }),
            (_, n) if n.contains("getblockcount") => ok({
                let h: u32 = env(r);
                assert!(h > 2_990_000);
            }),
            (_, n) if n.contains("getblockhash") || n.contains("getbestblockhash") => ok({
                let h: String = env(r);
                Hash32::from_hex(&h).unwrap();
            }),
            (_, n) if n.contains("getblockdeltas") => ok({
                let d: BlockDeltas = env(r);
                assert!(!d.deltas.is_empty());
            }),
            (_, n) if n.contains("getblocksubsidy") => ok({
                let s: BlockSubsidy = env(r);
                assert_eq!(s.miner, 14.0);
            }),
            (_, n)
                if n.contains("_getinfo") && n.starts_with("fluxos_daemon")
                    || n == "daemon_getinfo.json" =>
            {
                ok({
                    let i: DaemonInfo = env(r);
                    assert!(i.version > 9_000_000);
                })
            }
            (_, n) if n.contains("getmempoolinfo") => ok({
                let _: MempoolInfo = env(r);
            }),
            (_, n) if n.contains("getrawmempool_verbose") => ok({
                let m: RawMempool = env(r);
                assert!(!m.0.is_empty());
            }),
            (_, n) if n.contains("getrawmempool") => ok({
                let _: Vec<String> = env(r);
            }),
            (_, n) if n.contains("getrawtransaction") => ok({
                let t: DaemonTx = env(r);
                Hash32::from_hex(&t.txid).unwrap();
            }),
            (_, n) if n.contains("getspentinfo") => ok({
                let s: SpentInfo = env(r);
                assert!(s.height > 0);
            }),
            (_, n) if n.contains("gettxoutsetinfo") => ok({
                let s: TxOutSetInfo = env(r);
                assert!(s.total_amount > 4.0e8);
            }),
            (_, n) if n.contains("gettxout") => ok({
                let t: TxOut = env(r);
                assert!(t.value > 0.0);
            }),
            (_, n) if n.contains("getaddressbalance") => ok({
                let b: AddressBalance = env(r);
                assert!(b.received >= b.balance);
            }),
            (_, n) if n.contains("getaddressdeltas") => ok({
                let _: Vec<AddressDeltaRow> = env(r);
            }),
            (_, n) if n.contains("getaddressmempool") => ok({
                let _: Vec<serde_json::Value> = env(r);
            }),
            (_, n) if n.contains("getaddresstxids") => ok({
                let _: Vec<String> = env(r);
            }),
            (_, n) if n.contains("getaddressutxos") => ok({
                let v: Vec<AddressUtxo> = env(r);
                assert!(!v.is_empty());
            }),
            ("explorer", "fluxos_explorer_balance.json") => ok({
                let _: i64 = env(r);
            }),
            ("explorer", "fluxos_explorer_scannedheight.json") => ok({
                let s: ScannedHeight = env(r);
                assert!(s.general_scanned_height > 0);
            }),
            ("explorer", n) if n.starts_with("fluxos_explorer_transactions") => ok({
                let _: Vec<TxidRow> = env(r);
            }),
            // Insight
            ("explorer", n) if n.starts_with("insight_block_index") => ok({
                let b: BlockIndex = plain(r);
                Hash32::from_hex(&b.block_hash).unwrap();
            }),
            ("explorer", n) if n.starts_with("insight_block_txs") => ok({
                let p: InsightTxsPage = plain(r);
                assert!(!p.txs.is_empty());
            }),
            ("explorer", n) if n.starts_with("insight_blocks_") => ok({
                let p: InsightBlocksPage = plain(r);
                assert!(!p.blocks.is_empty());
            }),
            ("explorer", n) if n.starts_with("insight_block_") => ok({
                let b: InsightBlock = plain(r);
                assert!(b.height > 0);
            }),
            ("explorer", n) if n.starts_with("insight_tx_") => ok({
                let t: InsightTx = plain(r);
                Hash32::from_hex(&t.txid).unwrap();
                if t.is_fluxnode() {
                    t.node_tx().unwrap();
                }
            }),
            ("explorer", "insight_rawtx.json") => ok({
                let t: RawTx = plain(r);
                assert!(!t.rawtx.is_empty());
            }),
            ("explorer", n) if n.starts_with("insight_addr_summary") => ok({
                let a: InsightAddrSummary = plain(r);
                assert!(a.addr_str.starts_with('t'));
            }),
            ("explorer", "insight_addr_with_txlist_trimmed100.json") => ok({
                let a: InsightAddrSummary = plain(r);
                assert_eq!(a.transactions.len(), 100);
            }),
            ("explorer", "insight_addr_txs_page0.json") => ok({
                let p: InsightTxsPage = plain(r);
                assert_eq!(p.txs.len(), 10);
            }),
            ("explorer", "insight_addrs_txs_from_to.json") => ok({
                let p: InsightAddrTxs = plain(r);
                assert!(p.total_items > 0 && !p.items.is_empty());
            }),
            ("explorer", "insight_addr_utxo.json") => ok({
                let v: Vec<InsightUtxo> = plain(r);
                assert!(!v.is_empty());
            }),
            ("explorer", "insight_currency.json") => ok({
                let c: Currency = plain(r);
                assert!(c.data.rate > 0.0);
            }),
            ("explorer", "insight_markets_info.json") => ok({
                let m: MarketsInfo = plain(r);
                assert!(m.price > 0.0);
            }),
            ("explorer", "insight_stats_balance_intervals.json") => ok({
                let v: Vec<BalanceInterval> = plain(r);
                assert!(!v.is_empty());
            }),
            ("explorer", n)
                if n.starts_with("insight_stats_circulating")
                    || n.starts_with("insight_stats_total_supply") =>
            {
                ok({
                    let c: CirculatingSupply = plain(r);
                    assert!(c.amount().unwrap() > Amount::from_flux(400_000_000));
                })
            }
            ("explorer", "insight_stats_pools_last_hour.json" | "insight_stats_total_24h.json") => {
                ok({
                    let p: PoolStats = plain(r);
                    assert!(p.n_blocks_mined > 0 && !p.blocks_by_pool.is_empty());
                })
            }
            ("explorer", "insight_stats_richer_than.json") => ok({
                let v: Vec<RicherThan> = plain(r);
                assert!(!v.is_empty());
            }),
            ("explorer", "insight_stats_richest_addresses.json") => ok({
                let v: Vec<RichListRow> = plain(r);
                assert_eq!(v.len(), 1000);
            }),
            ("explorer", n) if n.starts_with("insight_stats_") => ok({
                let v: Vec<StatPoint> = plain(r);
                assert!(!v.is_empty());
            }),
            ("explorer", "insight_status_getinfo.json") => ok({
                let s: InsightStatusInfo = plain(r);
                assert!(s.info.blocks > 0);
            }),
            ("explorer", "insight_status_lastblockhash.json") => ok({
                let l: LastBlockHash = plain(r);
                Hash32::from_hex(&l.lastblockhash).unwrap();
            }),
            ("explorer", "insight_status_mininginfo.json") => ok({
                let _: InsightMiningInfo = plain(r);
            }),
            ("explorer", "insight_sync.json") => ok({
                let s: InsightSync = plain(r);
                assert_eq!(s.status, "finished");
            }),
            // FluxOS apps
            ("flux", "apps_appowner.json" | "apps_apporiginalowner.json") => ok({
                let s: String = env(r);
                assert!(!s.is_empty());
            }),
            ("flux", "apps_appsresources.json") => ok({
                let _: AppsResources = env(r);
            }),
            ("flux", "apps_fluxusage.json") => ok({
                let u: FluxUsage = env(r);
                assert!(u.total_apps.is_some());
            }),
            ("flux", "apps_deploymentinformation.json") => ok({
                let d: DeploymentInformation = env(r);
                assert_eq!(d.address, APP_PAYMENT_ADDRESS);
            }),
            ("flux", "apps_enterprisenodes.json") => ok({
                let v: Vec<EnterpriseNode> = env(r);
                assert!(!v.is_empty());
            }),
            (_, n) if n.contains("getappspecsusdprice") => ok({
                let p: AppSpecsUsdPrice = env(r);
                assert!(p.cpu > 0.0);
            }),
            ("flux", "apps_appspecifications.json") => ok({
                let s: RawAppSpec = env(r);
                assert!(!s.normalize().components.is_empty());
            }),
            ("flux", n)
                if n.starts_with("apps_globalappsspecifications")
                    || n.starts_with("apps_availableapps")
                    || n.contains("installedapps") =>
            {
                ok({
                    let v: Vec<RawAppSpec> = env(r);
                    for s in &v {
                        let spec = s.normalize();
                        assert!(!spec.name.is_empty());
                    }
                })
            }
            ("flux", "apps_hashes.json") => ok({
                let v: Vec<AppHashEntry> = env(r);
                assert!(!v.is_empty());
            }),
            ("flux", n) if n.starts_with("apps_installingerrorslocation") => ok({
                let v: Vec<InstallingError> = env(r);
                for e in &v {
                    assert!(!e.message().is_empty());
                }
            }),
            ("flux", "apps_installinglocations.json") => ok({
                let _: Vec<InstallingLocation> = env(r);
            }),
            ("flux", "apps_latestspecificationversion.json") => ok({
                let v: u32 = env(r);
                assert_eq!(v, 8);
            }),
            ("flux", "apps_listrunningapps.json") => ok({
                let v: Vec<RunningContainer> = env(r);
                assert!(v.iter().all(|c| c.app_name().is_some()));
            }),
            ("flux", "apps_location_appname.json" | "apps_locations.json") => ok({
                let v: Vec<AppLocation> = env(r);
                assert!(v.iter().all(|l| l.to_instance().is_some()), "{r}");
            }),
            ("flux", "apps_messagescount_owner.json") => ok({
                let _: u32 = env(r);
            }),
            ("flux", n) if n.starts_with("apps_permanentmessages") => ok({
                let v: Vec<PermanentMessage> = env(r);
                assert!(v.iter().all(|m| m.to_record().is_some()), "{r}");
            }),
            ("flux", "apps_placementlocations.json") => ok({
                let p: PlacementLocations = env(r);
                assert!(p.total.nodes > 0 && !p.continents.is_empty());
            }),
            ("flux", "apps_registrationinformation.json") => ok({
                let i: RegistrationInformation = env(r);
                assert_eq!(i.latest_supported_spec_version, Some(8));
            }),
            ("flux", "apps_tamperingevents.json") => ok({
                let _: Vec<serde_json::Value> = env(r);
            }),
            ("flux", "apps_temporarymessages.json") => ok({
                let v: Vec<TemporaryMessage> = env(r);
                assert!(v.iter().all(|m| m.to_pending().is_some()));
            }),
            (
                "flux",
                "apps_whitelistedrepositories.json"
                | "flux_connectedpeers.json"
                | "flux_incomingconnections.json"
                | "flux_enterpriseappowners.json",
            ) => ok({
                let _: Vec<String> = env(r);
            }),
            // Benchmarks
            ("flux", "benchmark_getbenchmarks.json") => ok({
                let b: Bench = env(r);
                assert!(b.to_hardware().is_some());
            }),
            ("flux", "benchmark_getinfo.json") => ok({
                let i: BenchInfo = env(r);
                assert!(i.version.is_some());
            }),
            ("flux", "benchmark_getstatus.json") => ok({
                let s: BenchStatusInfo = env(r);
                assert_eq!(s.status, "online");
            }),
            ("flux", "benchmark_getstoredbenchmark.json") => ok({
                let s: StoredBenchmark = env(r);
                assert!(s.benchmark.to_hardware().is_some());
            }),
            ("flux", "daemon_getbenchmarks.json") => ok({
                let s: String = env(r);
                assert!(parse_daemon_benchmarks(&s).unwrap().to_hardware().is_some());
            }),
            ("flux", "daemon_getbenchstatus.json") => ok({
                let s: String = env(r);
                let _: BenchStatusInfo = serde_json::from_str(&s).unwrap();
            }),
            (_, n) if n.contains("getstartlist") || n.contains("getdoslist") => ok({
                let v: Vec<PendingNodeEntry> = env(r);
                assert!(v.iter().all(|e| Collateral::parse(&e.collateral).is_ok()));
            }),
            ("flux", "daemon_getfluxnodestatus.json") => ok({
                let s: NodeStatusInfo = env(r);
                assert_eq!(s.status, "CONFIRMED");
            }),
            ("flux", "daemon_getmininginfo.json") => ok({
                let m: MiningInfo = env(r);
                assert!(m.ponminter.is_some());
            }),
            // Flux module
            ("flux", "flux_connectedpeersinfo.json") => ok({
                let v: Vec<ConnectedPeerInfo> = env(r);
                assert!(v.iter().all(|p| p.port.is_some()));
            }),
            ("flux", "flux_dosstate.json") => ok({
                let d: DosState = env(r);
                assert!(d.dos_state.is_some());
            }),
            ("flux", "flux_geolocation.json") => ok({
                let g: Geolocation = env(r);
                assert!(
                    g.to_geo(atlas_core::node::GeoSource::NodeReported)
                        .is_some()
                );
            }),
            ("flux", "flux_health.json") => ok({
                let h: HealthReport = env(r);
                assert!(h.0.contains_key("docker"));
            }),
            ("flux", n) if n.starts_with("flux_info") || n.starts_with("node_flux_info") => ok({
                let i: FluxInfo = env(r);
                assert!(
                    i.hardware().is_some() && i.versions().flux_os.is_some(),
                    "{r}"
                );
            }),
            (
                "flux",
                "flux_ip.json"
                | "flux_marketplaceurl.json"
                | "flux_nodetier.json"
                | "flux_timezone.json"
                | "flux_version.json",
            ) => ok({
                let s: String = env(r);
                assert!(!s.is_empty());
            }),
            ("flux", n) if n.starts_with("flux_isarcaneos") => ok({
                let b: bool = env(r);
                assert_eq!(b, n.contains("true"));
            }),
            ("flux", "flux_staticip.json") => ok({
                let _: bool = env(r);
            }),
            ("flux", "flux_networkhealth.json") => ok({
                let h: NetworkHealth = env(r);
                assert_eq!(h.status, "HEALTHY");
            }),
            ("flux", "flux_peers.json") => ok({
                let v: Vec<PeerLink> = env(r);
                assert!(v.iter().all(|p| p.endpoint().is_some()));
            }),
            ("flux", "flux_topology.json") => ok({
                let t: Topology = env(r);
                assert!(!t.edges().is_empty());
            }),
            ("flux", "flux_unstablenodes.json") => ok({
                let v: Vec<UnstableNode> = env(r);
                assert!(!v.is_empty());
            }),
            ("flux", "flux_uptime.json") => ok({
                let _: f64 = env(r);
            }),
            // Stats service
            ("flux", "stats_fluxhistorystats.json") => ok({
                let h: HistoryStats = env(r);
                assert!(h.points().len() > 10);
            }),
            ("flux", n) if n.starts_with("stats_fluxinfo") => ok({
                let v: Vec<StatsNodeRow> = env(r);
                assert!(v.iter().all(|row| row.outpoint().is_some()), "{r}");
            }),
            ("flux", n) if n.starts_with("stats_fluxlocation") => ok({
                let g: FluxLocation = env(r);
                assert!(g.to_geo(atlas_core::node::GeoSource::StatsLookup).is_some());
            }),
            ("flux", "stats_getmodulesminimumversions.json") => ok({
                let _: std::collections::BTreeMap<String, String> = env(r);
            }),
            ("flux", "stats_marketplace_listapps.json") => ok({
                let v: Vec<MarketplaceApp> = env(r);
                assert!(!v.is_empty());
            }),
            _ => Err(format!("UNCLAIMED {r}")),
        }
    });
    match res {
        Ok(r) => r,
        Err(p) => Err(p
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| p.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_else(|| format!("panic in {rel}"))),
    }
}

/// Flux Fusion answers (trimmed real responses, October 2026).
fn fusion_fixture(name: &str, r: &str) {
    use atlas_flux::models::fusion::*;
    match name {
        "fusion_fees.json" => {
            let f: FusionFees = env(r);
            assert_eq!(f.mining_fee("kda"), Some(10.0));
            assert_eq!(f.mining_fee("matic"), Some(31.0));
            assert_eq!(f.mining_fee("erg"), Some(10.0));
            assert_eq!(f.mining_fee("doge"), None);
        }
        "fusion_swap_activechains.json" => {
            let a: ActiveChains = env(r);
            assert!(a.0.iter().any(|c| c == "main"));
            assert!(a.0.iter().any(|c| c == "base"));
            // erg accrues but is not swappable.
            assert!(!a.0.iter().any(|c| c == "erg"));
        }
        "fusion_coinbase_summary_t3c4.json" => {
            let s: CoinbaseSummary = env(r);
            assert_eq!(s.address, "t3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ");
            assert_eq!(s.chain_statistics.len(), 10);
            assert!((s.max_claimable_per_chain * 10.0 - s.amount).abs() < 1e-6);
            for c in &s.chain_statistics {
                assert!((c.possible_to_claim - 43_555.5).abs() < 1e-9, "{c:?}");
                assert!(
                    (c.claimed_amount + c.possible_to_claim - s.max_claimable_per_chain).abs()
                        < 1e-6
                );
                assert!((c.received_amount + c.fees_paid - c.claimed_amount).abs() < 1e-6);
            }
        }
        "fusion_coinbase_multiavailable_t3c4.json" => {
            let m: MultiAvailable = env(r);
            // Nine active chains of 43,555.5: erg is left out of the claim-all.
            assert!((m.total_claim - 9.0 * 43_555.5).abs() < 1e-9);
            assert!((m.total_reward + m.total_fee - m.total_claim).abs() < 1e-9);
        }
        "fusion_coinbase_claimed_t3c4_trimmed4.json" => {
            let c: Claimed = env(r);
            assert_eq!(c.number_of_txs, 39, "the untrimmed count");
            assert_eq!(c.transactions.len(), 4);
            let first = &c.transactions[0];
            assert_eq!(first.chain, "matic");
            assert!(first.txid.starts_with("0x"));
            assert_eq!(first.timestamp, Some(1_698_487_313_694));
            let last = c.transactions.last().unwrap();
            assert!(last.txid.starts_with("flux:"));
            assert_eq!(last.claimed_address, "t3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ");
            assert!(last.fee > 0.0);
        }
        "fusion_coinbase_summary_t1a_single_node.json" => {
            let s: CoinbaseSummary = env(r);
            assert!(!s.is_miner);
            assert!(s.amount > 4_000.0 && s.number_of_txs > 2_000);
        }
        "fusion_coinbase_summary_no_coinbase.json" => {
            // An address without coinbase answers zeros, not an error.
            let s: CoinbaseSummary = env(r);
            assert_eq!(s.amount, 0.0);
            assert_eq!(s.chain_statistics.len(), 10);
        }
        other => panic!("unclaimed fusion fixture {other}"),
    }
}

#[test]
fn every_fixture_is_claimed_and_parses() {
    let mut failures = Vec::new();
    let (mut parsed, mut excluded) = (0, 0);
    for dir in ["explorer", "flux", "fusion"] {
        let mut names: Vec<String> = std::fs::read_dir(root().join(dir))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| {
                std::path::Path::new(n)
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("json"))
            })
            .collect();
        names.sort();
        for n in names {
            match parse_one(dir, &n) {
                Ok(Claim::Parsed) => parsed += 1,
                Ok(Claim::Excluded) => excluded += 1,
                Err(e) => failures.push(e),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "fixture failures:\n{}",
        failures.join("\n")
    );
    assert!(parsed > 150, "only {parsed} fixtures parsed");
    assert_eq!(excluded, 8, "blockbook exclusions changed");
}

#[test]
fn node_list_normalizes_with_queue_rule() {
    let v: Vec<NodeListEntry> = env("flux/daemon_viewdeterministicfluxnodelist.json");
    let nodes: Vec<_> = v.iter().map(|e| e.normalize().unwrap()).collect();
    assert_eq!(nodes.len(), 25);
    assert!(nodes.iter().all(|n| n.tier != Tier::Unknown));
    assert!(
        nodes.iter().any(|n| n.endpoint.is_none()),
        "fixture includes an empty-ip node"
    );
    assert!(
        nodes.iter().any(|n| n.last_paid_height.is_none()),
        "fixture includes a never-paid node"
    );
    assert!(
        nodes
            .iter()
            .any(|n| n.endpoint.is_some_and(|e| e.port != 16127))
    );
    assert!(nodes.iter().any(|n| n.payment_address.starts_with("t3")));
    let first = &nodes[0];
    assert_eq!(first.outpoint.vout, 159);
    assert_eq!(first.rank, Some(0));
    assert_eq!(first.endpoint.unwrap().to_string(), "5.230.173.203:16127");
    assert_eq!(first.active_since_ms, Some(1_787_565_604_000));
    assert_eq!(rank_inversions(&nodes), 0);
}

#[test]
fn full_raw_node_list_if_present() {
    let raw = PathBuf::from(
        "/tmp/claude-1000/-home-stache-Projects-Flux-Atlas/a1cf7222-9866-4a50-8bc1-94955a73b05e/scratchpad/team/raw/flux/daemon_viewdeterministicfluxnodelist.json",
    );
    let Ok(bytes) = std::fs::read(&raw) else {
        return;
    };
    let v: Vec<NodeListEntry> = parse_envelope("nodelist", &bytes).unwrap();
    let nodes: Vec<_> = v.iter().filter_map(NodeListEntry::normalize).collect();
    assert_eq!(nodes.len(), v.len());
    assert!(nodes.len() > 6_000);
    assert_eq!(rank_inversions(&nodes), 0);
    let empty_ip = nodes.iter().filter(|n| n.endpoint.is_none()).count();
    assert!(empty_ip < 50);
}

#[test]
fn pon_block_2996914_decodes() {
    let b: DaemonBlock = env("explorer/fluxos_daemon_getblock_2996914_verbose.json");
    let d = decode_block(&b).unwrap();
    let s = &d.summary;
    assert_eq!(s.height, 2_996_914);
    assert_eq!(s.kind, atlas_core::chain::BlockKind::Pon);
    assert_eq!(s.version, 100);
    assert_eq!(s.tx_count, 16);
    assert_eq!(s.reward, Amount::from_flux(14));
    let Some(Collateral::Prefix(p)) = &s.producer_collateral else {
        panic!("expected prefix")
    };
    assert_eq!(p.txid_prefix, "6d12b8f9ac");
    // The producer resolves against the full outpoint from Insight.
    let ib: InsightBlock = plain("explorer/insight_block_pon_2996914.json");
    assert!(
        s.producer_collateral
            .as_ref()
            .unwrap()
            .matches(&ib.producer().unwrap())
    );
    let tiers: Vec<(Tier, &str, Amount)> = s
        .payouts
        .iter()
        .map(|p| (p.tier, p.address.as_str(), p.amount))
        .collect();
    assert_eq!(
        tiers,
        vec![
            (
                Tier::Cumulus,
                "t1ZJR468HBuSt1SW2tgWjoxLfYv2yPHgGge",
                Amount::from_flux(1)
            ),
            (
                Tier::Nimbus,
                "t1UfW786yy3tzNVLnSAYi2zjnoTTmWPZ5Kj",
                Amount(350_000_000)
            ),
            (
                Tier::Stratus,
                "t1eEx91EiciRa2uxTwUvFoyUpy9vmEFiu28",
                Amount::from_flux(9)
            ),
        ]
    );
    assert_eq!(s.dev_fund, Amount(50_000_000));
    assert_eq!(
        usize::from(s.confirm_count) + usize::from(s.start_count),
        d.node_txs.len()
    );
    assert!(
        d.node_txs
            .iter()
            .all(|t| t.kind == NodeTxKind::UpdateConfirm || t.kind != NodeTxKind::Start)
    );
    assert_eq!(1 + d.node_txs.len() + d.transfers.len(), 16);
    // Insight's minedBy is the Stratus payee, not the producer.
    assert_eq!(
        ib.mined_by.as_deref(),
        Some("t1eEx91EiciRa2uxTwUvFoyUpy9vmEFiu28")
    );
}

#[test]
fn start_transactions_v5_and_v6_p2sh() {
    let b: DaemonBlock = env("explorer/fluxos_daemon_getblock_2996879_with_start_v6.json");
    let d = decode_block(&b).unwrap();
    let start = d
        .node_txs
        .iter()
        .find(|t| t.kind == NodeTxKind::Start)
        .unwrap();
    assert_eq!(start.tx_version, 6);
    assert!(start.p2sh);
    assert_eq!(start.upgraded_version, Some(2));
    assert_eq!(start.endpoint, None);
    assert_eq!(d.summary.start_count, 1);
    // P2SH payees appear in this coinbase.
    assert!(
        d.summary
            .payouts
            .iter()
            .any(|p| p.address.starts_with("t3"))
    );

    let b: DaemonBlock = env("explorer/fluxos_daemon_getblock_2996812_with_start_v5.json");
    let d = decode_block(&b).unwrap();
    let start = d
        .node_txs
        .iter()
        .find(|t| t.kind == NodeTxKind::Start)
        .unwrap();
    assert_eq!(start.tx_version, 5);
    assert!(!start.p2sh);

    // Insight decodes the same starts.
    let t: InsightTx = plain("explorer/insight_tx_fluxnode_start_v6_p2sh.json");
    let n = t.node_tx().unwrap();
    assert_eq!(n.kind, NodeTxKind::Start);
    assert!(n.p2sh);
    let t: InsightTx = plain("explorer/insight_tx_unconfirmed_confirm.json");
    let n = t.node_tx().unwrap();
    assert_eq!(n.height, None);
    assert_eq!(n.benchmark_tier, Some(Tier::Cumulus));
    assert_eq!(n.endpoint.unwrap().port, 16177);
}

#[test]
fn initial_confirm_and_regular_transfers() {
    let b: DaemonBlock =
        env("flux/daemon_getblock_2996886_verbosity2_fluxnode_initial_confirm.json");
    let d = decode_block(&b).unwrap();
    let init = d
        .node_txs
        .iter()
        .find(|t| t.kind == NodeTxKind::InitialConfirm)
        .unwrap();
    assert_eq!(
        init.collateral.to_string(),
        "7d5f19bb25431a2e622cd6ec9332c3981aba63c398c824d54cbcd037407f4be3:0"
    );
    assert_eq!(init.benchmark_tier, Some(Tier::Stratus));
    assert_eq!(init.endpoint.unwrap().to_string(), "185.248.24.211:16127");
    // Regular txs record the outpoints they spend (collateral-spend detection).
    assert!(!d.transfers.is_empty());
    assert!(!d.spent.is_empty());
}

#[test]
fn pow_and_first_pon_blocks() {
    let b: DaemonBlock = env("explorer/fluxos_daemon_getblock_pow_2019999.json");
    let d = decode_block(&b).unwrap();
    assert_eq!(d.summary.kind, atlas_core::chain::BlockKind::Pow);
    assert!(
        d.summary.payouts.is_empty(),
        "no PoN schedule before 2,020,000"
    );
    assert!(d.summary.producer_collateral.is_none());
    let b: DaemonBlock = env("explorer/fluxos_daemon_getblock_first_pon_2020000.json");
    let d = decode_block(&b).unwrap();
    assert_eq!(d.summary.kind, atlas_core::chain::BlockKind::Pon);
    assert_eq!(d.summary.payouts.len(), 3);
}

#[test]
fn app_payment_detected_from_op_return() {
    let t: DaemonTx = env("flux/daemon_getrawtransaction_appmessage.json");
    let p = detect_app_payment(&t, APP_PAYMENT_ADDRESS).unwrap();
    assert_eq!(p.value, Amount(2_000_000));
    assert_eq!(
        p.message_hash.to_string(),
        "82bf5f3135bcbcdcf26c2daeb62be74e777695ce886b4c42e257daa063a2c209"
    );
    assert!(detect_app_payment(&t, DEV_FUND_ADDRESS).is_none());
}

#[test]
fn current_winners_match_next_coinbase() {
    let w: CurrentWinners = env("flux/daemon_fluxnodecurrentwinner.json");
    let addrs: Vec<(Tier, String)> =
        w.0.values()
            .map(|e| (Tier::parse_lenient(&e.tier), e.payment_address.clone()))
            .collect();
    let b: DaemonBlock = env("flux/daemon_getblock_2996916_verbosity2.json");
    let d = decode_block(&b).unwrap();
    for (tier, addr) in addrs {
        assert!(
            d.summary
                .payouts
                .iter()
                .any(|p| p.tier == tier && p.address == addr),
            "{tier} {addr} not paid in 2,996,916"
        );
    }
}

#[test]
fn app_specs_every_version_normalize() {
    let v: Vec<RawAppSpec> = env("flux/apps_globalappsspecifications.json");
    let versions: std::collections::BTreeSet<u8> =
        v.iter().map(|s| s.normalize().spec_version).collect();
    assert_eq!(versions, (2..=8).collect());
    for s in &v {
        let n = s.normalize();
        match n.spec_version {
            2 | 3 => {
                assert_eq!(n.components.len(), 1);
                assert!(!n.components[0].ports.is_empty(), "{} string ports", n.name);
            }
            8 if n.enterprise => assert!(n.components.is_empty()),
            _ => {}
        }
        assert!(s.spec_hash().is_some());
    }
    assert!(v.iter().any(|s| s.normalize().enterprise));
    assert!(v.iter().any(|s| s.normalize().datacenter.is_some()));
    assert!(
        v.iter()
            .any(|s| s.normalize().geolocation.iter().any(|g| !g.allow))
    );
    assert!(v.iter().any(|s| s.normalize().components.len() > 1));
    // Every (type, version) pair in permanent messages normalizes; v1 uses singular ports.
    let msgs: Vec<PermanentMessage> = env("flux/apps_permanentmessages.json");
    let recs: Vec<_> = msgs.iter().map(|m| m.to_record().unwrap()).collect();
    assert!(
        recs.iter()
            .any(|r| r.spec.spec_version == 1 && !r.spec.components[0].ports.is_empty())
    );
    assert!(recs.iter().any(|r| r.kind == AppMessageKind::Update));
    assert!(recs.iter().any(|r| r.kind == AppMessageKind::Register));
}

#[test]
fn stats_placeholders_are_missing_not_zero() {
    let rows: Vec<StatsNodeRow> = env("flux/stats_fluxinfo.json");
    let unreachable: Vec<_> = rows.iter().filter(|r| !r.reachable()).collect();
    assert!(
        !unreachable.is_empty(),
        "fixture includes an unreachable placeholder row"
    );
    for r in &unreachable {
        assert!(r.geo().is_none());
        assert!(r.hardware().is_none());
        assert!(r.versions().flux_os.is_none());
        assert!(r.outpoint().is_some(), "join key survives");
    }
    let reachable: Vec<_> = rows.iter().filter(|r| r.reachable()).collect();
    assert!(
        reachable
            .iter()
            .all(|r| r.geo().is_some_and(|g| g.has_coords()))
    );
    assert!(reachable.iter().any(|r| r.is_arcane() == Some(false)));
    assert!(reachable.iter().any(|r| {
        r.hardware()
            .is_some_and(|h| h.arch == atlas_core::node::Arch::Arm64)
    }));
    assert!(reachable.iter().any(|r| {
        r.hardware()
            .is_some_and(|h| h.bench_status == atlas_core::node::BenchStatus::Failed)
    }));
    assert!(reachable.iter().all(|r| r.versions().daemon.is_some()));
    assert!(
        reachable
            .iter()
            .any(|r| r.geo().is_some_and(|g| g.asn.is_some()))
    );
}

#[test]
fn topology_edges_and_locations() {
    let t: Topology = env("flux/flux_topology.json");
    let edges = t.edges();
    assert!(edges.len() > 100);
    assert!(edges.iter().all(|(a, b)| a != b));
    let locs: Vec<AppLocation> = env("flux/apps_locations.json");
    let i = locs[0].to_instance().unwrap();
    assert_eq!(i.endpoint.to_string(), "65.109.86.15:16127");
    assert_eq!(i.broadcast_ms, 1_790_794_516_430);
    assert_eq!(i.expire_ms - i.broadcast_ms, 7_500_000);
}

/// Every tx size vector (daemon JSON + the size Insight reports for the same txid) matches the
/// size computed from the decoded fields.
fn tx_size_vectors(r: &str) {
    let v: serde_json::Value = plain(r);
    let vectors = v["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 20);
    let (mut starts, mut confirms, mut sapling) = (0, 0, 0);
    for x in vectors {
        let tx: DaemonTx = serde_json::from_value(x["tx"].clone()).unwrap();
        let want = u32::try_from(x["insight_size"].as_u64().unwrap()).unwrap();
        assert_eq!(tx.size, None, "getblock verbosity 2 carries no tx size");
        assert_eq!(tx.serialized_size(), Some(want), "{}", tx.txid);
        if tx.is_start() {
            starts += 1;
        } else if tx.is_confirm() {
            confirms += 1;
        } else {
            sapling += 1;
        }
    }
    assert!(starts > 0 && confirms > 0 && sapling > 1);
}

#[test]
fn tx_sizes_match_insight_for_v6_p2sh_starts_and_whole_blocks() {
    for (block, page) in [
        (
            "explorer/fluxos_daemon_getblock_2996879_with_start_v6.json",
            "explorer/insight_block_txs_page0_2996879_with_start.json",
        ),
        (
            "explorer/fluxos_daemon_getblock_2996914_verbose.json",
            "explorer/insight_block_txs_page0_2996914.json",
        ),
    ] {
        let b: DaemonBlock = env(block);
        let p: serde_json::Value = plain(page);
        let mut checked = 0;
        for t in p["txs"].as_array().unwrap() {
            let txid = t["txid"].as_str().unwrap();
            let want = u32::try_from(t["size"].as_u64().unwrap()).unwrap();
            let tx = b.full_txs().iter().find(|x| x.txid == txid).unwrap();
            assert_eq!(tx.serialized_size(), Some(want), "{block} {txid}");
            checked += 1;
        }
        assert!(checked > 0);
    }
    // Shapes that cannot be computed stay unknown rather than 0.
    let legacy = DaemonTx {
        version: 1,
        ..DaemonTx::default()
    };
    assert_eq!(legacy.serialized_size(), None);
}

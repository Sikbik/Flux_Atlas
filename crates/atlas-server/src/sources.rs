//! Third-party sources of the wallet and explorer views: Flux Fusion (parallel assets),
//! CoinGecko (prices) and Insight's statistics (the daily chain series and the rich list).
//! Production asks them over HTTP ([`LiveSources`]: Fusion on the interactive lane, CoinGecko
//! and Insight's statistics on the bulk lane); the demo server and tests plug in fixed answers
//! ([`MarketSources`] is a trait object on `AppState`).

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use atlas_core::api::PricePoint;
use atlas_core::now_ms;
use atlas_flux::models::fusion::{Claimed, CoinbaseSummary, FusionFees, MultiAvailable};
use atlas_flux::models::insight::{RichListRow, StatPoint};
use atlas_flux::{FluxError, FusionClient, InsightClient};

use crate::chain_daily::StatKind;

/// A boxed upstream answer.
pub type SourceFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, FluxError>> + Send + 'a>>;

/// Everything Fusion says about one address.
#[derive(Debug, Clone, Default)]
pub struct FusionWallet {
    pub summary: CoinbaseSummary,
    pub multi: MultiAvailable,
    pub claimed: Claimed,
    pub fetched_ms: u64,
}

/// Fusion's address-independent tables.
#[derive(Debug, Clone, Default)]
pub struct FusionMeta {
    pub fees: FusionFees,
    /// Chain ids Fusion swaps on now.
    pub active: Vec<String>,
}

/// Spot prices of FLUX.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Spot {
    /// Price per lowercase currency code.
    pub prices: BTreeMap<String, f64>,
    pub change_24h_pct: Option<f64>,
}

/// Currencies of the spot price (one CoinGecko call).
pub const SPOT_CURRENCIES: [&str; 16] = [
    "usd", "eur", "gbp", "aud", "cad", "chf", "jpy", "cny", "inr", "krw", "sgd", "hkd", "thb",
    "myr", "idr", "btc",
];

/// Days of daily USD history.
pub const HISTORY_DAYS: u32 = 365;

/// The third-party sources (see the module docs).
pub trait MarketSources: Send + Sync + 'static {
    /// Fusion's summary, claim-all and claim history of `address`.
    fn fusion_wallet<'a>(&'a self, address: &'a str) -> SourceFuture<'a, FusionWallet>;
    /// Fusion's fee table and active chains.
    fn fusion_meta(&self) -> SourceFuture<'_, FusionMeta>;
    /// FLUX in [`SPOT_CURRENCIES`].
    fn spot(&self) -> SourceFuture<'_, Spot>;
    /// Daily USD prices of the last [`HISTORY_DAYS`] days, oldest first, one per UTC day.
    fn history(&self) -> SourceFuture<'_, Vec<PricePoint>>;
    /// Insight's whole daily series of `kind` (`statistics/<kind>?days=all`).
    fn stat_series(&self, kind: StatKind) -> SourceFuture<'_, Vec<StatPoint>>;
    /// Insight's top 1,000 addresses (`statistics/richest-addresses-list`).
    fn richest(&self) -> SourceFuture<'_, Vec<RichListRow>>;
    /// Pause between two of the daily series calls (none for fixed answers).
    fn pace(&self) -> Duration {
        Duration::ZERO
    }
}

/// Pause between the six daily series calls to Insight, on top of the bulk lane's one request
/// a second.
pub const SERIES_PACE: Duration = Duration::from_secs(2);

/// The HTTP sources.
#[derive(Debug, Clone)]
pub struct LiveSources {
    pub fusion: FusionClient,
    pub coingecko: atlas_flux::clients::CoinGeckoClient,
    /// Insight on the bulk lane (statistics and the rich list).
    pub insight: InsightClient,
}

impl MarketSources for LiveSources {
    fn fusion_wallet<'a>(&'a self, address: &'a str) -> SourceFuture<'a, FusionWallet> {
        Box::pin(async move {
            // Three calls at once: the summary alone takes about 3 s for a large wallet.
            let (summary, multi, claimed) = tokio::join!(
                self.fusion.summary(address),
                self.fusion.multi_available(address),
                self.fusion.claimed(address),
            );
            Ok(FusionWallet {
                summary: summary?,
                multi: multi?,
                claimed: claimed?,
                fetched_ms: now_ms(),
            })
        })
    }

    fn fusion_meta(&self) -> SourceFuture<'_, FusionMeta> {
        Box::pin(async move {
            let (fees, active) = tokio::join!(self.fusion.fees(), self.fusion.active_chains());
            Ok(FusionMeta {
                fees: fees?,
                active: active?.0,
            })
        })
    }

    fn spot(&self) -> SourceFuture<'_, Spot> {
        Box::pin(async move {
            let s = self.coingecko.spot(&SPOT_CURRENCIES).await?;
            let (prices, change_24h_pct) = s.prices("zelcash");
            if !prices.contains_key("usd") {
                return Err(FluxError::Parse {
                    what: "coingecko spot",
                    message: "no zelcash usd price".into(),
                });
            }
            Ok(Spot {
                prices,
                change_24h_pct,
            })
        })
    }

    fn history(&self) -> SourceFuture<'_, Vec<PricePoint>> {
        Box::pin(async move {
            let c = self.coingecko.market_chart_usd(HISTORY_DAYS).await?;
            let days = daily(&c.prices);
            if days.is_empty() {
                return Err(FluxError::Parse {
                    what: "coingecko market chart",
                    message: "no prices".into(),
                });
            }
            Ok(days)
        })
    }

    fn stat_series(&self, kind: StatKind) -> SourceFuture<'_, Vec<StatPoint>> {
        Box::pin(async move { self.insight.stats_series(kind.path(), "all").await })
    }

    fn richest(&self) -> SourceFuture<'_, Vec<RichListRow>> {
        Box::pin(async move { self.insight.richest().await })
    }

    fn pace(&self) -> Duration {
        SERIES_PACE
    }
}

const DAY_MS: u64 = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Fixed answers (demo server, tests)
// ---------------------------------------------------------------------------------------------

/// Deterministic Fusion-like and CoinGecko-like answers for the demo server and tests: every
/// address gets a plausible parallel-asset history derived from a hash of it, the fee table and
/// active chains are the real ones of October 2026, and prices follow a fixed curve.
#[derive(Debug, Default)]
pub struct FixedSources {
    /// When set, every call fails like an unreachable upstream.
    pub fail: std::sync::atomic::AtomicBool,
    /// Calls answered so far: Fusion wallet, Fusion meta, spot, history, daily series (one per
    /// kind), rich list.
    pub calls: [std::sync::atomic::AtomicU32; 6],
    /// When set, only the daily series of these kinds fail (on top of [`Self::fail`]).
    pub fail_series: std::sync::Mutex<Vec<StatKind>>,
}

/// Fusion's claim fees per chain (`/fees` `mining`, October 2026).
const FIXED_FEES: [(&str, f64); 10] = [
    ("kda", 10.0),
    ("eth", 12.0),
    ("bsc", 10.0),
    ("trx", 20.0),
    ("sol", 10.0),
    ("avax", 8.0),
    ("erg", 10.0),
    ("algo", 10.0),
    ("matic", 31.0),
    ("base", 10.0),
];

/// CoinGecko spot prices of FLUX on 3 October 2026.
const FIXED_SPOT: [(&str, f64); 16] = [
    ("usd", 0.074_431),
    ("eur", 0.066_119),
    ("gbp", 0.056_204),
    ("aud", 0.107_264),
    ("cad", 0.106_038),
    ("chf", 0.061_656),
    ("jpy", 11.75),
    ("cny", 0.499_05),
    ("inr", 7.17),
    ("krw", 100.0),
    ("sgd", 0.095_167),
    ("hkd", 0.584_087),
    ("thb", 2.49),
    ("myr", 0.304_042),
    ("idr", 1_331.45),
    ("btc", 8.779_28e-7),
];

impl FixedSources {
    fn call(&self, which: usize) -> Result<(), FluxError> {
        use std::sync::atomic::Ordering;
        self.calls[which].fetch_add(1, Ordering::SeqCst);
        if self.fail.load(Ordering::SeqCst) {
            return Err(FluxError::Transport {
                url: "fixed".into(),
                message: "fixed source set to fail".into(),
            });
        }
        Ok(())
    }

    /// Calls answered (or failed) of one kind: 0 Fusion wallet, 1 Fusion meta, 2 spot,
    /// 3 history, 4 daily series, 5 rich list.
    pub fn count(&self, which: usize) -> u32 {
        self.calls[which].load(std::sync::atomic::Ordering::SeqCst)
    }

    /// The fixed Fusion answer for `address`.
    pub fn wallet_for(address: &str) -> FusionWallet {
        use atlas_flux::models::fusion::{ChainStatistic, ClaimRecord};
        let h = blake3::hash(address.as_bytes());
        let b = h.as_bytes();
        let seed = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]);
        // Coinbase received: 2,000 to 402,000 FLUX in steps of 1/16.
        let amount = 2_000.0 + (seed % 6_400_000) as f64 / 16.0;
        let per_chain = amount / 10.0;
        let hex = |tag: &str| blake3::hash(format!("{address}-{tag}").as_bytes()).to_hex();
        let mut stats = Vec::new();
        let mut claims = Vec::new();
        for (i, (chain, fee)) in FIXED_FEES.iter().enumerate() {
            // Claimed 0%, 25%, 50% or 75% of the chain's accrual.
            let share = f64::from(((seed >> (8 + 2 * i)) & 3) as u32) * 0.25;
            let claimed = (per_chain * share * 16.0).round() / 16.0;
            let fees_paid = if claimed > 0.0 { *fee } else { 0.0 };
            stats.push(ChainStatistic {
                chain: (*chain).to_owned(),
                claimed_amount: claimed,
                received_amount: claimed - fees_paid,
                fees_paid,
                possible_to_claim: per_chain - claimed,
            });
            if claimed > 0.0 {
                let txid = match *chain {
                    "eth" | "bsc" | "avax" | "matic" | "base" => format!("0x{}", hex(chain)),
                    _ => hex(chain).to_string(),
                };
                claims.push(ClaimRecord {
                    amount: claimed,
                    chain: (*chain).to_owned(),
                    txid,
                    claimed_address: format!("0x{}", &hex("to")[..40]),
                    fee: *fee,
                    timestamp: Some(1_760_000_000_000 + i as u64 * 3 * DAY_MS),
                });
            }
        }
        // A claim-all paid out on the main chain, the way Fusion records one.
        let main = hex("claim-all");
        claims.push(ClaimRecord {
            amount: (per_chain * 0.05 * 16.0).round() / 16.0,
            chain: "kda".to_owned(),
            txid: format!("flux:{main}"),
            claimed_address: address.to_owned(),
            fee: 10.0,
            timestamp: Some(1_780_000_000_000),
        });
        let active: f64 = stats
            .iter()
            .filter(|c| c.chain != "erg")
            .map(|c| c.possible_to_claim)
            .sum();
        let fees = 105.0 + (active * 0.0077).round();
        FusionWallet {
            summary: CoinbaseSummary {
                address: address.to_owned(),
                amount,
                number_of_txs: (amount / 9.0) as u64,
                is_miner: false,
                max_claimable_per_chain: per_chain,
                max_claimable_total: amount,
                claimed_total: stats.iter().map(|c| c.claimed_amount).sum(),
                chain_statistics: stats,
            },
            multi: MultiAvailable {
                address: address.to_owned(),
                total_claim: active,
                total_mining_fees: 105.0,
                total_swap_fees: fees - 105.0,
                total_fee: fees,
                total_reward: active - fees,
            },
            claimed: Claimed {
                address: address.to_owned(),
                number_of_txs: claims.len() as u64,
                transactions: claims,
            },
            fetched_ms: now_ms(),
        }
    }

    /// The fixed daily USD history ending today.
    pub fn history_until(today_ms: u64) -> Vec<PricePoint> {
        let today = today_ms / DAY_MS * DAY_MS;
        (0..u64::from(HISTORY_DAYS))
            .rev()
            .map(|back| {
                let day_ms = today - back * DAY_MS;
                let d = (day_ms / DAY_MS) as f64;
                // Down from about 0.19 a year ago to today's spot price, with some swing.
                let usd = if back == 0 {
                    FIXED_SPOT[0].1
                } else {
                    0.0744
                        + 0.115 * back as f64 / 365.0
                        + 0.012 * (d / 9.0).sin()
                        + 0.006 * (d / 2.3).cos()
                };
                PricePoint {
                    day_ms,
                    usd: (usd * 1e6).round() / 1e6,
                }
            })
            .collect()
    }
}

/// First day of the fixed daily series (UTC midnight, 2018-01-01).
pub const FIXED_SERIES_FROM_MS: u64 = 1_514_764_800_000;
/// First day of the fixed `network-hash` series: it starts later than the others, so the demo
/// shows the `null` of a series without a row for a day.
pub const FIXED_HASH_FROM_MS: u64 = FIXED_SERIES_FROM_MS + 400 * DAY_MS;
/// Proof of Node: 30 s blocks and near-zero difficulty from this UTC day (2025-10-25).
const FIXED_PON_DAY_MS: u64 = 1_761_350_400_000;
/// Rich-list fixture: addresses in the pool (the top 1,000 of them make the list).
const FIXED_RICH_POOL: usize = 1_150;

/// A deterministic unit value in `[0, 1)` from a tag and an index.
fn unit(tag: &str, i: u64) -> f64 {
    let h = blake3::hash(format!("{tag}-{i}").as_bytes());
    let b = h.as_bytes();
    let n = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]);
    (n >> 11) as f64 / (1u64 << 53) as f64
}

/// `YYYY-MM-DD` of the UTC day starting at `day_ms`.
fn date_of(day_ms: u64) -> String {
    // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
    let z = (day_ms / DAY_MS) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

impl FixedSources {
    /// The fixed Insight daily series of `kind`, newest first like Insight, from
    /// [`FIXED_SERIES_FROM_MS`] (`network-hash` from [`FIXED_HASH_FROM_MS`]) to the UTC day of
    /// `now_ms`. Today's counters are partial (the elapsed share of the day).
    pub fn series_until(kind: StatKind, now_ms: u64) -> Vec<StatPoint> {
        let today = now_ms / DAY_MS * DAY_MS;
        let from = if kind == StatKind::NetworkHash {
            FIXED_HASH_FROM_MS
        } else {
            FIXED_SERIES_FROM_MS
        };
        let elapsed = (now_ms - today) as f64 / DAY_MS as f64;
        let round8 = |x: f64| (x * 1e8).round() / 1e8;
        let mut out = Vec::new();
        let mut day = today;
        while day >= from {
            let n = (day - FIXED_SERIES_FROM_MS) / DAY_MS;
            let d = n as f64;
            let pon = day >= FIXED_PON_DAY_MS;
            let share = if day == today { elapsed } else { 1.0 };
            let swing = 1.0 + 0.08 * (d / 6.0).sin() + 0.04 * (d / 1.7).cos();
            let blocks = if pon { 2_880.0 } else { 720.0 };
            let mut p = StatPoint {
                date: date_of(day),
                ..StatPoint::default()
            };
            match kind {
                StatKind::Transactions => {
                    let per_block = if pon { 14.8 } else { 2.0 + d / 900.0 };
                    p.transaction_count = Some((blocks * per_block * swing * share) as u64);
                    p.block_count = Some((blocks * share) as u64);
                }
                StatKind::Fees => {
                    p.fee = Some(round8((0.000_02 + 0.000_6 * unit("fee", n)) * share));
                }
                StatKind::Outputs => {
                    p.sum = Some(round8((1.5e6 + 2.5e7 * unit("out", n).powi(3)) * share));
                }
                StatKind::Supply => {
                    // About 150M at the start, 430.8M on 2026-10-04.
                    p.sum = Some(round8(150_000_000.0 + 280_800_000.0 * d / 3_198.0));
                }
                StatKind::Difficulty => {
                    p.sum = Some(if pon {
                        0.002 + 0.6 * unit("diff", n).powi(4)
                    } else {
                        20_000.0 + 30_000.0 * swing * (1.0 + d / 1_000.0)
                    });
                }
                StatKind::NetworkHash => {
                    p.sum = Some(if pon {
                        3.6e10 * swing
                    } else {
                        2.0e6 * swing * (1.0 + d / 800.0)
                    });
                }
            }
            out.push(p);
            day -= DAY_MS;
        }
        out
    }

    /// Address `k` of the rich-list fixture: `k` 1 to 40 are the fixture's operators 0 to 39
    /// (they run nodes; the demo wallet is operator 1), the others a mix of t1 and t3
    /// addresses (`k` 0 is a t3, the large locked holding at the top of the real list).
    pub fn rich_address(k: usize) -> String {
        if (1..=40).contains(&k) {
            return crate::fixtures::operator_address(k - 1);
        }
        let mut h = [0u8; 20];
        h.copy_from_slice(&blake3::hash(format!("rich-{k}").as_bytes()).as_bytes()[..20]);
        if k.is_multiple_of(5) {
            let mut p = vec![0x1c, 0xbd];
            p.extend_from_slice(&h);
            crate::search::base58check_encode(&p)
        } else {
            crate::search::t1_address(h)
        }
    }

    /// The fixed rich list of the UTC day of `day_ms`: the 1,000 largest of a pool of 1,150
    /// addresses whose balances drift smoothly from day to day (so addresses near the cutoff
    /// enter and leave), and a few that move a fifth of their balance once a week. The top
    /// address holds 160M FLUX and never moves.
    pub fn richest_on(day_ms: u64) -> Vec<RichListRow> {
        let day = day_ms / DAY_MS;
        let week = day / 7;
        let d = day as f64;
        let mut rows: Vec<RichListRow> = (0..FIXED_RICH_POOL)
            .map(|k| {
                let base = if k == 0 {
                    160_000_000.0
                } else {
                    2.4e7 / ((k + 1) as f64).powf(1.08) + 9_000.0
                };
                let rate = 0.05 + 0.3 * unit("rate", k as u64);
                let phase = 6.3 * unit("phase", k as u64);
                // The locked holding at the top never moves.
                let swing = if k == 0 { 0.0 } else { 0.06 };
                let mut balance = base * (1.0 + swing * (d * rate + phase).sin());
                let key = week * 10_000 + k as u64;
                if k > 0 && unit("move", key) < 1.0 / 60.0 {
                    balance *= if unit("dir", key) < 0.5 { 0.8 } else { 1.25 };
                }
                RichListRow {
                    address: Self::rich_address(k),
                    blocks_mined: 0,
                    balance: (balance * 1e8).round() / 1e8,
                }
            })
            .collect();
        rows.sort_by(|a, b| {
            b.balance
                .total_cmp(&a.balance)
                .then_with(|| a.address.cmp(&b.address))
        });
        rows.truncate(1_000);
        rows
    }
}

impl MarketSources for FixedSources {
    fn fusion_wallet<'a>(&'a self, address: &'a str) -> SourceFuture<'a, FusionWallet> {
        Box::pin(async move {
            self.call(0)?;
            Ok(Self::wallet_for(address))
        })
    }

    fn fusion_meta(&self) -> SourceFuture<'_, FusionMeta> {
        Box::pin(async move {
            self.call(1)?;
            let mut mining: BTreeMap<String, f64> = FIXED_FEES
                .iter()
                .map(|(c, f)| ((*c).to_owned(), *f))
                .collect();
            mining.insert("percentage".to_owned(), 0.0);
            Ok(FusionMeta {
                fees: FusionFees {
                    mining: Some(mining),
                },
                active: std::iter::once("main")
                    .chain(FIXED_FEES.iter().map(|(c, _)| *c).filter(|c| *c != "erg"))
                    .map(str::to_owned)
                    .collect(),
            })
        })
    }

    fn spot(&self) -> SourceFuture<'_, Spot> {
        Box::pin(async move {
            self.call(2)?;
            Ok(Spot {
                prices: FIXED_SPOT
                    .iter()
                    .map(|(c, p)| ((*c).to_owned(), *p))
                    .collect(),
                change_24h_pct: Some(2.267),
            })
        })
    }

    fn history(&self) -> SourceFuture<'_, Vec<PricePoint>> {
        Box::pin(async move {
            self.call(3)?;
            Ok(Self::history_until(now_ms()))
        })
    }

    fn stat_series(&self, kind: StatKind) -> SourceFuture<'_, Vec<StatPoint>> {
        Box::pin(async move {
            self.call(4)?;
            let failing = self
                .fail_series
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .contains(&kind);
            if failing {
                return Err(FluxError::Transport {
                    url: "fixed".into(),
                    message: format!("fixed {} series set to fail", kind.path()),
                });
            }
            Ok(Self::series_until(kind, now_ms()))
        })
    }

    fn richest(&self) -> SourceFuture<'_, Vec<RichListRow>> {
        Box::pin(async move {
            self.call(5)?;
            Ok(Self::richest_on(now_ms()))
        })
    }
}

/// One price per UTC day from `[unix ms, price]` pairs (the last of each day wins, so today
/// is the current price), oldest first. Non-positive or non-finite rows are dropped.
pub fn daily(points: &[(f64, f64)]) -> Vec<PricePoint> {
    let mut by_day: BTreeMap<u64, f64> = BTreeMap::new();
    let mut sorted: Vec<(f64, f64)> = points
        .iter()
        .copied()
        .filter(|(t, p)| t.is_finite() && *t > 0.0 && p.is_finite() && *p > 0.0)
        .collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (t, p) in sorted {
        by_day.insert((t as u64) / DAY_MS * DAY_MS, p);
    }
    by_day
        .into_iter()
        .map(|(day_ms, usd)| PricePoint { day_ms, usd })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_answers_are_deterministic_and_consistent() {
        let a = FixedSources::wallet_for("t1demo");
        let b = FixedSources::wallet_for("t1demo");
        assert!((a.summary.amount - b.summary.amount).abs() < 1e-9);
        assert!(
            (a.summary.amount - FixedSources::wallet_for("t1other").summary.amount).abs() > 1e-9
        );
        let s = &a.summary;
        assert_eq!(s.chain_statistics.len(), 10);
        for c in &s.chain_statistics {
            assert!(
                (c.claimed_amount + c.possible_to_claim - s.max_claimable_per_chain).abs() < 1e-9
            );
        }
        let erg = s
            .chain_statistics
            .iter()
            .find(|c| c.chain == "erg")
            .unwrap();
        let all: f64 = s.chain_statistics.iter().map(|c| c.possible_to_claim).sum();
        assert!((a.multi.total_claim - (all - erg.possible_to_claim)).abs() < 1e-9);
        assert!((a.multi.total_reward + a.multi.total_fee - a.multi.total_claim).abs() < 1e-9);
        let h = FixedSources::history_until(1_791_075_740_000);
        assert_eq!(h.len(), 365);
        assert_eq!(h.last().unwrap().day_ms, 1_791_072_000_000);
        assert!(h.iter().all(|p| p.usd > 0.0));
    }

    #[test]
    fn fixed_rich_list_drifts_and_churns() {
        let day = 1_791_072_000_000;
        let key = |v: &[RichListRow]| -> Vec<(String, u64)> {
            v.iter()
                .map(|r| (r.address.clone(), r.balance.to_bits()))
                .collect()
        };
        let a = FixedSources::richest_on(day);
        assert_eq!(
            key(&a),
            key(&FixedSources::richest_on(day + 3_600_000)),
            "one list per day"
        );
        assert_eq!(a.len(), 1_000);
        assert!(a.windows(2).all(|w| w[0].balance >= w[1].balance));
        assert_ne!(key(&a), key(&FixedSources::richest_on(day - DAY_MS)));
        let b = FixedSources::richest_on(day - 7 * DAY_MS);
        let now: std::collections::HashSet<&str> = a.iter().map(|r| r.address.as_str()).collect();
        let entered = b
            .iter()
            .filter(|r| !now.contains(r.address.as_str()))
            .count();
        assert!(entered > 0 && entered < 150, "{entered}");
        for r in a.iter().take(50) {
            assert!(matches!(
                crate::search::classify_address(&r.address),
                crate::search::AddressClass::Transparent { valid: true, .. }
            ));
        }
        let s = FixedSources::series_until(StatKind::Supply, day + 1_000);
        assert_eq!(s[0].date, "2026-10-04");
        assert_eq!(s.last().unwrap().date, "2018-01-01");
    }

    #[test]
    fn daily_keeps_the_last_price_of_each_day() {
        let pts = [
            (1_791_072_000_000.0, 0.075),
            (1_790_985_600_000.0, 0.08),
            (1_791_075_740_000.0, 0.0744),
            (1_790_900_000_000.0, -1.0),
            (f64::NAN, 1.0),
        ];
        let d = daily(&pts);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].day_ms, 1_790_985_600_000);
        assert_eq!(d[1].day_ms, 1_791_072_000_000);
        assert!(
            (d[1].usd - 0.0744).abs() < 1e-12,
            "today is the current price"
        );
    }
}

//! Third-party market sources of the wallet views: Flux Fusion (parallel assets) and CoinGecko
//! (prices). Production asks them over HTTP ([`LiveSources`]: Fusion on the interactive lane,
//! CoinGecko on the bulk lane); the demo server and tests plug in fixed answers
//! ([`MarketSources`] is a trait object on `AppState`).

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;

use atlas_core::api::PricePoint;
use atlas_core::now_ms;
use atlas_flux::models::fusion::{Claimed, CoinbaseSummary, FusionFees, MultiAvailable};
use atlas_flux::{FluxError, FusionClient};

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
}

/// The HTTP sources.
#[derive(Debug, Clone)]
pub struct LiveSources {
    pub fusion: FusionClient,
    pub coingecko: atlas_flux::clients::CoinGeckoClient,
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
    /// Calls answered so far: Fusion wallet, Fusion meta, spot, history.
    pub calls: [std::sync::atomic::AtomicU32; 4],
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
    /// 3 history.
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

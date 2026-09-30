//! Emission math for Proof of Node blocks: subsidy schedule and coinbase payout classification.
//!
//! Facts (fluxd consensus): PoN activates at height 2,020,000. The subsidy starts at 14 FLUX
//! and is cut to 9/10 (integer base-unit math) every 1,051,200 blocks, at most 20 times. Each
//! tier receives `subsidy * base / 14` where base is 1.0 / 3.5 / 9.0 FLUX; the dev fund receives
//! the remainder plus all fees.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::amount::{Amount, COIN};
use crate::node::Tier;

/// First Proof of Node height.
pub const PON_ACTIVATION_HEIGHT: u32 = 2_020_000;
/// Blocks between subsidy reductions.
pub const REDUCTION_INTERVAL: u32 = 1_051_200;
/// Maximum number of reductions.
pub const MAX_REDUCTIONS: u32 = 20;
/// Initial PoN subsidy in base units.
pub const PON_INITIAL_SUBSIDY: Amount = Amount::from_flux(14);
/// Target block spacing in seconds.
pub const PON_TARGET_SPACING_S: u32 = 30;
/// Dev fund (P2SH) address that receives the remainder plus fees.
pub const DEV_FUND_ADDRESS: &str = "t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA";

const TIER_BASE_CUMULUS: i128 = COIN as i128; // 1.0
const TIER_BASE_NIMBUS: i128 = (COIN as i128) * 7 / 2; // 3.5
const TIER_BASE_STRATUS: i128 = (COIN as i128) * 9; // 9.0
const PON_INITIAL_TOTAL: i128 = (COIN as i128) * 14;

/// True when `height` is a Proof of Node block.
pub const fn is_pon(height: u32) -> bool {
    height >= PON_ACTIVATION_HEIGHT
}

/// Number of subsidy reductions applied at `height` (0 before the first cut).
pub const fn reductions_at(height: u32) -> u32 {
    if height < PON_ACTIVATION_HEIGHT {
        return 0;
    }
    let n = (height - PON_ACTIVATION_HEIGHT) / REDUCTION_INTERVAL;
    if n > MAX_REDUCTIONS {
        MAX_REDUCTIONS
    } else {
        n
    }
}

/// Height of the next subsidy reduction strictly after `height`, if any remain.
pub const fn next_reduction_height(height: u32) -> Option<u32> {
    if height < PON_ACTIVATION_HEIGHT {
        return Some(PON_ACTIVATION_HEIGHT + REDUCTION_INTERVAL);
    }
    let done = reductions_at(height);
    if done >= MAX_REDUCTIONS {
        return None;
    }
    Some(PON_ACTIVATION_HEIGHT + (done + 1) * REDUCTION_INTERVAL)
}

/// Block subsidy at a PoN height; `None` before PoN activation.
pub fn pon_subsidy(height: u32) -> Option<Amount> {
    if !is_pon(height) {
        return None;
    }
    let mut s = PON_INITIAL_SUBSIDY.sat();
    for _ in 0..reductions_at(height) {
        s = s * 9 / 10;
    }
    Some(Amount::from_sat(s))
}

/// Payout owed to one node of `tier` at a PoN height.
pub fn tier_payout(height: u32, tier: Tier) -> Option<Amount> {
    let subsidy = i128::from(pon_subsidy(height)?.sat());
    let base = match tier {
        Tier::Cumulus => TIER_BASE_CUMULUS,
        Tier::Nimbus => TIER_BASE_NIMBUS,
        Tier::Stratus => TIER_BASE_STRATUS,
        Tier::Unknown => return None,
    };
    Some(Amount::from_sat(
        (subsidy * base / PON_INITIAL_TOTAL) as i64,
    ))
}

/// The full expected coinbase split at a PoN height (before fees).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PayoutSchedule {
    pub height: u32,
    pub subsidy: Amount,
    pub cumulus: Amount,
    pub nimbus: Amount,
    pub stratus: Amount,
    /// Minimum dev-fund output (the remainder); the real output adds all fees.
    pub dev_fund_min: Amount,
}

impl PayoutSchedule {
    /// Schedule at a PoN height; `None` before activation.
    pub fn at(height: u32) -> Option<Self> {
        let subsidy = pon_subsidy(height)?;
        let cumulus = tier_payout(height, Tier::Cumulus)?;
        let nimbus = tier_payout(height, Tier::Nimbus)?;
        let stratus = tier_payout(height, Tier::Stratus)?;
        Some(Self {
            height,
            subsidy,
            cumulus,
            nimbus,
            stratus,
            dev_fund_min: subsidy - cumulus - nimbus - stratus,
        })
    }

    pub fn for_tier(&self, tier: Tier) -> Option<Amount> {
        match tier {
            Tier::Cumulus => Some(self.cumulus),
            Tier::Nimbus => Some(self.nimbus),
            Tier::Stratus => Some(self.stratus),
            Tier::Unknown => None,
        }
    }
}

/// What a coinbase output pays for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PayoutRole {
    /// A fluxnode payment for this tier.
    Node(Tier),
    /// The dev fund (remainder plus fees).
    DevFund,
    /// Anything else (pre-PoN miner output, unexpected outputs).
    Other,
}

/// Classifies one coinbase output of a PoN block by amount (and the dev-fund address), as
/// consensus does not fix the output order.
///
/// The dev fund is recognized by address first; an output whose amount equals a tier payout is
/// that tier. If the dev-fund address is not known for an output, an amount at least the dev
/// minimum and not matching any tier is treated as the dev fund.
pub fn classify_output(height: u32, address: Option<&str>, amount: Amount) -> PayoutRole {
    let Some(s) = PayoutSchedule::at(height) else {
        return PayoutRole::Other;
    };
    if address == Some(DEV_FUND_ADDRESS) {
        return PayoutRole::DevFund;
    }
    for tier in Tier::ALL {
        if s.for_tier(tier) == Some(amount) {
            return PayoutRole::Node(tier);
        }
    }
    if address.is_none() && amount >= s.dev_fund_min {
        return PayoutRole::DevFund;
    }
    PayoutRole::Other
}

/// Result of splitting a PoN coinbase into roles.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CoinbaseSplit {
    /// `(output index, tier, address, amount)` for each node payout, in output order.
    pub node_payouts: Vec<(u32, Tier, String, Amount)>,
    pub dev_fund: Amount,
    /// Dev-fund output minus the minimum: the block's fees.
    pub fees: Amount,
    /// Outputs that fit no role.
    pub other: Vec<(u32, Option<String>, Amount)>,
    pub total: Amount,
}

/// Splits coinbase outputs `(index, first address, amount)` of a PoN block.
pub fn split_coinbase<'a, I>(height: u32, outputs: I) -> CoinbaseSplit
where
    I: IntoIterator<Item = (u32, Option<&'a str>, Amount)>,
{
    let mut out = CoinbaseSplit::default();
    let dev_min = PayoutSchedule::at(height).map_or(Amount::ZERO, |s| s.dev_fund_min);
    for (n, addr, amount) in outputs {
        out.total += amount;
        match classify_output(height, addr, amount) {
            PayoutRole::Node(tier) => {
                out.node_payouts
                    .push((n, tier, addr.unwrap_or_default().to_owned(), amount));
            }
            PayoutRole::DevFund => out.dev_fund += amount,
            PayoutRole::Other => out.other.push((n, addr.map(str::to_owned), amount)),
        }
    }
    if out.dev_fund >= dev_min && !dev_min.is_zero() {
        out.fees = out.dev_fund - dev_min;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flux(s: &str) -> Amount {
        s.parse().unwrap()
    }

    #[test]
    fn subsidy_schedule() {
        assert_eq!(pon_subsidy(2_019_999), None);
        assert_eq!(pon_subsidy(2_020_000), Some(flux("14")));
        assert_eq!(pon_subsidy(3_071_199), Some(flux("14")));
        assert_eq!(pon_subsidy(3_071_200), Some(flux("12.6")));
        assert_eq!(pon_subsidy(4_122_400), Some(flux("11.34")));
        // Floor after 20 cuts, constant afterwards.
        assert_eq!(pon_subsidy(23_044_000), Some(flux("1.70207313")));
        assert_eq!(pon_subsidy(40_000_000), Some(flux("1.70207313")));
        assert_eq!(reductions_at(23_044_000), 20);
        assert_eq!(reductions_at(23_043_999), 19);
        assert_eq!(next_reduction_height(2_996_914), Some(3_071_200));
        assert_eq!(next_reduction_height(3_071_200), Some(4_122_400));
        assert_eq!(next_reduction_height(23_044_000), None);
    }

    #[test]
    fn tier_split() {
        let s = PayoutSchedule::at(2_996_914).unwrap();
        assert_eq!(s.cumulus, flux("1"));
        assert_eq!(s.nimbus, flux("3.5"));
        assert_eq!(s.stratus, flux("9"));
        assert_eq!(s.dev_fund_min, flux("0.5"));
        let s = PayoutSchedule::at(3_071_200).unwrap();
        assert_eq!(s.cumulus, flux("0.9"));
        assert_eq!(s.nimbus, flux("3.15"));
        assert_eq!(s.stratus, flux("8.1"));
        assert_eq!(s.dev_fund_min, flux("0.45"));
        // Every schedule sums exactly to the subsidy.
        for cut in 0..=21u32 {
            let h = PON_ACTIVATION_HEIGHT + cut * REDUCTION_INTERVAL;
            let s = PayoutSchedule::at(h).unwrap();
            assert_eq!(s.cumulus + s.nimbus + s.stratus + s.dev_fund_min, s.subsidy);
            assert!(!s.dev_fund_min.is_negative());
        }
    }

    #[test]
    fn classify() {
        let h = 2_996_914;
        assert_eq!(
            classify_output(h, Some(DEV_FUND_ADDRESS), flux("0.5000003")),
            PayoutRole::DevFund
        );
        assert_eq!(
            classify_output(h, Some("t1x"), flux("1")),
            PayoutRole::Node(Tier::Cumulus)
        );
        assert_eq!(
            classify_output(h, Some("t1x"), flux("3.5")),
            PayoutRole::Node(Tier::Nimbus)
        );
        assert_eq!(
            classify_output(h, Some("t3x"), flux("9")),
            PayoutRole::Node(Tier::Stratus)
        );
        assert_eq!(
            classify_output(h, Some("t1x"), flux("2")),
            PayoutRole::Other
        );
        assert_eq!(
            classify_output(2_019_999, Some("t1x"), flux("1")),
            PayoutRole::Other
        );
    }

    #[test]
    fn split_with_fees() {
        let outs = [
            (0, Some(DEV_FUND_ADDRESS), flux("0.5000003")),
            (1, Some("t1a"), flux("1")),
            (2, Some("t1b"), flux("3.5")),
            (3, Some("t1c"), flux("9")),
        ];
        let s = split_coinbase(2_996_907, outs);
        assert_eq!(s.node_payouts.len(), 3);
        assert_eq!(s.fees, Amount(30));
        assert_eq!(s.dev_fund, flux("0.5000003"));
        assert!(s.other.is_empty());
    }
}

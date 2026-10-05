//! Parallel assets: what Flux Fusion says an address accrued, claimed and can claim on each
//! chain, with display names and explorer links. The accrual rule itself lives in
//! `atlas_core::emission::parallel_asset_accrual`.

use atlas_core::Amount;
use atlas_core::api::{MultiClaim, PaChain, PaClaim, ParallelAssetsDto};
use atlas_core::emission::{parallel_asset_accrual, parallel_asset_accrual_per_chain};

use crate::sources::{FusionMeta, FusionWallet};

/// One parallel-asset chain: Fusion's id, a display name and explorer URL templates
/// (`{txid}`, `{address}`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChainInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub tx: &'static str,
    pub address: &'static str,
}

/// The ten chains Fusion lists, in its order.
pub const CHAINS: [ChainInfo; 10] = [
    ChainInfo {
        id: "kda",
        name: "Kadena",
        tx: "https://explorer.kadena.io/mainnet/transaction/{txid}",
        address: "https://explorer.kadena.io/mainnet/account/{address}",
    },
    ChainInfo {
        id: "eth",
        name: "Ethereum",
        tx: "https://etherscan.io/tx/{txid}",
        address: "https://etherscan.io/address/{address}",
    },
    ChainInfo {
        id: "bsc",
        name: "BNB Smart Chain",
        tx: "https://bscscan.com/tx/{txid}",
        address: "https://bscscan.com/address/{address}",
    },
    ChainInfo {
        id: "trx",
        name: "Tron",
        tx: "https://tronscan.org/#/transaction/{txid}",
        address: "https://tronscan.org/#/address/{address}",
    },
    ChainInfo {
        id: "sol",
        name: "Solana",
        tx: "https://solscan.io/tx/{txid}",
        address: "https://solscan.io/account/{address}",
    },
    ChainInfo {
        id: "avax",
        name: "Avalanche",
        tx: "https://snowtrace.io/tx/{txid}",
        address: "https://snowtrace.io/address/{address}",
    },
    ChainInfo {
        id: "erg",
        name: "Ergo",
        tx: "https://explorer.ergoplatform.com/en/transactions/{txid}",
        address: "https://explorer.ergoplatform.com/en/addresses/{address}",
    },
    ChainInfo {
        id: "algo",
        name: "Algorand",
        tx: "https://allo.info/tx/{txid}",
        address: "https://allo.info/account/{address}",
    },
    ChainInfo {
        id: "matic",
        name: "Polygon",
        tx: "https://polygonscan.com/tx/{txid}",
        address: "https://polygonscan.com/address/{address}",
    },
    ChainInfo {
        id: "base",
        name: "Base",
        tx: "https://basescan.org/tx/{txid}",
        address: "https://basescan.org/address/{address}",
    },
];

/// The Flux main-chain explorer, for claim-all payouts (`flux:<txid>`).
const FLUX_TX: &str = "https://explorer.runonflux.io/tx/{txid}";

/// The chain `id`, case-insensitively.
pub fn chain(id: &str) -> Option<&'static ChainInfo> {
    CHAINS.iter().find(|c| c.id.eq_ignore_ascii_case(id.trim()))
}

/// Fills a URL template; `None` for an empty value or a value that is not URL-safe.
fn fill(template: &str, key: &str, value: &str) -> Option<String> {
    let v = value.trim();
    let safe = !v.is_empty()
        && v.len() <= 256
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'));
    safe.then(|| template.replace(key, v))
}

/// Rounds away float noise from summed FLUX amounts (8 decimals, like the chain).
fn flux(x: f64) -> f64 {
    if x.is_finite() {
        (x * 1e8).round() / 1e8
    } else {
        0.0
    }
}

/// The view of one address. `native_per_day` is the wallet's main-chain run rate, when it runs
/// nodes; the accrual figures are the parallel-asset rule applied to it.
pub fn dto(
    address: &str,
    w: &FusionWallet,
    meta: &FusionMeta,
    native_per_day: Option<Amount>,
) -> ParallelAssetsDto {
    let active = |id: &str| meta.active.iter().any(|a| a.eq_ignore_ascii_case(id));
    let mut chains: Vec<PaChain> = w
        .summary
        .chain_statistics
        .iter()
        .filter(|c| !c.chain.trim().is_empty())
        .map(|c| {
            let id = c.chain.trim().to_ascii_lowercase();
            let info = chain(&id);
            PaChain {
                name: info.map_or_else(|| id.to_ascii_uppercase(), |i| i.name.to_owned()),
                active: active(&id),
                // What accrued on the chain: claimed so far plus what is claimable now
                // (Fusion's per-chain allowance, `maxClaimablePerChain`).
                mined: flux(c.claimed_amount + c.possible_to_claim),
                claimed: flux(c.claimed_amount),
                received: flux(c.received_amount),
                fees_paid: flux(c.fees_paid),
                claimable: flux(c.possible_to_claim),
                claim_fee: meta.fees.mining_fee(&id).unwrap_or(0.0),
                explorer_tx: info.map(|i| i.tx.to_owned()),
                explorer_address: info.map(|i| i.address.to_owned()),
                chain: id,
            }
        })
        .collect();
    // Fusion's order, then any chain it adds later.
    chains.sort_by_key(|c| {
        CHAINS
            .iter()
            .position(|i| i.id == c.chain)
            .unwrap_or(usize::MAX)
    });
    let mut claims: Vec<PaClaim> = w
        .claimed
        .transactions
        .iter()
        .map(|t| {
            let id = t.chain.trim().to_ascii_lowercase();
            let txid = t.txid.trim();
            let main = txid
                .strip_prefix("flux:")
                .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()));
            let explorer_url = match main {
                Some(h) => fill(FLUX_TX, "{txid}", h),
                None => chain(&id).and_then(|i| fill(i.tx, "{txid}", txid)),
            };
            PaClaim {
                chain: id,
                amount: flux(t.amount),
                txid: txid.to_owned(),
                to: t.claimed_address.trim().to_owned(),
                explorer_url,
                time_ms: t.timestamp.filter(|ms| *ms > 0),
                main_txid: main.map(str::to_owned),
                fee: flux(t.fee),
            }
        })
        .collect();
    // Newest first; records without a time (older ones) last, in Fusion's order.
    claims.reverse();
    claims.sort_by_key(|c| std::cmp::Reverse(c.time_ms));
    let claimed: f64 = chains.iter().map(|c| c.claimed).sum();
    let claimable: f64 = chains.iter().map(|c| c.claimable).sum();
    ParallelAssetsDto {
        address: address.to_owned(),
        fetched_ms: w.fetched_ms,
        mined: flux(chains.iter().map(|c| c.mined).sum()),
        claimed: flux(claimed),
        claimable: flux(claimable),
        multi: MultiClaim {
            claimable: flux(w.multi.total_claim),
            fees: flux(w.multi.total_fee),
            net: flux(w.multi.total_reward),
        },
        accrual_per_day: native_per_day.map(|n| parallel_asset_accrual(n).to_flux_f64()),
        accrual_per_chain_per_day: native_per_day
            .map(|n| parallel_asset_accrual_per_chain(n).to_flux_f64()),
        chains,
        claims,
    }
}

#[cfg(test)]
mod tests {
    use atlas_flux::envelope::parse_envelope;

    use super::*;

    fn fixture<T: serde::de::DeserializeOwned>(name: &str) -> T {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/research/fixtures/fusion")
            .join(name);
        parse_envelope("fixture", &std::fs::read(path).unwrap()).unwrap()
    }

    fn wallet() -> (FusionWallet, FusionMeta) {
        (
            FusionWallet {
                summary: fixture("fusion_coinbase_summary_t3c4.json"),
                multi: fixture("fusion_coinbase_multiavailable_t3c4.json"),
                claimed: fixture("fusion_coinbase_claimed_t3c4_trimmed4.json"),
                fetched_ms: 1_790_000_000_000,
            },
            FusionMeta {
                fees: fixture("fusion_fees.json"),
                active: fixture::<atlas_flux::models::fusion::ActiveChains>(
                    "fusion_swap_activechains.json",
                )
                .0,
            },
        )
    }

    #[test]
    fn real_wallet_totals_and_chains() {
        let (w, meta) = wallet();
        let d = dto(
            "t3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ",
            &w,
            &meta,
            Some(Amount::from_flux_f64(3_092.7).unwrap()),
        );
        assert_eq!(d.chains.len(), 10);
        assert_eq!(d.chains[0].chain, "kda");
        assert_eq!(d.chains[0].name, "Kadena");
        // Ten chains of 43,555.5 claimable; the claim-all leaves erg out.
        assert!((d.claimable - 435_555.0).abs() < 1e-6, "{}", d.claimable);
        assert!((d.multi.claimable - 391_999.5).abs() < 1e-6);
        assert!((d.multi.net + d.multi.fees - d.multi.claimable).abs() < 1e-6);
        let erg = d.chains.iter().find(|c| c.chain == "erg").unwrap();
        assert!(!erg.active, "erg accrues but is not active");
        assert!((erg.claimable - 43_555.5).abs() < 1e-9);
        assert_eq!(d.chains.iter().filter(|c| c.active).count(), 9);
        // Accrued per chain = claimed + claimable = 10% of the coinbase.
        assert!((d.mined - 1_500_904.312_5).abs() < 1e-3, "{}", d.mined);
        assert!((d.claimed - 1_065_349.312_5).abs() < 1e-3, "{}", d.claimed);
        let matic = d.chains.iter().find(|c| c.chain == "matic").unwrap();
        assert!((matic.claim_fee - 31.0).abs() < 1e-9);
        assert_eq!(
            matic.explorer_tx.as_deref(),
            Some("https://polygonscan.com/tx/{txid}")
        );
        assert_eq!(d.accrual_per_day, Some(3_092.7));
        // A tenth of it on each chain.
        assert_eq!(d.accrual_per_chain_per_day, Some(309.27));
    }

    #[test]
    fn claims_are_newest_first_with_links() {
        let (w, meta) = wallet();
        let d = dto("t3c4", &w, &meta, None);
        assert_eq!(d.claims.len(), 4);
        assert!(d.claims.windows(2).all(|p| p[0].time_ms >= p[1].time_ms));
        let newest = &d.claims[0];
        assert!(newest.txid.starts_with("flux:"));
        let main = newest.main_txid.as_deref().unwrap();
        assert_eq!(main.len(), 64);
        assert_eq!(
            newest.explorer_url.as_deref(),
            Some(format!("https://explorer.runonflux.io/tx/{main}").as_str())
        );
        let oldest = d.claims.last().unwrap();
        assert_eq!(oldest.chain, "matic");
        assert!(oldest.main_txid.is_none());
        assert!(
            oldest
                .explorer_url
                .as_deref()
                .unwrap()
                .starts_with("https://polygonscan.com/tx/0x")
        );
        assert!(oldest.fee > 0.0);
    }

    #[test]
    fn templates_refuse_unsafe_values() {
        assert_eq!(fill("https://x/{txid}", "{txid}", ""), None);
        assert_eq!(fill("https://x/{txid}", "{txid}", "a/../b"), None);
        assert_eq!(fill("https://x/{txid}", "{txid}", "<script>"), None);
        assert_eq!(
            fill("https://x/{txid}", "{txid}", "k:abc_-1"),
            Some("https://x/k:abc_-1".to_owned())
        );
        assert_eq!(chain("ETH").map(|c| c.name), Some("Ethereum"));
        assert!(chain("doge").is_none());
    }

    #[test]
    fn an_address_without_coinbase_is_all_zero() {
        let (_, meta) = wallet();
        let w = FusionWallet {
            summary: fixture("fusion_coinbase_summary_no_coinbase.json"),
            ..FusionWallet::default()
        };
        let d = dto("t1Kz", &w, &meta, None);
        assert_eq!(d.chains.len(), 10);
        assert_eq!((d.mined, d.claimed, d.claimable), (0.0, 0.0, 0.0));
        assert!(d.claims.is_empty());
    }
}

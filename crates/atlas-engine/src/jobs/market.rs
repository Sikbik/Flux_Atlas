//! T2 Price (Insight markets, CoinGecko fallback) and Supply (`gettxoutsetinfo` +
//! `getblockchaininfo` value pools, Insight circulating supply). The socket also pushes
//! `markets_info` and per-block `info.supply`, handled by the chain job.

use std::time::Duration;

use atlas_core::api::PriceInfo;
use atlas_core::{Amount, now_ms};

use super::JobCtx;
use crate::obs::Obs;
use crate::stats::Upstream;

pub async fn price(ctx: JobCtx) {
    let iv = ctx.cfg.price_interval;
    if !ctx.sleep(Duration::from_secs(5)).await {
        return;
    }
    loop {
        let p = match ctx
            .call(
                Upstream::Insight,
                "markets/info",
                ctx.clients.insight.markets_info(),
            )
            .await
        {
            Ok(m) if m.price > 0.0 => Some(PriceInfo {
                usd: m.price,
                btc: m.price_btc,
                change_24h_pct: m.delta_24h,
                market_cap_usd: m.market_cap_usd,
                volume_24h_usd: m.total_volume_24h,
                updated_ms: now_ms(),
                source: "insight".to_owned(),
            }),
            Ok(_) => None,
            Err(e) => {
                ctx.fail("price", &e);
                None
            }
        };
        let p = match p {
            Some(p) => Some(p),
            None => match ctx
                .call(
                    Upstream::CoinGecko,
                    "simple/price",
                    ctx.clients.coingecko.simple_price(),
                )
                .await
            {
                Ok(v) => {
                    v.0.get("zelcash")
                        .filter(|c| c.usd > 0.0)
                        .map(|c| PriceInfo {
                            usd: c.usd,
                            btc: c.btc,
                            change_24h_pct: c.usd_24h_change,
                            market_cap_usd: c.usd_market_cap,
                            volume_24h_usd: c.usd_24h_vol,
                            updated_ms: now_ms(),
                            source: "coingecko".to_owned(),
                        })
                }
                Err(e) => {
                    ctx.fail("price", &e);
                    None
                }
            },
        };
        if let Some(p) = p
            && !ctx.send(Obs::Price(p)).await
        {
            return;
        }
        ctx.next("price", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

pub async fn supply(ctx: JobCtx) {
    let iv = ctx.cfg.supply_interval;
    if !ctx.sleep(Duration::from_secs(30)).await {
        return;
    }
    loop {
        let txout = ctx
            .call(
                Upstream::FluxOs,
                "gettxoutsetinfo",
                ctx.clients.fluxos.get_txout_set_info(),
            )
            .await;
        let chain = ctx
            .call(
                Upstream::FluxOs,
                "getblockchaininfo",
                ctx.clients.fluxos.get_blockchain_info(),
            )
            .await;
        match (txout, chain) {
            (Ok(t), Ok(c)) => {
                let transparent = Amount::from_flux_f64(t.total_amount).unwrap_or(Amount::ZERO);
                let shielded = Amount::from_sat(c.shielded_zat());
                if !ctx
                    .send(Obs::Supply {
                        height: t.height,
                        transparent,
                        shielded,
                    })
                    .await
                {
                    return;
                }
            }
            (Err(e), _) | (_, Err(e)) => ctx.fail("supply", &e),
        }
        match ctx
            .call(
                Upstream::Insight,
                "statistics/circulating-supply",
                ctx.clients.insight.circulating_supply(),
            )
            .await
        {
            Ok(c) => {
                if let Some(a) = c.amount() {
                    let _ = ctx.send(Obs::Circulating(a)).await;
                }
            }
            Err(e) => ctx.fail("supply", &e),
        }
        ctx.next("supply", iv);
        if !ctx.sleep(iv).await {
            return;
        }
    }
}

//! On-demand explorer lookups against upstream (Insight for anything needing input values and
//! address aggregates, FluxOS for decoded blocks, mempool and supply), cached per explorer
//! research section 7.2 and guarded per client IP.

use std::net::IpAddr;
use std::sync::Arc;

use atlas_core::api::{SupplyInfo, TxDetailDto, TxInputDto, TxLite, TxOutputDto, UtxoDto};
use atlas_core::chain::{BlockSummary, NodeTx};
use atlas_core::{Amount, Hash32, now_ms};
use atlas_flux::Clients;
use atlas_flux::decode::decode_block;
use atlas_flux::models::apps::APP_PAYMENT_ADDRESS;
use atlas_flux::models::daemon::DaemonBlock;
use atlas_flux::models::insight::{InsightAddrSummary, InsightTx, RichListRow};

use crate::config::{ClientLimits, ProxyTtls};
use crate::error::ApiError;
use crate::proxy::{Fetch, TtlCache, UpstreamGuard, Weigh, guarded};

/// A decoded block as served by the explorer.
#[derive(Debug, Clone)]
pub struct BlockView {
    pub summary: BlockSummary,
    pub node_txs: Vec<NodeTx>,
    pub txs: Vec<TxLite>,
    pub confirmations: Option<u32>,
    pub next_hash: Option<Hash32>,
}

/// One page of an address's transactions.
#[derive(Debug, Clone)]
pub struct AddrTxsPage {
    pub items: Vec<TxDetailDto>,
    pub total: u32,
}

/// The upstream mempool at one moment.
#[derive(Debug, Clone, Default)]
pub struct MempoolSnapshot {
    /// `(txid, size, first seen ms)`, newest first.
    pub entries: Vec<(Hash32, u32, u64)>,
    pub bytes: u64,
    pub fetched_ms: u64,
}

/// Cached upstream explorer.
#[derive(Debug)]
pub struct Explorer {
    clients: Clients,
    pub ttl: ProxyTtls,
    pub guard: UpstreamGuard,
    pub txs: TtlCache<Hash32, TxDetailDto>,
    pub blocks: TtlCache<String, BlockView>,
    pub headers: TtlCache<Hash32, u32>,
    pub addrs: TtlCache<String, InsightAddrSummary>,
    pub addr_txs: TtlCache<(String, u32, u32, u32), AddrTxsPage>,
    pub utxos: TtlCache<String, Vec<UtxoDto>>,
    pub mempool: TtlCache<(), MempoolSnapshot>,
    pub supply: TtlCache<(), SupplyInfo>,
    pub richlist: TtlCache<(), RichRows>,
}

/// Rich-list rows with their fetch time.
#[derive(Debug, Clone)]
pub struct RichRows {
    pub rows: Vec<RichListRow>,
    pub fetched_ms: u64,
}

impl Weigh for BlockView {
    fn weigh(&self) -> usize {
        size_of::<Self>()
            + self.summary.payouts.len() * 96
            + self.node_txs.len() * (size_of::<NodeTx>() + 32)
            + self.txs.len() * size_of::<TxLite>()
    }
}

impl Weigh for AddrTxsPage {
    fn weigh(&self) -> usize {
        size_of::<Self>() + self.items.iter().map(Weigh::weigh).sum::<usize>()
    }
}

impl Weigh for MempoolSnapshot {
    fn weigh(&self) -> usize {
        size_of::<Self>() + self.entries.len() * size_of::<(Hash32, u32, u64)>()
    }
}

impl Weigh for RichRows {
    fn weigh(&self) -> usize {
        size_of::<Self>()
            + self
                .rows
                .iter()
                .map(|r| size_of::<RichListRow>() + r.address.len())
                .sum::<usize>()
    }
}

/// Byte bounds of the explorer proxy caches (about 56 MiB in all; measured weights of real
/// answers: a decoded tx about 1 to 3 KiB, a block view about 4 to 40 KiB).
pub mod cache_bytes {
    const MIB: u64 = 1 << 20;
    pub const TXS: u64 = 16 * MIB;
    pub const BLOCKS: u64 = 16 * MIB;
    pub const HEADERS: u64 = 2 * MIB;
    pub const ADDRS: u64 = 4 * MIB;
    pub const ADDR_TXS: u64 = 12 * MIB;
    pub const UTXOS: u64 = 4 * MIB;
    /// One-entry caches (mempool, supply, rich list).
    pub const SINGLE: u64 = 4 * MIB;
    pub const TOTAL: u64 = TXS + BLOCKS + HEADERS + ADDRS + ADDR_TXS + UTXOS + 3 * SINGLE;
}

impl Explorer {
    pub fn new(clients: Clients, ttl: ProxyTtls, limits: ClientLimits) -> Self {
        use cache_bytes as b;
        Self {
            clients,
            ttl,
            guard: UpstreamGuard::new(limits),
            txs: TtlCache::new("transaction", b::TXS),
            blocks: TtlCache::new("block", b::BLOCKS),
            headers: TtlCache::new("block", b::HEADERS),
            addrs: TtlCache::new("address", b::ADDRS),
            addr_txs: TtlCache::new("address page", b::ADDR_TXS),
            utxos: TtlCache::new("address utxos", b::UTXOS),
            mempool: TtlCache::new("mempool", b::SINGLE),
            supply: TtlCache::new("supply", b::SINGLE),
            richlist: TtlCache::new("rich list", b::SINGLE),
        }
    }

    /// The upstream clients of the explorer's lane (the interactive one in production), for
    /// metrics.
    pub fn clients(&self) -> &Clients {
        &self.clients
    }

    /// Cache name and stats, for metrics.
    pub fn cache_stats(&self) -> Vec<(&'static str, &crate::proxy::CacheStats, u64)> {
        self.cache_sizes()
            .into_iter()
            .map(|(n, st, entries, _)| (n, st, entries))
            .collect()
    }

    /// Cache name, stats, entries and approximate bytes held.
    pub fn cache_sizes(&self) -> Vec<(&'static str, &crate::proxy::CacheStats, u64, u64)> {
        macro_rules! row {
            ($name:literal, $c:expr) => {
                ($name, &$c.stats, $c.entry_count(), $c.weighted_size())
            };
        }
        vec![
            row!("tx", self.txs),
            row!("block", self.blocks),
            row!("header", self.headers),
            row!("address", self.addrs),
            row!("address_txs", self.addr_txs),
            row!("utxos", self.utxos),
            row!("mempool", self.mempool),
            row!("supply", self.supply),
            row!("richlist", self.richlist),
        ]
    }

    /// `GET /api/tx/<txid>` (Insight: inputs carry prevout values and addresses).
    pub async fn tx(&self, ip: Option<IpAddr>, txid: Hash32) -> Result<Arc<TxDetailDto>, ApiError> {
        let ttl = self.ttl;
        guarded(
            &self.guard,
            &self.txs,
            ip,
            txid,
            Box::pin(async move {
                match self.clients.insight.tx(&txid).await {
                    Ok(t) => {
                        let dto = map_insight_tx(&t).ok_or_else(|| {
                            ApiError::upstream("upstream returned an unreadable tx")
                        })?;
                        let conf = (dto.height.is_some()).then_some(dto.confirmations);
                        Ok(Fetch::Found(dto, ttl.for_confirmations(conf)))
                    }
                    Err(e) => not_found_or(&e, "transaction", ttl),
                }
            }),
        )
        .await
    }

    /// A decoded block by height or hash (FluxOS `getblock`, verbosity 2).
    pub async fn block(&self, ip: Option<IpAddr>, id: String) -> Result<Arc<BlockView>, ApiError> {
        let ttl = self.ttl;
        let key = id.clone();
        guarded(
            &self.guard,
            &self.blocks,
            ip,
            key,
            Box::pin(async move {
                match self.clients.fluxos.get_block(&id).await {
                    Ok(b) => {
                        let view = block_view(&b)?;
                        let t = ttl.for_confirmations(view.confirmations.filter(|c| *c > 0));
                        Ok(Fetch::Found(view, t))
                    }
                    Err(e) => not_found_or(&e, "block", ttl),
                }
            }),
        )
        .await
    }

    /// Height of a block hash (FluxOS `getblockheader`), used by search probes.
    pub async fn block_height(
        &self,
        ip: Option<IpAddr>,
        hash: Hash32,
    ) -> Result<Arc<u32>, ApiError> {
        let ttl = self.ttl;
        guarded(
            &self.guard,
            &self.headers,
            ip,
            hash,
            Box::pin(async move {
                match self.clients.fluxos.get_block_header(&hash.to_hex()).await {
                    Ok(h) => Ok(Fetch::Found(h.height, ttl.immutable)),
                    Err(e) => not_found_or(&e, "block", ttl),
                }
            }),
        )
        .await
    }

    pub async fn address(
        &self,
        ip: Option<IpAddr>,
        addr: &str,
    ) -> Result<Arc<InsightAddrSummary>, ApiError> {
        let ttl = self.ttl;
        let a = addr.to_owned();
        guarded(
            &self.guard,
            &self.addrs,
            ip,
            a.clone(),
            Box::pin(async move {
                match self.clients.insight.address(&a).await {
                    Ok(s) => {
                        let t = if s.tx_appearances > 10_000 {
                            ttl.address_large
                        } else {
                            ttl.address
                        };
                        Ok(Fetch::Found(s, t))
                    }
                    Err(e) => not_found_or(&e, "address", ttl),
                }
            }),
        )
        .await
    }

    /// Address txs `from..to` (newest first). Deep pages are keyed by the tip so appended
    /// history cannot shift a cached page.
    pub async fn address_txs(
        &self,
        ip: Option<IpAddr>,
        addr: &str,
        from: u32,
        to: u32,
        tip: u32,
    ) -> Result<Arc<AddrTxsPage>, ApiError> {
        let ttl = self.ttl;
        let a = addr.to_owned();
        let key = (a.clone(), from, to, if from == 0 { 0 } else { tip });
        guarded(
            &self.guard,
            &self.addr_txs,
            ip,
            key,
            Box::pin(async move {
                match self.clients.insight.address_txs(&a, from, to).await {
                    Ok(p) => {
                        let items = p.items.iter().filter_map(map_insight_tx).collect();
                        let t = if from == 0 {
                            ttl.address_txs_first
                        } else {
                            ttl.address_txs_deep
                        };
                        Ok(Fetch::Found(
                            AddrTxsPage {
                                items,
                                total: p.total_items,
                            },
                            t,
                        ))
                    }
                    Err(e) => not_found_or(&e, "address", ttl),
                }
            }),
        )
        .await
    }

    /// Unspent outputs of an address, largest first.
    pub async fn utxos(
        &self,
        ip: Option<IpAddr>,
        addr: &str,
    ) -> Result<Arc<Vec<UtxoDto>>, ApiError> {
        let ttl = self.ttl;
        let a = addr.to_owned();
        guarded(
            &self.guard,
            &self.utxos,
            ip,
            a.clone(),
            Box::pin(async move {
                match self.clients.insight.utxos(&a).await {
                    Ok(rows) => {
                        let mut v: Vec<UtxoDto> = rows
                            .iter()
                            .filter_map(|u| {
                                Some(UtxoDto {
                                    txid: Hash32::from_hex(&u.txid).ok()?,
                                    vout: u.vout,
                                    value: Amount::from_sat(u.satoshis),
                                    height: u.height.filter(|h| *h > 0),
                                    confirmations: u.confirmations.unwrap_or(0),
                                    coinbase: u.coinbase.unwrap_or(false),
                                })
                            })
                            .collect();
                        v.sort_by(|a, b| b.value.cmp(&a.value).then_with(|| a.txid.cmp(&b.txid)));
                        Ok(Fetch::Found(v, ttl.utxos))
                    }
                    Err(atlas_flux::FluxError::AnswerTooLarge { .. }) => Err(ApiError::upstream(
                        "this address has too many unspent outputs to list",
                    )),
                    Err(e) => not_found_or(&e, "address", ttl),
                }
            }),
        )
        .await
    }

    pub async fn mempool(&self, ip: Option<IpAddr>) -> Result<Arc<MempoolSnapshot>, ApiError> {
        let ttl = self.ttl;
        guarded(
            &self.guard,
            &self.mempool,
            ip,
            (),
            Box::pin(async move {
                let m = self
                    .clients
                    .fluxos
                    .get_raw_mempool()
                    .await
                    .map_err(|e| ApiError::from_flux("mempool", &e))?;
                let mut entries: Vec<(Hash32, u32, u64)> =
                    m.0.iter()
                        .filter_map(|(txid, e)| {
                            Some((Hash32::from_hex(txid).ok()?, e.size, e.time * 1000))
                        })
                        .collect();
                entries.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
                let bytes = entries.iter().map(|e| u64::from(e.1)).sum();
                Ok(Fetch::Found(
                    MempoolSnapshot {
                        entries,
                        bytes,
                        fetched_ms: now_ms(),
                    },
                    ttl.mempool,
                ))
            }),
        )
        .await
    }

    pub async fn supply(&self, ip: Option<IpAddr>) -> Result<Arc<SupplyInfo>, ApiError> {
        let ttl = self.ttl;
        guarded(
            &self.guard,
            &self.supply,
            ip,
            (),
            Box::pin(async move {
                let fx = &self.clients.fluxos;
                let (set, chain, circ) = tokio::join!(
                    fx.get_txout_set_info(),
                    fx.get_blockchain_info(),
                    self.clients.insight.circulating_supply()
                );
                let set = set.map_err(|e| ApiError::from_flux("supply", &e))?;
                let transparent = Amount::from_flux_f64(set.total_amount)
                    .ok_or_else(|| ApiError::upstream("upstream supply is not a number"))?;
                let chain = chain.map_err(|e| ApiError::from_flux("supply", &e))?;
                let shielded = Amount::from_sat(chain.shielded_zat());
                Ok(Fetch::Found(
                    SupplyInfo {
                        height: set.height,
                        transparent,
                        shielded,
                        total: transparent + shielded,
                        circulating_explorer: circ.ok().and_then(|c| c.amount()),
                        updated_ms: now_ms(),
                    },
                    ttl.supply,
                ))
            }),
        )
        .await
    }

    pub async fn richlist(&self, ip: Option<IpAddr>) -> Result<Arc<RichRows>, ApiError> {
        let ttl = self.ttl;
        guarded(
            &self.guard,
            &self.richlist,
            ip,
            (),
            Box::pin(async move {
                let rows = self
                    .clients
                    .insight
                    .richest()
                    .await
                    .map_err(|e| ApiError::from_flux("rich list", &e))?;
                Ok(Fetch::Found(
                    RichRows {
                        rows,
                        fetched_ms: now_ms(),
                    },
                    ttl.richlist,
                ))
            }),
        )
        .await
    }
}

fn not_found_or<V>(
    e: &atlas_flux::FluxError,
    what: &str,
    ttl: ProxyTtls,
) -> Result<Fetch<V>, ApiError> {
    let mapped = ApiError::from_flux(what, e);
    if mapped.status == axum::http::StatusCode::NOT_FOUND {
        Ok(Fetch::NotFound(ttl.not_found))
    } else {
        Err(mapped)
    }
}

/// Printable text of an `OP_RETURN <hex>` script.
pub fn op_return_text(asm: &str) -> Option<String> {
    let hex_part = asm.strip_prefix("OP_RETURN")?.trim();
    let bytes = hex::decode(hex_part).ok()?;
    let s = String::from_utf8(bytes).ok()?;
    (!s.is_empty() && s.chars().all(|c| !c.is_control())).then_some(s)
}

fn parse_hash(s: Option<&str>) -> Option<Hash32> {
    s.and_then(|h| Hash32::from_hex(h).ok())
}

/// Maps an Insight transaction onto the API DTO (node attribution is added by the handler).
pub fn map_insight_tx(t: &InsightTx) -> Option<TxDetailDto> {
    let txid = Hash32::from_hex(&t.txid).ok()?;
    let coinbase =
        t.is_coinbase == Some(true) || t.vin.first().is_some_and(|v| v.coinbase.is_some());
    let inputs: Vec<TxInputDto> = t
        .vin
        .iter()
        .map(|v| TxInputDto {
            coinbase: v.coinbase.is_some(),
            prev_txid: parse_hash(v.txid.as_deref()),
            prev_vout: if v.coinbase.is_some() { None } else { v.vout },
            address: v.addr.clone(),
            value: v
                .value_sat
                .map(Amount::from_sat)
                .or_else(|| v.value.and_then(Amount::from_flux_f64)),
        })
        .collect();
    let outputs: Vec<TxOutputDto> = t
        .vout
        .iter()
        .map(|o| TxOutputDto {
            n: o.n,
            address: o.script_pub_key.addresses.first().cloned(),
            value: o.amount(),
            script_type: o.script_pub_key.kind.clone(),
            spent_txid: parse_hash(o.spent_tx_id.as_deref()),
            spent_height: o.spent_height,
            op_return: op_return_text(&o.script_pub_key.asm),
        })
        .collect();
    let value_out: Amount = outputs.iter().map(|o| o.value).sum();
    let value_in = if coinbase || inputs.is_empty() {
        None
    } else if inputs.iter().all(|i| i.value.is_some()) {
        Some(inputs.iter().filter_map(|i| i.value).sum())
    } else {
        t.value_in.and_then(Amount::from_flux_f64)
    };
    let fee = t
        .fees
        .and_then(Amount::from_flux_f64)
        .or_else(|| value_in.map(|v| v - value_out));
    let node = t.node_tx();
    // The block / mempool classifier, read from the Insight form.
    let kind = atlas_flux::decode::classify_insight_tx(t, APP_PAYMENT_ADDRESS);
    Some(TxDetailDto {
        txid,
        height: t.height(),
        block_hash: parse_hash(t.blockhash.as_deref()),
        time_ms: t.blocktime.or(t.time).map(|s| s * 1000),
        confirmations: t.confirmations.map_or(0, |c| c.max(0) as u32),
        size: t.size,
        version: t.version,
        kind,
        inputs,
        outputs,
        value_in,
        value_out,
        fee,
        node_tx: node.map(|n| node_tx_dto(&n)),
    })
}

pub fn node_tx_dto(n: &NodeTx) -> atlas_core::api::NodeTxDto {
    atlas_core::api::NodeTxDto {
        txid: n.txid,
        kind: n.kind,
        collateral: n.collateral,
        endpoint: n.endpoint.map(|e| e.to_string()),
        benchmark_tier: n.benchmark_tier,
        sig_time_ms: n.sig_time.saturating_mul(1000),
        tx_version: n.tx_version,
        p2sh: n.p2sh,
        node: n.node,
    }
}

/// Decodes a verbosity-2 block into the explorer view.
pub fn block_view(b: &DaemonBlock) -> Result<BlockView, ApiError> {
    let decoded =
        decode_block(b).map_err(|e| ApiError::upstream(format!("undecodable block: {e}")))?;
    let txs = b
        .full_txs()
        .iter()
        .filter_map(|tx| {
            Some(TxLite {
                txid: Hash32::from_hex(&tx.txid).ok()?,
                value: tx
                    .vout
                    .iter()
                    .map(atlas_flux::models::daemon::DaemonVout::amount)
                    .sum(),
                kind: atlas_flux::decode::classify_tx(tx, APP_PAYMENT_ADDRESS),
                // Verbosity 2 has no per-tx size: computed from the decoded fields.
                size: tx.serialized_size(),
            })
        })
        .collect();
    Ok(BlockView {
        summary: decoded.summary,
        node_txs: decoded.node_txs,
        txs,
        confirmations: b.confirmations.and_then(|c| u32::try_from(c).ok()),
        next_hash: parse_hash(b.nextblockhash.as_deref()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_core::chain::TxKind;

    fn fixture(name: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/research/fixtures/explorer")
            .join(name);
        std::fs::read_to_string(p).unwrap()
    }

    #[test]
    fn maps_regular_tx() {
        let t: InsightTx = serde_json::from_str(&fixture("insight_tx_regular.json")).unwrap();
        let d = map_insight_tx(&t).unwrap();
        assert_eq!(d.kind, TxKind::Transfer);
        assert_eq!(d.inputs.len(), 1);
        assert_eq!(d.inputs[0].value, Some(Amount::from_sat(5_871_086_756)));
        assert_eq!(d.height, Some(2_996_907));
        assert!(d.fee.is_some());
        assert_eq!(d.value_in.unwrap() - d.value_out, d.fee.unwrap());
    }

    #[test]
    fn maps_coinbase_and_node_txs() {
        let t: InsightTx = serde_json::from_str(&fixture("insight_tx_coinbase_pon.json")).unwrap();
        let d = map_insight_tx(&t).unwrap();
        assert_eq!(d.kind, TxKind::Coinbase);
        assert!(d.value_in.is_none());
        let t: InsightTx =
            serde_json::from_str(&fixture("insight_tx_fluxnode_start_v5.json")).unwrap();
        let d = map_insight_tx(&t).unwrap();
        assert_eq!(d.kind, TxKind::NodeStart);
        assert!(d.node_tx.is_some());
        let t: InsightTx =
            serde_json::from_str(&fixture("insight_tx_unconfirmed_confirm.json")).unwrap();
        let d = map_insight_tx(&t).unwrap();
        assert_eq!(d.kind, TxKind::NodeConfirm);
        assert_eq!(d.height, None);
    }

    #[test]
    fn decodes_block_view() {
        let v: serde_json::Value =
            serde_json::from_str(&fixture("fluxos_daemon_getblock_2996914_verbose.json")).unwrap();
        let b: DaemonBlock = serde_json::from_value(v["data"].clone()).unwrap();
        let view = block_view(&b).unwrap();
        assert_eq!(view.summary.height, 2_996_914);
        assert_eq!(view.txs.len() as u32, view.summary.tx_count);
        assert_eq!(view.txs[0].kind, TxKind::Coinbase);
        assert!(!view.node_txs.is_empty());
        assert!(
            view.txs.iter().all(|t| t.size.is_some_and(|s| s > 0)),
            "every tx of a verbosity-2 block gets its computed size"
        );
    }

    #[test]
    fn op_return() {
        assert_eq!(op_return_text("OP_RETURN 6869").as_deref(), Some("hi"));
        assert_eq!(op_return_text("OP_RETURN 00ff"), None);
        assert_eq!(op_return_text("OP_DUP"), None);
    }
}

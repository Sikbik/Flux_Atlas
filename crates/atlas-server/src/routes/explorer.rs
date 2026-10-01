//! Explorer: blocks (store first, else upstream), transactions, addresses, mempool, supply,
//! rich list. Upstream-backed routes go through the proxy cache and the per-IP guard.

use std::sync::Arc;
use std::time::Duration;

use atlas_core::api::{
    AddressDto, AddressKind, AddressNodesDto, AddressTxsPage, AddressUtxosDto, BlockDetailDto,
    BlocksPage, MempoolDto, NodeRow, RichListDto, RichListEntry, SupplyDto, TierCounts, TxAppRef,
    TxDetailDto, TxLite,
};
use atlas_core::chain::{BlockSummary, NodeTx, NodeTxKind, TxKind};
use atlas_core::emission::{self, PON_ACTIVATION_HEIGHT};
use atlas_core::ids::Collateral;
use atlas_core::{Amount, Hash32};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;

use crate::body::{cache, json_response};
use crate::config::FINALITY_DEPTH;
use crate::error::{ApiError, ApiResult};
use crate::explorer::{BlockView, node_tx_dto};
use crate::extract::{ClientIp, P, Q, check_param, offset_cursor, page_limit};
use crate::search::{AddressClass, classify_address};
use crate::state::AppState;
use crate::views::{Views, block_lite, node_ref, node_row};

/// Announced maximum supply (reference line only; not enforced by consensus code).
pub const MAX_SUPPLY_REFERENCE: Amount = Amount::from_flux(560_000_000);

fn explorer_cache(confirmations: u32) -> &'static str {
    if confirmations >= FINALITY_DEPTH {
        cache::EXPLORER_DEEP
    } else {
        cache::EXPLORER_RECENT
    }
}

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BlocksQuery {
    pub before: Option<u32>,
    pub limit: Option<u32>,
}

/// Largest `/blocks` page.
pub const BLOCKS_PAGE_MAX: u32 = 1_000;

/// `GET /blocks?before&limit`: newest first; published recent blocks, then the store. A full,
/// gapless page wholly below the finality window never changes, so its body is cached by
/// `(before, limit)`.
pub async fn blocks(
    State(s): State<AppState>,
    headers: HeaderMap,
    Q(q): Q<BlocksQuery>,
) -> ApiResult<Response> {
    let limit = page_limit(q.limit, 20, BLOCKS_PAGE_MAX)?;
    let v = s.views();
    let before = q.before.unwrap_or(u32::MAX);
    let deep = v
        .tip_height()
        .is_some_and(|tip| u64::from(before) + u64::from(FINALITY_DEPTH) <= u64::from(tip));
    if deep && let Some(body) = s.blocks_cache.get(&(before, limit)).await {
        return Ok(body.respond(&headers, cache::EXPLORER_DEEP));
    }
    let want_n = limit as usize;
    let mut items: Vec<_> = v
        .published
        .blocks
        .iter()
        .filter(|b| b.height < before)
        .take(want_n)
        .cloned()
        .collect();
    if items.len() < want_n {
        let below = items.last().map_or(before, |b| b.height);
        let want = want_n - items.len();
        let more = s
            .store_read(move |st| Ok(st.blocks_before(below, want)?))
            .await?;
        items.extend(more.iter().map(block_lite));
    }
    let next_before = (items.len() == want_n)
        .then(|| items.last().map(|b| b.height))
        .flatten()
        .filter(|h| *h > 0);
    let page = BlocksPage { items, next_before };
    // Only a full page without holes: a hole may still be filled by the block backfill.
    let contiguous = match (page.items.first(), page.items.last()) {
        (Some(top), Some(bottom)) => top.height - bottom.height + 1 == limit,
        _ => false,
    };
    if deep && page.items.len() == want_n && contiguous {
        let body = Arc::new(crate::body::CachedBody::json(&page));
        s.blocks_cache
            .insert((before, limit), Arc::clone(&body))
            .await;
        return Ok(body.respond(&headers, cache::EXPLORER_DEEP));
    }
    Ok(json_response(&headers, &page, cache::EXPLORER_RECENT))
}

enum BlockId {
    Height(u32),
    Hash(Hash32),
}

fn parse_block_id(id: &str) -> Result<BlockId, ApiError> {
    let id = id.trim().trim_start_matches('#');
    if !id.is_empty() && id.len() <= 9 && id.bytes().all(|b| b.is_ascii_digit()) {
        return id
            .parse()
            .map(BlockId::Height)
            .map_err(|_| ApiError::bad_request("invalid height"));
    }
    if id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Hash32::from_hex(id)
            .map(BlockId::Hash)
            .map_err(|_| ApiError::bad_request("invalid block hash"));
    }
    Err(ApiError::bad_request(
        "expected a block height or 64-hex hash",
    ))
}

fn attribute_node_tx(v: &Views, t: &NodeTx) -> atlas_core::api::NodeTxDto {
    let mut d = node_tx_dto(t);
    if d.node.is_none() {
        d.node = v.index.by_outpoint(&t.collateral).map(|i| v.at(i).id);
    }
    d
}

fn producer_ref(v: &Views, b: &BlockSummary) -> Option<atlas_core::api::NodeRef> {
    if let Some(id) = b.producer {
        return v.node_ref(id);
    }
    match b.producer_collateral.as_ref()? {
        Collateral::Full(o) => v.index.by_outpoint(o).map(|i| node_ref(v.at(i))),
        c @ Collateral::Prefix(_) => {
            let mut hits = v.nodes().iter().filter(|n| c.matches(&n.outpoint));
            let first = hits.next()?;
            // Ambiguous prefixes stay unattributed.
            hits.next().is_none().then(|| node_ref(first))
        }
    }
}

fn node_tx_lite(t: &NodeTx) -> TxLite {
    TxLite {
        txid: t.txid,
        value: Amount::ZERO,
        kind: if t.kind == NodeTxKind::Start {
            TxKind::NodeStart
        } else {
            TxKind::NodeConfirm
        },
        // The store keeps no serialized form: unknown, not 0.
        size: None,
    }
}

/// `GET /blocks/{height|hash}`.
pub async fn block(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(id): P<String>,
) -> ApiResult<Response> {
    let id = parse_block_id(check_param("block", &id)?)?;
    let v = s.views();
    if let (BlockId::Height(h), Some(tip)) = (&id, v.tip_height())
        && *h > tip
    {
        return Err(ApiError::not_found(format!(
            "block {h} is beyond the tip ({tip})"
        )));
    }
    let lookup = match &id {
        BlockId::Height(h) => BlockId::Height(*h),
        BlockId::Hash(x) => BlockId::Hash(*x),
    };
    let stored = s
        .store_read(move |st| {
            let b = match lookup {
                BlockId::Height(h) => st.block(h)?,
                BlockId::Hash(x) => st.block_by_hash(&x)?,
            };
            let Some(b) = b else { return Ok(None) };
            let ntx = st.node_txs_at_height(b.height)?;
            let next = st.block(b.height + 1)?.map(|n| n.hash);
            Ok(Some((b, ntx, next)))
        })
        .await?;
    let key = match (&id, &stored) {
        (_, Some((b, _, _))) => b.hash.to_hex(),
        (BlockId::Height(h), None) => h.to_string(),
        (BlockId::Hash(x), None) => x.to_hex(),
    };
    // A recent block comes from the copy the BlockDecoder already fetched (no upstream call).
    let raw = stored
        .as_ref()
        .and_then(|(b, _, _)| s.engine.recent_raw_block(&b.hash))
        .and_then(|raw| crate::explorer::block_view(&raw).ok());
    let upstream: Result<Arc<BlockView>, ApiError> = if let Some(view) = raw {
        Ok(Arc::new(view))
    } else if stored.is_some() {
        // The store has the block: only the full tx list comes from upstream, best effort.
        match tokio::time::timeout(Duration::from_secs(4), s.explorer.block(Some(ip), key)).await {
            Ok(r) => r,
            Err(_) => Err(ApiError::upstream_timeout("block tx list timed out")),
        }
    } else {
        s.explorer.block(Some(ip), key).await
    };
    let (summary, node_txs, txs, next_hash, up_conf) = match (stored, upstream) {
        (Some((b, ntx, next)), up) => {
            let (txs, next_hash, conf) = match up {
                Ok(view) => (
                    view.txs.clone(),
                    view.next_hash.or(next),
                    view.confirmations,
                ),
                Err(e) if e.status == axum::http::StatusCode::TOO_MANY_REQUESTS => return Err(e),
                Err(_) => (ntx.iter().map(node_tx_lite).collect(), next, None),
            };
            (b, ntx, txs, next_hash, conf)
        }
        (None, Ok(view)) => (
            view.summary.clone(),
            view.node_txs.clone(),
            view.txs.clone(),
            view.next_hash,
            view.confirmations,
        ),
        (None, Err(e)) => return Err(e),
    };
    let confirmations = v.confirmations(summary.height).or(up_conf).unwrap_or(0);
    let dto = BlockDetailDto {
        block: block_lite(&summary),
        prev_hash: summary.prev_hash,
        next_hash,
        confirmations,
        version: summary.version,
        producer_collateral: summary
            .producer_collateral
            .as_ref()
            .map(ToString::to_string),
        producer_ref: producer_ref(&v, &summary),
        dev_fund: summary.dev_fund,
        value_out: summary.value_out,
        txs,
        node_txs: node_txs.iter().map(|t| attribute_node_tx(&v, t)).collect(),
    };
    Ok(json_response(&headers, &dto, explorer_cache(confirmations)))
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

fn parse_txid(s: &str) -> Result<Hash32, ApiError> {
    let s = s.trim();
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request("txid must be 64 hex characters"));
    }
    Hash32::from_hex(s).map_err(|_| ApiError::bad_request("invalid txid"))
}

/// Adds live confirmations and node attribution to a cached tx.
fn finish_tx(v: &Views, t: &TxDetailDto) -> TxDetailDto {
    let mut t = t.clone();
    if let Some(h) = t.height
        && let Some(c) = v.confirmations(h)
    {
        t.confirmations = c;
    }
    if let Some(n) = t.node_tx.as_mut()
        && n.node.is_none()
    {
        n.node = v.index.by_outpoint(&n.collateral).map(|i| v.at(i).id);
    }
    t
}

/// The message hash an app payment's OP_RETURN carries.
fn app_message_hash(t: &TxDetailDto) -> Option<Hash32> {
    if t.kind != TxKind::AppMessage {
        return None;
    }
    t.outputs.iter().find_map(|o| {
        o.op_return
            .as_deref()
            .and_then(|h| Hash32::from_hex(h).ok())
    })
}

/// The app message `hash` names: the permanent message, else the pending one.
pub fn app_ref_of(st: &atlas_store::Store, hash: Hash32) -> Result<Option<TxAppRef>, ApiError> {
    if let Some(m) = st.app_message(&hash)? {
        return Ok(Some(TxAppRef {
            name: m.spec.key(),
            display_name: m.spec.name.clone(),
            kind: m.kind,
            spec_version: m.spec.spec_version,
            message_hash: hash,
            height: Some(m.height),
            paid: Some(m.paid),
        }));
    }
    Ok(st
        .pending_app_messages()?
        .into_iter()
        .find(|p| p.hash == hash)
        .map(|p| TxAppRef {
            name: p.spec.key(),
            display_name: p.spec.name.clone(),
            kind: p.kind,
            spec_version: p.spec.spec_version,
            message_hash: hash,
            height: None,
            paid: None,
        }))
}

/// Fills `app_ref` on the app payments among `txs` (one store read for all of them).
async fn attach_app_refs(s: &AppState, txs: &mut [TxDetailDto]) -> Result<(), ApiError> {
    let wanted: Vec<(usize, Hash32)> = txs
        .iter()
        .enumerate()
        .filter_map(|(i, t)| app_message_hash(t).map(|h| (i, h)))
        .collect();
    if wanted.is_empty() {
        return Ok(());
    }
    let found = s
        .store_read(move |st| {
            wanted
                .into_iter()
                .map(|(i, h)| Ok((i, app_ref_of(st, h)?)))
                .collect::<Result<Vec<_>, ApiError>>()
        })
        .await?;
    for (i, r) in found {
        txs[i].app_ref = r;
    }
    Ok(())
}

/// `GET /tx/{txid}`.
pub async fn tx(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(txid): P<String>,
) -> ApiResult<Response> {
    let txid = parse_txid(check_param("txid", &txid)?)?;
    let t = s.explorer.tx(Some(ip), txid).await?;
    let v = s.views();
    let mut dto = finish_tx(&v, &t);
    attach_app_refs(&s, std::slice::from_mut(&mut dto)).await?;
    let cc = if dto.height.is_none() {
        cache::EXPLORER_RECENT
    } else {
        explorer_cache(dto.confirmations)
    };
    Ok(json_response(&headers, &dto, cc))
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/// Validates a transparent mainnet address.
pub fn transparent_address(raw: &str) -> Result<(String, AddressKind), ApiError> {
    let a = raw.trim();
    match classify_address(a) {
        AddressClass::Transparent { p2sh, valid: true } => Ok((
            a.to_owned(),
            if p2sh {
                AddressKind::P2sh
            } else {
                AddressKind::P2pkh
            },
        )),
        AddressClass::Transparent { valid: false, .. } => {
            Err(ApiError::bad_request("address checksum is invalid"))
        }
        AddressClass::Shielded { .. } => Err(ApiError::bad_request(
            "shielded address: balances and history are private",
        )),
        AddressClass::Testnet => Err(ApiError::bad_request("testnet addresses are not supported")),
        AddressClass::None => Err(ApiError::bad_request("not a Flux address")),
    }
}

fn node_counts(v: &Views, addr: &str) -> TierCounts {
    let mut c = TierCounts::default();
    for &i in v.index.by_address(addr) {
        let n = v.at(i as usize);
        if n.status.is_active() {
            c.add(n.tier);
        }
    }
    c
}

/// `GET /address/{addr}`.
pub async fn address(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(addr): P<String>,
) -> ApiResult<Response> {
    let (addr, kind) = transparent_address(check_param("address", &addr)?)?;
    let sum = s.explorer.address(Some(ip), &addr).await?;
    let v = s.views();
    let dto = AddressDto {
        kind,
        balance: Amount::from_sat(sum.balance_sat),
        received: Amount::from_sat(sum.total_received_sat),
        sent: Amount::from_sat(sum.total_sent_sat),
        unconfirmed_balance: Amount::from_sat(sum.unconfirmed_balance_sat),
        tx_count: sum.tx_appearances,
        node_counts: node_counts(&v, &addr),
        address: addr,
    };
    Ok(json_response(&headers, &dto, cache::EXPLORER_RECENT))
}

#[derive(Debug, Deserialize)]
pub struct CursorQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

/// `GET /address/{addr}/txs?cursor&limit` (newest first).
pub async fn address_txs(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(addr): P<String>,
    Q(q): Q<CursorQuery>,
) -> ApiResult<Response> {
    let (addr, _) = transparent_address(check_param("address", &addr)?)?;
    let limit = page_limit(q.limit, 10, 50)?;
    let from = offset_cursor(q.cursor.as_deref())?;
    let v = s.views();
    let tip = v.tip_height().unwrap_or(0);
    let page = s
        .explorer
        .address_txs(Some(ip), &addr, from, from + limit, tip)
        .await?;
    let mut items: Vec<TxDetailDto> = page.items.iter().map(|t| finish_tx(&v, t)).collect();
    attach_app_refs(&s, &mut items).await?;
    let end = from + items.len() as u32;
    let dto = AddressTxsPage {
        next_cursor: (end < page.total && !items.is_empty()).then(|| end.to_string()),
        total: page.total,
        items,
        address: addr,
    };
    let cc = if from == 0 {
        cache::EXPLORER_RECENT
    } else {
        cache::EXPLORER_DEEP
    };
    Ok(json_response(&headers, &dto, cc))
}

/// `GET /address/{addr}/utxos?cursor&limit` (largest first).
pub async fn address_utxos(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    P(addr): P<String>,
    Q(q): Q<CursorQuery>,
) -> ApiResult<Response> {
    let (addr, _) = transparent_address(check_param("address", &addr)?)?;
    let limit = page_limit(q.limit, 100, 500)? as usize;
    let from = offset_cursor(q.cursor.as_deref())? as usize;
    let all = s.explorer.utxos(Some(ip), &addr).await?;
    let items: Vec<_> = all.iter().skip(from).take(limit).cloned().collect();
    let end = from + items.len();
    let dto = AddressUtxosDto {
        total: all.len() as u32,
        total_value: all.iter().map(|u| u.value).sum(),
        next_cursor: (end < all.len()).then(|| end.to_string()),
        items,
        address: addr,
    };
    Ok(json_response(&headers, &dto, cache::EXPLORER_RECENT))
}

/// `GET /address/{addr}/nodes`: nodes paying out to the address (node registry, no upstream).
pub async fn address_nodes(
    State(s): State<AppState>,
    headers: HeaderMap,
    P(addr): P<String>,
) -> ApiResult<Response> {
    let (addr, _) = transparent_address(check_param("address", &addr)?)?;
    let v = s.views();
    let nodes: Vec<NodeRow> = v
        .index
        .by_address(&addr)
        .iter()
        .map(|&i| node_row(v.at(i as usize)))
        .collect();
    let dto = AddressNodesDto {
        address: addr,
        nodes,
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

// ---------------------------------------------------------------------------------------------
// Mempool, supply, rich list
// ---------------------------------------------------------------------------------------------

/// `GET /mempool`. With live ingest, the engine's mempool: socket pushes in real time,
/// reconciled every minute against the gateway (cache-busted), each tx classified with the block
/// classifier once fetched. No upstream call per request. Without ingest (offline mode), the
/// gateway set joined with what this process saw on the live stream.
pub async fn mempool(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
) -> ApiResult<Response> {
    let live = s
        .engine
        .freshness()
        .iter()
        .any(|j| j.job == "mempool_stream" && j.last_ok_ms.is_some());
    if live {
        let published = s.engine.published();
        let txs: Vec<TxLite> = published.mempool.iter().map(|(t, _)| t.clone()).collect();
        let dto = MempoolDto {
            size: txs.len() as u32,
            bytes: txs.iter().filter_map(|t| t.size).map(u64::from).sum(),
            txs,
            updated_ms: published.generated_ms,
        };
        return Ok(json_response(&headers, &dto, "public, max-age=2"));
    }
    let snap = s.explorer.mempool(Some(ip)).await?;
    let txs = snap
        .entries
        .iter()
        .map(|(txid, size, _)| {
            let mut t = match s.hub.mempool_tx(txid) {
                Some((t, _)) => t,
                None => TxLite {
                    txid: *txid,
                    value: Amount::ZERO,
                    kind: TxKind::Unknown,
                    size: None,
                },
            };
            // The upstream set carries the exact size.
            t.size = Some(*size).filter(|s| *s > 0).or(t.size);
            t
        })
        .collect();
    let dto = MempoolDto {
        txs,
        size: snap.entries.len() as u32,
        bytes: snap.bytes,
        updated_ms: snap.fetched_ms,
    };
    Ok(json_response(&headers, &dto, "public, max-age=2"))
}

/// `GET /supply`.
pub async fn supply(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
) -> ApiResult<Response> {
    let v = s.views();
    let supply = match v.published.network.supply.clone() {
        Some(x) => Some(x),
        None => s.explorer.supply(Some(ip)).await.ok().map(|a| (*a).clone()),
    };
    let height = v
        .tip_height()
        .or_else(|| supply.as_ref().map(|x| x.height))
        .ok_or_else(|| ApiError::unavailable("chain tip not known yet").with_retry_after(5))?;
    let reward = emission::pon_subsidy(height.max(PON_ACTIVATION_HEIGHT)).unwrap_or(Amount::ZERO);
    let next = emission::next_reduction_height(height);
    let dto = SupplyDto {
        supply,
        reward,
        emission_per_day: Amount::from_sat(reward.sat() * 2880),
        next_reduction_height: next,
        blocks_to_reduction: next.map(|n| n - height),
        max_supply_reference: MAX_SUPPLY_REFERENCE,
    };
    Ok(json_response(&headers, &dto, cache::SLOW))
}

/// `GET /richlist`.
pub async fn richlist(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
) -> ApiResult<Response> {
    let rows = s.explorer.richlist(Some(ip)).await?;
    let v = s.views();
    let supply = match v.published.network.supply.clone() {
        Some(x) => Some(x),
        None => s.explorer.supply(None).await.ok().map(|a| (*a).clone()),
    };
    let total = supply.map_or(0.0, |x| x.transparent.to_flux_f64());
    let entries = rows
        .rows
        .iter()
        .enumerate()
        .map(|(i, r)| RichListEntry {
            rank: i as u32 + 1,
            address: r.address.clone(),
            balance: Amount::from_flux_f64(r.balance).unwrap_or(Amount::ZERO),
            share_pct: if total > 0.0 {
                r.balance * 100.0 / total
            } else {
                0.0
            },
            node_count: v
                .index
                .by_address(&r.address)
                .iter()
                .filter(|&&i| v.at(i as usize).status.is_active())
                .count() as u32,
        })
        .collect();
    let dto = RichListDto {
        updated_ms: rows.fetched_ms,
        entries,
    };
    Ok(json_response(&headers, &dto, cache::SLOW))
}

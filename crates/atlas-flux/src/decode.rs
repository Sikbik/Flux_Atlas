//! Turns a FluxOS `getblock` (verbosity 2) into domain values: the block summary with coinbase
//! payouts classified by amount, fluxnode start/confirm txs, value transfers, app-message
//! payments (OP_RETURN with the message hash to the app address), and every outpoint the block
//! spends (collateral spends end nodes).
//!
//! Node attribution (producer, paid nodes) needs the node table and is left to the engine:
//! `producer` and `Payout::node` are `None` here.

use atlas_core::chain::{BlockKind, BlockSummary, NodeTx, NodeTxKind, Payout, TxKind};
use atlas_core::emission::{self, split_coinbase};
use atlas_core::{Amount, BlockHash, Collateral, Hash32, NodeEndpoint, Outpoint, Tier, Txid};

use crate::error::{FluxError, Result};
use crate::models::apps::APP_PAYMENT_ADDRESS;
use crate::models::daemon::{DaemonBlock, DaemonTx};
use crate::models::insight::InsightTx;

/// A regular (value-carrying) transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferTx {
    pub txid: Txid,
    pub value_out: Amount,
    /// `(first address, amount)` per output.
    pub outputs: Vec<(Option<String>, Amount)>,
    pub input_count: u32,
    /// Serialized size in bytes (see [`DaemonTx::serialized_size`]).
    pub size: Option<u32>,
}

/// A payment for an app register/update message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPayment {
    pub txid: Txid,
    /// Message hash from the OP_RETURN; fetch it with `permanentmessages?hash=`.
    pub message_hash: Hash32,
    /// Amount paid to the app address.
    pub value: Amount,
}

/// An outpoint spent by a transaction of the block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpentOutpoint {
    pub outpoint: Outpoint,
    pub spent_by: Txid,
}

/// Everything derived from one block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedBlock {
    pub summary: BlockSummary,
    pub node_txs: Vec<NodeTx>,
    pub transfers: Vec<TransferTx>,
    pub app_payments: Vec<AppPayment>,
    pub spent: Vec<SpentOutpoint>,
}

/// Decodes one fluxnode transaction.
pub fn decode_node_tx(tx: &DaemonTx, height: Option<u32>) -> Option<NodeTx> {
    if !tx.is_fluxnode() {
        return None;
    }
    let collateral = match (&tx.txhash, tx.outidx) {
        (Some(h), Some(i)) => Outpoint::new(Hash32::from_hex(h).ok()?, i),
        _ => match Collateral::parse(tx.collateral.as_deref()?).ok()? {
            Collateral::Full(o) => o,
            Collateral::Prefix(_) => return None,
        },
    };
    let kind = if tx.is_start() {
        NodeTxKind::Start
    } else {
        NodeTxKind::from_update_type(tx.update_type.unwrap_or(-1))
    };
    let upgraded = tx
        .fluxnode_upgraded_tx_version
        .and_then(|v| u16::try_from(v).ok());
    Some(NodeTx {
        txid: Hash32::from_hex(&tx.txid).ok()?,
        height,
        kind,
        collateral,
        endpoint: tx
            .ip
            .as_deref()
            .and_then(|ip| NodeEndpoint::parse_opt(ip).ok().flatten()),
        benchmark_tier: tx
            .benchmark_tier
            .as_deref()
            .map(Tier::parse_lenient)
            .filter(|t| *t != Tier::Unknown),
        sig_time: tx.sigtime.unwrap_or(0),
        tx_version: u8::try_from(tx.version).unwrap_or(0),
        upgraded_version: upgraded,
        p2sh: tx.redeemscript.is_some() || upgraded.is_some_and(|v| v & 0x02 != 0),
        node: None,
    })
}

/// Finds an app-message payment in a regular transaction.
pub fn detect_app_payment(tx: &DaemonTx, app_address: &str) -> Option<AppPayment> {
    let value: Amount = tx
        .vout
        .iter()
        .filter(|o| o.first_address() == Some(app_address))
        .map(crate::models::daemon::DaemonVout::amount)
        .sum();
    if value.is_zero() {
        return None;
    }
    let hash = tx.vout.iter().find_map(|o| {
        let text = o.script_pub_key.op_return_text()?;
        Hash32::from_hex(&text).ok()
    })?;
    Some(AppPayment {
        txid: Hash32::from_hex(&tx.txid).ok()?,
        message_hash: hash,
        value,
    })
}

/// What decides a transaction's kind, read from any decoded form (daemon or Insight).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TxTraits {
    pub coinbase: bool,
    /// `Some(Some(true))` start, `Some(Some(false))` confirm, `Some(None)` a fluxnode tx whose
    /// type is unreadable (classifies as `node_tx`), `None` not a fluxnode tx.
    #[allow(clippy::option_option)]
    pub fluxnode: Option<Option<bool>>,
    /// Pays the app address and carries an OP_RETURN message hash.
    pub app_payment: bool,
}

/// The one classifier for block and mempool transactions: coinbase, fluxnode start / confirm,
/// app-message payment (a payment to the app address plus an OP_RETURN carrying the message
/// hash, as in [`detect_app_payment`]), otherwise a transfer.
pub fn kind_of(t: TxTraits) -> TxKind {
    if t.coinbase {
        return TxKind::Coinbase;
    }
    match t.fluxnode {
        Some(Some(true)) => TxKind::NodeStart,
        Some(Some(false)) => TxKind::NodeConfirm,
        Some(None) => TxKind::NodeTx,
        None if t.app_payment => TxKind::AppMessage,
        None => TxKind::Transfer,
    }
}

/// Classifies a daemon transaction (`getblock` verbosity 2, `getrawtransaction`).
pub fn classify_tx(tx: &DaemonTx, app_address: &str) -> TxKind {
    let fluxnode = tx.is_fluxnode().then(|| {
        if tx.is_start() {
            Some(true)
        } else if tx.is_confirm() {
            Some(false)
        } else {
            None
        }
    });
    kind_of(TxTraits {
        coinbase: tx.is_coinbase(),
        fluxnode,
        app_payment: fluxnode.is_none() && detect_app_payment(tx, app_address).is_some(),
    })
}

/// Classifies an Insight transaction (`/api/tx/<txid>`) with the same rules as [`classify_tx`].
pub fn classify_insight_tx(tx: &InsightTx, app_address: &str) -> TxKind {
    let fluxnode = tx
        .is_fluxnode()
        .then(|| match (tx.n_type, tx.kind.as_deref()) {
            (Some(2), _) => Some(true),
            (Some(4), _) => Some(false),
            (_, Some(k)) if k.starts_with("Start") => Some(true),
            (_, Some(k)) if k.starts_with("Confirm") => Some(false),
            _ => None,
        });
    let pays_app = tx.vout.iter().any(|o| {
        o.script_pub_key.addresses.iter().any(|a| a == app_address) && !o.amount().is_zero()
    });
    let carries_hash = tx.vout.iter().any(|o| {
        o.script_pub_key
            .asm
            .strip_prefix("OP_RETURN")
            .and_then(|h| hex::decode(h.trim()).ok())
            .and_then(|b| String::from_utf8(b).ok())
            .is_some_and(|t| Hash32::from_hex(&t).is_ok())
    });
    kind_of(TxTraits {
        coinbase: tx.is_coinbase == Some(true)
            || tx.vin.first().is_some_and(|v| v.coinbase.is_some()),
        fluxnode,
        app_payment: fluxnode.is_none() && pays_app && carries_hash,
    })
}

/// Decodes a verbosity-2 block.
pub fn decode_block(block: &DaemonBlock) -> Result<DecodedBlock> {
    decode_block_with(block, APP_PAYMENT_ADDRESS)
}

/// [`decode_block`] with an explicit app payment address.
pub fn decode_block_with(block: &DaemonBlock, app_address: &str) -> Result<DecodedBlock> {
    let bad = |m: String| FluxError::Parse {
        what: "getblock",
        message: m,
    };
    let hash: BlockHash = Hash32::from_hex(&block.hash).map_err(|e| bad(format!("hash: {e}")))?;
    let prev_hash = block
        .previousblockhash
        .as_deref()
        .map(Hash32::from_hex)
        .transpose()
        .map_err(|e| bad(format!("previousblockhash: {e}")))?
        .unwrap_or(Hash32::ZERO);
    let txs = block.full_txs();
    if txs.is_empty() && block.tx_count() > 0 {
        return Err(bad(
            "block has txids only; fetch with verbosity 2".to_owned()
        ));
    }
    let height = block.height;
    let kind = match block.kind.as_deref() {
        Some(k) => BlockKind::parse_lenient(k),
        None if block.version >= 100 || emission::is_pon(height) => BlockKind::Pon,
        None => BlockKind::Pow,
    };

    let mut payouts: Vec<Payout> = Vec::new();
    let mut dev_fund = Amount::ZERO;
    let mut fees = Amount::ZERO;
    let mut coinbase_total = Amount::ZERO;
    let mut node_txs = Vec::new();
    let mut transfers = Vec::new();
    let mut app_payments = Vec::new();
    let mut spent = Vec::new();
    let (mut confirms, mut starts) = (0u16, 0u16);
    let mut value_out = Amount::ZERO;

    for tx in txs {
        if tx.is_coinbase() {
            let outs = tx.vout.iter().map(|o| (o.n, o.first_address(), o.amount()));
            let split = split_coinbase(height, outs);
            coinbase_total = split.total;
            dev_fund = split.dev_fund;
            fees = split.fees;
            for (_, tier, address, amount) in split.node_payouts {
                payouts.push(Payout {
                    tier,
                    address: address.into(),
                    amount,
                    node: None,
                });
            }
            continue;
        }
        if let Some(ntx) = decode_node_tx(tx, Some(height)) {
            if ntx.kind == NodeTxKind::Start {
                starts += 1;
            } else {
                confirms += 1;
            }
            node_txs.push(ntx);
            continue;
        }
        let Ok(txid) = Hash32::from_hex(&tx.txid) else {
            continue;
        };
        for vin in &tx.vin {
            if let (Some(prev), Some(n)) = (vin.txid.as_deref(), vin.vout)
                && let Ok(prev) = Hash32::from_hex(prev)
            {
                spent.push(SpentOutpoint {
                    outpoint: Outpoint::new(prev, n),
                    spent_by: txid,
                });
            }
        }
        if let Some(p) = detect_app_payment(tx, app_address) {
            app_payments.push(p);
        }
        let outputs: Vec<(Option<String>, Amount)> = tx
            .vout
            .iter()
            .map(|o| (o.first_address().map(str::to_owned), o.amount()))
            .collect();
        let tx_value: Amount = outputs.iter().map(|(_, a)| *a).sum();
        value_out += tx_value;
        transfers.push(TransferTx {
            txid,
            value_out: tx_value,
            outputs,
            input_count: u32::try_from(tx.vin.len()).unwrap_or(u32::MAX),
            size: tx.serialized_size(),
        });
    }

    let reward = emission::pon_subsidy(height).unwrap_or(coinbase_total);
    let producer_collateral = block
        .collateral
        .as_deref()
        .and_then(|c| Collateral::parse(c).ok());
    let summary = BlockSummary {
        height,
        hash,
        prev_hash,
        time_ms: block.time.saturating_mul(1000),
        size: block.size,
        tx_count: u32::try_from(block.tx_count()).unwrap_or(u32::MAX),
        kind,
        version: block.version,
        producer_collateral,
        producer: None,
        payouts: payouts.into_iter().collect(),
        dev_fund,
        fees,
        reward,
        value_out,
        confirm_count: confirms,
        start_count: starts,
        transfer_count: u16::try_from(transfers.len()).unwrap_or(u16::MAX),
    };
    Ok(DecodedBlock {
        summary,
        node_txs,
        transfers,
        app_payments,
        spent,
    })
}

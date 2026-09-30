//! Pure parser for Engine.IO 3 / socket.io v2 text frames as sent by the Insight explorer.
//!
//! Wire format recap (text frames only, the explorer never sends binary):
//!
//! ```text
//! <eio type>[<payload>]
//!   0 open     0{"sid":"..","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
//!   1 close
//!   2 ping     (client -> server in EIO 3)
//!   3 pong
//!   4 message  4<sio type>[<attachments>-][/<nsp>,][<ack id>][<json>]
//!                40 connect, 41 disconnect, 42 event, 43 ack, 44 error, 45/46 binary
//!   5 upgrade
//!   6 noop
//! ```
//!
//! Events of interest arrive as `42["<event>",<payload>]`.

use std::fmt;

use atlas_core::{Amount, COIN, Hash32};
use serde_json::Value;

/// Engine.IO open handshake (`0{...}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenInfo {
    /// Engine.IO session id.
    pub sid: String,
    /// Interval at which the client must ping, in milliseconds.
    pub ping_interval_ms: u64,
    /// How long the client waits for a pong before declaring the connection dead, in ms.
    pub ping_timeout_ms: u64,
}

/// One decoded text frame.
#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    /// Engine.IO open (`0{...}`).
    Open(OpenInfo),
    /// Engine.IO close (`1`).
    Close,
    /// Engine.IO ping (`2`, optionally with a probe payload).
    Ping,
    /// Engine.IO pong (`3`, optionally with a probe payload).
    Pong,
    /// Engine.IO upgrade (`5`).
    Upgrade,
    /// Engine.IO noop (`6`).
    Noop,
    /// socket.io connect to a namespace (`40`, `40/nsp,`).
    Connect,
    /// socket.io disconnect from a namespace (`41`).
    Disconnect,
    /// socket.io error (`44...`); carries the raw error payload text.
    Error(String),
    /// socket.io event (`42[...]`).
    Event(ChainPush),
    /// A protocol-valid packet this client does not act on (acks, binary events).
    Ignored(String),
}

/// Reasons a frame could not be decoded. None of these should end a connection; the client
/// logs them and keeps reading.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FrameError {
    /// The frame was empty.
    #[error("empty frame")]
    Empty,
    /// The leading Engine.IO or socket.io type digit is unknown.
    #[error("unknown packet type in frame {0:?}")]
    UnknownType(String),
    /// The JSON part did not parse, or had the wrong outer shape.
    #[error("malformed json in frame: {0}")]
    BadJson(String),
    /// A known event carried a payload that could not be interpreted.
    #[error("bad payload for event {event:?}: {reason}")]
    BadPayload {
        /// Event name.
        event: String,
        /// What was wrong.
        reason: String,
    },
}

/// A typed push from the explorer's `inv` room.
#[derive(Debug, Clone, PartialEq)]
pub enum ChainPush {
    /// A block was connected. The payload is the hash only.
    Block {
        /// Block hash.
        hash: Hash32,
    },
    /// A transaction entered the explorer node's mempool (or a coinbase at block connect).
    Tx(SocketTx),
    /// Node status, sent about once per block.
    Info(SocketInfo),
    /// Market data, sent occasionally.
    MarketsInfo(MarketsInfo),
    /// Any other event name. The payload is kept verbatim.
    Unknown {
        /// Event name.
        event: String,
        /// First argument after the event name, or `Null` if there was none.
        payload: Value,
    },
}

impl ChainPush {
    /// Short lowercase name of the push kind, e.g. `"block"` or `"tx"`.
    pub fn kind(&self) -> &str {
        match self {
            Self::Block { .. } => "block",
            Self::Tx(_) => "tx",
            Self::Info(_) => "info",
            Self::MarketsInfo(_) => "markets_info",
            Self::Unknown { event, .. } => event,
        }
    }
}

/// A `tx` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketTx {
    /// Transaction id.
    pub txid: Hash32,
    /// Sum of the outputs (sent by the server as a FLUX number).
    pub value_out: Amount,
    /// Outputs as `(address, amount)` in wire order.
    pub outputs: Vec<(String, Amount)>,
    /// Replace-by-fee flag.
    pub is_rbf: bool,
}

impl SocketTx {
    /// Fluxnode start/confirm transactions have no outputs and zero value.
    pub fn is_node_tx(&self) -> bool {
        self.outputs.is_empty() && self.value_out.is_zero()
    }

    /// Heuristic for a coinbase emitted at block connect: several outputs whose sum equals
    /// `value_out`, a whole number of FLUX, and at least the 3 tier payouts. Treat as a hint
    /// only; the block fetch is authoritative.
    pub fn is_coinbase_like(&self) -> bool {
        if self.outputs.len() < 3 || self.value_out.sat() % COIN != 0 || self.value_out.is_zero() {
            return false;
        }
        let sum = self
            .outputs
            .iter()
            .try_fold(Amount::ZERO, |acc, (_, a)| acc.checked_add(*a));
        sum == Some(self.value_out)
    }
}

/// An `info` event (the explorer node's getInfo plus mining info and supply).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SocketInfo {
    /// Chain height (`info.blocks`).
    pub height: Option<u32>,
    /// Total coin supply (`supply`, a decimal string on the wire).
    pub supply: Option<Amount>,
    /// Peer connections of the explorer's daemon.
    pub connections: Option<u32>,
    /// Daemon version number, e.g. 9010050.
    pub version: Option<u32>,
    /// P2P protocol version, e.g. 170021.
    pub protocol_version: Option<u32>,
    /// `info.difficulty`.
    pub difficulty: Option<f64>,
    /// `miningInfo.difficulty`.
    pub mining_difficulty: Option<f64>,
    /// `miningInfo.networkhashps`.
    pub network_hashps: Option<f64>,
    /// `info.relayfee`, in FLUX per kB.
    pub relay_fee: Option<Amount>,
    /// `info.network`, e.g. `"livenet"`.
    pub network: Option<String>,
}

/// A `markets_info` event.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MarketsInfo {
    /// `price`, USD per FLUX.
    pub price_usd: Option<f64>,
    /// `price_btc`, BTC per FLUX.
    pub price_btc: Option<f64>,
    /// `market_cap_usd`.
    pub market_cap_usd: Option<f64>,
    /// `total_volume_24h`, USD.
    pub volume_24h_usd: Option<f64>,
    /// `delta_24h`, percent.
    pub change_24h_pct: Option<f64>,
}

impl MarketsInfo {
    /// A stable fingerprint of the numeric content, used to deduplicate the same update
    /// delivered by several sockets.
    pub fn fingerprint(&self) -> u64 {
        // FNV-1a over the bit patterns; cheap and deterministic.
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for v in [
            self.price_usd,
            self.price_btc,
            self.market_cap_usd,
            self.volume_24h_usd,
            self.change_24h_pct,
        ] {
            let bits = v.map_or(u64::MAX, f64::to_bits);
            for b in bits.to_le_bytes() {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        h
    }
}

impl fmt::Display for ChainPush {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Block { hash } => write!(f, "block {hash}"),
            Self::Tx(tx) => write!(
                f,
                "tx {} value_out={} outputs={}{}",
                tx.txid,
                tx.value_out,
                tx.outputs.len(),
                if tx.is_node_tx() { " node_tx" } else { "" }
            ),
            Self::Info(i) => write!(
                f,
                "info height={} supply={} connections={}",
                opt(i.height),
                opt(i.supply),
                opt(i.connections)
            ),
            Self::MarketsInfo(m) => write!(
                f,
                "markets_info price_usd={} change_24h_pct={}",
                opt(m.price_usd),
                opt(m.change_24h_pct)
            ),
            Self::Unknown { event, .. } => write!(f, "unknown event {event:?}"),
        }
    }
}

fn opt<T: fmt::Display>(v: Option<T>) -> String {
    v.map_or_else(|| "-".to_owned(), |v| v.to_string())
}

/// Decodes one text frame.
pub fn parse_frame(text: &str) -> Result<Frame, FrameError> {
    let mut chars = text.chars();
    let Some(eio) = chars.next() else {
        return Err(FrameError::Empty);
    };
    let rest = chars.as_str();
    match eio {
        '0' => parse_open(rest).map(Frame::Open),
        '1' => Ok(Frame::Close),
        '2' => Ok(Frame::Ping),
        '3' => Ok(Frame::Pong),
        '4' => parse_socketio(rest, text),
        '5' => Ok(Frame::Upgrade),
        '6' => Ok(Frame::Noop),
        _ => Err(FrameError::UnknownType(truncate(text))),
    }
}

fn truncate(s: &str) -> String {
    const MAX: usize = 64;
    if s.len() <= MAX {
        return s.to_owned();
    }
    let mut end = MAX;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

fn parse_open(json: &str) -> Result<OpenInfo, FrameError> {
    let v: Value = serde_json::from_str(json).map_err(|e| FrameError::BadJson(e.to_string()))?;
    let Value::Object(map) = v else {
        return Err(FrameError::BadJson(
            "open payload is not an object".to_owned(),
        ));
    };
    Ok(OpenInfo {
        sid: map
            .get("sid")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        ping_interval_ms: map.get("pingInterval").and_then(as_u64).unwrap_or(25_000),
        ping_timeout_ms: map.get("pingTimeout").and_then(as_u64).unwrap_or(20_000),
    })
}

fn parse_socketio(rest: &str, whole: &str) -> Result<Frame, FrameError> {
    let mut chars = rest.chars();
    let Some(sio) = chars.next() else {
        return Err(FrameError::UnknownType(truncate(whole)));
    };
    let body = chars.as_str();
    match sio {
        '0' => Ok(Frame::Connect),
        '1' => Ok(Frame::Disconnect),
        '2' => parse_event(strip_nsp_and_ack(body)),
        '3' | '5' | '6' => Ok(Frame::Ignored(truncate(whole))),
        '4' => Ok(Frame::Error(strip_nsp_and_ack(body).to_owned())),
        _ => Err(FrameError::UnknownType(truncate(whole))),
    }
}

/// Strips an optional `/namespace,` prefix and an optional numeric ack id.
fn strip_nsp_and_ack(body: &str) -> &str {
    let mut b = body;
    if b.starts_with('/') {
        b = match b.find(',') {
            Some(i) => &b[i + 1..],
            // Namespace with no payload at all, e.g. `42/admin`.
            None => "",
        };
    }
    b.trim_start_matches(|c: char| c.is_ascii_digit())
}

fn parse_event(json: &str) -> Result<Frame, FrameError> {
    let v: Value = serde_json::from_str(json).map_err(|e| FrameError::BadJson(e.to_string()))?;
    let Value::Array(mut items) = v else {
        return Err(FrameError::BadJson(
            "event payload is not an array".to_owned(),
        ));
    };
    if items.is_empty() {
        return Err(FrameError::BadJson("event array is empty".to_owned()));
    }
    let payload = if items.len() > 1 {
        items.swap_remove(1)
    } else {
        Value::Null
    };
    let Value::String(event) = items.swap_remove(0) else {
        return Err(FrameError::BadJson("event name is not a string".to_owned()));
    };
    let bad = |reason: &str| FrameError::BadPayload {
        event: event.clone(),
        reason: reason.to_owned(),
    };
    let push = match event.as_str() {
        "block" => {
            let hash = payload
                .as_str()
                .and_then(|s| Hash32::from_hex(s).ok())
                .ok_or_else(|| bad("expected a 64-hex block hash string"))?;
            ChainPush::Block { hash }
        }
        "tx" => ChainPush::Tx(parse_tx(&payload).map_err(&bad)?),
        "info" => ChainPush::Info(parse_info(&payload).map_err(&bad)?),
        "markets_info" => ChainPush::MarketsInfo(parse_markets(&payload).map_err(&bad)?),
        _ => ChainPush::Unknown { event, payload },
    };
    Ok(Frame::Event(push))
}

fn parse_tx(v: &Value) -> Result<SocketTx, &'static str> {
    let obj = v.as_object().ok_or("tx payload is not an object")?;
    let txid = obj
        .get("txid")
        .and_then(Value::as_str)
        .and_then(|s| Hash32::from_hex(s).ok())
        .ok_or("missing or invalid txid")?;
    let value_out = match obj.get("valueOut") {
        None | Some(Value::Null) => Amount::ZERO,
        Some(v) => flux_amount(v).ok_or("invalid valueOut")?,
    };
    let mut outputs = Vec::new();
    if let Some(vout) = obj.get("vout") {
        let arr = match vout {
            Value::Array(a) => a.as_slice(),
            Value::Null => &[],
            _ => return Err("vout is not an array"),
        };
        for entry in arr {
            let map = entry.as_object().ok_or("vout entry is not an object")?;
            for (addr, sat) in map {
                let amount = sat_amount(sat).ok_or("invalid output satoshis")?;
                outputs.push((addr.clone(), amount));
            }
        }
    }
    let is_rbf = obj.get("isRBF").is_some_and(as_bool);
    Ok(SocketTx {
        txid,
        value_out,
        outputs,
        is_rbf,
    })
}

fn parse_info(v: &Value) -> Result<SocketInfo, &'static str> {
    let obj = v.as_object().ok_or("info payload is not an object")?;
    let info = obj.get("info").and_then(Value::as_object);
    let mining = obj.get("miningInfo").and_then(Value::as_object);
    let i = |k: &str| info.and_then(|m| m.get(k));
    let u32_of = |k: &str| i(k).and_then(as_u64).and_then(|n| u32::try_from(n).ok());
    Ok(SocketInfo {
        height: u32_of("blocks"),
        supply: obj.get("supply").and_then(flux_amount),
        connections: u32_of("connections"),
        version: u32_of("version"),
        protocol_version: u32_of("protocolversion"),
        difficulty: i("difficulty").and_then(as_f64),
        mining_difficulty: mining.and_then(|m| m.get("difficulty")).and_then(as_f64),
        network_hashps: mining.and_then(|m| m.get("networkhashps")).and_then(as_f64),
        relay_fee: i("relayfee").and_then(flux_amount),
        network: i("network").and_then(Value::as_str).map(str::to_owned),
    })
}

fn parse_markets(v: &Value) -> Result<MarketsInfo, &'static str> {
    let obj = v
        .as_object()
        .ok_or("markets_info payload is not an object")?;
    let f = |k: &str| obj.get(k).and_then(as_f64);
    Ok(MarketsInfo {
        price_usd: f("price"),
        price_btc: f("price_btc"),
        market_cap_usd: f("market_cap_usd"),
        volume_24h_usd: f("total_volume_24h"),
        change_24h_pct: f("delta_24h"),
    })
}

/// A number or numeric string as `f64`.
fn as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|f| f.is_finite())
}

/// A non-negative integer, an integral float, or an integer string as `u64`.
fn as_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64().or_else(|| {
            n.as_f64()
                .filter(|f| f.is_finite() && *f >= 0.0 && f.fract() == 0.0 && *f < 1.8e19)
                .map(|f| f as u64)
        }),
        Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn as_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().is_some_and(|n| n != 0),
        Value::String(s) => matches!(s.trim(), "true" | "1"),
        _ => false,
    }
}

/// A FLUX-denominated number or decimal string.
fn flux_amount(v: &Value) -> Option<Amount> {
    match v {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.checked_mul(COIN).map(Amount::from_sat)
            } else {
                n.as_f64().and_then(Amount::from_flux_f64)
            }
        }
        Value::String(s) => s
            .parse::<Amount>()
            .ok()
            .or_else(|| s.trim().parse::<f64>().ok().and_then(Amount::from_flux_f64)),
        _ => None,
    }
}

/// A satoshi-denominated integer (or integer string, or integral float).
fn sat_amount(v: &Value) -> Option<Amount> {
    match v {
        Value::Number(n) => n.as_i64().map(Amount::from_sat).or_else(|| {
            n.as_f64()
                .filter(|f| f.is_finite() && f.abs() < 9.0e18)
                .map(|f| Amount::from_sat(f.round() as i64))
        }),
        Value::String(s) => s.trim().parse::<i64>().ok().map(Amount::from_sat),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// Repository root. The real crate finds it from its manifest dir; an out-of-tree build
    /// harness can point `FLUX_ATLAS_ROOT` at it instead.
    fn repo_root() -> std::path::PathBuf {
        option_env!("FLUX_ATLAS_ROOT").map_or_else(
            || std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
            std::path::PathBuf::from,
        )
    }

    fn fixture_text() -> String {
        let p =
            repo_root().join("docs/research/fixtures/explorer/insight_socketio_inv_capture.json");
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
    }

    /// Optional raw research captures (not committed). Set `ATLAS_SOCKET_RAW_DIR` to the
    /// directory holding `ins_socketio_inv_capture.jsonl` and `rt_events.jsonl`.
    fn raw_capture(name: &str) -> Option<String> {
        let dir = std::env::var("ATLAS_SOCKET_RAW_DIR")
            .ok()
            .or_else(|| option_env!("ATLAS_SOCKET_RAW_DIR").map(str::to_owned))?;
        std::fs::read_to_string(std::path::Path::new(&dir).join(name)).ok()
    }

    #[derive(Default, Debug, PartialEq, Eq)]
    struct Counts {
        open: usize,
        connect: usize,
        pong: usize,
        block: usize,
        tx: usize,
        node_tx: usize,
        coinbase_like: usize,
        info: usize,
        markets: usize,
        other: usize,
    }

    fn count(frames: impl Iterator<Item = String>) -> Counts {
        let mut c = Counts::default();
        for f in frames {
            match parse_frame(&f).unwrap_or_else(|e| panic!("frame {f:?}: {e}")) {
                Frame::Open(o) => {
                    assert_eq!(o.ping_interval_ms, 25_000);
                    assert_eq!(o.ping_timeout_ms, 20_000);
                    assert!(!o.sid.is_empty());
                    c.open += 1;
                }
                Frame::Connect => c.connect += 1,
                Frame::Pong => c.pong += 1,
                Frame::Event(ChainPush::Block { .. }) => c.block += 1,
                Frame::Event(ChainPush::Tx(tx)) => {
                    c.tx += 1;
                    if tx.is_node_tx() {
                        c.node_tx += 1;
                    }
                    if tx.is_coinbase_like() {
                        assert_eq!(tx.value_out, Amount::from_flux(14));
                        assert_eq!(tx.outputs.len(), 4);
                        c.coinbase_like += 1;
                    }
                }
                Frame::Event(ChainPush::Info(i)) => {
                    assert!(i.height.unwrap() > 2_996_000);
                    assert!(i.supply.unwrap() > Amount::from_flux(430_000_000));
                    assert_eq!(i.network.as_deref(), Some("livenet"));
                    assert_eq!(i.version, Some(9_010_050));
                    assert_eq!(i.protocol_version, Some(170_021));
                    assert!(i.network_hashps.unwrap() > 0.0);
                    c.info += 1;
                }
                Frame::Event(ChainPush::MarketsInfo(m)) => {
                    assert!(m.price_usd.unwrap() > 0.0);
                    c.markets += 1;
                }
                _ => c.other += 1,
            }
        }
        c
    }

    fn fixture_frames(text: &str) -> Vec<String> {
        let v: Value = serde_json::from_str(text).unwrap();
        v["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["frame"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn fixture_capture_counts() {
        let text = fixture_text();
        let frames = fixture_frames(&text);
        assert_eq!(frames.len(), 50);
        let c = count(frames.into_iter());
        assert_eq!(c.open, 1);
        assert_eq!(c.connect, 1);
        assert_eq!(c.pong, 3);
        assert_eq!(c.block, 3);
        assert_eq!(c.tx, 38);
        assert_eq!(c.info, 3);
        assert_eq!(c.markets, 1);
        assert_eq!(c.other, 0);
        // One coinbase per connected block.
        assert_eq!(c.coinbase_like, 3);
        assert!(c.node_tx > 20, "most mempool txs are fluxnode txs: {c:?}");
    }

    #[test]
    fn raw_jsonl_capture_counts() {
        let Some(text) = raw_capture("ins_socketio_inv_capture.jsonl") else {
            eprintln!("raw capture not present, skipping");
            return;
        };
        let frames = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| {
                let v: Value = serde_json::from_str(l).unwrap();
                v["frame"].as_str().unwrap().to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(frames.len(), 50);
        let c = count(frames.into_iter());
        assert_eq!((c.tx, c.block, c.info, c.markets, c.pong), (38, 3, 3, 1, 3));
        assert_eq!((c.open, c.connect, c.other), (1, 1, 0));
    }

    /// The 420 s realtime capture stores summaries, not raw frames. Rebuild `block` frames
    /// from the recorded hashes and `tx` frames from txid/valueOut to exercise the parser
    /// on 13 real block hashes and 163 real txids.
    #[test]
    fn rt_events_capture_rebuilt_frames() {
        let Some(text) = raw_capture("rt_events.jsonl") else {
            eprintln!("rt_events capture not present, skipping");
            return;
        };
        let (mut blocks, mut txs, mut node_txs) = (0, 0, 0);
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let v: Value = serde_json::from_str(line).unwrap();
            if v["src"] != "insight" {
                continue;
            }
            let frame = match v["ev"].as_str().unwrap_or_default() {
                "block" => format!(r#"42["block","{}"]"#, v["hash"].as_str().unwrap()),
                "tx" => format!(
                    r#"42["tx",{{"txid":"{}","valueOut":{},"vout":[],"isRBF":false}}]"#,
                    v["txid"].as_str().unwrap(),
                    v["valueOut"]
                ),
                _ => continue,
            };
            match parse_frame(&frame).unwrap() {
                Frame::Event(ChainPush::Block { hash }) => {
                    assert_eq!(hash.to_hex(), v["hash"].as_str().unwrap());
                    blocks += 1;
                }
                Frame::Event(ChainPush::Tx(tx)) => {
                    assert_eq!(tx.txid.to_hex(), v["txid"].as_str().unwrap());
                    if v["nvout"] == 0 && tx.value_out.is_zero() {
                        node_txs += 1;
                    }
                    txs += 1;
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(blocks, 13);
        assert_eq!(txs, 163);
        // The research doc: only 15 of 163 had outputs.
        assert_eq!(node_txs, 148);
    }

    #[test]
    fn engine_io_control_frames() {
        assert_eq!(parse_frame("1").unwrap(), Frame::Close);
        assert_eq!(parse_frame("2").unwrap(), Frame::Ping);
        assert_eq!(parse_frame("3").unwrap(), Frame::Pong);
        assert_eq!(parse_frame("3probe").unwrap(), Frame::Pong);
        assert_eq!(parse_frame("5").unwrap(), Frame::Upgrade);
        assert_eq!(parse_frame("6").unwrap(), Frame::Noop);
        assert_eq!(parse_frame("40").unwrap(), Frame::Connect);
        assert_eq!(parse_frame("40/admin,").unwrap(), Frame::Connect);
        assert_eq!(parse_frame("41").unwrap(), Frame::Disconnect);
        assert_eq!(
            parse_frame(r#"44"Invalid namespace""#).unwrap(),
            Frame::Error(r#""Invalid namespace""#.to_owned())
        );
        assert!(matches!(
            parse_frame(r#"431["ok"]"#).unwrap(),
            Frame::Ignored(_)
        ));
        assert_eq!(parse_frame(""), Err(FrameError::Empty));
        assert!(matches!(parse_frame("9"), Err(FrameError::UnknownType(_))));
        assert!(matches!(parse_frame("4"), Err(FrameError::UnknownType(_))));
        assert!(matches!(parse_frame("47"), Err(FrameError::UnknownType(_))));
    }

    #[test]
    fn open_frame_defaults_and_values() {
        let Frame::Open(o) =
            parse_frame(r#"0{"sid":"abc","pingInterval":"1000","pingTimeout":500.0}"#).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            (o.sid.as_str(), o.ping_interval_ms, o.ping_timeout_ms),
            ("abc", 1000, 500)
        );
        let Frame::Open(o) = parse_frame(r#"0{"sid":"x"}"#).unwrap() else {
            panic!()
        };
        assert_eq!((o.ping_interval_ms, o.ping_timeout_ms), (25_000, 20_000));
        assert!(matches!(parse_frame("0{nope"), Err(FrameError::BadJson(_))));
        assert!(matches!(parse_frame("0[]"), Err(FrameError::BadJson(_))));
    }

    #[test]
    fn malformed_events() {
        assert!(matches!(parse_frame("42{"), Err(FrameError::BadJson(_))));
        assert!(matches!(parse_frame("42"), Err(FrameError::BadJson(_))));
        assert!(matches!(parse_frame("42[]"), Err(FrameError::BadJson(_))));
        assert!(matches!(
            parse_frame("42[1,2]"),
            Err(FrameError::BadJson(_))
        ));
        assert!(matches!(
            parse_frame(r#"42{"a":1}"#),
            Err(FrameError::BadJson(_))
        ));
        assert!(matches!(
            parse_frame(r#"42["block","nothex"]"#),
            Err(FrameError::BadPayload { .. })
        ));
        assert!(matches!(
            parse_frame(r#"42["block",123]"#),
            Err(FrameError::BadPayload { .. })
        ));
        assert!(matches!(
            parse_frame(r#"42["tx",{"valueOut":1}]"#),
            Err(FrameError::BadPayload { .. })
        ));
        assert!(matches!(
            parse_frame(r#"42["tx","x"]"#),
            Err(FrameError::BadPayload { .. })
        ));
        assert!(matches!(
            parse_frame(r#"42["info",[]]"#),
            Err(FrameError::BadPayload { .. })
        ));
    }

    #[test]
    fn unknown_events_keep_their_name() {
        let f = parse_frame(r#"42["bitcoind/addresstxid",{"address":"t1x","txid":"ab"}]"#).unwrap();
        let Frame::Event(ChainPush::Unknown { event, payload }) = f else {
            panic!("{f:?}")
        };
        assert_eq!(event, "bitcoind/addresstxid");
        assert_eq!(payload["address"], "t1x");
        let Frame::Event(p) = parse_frame(r#"42["hello"]"#).unwrap() else {
            panic!()
        };
        assert_eq!(
            p,
            ChainPush::Unknown {
                event: "hello".to_owned(),
                payload: Value::Null
            }
        );
        assert_eq!(p.kind(), "hello");
    }

    #[test]
    fn namespace_and_ack_id_prefixes() {
        let h = "d8fb2d7487bd778a30190c34a3ca315d93f396240f3406680aed87e74a87bf49";
        for frame in [
            format!(r#"42["block","{h}"]"#),
            format!(r#"4217["block","{h}"]"#),
            format!(r#"42/,["block","{h}"]"#),
            format!(r#"42/insight,5["block","{h}"]"#),
        ] {
            let got = parse_frame(&frame).unwrap();
            assert_eq!(
                got,
                Frame::Event(ChainPush::Block {
                    hash: Hash32::from_hex(h).unwrap()
                }),
                "{frame}"
            );
        }
        assert!(matches!(
            parse_frame("42/insight"),
            Err(FrameError::BadJson(_))
        ));
    }

    #[test]
    fn tolerant_tx_parsing() {
        let txid = "7f3a830ca7142faf2beae2307ae64822ea2fdf1a9dc7362931b4f7ecec9b2be7";
        let f = format!(
            r#"42["tx",{{"txid":"{txid}","valueOut":"1.5","vout":[{{"t1a":"100000000"}},{{"t1b":50000000.0,"t1c":0}}],"isRBF":"true","extra":{{"x":1}}}}]"#
        );
        let Frame::Event(ChainPush::Tx(tx)) = parse_frame(&f).unwrap() else {
            panic!()
        };
        assert_eq!(tx.value_out, Amount::from_sat(150_000_000));
        assert_eq!(
            tx.outputs,
            vec![
                ("t1a".to_owned(), Amount::from_sat(100_000_000)),
                ("t1b".to_owned(), Amount::from_sat(50_000_000)),
                ("t1c".to_owned(), Amount::ZERO),
            ]
        );
        assert!(tx.is_rbf);
        assert!(!tx.is_node_tx());
        assert!(!tx.is_coinbase_like());

        // Missing optional fields.
        let f = format!(r#"42["tx",{{"txid":"{txid}"}}]"#);
        let Frame::Event(ChainPush::Tx(tx)) = parse_frame(&f).unwrap() else {
            panic!()
        };
        assert!(tx.is_node_tx());
        assert!(!tx.is_rbf);
        assert!(!tx.is_coinbase_like());

        // Fractional FLUX values round to the nearest satoshi.
        let f = format!(r#"42["tx",{{"txid":"{txid}","valueOut":0.30000001,"vout":[]}}]"#);
        let Frame::Event(ChainPush::Tx(tx)) = parse_frame(&f).unwrap() else {
            panic!()
        };
        assert_eq!(tx.value_out, Amount::from_sat(30_000_001));
    }

    #[test]
    fn tolerant_info_and_markets_parsing() {
        let f = r#"42["info",{"info":{"blocks":"2996929","connections":8.0,"relayfee":0.000001},"supply":430655732.5}]"#;
        let Frame::Event(ChainPush::Info(i)) = parse_frame(f).unwrap() else {
            panic!()
        };
        assert_eq!(i.height, Some(2_996_929));
        assert_eq!(i.connections, Some(8));
        assert_eq!(i.supply, "430655732.5".parse::<Amount>().ok());
        assert_eq!(i.relay_fee, Some(Amount::from_sat(100)));
        assert_eq!(i.version, None);
        assert_eq!(i.mining_difficulty, None);

        let Frame::Event(ChainPush::Info(i)) = parse_frame(r#"42["info",{}]"#).unwrap() else {
            panic!()
        };
        assert_eq!(i, SocketInfo::default());

        let f = r#"42["markets_info",{"price":"0.0749","delta_24h":-2.5,"unknown":true}]"#;
        let Frame::Event(ChainPush::MarketsInfo(m)) = parse_frame(f).unwrap() else {
            panic!()
        };
        assert_eq!(m.price_usd, Some(0.0749));
        assert_eq!(m.change_24h_pct, Some(-2.5));
        assert_eq!(m.market_cap_usd, None);
        let same = MarketsInfo {
            price_usd: Some(0.0749),
            change_24h_pct: Some(-2.5),
            ..MarketsInfo::default()
        };
        assert_eq!(m.fingerprint(), same.fingerprint());
        assert_ne!(m.fingerprint(), MarketsInfo::default().fingerprint());
    }

    #[test]
    fn display_is_one_line() {
        let text = fixture_text();
        for f in fixture_frames(&text) {
            if let Frame::Event(p) = parse_frame(&f).unwrap() {
                let s = p.to_string();
                assert!(!s.contains('\n'));
                assert!(s.starts_with(p.kind()));
            }
        }
    }
}

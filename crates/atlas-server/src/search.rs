//! `GET /search?q=` (explorer research section 4.2): cheapest first, local before remote.
//!
//! 1. collateral outpoint (`txid:n`, `COutPoint(txid, n)`, other separators) -> node
//! 2. digits (with `#` and separators stripped) -> block height
//! 3. 64-hex -> local block / collateral lookups; only if unknown locally, parallel upstream
//!    probes (Insight tx, FluxOS block header)
//! 4. `t1` / `t3` -> address (local base58check), plus operator view when it runs nodes
//! 5. `zs1` / `zc` -> shielded notice
//! 6. IP(:port) or IP prefix -> nodes and host
//! 7. text -> ZelID operators, versions, countries, providers, apps (exact, prefix, fuzzy)

use std::collections::HashSet;
use std::net::IpAddr;
use std::time::Duration;

use atlas_core::api::{SearchHit, SearchKind, SearchResultsDto};
use atlas_core::ids::{Collateral, Hash32, NodeId};
use atlas_core::net::NodeEndpoint;
use atlas_core::{NodeRecord, Tier};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

use crate::body::{cache, json_response};
use crate::error::{ApiError, ApiResult};
use crate::extract::{ClientIp, Q};
use crate::state::AppState;
use crate::views::Views;
use crate::views::analytics::SearchCatalog;

/// Most hits returned.
pub const MAX_HITS: usize = 20;
/// Longest accepted query.
pub const MAX_QUERY: usize = 128;

// ---------------------------------------------------------------------------------------------
// Base58check and address classes
// ---------------------------------------------------------------------------------------------

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub fn is_base58(b: u8) -> bool {
    ALPHABET.contains(&b)
}

fn b58_value(b: u8) -> Option<u32> {
    ALPHABET.iter().position(|&c| c == b).map(|p| p as u32)
}

/// Decodes base58 (no checksum handling).
pub fn base58_decode(s: &str) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::with_capacity(s.len());
    for &c in s.as_bytes() {
        let mut carry = b58_value(c)?;
        for byte in out.iter_mut().rev() {
            carry += u32::from(*byte) * 58;
            *byte = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            out.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|&b| b == b'1').count();
    let mut v = vec![0u8; zeros];
    v.extend(out);
    Some(v)
}

/// Encodes base58 (no checksum handling).
pub fn base58_encode(data: &[u8]) -> String {
    let zeros = data.iter().take_while(|&&b| b == 0).count();
    let mut digits: Vec<u8> = Vec::with_capacity(data.len() * 2);
    for &byte in data {
        let mut carry = u32::from(byte);
        for d in &mut digits {
            carry += u32::from(*d) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut s = String::with_capacity(zeros + digits.len());
    s.extend(std::iter::repeat_n('1', zeros));
    s.extend(digits.iter().rev().map(|&d| ALPHABET[d as usize] as char));
    s
}

fn sha256d(data: &[u8]) -> [u8; 32] {
    let first = Sha256::digest(data);
    Sha256::digest(first).into()
}

/// Payload of a base58check string whose checksum verifies.
pub fn base58check_decode(s: &str) -> Option<Vec<u8>> {
    let raw = base58_decode(s)?;
    if raw.len() < 5 {
        return None;
    }
    let (payload, check) = raw.split_at(raw.len() - 4);
    (sha256d(payload)[..4] == *check).then(|| payload.to_vec())
}

/// Base58check encoding of `payload`.
pub fn base58check_encode(payload: &[u8]) -> String {
    let mut v = payload.to_vec();
    v.extend_from_slice(&sha256d(payload)[..4]);
    base58_encode(&v)
}

/// Mainnet transparent version prefixes.
pub const T1_VERSION: [u8; 2] = [0x1C, 0xB8];
pub const T3_VERSION: [u8; 2] = [0x1C, 0xBD];
const TM_VERSION: [u8; 2] = [0x1D, 0x25];
const T2_VERSION: [u8; 2] = [0x1C, 0xBA];

/// What an address-looking string is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressClass {
    Transparent { p2sh: bool, valid: bool },
    Shielded { sapling: bool },
    Testnet,
    None,
}

fn bech32_char(b: u8) -> bool {
    b"qpzry9x8gf2tvdw0s3jn54khce6mua7l".contains(&b)
}

pub fn classify_address(a: &str) -> AddressClass {
    let b = a.as_bytes();
    if a.len() == 35 && b.iter().all(|&c| is_base58(c)) {
        let version =
            |v: [u8; 2]| base58check_decode(a).is_some_and(|p| p.len() == 22 && p[..2] == v);
        if a.starts_with("t1") {
            return AddressClass::Transparent {
                p2sh: false,
                valid: version(T1_VERSION),
            };
        }
        if a.starts_with("t3") {
            return AddressClass::Transparent {
                p2sh: true,
                valid: version(T3_VERSION),
            };
        }
        if (a.starts_with("tm") && version(TM_VERSION))
            || (a.starts_with("t2") && version(T2_VERSION))
        {
            return AddressClass::Testnet;
        }
    }
    if a.len() == 78 && a.starts_with("zs1") && b[3..].iter().all(|&c| bech32_char(c)) {
        return AddressClass::Shielded { sapling: true };
    }
    if a.len() == 95 && a.starts_with("zc") && b.iter().all(|&c| is_base58(c)) {
        return AddressClass::Shielded { sapling: false };
    }
    AddressClass::None
}

/// A mainnet P2PKH address for a 20-byte hash (fixtures, tests).
pub fn t1_address(hash160: [u8; 20]) -> String {
    let mut p = T1_VERSION.to_vec();
    p.extend_from_slice(&hash160);
    base58check_encode(&p)
}

// ---------------------------------------------------------------------------------------------
// Query classes
// ---------------------------------------------------------------------------------------------

/// The class of a search query (section 4.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryClass {
    Outpoint(atlas_core::Outpoint),
    Height(u32),
    Hash(Hash32),
    Address(AddressClass),
    Endpoint { ep: NodeEndpoint, has_port: bool },
    IpPrefix(String),
    Text(String),
}

fn looks_like_ip_prefix(s: &str) -> bool {
    s.contains('.')
        && s.len() <= 15
        && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        && s.split('.').count() <= 4
        && s.split('.').all(|p| p.len() <= 3)
}

pub fn classify(q: &str) -> QueryClass {
    let q = q.trim();
    let s = q.strip_prefix('#').unwrap_or(q).trim();
    // 1. Outpoint (full txid only; the short header form cannot be searched).
    if s.len() > 64
        && let Ok(Collateral::Full(o)) = Collateral::parse(s)
    {
        return QueryClass::Outpoint(o);
    }
    // 2. Height, with separators stripped.
    let digits: String = s
        .chars()
        .filter(|c| !matches!(c, ',' | '_' | ' '))
        .collect();
    if !digits.is_empty()
        && digits.len() <= 9
        && digits.bytes().all(|b| b.is_ascii_digit())
        && let Ok(h) = digits.parse()
    {
        return QueryClass::Height(h);
    }
    // 3. 64-hex.
    if s.len() == 64
        && s.bytes().all(|b| b.is_ascii_hexdigit())
        && let Ok(h) = Hash32::from_hex(s)
    {
        return QueryClass::Hash(h);
    }
    // 4/5. Addresses.
    let ac = classify_address(s);
    if ac != AddressClass::None {
        return QueryClass::Address(ac);
    }
    // 6. IP(:port).
    if let Ok(ep) = s.parse::<NodeEndpoint>() {
        let has_port = (s.starts_with('[') && s.contains("]:"))
            || (!s.starts_with('[') && s.matches(':').count() == 1);
        return QueryClass::Endpoint { ep, has_port };
    }
    if looks_like_ip_prefix(s) && s.matches('.').count() < 3
        || (looks_like_ip_prefix(s) && s.ends_with('.'))
    {
        return QueryClass::IpPrefix(s.to_owned());
    }
    QueryClass::Text(s.to_owned())
}

// ---------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct Hits {
    list: Vec<(u32, SearchHit)>,
    seen: HashSet<(u8, String)>,
}

impl Hits {
    fn push(
        &mut self,
        score: u32,
        kind: SearchKind,
        key: String,
        label: String,
        sublabel: Option<String>,
    ) {
        if self.seen.insert((kind as u8, key.clone())) {
            self.list.push((
                score,
                SearchHit {
                    kind,
                    key,
                    label,
                    sublabel,
                },
            ));
        }
    }

    fn finish(mut self) -> Vec<SearchHit> {
        self.list
            .sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.label.cmp(&b.1.label)));
        self.list
            .into_iter()
            .take(MAX_HITS)
            .map(|(_, h)| h)
            .collect()
    }
}

fn tier_label(t: Tier) -> &'static str {
    match t {
        Tier::Cumulus => "Cumulus",
        Tier::Nimbus => "Nimbus",
        Tier::Stratus => "Stratus",
        Tier::Unknown => "Unknown tier",
    }
}

fn node_hit(h: &mut Hits, score: u32, n: &NodeRecord) {
    let label = match n.endpoint {
        Some(ep) => format!("{} node {ep}", tier_label(n.tier)),
        None => format!("{} node #{}", tier_label(n.tier), n.id),
    };
    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("{:?}", n.status).to_ascii_lowercase());
    if let Some(r) = n.rank {
        parts.push(format!("queue #{}", r + 1));
    }
    if let Some(g) = n.geo.as_ref() {
        if !g.country_code.is_empty() {
            parts.push(g.country_code.to_string());
        }
        if !g.org.is_empty() {
            parts.push(g.org.to_string());
        }
    }
    h.push(
        score,
        SearchKind::Node,
        n.id.to_string(),
        label,
        Some(parts.join(" / ")),
    );
}

/// Levenshtein distance with an early exit above `max`.
pub fn edit_distance(a: &str, b: &str, max: usize) -> Option<usize> {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max {
        return None;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        let mut row_min = cur[0];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
            row_min = row_min.min(cur[j + 1]);
        }
        if row_min > max {
            return None;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    (prev[b.len()] <= max).then_some(prev[b.len()])
}

fn fmt_height(h: u32) -> String {
    let s = h.to_string();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn block_hit(h: &mut Hits, score: u32, height: u32, hash: Option<&Hash32>) {
    h.push(
        score,
        SearchKind::Block,
        height.to_string(),
        format!("Block {}", fmt_height(height)),
        hash.map(Hash32::to_hex),
    );
}

fn operator_hits(h: &mut Hits, v: &Views, key: &str, positions: &[u32], score: u32) {
    if positions.is_empty() {
        return;
    }
    let active = positions
        .iter()
        .filter(|&&i| v.at(i as usize).status.is_active())
        .count();
    h.push(
        score,
        SearchKind::Operator,
        key.to_owned(),
        format!("Operator {key}"),
        Some(format!("{active} active nodes")),
    );
    for &i in positions.iter().take(5) {
        node_hit(h, score.saturating_sub(10), v.at(i as usize));
    }
}

fn text_hits(h: &mut Hits, v: &Views, cat: &SearchCatalog, text: &str) {
    let lower = text.to_ascii_lowercase();
    // ZelID operators.
    if (25..=36).contains(&text.len()) && text.bytes().all(is_base58) {
        operator_hits(h, v, text, v.index.by_zelid(text), 95);
    }
    // Versions (`8.20.0`, `v8.20.0`, `jolly wombat`).
    let ver = lower.strip_prefix('v').unwrap_or(&lower);
    for (component, version, count) in &cat.versions {
        let vl = version.to_ascii_lowercase();
        let score = if vl == ver {
            85
        } else if ver.len() >= 3 && vl.starts_with(ver) {
            55
        } else {
            continue;
        };
        let name = match *component {
            "flux_os" => "FluxOS",
            "daemon" => "fluxd",
            "bench" => "fluxbench",
            _ => "ArcaneOS",
        };
        h.push(
            score,
            SearchKind::Version,
            format!("{component}:{version}"),
            format!("{name} {version}"),
            Some(format!("{count} nodes")),
        );
    }
    // Countries: exact code, or name prefix/contains.
    for (code, name, count) in &cat.countries {
        let nl = name.to_ascii_lowercase();
        let score = if code.eq_ignore_ascii_case(text) || nl == lower {
            90
        } else if lower.len() >= 3 && nl.starts_with(&lower) {
            70
        } else if lower.len() >= 4 && nl.contains(&lower) {
            45
        } else {
            continue;
        };
        h.push(
            score,
            SearchKind::Country,
            code.clone(),
            name.clone(),
            Some(format!("{count} nodes")),
        );
    }
    // Providers: `AS<n>` or org name.
    for (key, org, asn, count) in &cat.providers {
        let ol = org.to_ascii_lowercase();
        let score = if key.eq_ignore_ascii_case(text) || ol == lower {
            90
        } else if lower.len() >= 3 && ol.starts_with(&lower) {
            65
        } else if lower.len() >= 4 && ol.contains(&lower) {
            45
        } else {
            continue;
        };
        let sub = match asn {
            Some(a) => format!("AS{a} / {count} nodes"),
            None => format!("{count} nodes"),
        };
        h.push(
            score,
            SearchKind::Provider,
            key.clone(),
            org.clone(),
            Some(sub),
        );
    }
    // Apps: exact, prefix, substring, then fuzzy.
    for a in v.published.apps.iter() {
        let score = if a.name == lower {
            100
        } else if a.name.starts_with(&lower) {
            80
        } else if lower.len() >= 3 && a.name.contains(&lower) {
            60
        } else if lower.len() >= 4
            && let Some(d) = edit_distance(&a.name, &lower, if lower.len() >= 8 { 2 } else { 1 })
        {
            50 - d as u32 * 5
        } else {
            continue;
        };
        h.push(
            score,
            SearchKind::App,
            a.name.clone(),
            a.display_name.clone(),
            Some(format!("{} / {} instances", a.owner, a.instances_running)),
        );
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// Upstream probe deadline for unknown hashes.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// `GET /search?q=`.
pub async fn handler(
    State(s): State<AppState>,
    headers: HeaderMap,
    ClientIp(ip): ClientIp,
    Q(query): Q<SearchQuery>,
) -> ApiResult<Response> {
    let q = query.q.unwrap_or_default();
    let q = q.trim();
    if q.is_empty() {
        return Err(ApiError::bad_request("q is required"));
    }
    if q.len() > MAX_QUERY || q.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "q is too long or contains control characters",
        ));
    }
    let v = s.views();
    let hits = resolve(&s, &v, ip, q).await?;
    let dto = SearchResultsDto {
        q: q.to_owned(),
        hits,
    };
    Ok(json_response(&headers, &dto, cache::DERIVED))
}

/// Resolves a query to ranked hits.
#[allow(clippy::many_single_char_names)]
pub async fn resolve(
    s: &AppState,
    v: &Views,
    ip: IpAddr,
    q: &str,
) -> Result<Vec<SearchHit>, ApiError> {
    let mut h = Hits::default();
    match classify(q) {
        QueryClass::Outpoint(o) => match v.index.by_outpoint(&o) {
            Some(i) => node_hit(&mut h, 100, v.at(i)),
            None => h.push(
                60,
                SearchKind::Tx,
                o.txid.to_hex(),
                format!("Transaction {}", short(&o.txid)),
                Some(format!("output {} is not a known node collateral", o.vout)),
            ),
        },
        QueryClass::Height(height) => {
            if v.tip_height().is_none_or(|t| height <= t) {
                let hash = v
                    .published
                    .blocks
                    .iter()
                    .find(|b| b.height == height)
                    .map(|b| b.hash);
                block_hit(&mut h, 100, height, hash.as_ref());
            }
            if let Some(n) = v.node(NodeId(height)).filter(|_| height < 1_000_000) {
                node_hit(&mut h, 20, n);
            }
        }
        QueryClass::Hash(hash) => hash_hits(s, v, ip, &mut h, hash).await?,
        QueryClass::Address(AddressClass::Transparent { p2sh, valid: true }) => {
            let positions = v.index.by_address(q);
            let active = positions
                .iter()
                .filter(|&&i| v.at(i as usize).status.is_active())
                .count();
            let kind = if p2sh { "P2SH address" } else { "Address" };
            let sub = if positions.is_empty() {
                None
            } else {
                Some(format!("pays {active} active nodes"))
            };
            h.push(
                100,
                SearchKind::Address,
                q.to_owned(),
                format!("{kind} {q}"),
                sub,
            );
            operator_hits(&mut h, v, q, positions, 90);
        }
        QueryClass::Address(AddressClass::Shielded { sapling }) => h.push(
            100,
            SearchKind::Shielded,
            q.to_owned(),
            if sapling {
                "Sapling shielded address".to_owned()
            } else {
                "Sprout shielded address".to_owned()
            },
            Some("shielded balances and history are private".to_owned()),
        ),
        QueryClass::Address(_) => {}
        QueryClass::Endpoint { ep, has_port } => {
            if let Some(i) = v.index.by_endpoint(&ep).filter(|_| has_port) {
                node_hit(&mut h, 100, v.at(i));
            }
            let on_host = v.index.by_ip(&ep.ip);
            if !on_host.is_empty() {
                h.push(
                    if has_port { 70 } else { 95 },
                    SearchKind::Host,
                    ep.ip.to_string(),
                    format!("Host {}", ep.ip),
                    Some(format!("{} nodes", on_host.len())),
                );
                for &i in on_host {
                    node_hit(&mut h, if has_port { 60 } else { 90 }, v.at(i as usize));
                }
            }
        }
        QueryClass::IpPrefix(prefix) => {
            let mut hosts: Vec<(IpAddr, usize)> = Vec::new();
            for (ep, i) in v.index.endpoints() {
                if ep.ip.to_string().starts_with(&prefix) {
                    if !hosts.iter().any(|(ip, _)| *ip == ep.ip) {
                        hosts.push((ep.ip, v.index.by_ip(&ep.ip).len()));
                    }
                    if h.list.len() < MAX_HITS {
                        node_hit(&mut h, 40, v.at(i));
                    }
                }
            }
            hosts.sort();
            for (ip, n) in hosts.into_iter().take(10) {
                h.push(
                    50,
                    SearchKind::Host,
                    ip.to_string(),
                    format!("Host {ip}"),
                    Some(format!("{n} nodes")),
                );
            }
            // `8.20.0` is both an IP prefix and a version string.
            let cat = v
                .search
                .get_or_init(|| std::sync::Arc::new(SearchCatalog::build(v.nodes())));
            text_hits(&mut h, v, cat, &prefix);
        }
        QueryClass::Text(text) => {
            let cat = v
                .search
                .get_or_init(|| std::sync::Arc::new(SearchCatalog::build(v.nodes())));
            text_hits(&mut h, v, cat, &text);
        }
    }
    Ok(h.finish())
}

fn short(h: &Hash32) -> String {
    let s = h.to_hex();
    format!("{}...{}", &s[..8], &s[56..])
}

async fn hash_hits(
    s: &AppState,
    v: &Views,
    ip: IpAddr,
    h: &mut Hits,
    hash: Hash32,
) -> Result<(), ApiError> {
    // a. Local: known blocks and node collaterals.
    let local_block = match v.published.blocks.iter().find(|b| b.hash == hash) {
        Some(b) => Some(b.height),
        None => {
            s.store_read(move |st| Ok(st.block_by_hash(&hash)?.map(|b| b.height)))
                .await?
        }
    };
    if let Some(height) = local_block {
        block_hit(h, 100, height, Some(&hash));
        return Ok(());
    }
    let collateral = v.index.by_txid(&hash);
    if !collateral.is_empty() {
        for &i in collateral {
            node_hit(h, 100, v.at(i as usize));
        }
        h.push(
            80,
            SearchKind::Tx,
            hash.to_hex(),
            format!("Transaction {}", short(&hash)),
            Some("node collateral".to_owned()),
        );
        return Ok(());
    }
    // b/c. Unknown locally: probe tx and block header in parallel.
    let block_first = hash.to_hex().starts_with("00000");
    let (tx, header) = tokio::join!(
        tokio::time::timeout(PROBE_TIMEOUT, s.explorer.tx(Some(ip), hash)),
        tokio::time::timeout(PROBE_TIMEOUT, s.explorer.block_height(Some(ip), hash)),
    );
    let tx = tx.unwrap_or_else(|_| Err(ApiError::upstream_timeout("probe timed out")));
    let header = header.unwrap_or_else(|_| Err(ApiError::upstream_timeout("probe timed out")));
    for r in [&tx.as_ref().err(), &header.as_ref().err()] {
        if let Some(e) = r
            && e.status == axum::http::StatusCode::TOO_MANY_REQUESTS
        {
            return Err((*e).clone());
        }
    }
    if let Ok(height) = &header {
        block_hit(h, if block_first { 100 } else { 90 }, **height, Some(&hash));
    }
    if let Ok(t) = &tx {
        let sub = match t.height {
            Some(ht) => format!("{:?} in block {}", t.kind, fmt_height(ht)).to_ascii_lowercase(),
            None => "unconfirmed".to_owned(),
        };
        h.push(
            if block_first { 90 } else { 100 },
            SearchKind::Tx,
            hash.to_hex(),
            format!("Transaction {}", short(&hash)),
            Some(sub),
        );
        if let Some(n) = t
            .node_tx
            .as_ref()
            .and_then(|n| v.index.by_outpoint(&n.collateral))
        {
            node_hit(h, 80, v.at(n));
        }
    }
    if tx.is_err() && header.is_err() {
        // Neither probe found it; surface an upstream failure rather than an empty answer.
        for e in [tx.err(), header.err()].into_iter().flatten() {
            if e.status != axum::http::StatusCode::NOT_FOUND {
                return Err(e);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV_FUND: &str = "t3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA";
    const T1: &str = "t1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv";
    const TX: &str = "6d12b8f9ac958776c443063576dd092c79310879d26f6e4ab06a1d541279331e";

    #[test]
    fn base58check_round_trip() {
        let p = base58check_decode(T1).unwrap();
        assert_eq!(&p[..2], &T1_VERSION);
        assert_eq!(base58check_encode(&p), T1);
        assert_eq!(
            classify_address(DEV_FUND),
            AddressClass::Transparent {
                p2sh: true,
                valid: true
            }
        );
        assert_eq!(
            classify_address(T1),
            AddressClass::Transparent {
                p2sh: false,
                valid: true
            }
        );
        let mut bad = T1.to_owned();
        bad.replace_range(34..35, if T1.ends_with('v') { "w" } else { "v" });
        assert_eq!(
            classify_address(&bad),
            AddressClass::Transparent {
                p2sh: false,
                valid: false
            }
        );
        let a = t1_address([7; 20]);
        assert!(a.starts_with("t1"));
        assert_eq!(
            classify_address(&a),
            AddressClass::Transparent {
                p2sh: false,
                valid: true
            }
        );
    }

    #[test]
    fn query_classes() {
        assert_eq!(classify("2996914"), QueryClass::Height(2_996_914));
        assert_eq!(classify("#2,996,914"), QueryClass::Height(2_996_914));
        assert!(matches!(classify(TX), QueryClass::Hash(_)));
        assert!(matches!(classify(&format!("{TX}:0")), QueryClass::Outpoint(o) if o.vout == 0));
        assert!(
            matches!(classify(&format!("COutPoint({TX}, 3)")), QueryClass::Outpoint(o) if o.vout == 3)
        );
        assert!(matches!(
            classify(&format!("{TX}-1")),
            QueryClass::Outpoint(_)
        ));
        assert!(matches!(
            classify(T1),
            QueryClass::Address(AddressClass::Transparent { .. })
        ));
        let zs = format!("zs1{}", "q".repeat(75));
        assert!(matches!(
            classify(&zs),
            QueryClass::Address(AddressClass::Shielded { sapling: true })
        ));
        assert!(matches!(
            classify("1.2.3.4"),
            QueryClass::Endpoint {
                has_port: false,
                ..
            }
        ));
        assert!(matches!(
            classify("1.2.3.4:16137"),
            QueryClass::Endpoint { has_port: true, .. }
        ));
        assert!(matches!(
            classify("[2001:db8::1]:16127"),
            QueryClass::Endpoint { has_port: true, .. }
        ));
        assert_eq!(classify("95.216."), QueryClass::IpPrefix("95.216.".into()));
        assert_eq!(classify("95.216"), QueryClass::IpPrefix("95.216".into()));
        assert_eq!(classify("8.20.0"), QueryClass::IpPrefix("8.20.0".into()));
        assert_eq!(classify("fluxapp"), QueryClass::Text("fluxapp".into()));
        assert_eq!(classify("v8.20.0"), QueryClass::Text("v8.20.0".into()));
    }

    #[test]
    fn fuzzy() {
        assert_eq!(edit_distance("kadena", "kadena", 1), Some(0));
        assert_eq!(edit_distance("kadena", "kadina", 1), Some(1));
        assert_eq!(edit_distance("kadena", "wordpress", 2), None);
        assert_eq!(fmt_height(2_996_914), "2,996,914");
        assert_eq!(fmt_height(12), "12");
    }
}

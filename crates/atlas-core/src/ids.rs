//! Identifiers: interned node ids, 32-byte hashes, and collateral outpoints.

use std::fmt;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// Interned, stable node identifier. Assigned on first sight of a collateral outpoint and
/// persisted, so clients may cache it across sessions.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[serde(transparent)]
pub struct NodeId(pub u32);

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Errors produced while parsing identifiers.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IdError {
    #[error("expected 64 hex characters, got {0}")]
    BadHashLength(usize),
    #[error("invalid hex")]
    BadHex,
    #[error("invalid outpoint syntax: {0}")]
    BadOutpoint(String),
    #[error("invalid output index")]
    BadIndex,
}

/// A 32-byte hash (txid or block hash) stored in the same byte order as its RPC hex text.
/// JSON form is a lowercase 64-character hex string; binary formats store the raw bytes.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, TS)]
#[ts(as = "String")]
pub struct Hash32(pub [u8; 32]);

/// Transaction id.
pub type Txid = Hash32;
/// Block hash.
pub type BlockHash = Hash32;

impl Hash32 {
    pub const ZERO: Self = Self([0; 32]);

    /// Parses a 64-character hex string (any case).
    pub fn from_hex(s: &str) -> Result<Self, IdError> {
        let s = s.trim();
        if s.len() != 64 {
            return Err(IdError::BadHashLength(s.len()));
        }
        let mut out = [0u8; 32];
        hex::decode_to_slice(s, &mut out).map_err(|_| IdError::BadHex)?;
        Ok(Self(out))
    }

    /// Lowercase hex text.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// True when the lowercase hex form starts with `prefix` (lowercase hex, any length up to 64).
    pub fn has_hex_prefix(&self, prefix: &str) -> bool {
        let full = self.to_hex();
        full.starts_with(prefix)
    }
}

impl fmt::Display for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 64];
        // Encoding into a correctly sized buffer cannot fail.
        if hex::encode_to_slice(self.0, &mut buf).is_err() {
            return Err(fmt::Error);
        }
        f.write_str(std::str::from_utf8(&buf).map_err(|_| fmt::Error)?)
    }
}

impl fmt::Debug for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hash32({self})")
    }
}

impl FromStr for Hash32 {
    type Err = IdError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_hex(s)
    }
}

impl Serialize for Hash32 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if serializer.is_human_readable() {
            serializer.collect_str(self)
        } else {
            self.0.serialize(serializer)
        }
    }
}

impl<'de> Deserialize<'de> for Hash32 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if deserializer.is_human_readable() {
            struct V;
            impl Visitor<'_> for V {
                type Value = Hash32;
                fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    f.write_str("a 64-character hex string")
                }
                fn visit_str<E: de::Error>(self, v: &str) -> Result<Hash32, E> {
                    Hash32::from_hex(v).map_err(E::custom)
                }
            }
            deserializer.deserialize_str(V)
        } else {
            <[u8; 32]>::deserialize(deserializer).map(Hash32)
        }
    }
}

/// A transaction output reference `txid:vout`: the canonical identity of a FluxNode
/// (its collateral).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, TS)]
#[ts(as = "String")]
pub struct Outpoint {
    pub txid: Txid,
    pub vout: u32,
}

/// Size of [`Outpoint::to_key`].
pub const OUTPOINT_KEY_LEN: usize = 36;

impl Outpoint {
    pub const fn new(txid: Txid, vout: u32) -> Self {
        Self { txid, vout }
    }

    /// Fixed-width sortable key: 32 txid bytes followed by the big-endian vout.
    pub fn to_key(&self) -> [u8; OUTPOINT_KEY_LEN] {
        let mut k = [0u8; OUTPOINT_KEY_LEN];
        k[..32].copy_from_slice(&self.txid.0);
        k[32..].copy_from_slice(&self.vout.to_be_bytes());
        k
    }

    /// Sort key that orders outpoints the way fluxd's `COutPoint::operator<` does: `uint256`
    /// compares its internal little-endian bytes with `memcmp` (the hex text is those bytes
    /// reversed), then the output index. The payment queue breaks ties with it.
    pub fn consensus_order(&self) -> ([u8; 32], u32) {
        let mut b = self.txid.0;
        b.reverse();
        (b, self.vout)
    }

    /// Inverse of [`Outpoint::to_key`].
    pub fn from_key(k: &[u8; OUTPOINT_KEY_LEN]) -> Self {
        let mut txid = [0u8; 32];
        txid.copy_from_slice(&k[..32]);
        let mut v = [0u8; 4];
        v.copy_from_slice(&k[32..]);
        Self {
            txid: Hash32(txid),
            vout: u32::from_be_bytes(v),
        }
    }

    /// True if `prefix` (a possibly truncated collateral from a block header) names this outpoint.
    pub fn matches_prefix(&self, prefix: &OutpointPrefix) -> bool {
        self.vout == prefix.vout && self.txid.has_hex_prefix(&prefix.txid_prefix)
    }

    /// The emergency-block collateral uses an all-ones txid.
    pub fn is_emergency(&self) -> bool {
        self.txid.0.iter().all(|b| *b == 0x11)
    }

    /// Formats as the daemon's `COutPoint(<txid>, <n>)` long form.
    pub fn to_coutpoint_string(&self) -> String {
        format!("COutPoint({}, {})", self.txid, self.vout)
    }
}

impl fmt::Display for Outpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.txid, self.vout)
    }
}

impl fmt::Debug for Outpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Outpoint({self})")
    }
}

impl FromStr for Outpoint {
    type Err = IdError;
    /// Accepts `txid:n`, `txid-n`, `txid_n`, `txid n`, `txid,n` and `COutPoint(txid, n)`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match Collateral::parse(s)? {
            Collateral::Full(o) => Ok(o),
            Collateral::Prefix(_) => Err(IdError::BadOutpoint(s.to_owned())),
        }
    }
}

impl Serialize for Outpoint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if serializer.is_human_readable() {
            serializer.collect_str(self)
        } else {
            (self.txid, self.vout).serialize(serializer)
        }
    }
}

impl<'de> Deserialize<'de> for Outpoint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if deserializer.is_human_readable() {
            struct V;
            impl Visitor<'_> for V {
                type Value = Outpoint;
                fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    f.write_str("an outpoint string `txid:n`")
                }
                fn visit_str<E: de::Error>(self, v: &str) -> Result<Outpoint, E> {
                    v.parse().map_err(E::custom)
                }
            }
            deserializer.deserialize_str(V)
        } else {
            let (txid, vout) = <(Hash32, u32)>::deserialize(deserializer)?;
            Ok(Outpoint { txid, vout })
        }
    }
}

/// A truncated collateral as printed by `COutPoint::ToString()` in block headers:
/// `COutPoint(6d12b8f9ac, 0)` (the first 10 hex chars of the txid).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct OutpointPrefix {
    /// Lowercase hex prefix of the txid (1 to 63 characters).
    pub txid_prefix: String,
    pub vout: u32,
}

impl fmt::Display for OutpointPrefix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.txid_prefix, self.vout)
    }
}

/// A collateral reference that is either complete or a header-style prefix.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Collateral {
    Full(Outpoint),
    Prefix(OutpointPrefix),
}

impl Collateral {
    /// Parses every collateral spelling seen upstream:
    /// `COutPoint(<64hex>, n)`, `COutPoint(<short hex>, n)`, and `<64hex>[:-_ ,]n`.
    pub fn parse(input: &str) -> Result<Self, IdError> {
        let s = input.trim();
        let (hex_part, idx_part) = if let Some(inner) = s
            .strip_prefix("COutPoint(")
            .and_then(|r| r.strip_suffix(')'))
        {
            let (h, i) = inner
                .split_once(',')
                .ok_or_else(|| IdError::BadOutpoint(input.to_owned()))?;
            (h.trim(), i.trim())
        } else {
            let pos = s
                .rfind([':', '-', '_', ' ', ','])
                .ok_or_else(|| IdError::BadOutpoint(input.to_owned()))?;
            (s[..pos].trim(), s[pos + 1..].trim())
        };
        let vout: u32 = idx_part.parse().map_err(|_| IdError::BadIndex)?;
        if hex_part.is_empty() || !hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(IdError::BadHex);
        }
        match hex_part.len() {
            64 => Ok(Self::Full(Outpoint {
                txid: Hash32::from_hex(hex_part)?,
                vout,
            })),
            n if n < 64 => Ok(Self::Prefix(OutpointPrefix {
                txid_prefix: hex_part.to_ascii_lowercase(),
                vout,
            })),
            n => Err(IdError::BadHashLength(n)),
        }
    }

    pub fn vout(&self) -> u32 {
        match self {
            Self::Full(o) => o.vout,
            Self::Prefix(p) => p.vout,
        }
    }

    /// True if this reference names `outpoint`.
    pub fn matches(&self, outpoint: &Outpoint) -> bool {
        match self {
            Self::Full(o) => o == outpoint,
            Self::Prefix(p) => outpoint.matches_prefix(p),
        }
    }

    pub fn as_full(&self) -> Option<&Outpoint> {
        match self {
            Self::Full(o) => Some(o),
            Self::Prefix(_) => None,
        }
    }
}

impl fmt::Display for Collateral {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Full(o) => o.fmt(f),
            Self::Prefix(p) => p.fmt(f),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TX: &str = "6d12b8f9ac958776c443063576dd092c79310879d26f6e4ab06a1d541279331e";

    #[test]
    fn hash_roundtrip() {
        let h = Hash32::from_hex(TX).unwrap();
        assert_eq!(h.to_string(), TX);
        assert_eq!(Hash32::from_hex(&TX.to_uppercase()).unwrap(), h);
        assert!(Hash32::from_hex("abc").is_err());
        assert!(Hash32::from_hex(&"zz".repeat(32)).is_err());
    }

    #[test]
    fn outpoint_forms() {
        let full: Outpoint = format!("{TX}:3").parse().unwrap();
        assert_eq!(full.vout, 3);
        assert_eq!(full.to_string(), format!("{TX}:3"));
        let cout: Outpoint = format!("COutPoint({TX}, 3)").parse().unwrap();
        assert_eq!(cout, full);
        for sep in ['-', '_', ' ', ','] {
            let o: Outpoint = format!("{TX}{sep}3").parse().unwrap();
            assert_eq!(o, full);
        }
        assert_eq!(full.to_coutpoint_string(), format!("COutPoint({TX}, 3)"));
        assert_eq!(Outpoint::from_key(&full.to_key()), full);
        assert!("COutPoint(6d12b8f9ac, 0)".parse::<Outpoint>().is_err());
        assert!("nonsense".parse::<Outpoint>().is_err());
        assert!(format!("{TX}:x").parse::<Outpoint>().is_err());
    }

    #[test]
    fn short_prefix_form() {
        let c = Collateral::parse("COutPoint(6d12b8f9ac, 0)").unwrap();
        let Collateral::Prefix(p) = &c else {
            panic!("expected prefix")
        };
        assert_eq!(p.txid_prefix, "6d12b8f9ac");
        assert_eq!(p.vout, 0);
        let full = Outpoint::new(Hash32::from_hex(TX).unwrap(), 0);
        assert!(c.matches(&full));
        assert!(!c.matches(&Outpoint::new(full.txid, 1)));
        let other = Outpoint::new(Hash32::from_hex(&"ab".repeat(32)).unwrap(), 0);
        assert!(!c.matches(&other));
    }

    #[test]
    fn outpoint_key_sorts_by_txid_then_vout() {
        let a = Outpoint::new(Hash32([1; 32]), 2);
        let b = Outpoint::new(Hash32([1; 32]), 10);
        let c = Outpoint::new(Hash32([2; 32]), 0);
        assert!(a.to_key() < b.to_key());
        assert!(b.to_key() < c.to_key());
    }

    #[test]
    fn serde_forms() {
        let o = Outpoint::new(Hash32::from_hex(TX).unwrap(), 7);
        let j = serde_json::to_string(&o).unwrap();
        assert_eq!(j, format!("\"{TX}:7\""));
        assert_eq!(serde_json::from_str::<Outpoint>(&j).unwrap(), o);
        let bin = postcard::to_allocvec(&o).unwrap();
        assert_eq!(postcard::from_bytes::<Outpoint>(&bin).unwrap(), o);
        assert!(bin.len() <= 33);
    }

    #[test]
    fn emergency() {
        assert!(Outpoint::new(Hash32([0x11; 32]), 0).is_emergency());
        assert!(!Outpoint::new(Hash32([0x12; 32]), 0).is_emergency());
    }
}

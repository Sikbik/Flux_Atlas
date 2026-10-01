//! Value codec.
//!
//! Every structured value is stored as `[schema_version: u8] ++ postcard(value)`. Large blobs
//! (snapshots) are stored as `[format_version: u8] ++ zstd(postcard(value))`. Decoding checks
//! the version byte first and fails with [`StoreError::VersionMismatch`] when it differs, so a
//! type change without a migration is caught instead of misread.
//!
//! Scalar values (interned ids, heights, amounts, empty index values) use redb native types and
//! carry no version byte.

use serde::Serialize;
use serde::de::DeserializeOwned;

use atlas_core::app::{AppMessageRecord, AppRecord, PendingAppMessage};
use atlas_core::chain::{BlockSummary, NodeTx, Payout};
use atlas_core::event::EventEnvelope;
use atlas_core::node::{Geo, NodeRecord};

use crate::error::{Result, StoreError};
use atlas_core::NodeId;

use crate::records::{
    ChainPoint, MeshChangeRecord, MeshEdgeRecord, MeshReporter, MetricsRow, MetricsRowV1,
};

/// zstd level used for snapshot blobs.
const BLOB_ZSTD_LEVEL: i32 = 3;

/// A type persisted with the versioned postcard codec.
///
/// Bump `VERSION` whenever the serialized shape changes, and add a migration that rewrites the
/// affected table.
pub(crate) trait Stored: Serialize + DeserializeOwned {
    /// Schema version written as the first byte of every value.
    const VERSION: u8;
    /// Name used in error messages.
    const NAME: &'static str;
}

macro_rules! stored {
    ($($t:ty => $v:expr, $name:expr;)*) => {
        $(
            impl Stored for $t {
                const VERSION: u8 = $v;
                const NAME: &'static str = $name;
            }
        )*
    };
}

stored! {
    NodeRecord => 1, "NodeRecord";
    EventEnvelope => 1, "EventEnvelope";
    BlockSummary => 1, "BlockSummary";
    Payout => 1, "Payout";
    NodeTx => 1, "NodeTx";
    AppRecord => 1, "AppRecord";
    AppMessageRecord => 1, "AppMessageRecord";
    PendingAppMessage => 1, "PendingAppMessage";
    MeshEdgeRecord => 1, "MeshEdgeRecord";
    MetricsRow => 2, "MetricsRow";
    (Geo, u64) => 1, "GeoCacheEntry";
    ChainPoint => 1, "ChainPoint";
}

/// Encodes `value` as `[T::VERSION] ++ postcard(value)`.
pub(crate) fn encode<T: Stored>(value: &T) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(64);
    out.push(T::VERSION);
    postcard::to_extend(value, out).map_err(|source| StoreError::Encode {
        what: T::NAME,
        source,
    })
}

/// Decodes a value written by [`encode`], checking the version byte.
pub(crate) fn decode<T: Stored>(bytes: &[u8]) -> Result<T> {
    let body = check_version(bytes, T::VERSION, T::NAME)?;
    postcard::from_bytes(body).map_err(|source| StoreError::Decode {
        what: T::NAME,
        source,
    })
}

/// Decodes a metrics row: schema version 2, or version 1 upgraded on read (see
/// [`MetricsRowV1::upgrade`]). No table rewrite is needed; the rollup rewrites hours as v2.
pub(crate) fn decode_metrics(bytes: &[u8]) -> Result<MetricsRow> {
    if bytes.first() == Some(&1) {
        let body = check_version(bytes, 1, MetricsRow::NAME)?;
        let v1: MetricsRowV1 = postcard::from_bytes(body).map_err(|source| StoreError::Decode {
            what: MetricsRow::NAME,
            source,
        })?;
        return Ok(v1.upgrade());
    }
    decode(bytes)
}

// ---- mesh change rows -------------------------------------------------------------------------

const MESH_CHANGE: &str = "MeshChangeRecord";
/// Version 1: `postcard(MeshChangeRecord)` (about 4 bytes per edge). Still read.
const MESH_CHANGE_V1: u8 = 1;
/// Version 2: `postcard((reporter, zstd, body))` where `body` holds the added then the removed
/// edges as packed delta lists ([`pack_pairs`]), zstd-compressed when that is smaller. The time
/// is the row key's and is not repeated. About 2 bytes per edge.
pub(crate) const MESH_CHANGE_V2: u8 = 2;
const MESH_ZSTD_LEVEL: i32 = 3;

fn put_varint(out: &mut Vec<u8>, mut v: u32) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn get_varint(buf: &mut &[u8]) -> Result<u32> {
    let mut v: u64 = 0;
    for shift in (0..35).step_by(7) {
        let (&b, rest) = buf
            .split_first()
            .ok_or(StoreError::Truncated { what: MESH_CHANGE })?;
        *buf = rest;
        v |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return u32::try_from(v).map_err(|_| StoreError::Truncated { what: MESH_CHANGE });
        }
    }
    Err(StoreError::Truncated { what: MESH_CHANGE })
}

/// Packs edge pairs, sorted ascending: a count, then per pair the delta of `a` from the previous
/// pair's `a` and, when that delta is 0, the delta of `b` from the previous `b`, else `b - a`
/// (wrapping, so any pair round-trips). Varints throughout.
fn pack_pairs(out: &mut Vec<u8>, pairs: &[(NodeId, NodeId)]) {
    let mut v: Vec<(u32, u32)> = pairs.iter().map(|(a, b)| (a.0, b.0)).collect();
    v.sort_unstable();
    put_varint(out, v.len() as u32);
    let (mut pa, mut pb) = (0u32, 0u32);
    for (a, b) in v {
        let da = a.wrapping_sub(pa);
        put_varint(out, da);
        put_varint(
            out,
            if da == 0 {
                b.wrapping_sub(pb)
            } else {
                b.wrapping_sub(a)
            },
        );
        (pa, pb) = (a, b);
    }
}

fn unpack_pairs(buf: &mut &[u8]) -> Result<Vec<(NodeId, NodeId)>> {
    let n = get_varint(buf)? as usize;
    // Every pair takes at least two bytes: never trust a count beyond the input.
    let mut out = Vec::with_capacity(n.min(buf.len() / 2));
    let (mut pa, mut pb) = (0u32, 0u32);
    for _ in 0..n {
        let da = get_varint(buf)?;
        let a = pa.wrapping_add(da);
        let d = get_varint(buf)?;
        let b = if da == 0 {
            pb.wrapping_add(d)
        } else {
            a.wrapping_add(d)
        };
        out.push((NodeId(a), NodeId(b)));
        (pa, pb) = (a, b);
    }
    Ok(out)
}

/// Encodes a mesh change row (version 2). Edges are stored in ascending order.
pub(crate) fn encode_mesh_change(change: &MeshChangeRecord) -> Result<Vec<u8>> {
    let mut body = Vec::with_capacity(2 * (change.added.len() + change.removed.len()) + 8);
    pack_pairs(&mut body, &change.added);
    pack_pairs(&mut body, &change.removed);
    let packed = zstd::bulk::compress(&body, MESH_ZSTD_LEVEL).map_err(StoreError::Compression)?;
    let (zstd, body) = if packed.len() < body.len() {
        (true, packed)
    } else {
        (false, body)
    };
    let out = vec![MESH_CHANGE_V2];
    postcard::to_extend(&(change.reporter, zstd, body), out).map_err(|source| StoreError::Encode {
        what: MESH_CHANGE,
        source,
    })
}

/// Decodes a mesh change row of either version; `ts_ms` is the row key's time.
pub(crate) fn decode_mesh_change(ts_ms: u64, bytes: &[u8]) -> Result<MeshChangeRecord> {
    let decode_err = |source| StoreError::Decode {
        what: MESH_CHANGE,
        source,
    };
    match bytes.first() {
        Some(&MESH_CHANGE_V1) => postcard::from_bytes(&bytes[1..]).map_err(decode_err),
        Some(&MESH_CHANGE_V2) => {
            let (reporter, zstd, body): (MeshReporter, bool, Vec<u8>) =
                postcard::from_bytes(&bytes[1..]).map_err(decode_err)?;
            let raw = if zstd {
                // Bounded: a row never holds more than a few hundred thousand edges.
                zstd::bulk::decompress(&body, 64 << 20).map_err(StoreError::Compression)?
            } else {
                body
            };
            let mut buf = raw.as_slice();
            let added = unpack_pairs(&mut buf)?;
            let removed = unpack_pairs(&mut buf)?;
            Ok(MeshChangeRecord {
                ts_ms,
                reporter,
                added,
                removed,
            })
        }
        Some(&found) => Err(StoreError::VersionMismatch {
            what: MESH_CHANGE,
            expected: MESH_CHANGE_V2,
            found,
        }),
        None => Err(StoreError::Truncated { what: MESH_CHANGE }),
    }
}

/// Encodes a large value as `[version] ++ zstd(postcard(value))`.
pub(crate) fn encode_blob<T: Serialize>(value: &T, version: u8) -> Result<Vec<u8>> {
    let raw = postcard::to_allocvec(value).map_err(|source| StoreError::Encode {
        what: "blob",
        source,
    })?;
    let packed = zstd::bulk::compress(&raw, BLOB_ZSTD_LEVEL).map_err(StoreError::Compression)?;
    let mut out = Vec::with_capacity(packed.len() + 1);
    out.push(version);
    out.extend_from_slice(&packed);
    Ok(out)
}

/// Decompresses a blob written by [`encode_blob`] (any version) into its postcard bytes.
pub(crate) fn unpack_blob(bytes: &[u8]) -> Result<Vec<u8>> {
    let (_, body) = bytes
        .split_first()
        .ok_or(StoreError::Truncated { what: "blob" })?;
    zstd::stream::decode_all(body).map_err(StoreError::Compression)
}

/// Decodes a blob written by [`encode_blob`], checking the version byte.
pub(crate) fn decode_blob<T: DeserializeOwned>(bytes: &[u8], version: u8) -> Result<T> {
    let body = check_version(bytes, version, "blob")?;
    let raw = zstd::stream::decode_all(body).map_err(StoreError::Compression)?;
    postcard::from_bytes(&raw).map_err(|source| StoreError::Decode {
        what: "blob",
        source,
    })
}

fn check_version<'a>(bytes: &'a [u8], expected: u8, what: &'static str) -> Result<&'a [u8]> {
    let (&found, body) = bytes.split_first().ok_or(StoreError::Truncated { what })?;
    if found != expected {
        return Err(StoreError::VersionMismatch {
            what,
            expected,
            found,
        });
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_core::Amount;

    #[test]
    fn value_roundtrip_and_version_byte() {
        let row = MetricsRow {
            ts_ms: 60_000,
            node_count: Some(7),
            supply: Some(Amount::from_flux(5)),
            ..MetricsRow::default()
        };
        let bytes = encode(&row).unwrap();
        assert_eq!(bytes[0], MetricsRow::VERSION);
        assert_eq!(decode::<MetricsRow>(&bytes).unwrap(), row);
    }

    #[test]
    fn version_mismatch_is_typed() {
        let mut bytes = encode(&MetricsRow::default()).unwrap();
        bytes[0] = 99;
        match decode::<MetricsRow>(&bytes) {
            Err(StoreError::VersionMismatch {
                what,
                expected,
                found,
            }) => {
                assert_eq!(what, "MetricsRow");
                assert_eq!(expected, 2);
                assert_eq!(found, 99);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(matches!(
            decode::<MetricsRow>(&[]),
            Err(StoreError::Truncated { .. })
        ));
    }

    #[test]
    fn metrics_v1_rows_decode_with_unknowns() {
        let v1 = MetricsRowV1 {
            ts_ms: 60_000,
            node_count: 7,
            tier_counts: [3, 2, 2],
            ..MetricsRowV1::default()
        };
        let mut bytes = vec![1u8];
        bytes.extend(postcard::to_allocvec(&v1).unwrap());
        let row = decode_metrics(&bytes).unwrap();
        assert_eq!(row.node_count, Some(7));
        assert_eq!(row.tip_height, None);
        assert_eq!(row.price_usd, None);
        let v2 = encode(&row).unwrap();
        assert_eq!(v2[0], 2);
        assert_eq!(decode_metrics(&v2).unwrap(), row);
    }

    #[test]
    fn mesh_change_rows_pack_and_old_rows_still_read() {
        use atlas_core::NodeEndpoint;
        let n = NodeId;
        let mut added: Vec<(NodeId, NodeId)> = (0..2_000u32)
            .map(|i| (n(i % 60 * 97), n(10_000 + (i * 7_919) % 9_000)))
            .collect();
        added.sort_unstable();
        added.dedup();
        let change = MeshChangeRecord {
            ts_ms: 1_790_000_000_000,
            reporter: MeshReporter::Endpoint(
                "5.230.173.205:16127".parse::<NodeEndpoint>().unwrap(),
            ),
            added: added.clone(),
            removed: vec![(n(1), n(2)), (n(1), n(9)), (n(u32::MAX - 1), n(3))],
        };
        let v2 = encode_mesh_change(&change).unwrap();
        assert_eq!(v2[0], MESH_CHANGE_V2);
        let back = decode_mesh_change(change.ts_ms, &v2).unwrap();
        assert_eq!(back.added, change.added);
        // Stored ascending (any pair, even one out of the usual a < b order, round-trips).
        assert_eq!(
            back.removed,
            vec![(n(1), n(2)), (n(1), n(9)), (n(u32::MAX - 1), n(3))]
        );
        assert_eq!(back.reporter, change.reporter);
        // Version 1 (verbose postcard) rows still decode.
        let mut v1 = vec![MESH_CHANGE_V1];
        v1.extend(postcard::to_allocvec(&change).unwrap());
        assert_eq!(decode_mesh_change(change.ts_ms, &v1).unwrap(), change);
        assert!(
            v2.len() * 3 < v1.len() * 2,
            "v2 {} vs v1 {}",
            v2.len(),
            v1.len()
        );
        // Empty, truncated and unknown rows fail cleanly.
        let empty = MeshChangeRecord {
            added: Vec::new(),
            removed: Vec::new(),
            ..change.clone()
        };
        let e = encode_mesh_change(&empty).unwrap();
        assert_eq!(decode_mesh_change(change.ts_ms, &e).unwrap(), empty);
        assert!(decode_mesh_change(0, &[]).is_err());
        assert!(decode_mesh_change(0, &[9, 1, 2]).is_err());
        assert!(decode_mesh_change(0, &v2[..v2.len() / 2]).is_err());
        let mut huge = Vec::new();
        put_varint(&mut huge, u32::MAX);
        assert!(unpack_pairs(&mut huge.as_slice()).is_err());
    }

    #[test]
    fn blob_roundtrip_compresses() {
        let value: Vec<u64> = vec![42; 10_000];
        let bytes = encode_blob(&value, 1).unwrap();
        assert_eq!(bytes[0], 1);
        assert!(
            bytes.len() < 1_000,
            "blob should compress, got {}",
            bytes.len()
        );
        assert_eq!(decode_blob::<Vec<u64>>(&bytes, 1).unwrap(), value);
        assert!(matches!(
            decode_blob::<Vec<u64>>(&bytes, 2),
            Err(StoreError::VersionMismatch { found: 1, .. })
        ));
    }
}

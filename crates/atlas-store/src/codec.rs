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
use crate::records::{MeshChangeRecord, MeshEdgeRecord, MetricsRow};

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
    MeshChangeRecord => 1, "MeshChangeRecord";
    MetricsRow => 1, "MetricsRow";
    (Geo, u64) => 1, "GeoCacheEntry";
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
            node_count: 7,
            supply: Amount::from_flux(5),
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
                assert_eq!(expected, 1);
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

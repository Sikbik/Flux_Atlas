//! Store error type.

/// Everything that can go wrong in the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Any redb failure (open, transaction, table, storage, commit, compaction).
    #[error("database: {0}")]
    Db(#[from] redb::Error),
    /// A value could not be serialized.
    #[error("encode {what}: {source}")]
    Encode {
        /// Type being encoded.
        what: &'static str,
        /// Underlying postcard error.
        #[source]
        source: postcard::Error,
    },
    /// A stored value could not be deserialized.
    #[error("decode {what}: {source}")]
    Decode {
        /// Type being decoded.
        what: &'static str,
        /// Underlying postcard error.
        #[source]
        source: postcard::Error,
    },
    /// zstd compression or decompression failed.
    #[error("compression: {0}")]
    Compression(#[source] std::io::Error),
    /// A stored value carries a schema version this build cannot read.
    #[error("{what}: stored schema version {found}, expected {expected}")]
    VersionMismatch {
        /// Type being decoded.
        what: &'static str,
        /// Version this build writes and reads.
        expected: u8,
        /// Version byte found in the stored value.
        found: u8,
    },
    /// A stored value is empty or truncated.
    #[error("{what}: value is empty or truncated")]
    Truncated {
        /// Type being decoded.
        what: &'static str,
    },
    /// An index row points to a missing primary row.
    #[error("inconsistent index: {0}")]
    Inconsistent(&'static str),
    /// The database file was written by a newer build.
    #[error("database schema version {found} is newer than supported version {supported}")]
    SchemaTooNew {
        /// Version recorded in the file.
        found: u64,
        /// Highest version this build understands.
        supported: u64,
    },
    /// Reading file metadata failed.
    #[error("file: {0}")]
    Io(#[from] std::io::Error),
    /// A batch tried to intern an outpoint or id that is already mapped differently.
    #[error("interning conflict: {0}")]
    InternConflict(String),
}

/// Result alias for store operations.
pub type Result<T, E = StoreError> = std::result::Result<T, E>;

macro_rules! from_redb {
    ($($t:ty),* $(,)?) => {
        $(
            impl From<$t> for StoreError {
                fn from(e: $t) -> Self {
                    Self::Db(redb::Error::from(e))
                }
            }
        )*
    };
}

from_redb!(
    redb::DatabaseError,
    redb::TransactionError,
    redb::TableError,
    redb::StorageError,
    redb::CommitError,
    redb::CompactionError,
    redb::SetDurabilityError,
);

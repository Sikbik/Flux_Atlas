//! Storage diagnostics: file usage and per-table sizes from redb table stats.
//!
//! - [`FileUsage`] is O(1) (file metadata) and safe to read on every metrics scrape.
//! - [`Store::table_rows`] is O(1) per table (redb keeps the length in the table header).
//! - [`Store::db_stats`] walks every page of every table (redb `TableStats`), so it costs a
//!   full read of the file: run it rarely (`atlas db-stats`, the hourly disk guard).

use std::fmt::Write as _;
use std::path::Path;

use redb::{
    ReadOnlyDatabase, ReadTransaction, ReadableDatabase, ReadableTableMetadata, TableHandle,
};

use crate::error::Result;
use crate::store::Store;

/// Size of the database file on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FileUsage {
    /// File length. redb grows the file in steps and the tail can be sparse, so this can exceed
    /// the space the file really occupies.
    pub len_bytes: u64,
    /// Bytes the filesystem allocated for the file (`st_blocks * 512`): what counts against the
    /// volume. Equals `len_bytes` on platforms without block counts.
    pub disk_bytes: u64,
}

impl FileUsage {
    /// Usage of the file at `path` (zero if it does not exist).
    pub fn of(path: &Path) -> std::io::Result<Self> {
        let md = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e),
        };
        let len_bytes = md.len();
        #[cfg(unix)]
        let disk_bytes = {
            use std::os::unix::fs::MetadataExt as _;
            md.blocks().saturating_mul(512)
        };
        #[cfg(not(unix))]
        let disk_bytes = len_bytes;
        Ok(Self {
            len_bytes,
            disk_bytes,
        })
    }

    /// The larger of the two measures: what the budget guard compares against its limits.
    pub fn used_bytes(&self) -> u64 {
        self.len_bytes.max(self.disk_bytes)
    }
}

/// Size of one table, from redb's page walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableSize {
    pub name: String,
    pub rows: u64,
    /// Key and value bytes in leaf pages.
    pub stored_bytes: u64,
    /// Page headers, branch pages and other b-tree overhead.
    pub metadata_bytes: u64,
    /// Unused space inside the table's pages.
    pub fragmented_bytes: u64,
    pub leaf_pages: u64,
    pub branch_pages: u64,
}

impl TableSize {
    /// Bytes of the pages the table occupies.
    pub fn total_bytes(&self) -> u64 {
        self.stored_bytes + self.metadata_bytes + self.fragmented_bytes
    }

    /// Average page bytes per row (0 for an empty table).
    pub fn bytes_per_row(&self) -> f64 {
        if self.rows == 0 {
            0.0
        } else {
            self.total_bytes() as f64 / self.rows as f64
        }
    }
}

/// Database size report: the file and every table.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DbStats {
    pub file: FileUsage,
    /// Tables, largest first.
    pub tables: Vec<TableSize>,
}

impl DbStats {
    /// Bytes held by table pages (live data plus in-page fragmentation).
    pub fn tables_bytes(&self) -> u64 {
        self.tables.iter().map(TableSize::total_bytes).sum()
    }

    /// File space not held by any table page: free pages, redb system tables and region
    /// headers. A compaction gives most of it back to the filesystem; until then redb reuses
    /// it for new writes.
    pub fn slack_bytes(&self) -> u64 {
        self.file.len_bytes.saturating_sub(self.tables_bytes())
    }

    /// The table named `name`.
    pub fn table(&self, name: &str) -> Option<&TableSize> {
        self.tables.iter().find(|t| t.name == name)
    }

    /// Human-readable report (`atlas db-stats`).
    pub fn render(&self) -> String {
        let mb = |b: u64| b as f64 / 1_048_576.0;
        let mut out = String::new();
        let _ = writeln!(
            out,
            "file      {:>10.1} MiB length, {:>10.1} MiB on disk",
            mb(self.file.len_bytes),
            mb(self.file.disk_bytes)
        );
        let _ = writeln!(
            out,
            "tables    {:>10.1} MiB in table pages, {:.1} MiB slack (free pages, system tables)",
            mb(self.tables_bytes()),
            mb(self.slack_bytes())
        );
        let _ = writeln!(
            out,
            "\n{:<22} {:>12} {:>11} {:>11} {:>11} {:>9}",
            "table", "rows", "total MiB", "stored MiB", "frag MiB", "B/row"
        );
        for t in &self.tables {
            let _ = writeln!(
                out,
                "{:<22} {:>12} {:>11.2} {:>11.2} {:>11.2} {:>9.0}",
                t.name,
                t.rows,
                mb(t.total_bytes()),
                mb(t.stored_bytes),
                mb(t.fragmented_bytes),
                t.bytes_per_row()
            );
        }
        out
    }
}

/// Walks every table in `txn`.
fn tables_in(txn: &ReadTransaction) -> Result<Vec<TableSize>> {
    let mut out = Vec::new();
    for handle in txn.list_tables()? {
        let name = handle.name().to_owned();
        let table = txn.open_untyped_table(handle)?;
        let s = table.stats()?;
        out.push(TableSize {
            name,
            rows: table.len()?,
            stored_bytes: s.stored_bytes(),
            metadata_bytes: s.metadata_bytes(),
            fragmented_bytes: s.fragmented_bytes(),
            leaf_pages: s.leaf_pages(),
            branch_pages: s.branch_pages(),
        });
    }
    out.sort_by(|a, b| {
        b.total_bytes()
            .cmp(&a.total_bytes())
            .then(a.name.cmp(&b.name))
    });
    Ok(out)
}

impl Store {
    /// File usage of the database (O(1)).
    pub fn file_usage(&self) -> Result<FileUsage> {
        Ok(FileUsage::of(self.path())?)
    }

    /// Row count of every table (O(1) per table).
    pub fn table_rows(&self) -> Result<Vec<(String, u64)>> {
        self.read(|txn| {
            let mut out = Vec::new();
            for handle in txn.list_tables()? {
                let name = handle.name().to_owned();
                let rows = txn.open_untyped_table(handle)?.len()?;
                out.push((name, rows));
            }
            Ok(out)
        })
    }

    /// Full size report. Walks every page of every table in one read transaction (seconds on
    /// a multi-GB file); never call it on a hot path.
    pub fn db_stats(&self) -> Result<DbStats> {
        let tables = self.read(tables_in)?;
        Ok(DbStats {
            file: self.file_usage()?,
            tables,
        })
    }
}

/// [`Store::db_stats`] for a database file no process has open (redb locks the file, so this
/// fails while a server runs on it).
pub fn db_stats_at(path: &Path) -> Result<DbStats> {
    let db = ReadOnlyDatabase::open(path)?;
    let txn = db.begin_read()?;
    let tables = tables_in(&txn)?;
    drop(txn);
    drop(db);
    Ok(DbStats {
        file: FileUsage::of(path)?,
        tables,
    })
}

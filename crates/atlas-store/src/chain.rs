//! Chain history (`chain_points`, `chain_daily`): block time and difficulty per height.
//!
//! Recent blocks have a row each, written with the block (live and backfilled). Older history
//! keeps only the [`CHAIN_SAMPLE_GRID`] heights: [`Store::thin_chain_points_before`] drops the
//! other rows once they leave the per-block tier, and the engine's chain sampler fetches the
//! grid heights nobody stored, so the whole chain is covered by about 4,200 rows.

use std::collections::BTreeSet;

use redb::ReadableTable;

use atlas_core::chain::BlockSummary;

use crate::codec;
use crate::error::Result;
use crate::records::{CHAIN_SAMPLE_GRID, ChainPoint};
use crate::store::Store;
use crate::tables;

/// Block times may run ahead of the median time of the blocks before them by up to two hours,
/// so a scan by time stops only this far past its cutoff.
const TIME_SLACK_MS: u64 = 2 * 3_600_000;

impl Store {
    /// Rows with `from <= height <= to`, ascending.
    pub fn chain_points(&self, from: u32, to: u32) -> Result<Vec<(u32, ChainPoint)>> {
        if from > to {
            return Ok(Vec::new());
        }
        self.read(|txn| {
            let t = txn.open_table(tables::CHAIN_POINTS)?;
            let mut out = Vec::new();
            for item in t.range(from..=to)? {
                let (k, v) = item?;
                out.push((k.value(), codec::decode(v.value())?));
            }
            Ok(out)
        })
    }

    /// The row at `height`.
    pub fn chain_point(&self, height: u32) -> Result<Option<ChainPoint>> {
        self.read(|txn| {
            let t = txn.open_table(tables::CHAIN_POINTS)?;
            t.get(height)?.map(|g| codec::decode(g.value())).transpose()
        })
    }

    /// The highest row.
    pub fn latest_chain_point(&self) -> Result<Option<(u32, ChainPoint)>> {
        self.read(|txn| {
            let t = txn.open_table(tables::CHAIN_POINTS)?;
            t.last()?
                .map(|(k, v)| Ok((k.value(), codec::decode(v.value())?)))
                .transpose()
        })
    }

    /// The daily difficulty series, ascending by day.
    pub fn chain_daily(&self) -> Result<Vec<(u64, f64)>> {
        self.read(|txn| {
            let t = txn.open_table(tables::CHAIN_DAILY)?;
            let mut out = Vec::new();
            for item in t.range::<u64>(..)? {
                let (k, v) = item?;
                out.push((k.value(), v.value()));
            }
            Ok(out)
        })
    }

    /// Heights on `grid` (0, grid, 2 grid, ... up to `max_height`) without a row that carries a
    /// difficulty, ascending: what the chain sampler still has to fetch. Rows seeded from
    /// stored blocks lack the difficulty and are fetched again.
    pub fn chain_grid_missing(&self, grid: u32, max_height: u32) -> Result<Vec<u32>> {
        let grid = grid.max(1);
        let have: BTreeSet<u32> = self.read(|txn| {
            let t = txn.open_table(tables::CHAIN_POINTS)?;
            let mut have = BTreeSet::new();
            for item in t.range(..=max_height)? {
                let (k, v) = item?;
                let h = k.value();
                if h % grid == 0 && codec::decode::<ChainPoint>(v.value())?.difficulty.is_some() {
                    have.insert(h);
                }
            }
            Ok(have)
        })?;
        Ok((0..=max_height / grid)
            .map(|i| i * grid)
            .filter(|h| !have.contains(h))
            .collect())
    }

    /// Gives every stored block at or after `since_ms` a row (time only) where it has none yet.
    /// Run once after an upgrade, so the recent windows read the blocks stored before the
    /// `chain_points` table existed. Returns the rows added.
    pub fn seed_chain_points_from_blocks(&self, since_ms: u64) -> Result<u64> {
        self.write(|txn| {
            let blocks = txn.open_table(tables::BLOCKS)?;
            let mut points = txn.open_table(tables::CHAIN_POINTS)?;
            let mut add = Vec::new();
            for item in blocks.range::<u32>(..)? {
                let (k, v) = item?;
                let b: BlockSummary = codec::decode(v.value())?;
                if b.time_ms >= since_ms && points.get(k.value())?.is_none() {
                    add.push((
                        k.value(),
                        ChainPoint {
                            time_s: u32::try_from(b.time_ms / 1000).unwrap_or(u32::MAX),
                            difficulty: None,
                        },
                    ));
                }
            }
            for (h, p) in &add {
                points.insert(*h, codec::encode(p)?.as_slice())?;
            }
            Ok(add.len() as u64)
        })
    }

    /// Thins the per-block rows older than `before_ms` to the sample grid. Returns rows removed.
    pub fn thin_chain_points_before(&self, before_ms: u64) -> Result<u64> {
        self.write(|txn| {
            let mut table = txn.open_table(tables::CHAIN_POINTS)?;
            let mut doomed = Vec::new();
            for item in table.range::<u32>(..)? {
                let (k, v) = item?;
                let point: ChainPoint = codec::decode(v.value())?;
                if point.time_ms() >= before_ms.saturating_add(TIME_SLACK_MS) {
                    break;
                }
                let height = k.value();
                if point.time_ms() < before_ms && height % CHAIN_SAMPLE_GRID != 0 {
                    doomed.push(height);
                }
            }
            for height in &doomed {
                table.remove(*height)?;
            }
            Ok(doomed.len() as u64)
        })
    }
}

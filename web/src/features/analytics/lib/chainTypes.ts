// The shape of GET /api/v1/network/chain-history, written to match the server's ts-rs types
// (`ChainHistoryDto`, `ChainPointDto`, `BlockTimeTargetDto`, `ChainCoverageDto`, `ChainWindow`), which are
// not in api/generated yet.
//
// TODO: delete this file and import all five from api/generated once they land. Nothing else changes:
// the names, the fields and the nullability are the same.

export type ChainWindow = '24h' | '7d' | '30d' | '1y' | 'all';

/** One step of the block time target schedule: from this height (and the time it was reached) the target is `seconds`. */
export interface BlockTimeTargetDto {
  from_height: number;
  from_ms: number;
  seconds: number;
}

/** One bucket of history. Every metric can be null when the server could not work it out. */
export interface ChainPointDto {
  /** Bucket end time (the window end for the last bucket). */
  t_ms: number;
  /** Last height with data in the bucket. */
  height: number;
  /** Difficulty at the bucket end (the last known value in the bucket). */
  difficulty: number | null;
  /** Mean of the known difficulties in the bucket: the steadier trend line. */
  difficulty_mean: number | null;
  /** Mean seconds per block across the bucket. */
  block_time_s: number | null;
  /** The longest single gap in the bucket, when per-block data covers it. */
  block_time_max_s: number | null;
}

/** How much of the chain's history the server has read so far. */
export interface ChainCoverageDto {
  /** Every height of the window is covered by a known time per block. */
  complete: boolean;
  /** Lowest height with data in the window. */
  indexed_from_height: number | null;
  /** Share of the window's heights covered by a known time per block, 0 to 100. */
  percent: number;
}

export interface ChainHistoryDto {
  window: ChainWindow;
  /** When the server worked this answer out. */
  generated_ms: number;
  /** The time span the points cover (first and last data row of the window). */
  from_ms: number;
  to_ms: number;
  from_height: number;
  to_height: number;
  block_count: number;
  avg_block_time_s: number | null;
  /** Width of one bucket. Points are bucket ends, so a step wider than this is a gap. */
  bucket_ms: number;
  latest_height: number;
  latest_difficulty: number | null;
  /** The target that applies now. */
  target_block_time_s: number;
  /** The target schedule, ascending. */
  targets: BlockTimeTargetDto[];
  /** Ascending by `t_ms`, at most 720. Buckets without any data have no point. */
  points: ChainPointDto[];
  coverage: ChainCoverageDto;
}

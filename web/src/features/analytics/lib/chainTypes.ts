// The shape of GET /api/v1/network/chain-history, written to the contract the Chain tab was briefed
// against. The server's ts-rs types are not generated yet.
//
// TODO: delete this file and import ChainHistoryDto, ChainPointDto, BlockTimeTargetDto and
// ChainCoverageDto from api/generated once they land. The names and fields are the same. `window` is a
// plain string here, as a Rust String comes out, and `chainModel` does not trust it: an echo it does not
// know falls back to the window the tab asked for. `ChainWindow` stays (the tab's own list of windows).

export type ChainWindow = '24h' | '7d' | '30d' | '1y' | 'all';

/** One step of the block time target schedule: from this height (and the time it was reached) the target is `seconds`. */
export interface BlockTimeTargetDto {
  from_height: number;
  from_ms: number;
  seconds: number;
}

/** One bucket of history. Every metric can be null when the server could not work it out. */
export interface ChainPointDto {
  t_ms: number;
  height: number;
  difficulty: number | null;
  /** Mean seconds per block across the bucket. */
  block_time_s: number | null;
  /** The longest single gap in the bucket, when known. */
  block_time_max_s: number | null;
}

/** How much of the chain's history the server has read so far. */
export interface ChainCoverageDto {
  complete: boolean;
  indexed_from_height: number | null;
  /** 0 to 100. */
  percent: number;
}

export interface ChainHistoryDto {
  /** The window the server answered for: one of `ChainWindow`. */
  window: string;
  from_ms: number;
  to_ms: number;
  from_height: number;
  to_height: number;
  block_count: number;
  avg_block_time_s: number | null;
  latest_height: number;
  latest_difficulty: number | null;
  /** The target that applies now. */
  target_block_time_s: number;
  /** The target schedule, ascending. */
  targets: BlockTimeTargetDto[];
  /** Ascending by `t_ms`, at most 720. */
  points: ChainPointDto[];
  coverage: ChainCoverageDto;
}

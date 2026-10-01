// A small, plausible answer from `/network/chain-history`, for the tests of the Chain tab and its charts.
// Tests only: nothing in the app imports it.

import type { BlockTimeTargetDto } from '../../../api/generated/BlockTimeTargetDto';
import type { ChainHistoryDto } from '../../../api/generated/ChainHistoryDto';
import type { ChainPointDto } from '../../../api/generated/ChainPointDto';

export const MIN = 60_000;
export const DAY = 86_400_000;

/** The first bucket of the fixture: 12:00 UTC on 30 September 2026. */
export const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
/** When the target went from 120 s to 30 s (Proof of Node, block 2,020,000). */
export const FORK_MS = Date.UTC(2025, 9, 25, 0, 0, 0);

export const SCHEDULE: BlockTimeTargetDto[] = [
  { from_height: 0, from_ms: Date.UTC(2018, 1, 1), seconds: 120 },
  { from_height: 2_020_000, from_ms: FORK_MS, seconds: 30 },
];

/**
 * Ten buckets two minutes apart: steady 30 s blocks, one 37.5 s bucket holding a 90 s gap, an 11 minute
 * stall in the seventh, one bucket without a difficulty and one without a longest gap. The mean
 * difficulty of a bucket is a little under its end value, as a rising difficulty makes it.
 */
export function chainPoints(): ChainPointDto[] {
  return Array.from({ length: 10 }, (_, i) => ({
    t_ms: T0 + i * 2 * MIN,
    height: 2_999_000 + i * 4,
    difficulty: i === 4 ? null : 0.35 + i * 0.001,
    difficulty_mean: i === 4 ? null : 0.346 + i * 0.001,
    block_time_s: i === 6 ? 195 : i === 3 ? 37.5 : 30,
    block_time_max_s: i === 6 ? 660 : i === 3 ? 90 : i === 8 ? null : 34,
    sampled: false,
  }));
}

/** The same buckets as an older server, or a mock, would send them: no mean difficulty. */
export function withoutMeans(points: ChainPointDto[]): ChainPointDto[] {
  return points.map(({ difficulty_mean: _, ...rest }) => rest as ChainPointDto);
}

export function chainDto(over: Partial<ChainHistoryDto> = {}): ChainHistoryDto {
  const points = over.points ?? chainPoints();
  return {
    window: '24h',
    generated_ms: T0 + 20 * MIN + 5_000,
    from_ms: T0 - 2 * MIN,
    to_ms: T0 + 20 * MIN,
    from_height: 2_998_996,
    to_height: 2_999_036,
    block_count: points.length * 4,
    avg_block_time_s: 36.2,
    bucket_ms: 2 * MIN,
    latest_height: 2_999_036,
    latest_difficulty: 0.359,
    target_block_time_s: 30,
    targets: SCHEDULE,
    points,
    coverage: { complete: true, indexed_from_height: 0, percent: 100 },
    ...over,
  };
}
